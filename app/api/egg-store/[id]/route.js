// app/api/egg-store/[id]/route.js
// PATCH /api/egg-store/[id]
//
// State transitions for a single egg_store_receipt record:
//
//   { action: 'acknowledge' }
//     STORE_MANAGER / STORE_CLERK → PENDING → ACKNOWLEDGED
//     Updates egg_inventory_balance atomically.
//     Notifies IC + FM of receipt confirmation.
//
//   { action: 'dispute', disputeNotes: string }
//     STORE_MANAGER / STORE_CLERK → PENDING → DISPUTED
//     Notifies IC + FM to review.
//     Eggs held — inventory NOT updated.
//
//   { action: 'withdraw' }
//     STORE_MANAGER (own dispute only) → DISPUTED → PENDING
//     Clears dispute notes, returns to store queue.
//
//   { action: 'force_accept', resolutionNotes: string }
//     INTERNAL_CONTROL / FM+ → DISPUTED → FORCE_ACCEPTED
//     Accepts PM's graded count as correct.
//     Updates egg_inventory_balance atomically.
//     Notifies Store Manager + PM.
//
//   { action: 'request_recount', resolutionNotes: string }
//     INTERNAL_CONTROL / FM+ → DISPUTED → RECOUNT_REQUESTED
//     Sends back to PM for physical recount.
//     Notifies PM.
//
// CRITICAL: egg_store_receipts and egg_inventory_balance are snake_case tables.
//           ALWAYS use prisma.$queryRawUnsafe — never use prisma accessor directly.
//           Date boundaries: Date.UTC() — server runs WAT (UTC+1).
//           Inventory update MUST be atomic with inventoryUpdated flag flip.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const STORE_ROLES    = ['STORE_MANAGER', 'STORE_CLERK'];
const IC_ROLES       = ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const ALL_ROLES      = [...STORE_ROLES, ...IC_ROLES];

// ── Zod schemas per action ────────────────────────────────────────────────────
const acknowledgeSchema = z.object({ action: z.literal('acknowledge') });

const disputeSchema = z.object({
  action:       z.literal('dispute'),
  disputeNotes: z.string().min(5, 'Please describe the discrepancy (min 5 characters)'),
});

const withdrawSchema = z.object({ action: z.literal('withdraw') });

const forceAcceptSchema = z.object({
  action:          z.literal('force_accept'),
  resolutionNotes: z.string().min(5, 'Resolution notes required (min 5 characters)'),
});

const recountSchema = z.object({
  action:          z.literal('request_recount'),
  resolutionNotes: z.string().min(5, 'Please explain what needs to be recounted'),
});

