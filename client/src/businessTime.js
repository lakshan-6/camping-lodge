// Inputs and reports consistently use Sri Lanka time, regardless of browser timezone.
const offset = 330 * 60000;
export const businessDate = (date = new Date()) => new Date(+new Date(date) + offset).toISOString().slice(0, 10);
export const businessInput = date => new Date(+new Date(date) + offset).toISOString().slice(0, 16);
export const businessISO = value => new Date(value + '+05:30').toISOString();
