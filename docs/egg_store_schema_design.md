# Egg Store Receipt & Inventory — Schema Design
## Phase 10-NEW · PoultryFarm Pro

---

## Overview

Two new tables bridge the gap between PM egg grading and store inventory:

```
eggProduction (APPROVED)
        │
        │  auto-created on PM approval
        ▼
egg_store_receipts  ──────────────────────────►  egg_inventory_balance
   (one per record)    on ACKNOWLEDGED /              (daily per pen)
                       FORCE_ACCEPTED
```

---

## 1. egg_store_receipts

### Purpose
One receipt per approved `eggProduction` record. Tracks the physical handover
of eggs from the pen to the store, including acknowledgement and dispute flow.

### Expected Prisma model shape (after `db pull`)

```prisma
model egg_store_receipts {
  id                   String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  tenantId             String
  eggProductionId      String    @unique
  penSectionId         String
  penId                String
  collectionDate       DateTime  @db.Date
  collectionSession    Int
  flockId              String
  batchCode            String

  // PM-graded counts (immutable after creation — source of truth)
  gradedGradeACrates   Int       @default(0)
  gradedGradeALoose    Int       @default(0)
  gradedGradeACount    Int       @default(0)
  gradedGradeBCrates   Int       @default(0)
  gradedGradeBLoose    Int       @default(0)
  gradedGradeBCount    Int       @default(0)
  gradedCrackedCount   Int       @default(0)
  gradedTotalEggs      Int

  // Delivery identity
  deliveredById        String?

  // Store acknowledgement
  acknowledgedById     String?
  acknowledgedAt       DateTime? @db.Timestamptz(6)

  // Status
  status               String    @default("PENDING")

  // Dispute fields
  disputeNotes         String?
  disputedById         String?
  disputedAt           DateTime? @db.Timestamptz(6)

  // Resolution fields
  resolvedById         String?
  resolvedAt           DateTime? @db.Timestamptz(6)
  resolutionAction     String?
  resolutionNotes      String?

  // Inventory impact
  inventoryUpdated     Boolean   @default(false)
  inventoryUpdatedAt   DateTime? @db.Timestamptz(6)

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([tenantId, status])
  @@index([penId, collectionDate, collectionSession])
  @@index([penSectionId, collectionDate(sort: Desc)])
  @@map("egg_store_receipts")
}
```

### Key design decisions

**Why denormalise graded counts?**
The store must see exactly what the PM verified, even if the `eggProduction`
record is later corrected (e.g. after a recount). Denormalising at receipt
creation time creates an immutable snapshot of the PM's graded figures.
This is the same pattern as `flock_transfers` denormalising `survivingCount`.

**Why store `penId` separately from `penSectionId`?**
The store card groups receipts by pen+session. Having `penId` directly on
the receipt avoids a join through `pen_sections` for every list query.

**Why `deliveredById` is nullable?**
Edge case: if a section has no active `penWorkerAssignment`, the physical
delivery person is unknown. The system records what it can without blocking.

**Why `inventoryUpdated` flag?**
Prevents double-counting if a receipt goes DISPUTED → FORCE_ACCEPTED.
The inventory update only fires once per receipt, guarded by this flag.

---

## 2. egg_inventory_balance

### Purpose
Daily stock snapshot per pen, maintained as a running balance.
Grade A, Grade B, and Cracked are tracked independently.

### Expected Prisma model shape (after `db pull`)

```prisma
model egg_inventory_balance {
  id                  String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  tenantId            String
  penId               String
  balanceDate         DateTime  @db.Date

  // Opening (carried from previous day closing)
  openingGradeA       Int       @default(0)
  openingGradeB       Int       @default(0)
  openingCracked      Int       @default(0)

  // Receipts (from acknowledged store receipts)
  receiptsGradeA      Int       @default(0)
  receiptsGradeB      Int       @default(0)
  receiptsCracked     Int       @default(0)

  // Sales deductions (Phase 10-NEW sales integration)
  salesGradeA         Int       @default(0)
  salesGradeB         Int       @default(0)
  salesCracked        Int       @default(0)

  // Manual adjustments
  adjustmentGradeA    Int       @default(0)
  adjustmentGradeB    Int       @default(0)
  adjustmentCracked   Int       @default(0)
  adjustmentNotes     String?

  // Closing balances (stored, not computed — immutable historical snapshot)
  closingGradeA       Int       @default(0)
  closingGradeB       Int       @default(0)
  closingCracked      Int       @default(0)

  // Generated columns (read-only in app)
  closingTotalEggs    Int
  receiptsTotalEggs   Int

  lastUpdatedById     String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  @@unique([tenantId, penId, balanceDate])
  @@index([tenantId, balanceDate(sort: Desc)])
  @@index([penId, balanceDate(sort: Desc)])
  @@map("egg_inventory_balance")
}
```

