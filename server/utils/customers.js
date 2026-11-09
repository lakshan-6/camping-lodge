import { Customer } from '../models/index.js';
import { httpErr } from './availability.js';
import { customerContact } from './customerContact.js';
import { audit } from './operations.js';
import { assertPermission } from './permissions.js';

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const phoneKey = phone => phone.startsWith('94') && phone.length === 11 ? '0' + phone.slice(2) : phone;
export const customerFields = body => ({ name: body.name, phone: body.phone, nic: body.nic, address: body.address, notes: body.notes, email: body.email });

export async function matchesContact(body, exclude, session = null) {
  const clauses = [];
  if (body.phone) {
    const key = phoneKey(body.phone);
    const aliases = /^0\d{9}$/.test(key) ? [key, '94' + key.slice(1)] : [key];
    clauses.push({ phone: { $in: aliases } }, { phoneKey: key });
  }
  if (body.nic) clauses.push({ nic: new RegExp('^' + escapeRegex(body.nic) + '$', 'i') });
  if (!clauses.length) return [];
  return Customer.find({ ...(exclude ? { _id: { $ne: exclude } } : {}), $or: clauses }).session(session).lean();
}

export function bookingContact(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || body.detailsPending) throw httpErr(400, 'Enter the customer’s full name, NIC and phone number before creating an order');
  const contact = customerContact(body);
  if (!contact.nic) throw httpErr(400, 'Customer NIC is required for a new order');
  return { name, ...contact };
}

async function saveNewCustomer(body, contact, user, session, preBooking) {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : (preBooking ? 'WhatsApp ' + contact.phone : '');
  const [customer] = await Customer.create([{ ...customerFields(body), ...contact, phoneKey: phoneKey(contact.phone), name, detailsPending: preBooking }], { session });
  await audit(session, user, 'customer.created', customer._id, null, { name: customer.name, phone: customer.phone });
  return customer;
}

export async function createCustomer(body, user, session) {
  const contact = customerContact(body);
  const preBooking = !!body.preBooking;
  const matches = await matchesContact(contact, null, session);
  if (matches.some(c => contact.nic && c.nic?.toUpperCase() === contact.nic))
    throw httpErr(409, 'This NIC belongs to an existing customer. Choose that customer.');
  if (preBooking && matches.length === 1) return matches[0];
  if (matches.length && (!body.confirmDifferentPerson || !contact.nic))
    throw httpErr(409, 'An existing customer uses this phone. Choose the existing record, or confirm a different person with a different NIC.');
  return saveNewCustomer(body, contact, user, session, preBooking);
}

export async function resolveBookingCustomer(body, user, session) {
  const contact = bookingContact(body);
  const matches = await matchesContact(contact, null, session);
  const existing = matches.find(c => c.nic?.toUpperCase() === contact.nic);
  if (existing) {
    bookingContact(existing);
    return existing;
  }
  assertPermission(user, 'customers.write');
  if (matches.some(c => !c.nic?.trim()) && body.confirmDifferentPerson !== true)
    throw httpErr(409, 'This phone matches a customer without a saved NIC. Complete their profile or confirm this is a different person.');
  return saveNewCustomer(body, contact, user, session, false);
}
