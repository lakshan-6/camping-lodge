# Daily workflows

## Customers and bookings

Enter a phone number or NIC to see existing customer matches before creating a new customer. Sri Lankan local `0` and international `94` phone formats match the same customer. Old NICs accept nine digits followed by V/X; new NICs accept twelve digits. Other letters in phone/NIC fields are rejected. A shared family phone needs an explicit different-person choice and a distinct NIC. Customer history shows their previous bookings and returns.

Bookings check available whole-unit quantities. A booking and its advance save together, and retrying a submitted form does not create a second booking/payment. At pickup, complete pending customer details and the equipment checklist. The actual handover time starts the rental period and availability is checked again, including conflicting future bookings. A period is 36 hours.

## Extensions and returns

Extend an outstanding rental from Rentals. Remaining equipment is checked against other bookings. Extra periods and any accrued late charges are added to the order and invoice. The estimate shown before saving is the extra-period charge; the saved charge includes any overdue amount after the configured grace period.

For a partial return, enter only the quantities received, damaged or lost now. Remaining equipment stays out and unavailable. Lost items reduce physical stock; damaged items move into damaged stock. Final returns require the return checklist. Late charges already recorded are not charged again for the same elapsed period. Only staff with fee-waiver permission can waive a late charge, and they must provide a reason.

Create a repair against damaged equipment, then complete it after the repair. Completion releases those units back to usable stock. Recording repair cost also creates an expense once and requires expense permission.

## Money and cancellations

Orders, Billing and Payments open the same order workspace. Rental payments/advances and refundable security deposits have separate histories. Collect, refund or apply a held security deposit explicitly; applying it converts that amount into a rental payment. Recording an entry documents money actually received/returned; the app does not transfer funds through a bank or payment provider.

Refunds need a reason and cannot exceed recorded net rental payments. Overpayments require explicit approval and a reason from a user with refund permission. Cancel an uncollected booking with a reason and choose refund now, keep the advance or refund pending. Pending refunds remain visible in Payments. Resolve held security deposits before cancellation. Unresolved paid cancellations cannot simply be hidden.

Completed orders can be permanently deleted only by the owner with the private delete key and exact order number. Review the deletion preview carefully. All linked business records are removed atomically, report totals change, and physical stock is not restored a second time. Audit metadata and existing backup copies are retained.

## Daily work, reports and controls

Today's work lists pickups, due returns, overdue rentals and unpaid balances using Sri Lanka dates. WhatsApp reminder buttons open a draft for manual review and sending. Invoice email controls appear only when email delivery is configured.

Record operating expenses and use Reports to compare receipts less refunds against expenses. The resulting net cash figure is not an accrual-accounting profit calculation. Held security deposits are shown separately from rental revenue. CSV exports cover customers, orders, inventory, payments and expenses, up to 10,000 records per export.

The owner assigns staff permissions in Staff Access. Owner/admin access includes all business permissions; ordinary staff start with customer, booking, pickup and return access. Financial dashboard totals are hidden unless finance/report permission is granted. Operational order totals remain visible where necessary for handover and return work. Activity history is owner-only and records key business actions and account changes without passwords or private keys.

Use the owner-only Backups screen to create/download encrypted copies. Automatic daily snapshots run only while the server is awake and retain the latest seven inside the database. Store downloaded copies separately and retain the exact backup encryption key privately. See DEPLOYMENT.md before restoring or rotating any key.
