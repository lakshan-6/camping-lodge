# Daily workflows

## Customers and bookings

Enter a phone number or NIC to see existing customer matches before creating a new customer. Sri Lankan local `0` and international `94` phone formats match the same customer. Old NICs accept nine digits followed by V/X; new NICs accept twelve digits. Other letters in phone/NIC fields are rejected. A shared family phone needs an explicit different-person choice and a distinct NIC. Customer history shows their previous bookings and returns.

Bookings check available whole-unit quantities. A booking and its advance save together, and retrying a submitted form does not create a second booking/payment. At pickup, complete pending customer details and the equipment checklist. The actual handover time starts the rental period and availability is checked again, including conflicting future bookings. A period is 36 hours.

## NIC or money as rental security

Under **New order > Security deposit**, choose **NIC** or **Money**. At handover, explicitly confirm the physical NIC received, or enter and confirm the money deposit actually received. An existing recorded deposit also satisfies money security. Rental payments remain separate; a NIC never adds to cash, revenue or a refundable money balance. Staff need payment permission to record money, but can receive/return NICs with their handover/return permissions.

The customer must have a valid NIC number before their physical NIC can be recorded as held. The same customer's NIC cannot be held for two orders at once. View order > Security for this rental shows its custody status. Return all equipment first, then confirm the NIC was physically returned, either in the final return form or later in View order. A completed order can still show **NIC held · return pending**. Returning equipment alone never releases the NIC. A held NIC blocks cancellation, hiding and permanent deletion until its return is recorded. Refund/apply held money before switching to NIC, or return a held NIC before switching to money. Security type changes belong before handover.

## Identify individual physical units

For equipment that needs this, enable **Track each physical unit with its own code** when adding/editing inventory. Choose a 2–12 letter/number prefix such as **SB**. Ten sleeping bags generate SB-001 through SB-010 (the sequence continues if that prefix was used before). Open **Unit codes > Print unit labels**, then physically attach one durable matching label to each item. The system cannot identify an unlabelled bag by appearance.

At pickup select exactly the booked number of ready unit codes. At return choose **Returned · good**, **Returned · damaged**, **Lost**, or **Not returned yet** for each code. For example, mark only SB-004 damaged: its history links it to that customer/order, and it cannot be handed out again until repaired. Repairs select exact damaged codes and completing the repair makes those codes ready again. Unit codes also show the current rental and recorded rental/repair history. In-store damage, loss or retirement can be recorded through **Change condition** with a reason; units still out or in repair must use Returns or Repairs.

Tracking is optional for each equipment type. Existing items can enable it after outstanding rentals and open repairs finish. Old rentals cannot acquire physical unit identities retrospectively. Once enabled, codes and tracking remain permanent. Increasing total quantity creates more codes; decreasing quantities or changing damaged counts requires selecting the actual unit codes. Lost/retired labels remain in history and are never reused. A matching stock count can be recorded after correcting those specific units. Completed order deletion removes that order's unit allocation history along with its other records, while keeping physical unit labels and stock unchanged. New encrypted backups contain the labels; old backups still validate, but restoring one predating these changes also restores its older data.

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

## Search and simpler screens

The home screen is now Today's work. Owner/admin accounts can open Business overview separately. Money combines Invoices, Payments/deposits and Daily cash close. Existing `/billing`, `/payments` and `/today` links redirect to the new screens.

Orders supports literal search by order number/customer/phone/NIC, status and pickup-date range in Sri Lanka time. Results show 25, 50 or 100 per page. Cancel booking, Hide from list and Delete permanently are separate actions.

In **New order**, enter the customer's NIC. A matching NIC fills in the existing customer's saved details. If the NIC is new, enter the full name and phone number (email and address are optional); the customer is saved when the order is created. People with different NICs can share a phone number. If the phone matches an older profile without an NIC, complete that profile for the same person or confirm it is a different person. Choose pickup and return date/time, available items and quantities, then select **NIC** or **Money** as security. The physical NIC or deposit is confirmed at pickup. Rental advances are separate and optional. Existing bookings with pending details can still be completed through **Add details**.

If booking email is configured and the customer has an email address, creating a booking sends its confirmation automatically. Check the message above the Orders list for the email result. The booking stays saved if the address is missing or the email cannot be sent.

## Cash close and physical stock counts

Open Money > Daily cash close, select the business date and review rental receipts/refunds, actual cash security-deposit collections/refunds and cash expenses. Non-cash entries and deposit applications are excluded. Enter opening cash, any cash taken out/banked, and the cash counted **after taking that money out**. A difference needs a reason. The previous closing count is only a suggested opening balance; verify it. Users with Close the daily cash drawer permission can submit the first close. Only the owner can correct it; all revisions remain in history. Later payment/expense edits or permanent order deletion flag a changed ledger instead of silently rewriting a prior close.

Stock count counts good units physically in the store and all damaged units, including units in repair. Units still with customers are added automatically to the physical total. Differences need an explanation and create an inventory adjustment and audit entry. Counts cannot remove units needed by bookings or open repair jobs. Refresh if stock/bookings changed while counting. Recent counts retain before/after quantities and the actor.

## Owner account security

Open Account security. Generate account recovery codes **before** you forget the password, and store them privately offline. Each code works once; creating a new set invalidates the previous set. Staff password recovery still goes through the owner/admin.

To enable 2FA, confirm your current password, enter the displayed setup key in an authenticator app as time based (six digits, 30 seconds), then enter a valid code. Setup expires after ten minutes. Enabling is optional and occurs only after confirmation. Save the separate authenticator recovery codes displayed once. Current password plus an authenticator/recovery code is needed to disable 2FA, change the owner password or replace recovery codes. Credential changes revoke other sessions. A code just used cannot be reused; wait for the next code or use an unused recovery code.

Forgot owner password uses an **account recovery code**. When 2FA is enabled, it additionally requires the current authenticator code or an unused **authenticator recovery code**. Recovery changes the password, consumes the code(s), revokes sessions and returns to login; it never signs you in automatically or silently disables 2FA. If you lose every recovery method, there is no public setup-key bypass. Keep the original backup encryption key, as it also protects authenticator secrets.

## External backup connection

See [EXTERNAL_BACKUPS.md](EXTERNAL_BACKUPS.md) for private bucket setup, retention, free-allowance limits and a recovery drill. This update prepares the integration without creating an account or uploading production data to a new provider. Once configured, backups upload encrypted files and read them back to verify integrity. A local-only or failed status means the external copy is not verified. Check file without restoring performs a non-destructive validation; actual restore still needs the owner delete key and exact confirmation.
## Deleting test customers

On Customers, choose **Delete**, review the customer name and history check, then choose **Delete permanently**. This removes the customer contact record. Any linked order (including hidden or cancelled orders), rental or invoice blocks deletion; remove unwanted test orders and their related records first. There is no automatic cascade into booking history.

Owners and admins can delete customers. Staff need the separate **Delete customers without booking history** permission under Staff access; create/edit permission alone does not allow deletion. Deletion is transactional and audited. Retrying the same deletion does not repeat it. Encrypted backups retain their existing snapshots until normal retention removes them.
