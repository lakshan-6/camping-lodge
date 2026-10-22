import { Router } from 'express';
import { Settings } from '../models/index.js';
import { requireAdmin } from '../utils/auth.js';

export const getSettings = async () => (await Settings.findOne()) || Settings.create({});

const r = Router();
r.get('/', async (req, res, next) => { try { res.json(await getSettings()); } catch (e) { next(e); } });
r.put('/', requireAdmin, async (req, res, next) => {
  try {
    const s = await getSettings();
    const { businessName, phone, address, lateFeePercent } = req.body;
    s.set({ businessName, phone, address, lateFeePercent: Math.max(0, Number(lateFeePercent) || 0) });
    res.json(await s.save());
  } catch (e) { next(e); }
});
export default r;
