import { Router } from 'express';
import { availability, countPeriods, httpErr } from '../utils/availability.js';

const r = Router();
r.get('/', async (req, res, next) => {
  try {
    const s = new Date(req.query.start), e = new Date(req.query.end);
    if (isNaN(s) || isNaN(e) || s >= e) throw httpErr(400, 'End time must be after start time');
    res.json({ periods: countPeriods(s, e), items: await availability(s, e, req.query.exclude) });
  } catch (err) { next(err); }
});
export default r;
