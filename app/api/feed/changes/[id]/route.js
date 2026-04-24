// app/api/feed/changes/[id]/route.js
// Phase 8H — Feed Change Request: detail + all status transitions
// PATCH body: { action: 'submit'|'approve'|'reject'|'execute'|'acknowledge'|'cancel', ...fields }
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const FM_ROLES  = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const SM_ROLES  = ['STORE_MANAGER'];
const PM_ROLES  = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const ALL_ROLES = [...new Set([...FM_ROLES,...SM_ROLES,...PM_ROLES,'INTERNAL_CONTROL'])];

// ── Enrich (same as list route — keep in sync) ────────────────────────────────
async function enrich(raw) {
  if (!raw) return null;
  const ids = [...new Set([
    raw.requestedById, raw.approvedById, raw.rejectedById,
    raw.executedById,  raw.acknowledgedById,
  ].filter(Boolean))];

  const [fromInv, toInv, section, flock, users] = await Promise.all([
    prisma.feedInventory.findUnique({
      where:  { id: raw.fromFeedInventoryId },
      select: { id: true, feedType: true, bagWeightKg: true, currentStockKg: true },
    }),
    prisma.feedInventory.findUnique({
      where:  { id: raw.toFeedInventoryId },
      select: { id: true, feedType: true, bagWeightKg: true, currentStockKg: true },
    }),
    prisma.penSection.findUnique({
      where:  { id: raw.penSectionId },
      select: { id: true, name: true, pen: { select: { name: true } } },
    }),
    prisma.flock.findUnique({
      where:  { id: raw.flockId },
      select: { id: true, batchCode: true, operationType: true, stage: true },
    }),
    ids.length ? prisma.user.findMany({
      where:  { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, role: true },
    }) : Promise.resolve([]),
  ]);

  const um = Object.fromEntries(users.map(u => [u.id, u]));
  return {
    ...raw,
    fromFeedInventory: fromInv,
    toFeedInventory:   toInv,
    penSection:        section,
    flock,
    requestedBy:       um[raw.requestedById]    ?? null,
    approvedBy:        um[raw.approvedById]     ?? null,
    rejectedBy:        um[raw.rejectedById]     ?? null,
    executedBy:        um[raw.executedById]     ?? null,
    acknowledgedBy:    um[raw.acknowledgedById] ?? null,
  };
}

async function notifyUsers(tenantId, recipientIds, { title, message, type = 'SYSTEM', senderId, data = {} }) {
  const ids = [...new Set(recipientIds.filter(Boolean))];
  await Promise.all(ids.map(id =>
    prisma.notification.create({
      data: { tenantId, recipientId: id, senderId, type, title, message, channel: 'IN_APP', data },
    }).catch(() => {})
  ));
}

// ── GET /api/feed/changes/[id] ────────────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALL_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const raw = await prisma.feedChangeRequest.findFirst({
    where: { id: params.id, tenantId: user.tenantId },
  });
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ change: await enrich(raw) });
}

