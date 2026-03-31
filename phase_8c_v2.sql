-- =============================================================================
-- Phase 8C v2 — Brooding & Rearing Module Migration
-- Run in pgAdmin, then: npx prisma db pull && npx prisma generate
--
-- This supersedes phase_8c_brooding.sql (v1).
-- If you already ran v1, run the "IF NOT EXISTS" guards — they are safe to re-run.
-- =============================================================================

-- ── 1. FlockStage enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "FlockStage" AS ENUM ('BROODING', 'REARING', 'PRODUCTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. PenPurpose enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PenPurpose" AS ENUM ('BROODING', 'PRODUCTION', 'GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. ChickArrivalStatus enum (v1 compat) ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ChickArrivalStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- ALTER pens — add penPurpose
-- =============================================================================
ALTER TABLE "pens"
  ADD COLUMN IF NOT EXISTS "penPurpose" TEXT NOT NULL DEFAULT 'PRODUCTION';

-- All existing pens default to PRODUCTION — safe, no existing flock data breaks.
-- Farm admins can manually recategorise brooding pens after migration.

-- =============================================================================
-- ALTER flocks — add stage tracking columns
-- =============================================================================
ALTER TABLE "flocks"
  ADD COLUMN IF NOT EXISTS "stage"                TEXT NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN IF NOT EXISTS "stageUpdatedAt"        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "broodingEndDate"        DATE,
  ADD COLUMN IF NOT EXISTS "rearingStartDate"       DATE,
  ADD COLUMN IF NOT EXISTS "pointOfLayDate"         DATE,
  ADD COLUMN IF NOT EXISTS "originalPenSectionId"   TEXT;

-- Existing flocks are all in production — stamp stageUpdatedAt
UPDATE "flocks"
SET "stage" = 'PRODUCTION',
    "stageUpdatedAt" = NOW()
WHERE "stage" = 'PRODUCTION';  -- no-op but explicit

-- New flocks placed via the farm page should default to BROODING going forward.
-- The flock creation API is responsible for setting stage based on user input.
-- We do NOT change the column default here — the API will supply it explicitly.

-- Index for fast stage-scoped queries (brooding page, rearing page)
CREATE INDEX IF NOT EXISTS "flocks_stage_tenantId_idx"
  ON "flocks"("tenantId", "stage");

CREATE INDEX IF NOT EXISTS "flocks_stage_penSectionId_idx"
  ON "flocks"("penSectionId", "stage");

-- =============================================================================
-- CREATE chick_arrivals (v1 table — add doaCount + ensure flockId exists)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "chick_arrivals" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"        TEXT         NOT NULL,
  "penSectionId"    TEXT         NOT NULL,
  "flockId"         TEXT,
  "batchCode"       TEXT         NOT NULL,
  "arrivalDate"     DATE         NOT NULL,
  "chicksReceived"  INTEGER      NOT NULL,
  "doaCount"        INTEGER      NOT NULL DEFAULT 0,
  "supplier"        TEXT,
  "chickCostPerBird" DECIMAL(10,2),
  "currency"        TEXT         NOT NULL DEFAULT 'NGN',
  "status"          TEXT         NOT NULL DEFAULT 'ACTIVE',
  "transferDate"    DATE,
  "transferWeight"  DECIMAL(8,2),
  "survivingCount"  INTEGER,
  "notes"           TEXT,
  "createdById"     TEXT         NOT NULL,
  "createdAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "chick_arrivals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chick_arrivals_penSectionId_fkey"
    FOREIGN KEY ("penSectionId") REFERENCES "pen_sections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chick_arrivals_flockId_fkey"
    FOREIGN KEY ("flockId") REFERENCES "flocks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "chick_arrivals_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- If table already existed from v1, add the missing columns
ALTER TABLE "chick_arrivals"
  ADD COLUMN IF NOT EXISTS "doaCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "flockId"   TEXT;

-- Add FK if missing (safe with IF NOT EXISTS workaround via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chick_arrivals_flockId_fkey'
  ) THEN
    ALTER TABLE "chick_arrivals"
      ADD CONSTRAINT "chick_arrivals_flockId_fkey"
        FOREIGN KEY ("flockId") REFERENCES "flocks"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chick_arrivals_tenantId_idx"    ON "chick_arrivals"("tenantId");
CREATE INDEX IF NOT EXISTS "chick_arrivals_flockId_idx"     ON "chick_arrivals"("flockId");
CREATE INDEX IF NOT EXISTS "chick_arrivals_penSectionId_idx" ON "chick_arrivals"("penSectionId");
CREATE INDEX IF NOT EXISTS "chick_arrivals_status_idx"       ON "chick_arrivals"("status");

-- =============================================================================
-- CREATE temperature_logs (v1 table — idempotent)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "temperature_logs" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"        TEXT         NOT NULL,
  "chickArrivalId"  TEXT,
  "flockId"         TEXT,
  "penSectionId"    TEXT         NOT NULL,
  "loggedAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "zone"            TEXT         NOT NULL DEFAULT 'Zone A',
  "tempCelsius"     DECIMAL(5,2) NOT NULL,
  "humidity"        DECIMAL(5,2),
  "taskId"          TEXT,
  "loggedById"      TEXT         NOT NULL,
  "notes"           TEXT,
  "createdAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "temperature_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "temperature_logs_penSectionId_fkey"
    FOREIGN KEY ("penSectionId") REFERENCES "pen_sections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "temperature_logs_loggedById_fkey"
    FOREIGN KEY ("loggedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add flockId column to temperature_logs (not in v1)
ALTER TABLE "temperature_logs"
  ADD COLUMN IF NOT EXISTS "flockId" TEXT,
  ADD COLUMN IF NOT EXISTS "notes"   TEXT;

-- Make chickArrivalId nullable (was NOT NULL in v1 — now optional)
ALTER TABLE "temperature_logs"
  ALTER COLUMN "chickArrivalId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'temperature_logs_chickArrivalId_fkey'
  ) THEN
    ALTER TABLE "temperature_logs"
      ADD CONSTRAINT "temperature_logs_chickArrivalId_fkey"
        FOREIGN KEY ("chickArrivalId") REFERENCES "chick_arrivals"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "temperature_logs_tenantId_idx"       ON "temperature_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "temperature_logs_chickArrivalId_idx"  ON "temperature_logs"("chickArrivalId");
CREATE INDEX IF NOT EXISTS "temperature_logs_flockId_idx"         ON "temperature_logs"("flockId");
CREATE INDEX IF NOT EXISTS "temperature_logs_loggedAt_idx"        ON "temperature_logs"("loggedAt" DESC);

-- =============================================================================
-- CREATE flock_transfers — records each physical pen move
-- =============================================================================
CREATE TABLE IF NOT EXISTS "flock_transfers" (
  "id"                 TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"           TEXT         NOT NULL,
  "flockId"            TEXT         NOT NULL,
  "fromPenSectionId"   TEXT         NOT NULL,
  "toPenSectionId"     TEXT         NOT NULL,
  "transferDate"       DATE         NOT NULL,
  "fromStage"          TEXT         NOT NULL,  -- stage at time of transfer
  "toStage"            TEXT         NOT NULL,  -- stage after transfer (usually same)
  "survivingCount"     INTEGER      NOT NULL,
  "avgWeightAtTransferG" DECIMAL(8,2),
  "culledAtTransfer"   INTEGER      NOT NULL DEFAULT 0,
  "notes"              TEXT,
  "recordedById"       TEXT         NOT NULL,
  "createdAt"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "flock_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "flock_transfers_flockId_fkey"
    FOREIGN KEY ("flockId") REFERENCES "flocks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "flock_transfers_fromPenSectionId_fkey"
    FOREIGN KEY ("fromPenSectionId") REFERENCES "pen_sections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "flock_transfers_toPenSectionId_fkey"
    FOREIGN KEY ("toPenSectionId") REFERENCES "pen_sections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "flock_transfers_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "flock_transfers_tenantId_idx"   ON "flock_transfers"("tenantId");
CREATE INDEX IF NOT EXISTS "flock_transfers_flockId_idx"    ON "flock_transfers"("flockId");
CREATE INDEX IF NOT EXISTS "flock_transfers_transferDate_idx" ON "flock_transfers"("transferDate" DESC);

-- =============================================================================
-- updatedAt trigger for chick_arrivals
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "chick_arrivals_updated_at_trigger" ON "chick_arrivals";
CREATE TRIGGER "chick_arrivals_updated_at_trigger"
  BEFORE UPDATE ON "chick_arrivals"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- DONE
-- Next steps:
--   npx prisma db pull
--   npx prisma generate
--   Restart dev server
-- =============================================================================
