import { httpErr } from './availability.js';
export const PERMISSIONS = ['orders.write','customers.write','rentals.write','returns.write','inventory.manage','payments.record','payments.refund','finance.view','reports.view','expenses.manage','fees.waive'];
export const STAFF_DEFAULTS = ['orders.write','customers.write','rentals.write','returns.write'];
export const permissionsOf = user => ['owner','admin'].includes(user?.role) ? PERMISSIONS : (user?.permissions ?? STAFF_DEFAULTS);
export const can = (user, permission) => permissionsOf(user).includes(permission);
export const requirePermission = permission => (req, res, next) => can(req.user, permission) ? next() : next(httpErr(403, 'You do not have permission for this action'));
export function assertPermission(user, permission) { if (!can(user, permission)) throw httpErr(403, 'You do not have permission for this action'); }
