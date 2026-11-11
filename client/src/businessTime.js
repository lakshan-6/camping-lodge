// Inputs and reports consistently use Sri Lanka time, regardless of browser timezone.
const offset = 330 * 60000;
export const businessDate = (date = new Date()) => new Date(+new Date(date) + offset).toISOString().slice(0, 10);
export const businessInput = date => new Date(+new Date(date) + offset).toISOString().slice(0, 16);
export const businessISO = value => new Date(value + '+05:30').toISOString();
export const formatBusinessTime = value => new Date(value).toLocaleString('en-LK', {
  timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short',
});

const hasPlannedDate = order => order.pickupDate && ['reserved', 'cancelled'].includes(order.status);
export const formatPickup = order => hasPlannedDate(order)
  ? new Date(order.startDate).toLocaleDateString('en-LK', { timeZone: 'Asia/Colombo', dateStyle: 'medium' })
  : formatBusinessTime(order.startDate);
export const formatReturn = order => hasPlannedDate(order)
  ? (order.status === 'reserved' ? '36 hours after pickup' : '—')
  : formatBusinessTime(order.endDate);