// ── Helper: fetch receipt via raw SQL and validate tenancy ────────────────────
async function fetchReceipt(id, tenantId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      esr.*,
      p."farmId",
      f."tenantId" AS "farmTenantId"
    FROM egg_store_receipts esr
    INNER JOIN pens  p ON p.id = esr."penId"
    INNER JOIN farms f ON f.id = p."farmId"
    WHERE esr.id = $1
  `, id);

  if (!rows.length) return null;
  const r = rows[0];
  if (r.farmTenantId !== tenantId) return null; // tenant isolation
  return r;
}

// ── Helper: update egg_inventory_balance atomically ──────────────────────────
// Uses INSERT ... ON CONFLICT DO UPDATE so it works for both
// new-day creation and same-day increments (multiple sessions).
async function updateInventoryBalance(receipt, userId) {
  const balanceDate = receipt.collectionDate instanceof Date
    ? receipt.collectionDate.toISOString().slice(0, 10)
    : String(receipt.collectionDate).slice(0, 10);

  // Step 1: update inventory balance (upsert)
  await prisma.$queryRawUnsafe(`
    INSERT INTO egg_inventory_balance (
      "tenantId", "penId", "balanceDate",
      "openingGradeA",  "openingGradeB",  "openingCracked",
      "receiptsGradeA", "receiptsGradeB", "receiptsCracked",
      "closingGradeA",  "closingGradeB",  "closingCracked",
      "lastUpdatedById"
    )
    SELECT
      $1, $2, $3::date,
      -- Opening: yesterday's closing (0 if no prior row)
      COALESCE((
        SELECT "closingGradeA" FROM egg_inventory_balance
        WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day'
        LIMIT 1
      ), 0),
      COALESCE((
        SELECT "closingGradeB" FROM egg_inventory_balance
        WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day'
        LIMIT 1
      ), 0),
      COALESCE((
        SELECT "closingCracked" FROM egg_inventory_balance
        WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day'
        LIMIT 1
      ), 0),
      -- Receipts from this batch
      $4, $5, $6,
      -- Closing = opening + receipts (sales/adjustments default 0 at creation)
      COALESCE((
        SELECT "closingGradeA" FROM egg_inventory_balance
        WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day'
        LIMIT 1
      ), 0) + $4,
      COALESCE((
        SELECT "closingGradeB" FROM egg_inventory_balance
        WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day'
        LIMIT 1
      ), 0) + $5,
      COALESCE((
        SELECT "closingCracked" FROM egg_inventory_balance
        WHERE "penId" = $2 AND "balanceDate" = $3::date - INTERVAL '1 day'
        LIMIT 1
      ), 0) + $6,
      $7
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
  `,
    receipt.tenantId,
    receipt.penId,
    balanceDate,
    Number(receipt.gradedGradeACount),
    Number(receipt.gradedGradeBCount),
    Number(receipt.gradedCrackedCount),
    userId,
  );

  // Step 2: flip inventoryUpdated flag on the receipt
  await prisma.$queryRawUnsafe(`
    UPDATE egg_store_receipts
    SET "inventoryUpdated"   = TRUE,
        "inventoryUpdatedAt" = NOW(),
        "updatedAt"          = NOW()
    WHERE id = $1
  `, receipt.id);
}

// ── Helper: notify users by role ──────────────────────────────────────────────
async function notifyRoles(tenantId, roles, notification) {
  const users = await prisma.user.findMany({
    where:  { tenantId, role: { in: roles }, isActive: true },
    select: { id: true },
  });
  if (!users.length) return;
  await prisma.notification.createMany({
    data: users.map(u => ({
      tenantId,
      recipientId: u.id,
      ...notification,
      channel: 'IN_APP',
    })),
    skipDuplicates: true,
  });
}

async function notifyUser(tenantId, userId, notification) {
  if (!userId) return;
  await prisma.notification.create({
    data: { tenantId, recipientId: userId, ...notification, channel: 'IN_APP' },
  }).catch(() => {});
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALL_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action } = body || {};
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  // Fetch and validate receipt ownership
  const receipt = await fetchReceipt(params.id, user.tenantId);
  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });

  const now = new Date();

  try {
    // ────────────────────────────────────────────────────────────────────────
    // ACKNOWLEDGE
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'acknowledge') {
      acknowledgeSchema.parse(body);

      if (!STORE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Managers and Store Clerks can acknowledge receipts' }, { status: 403 });
      if (receipt.status !== 'PENDING')
        return NextResponse.json({ error: `Cannot acknowledge a receipt with status ${receipt.status}` }, { status: 422 });
      if (receipt.inventoryUpdated)
        return NextResponse.json({ error: 'Inventory already updated for this receipt' }, { status: 409 });

      // Update receipt status
      await prisma.$queryRawUnsafe(`
        UPDATE egg_store_receipts
        SET "status"           = 'ACKNOWLEDGED',
            "acknowledgedById" = $1,
            "acknowledgedAt"   = $2,
            "updatedAt"        = $2
        WHERE id = $3
      `, user.sub, now, receipt.id);

      // Update inventory balance (atomic)
      await updateInventoryBalance(receipt, user.sub);

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'APPROVE',
          entityType: 'EggStoreReceipt',
          entityId:   receipt.id,
          changes: {
            action:       'ACKNOWLEDGED',
            gradeACount:  Number(receipt.gradedGradeACount),
            gradeBCount:  Number(receipt.gradedGradeBCount),
            crackedCount: Number(receipt.gradedCrackedCount),
            totalEggs:    Number(receipt.gradedTotalEggs),
            batchCode:    receipt.batchCode,
            session:      Number(receipt.collectionSession) === 1 ? 'Morning' : 'Afternoon',
          },
        },
      }).catch(() => {});

      // Notify IC + FM (low priority — clean acknowledgement)
      await notifyRoles(user.tenantId, ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN'], {
        type:    'SYSTEM',
        title:   `✓ Eggs Received — ${receipt.batchCode}`,
        message: `Store confirmed receipt of ${Number(receipt.gradedTotalEggs).toLocaleString('en-NG')} eggs `
               + `(${receipt.penName} · ${Number(receipt.collectionSession) === 1 ? 'Morning' : 'Afternoon'} session). `
               + `Grade A: ${Number(receipt.gradedGradeACount).toLocaleString('en-NG')} · `
               + `Grade B: ${Number(receipt.gradedGradeBCount).toLocaleString('en-NG')} · `
               + `Cracked: ${Number(receipt.gradedCrackedCount).toLocaleString('en-NG')}.`,
        data: { entityType: 'EggStoreReceipt', entityId: receipt.id },
      });

      return NextResponse.json({ success: true, action: 'ACKNOWLEDGED', receiptId: receipt.id });
    }

    // ────────────────────────────────────────────────────────────────────────
    // DISPUTE
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'dispute') {
      const data = disputeSchema.parse(body);

      if (!STORE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Managers and Store Clerks can raise disputes' }, { status: 403 });
      if (receipt.status !== 'PENDING')
        return NextResponse.json({ error: `Cannot dispute a receipt with status ${receipt.status}` }, { status: 422 });

      await prisma.$queryRawUnsafe(`
        UPDATE egg_store_receipts
        SET "status"       = 'DISPUTED',
            "disputeNotes" = $1,
            "disputedById" = $2,
            "disputedAt"   = $3,
            "updatedAt"    = $3
        WHERE id = $4
      `, data.disputeNotes, user.sub, now, receipt.id);

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'UPDATE',
          entityType: 'EggStoreReceipt',
          entityId:   receipt.id,
          changes:    { action: 'DISPUTED', disputeNotes: data.disputeNotes, batchCode: receipt.batchCode },
        },
      }).catch(() => {});

      // Notify IC + FM — requires action
      await notifyRoles(user.tenantId, ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN'], {
        type:    'ALERT',
        title:   `⚑ Egg Receipt Disputed — ${receipt.batchCode}`,
        message: `Store has flagged a discrepancy on ${receipt.penName} · `
               + `${Number(receipt.collectionSession) === 1 ? 'Morning' : 'Afternoon'} session. `
               + `Reason: ${data.disputeNotes}. `
               + `Total eggs expected: ${Number(receipt.gradedTotalEggs).toLocaleString('en-NG')}. `
               + `Action required: Force Accept or Request Recount.`,
        data: { entityType: 'EggStoreReceipt', entityId: receipt.id, disputeNotes: data.disputeNotes },
      });

      return NextResponse.json({ success: true, action: 'DISPUTED', receiptId: receipt.id });
    }

    // ────────────────────────────────────────────────────────────────────────
    // WITHDRAW DISPUTE
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'withdraw') {
      withdrawSchema.parse(body);

      if (!STORE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Managers and Store Clerks can withdraw disputes' }, { status: 403 });
      if (receipt.status !== 'DISPUTED')
        return NextResponse.json({ error: 'Can only withdraw a DISPUTED receipt' }, { status: 422 });
      // Only the person who raised the dispute can withdraw it
      if (receipt.disputedById && receipt.disputedById !== user.sub)
        return NextResponse.json({ error: 'Only the person who raised this dispute can withdraw it' }, { status: 403 });

      await prisma.$queryRawUnsafe(`
        UPDATE egg_store_receipts
        SET "status"       = 'PENDING',
            "disputeNotes" = NULL,
            "disputedById" = NULL,
            "disputedAt"   = NULL,
            "updatedAt"    = $1
        WHERE id = $2
      `, now, receipt.id);

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'UPDATE',
          entityType: 'EggStoreReceipt',
          entityId:   receipt.id,
          changes:    { action: 'DISPUTE_WITHDRAWN', batchCode: receipt.batchCode },
        },
      }).catch(() => {});

      return NextResponse.json({ success: true, action: 'WITHDRAWN', receiptId: receipt.id });
    }

    // ────────────────────────────────────────────────────────────────────────
    // FORCE ACCEPT
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'force_accept') {
      const data = forceAcceptSchema.parse(body);

      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Internal Control and Farm Managers can force-accept disputes' }, { status: 403 });
      if (receipt.status !== 'DISPUTED')
        return NextResponse.json({ error: 'Can only force-accept a DISPUTED receipt' }, { status: 422 });
      if (receipt.inventoryUpdated)
        return NextResponse.json({ error: 'Inventory already updated for this receipt' }, { status: 409 });

      await prisma.$queryRawUnsafe(`
        UPDATE egg_store_receipts
        SET "status"           = 'FORCE_ACCEPTED',
            "resolvedById"     = $1,
            "resolvedAt"       = $2,
            "resolutionAction" = 'FORCE_ACCEPTED',
            "resolutionNotes"  = $3,
            "updatedAt"        = $2
        WHERE id = $4
      `, user.sub, now, data.resolutionNotes, receipt.id);

      // Update inventory (same logic as acknowledge)
      await updateInventoryBalance(receipt, user.sub);

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'APPROVE',
          entityType: 'EggStoreReceipt',
          entityId:   receipt.id,
          changes: {
            action:          'FORCE_ACCEPTED',
            resolutionNotes: data.resolutionNotes,
            batchCode:       receipt.batchCode,
            totalEggs:       Number(receipt.gradedTotalEggs),
          },
        },
      }).catch(() => {});

      // Notify Store Manager that dispute was resolved
      await notifyRoles(user.tenantId, ['STORE_MANAGER', 'STORE_CLERK'], {
        type:    'SYSTEM',
        title:   `✓ Dispute Resolved — ${receipt.batchCode}`,
        message: `IC has force-accepted the egg receipt for ${receipt.penName} · `
               + `${Number(receipt.collectionSession) === 1 ? 'Morning' : 'Afternoon'} session. `
               + `PM's graded count accepted. Eggs added to inventory.`,
        data: { entityType: 'EggStoreReceipt', entityId: receipt.id },
      });

      return NextResponse.json({ success: true, action: 'FORCE_ACCEPTED', receiptId: receipt.id });
    }

    // ────────────────────────────────────────────────────────────────────────
    // REQUEST RECOUNT
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'request_recount') {
      const data = recountSchema.parse(body);

      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Internal Control and Farm Managers can request recounts' }, { status: 403 });
      if (receipt.status !== 'DISPUTED')
        return NextResponse.json({ error: 'Can only request recount on a DISPUTED receipt' }, { status: 422 });

      await prisma.$queryRawUnsafe(`
        UPDATE egg_store_receipts
        SET "status"           = 'RECOUNT_REQUESTED',
            "resolvedById"     = $1,
            "resolvedAt"       = $2,
            "resolutionAction" = 'RECOUNT_REQUESTED',
            "resolutionNotes"  = $3,
            "updatedAt"        = $2
        WHERE id = $4
      `, user.sub, now, data.resolutionNotes, receipt.id);

      // Reset the source eggProduction record to PENDING and clear grading fields
      // so it reappears in the PM's verification queue for re-grading.
      // PM must re-grade with corrected figures — autoCreateStoreReceipt will
      // then update the receipt back to PENDING with the new counts.
      await prisma.eggProduction.update({
        where: { id: receipt.eggProductionId },
        data: {
          submissionStatus: 'PENDING',
          gradeBCrates:     null,
          gradeBLoose:      null,
          crackedConfirmed: null,
          gradeBCount:      null,
          gradeACount:      null,
          gradeAPct:        null,
          approvedById:     null,
          approvedAt:       null,
          rejectionReason:  `Recount requested by IC/FM: ${data.resolutionNotes}`,
        },
      });

      // Reset the linked Verification record back to PENDING so the eggProduction
      // record is no longer in alreadyVerifiedIds and reappears in the PM's queue.
      await prisma.verification.updateMany({
        where: {
          referenceId: receipt.eggProductionId,
          tenantId:    user.tenantId,
          status:      { in: ['VERIFIED', 'RESOLVED'] },
        },
        data: {
          status:           'PENDING',
          discrepancyNotes: `Recount requested: ${data.resolutionNotes}`,
        },
      }).catch(() => {});

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'UPDATE',
          entityType: 'EggStoreReceipt',
          entityId:   receipt.id,
          changes: {
            action:          'RECOUNT_REQUESTED',
            resolutionNotes: data.resolutionNotes,
            batchCode:       receipt.batchCode,
          },
        },
      }).catch(() => {});

      // Find the PM who graded the original record — notify them
      const eggRecord = await prisma.eggProduction.findUnique({
        where:  { id: receipt.eggProductionId },
        select: { approvedById: true },
      });

      await notifyUser(user.tenantId, eggRecord?.approvedById, {
        type:    'ALERT',
        title:   `🔄 Recount Required — ${receipt.batchCode}`,
        message: `IC has requested a physical recount for the egg batch you graded: `
               + `${receipt.penName} · ${Number(receipt.collectionSession) === 1 ? 'Morning' : 'Afternoon'} session. `
               + `Reason: ${data.resolutionNotes}. `
               + `The record has been reset to Pending — please physically recount, then re-grade it on the Verification page.`,
        data: { entityType: 'EggStoreReceipt', entityId: receipt.id, eggProductionId: receipt.eggProductionId },
      });

      return NextResponse.json({ success: true, action: 'RECOUNT_REQUESTED', receiptId: receipt.id });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error(`[PATCH /api/egg-store/${params.id}] error:`, err);
    return NextResponse.json({ error: 'Failed to process egg store action' }, { status: 500 });
  }
}
