-- PostgreSQL schema v1. Generated from validation definitions; reviewed constraints below.

CREATE TABLE "audit_events" (
  "actor" text,
  "actorName" text,
  "action" text,
  "target" text,
  "before" jsonb,
  "after" jsonb,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "audit_events_actor_idx" ON "audit_events" ("actor");

CREATE TABLE "backups" (
  "day" text,
  "payload" bytea,
  "iv" bytea,
  "tag" bytea,
  "size" bigint,
  "externalKey" text,
  "externalVerifiedAt" timestamptz,
  "externalError" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE UNIQUE INDEX "backups_day_unique" ON "backups" ("day");

CREATE TABLE "cash_closes" (
  "day" text NOT NULL,
  "revision" bigint NOT NULL,
  "openingCash" numeric(16,2),
  "cashRemoved" numeric(16,2),
  "countedCash" numeric(16,2),
  "expectedCash" numeric(16,2),
  "difference" numeric(16,2),
  "summary" jsonb,
  "ledgerHash" text,
  "reason" text,
  "actor" text,
  "actorName" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "cash_closes_actor_idx" ON "cash_closes" ("actor");

CREATE TABLE "counters" (
  "_id" text PRIMARY KEY,
  "value" bigint
);

CREATE TABLE "customers" (
  "name" text NOT NULL,
  "phone" text NOT NULL,
  "nic" text,
  "address" text,
  "notes" text,
  "phoneKey" text,
  "email" text,
  "detailsPending" boolean,
  "securityRevision" bigint,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "customers_phoneKey_idx" ON "customers" ("phoneKey");

CREATE TABLE "deposit_transactions" (
  "order" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('collect','refund','apply')),
  "amount" numeric(16,2) NOT NULL CHECK ("amount" >= 0),
  "method" text,
  "reason" text,
  "actor" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "deposit_transactions_order_idx" ON "deposit_transactions" ("order");

CREATE INDEX "deposit_transactions_actor_idx" ON "deposit_transactions" ("actor");

CREATE TABLE "equipment" (
  "name" text NOT NULL,
  "category" text NOT NULL,
  "sku" text,
  "totalQuantity" bigint NOT NULL CHECK ("totalQuantity" >= 0),
  "periodRate" numeric(16,2) NOT NULL CHECK ("periodRate" >= 0),
  "deposit" numeric(16,2) CHECK ("deposit" >= 0),
  "damagedQty" bigint CHECK ("damagedQty" >= 0),
  "checklist" jsonb,
  "revision" bigint,
  "trackUnits" boolean,
  "unitPrefix" text,
  "condition" text CHECK ("condition" IN ('good','fair','needs_repair')),
  "notes" text,
  "active" boolean,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  CHECK ("damagedQty" <= "totalQuantity")
);

CREATE UNIQUE INDEX "equipment_sku_unique" ON "equipment" ("sku");

CREATE TABLE "equipment_units" (
  "equipment" text NOT NULL,
  "code" text NOT NULL,
  "state" text NOT NULL CHECK ("state" IN ('good','out','damaged','repair','lost','retired')),
  "rental" text,
  "notes" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "equipment_units_equipment_idx" ON "equipment_units" ("equipment");

CREATE UNIQUE INDEX "equipment_units_code_unique" ON "equipment_units" ("code");

CREATE INDEX "equipment_units_rental_idx" ON "equipment_units" ("rental");

CREATE TABLE "expenses" (
  "amount" numeric(16,2) NOT NULL CHECK ("amount" >= 0),
  "category" text,
  "description" text,
  "spentAt" timestamptz NOT NULL,
  "method" text,
  "actor" text,
  "repair" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "expenses_actor_idx" ON "expenses" ("actor");

CREATE INDEX "expenses_repair_idx" ON "expenses" ("repair");

CREATE TABLE "inventory_transactions" (
  "equipment" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('initial_stock','adjustment','rented_out','returned','damaged','lost','repaired')),
  "quantity" bigint NOT NULL,
  "reference" text,
  "note" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "inventory_transactions_equipment_idx" ON "inventory_transactions" ("equipment");

CREATE TABLE "invoices" (
  "invoiceNo" text,
  "order" text NOT NULL,
  "customer" text NOT NULL,
  "subtotal" numeric(16,2),
  "fees" numeric(16,2),
  "total" numeric(16,2),
  "status" text CHECK ("status" IN ('draft','issued','paid','void')),
  "issuedAt" timestamptz,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE UNIQUE INDEX "invoices_invoiceNo_unique" ON "invoices" ("invoiceNo");

CREATE INDEX "invoices_order_idx" ON "invoices" ("order");

CREATE INDEX "invoices_customer_idx" ON "invoices" ("customer");

CREATE TABLE "mutations" (
  "_id" text PRIMARY KEY,
  "fingerprint" text,
  "result" jsonb,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE TABLE "orders" (
  "orderNo" text,
  "customer" text NOT NULL,
  "pickupDate" text,
  "plannedReturnDate" text,
  "startDate" timestamptz NOT NULL,
  "endDate" timestamptz NOT NULL,
  "status" text CHECK ("status" IN ('reserved','active','settlement_pending','completed','cancelled')),
  "totalAmount" numeric(16,2),
  "depositAmount" numeric(16,2),
  "securityMethod" text CHECK ("securityMethod" IN ('nic','money')),
  "nicHeldAt" timestamptz,
  "nicHeldBy" text,
  "nicReturnedAt" timestamptz,
  "nicReturnedBy" text,
  "periods" bigint,
  "sendVia" text CHECK ("sendVia" IN ('email','whatsapp','both','none')),
  "deletedAt" timestamptz,
  "deletedBy" text,
  "cancellation.action" text,
  "cancellation.reason" text,
  "cancellation.refundPending" numeric(16,2),
  "extensionFees" numeric(16,2),
  "notes" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  CHECK ("endDate" > "startDate")
);

CREATE UNIQUE INDEX "orders_orderNo_unique" ON "orders" ("orderNo");

CREATE INDEX "orders_customer_idx" ON "orders" ("customer");

CREATE INDEX "orders_nicHeldBy_idx" ON "orders" ("nicHeldBy");

CREATE INDEX "orders_nicReturnedBy_idx" ON "orders" ("nicReturnedBy");

CREATE INDEX "orders_deletedBy_idx" ON "orders" ("deletedBy");

CREATE TABLE "order_items" (
  "order" text NOT NULL,
  "equipment" text NOT NULL,
  "quantity" bigint NOT NULL CHECK ("quantity" >= 1),
  "periodRate" numeric(16,2) NOT NULL,
  "periods" bigint NOT NULL CHECK ("periods" >= 1),
  "lineTotal" numeric(16,2) NOT NULL,
  "returnedQuantity" bigint,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  CHECK ("returnedQuantity" <= "quantity")
);

CREATE INDEX "order_items_order_idx" ON "order_items" ("order");

CREATE INDEX "order_items_equipment_idx" ON "order_items" ("equipment");

CREATE TABLE "payments" (
  "order" text NOT NULL,
  "invoice" text,
  "amount" numeric(16,2) NOT NULL CHECK ("amount" >= 0),
  "method" text CHECK ("method" IN ('cash','bank_transfer','card','other')),
  "type" text CHECK ("type" IN ('deposit','rental','balance','refund','fee')),
  "paidAt" timestamptz,
  "reference" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "payments_order_idx" ON "payments" ("order");

CREATE INDEX "payments_invoice_idx" ON "payments" ("invoice");

CREATE TABLE "rentals" (
  "order" text NOT NULL,
  "customer" text NOT NULL,
  "pickedUpAt" timestamptz,
  "dueDate" timestamptz NOT NULL,
  "pickupChecklist" jsonb,
  "latePeriodsCharged" bigint,
  "lateFeePercentCharged" numeric(16,2) CHECK ("lateFeePercentCharged" >= 0) CHECK ("lateFeePercentCharged" <= 100),
  "status" text CHECK ("status" IN ('out','returned','overdue')),
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "rentals_order_idx" ON "rentals" ("order");

CREATE INDEX "rentals_customer_idx" ON "rentals" ("customer");

CREATE TABLE "repairs" (
  "equipment" text NOT NULL,
  "quantity" bigint NOT NULL CHECK ("quantity" >= 1),
  "status" text CHECK ("status" IN ('open','completed')),
  "notes" text,
  "cost" numeric(16,2),
  "completedAt" timestamptz,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "repairs_equipment_idx" ON "repairs" ("equipment");

CREATE TABLE "returns" (
  "rental" text NOT NULL,
  "returnedAt" timestamptz,
  "lateFee" numeric(16,2),
  "damageFee" numeric(16,2),
  "partial" boolean,
  "waivedFee" numeric(16,2),
  "waiverReason" text,
  "checklist" jsonb,
  "notes" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "returns_rental_idx" ON "returns" ("rental");

CREATE TABLE "return_items" (
  "return" text NOT NULL,
  "equipment" text NOT NULL,
  "quantityReturned" bigint,
  "quantityDamaged" bigint,
  "quantityLost" bigint,
  "notes" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "return_items_return_idx" ON "return_items" ("return");

CREATE INDEX "return_items_equipment_idx" ON "return_items" ("equipment");

CREATE TABLE "settings" (
  "businessName" text,
  "phone" text,
  "address" text,
  "lateFeePercent" numeric(16,2) CHECK ("lateFeePercent" >= 0),
  "graceMinutes" bigint CHECK ("graceMinutes" >= 0) CHECK ("graceMinutes" <= 1440),
  "lateFeeIntervalHours" numeric(16,2) CHECK ("lateFeeIntervalHours" >= 0.01),
  "lateFeeStepPercent" numeric(16,2) CHECK ("lateFeeStepPercent" >= 0) CHECK ("lateFeeStepPercent" <= 100),
  "lateFeeFullRateAfterHours" numeric(16,2) CHECK ("lateFeeFullRateAfterHours" >= 0.01),
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE TABLE "stock_counts" (
  "equipment" text NOT NULL,
  "equipmentName" text,
  "countedGood" bigint,
  "countedDamaged" bigint,
  "outQuantity" bigint,
  "before" jsonb,
  "after" jsonb,
  "reason" text,
  "actor" text,
  "actorName" text,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE INDEX "stock_counts_equipment_idx" ON "stock_counts" ("equipment");

CREATE INDEX "stock_counts_actor_idx" ON "stock_counts" ("actor");

CREATE TABLE "users" (
  "username" text NOT NULL,
  "name" text NOT NULL,
  "passwordHash" text NOT NULL,
  "permissions" jsonb,
  "sessionVersion" bigint,
  "role" text CHECK ("role" IN ('owner','admin','staff')),
  "lastSeenAt" timestamptz,
  "active" boolean,
  "mfaEnabled" boolean,
  "mfaSecret" text,
  "mfaPendingSecret" text,
  "mfaPendingUntil" timestamptz,
  "mfaLastStep" bigint,
  "mfaRecoveryHashes" jsonb,
  "accountRecoveryHashes" jsonb,
  "_id" text PRIMARY KEY CHECK ("_id" ~ '^[a-f0-9]{24}$'),
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE UNIQUE INDEX "users_username_unique" ON "users" ("username");

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_fk" FOREIGN KEY ("actor") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_actor_fk" FOREIGN KEY ("actor") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_order_fk" FOREIGN KEY ("order") REFERENCES "orders"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_actor_fk" FOREIGN KEY ("actor") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "equipment_units" ADD CONSTRAINT "equipment_units_equipment_fk" FOREIGN KEY ("equipment") REFERENCES "equipment"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "equipment_units" ADD CONSTRAINT "equipment_units_rental_fk" FOREIGN KEY ("rental") REFERENCES "rentals"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_actor_fk" FOREIGN KEY ("actor") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_repair_fk" FOREIGN KEY ("repair") REFERENCES "repairs"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_equipment_fk" FOREIGN KEY ("equipment") REFERENCES "equipment"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_fk" FOREIGN KEY ("order") REFERENCES "orders"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("customer") REFERENCES "customers"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("customer") REFERENCES "customers"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "orders" ADD CONSTRAINT "orders_nicHeldBy_fk" FOREIGN KEY ("nicHeldBy") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "orders" ADD CONSTRAINT "orders_nicReturnedBy_fk" FOREIGN KEY ("nicReturnedBy") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "orders" ADD CONSTRAINT "orders_deletedBy_fk" FOREIGN KEY ("deletedBy") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("order") REFERENCES "orders"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_equipment_fk" FOREIGN KEY ("equipment") REFERENCES "equipment"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("order") REFERENCES "orders"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("invoice") REFERENCES "invoices"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_order_fk" FOREIGN KEY ("order") REFERENCES "orders"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "rentals" ADD CONSTRAINT "rentals_customer_fk" FOREIGN KEY ("customer") REFERENCES "customers"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "repairs" ADD CONSTRAINT "repairs_equipment_fk" FOREIGN KEY ("equipment") REFERENCES "equipment"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "returns" ADD CONSTRAINT "returns_rental_fk" FOREIGN KEY ("rental") REFERENCES "rentals"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_fk" FOREIGN KEY ("return") REFERENCES "returns"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "return_items" ADD CONSTRAINT "return_items_equipment_fk" FOREIGN KEY ("equipment") REFERENCES "equipment"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_equipment_fk" FOREIGN KEY ("equipment") REFERENCES "equipment"("_id") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_actor_fk" FOREIGN KEY ("actor") REFERENCES "users"("_id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "order_item_units" ("orderItem" text NOT NULL REFERENCES "order_items"("_id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, "unit" text NOT NULL REFERENCES equipment_units("_id") DEFERRABLE INITIALLY DEFERRED, "position" integer NOT NULL, "_id" text, "code" text NOT NULL, "outcome" text NOT NULL CHECK ("outcome" IN ('out','good','damaged','lost')), "returnedAt" timestamptz, PRIMARY KEY ("orderItem", "unit"));

CREATE INDEX "order_item_units_unit_idx" ON "order_item_units"("unit");

CREATE TABLE "repair_units" ("repair" text NOT NULL REFERENCES "repairs"("_id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, "unit" text NOT NULL REFERENCES equipment_units("_id") DEFERRABLE INITIALLY DEFERRED, "position" integer NOT NULL, PRIMARY KEY ("repair", "unit"));

CREATE INDEX "repair_units_unit_idx" ON "repair_units"("unit");

CREATE TABLE "return_item_units" ("returnItem" text NOT NULL REFERENCES "return_items"("_id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, "unit" text NOT NULL REFERENCES equipment_units("_id") DEFERRABLE INITIALLY DEFERRED, "position" integer NOT NULL, "_id" text, "code" text NOT NULL, "condition" text NOT NULL CHECK ("condition" IN ('good','damaged','lost')), PRIMARY KEY ("returnItem", "unit"));

CREATE INDEX "return_item_units_unit_idx" ON "return_item_units"("unit");

CREATE UNIQUE INDEX users_single_owner ON users ((role)) WHERE role='owner';

CREATE UNIQUE INDEX customers_nic_unique ON customers (upper(nic)) WHERE nic IS NOT NULL AND nic <> '';

CREATE UNIQUE INDEX cash_close_revision_unique ON cash_closes(day,revision);

CREATE INDEX orders_status_dates_idx ON orders(status,"startDate","endDate");

CREATE INDEX rentals_status_due_idx ON rentals(status,"dueDate");

CREATE INDEX payments_paid_at_idx ON payments("paidAt");

CREATE INDEX equipment_units_state_idx ON equipment_units(equipment,state);

CREATE INDEX audit_events_created_idx ON audit_events("createdAt");

CREATE INDEX mutations_result_idx ON mutations USING gin(result);

CREATE UNIQUE INDEX unit_single_outstanding_allocation ON order_item_units(unit) WHERE outcome='out';

CREATE UNIQUE INDEX customer_single_held_nic ON orders(customer) WHERE "nicHeldAt" IS NOT NULL AND "nicReturnedAt" IS NULL;

CREATE TABLE data_migrations (name text PRIMARY KEY, summary jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now());
