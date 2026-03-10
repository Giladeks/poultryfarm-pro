-- migration_bank_transaction.sql
-- Run: npx prisma db execute --file migration_bank_transaction.sql --schema prisma/schema.prisma
-- Then: npx prisma generate

CREATE TABLE IF NOT EXISTS "bank_transactions" (
  "id"                        TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"                  TEXT          NOT NULL,
  "txDate"                    DATE          NOT NULL,
  "description"               TEXT          NOT NULL,
  "reference"                 TEXT,
  "amount"                    DECIMAL(14,2) NOT NULL,   -- positive = credit, negative = debit
  "currency"                  TEXT          NOT NULL DEFAULT 'NGN',
  "bankAccount"               TEXT,
  "source"                    TEXT          NOT NULL DEFAULT 'MANUAL',  -- MANUAL | CSV
  -- Match fields
  "matchedAt"                 TIMESTAMPTZ,
  "matchedById"               TEXT,
  "matchedSalesInvoiceId"     TEXT,
  "matchedSupplierInvoiceId"  TEXT,
  -- Metadata
  "createdById"               TEXT          NOT NULL,
  "createdAt"                 TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_transactions_matchedById_fkey"              FOREIGN KEY ("matchedById")              REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "bank_transactions_createdById_fkey"              FOREIGN KEY ("createdById")              REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "bank_transactions_matchedSalesInvoiceId_fkey"    FOREIGN KEY ("matchedSalesInvoiceId")    REFERENCES "sales_invoices"("id") ON DELETE SET NULL,
  CONSTRAINT "bank_transactions_matchedSupplierInvoiceId_fkey" FOREIGN KEY ("matchedSupplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "bank_transactions_tenantId_idx"       ON "bank_transactions" ("tenantId");
CREATE INDEX IF NOT EXISTS "bank_transactions_txDate_idx"         ON "bank_transactions" ("txDate");
CREATE INDEX IF NOT EXISTS "bank_transactions_matchedAt_idx"      ON "bank_transactions" ("matchedAt");