### Balance update logic (API server-side)

When a receipt is acknowledged or force-accepted:

```javascript
// Upsert today's balance row, incrementing receipt counts
await prisma.$executeRawUnsafe(`
  INSERT INTO egg_inventory_balance (
    id, "tenantId", "penId", "balanceDate",
    "openingGradeA", "openingGradeB", "openingCracked",
    "receiptsGradeA", "receiptsGradeB", "receiptsCracked",
    "closingGradeA", "closingGradeB", "closingCracked",
    "lastUpdatedById"
  )
  SELECT
    gen_random_uuid()::text,
    $1, $2, $3,
    -- Opening: yesterday's closing (or 0 if no prior row)
    COALESCE((
      SELECT "closingGradeA" FROM egg_inventory_balance
      WHERE "penId" = $2
        AND "balanceDate" = $3::date - INTERVAL '1 day'
      LIMIT 1
    ), 0),
    COALESCE((
      SELECT "closingGradeB" FROM egg_inventory_balance
      WHERE "penId" = $2
        AND "balanceDate" = $3::date - INTERVAL '1 day'
      LIMIT 1
    ), 0),
    COALESCE((
      SELECT "closingCracked" FROM egg_inventory_balance
      WHERE "penId" = $2
        AND "balanceDate" = $3::date - INTERVAL '1 day'
      LIMIT 1
    ), 0),
    -- Receipts
    $4, $5, $6,
    -- Closing = opening + receipts (sales/adjustments default 0 at creation)
    COALESCE(prev.closing_a, 0) + $4,
    COALESCE(prev.closing_b, 0) + $5,
    COALESCE(prev.closing_c, 0) + $6,
    $7
  FROM (
    SELECT
      COALESCE((SELECT "closingGradeA" FROM egg_inventory_balance
                WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day' LIMIT 1), 0) AS closing_a,
      COALESCE((SELECT "closingGradeB" FROM egg_inventory_balance
                WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day' LIMIT 1), 0) AS closing_b,
      COALESCE((SELECT "closingCracked" FROM egg_inventory_balance
                WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day' LIMIT 1), 0) AS closing_c
  ) prev
  ON CONFLICT ("tenantId", "penId", "balanceDate")
  DO UPDATE SET
    "receiptsGradeA"  = egg_inventory_balance."receiptsGradeA"  + EXCLUDED."receiptsGradeA",
    "receiptsGradeB"  = egg_inventory_balance."receiptsGradeB"  + EXCLUDED."receiptsGradeB",
    "receiptsCracked" = egg_inventory_balance."receiptsCracked" + EXCLUDED."receiptsCracked",
    "closingGradeA"   = egg_inventory_balance."openingGradeA"
                        + egg_inventory_balance."receiptsGradeA"  + EXCLUDED."receiptsGradeA"
                        - egg_inventory_balance."salesGradeA"
                        + egg_inventory_balance."adjustmentGradeA",
    "closingGradeB"   = egg_inventory_balance."openingGradeB"
                        + egg_inventory_balance."receiptsGradeB"  + EXCLUDED."receiptsGradeB"
                        - egg_inventory_balance."salesGradeB"
                        + egg_inventory_balance."adjustmentGradeB",
    "closingCracked"  = egg_inventory_balance."openingCracked"
                        + egg_inventory_balance."receiptsCracked" + EXCLUDED."receiptsCracked"
                        - egg_inventory_balance."salesCracked"
                        + egg_inventory_balance."adjustmentCracked",
    "lastUpdatedById" = EXCLUDED."lastUpdatedById",
    "updatedAt"       = NOW()
`, tenantId, penId, balanceDate, gradeACount, gradeBCount, crackedCount, userId);
```

---

## 3. Status state machine — egg_store_receipts

```
                    ┌─────────────────────────────────────┐
                    │           PM grades record           │
                    │   (eggProduction → APPROVED)         │
                    └──────────────┬──────────────────────┘
                                   │ auto-created
                                   ▼
                              ┌─────────┐
                              │ PENDING │  ← Store sees "Awaiting Receipt"
                              └────┬────┘
                    ┌──────────────┴──────────────┐
                    │                             │
               [Acknowledge]               [Dispute]
                    │                             │
                    ▼                             ▼
            ┌──────────────┐           ┌──────────────────┐
            │ ACKNOWLEDGED │           │    DISPUTED      │
            └──────┬───────┘           └────────┬─────────┘
                   │                            │
          inventory updated             IC/FM notified
                                               │
                            ┌──────────────────┴──────────────────┐
                            │                                     │
                    [Force Accept]                        [Recount Requested]
                            │                                     │
                            ▼                                     ▼
                  ┌──────────────────┐               ┌────────────────────────┐
                  │  FORCE_ACCEPTED  │               │  RECOUNT_REQUESTED     │
                  └──────┬───────────┘               └──────────┬─────────────┘
                         │                                      │
                inventory updated                    PM re-grades eggProduction
                                                     New receipt auto-created
                                                     (old receipt superseded)

  [Withdraw Dispute] — Store Manager only, from DISPUTED → PENDING
```

---

## 4. Auto-creation trigger (application-level, not DB trigger)

Receipts are created in the application layer, not via a DB trigger, to
maintain consistency with the project's pattern (see flock_transfers).

**Where to add:** `app/api/eggs/[id]/route.js` — inside `handleGrading()`,
after the `eggProduction.update()` call that sets `submissionStatus: 'APPROVED'`:

```javascript
// After PM grading sets submissionStatus → APPROVED:
// Auto-create the egg_store_receipt using $queryRawUnsafe
// (snake_case table — NEVER use prisma accessor directly)

const worker = await prisma.penWorkerAssignment.findFirst({
  where:  { penSectionId: record.penSectionId, isActive: true },
  select: { userId: true },
  orderBy: { assignedAt: 'desc' },
});

await prisma.$queryRawUnsafe(`
  INSERT INTO egg_store_receipts (
    "tenantId", "eggProductionId", "penSectionId", "penId",
    "collectionDate", "collectionSession", "flockId", "batchCode",
    "gradedGradeACrates", "gradedGradeALoose", "gradedGradeACount",
    "gradedGradeBCrates", "gradedGradeBLoose", "gradedGradeBCount",
    "gradedCrackedCount", "gradedTotalEggs",
    "deliveredById", "status"
  )
  SELECT
    $1, $2, $3,
    ps.pen_id,            -- resolve penId via pen_sections join
    $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13, $14, $15,
    $16, 'PENDING'
  FROM pen_sections ps
  WHERE ps.id = $3
  ON CONFLICT ("eggProductionId") DO NOTHING
`,
  tenantId,
  record.id,          // eggProductionId
  record.penSectionId,
  record.collectionDate,
  record.collectionSession,
  record.flockId,
  flock.batchCode,    // need to include in grading query
  gradeBCrates || 0,           // gradedGradeACrates is (cratesCollected - gradeBCrates)
  data.gradeBLoose || 0,       // gradedGradeALoose  is (looseEggs - gradeBLoose)
  gradeACount,                 // gradedGradeACount
  data.gradeBCrates || 0,
  data.gradeBLoose  || 0,
  gradeBCount,
  crackedConfirmed,
  totalEggs,
  worker?.userId || null       // deliveredById
);
```

**Note:** The `pen_sections` table uses `penId` (camelCase in Prisma, snake `pen_id`
in raw SQL — check your schema after `db pull` to confirm the column name).
Use `prisma.$queryRawUnsafe` as per project critical rule for snake_case tables.

---

## 5. Critical implementation rules

1. **Always use `$queryRawUnsafe`** for `egg_store_receipts` and
   `egg_inventory_balance` — snake_case tables, same rule as
   `flock_transfers`, `temperature_logs`, `weight_samples`.

2. **`egg_store_receipts.gradedGrade*` fields are immutable** after creation.
   Never update them, even after a recount. A recount creates a new
   `eggProduction` record → a new receipt supersedes the old one.

3. **`egg_inventory_balance` updates must be atomic** — use
   `prisma.$transaction` wrapping the raw SQL upsert and the
   `egg_store_receipts.inventoryUpdated = true` flag update together.
   This prevents partial updates if the server crashes mid-operation.

4. **Date boundaries** — use `Date.UTC(y, m, d)` when building `balanceDate`
   boundaries for range queries. Server runs WAT (UTC+1).

5. **`ON CONFLICT DO NOTHING`** on receipt auto-creation — idempotent.
   If PM grades the same record twice (edge case after override), the
   existing receipt is not overwritten.

---

## 6. API routes to build (next steps)

| Route | Method | Who | What |
|---|---|---|---|
| `/api/egg-store` | GET | Store Manager, Store Clerk, IC, FM+ | List receipts grouped by pen+session |
| `/api/egg-store/[id]` | PATCH | Store/IC/FM | Acknowledge / dispute / resolve |
| `/api/egg-store/inventory` | GET | Store Manager, IC, FM+ | Current balance per pen |
| `/api/egg-store/inventory/[penId]` | GET | Store Manager, IC, FM+ | Per-pen history |

---

## 7. Tracker update required

Move **Phase 10-NEW · Egg Handling & Inventory** from `new` to `active`.
Add a new sub-group "Store Receipt Acknowledgement (Phase 10-NEW-A)" with
the tasks above marked as the current sprint, distinguishing from the
full FIFO lot tracking which remains planned.
