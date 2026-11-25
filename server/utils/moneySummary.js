import { Order, Payment, DepositTransaction, Expense, AuditEvent } from '../models/index.js';
import { dayRange } from './businessTime.js';
import { PAYMENT_METHODS, transaction } from './operations.js';
import { httpErr } from './availability.js';

const cents = value => Math.round(Number(value || 0) * 100);
const methodOf = value => PAYMENT_METHODS.includes(value) ? value : 'other';
const appliedSecurityPayment = payment => payment.type === 'balance'
  && payment.method === 'other'
  && /^Applied security deposit(?: - |$)/.test(payment.reference || '');
const cancellationAction = value => value?.cancellation?.action ?? value?.['cancellation.action'];

function methodTotals(method) {
  return { method, rentalReceipts: 0, salesReceipts: 0, rentalRefunds: 0, salesRefunds: 0,
    rentalNet: 0, salesNet: 0, securityCollected: 0, securityRefunds: 0, expenses: 0 };
}

export async function cancellationActions(orders, session = null) {
  const actions = new Map(orders.filter(order => order.status === 'cancelled')
    .map(order => [String(order._id), cancellationAction(order)]));
  const missingIds = [...actions].filter(([, action]) => !action).map(([id]) => id);
  // Earlier PostgreSQL cancellations retained their action in the atomic audit record.
  const events = missingIds.length ? await AuditEvent.find({
    action: 'order.cancelled', target: { $in: missingIds },
  }).select('target after').sort({ createdAt: 1, _id: 1 }).session(session).lean() : [];
  for (const event of events) actions.set(String(event.target), cancellationAction(event.after));
  return actions;
}

export async function moneySummary({ from, to } = {}) {
  const hasRange = from !== undefined || to !== undefined;
  if (hasRange && (typeof from !== 'string' || typeof to !== 'string')) {
    throw httpErr(400, 'Choose both a start and an end date');
  }
  const range = hasRange ? dayRange(from, to) : null;
  const inPeriod = value => !range || (new Date(value) >= range.$gte && new Date(value) < range.$lt);

  return transaction(async session => {
    // Read every retained ledger row so current balances include older bookings.
    const payments = await Payment.find().select('order amount saleAmount type method paidAt reference').session(session).lean();
    const deposits = await DepositTransaction.find().select('order amount type method createdAt').session(session).lean();
    const orders = await Order.find().select('status totalAmount cancellation.action').session(session).lean();
    const expenses = await Expense.find(range ? { spentAt: range } : {}).select('amount method').session(session).lean();
    const cancellationByOrder = await cancellationActions(orders, session);
    const methods = new Map(PAYMENT_METHODS.map(method => [method, methodTotals(method)]));
    const paidByOrder = new Map();
    let securityHeld = 0;
    let securityApplied = 0;

    for (const payment of payments) {
      const amount = cents(payment.amount);
      const order = String(payment.order);
      const change = payment.type === 'refund' ? -amount : amount;
      paidByOrder.set(order, (paidByOrder.get(order) || 0) + change);
      if (!inPeriod(payment.paidAt)) continue;
      const saleAmount = Math.max(0, Math.min(amount, cents(payment.saleAmount)));
      const rentalAmount = amount - saleAmount;
      const totals = methods.get(methodOf(payment.method));
      const sign = payment.type === 'refund' ? -1 : 1;
      totals.salesNet += sign * saleAmount;
      totals.rentalNet += sign * rentalAmount;
      if (appliedSecurityPayment(payment)) continue;
      if (payment.type === 'refund') {
        totals.rentalRefunds += rentalAmount;
        totals.salesRefunds += saleAmount;
      } else {
        totals.rentalReceipts += rentalAmount;
        totals.salesReceipts += saleAmount;
      }
    }

    for (const deposit of deposits) {
      const amount = cents(deposit.amount);
      securityHeld += deposit.type === 'collect' ? amount : -amount;
      if (!inPeriod(deposit.createdAt)) continue;
      if (deposit.type === 'apply') {
        securityApplied += amount;
        continue;
      }
      const totals = methods.get(methodOf(deposit.method));
      if (deposit.type === 'collect') totals.securityCollected += amount;
      else if (deposit.type === 'refund') totals.securityRefunds += amount;
    }

    for (const expense of expenses) methods.get(methodOf(expense.method)).expenses += cents(expense.amount);

    let outstanding = 0;
    let refundDue = 0;
    for (const order of orders) {
      const paid = paidByOrder.get(String(order._id)) || 0;
      if (order.status === 'cancelled') {
        const action = cancellationByOrder.get(String(order._id));
        if (action !== 'keep') refundDue += Math.max(0, paid);
      } else {
        const balance = cents(order.totalAmount) - paid;
        outstanding += Math.max(0, balance);
        refundDue += Math.max(0, -balance);
      }
    }

    const totals = methodTotals(null);
    const byMethod = [...methods.values()].map(row => {
      for (const key of Object.keys(totals)) {
        if (key !== 'method') totals[key] += row[key];
      }
      const totalReceipts = row.rentalReceipts + row.salesReceipts;
      const totalRefunds = row.rentalRefunds + row.salesRefunds;
      const netPayments = row.rentalNet + row.salesNet;
      const netMovement = totalReceipts - totalRefunds + row.securityCollected - row.securityRefunds - row.expenses;
      return Object.fromEntries(Object.entries({ ...row, totalReceipts, totalRefunds, netPayments, netMovement }).map(([key, value]) =>
        [key, key === 'method' ? value : value / 100]));
    });
    const { rentalReceipts, salesReceipts, rentalRefunds, salesRefunds, rentalNet, salesNet, securityCollected, securityRefunds } = totals;
    const totalReceipts = rentalReceipts + salesReceipts;
    const totalRefunds = rentalRefunds + salesRefunds;
    const netPayments = rentalNet + salesNet;
    return {
      period: { from: hasRange ? from : null, to: hasRange ? to : null },
      rentalReceipts: rentalReceipts / 100,
      salesReceipts: salesReceipts / 100,
      rentalRefunds: rentalRefunds / 100,
      salesRefunds: salesRefunds / 100,
      totalReceipts: totalReceipts / 100,
      totalRefunds: totalRefunds / 100,
      rentalNet: rentalNet / 100,
      salesNet: salesNet / 100,
      netPayments: netPayments / 100,
      securityApplied: securityApplied / 100,
      expenses: totals.expenses / 100,
      receiptsLessExpenses: (netPayments - totals.expenses) / 100,
      securityCollected: securityCollected / 100,
      securityRefunds: securityRefunds / 100,
      netMovement: (totalReceipts - totalRefunds + securityCollected - securityRefunds - totals.expenses) / 100,
      byMethod,
      current: { outstanding: outstanding / 100, refundDue: refundDue / 100, securityHeld: securityHeld / 100 },
    };
  });
}
