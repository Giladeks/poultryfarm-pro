-- Fix payment_reminders table: add missing columns
-- Run with: npx prisma db execute --file fix_payment_reminders.sql --schema prisma/schema.prisma

-- First, let's see what columns currently exist (optional - for your info)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_reminders';

-- Add missing columns if they don't already exist
ALTER TABLE "payment_reminders"
  ADD COLUMN IF NOT EXISTS "salesInvoiceId"    TEXT,
  ADD COLUMN IF NOT EXISTS "supplierInvoiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceType"       TEXT,
  ADD COLUMN IF NOT EXISTS "tenantId"          TEXT,
  ADD COLUMN IF NOT EXISTS "sentById"          TEXT,
  ADD COLUMN IF NOT EXISTS "channel"           TEXT NOT NULL DEFAULT 'IN_APP',
  ADD COLUMN IF NOT EXISTS "message"           TEXT;

-- Add indexes
CREATE INDEX IF NOT EXISTS "payment_reminders_salesInvoiceId_idx"    ON "payment_reminders" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "payment_reminders_supplierInvoiceId_idx" ON "payment_reminders" ("supplierInvoiceId");
CREATE INDEX IF NOT EXISTS "payment_reminders_tenantId_idx"          ON "payment_reminders" ("tenantId");
