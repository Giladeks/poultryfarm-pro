-- Migration: Add PaymentReminder table
-- Run with: npx prisma db execute --file migration_payment_reminder.sql --schema prisma/schema.prisma
-- Or paste directly into your DB client (psql / TablePlus / etc.)

CREATE TABLE IF NOT EXISTS "PaymentReminder" (
  "id"                 TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"           TEXT         NOT NULL,
  "invoiceType"        TEXT         NOT NULL,           -- 'SALES' | 'SUPPLIER'
  "salesInvoiceId"     TEXT,                            -- FK → SalesInvoice.id
  "supplierInvoiceId"  TEXT,                            -- FK → SupplierInvoice.id
  "sentById"           TEXT         NOT NULL,           -- FK → User.id
  "channel"            TEXT         NOT NULL DEFAULT 'IN_APP',  -- 'IN_APP' | 'EMAIL'
  "message"            TEXT         NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentReminder_pkey" PRIMARY KEY ("id")
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS "PaymentReminder_tenantId_idx"          ON "PaymentReminder" ("tenantId");
CREATE INDEX IF NOT EXISTS "PaymentReminder_salesInvoiceId_idx"    ON "PaymentReminder" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "PaymentReminder_supplierInvoiceId_idx" ON "PaymentReminder" ("supplierInvoiceId");
