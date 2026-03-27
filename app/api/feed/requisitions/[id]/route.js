// app/api/feed/requisitions/[id]/route.js
// GET   — single requisition with full audit context
// PATCH — state transitions:
//
//   { action: 'submit',      requestedQtyKg, pmNotes }
//     PM → SUBMITTED. Validates section ownership. Computes deviationPct.
//     Notifies IC team.
//
//   { action: 'approve',     approvedQtyKg, icNotes }
//     IC → APPROVED. Notifies Store Manager.
//
//   { action: 'reject',      rejectionReason }
//     IC → REJECTED. Notifies PM.
//
//   { action: 'issue',       issuedQtyKg, issuanceNotes }
//     Store → ISSUED or ISSUED_PARTIAL.
//     Decrements FeedInventory. Creates linked StoreIssuance record.
//     Partial issuance auto-flags to IC + Farm Manager via notification.
//     Notifies PM that feed is ready for pickup acknowledgement.
//
//   { action: 'acknowledge', acknowledgedQtyKg, acknowledgementNotes }
//     PM → ACKNOWLEDGED or DISCREPANCY.
//     If qty matches: ACKNOWLEDGED. If differs: DISCREPANCY + flags IC.
//
//   { action: 'close',       closeNotes }
//     IC / Farm Manager → CLOSED.

import { NextResponse }   from 'next/server';
import { prisma }         from '@/lib/db/prisma';
import { verifyToken }    from '@/lib/middleware/auth';
import { z }              from 'zod';
import { calcDeviationPct } from '@/lib/utils/feedRequisitionCalc';

const PM_ROLES      = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const IC_ROLES      = ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const STORE_ROLES   = ['STORE_MANAGER', 'STORE_CLERK', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const CLOSE_ROLES   = ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const VIEW_ROLES    = ['PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', 'INTERNAL_CONTROL',
                       'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const INCLUDE = {
  pen:           { select: { id: true, name: true } },
  penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
  flock:         { select: { id: true, batchCode: true, currentCount: true } },
  feedInventory: { select: { id: true, feedType: true, currentStockKg: true, bagWeightKg: true, costPerKg: true } },
  store:         { select: { id: true, name: true } },
  submittedBy:   { select: { id: true, firstName: true, lastName: true } },
  approvedBy:    { select: { id: true, firstName: true, lastName: true } },
  rejectedBy:    { select: { id: true, firstName: true, lastName: true } },
  issuedBy:      { select: { id: true, firstName: true, lastName: true } },
  acknowledgedBy:{ select: { id: true, firstName: true, lastName: true } },
  closedBy:      { select: { id: true, firstName: true, lastName: true } },
};

// ─── GET /api/feed/requisitions/[id] ─────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const requisition = await prisma.feedRequisition.findFirst({
      where:   { id: params.id, tenantId: user.tenantId },
      include: INCLUDE,
    });
    if (!requisition)
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });

    return NextResponse.json({ requisition });
  } catch (err) {
    console.error('[GET /api/feed/requisitions/[id]]', err);
    return NextResponse.json({ error: 'Failed to load requisition' }, { status: 500 });
  }
}

