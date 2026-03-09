-- =============================================================================
-- PoultryFarm Pro — Phase 7 Migration
-- Internal Control + Accounts / Financials
-- Run once: npx prisma db execute --file migration_phase_7.sql --schema prisma/schema.prisma
-- =============================================================================

-- ── 1. Extend the UserRole enum ───────────────────────────────────────────────
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INTERNAL_CONTROL';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';

-- ── 2. Currency enum (extend if not already present) ─────────────────────────
-- Currency enum already exists from Phase 1 (NGN, USD, GBP, EUR, GHS, KES, ZAR)
-- No changes needed — multi-currency is already supported

-- ── 3. Investigation model ────────────────────────────────────────────────────
CREATE TYPE "InvestigationStatus" AS ENUM (
  'OPEN',
  'UNDER_REVIEW',
  'ESCALATED',
  'CLOSED'
);

CREATE TABLE IF NOT EXISTS "investigations" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"        TEXT        NOT NULL,
  "referenceType"   TEXT        NOT NULL,   -- EggProduction, StoreReceipt, etc.
  "referenceId"     TEXT        NOT NULL,
  "flaggedById"     TEXT        NOT NULL,   -- INTERNAL_CONTROL user
  "status"          "InvestigationStatus" NOT NULL DEFAULT 'OPEN',
  "flagReason"      TEXT        NOT NULL,
  "findings"        TEXT,
  "escalatedToId"   TEXT,                  -- CHAIRPERSON
  "escalatedAt"     TIMESTAMP,
  "resolvedById"    TEXT,
  "resolvedAt"      TIMESTAMP,
  "createdAt"       TIMESTAMP   NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT "investigations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "investigations_flaggedById_fkey"   FOREIGN KEY ("flaggedById")   REFERENCES "users"("id"),
  CONSTRAINT "investigations_escalatedToId_fkey" FOREIGN KEY ("escalatedToId") REFERENCES "users"("id"),
  CONSTRAINT "investigations_resolvedById_fkey"  FOREIGN KEY ("resolvedById")  REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "investigations_tenantId_idx"    ON "investigations"("tenantId");
CREATE INDEX IF NOT EXISTS "investigations_status_idx"      ON "investigations"("status");
CREATE INDEX IF NOT EXISTS "investigations_referenceId_idx" ON "investigations"("referenceId");

-- ── 4. Customer model (AR counterparty) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customers" (
  "id"                TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"          TEXT      NOT NULL,
  "name"              TEXT      NOT NULL,
  "contactName"       TEXT,
  "email"             TEXT,
  "phone"             TEXT,
  "address"           TEXT,
  "creditLimit"       DECIMAL(14,2),
  "paymentTermsDays"  INTEGER   NOT NULL DEFAULT 30,
  "isActive"          BOOLEAN   NOT NULL DEFAULT true,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customers_tenantId_idx" ON "customers"("tenantId");

-- ── 5. SalesInvoice model (AR) ────────────────────────────────────────────────
CREATE TYPE "InvoiceStatus" AS ENUM (
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID'
);

CREATE TABLE IF NOT EXISTS "sales_invoices" (
  "id"              TEXT            NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"        TEXT            NOT NULL,
  "invoiceNumber"   TEXT            NOT NULL,
  "customerId"      TEXT            NOT NULL,
  "flockId"         TEXT,                      -- optional: which flock produced the goods
  "farmId"          TEXT,
  "invoiceDate"     DATE            NOT NULL,
  "dueDate"         DATE            NOT NULL,
  "currency"        "Currency"      NOT NULL DEFAULT 'NGN',
  "exchangeRate"    DECIMAL(12,6)   NOT NULL DEFAULT 1.0,  -- rate to NGN
  "subtotal"        DECIMAL(14,2)   NOT NULL DEFAULT 0,
  "taxAmount"       DECIMAL(14,2)   NOT NULL DEFAULT 0,
  "totalAmount"     DECIMAL(14,2)   NOT NULL DEFAULT 0,
  "amountPaid"      DECIMAL(14,2)   NOT NULL DEFAULT 0,
  "status"          "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "lineItems"       JSONB           NOT NULL DEFAULT '[]',
  -- Payment
  "paidAt"          TIMESTAMP,
  "paymentRef"      TEXT,
  "paymentMethod"   TEXT,
  -- Bank reconciliation
  "reconciledAt"    TIMESTAMP,
  "reconciledById"  TEXT,
  -- Metadata
  "notes"           TEXT,
  "createdById"     TEXT            NOT NULL,
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP,
  "createdAt"       TIMESTAMP       NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP       NOT NULL DEFAULT NOW(),

  CONSTRAINT "sales_invoices_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoices_customerId_fkey" FOREIGN KEY ("customerId")     REFERENCES "customers"("id"),
  CONSTRAINT "sales_invoices_createdById_fkey" FOREIGN KEY ("createdById")   REFERENCES "users"("id"),
  CONSTRAINT "sales_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id"),
  CONSTRAINT "sales_invoices_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "users"("id"),
  CONSTRAINT "sales_invoices_tenantId_invoiceNumber_key" UNIQUE ("tenantId", "invoiceNumber")
);

