import { httpErr } from './availability.js';

export function customerContact(body) {
  if (typeof body.phone !== 'string' || !/^[0-9]{10,15}$/.test(body.phone.trim()))
    throw httpErr(400, 'Phone number must contain 10 to 15 digits only (no letters or symbols)');
  if (body.nic != null && typeof body.nic !== 'string')
    throw httpErr(400, 'NIC must be 12 digits, or 9 digits followed by V or X');
  const nic = (body.nic || '').trim().toUpperCase();
  if (nic && !/^(?:[0-9]{12}|[0-9]{9}[VX])$/.test(nic))
    throw httpErr(400, 'NIC must be 12 digits, or 9 digits followed by V or X');
  return { phone: body.phone.trim(), nic };
}
