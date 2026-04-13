// app/api/flocks/[id]/deplete/route.js
// Phase 8-Supplement · Flock Lifecycle — Full Depletion
//
// POST /api/flocks/[id]/deplete
//   1. flock.status → DEPLETED, currentCount → 0
//   2. penSection.isActive → false  (schema has isActive, NOT status)
//   3. Task CLEANING → auto-created
//   4. StoreReceipt → auto-created for all dispositions except DIED
//
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

const depleteSchema = z.object({
  disposition:           z.enum(['TRANSFERRED_TO_STORE','CULLED','DIED','HARVESTED']),
  finalCount:            z.number().int().min(0),
  depletionDate:         z.string().optional(),
  notes:                 z.string().max(1000).optional(),
  // Store transfer fields (required for all dispositions except DIED)
  storeId:               z.string().min(1).optional(),
  estimatedValuePerBird: z.number().min(0).optional(),
  currency:              z.string().default('NGN'),
});

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;                      // Next.js 16 async params
  const user   = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },   { status: 403 });

  const { id: flockId } = params;

  try {
    const body = await request.json();
    const data = depleteSchema.parse(body);

    const needsStore = data.disposition !== 'DIED';
    if (needsStore && !data.storeId)
      return NextResponse.json({ error: 'storeId is required for this disposition' }, { status: 422 });

    // ── Validate flock ────────────────────────────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where: { id: flockId, tenantId: user.tenantId },
      select: {
        id: true, batchCode: true, currentCount: true, status: true,
        penSectionId: true, tenantId: true, notes: true,
        penSection: {
          select: {
            id: true, name: true, isActive: true,
            workerAssignments: {
              where:  { isActive: true },
              select: { userId: true, user: { select: { id: true, role: true } } },
            },
          },
        },
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.status !== 'ACTIVE')
      return NextResponse.json({ error: `Cannot deplete a ${flock.status} flock` }, { status: 422 });
    if (data.finalCount > flock.currentCount)
      return NextResponse.json({ error: `finalCount (${data.finalCount}) exceeds currentCount (${flock.currentCount})` }, { status: 422 });

    // ── Validate store ────────────────────────────────────────────────────────
    if (data.storeId) {
      const store = await prisma.store.findFirst({
        where: { id: data.storeId, farm: { tenantId: user.tenantId } },
        select: { id: true },
      });
      if (!store)
        return NextResponse.json({ error: 'Store not found or not accessible' }, { status: 404 });
    }

    const depletionDate = data.depletionDate ? new Date(data.depletionDate) : new Date();

    // ── Resolve cleaning task assignee ────────────────────────────────────────
    const assignments       = flock.penSection.workerAssignments ?? [];
    const primaryWorker     = assignments.find(a => a.user.role === 'PEN_WORKER')?.user || assignments[0]?.user || null;
    const cleaningAssigneeId = primaryWorker?.id ?? user.sub;

    const mergedNotes = data.notes
      ? (flock.notes ? `${flock.notes}\n---\n${data.notes}` : data.notes)
      : flock.notes;

    // ── Build StoreReceipt for non-DIED dispositions ──────────────────────────
    let storeReceipt = null;
    if (needsStore && data.storeId) {
      const unitCost  = data.estimatedValuePerBird ?? 0;
      const totalCost = unitCost * data.finalCount;
      const itemName  = `Live Birds — ${flock.batchCode}`;

      let liveBirdsItem = await prisma.inventoryItem.findFirst({
        where: { storeId: data.storeId, tenantId: user.tenantId, name: itemName, category: 'LIVE_BIRDS' },
        select: { id: true },
      });
      if (!liveBirdsItem) {
        liveBirdsItem = await prisma.inventoryItem.create({
          data: {
            storeId:      data.storeId,
            tenantId:     user.tenantId,
            name:         itemName,
            category:     'LIVE_BIRDS',
            unit:         'birds',
            currentStock: 0,
            reorderLevel: 0,
            costPerUnit:  unitCost,
            currency:     data.currency,
            isActive:     true,
          },
          select: { id: true },
        });
      }

      storeReceipt = await prisma.storeReceipt.create({
        data: {
          storeId:          data.storeId,
          receivedById:     user.sub,
          receiptDate:      depletionDate,
          inventoryItemId:  liveBirdsItem.id,
          flockId,
          fromSectionId:    flock.penSectionId,
          quantityReceived: data.finalCount,
          unitCost,
          currency:         data.currency,
          totalCost,
          referenceNumber:  `DEPLETE-${flock.batchCode}-${depletionDate.toISOString().slice(0,10)}`,
          notes: [
            `Full depletion: ${flock.batchCode}`,
            `Disposition: ${data.disposition}`,
            data.notes || null,
          ].filter(Boolean).join(' | '),
          qualityStatus: 'PENDING',
        },
        select: { id: true, quantityReceived: true, storeId: true },
      });
    }

    // ── Transaction: mark DEPLETED + deactivate section + cleaning task ───────
    const [updatedFlock, updatedSection, cleaningTask] = await prisma.$transaction([

      // 1. Mark flock DEPLETED — only write fields that exist in schema
      prisma.flock.update({
        where: { id: flockId },
        data: {
          status:               'DEPLETED',
          currentCount:         0,
          depletionDate,
          depletionDisposition: data.disposition,
          notes:                mergedNotes,
        },
        select: {
          id: true, batchCode: true, status: true,
          depletionDate: true, currentCount: true, depletionDisposition: true,
        },
      }),

      // 2. Mark section inactive (PenSection has isActive, NOT status)
      prisma.penSection.update({
        where: { id: flock.penSectionId },
        data:  { isActive: false },
        select: { id: true, name: true, isActive: true },
      }),

      // 3. Auto-create cleaning task
      prisma.task.create({
        data: {
          tenantId:     user.tenantId,
          penSectionId: flock.penSectionId,
          assignedToId: cleaningAssigneeId,
          createdById:  user.sub,
          taskType:     'CLEANING',
          title:        `Post-depletion pen cleaning — ${flock.penSection.name}`,
          description: [
            `Flock ${flock.batchCode} depleted (${data.disposition}).`,
            'Clean, disinfect, and prepare section before next batch.',
            data.notes ? `Notes: ${data.notes}` : null,
          ].filter(Boolean).join(' '),
          dueDate:      depletionDate,
          priority:     'HIGH',
          status:       'PENDING',
          isRecurring:  false,
        },
        select: { id: true, title: true, assignedToId: true, dueDate: true, priority: true },
      }),
    ]);

    return NextResponse.json({
      message:      `Flock ${updatedFlock.batchCode} depleted successfully`,
      flock:        updatedFlock,
      section:      updatedSection,
      cleaningTask,
      ...(storeReceipt && { storeReceipt, nextStep: 'Store Manager must acknowledge the receipt.' }),
    });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flocks/[id]/deplete]', err);
    return NextResponse.json({ error: 'Depletion operation failed', detail: err?.message }, { status: 500 });
  }
}