CREATE INDEX IF NOT EXISTS "sales_invoices_tenantId_idx"  ON "sales_invoices"("tenantId");
CREATE INDEX IF NOT EXISTS "sales_invoices_status_idx"    ON "sales_invoices"("status");
CREATE INDEX IF NOT EXISTS "sales_invoices_dueDate_idx"   ON "sales_invoices"("dueDate");
CREATE INDEX IF NOT EXISTS "sales_invoices_customerId_idx" ON "sales_invoices"("customerId");

-- ── 6. SupplierInvoice model (AP) ─────────────────────────────────────────────
CREATE TYPE "SupplierInvoiceStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'DISPUTED',
  'VOID'
);

CREATE TABLE IF NOT EXISTS "supplier_invoices" (
  "id"              TEXT                    NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"        TEXT                    NOT NULL,
  "invoiceNumber"   TEXT                    NOT NULL,
  "supplierId"      TEXT                    NOT NULL,
  "linkedReceiptId" TEXT,                             -- ties to GRN/StoreReceipt
  "linkedPOId"      TEXT,                             -- ties to PurchaseOrder
  "invoiceDate"     DATE                    NOT NULL,
  "dueDate"         DATE                    NOT NULL,
  "currency"        "Currency"              NOT NULL DEFAULT 'NGN',
  "exchangeRate"    DECIMAL(12,6)           NOT NULL DEFAULT 1.0,
  "subtotal"        DECIMAL(14,2)           NOT NULL DEFAULT 0,
  "taxAmount"       DECIMAL(14,2)           NOT NULL DEFAULT 0,
  "totalAmount"     DECIMAL(14,2)           NOT NULL DEFAULT 0,
  "amountPaid"      DECIMAL(14,2)           NOT NULL DEFAULT 0,
  "status"          "SupplierInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "lineItems"       JSONB                   NOT NULL DEFAULT '[]',
  -- Payment
  "paidAt"          TIMESTAMP,
  "paymentRef"      TEXT,
  "paymentMethod"   TEXT,
  -- Approval
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP,
  -- Bank reconciliation
  "reconciledAt"    TIMESTAMP,
  "reconciledById"  TEXT,
  -- Metadata
  "notes"           TEXT,
  "createdById"     TEXT                    NOT NULL,
  "createdAt"       TIMESTAMP               NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP               NOT NULL DEFAULT NOW(),

  CONSTRAINT "supplier_invoices_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "supplier_invoices_supplierId_fkey"   FOREIGN KEY ("supplierId")   REFERENCES "suppliers"("id"),
  CONSTRAINT "supplier_invoices_createdById_fkey"  FOREIGN KEY ("createdById")  REFERENCES "users"("id"),
  CONSTRAINT "supplier_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id"),
  CONSTRAINT "supplier_invoices_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "users"("id"),
  CONSTRAINT "supplier_invoices_tenantId_invoiceNumber_key" UNIQUE ("tenantId", "invoiceNumber")
);

CREATE INDEX IF NOT EXISTS "supplier_invoices_tenantId_idx"  ON "supplier_invoices"("tenantId");
CREATE INDEX IF NOT EXISTS "supplier_invoices_status_idx"    ON "supplier_invoices"("status");
CREATE INDEX IF NOT EXISTS "supplier_invoices_dueDate_idx"   ON "supplier_invoices"("dueDate");
CREATE INDEX IF NOT EXISTS "supplier_invoices_supplierId_idx" ON "supplier_invoices"("supplierId");

-- ── 7. PaymentReminder model ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_reminders" (
  "id"              TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"        TEXT      NOT NULL,
  "invoiceType"     TEXT      NOT NULL,   -- 'SALES' | 'SUPPLIER'
  "invoiceId"       TEXT      NOT NULL,
  "sentAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
  "sentById"        TEXT      NOT NULL,
  "channel"         TEXT      NOT NULL,   -- 'EMAIL' | 'IN_APP'
  "message"         TEXT,

  CONSTRAINT "payment_reminders_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "payment_reminders_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "payment_reminders_invoiceId_idx" ON "payment_reminders"("invoiceId");

-- =============================================================================
-- Done. Now update prisma/schema.prisma manually (see instructions).
-- Then run: npx prisma generate
-- =============================================================================