// ─── PATCH /api/feed/requisitions/[id] ───────────────────────────────────────
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body   = await request.json();
    const { action } = body;

    if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

    const req = await prisma.feedRequisition.findFirst({
      where:   { id: params.id, tenantId: user.tenantId },
      include: { feedInventory: true, penSection: { include: { pen: true } } },
    });
    if (!req) return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });

    const now = new Date();

    // ── SUBMIT ──────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (!PM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Pen Managers can submit requisitions' }, { status: 403 });
      if (!['DRAFT', 'REJECTED'].includes(req.status))
        return NextResponse.json({ error: `Cannot submit a requisition in ${req.status} status` }, { status: 422 });

      const data = z.object({
        requestedQtyKg: z.number().positive('Requested quantity must be greater than 0'),
        pmNotes:        z.string().max(500).nullable().optional(),
      }).parse(body);

      // Verify PM owns this section
      if (user.role === 'PEN_MANAGER') {
        const assigned = await prisma.penWorkerAssignment.findFirst({
          where: { userId: user.sub, penSectionId: req.penSectionId },
        });
        if (!assigned)
          return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
      }

      const deviationPct = calcDeviationPct(data.requestedQtyKg, Number(req.calculatedQtyKg));

      const updated = await prisma.feedRequisition.update({
        where: { id: params.id },
        data: {
          requestedQtyKg: data.requestedQtyKg,
          pmNotes:        data.pmNotes ?? null,
          submittedById:  user.sub,
          submittedAt:    now,
          deviationPct,
          status:         'SUBMITTED',
          // Clear prior rejection if resubmitting
          rejectionReason: null,
          rejectedById:    null,
          rejectedAt:      null,
        },
        include: INCLUDE,
      });

      // Notify IC team
      await notifyRoles(user.tenantId, IC_ROLES, {
        type:    'ALERT',
        title:   `Feed Requisition Submitted — ${req.requisitionNumber}`,
        message: `PM has submitted a feed requisition for ${fmtDate(req.feedForDate)}. `
               + `Requested: ${data.requestedQtyKg} kg`
               + (Math.abs(deviationPct) > 10 ? ` (${deviationPct > 0 ? '+' : ''}${deviationPct.toFixed(1)}% from calc)` : '')
               + `. Awaiting IC approval.`,
        data: { entityType: 'FeedRequisition', entityId: params.id, requisitionNumber: req.requisitionNumber, deviationPct },
      });

      await logAudit(user, 'APPROVE', 'FeedRequisition', params.id, { action: 'SUBMITTED', requestedQtyKg: data.requestedQtyKg, deviationPct });
      return NextResponse.json({ requisition: updated });
    }

    // ── APPROVE ─────────────────────────────────────────────────────────────
    if (action === 'approve') {
      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only IC Officers and above can approve requisitions' }, { status: 403 });
      if (req.status !== 'SUBMITTED')
        return NextResponse.json({ error: 'Can only approve SUBMITTED requisitions' }, { status: 422 });

      const data = z.object({
        approvedQtyKg: z.number().positive(),
        icNotes:       z.string().max(500).nullable().optional(),
      }).parse(body);

      // Warn if approved qty differs significantly from requested
      const deviationFromRequest = req.requestedQtyKg
        ? calcDeviationPct(data.approvedQtyKg, Number(req.requestedQtyKg))
        : 0;

      const updated = await prisma.feedRequisition.update({
        where: { id: params.id },
        data: {
          approvedQtyKg: data.approvedQtyKg,
          icNotes:       data.icNotes ?? null,
          approvedById:  user.sub,
          approvedAt:    now,
          status:        'APPROVED',
        },
        include: INCLUDE,
      });

      // Notify Store Manager
      await notifyRoles(user.tenantId, ['STORE_MANAGER'], {
        type:    'ALERT',
        title:   `Feed Requisition Approved — ${req.requisitionNumber}`,
        message: `IC has approved requisition ${req.requisitionNumber}. `
               + `Please issue ${data.approvedQtyKg} kg of ${req.feedInventory.feedType} `
               + `for ${fmtDate(req.feedForDate)}.`,
        data: { entityType: 'FeedRequisition', entityId: params.id, requisitionNumber: req.requisitionNumber, approvedQtyKg: data.approvedQtyKg },
      });

      // Also notify the PM who submitted
      if (req.submittedById) {
        await notifyUser(user.tenantId, req.submittedById, {
          type:    'REPORT_APPROVED',
          title:   `Requisition Approved — ${req.requisitionNumber}`,
          message: `Your feed requisition for ${fmtDate(req.feedForDate)} has been approved by IC. `
                 + `Approved quantity: ${data.approvedQtyKg} kg. Feed will be issued by the store.`,
          data: { entityType: 'FeedRequisition', entityId: params.id },
        });
      }

      await logAudit(user, 'APPROVE', 'FeedRequisition', params.id, { action: 'APPROVED', approvedQtyKg: data.approvedQtyKg, deviationFromRequest });
      return NextResponse.json({ requisition: updated });
    }

    // ── REJECT ───────────────────────────────────────────────────────────────
    if (action === 'reject') {
      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only IC Officers and above can reject requisitions' }, { status: 403 });
      if (req.status !== 'SUBMITTED')
        return NextResponse.json({ error: 'Can only reject SUBMITTED requisitions' }, { status: 422 });

      const data = z.object({
        rejectionReason: z.string().min(5, 'Rejection reason is required'),
      }).parse(body);

      const updated = await prisma.feedRequisition.update({
        where: { id: params.id },
        data: {
          rejectionReason: data.rejectionReason,
          rejectedById:    user.sub,
          rejectedAt:      now,
          status:          'REJECTED',
        },
        include: INCLUDE,
      });

      // Notify PM
      if (req.submittedById) {
        await notifyUser(user.tenantId, req.submittedById, {
          type:    'REPORT_REJECTED',
          title:   `Requisition Rejected — ${req.requisitionNumber}`,
          message: `Your feed requisition for ${fmtDate(req.feedForDate)} was rejected by IC. `
                 + `Reason: ${data.rejectionReason}. Please revise and resubmit.`,
          data: { entityType: 'FeedRequisition', entityId: params.id },
        });
      }

      await logAudit(user, 'REJECT', 'FeedRequisition', params.id, { action: 'REJECTED', reason: data.rejectionReason });
      return NextResponse.json({ requisition: updated });
    }

    // ── ISSUE ────────────────────────────────────────────────────────────────
    if (action === 'issue') {
      if (!STORE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Managers can issue feed' }, { status: 403 });
      if (req.status !== 'APPROVED')
        return NextResponse.json({ error: 'Can only issue against APPROVED requisitions' }, { status: 422 });

      const data = z.object({
        issuedQtyKg:     z.number().positive(),
        issuanceNotes:   z.string().max(500).nullable().optional(),
        // Optional per-section breakdown: [{ penSectionId, issuedQtyKg }]
        sectionIssuance: z.array(z.object({
          penSectionId: z.string(),
          issuedQtyKg:  z.number().min(0),
        })).optional(),
      }).parse(body);

      const approvedQty  = Number(req.approvedQtyKg);
      const currentStock = Number(req.feedInventory.currentStockKg);

      // Cap issuance at approved quantity
      if (data.issuedQtyKg > approvedQty)
        return NextResponse.json({
          error: `Cannot issue more than approved quantity (${approvedQty} kg)`,
        }, { status: 422 });

      // Check stock availability
      const canIssue    = Math.min(data.issuedQtyKg, currentStock);
      const isPartial   = canIssue < data.issuedQtyKg;
      const actualIssue = parseFloat(canIssue.toFixed(2));

      if (actualIssue <= 0)
        return NextResponse.json({
          error: `Insufficient feed stock. Available: ${currentStock.toFixed(1)} kg`,
          currentStock,
        }, { status: 422 });

      // Merge per-section issued quantities into sectionBreakdown
      let updatedBreakdown = req.sectionBreakdown ? [...req.sectionBreakdown] : null;
      if (updatedBreakdown && data.sectionIssuance?.length > 0) {
        const issueMap = Object.fromEntries(data.sectionIssuance.map(s => [s.penSectionId, s.issuedQtyKg]));
        updatedBreakdown = updatedBreakdown.map(s => ({
          ...s,
          issuedQtyKg: issueMap[s.penSectionId] ?? s.issuedQtyKg ?? null,
        }));
      } else if (updatedBreakdown && actualIssue > 0) {
        // Pro-rate issuance across sections by calculatedQtyKg
        const totalCalc = updatedBreakdown.reduce((sum, s) => sum + (s.calculatedQtyKg || 0), 0);
        updatedBreakdown = updatedBreakdown.map(s => ({
          ...s,
          issuedQtyKg: totalCalc > 0
            ? parseFloat(((s.calculatedQtyKg / totalCalc) * actualIssue).toFixed(2))
            : null,
        }));
      }

      // Create StoreIssuance record + decrement inventory atomically
      const [issuance] = await prisma.$transaction([
        prisma.storeIssuance.create({
          data: {
            storeId:        req.feedInventory.storeId || req.storeId,
            penSectionId:   req.penSectionId || null,
            issuedById:     user.sub,
            issuanceDate:   now,
            feedInventoryId:req.feedInventoryId,
            quantityIssued: actualIssue,
            purpose:        `Feed requisition ${req.requisitionNumber}`,
            notes:          data.issuanceNotes ?? null,
          },
        }),
        prisma.feedInventory.update({
          where: { id: req.feedInventoryId },
          data:  { currentStockKg: { decrement: actualIssue } },
        }),
      ]);

      const newStatus = isPartial ? 'ISSUED_PARTIAL' : 'ISSUED';

      const updated = await prisma.feedRequisition.update({
        where: { id: params.id },
        data: {
          issuedQtyKg:      actualIssue,
          issuedById:       user.sub,
          issuedAt:         now,
          storeIssuanceId:  issuance.id,
          issuanceNotes:    data.issuanceNotes ?? null,
          status:           newStatus,
          ...(updatedBreakdown && { sectionBreakdown: updatedBreakdown }),
        },
        include: INCLUDE,
      });

      // Notify PM to acknowledge receipt
      if (req.submittedById) {
        await notifyUser(user.tenantId, req.submittedById, {
          type:    'ALERT',
          title:   `Feed Issued — ${req.requisitionNumber}`,
          message: `The store has issued ${actualIssue} kg of ${req.feedInventory.feedType} `
                 + `against your requisition for ${fmtDate(req.feedForDate)}.`
                 + (isPartial ? ` Note: only ${actualIssue} kg was available (you requested ${data.issuedQtyKg} kg).` : '')
                 + ` Please acknowledge receipt.`,
          data: { entityType: 'FeedRequisition', entityId: params.id, issuedQtyKg: actualIssue, isPartial },
        });
      }

      // Partial issuance: auto-flag to IC + Farm Manager
      if (isPartial) {
        const shortfall = parseFloat((data.issuedQtyKg - actualIssue).toFixed(2));
        await notifyRoles(user.tenantId, ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN'], {
          type:    'ALERT',
          title:   `⚠️ Partial Feed Issuance — ${req.requisitionNumber}`,
          message: `Feed requisition ${req.requisitionNumber} for ${fmtDate(req.feedForDate)} `
                 + `could only be partially fulfilled. Issued: ${actualIssue} kg, `
                 + `shortfall: ${shortfall} kg. Stock replenishment required.`,
          data: { entityType: 'FeedRequisition', entityId: params.id, issuedQtyKg: actualIssue, shortfallKg: shortfall },
        });
      }

      await logAudit(user, 'APPROVE', 'FeedRequisition', params.id, {
        action: newStatus, issuedQtyKg: actualIssue, isPartial, storeIssuanceId: issuance.id,
      });
      return NextResponse.json({ requisition: updated, issuance, isPartial, actualIssue });
    }

    // ── ACKNOWLEDGE ──────────────────────────────────────────────────────────
    if (action === 'acknowledge') {
      if (!PM_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Pen Managers can acknowledge receipt' }, { status: 403 });
      if (!['ISSUED', 'ISSUED_PARTIAL'].includes(req.status))
        return NextResponse.json({ error: 'Can only acknowledge issued requisitions' }, { status: 422 });

      const data = z.object({
        acknowledgedQtyKg:    z.number().min(0),
        acknowledgementNotes: z.string().max(500).nullable().optional(),
        // Optional per-section acknowledged quantities
        sectionAcknowledgement: z.array(z.object({
          penSectionId:      z.string(),
          acknowledgedQtyKg: z.number().min(0),
        })).optional(),
      }).parse(body);

      const issuedQty      = Number(req.issuedQtyKg);
      const discrepancyQty = parseFloat((issuedQty - data.acknowledgedQtyKg).toFixed(2));
      const hasDiscrepancy = Math.abs(discrepancyQty) > 0.5;
      const newStatus      = hasDiscrepancy ? 'DISCREPANCY' : 'ACKNOWLEDGED';

      // Merge per-section acknowledged quantities into sectionBreakdown
      let updatedBreakdown = req.sectionBreakdown ? [...req.sectionBreakdown] : null;
      if (updatedBreakdown && data.sectionAcknowledgement?.length > 0) {
        const ackMap = Object.fromEntries(data.sectionAcknowledgement.map(s => [s.penSectionId, s.acknowledgedQtyKg]));
        updatedBreakdown = updatedBreakdown.map(s => ({
          ...s,
          acknowledgedQtyKg: ackMap[s.penSectionId] ?? s.acknowledgedQtyKg ?? null,
        }));
      } else if (updatedBreakdown && data.acknowledgedQtyKg > 0) {
        // Pro-rate acknowledgement by issuedQtyKg per section
        const totalIssued = updatedBreakdown.reduce((sum, s) => sum + (s.issuedQtyKg || 0), 0);
        updatedBreakdown = updatedBreakdown.map(s => ({
          ...s,
          acknowledgedQtyKg: totalIssued > 0
            ? parseFloat((((s.issuedQtyKg || 0) / totalIssued) * data.acknowledgedQtyKg).toFixed(2))
            : null,
        }));
      }

      const updated = await prisma.feedRequisition.update({
        where: { id: params.id },
        data: {
          acknowledgedQtyKg:    data.acknowledgedQtyKg,
          acknowledgedById:     user.sub,
          acknowledgedAt:       now,
          discrepancyQtyKg:     discrepancyQty,
          acknowledgementNotes: data.acknowledgementNotes ?? null,
          status:               newStatus,
          ...(updatedBreakdown && { sectionBreakdown: updatedBreakdown }),
        },
        include: INCLUDE,
      });

      if (hasDiscrepancy) {
        // Auto-flag discrepancy to IC
        await notifyRoles(user.tenantId, ['INTERNAL_CONTROL'], {
          type:    'ALERT',
          title:   `⚠️ Feed Receipt Discrepancy — ${req.requisitionNumber}`,
          message: `PM acknowledged receiving ${data.acknowledgedQtyKg} kg but store issued `
                 + `${issuedQty} kg for requisition ${req.requisitionNumber}. `
                 + `Discrepancy: ${Math.abs(discrepancyQty).toFixed(2)} kg. IC investigation recommended.`,
          data: { entityType: 'FeedRequisition', entityId: params.id, discrepancyQtyKg: discrepancyQty },
        });

        // Also create an Investigation record
        await prisma.investigation.create({
          data: {
            tenantId:      user.tenantId,
            referenceType: 'FeedRequisition',
            referenceId:   params.id,
            flaggedById:   user.sub,
            flagReason:    `Feed receipt discrepancy: issued ${issuedQty} kg, PM acknowledged ${data.acknowledgedQtyKg} kg (${Math.abs(discrepancyQty).toFixed(2)} kg difference).`,
            status:        'OPEN',
          },
        }).catch(() => {}); // non-fatal
      }

      await logAudit(user, 'APPROVE', 'FeedRequisition', params.id, {
        action: newStatus, acknowledgedQtyKg: data.acknowledgedQtyKg, discrepancyQtyKg: discrepancyQty,
      });
      return NextResponse.json({ requisition: updated, hasDiscrepancy, discrepancyQtyKg: discrepancyQty });
    }

    // ── CLOSE ────────────────────────────────────────────────────────────────
    if (action === 'close') {
      if (!CLOSE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only IC Officers and Farm Managers can close requisitions' }, { status: 403 });

      const CLOSEABLE = ['ACKNOWLEDGED', 'DISCREPANCY', 'ISSUED', 'ISSUED_PARTIAL', 'REJECTED'];
      if (!CLOSEABLE.includes(req.status))
        return NextResponse.json({ error: `Cannot close a requisition in ${req.status} status` }, { status: 422 });

      const data = z.object({
        closeNotes: z.string().min(3, 'Close notes are required'),
      }).parse(body);

      const updated = await prisma.feedRequisition.update({
        where: { id: params.id },
        data: {
          closedById: user.sub,
          closedAt:   now,
          closeNotes: data.closeNotes,
          status:     'CLOSED',
        },
        include: INCLUDE,
      });

      await logAudit(user, 'APPROVE', 'FeedRequisition', params.id, { action: 'CLOSED', notes: data.closeNotes });
      return NextResponse.json({ requisition: updated });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[PATCH /api/feed/requisitions/[id]]', err);
    return NextResponse.json({ error: 'Failed to update requisition' }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function notifyUser(tenantId, recipientId, { type, title, message, data }) {
  return prisma.notification.create({
    data: { tenantId, recipientId, type, title, message, data, channel: 'IN_APP' },
  }).catch(() => {});
}

async function notifyRoles(tenantId, roles, { type, title, message, data }) {
  const users = await prisma.user.findMany({
    where: { tenantId, role: { in: roles }, isActive: true },
    select: { id: true },
  });
  if (users.length === 0) return;
  await prisma.notification.createMany({
    data: users.map(u => ({ tenantId, recipientId: u.id, type, title, message, data, channel: 'IN_APP' })),
    skipDuplicates: true,
  }).catch(() => {});
}

async function logAudit(user, action, entityType, entityId, changes) {
  return prisma.auditLog.create({
    data: { tenantId: user.tenantId, userId: user.sub, action, entityType, entityId, changes },
  }).catch(() => {});
}
