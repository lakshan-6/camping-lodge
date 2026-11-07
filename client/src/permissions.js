export const can=(user,permission)=>['owner','admin'].includes(user?.role)||(user?.permissions||[]).includes(permission);
export const permissionLabels={
 'orders.write':'Create/change/cancel bookings','customers.write':'Create/edit customers','rentals.write':'Hand over and extend rentals','returns.write':'Receive returns',
 'inventory.manage':'Change stock and manage repairs','payments.record':'Record received payments','payments.refund':'Record refunds and approve overpayments',
 'finance.view':'View revenue and financial history','finance.close':'Close the daily cash drawer','reports.view':'View reports and export data','expenses.manage':'Manage expenses','fees.waive':'Waive late fees'
};
