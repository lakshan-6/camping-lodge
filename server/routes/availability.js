import { Router } from 'express';
import { availability, bookingWindow } from '../utils/availability.js';

const r = Router();
r.get('/', async (req, res, next) => {
  try {
    if(req.query.salesOnly==='true'){
      const start=new Date(req.query.start);
      if(!Number.isFinite(+start))throw Object.assign(new Error('Choose a pickup time'),{status:400});
      const items=await availability(start,new Date(+start+1),req.query.exclude);
      return res.json({periods:1,items:items.filter(item=>item.itemType==='sale')});
    }
    const { start, reservedUntil, periods } = bookingWindow(req.query.pickupDate,req.query.start,req.query.end);
    res.json({ periods, items: await availability(start, reservedUntil, req.query.exclude) });
  } catch (err) { next(err); }
});
export default r;
