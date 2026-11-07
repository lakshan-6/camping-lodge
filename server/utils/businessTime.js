const OFFSET = 330 * 60000;
export const localDate = date => new Date(+new Date(date) + OFFSET).toISOString().slice(0, 10);
export function dayRange(from, to = from) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw Object.assign(new Error('Choose valid dates'), { status: 400 });
  const start = new Date(from + 'T00:00:00+05:30');
  const end = new Date(+new Date(to + 'T00:00:00+05:30') + 86400000);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end || localDate(start) !== from || localDate(new Date(+end - 86400000)) !== to) throw Object.assign(new Error('Choose a valid date range'), { status: 400 });
  return { $gte: start, $lt: end };
}
export function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw Object.assign(new Error('Choose a valid month'), { status: 400 });
  const start = new Date(`${month}-01T00:00:00+05:30`);
  const year = Number(month.slice(0,4)), m = Number(month.slice(5));
  if (m < 1 || m > 12) throw Object.assign(new Error('Choose a valid month'), { status: 400 });
  const next = m === 12 ? `${year+1}-01` : `${year}-${String(m+1).padStart(2,'0')}`;
  return { $gte: start, $lt: new Date(`${next}-01T00:00:00+05:30`) };
}