// ── PATCH /api/feed/changes/[id] ──────────────────────────────────────────────
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALL_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const action = body.action;
    if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

    let req = await prisma.feedChangeRequest.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const now = new Date();

    // ── SUBMIT (PM) ──────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (!PM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Pen Managers can submit feed change requests' }, { status: 403 });
      if (req.status !== 'DRAFT')
        return NextResponse.json({ error: `Cannot submit from ${req.status} status` }, { status: 422 });

      req = await prisma.feedChangeRequest.update({
        where: { id: req.id },
        data: { status: 'SUBMITTED', submittedAt: now },
      });

      // Notify FM+ for approval
      const fms = await prisma.user.findMany({
        where: { tenantId: user.tenantId, isActive: true, role: { in: FM_ROLES } },
        select: { id: true },
      });
      await notifyUsers(user.tenantId, fms.map(f => f.id), {
        senderId: user.sub,
        title:    `📋 Feed Change Request — Approval Needed`,
        message:  `A feed change request for ${req.penSectionId} requires your approval. ` +
                  `Reason: ${req.reason?.replace(/_/g,' ')}. Effective: ${new Date(req.effectiveDate).toLocaleDateString('en-NG')}.`,
        type:     'REPORT_SUBMITTED',
        data:     { feedChangeId: req.id, action: 'SUBMITTED' },
      });

      return NextResponse.json({ change: await enrich(req) });
    }

    // ── APPROVE (FM) ─────────────────────────────────────────────────────────
    if (action === 'approve') {
      if (!FM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Farm Managers can approve feed change requests' }, { status: 403 });
      if (req.status !== 'SUBMITTED')
        return NextResponse.json({ error: `Cannot approve from ${req.status} status` }, { status: 422 });

      const { fmNotes } = z.object({ fmNotes: z.string().max(500).optional() }).parse(body);

      req = await prisma.feedChangeRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', approvedById: user.sub, approvedAt: now, fmNotes: fmNotes || null },
      });

      // Notify SM to execute
      const sms = await prisma.user.findMany({
        where: { tenantId: user.tenantId, isActive: true, role: { in: SM_ROLES } },
        select: { id: true },
      });
      await notifyUsers(user.tenantId, sms.map(s => s.id), {
        senderId: user.sub,
        title:    `📦 Feed Change — Ready to Execute`,
        message:  `FM has approved a feed change request. Please process the return of old feed and issue the new feed type.`,
        type:     'SYSTEM',
        data:     { feedChangeId: req.id, action: 'APPROVED' },
      });
      // Also notify PM
      await notifyUsers(user.tenantId, [req.requestedById], {
        senderId: user.sub,
        title:    `✅ Feed Change Approved`,
        message:  `Your feed change request has been approved by the Farm Manager. The Store Manager will process the feed exchange.`,
        type:     'SYSTEM',
        data:     { feedChangeId: req.id, action: 'APPROVED' },
      });

      return NextResponse.json({ change: await enrich(req) });
    }

    // ── REJECT (FM) ──────────────────────────────────────────────────────────
    if (action === 'reject') {
      if (!FM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Farm Managers can reject feed change requests' }, { status: 403 });
      if (req.status !== 'SUBMITTED')
        return NextResponse.json({ error: `Cannot reject from ${req.status} status` }, { status: 422 });

      const { fmNotes } = z.object({ fmNotes: z.string().min(1).max(500) }).parse(body);

      req = await prisma.feedChangeRequest.update({
        where: { id: req.id },
        data: { status: 'REJECTED', rejectedById: user.sub, rejectedAt: now, fmNotes },
      });

      await notifyUsers(user.tenantId, [req.requestedById], {
        senderId: user.sub,
        title:    `↩️ Feed Change Request Rejected`,
        message:  `Your feed change request was rejected. Reason: ${fmNotes}`,
        type:     'SYSTEM',
        data:     { feedChangeId: req.id, action: 'REJECTED' },
      });

      return NextResponse.json({ change: await enrich(req) });
    }

    // ── EXECUTE (SM) — confirm return + issue new feed ────────────────────────
    if (action === 'execute') {
      if (!SM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Managers can execute feed changes' }, { status: 403 });
      if (req.status !== 'APPROVED')
        return NextResponse.json({ error: `Cannot execute from ${req.status} status` }, { status: 422 });

      const exSchema = z.object({
        returnedActualKg: z.number().min(0),
        issuedQtyKg:      z.number().positive(),
        issuedBags:       z.number().int().positive(),
        smNotes:          z.string().max(500).optional(),
      });
      const ed = exSchema.parse(body);

      // Verify sufficient stock of new feed
      const toInv = await prisma.feedInventory.findUnique({ where: { id: req.toFeedInventoryId } });
      if (!toInv)
        return NextResponse.json({ error: 'Target feed inventory not found' }, { status: 404 });
      if (Number(toInv.currentStockKg) < ed.issuedQtyKg)
        return NextResponse.json({
          error: `Insufficient stock of new feed. Available: ${Number(toInv.currentStockKg).toFixed(1)} kg`,
        }, { status: 422 });

      const today = new Date();
      const todayDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

      // Atomic transaction:
      // 1. Credit old feed inventory (return)
      // 2. Debit new feed inventory (issuance)
      // 3. Create StoreReceipt for the return
      // 4. Create StoreIssuance for the new feed
      // 5. Update FeedChangeRequest status
      const [_oldInv, _newInv, returnReceipt, newIssuance, updated] = await prisma.$transaction([
        // Credit old feed back
        prisma.feedInventory.update({
          where: { id: req.fromFeedInventoryId },
          data:  { currentStockKg: { increment: ed.returnedActualKg } },
        }),
        // Debit new feed
        prisma.feedInventory.update({
          where: { id: req.toFeedInventoryId },
          data:  { currentStockKg: { decrement: ed.issuedQtyKg } },
        }),
        // StoreReceipt for the return (isReturn = true)
        prisma.storeReceipt.create({
          data: {
            storeId:         req.fromStoreId,
            receivedById:    user.sub,
            tenantId:        user.tenantId,
            receiptDate:     todayDate,
            feedInventoryId: req.fromFeedInventoryId,
            quantityReceived: ed.returnedActualKg,
            unitCost:        0,
            totalCost:       0,
            qualityStatus:   'PASSED',
            isReturn:        true,
            returnReason:    `Feed change: returned unused ${req.reason?.replace(/_/g,' ')} feed`,
            fromSectionId:   req.penSectionId,
            flockId:         req.flockId,
            notes:           ed.smNotes || null,
          },
        }),
        // StoreIssuance for new feed
        prisma.storeIssuance.create({
          data: {
            storeId:         req.toStoreId,
            penSectionId:    req.penSectionId,
            issuedById:      user.sub,
            issuanceDate:    todayDate,
            feedInventoryId: req.toFeedInventoryId,
            quantityIssued:  ed.issuedQtyKg,
            purpose:         `Feed change issuance — ${req.reason?.replace(/_/g,' ')}`,
            requestedById:   req.requestedById,
            notes:           ed.smNotes || null,
          },
        }),
        // Update request status
        prisma.feedChangeRequest.update({
          where: { id: req.id },
          data: {
            status:           'IN_PROGRESS',
            executedById:     user.sub,
            executedAt:       now,
            returnedActualKg: ed.returnedActualKg,
            issuedQtyKg:      ed.issuedQtyKg,
            issuedBags:       ed.issuedBags,
            smNotes:          ed.smNotes || null,
          },
        }),
      ]);

      // Link receipt and issuance IDs back to the request
      req = await prisma.feedChangeRequest.update({
        where: { id: req.id },
        data: {
          returnStoreReceiptId: returnReceipt.id,
          newFeedIssuanceId:    newIssuance.id,
        },
      });

      // Notify PM to acknowledge
      await notifyUsers(user.tenantId, [req.requestedById], {
        senderId: user.sub,
        title:    `📦 New Feed Ready — Please Acknowledge Receipt`,
        message:  `The store has processed your feed change. ${ed.issuedBags} bag(s) of new feed (${ed.issuedQtyKg} kg) ` +
                  `have been issued to your section. Please confirm receipt on the Feed Changes page.`,
        type:     'SYSTEM',
        data:     { feedChangeId: req.id, action: 'IN_PROGRESS' },
      });

      return NextResponse.json({ change: await enrich(req), returnReceipt, newIssuance });
    }

    // ── ACKNOWLEDGE (PM) ─────────────────────────────────────────────────────
    if (action === 'acknowledge') {
      if (!PM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Pen Managers can acknowledge feed receipt' }, { status: 403 });
      if (req.status !== 'IN_PROGRESS')
        return NextResponse.json({ error: `Cannot acknowledge from ${req.status} status` }, { status: 422 });

      const ackSchema = z.object({
        acknowledgedQtyKg: z.number().positive(),
        pmAckNotes:        z.string().max(500).optional(),
      });
      const ad = ackSchema.parse(body);

      req = await prisma.feedChangeRequest.update({
        where: { id: req.id },
        data: {
          status:            'COMPLETED',
          acknowledgedById:  user.sub,
          acknowledgedAt:    now,
          acknowledgedQtyKg: ad.acknowledgedQtyKg,
          pmAckNotes:        ad.pmAckNotes || null,
        },
      });

      // Notify FM and SM that the change is complete
      const supervisors = await prisma.user.findMany({
        where: { tenantId: user.tenantId, isActive: true, role: { in: FM_ROLES } },
        select: { id: true },
      });
      const sms = await prisma.user.findMany({
        where: { tenantId: user.tenantId, isActive: true, role: { in: SM_ROLES } },
        select: { id: true },
      });
      await notifyUsers(user.tenantId, [...supervisors.map(s => s.id), ...sms.map(s => s.id)], {
        senderId: user.sub,
        title:    `✅ Feed Change Completed`,
        message:  `PM has acknowledged receipt of the new feed. The feed change workflow is now complete.`,
        type:     'SYSTEM',
        data:     { feedChangeId: req.id, action: 'COMPLETED' },
      });

      return NextResponse.json({ change: await enrich(req) });
    }

    // ── CANCEL ───────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const cancelAllowed = ['DRAFT','SUBMITTED','REJECTED'];
      if (!cancelAllowed.includes(req.status))
        return NextResponse.json({ error: `Cannot cancel a request that is ${req.status}` }, { status: 422 });
      if (req.requestedById !== user.sub && !FM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only the requester or FM+ can cancel this request' }, { status: 403 });

      req = await prisma.feedChangeRequest.update({
        where: { id: req.id },
        data:  { status: 'CANCELLED' },
      });

      return NextResponse.json({ change: await enrich(req) });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error(`PATCH /api/feed/changes/[id] error:`, err);
    if (err?.constructor?.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    return NextResponse.json({ error: 'Failed to update request', detail: err?.message }, { status: 500 });
  }
}
