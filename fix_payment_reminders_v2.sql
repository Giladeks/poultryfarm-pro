-- Complete fix for payment_reminders table
-- Adds all columns that the current schema expects but the DB is missing
-- Safe to run multiple times (IF NOT EXISTS)

ALTER TABLE "payment_reminders"
  ADD COLUMN IF NOT EXISTS "tenantId"           TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceType"        TEXT,
  ADD COLUMN IF NOT EXISTS "salesInvoiceId"     TEXT,
  ADD COLUMN IF NOT EXISTS "supplierInvoiceId"  TEXT,
  ADD COLUMN IF NOT EXISTS "sentById"           TEXT,
  ADD COLUMN IF NOT EXISTS "channel"            TEXT NOT NULL DEFAULT 'IN_APP',
  ADD COLUMN IF NOT EXISTS "message"            TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Indexes
CREATE INDEX IF NOT EXISTS "payment_reminders_tenantId_idx"           ON "payment_reminders" ("tenantId");
CREATE INDEX IF NOT EXISTS "payment_reminders_invoiceType_salesId_idx" ON "payment_reminders" ("invoiceType", "salesInvoiceId");
CREATE INDEX IF NOT EXISTS "payment_reminders_invoiceType_suppId_idx"  ON "payment_reminders" ("invoiceType", "supplierInvoiceId");
