import PDFDocument from 'pdfkit';
import fs from 'fs';
import { fileURLToPath } from 'url';

const logoPath = fileURLToPath(new URL('../assets/logo.png', import.meta.url));
const lkr = n => 'LKR ' + Number(n || 0).toLocaleString('en-LK');
const when = d => new Date(d).toLocaleString('en-LK', { timeZone:'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' });

// Builds the invoice as a PDF (returns a Buffer). The built-in PDF font only supports Latin letters.
export function invoicePdf({ st, inv, items, paid }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const balance = Math.max(0, inv.total - paid), done = balance === 0, voided = inv.status === 'void';
    const green = '#173a2f';
    const planned = inv.order.pickupDate && ['reserved', 'cancelled'].includes(inv.order.status);
    const pickup = planned ? inv.order.pickupDate : when(inv.order.startDate);
    const returnTime = planned ? (inv.order.status === 'reserved' ? '36 hours after pickup' : 'Cancelled') : when(inv.order.endDate);

    if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 36, { height: 80 });
    doc.fillColor(green).font('Helvetica-Bold').fontSize(18).text(st.businessName, 120, 42, { width: 250 });
    doc.fillColor('#444').font('Helvetica').fontSize(10).text([st.phone, st.address].filter(Boolean).join('   |   '), 120, 66, { width: 250 });
    doc.fillColor(green).font('Helvetica-Bold').fontSize(22).text('INVOICE', 380, 42, { width: 175, align: 'right' });
    doc.fillColor('#444').font('Helvetica').fontSize(10).text(inv.invoiceNo, 380, 70, { width: 175, align: 'right' }).text(when(inv.issuedAt), 380, 84, { width: 175, align: 'right' });

    doc.fillColor(green).font('Helvetica-Bold').fontSize(9).text('BILL TO', 40, 140).text('ORDER', 330, 140);
    doc.fillColor('#222').font('Helvetica').fontSize(10)
      .text([inv.customer.name, inv.customer.phone].filter(Boolean).join('\n'), 40, 154, { width: 270 })
      .text([inv.order.orderNo, 'Pickup: ' + pickup, 'Return: ' + returnTime].join('\n'), 330, 154, { width: 225 });

    doc.roundedRect(40, 212, 515, 28, 6).fill(voided ? '#9b272c' : done ? '#2d7a4f' : '#d9922b');
    doc.fillColor(voided || done ? '#fff' : '#2a1b00').font('Helvetica-Bold').fontSize(11)
      .text(voided ? 'VOID INVOICE' : done ? 'PAID IN FULL  -  PAYMENT COMPLETED' : 'BALANCE DUE: ' + lkr(balance), 40, 221, { width: 515, align: 'center' });

    let y = 262;
    const x = { item: 48, qty: 300, rate: 340, per: 425, amt: 470 };
    doc.rect(40, y, 515, 22).fill(green);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text('Item', x.item, y + 7).text('Qty', x.qty, y + 7)
      .text('Rate / 36h', x.rate, y + 7).text('Periods', x.per, y + 7).text('Amount', x.amt, y + 7, { width: 77, align: 'right' });
    y += 30;
    doc.font('Helvetica').fillColor('#222').fontSize(10);
    for (const i of items) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.text(i.equipment?.name || '', x.item, y, { width: 245 }).text(String(i.quantity), x.qty, y).text(lkr(i.periodRate), x.rate, y, { width: 80 })
        .text(String(i.periods), x.per, y).text(lkr(i.lineTotal), x.amt, y, { width: 77, align: 'right' });
      y += 22;
      doc.moveTo(40, y - 5).lineTo(555, y - 5).strokeColor('#ddd').stroke();
    }
    y += 10;
    if (y > 650) { doc.addPage(); y = 50; }
    const line = (label, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#222')
        .text(label, 330, y, { width: 120 }).text(val, 450, y, { width: 105, align: 'right' });
      y += bold ? 24 : 19;
    };
    line('Subtotal', lkr(inv.subtotal));
    if (inv.fees) line(inv.fees > 0 ? 'Extra charges' : 'Adjustments', lkr(inv.fees));
    line('Total', lkr(inv.total), true);
    line('Paid', lkr(paid));
    if (!voided) line(done ? 'Balance' : 'Balance due', lkr(balance), true);
    doc.fillColor('#666').font('Helvetica').fontSize(10).text('Thank you for choosing ' + st.businessName + '.', 40, Math.max(y + 30, 740), { width: 515, align: 'center' });
    doc.end();
  });
}
