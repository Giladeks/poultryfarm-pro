-- migration_feed_requisition_pen_level.sql
--
-- Adds pen-level grouping to feed_requisitions:
--   1. penId column  — the pen this requisition covers
--   2. sectionBreakdown column (JSONB) — per-section calculated quantities
--   3. Drop the old section/inventory/date unique constraint
--   4. Add new pen/inventory/date unique constraint (one req per pen per feed type per day)
--   5. Make penSectionId nullable (pen-level reqs span multiple sections)
--
-- Run: npx prisma db execute --file migration_feed_requisition_pen_level.sql
-- Then: npx prisma db pull && npx prisma generate
--       (or manually update schema.prisma — see note below)

-- ── 1. Add penId column ──────────────────────────────────────────────────────
ALTER TABLE "feed_requisitions"
  ADD COLUMN IF NOT EXISTS "penId" TEXT;

-- ── 2. Add sectionBreakdown column (JSONB) ───────────────────────────────────
-- Stores array of: { penSectionId, sectionName, flockId, batchCode, birdCount,
--                    avgConsumptionPerBirdG, calculatedQtyKg, requestedQtyKg,
--                    issuedQtyKg, acknowledgedQtyKg }
ALTER TABLE "feed_requisitions"
  ADD COLUMN IF NOT EXISTS "sectionBreakdown" JSONB;

-- ── 3. Drop old unique constraint (one per section/feedInventory/date) ────────
ALTER TABLE "feed_requisitions"
  DROP CONSTRAINT IF EXISTS "feed_requisitions_section_inventory_date_unique";

-- ── 4. Add new unique constraint (one per pen/feedInventory/date) ─────────────
ALTER TABLE "feed_requisitions"
  DROP CONSTRAINT IF EXISTS "feed_requisitions_pen_inventory_date_unique";

ALTER TABLE "feed_requisitions"
  ADD CONSTRAINT "feed_requisitions_pen_inventory_date_unique"
  UNIQUE ("penId", "feedInventoryId", "feedForDate");

-- ── 5. Make penSectionId nullable (pen-level reqs span all sections) ──────────
ALTER TABLE "feed_requisitions"
  ALTER COLUMN "penSectionId" DROP NOT NULL;

-- ── 6. Add index on penId for fast lookups ────────────────────────────────────
CREATE INDEX IF NOT EXISTS "feed_requisitions_pen_id_idx"
  ON "feed_requisitions" ("penId", "feedForDate" DESC);

-- ── schema.prisma changes needed after npx prisma db pull ────────────────────
-- In model FeedRequisition:
--   penSectionId   String?          (was String — now nullable)
--   penId          String?          (new field)
--   sectionBreakdown Json?          (new field)
--
--   Change @@unique: remove [penSectionId, feedInventoryId, feedForDate]
--   Add    @@unique([penId, feedInventoryId, feedForDate])
--   Change @@index: add @@index([penId, feedForDate(sort: Desc)])
--
--   Add relation: pen  Pen?  @relation(fields: [penId], references: [id])
--
-- In model Pen — add back-relation:
--   feedRequisitions  FeedRequisition[]
