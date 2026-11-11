import { Router } from 'express';
import { availability, bookingWindow } from '../utils/availability.js';

const r = Router();
r.get('/', async (req, res, next) => {
  try {
    const { start, end, periods } = bookingWindow(req.query.pickupDate,req.query.start,req.query.end);
    res.json({ periods, items: await availability(start, end, req.query.exclude) });
  } catch (err) { next(err); }
});
export default r;
