-- migration_feed_requisition.sql
-- Adds FeedRequisition model and FeedRequisitionStatus enum
-- Run with: npx prisma db execute --file migration_feed_requisition.sql
-- Then: npx prisma generate

-- ── Enum ─────────────────────────────────────────────────────────────────────
CREATE TYPE "FeedRequisitionStatus" AS ENUM (
  'DRAFT',           -- system created, awaiting PM review
  'SUBMITTED',       -- PM confirmed and submitted to IC
  'APPROVED',        -- IC approved
  'REJECTED',        -- IC rejected, returned to PM for revision
  'ISSUED',          -- Store issued full quantity
  'ISSUED_PARTIAL',  -- Store issued partial quantity (stock shortage)
  'ACKNOWLEDGED',    -- PM confirmed receipt
  'DISCREPANCY',     -- PM acknowledged quantity differs from issued
  'CLOSED'           -- IC or Farm Manager closed the requisition
);

-- ── Table ─────────────────────────────────────────────────────────────────────
CREATE TABLE "feed_requisitions" (
  "id"                      TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"               TEXT        NOT NULL,
  "requisition_number"      TEXT        NOT NULL,   -- e.g. REQ-2026-00042, unique per tenant

  -- Context
  "pen_section_id"          TEXT        NOT NULL,
  "flock_id"                TEXT        NOT NULL,
  "feed_inventory_id"       TEXT        NOT NULL,
  "store_id"                TEXT,                   -- resolved from feedInventory on first touch
  "feed_for_date"           DATE        NOT NULL,   -- the date the feed is needed FOR (next day)
  "trigger_log_id"          TEXT,                   -- FeedConsumption.id that triggered this draft

  -- System calculation basis (computed at draft creation)
  "calculated_qty_kg"       DECIMAL(10,2) NOT NULL,
  "avg_consumption_per_bird_g" DECIMAL(8,4),        -- 7-day average grams/bird/day
  "current_bird_count"      INTEGER,
  "calculation_days"        INTEGER DEFAULT 7,       -- days of history used

  -- PM submission
  "requested_qty_kg"        DECIMAL(10,2),           -- PM's confirmed quantity
  "pm_notes"                TEXT,
  "submitted_by_id"         TEXT,
  "submitted_at"            TIMESTAMPTZ,
  "deviation_pct"           DECIMAL(6,2),            -- ((requested - calculated) / calculated) * 100

  -- IC approval
  "approved_qty_kg"         DECIMAL(10,2),           -- IC may reduce if excessive
  "ic_notes"                TEXT,
  "approved_by_id"          TEXT,
  "approved_at"             TIMESTAMPTZ,
  "rejection_reason"        TEXT,
  "rejected_by_id"          TEXT,
  "rejected_at"             TIMESTAMPTZ,

  -- Store issuance
  "issued_qty_kg"           DECIMAL(10,2),
  "issued_by_id"            TEXT,
  "issued_at"               TIMESTAMPTZ,
  "store_issuance_id"       TEXT,                    -- FK to store_issuances if created
  "issuance_notes"          TEXT,

  -- PM acknowledgement
  "acknowledged_qty_kg"     DECIMAL(10,2),
  "acknowledged_by_id"      TEXT,
  "acknowledged_at"         TIMESTAMPTZ,
  "discrepancy_qty_kg"      DECIMAL(10,2),           -- issued - acknowledged (auto-calculated)
  "acknowledgement_notes"   TEXT,

  -- Closure
  "closed_by_id"            TEXT,
  "closed_at"               TIMESTAMPTZ,
  "close_notes"             TEXT,

  "status"                  "FeedRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "feed_requisitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feed_requisitions_tenant_number_unique" UNIQUE ("tenant_id", "requisition_number"),

  -- One requisition per section per feed type per date (prevent duplicates)
  CONSTRAINT "feed_requisitions_section_inventory_date_unique"
    UNIQUE ("pen_section_id", "feed_inventory_id", "feed_for_date")
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX "feed_requisitions_tenant_status_idx"    ON "feed_requisitions" ("tenant_id", "status");
CREATE INDEX "feed_requisitions_pen_section_idx"      ON "feed_requisitions" ("pen_section_id", "feed_for_date" DESC);
CREATE INDEX "feed_requisitions_feed_inventory_idx"   ON "feed_requisitions" ("feed_inventory_id");
CREATE INDEX "feed_requisitions_submitted_by_idx"     ON "feed_requisitions" ("submitted_by_id");

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_feed_requisitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "feed_requisitions_updated_at_trigger"
  BEFORE UPDATE ON "feed_requisitions"
  FOR EACH ROW EXECUTE FUNCTION update_feed_requisitions_updated_at();

-- ── Sequence for requisition numbers ─────────────────────────────────────────
-- Requisition number format: REQ-YYYY-NNNNN (5-digit zero-padded per tenant)
-- Managed in application layer using MAX() + 1 per tenant per year to avoid
-- cross-schema sequence complexity.
