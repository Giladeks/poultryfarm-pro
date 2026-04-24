// app/api/rearing/[id]/advance/route.js
// POST — Advance a flock from REARING → PRODUCTION stage.
// The PM logs Point-of-Lay date only. First egg collection is logged by the
// assigned worker through the normal task flow — no COI bypass needed.
// After advancing, daily PRODUCTION tasks are generated immediately for the
// section's worker so they appear the same day without waiting for next login.
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const schema = z.object({
  pointOfLayDate: z.string().min(1),
  notes:          z.string().max(1000).optional().nullable(),
});

// ── Minimal daily production templates for same-day task generation ───────────
// Mirrors the subset from app/api/tasks/generate/route.js dailyTemplatesLayerProduction()
// Only the tasks that make sense for the same day as the advance action.
function dueAt(baseDate, hhMM) {
  const [h, m] = hhMM.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

function todayProductionTemplates(date) {
  return [
    { taskType: 'INSPECTION',      title: '🔍 Arrival & Pre-shift Inspection',         dueTime: '06:00', priority: 'HIGH'   },
    { taskType: 'FEEDING',         title: '🍽️ Morning Feed Distribution (Batch 1)',    dueTime: '06:30', priority: 'NORMAL' },
    { taskType: 'EGG_COLLECTION',  title: '🥚 First Egg Collection (Batch 1)',          dueTime: '07:30', priority: 'HIGH'   },
    { taskType: 'INSPECTION',      title: '💧 Water System Check',                      dueTime: '09:00', priority: 'NORMAL' },
    { taskType: 'CLEANING',        title: '🧹 Pen Sanitation',                          dueTime: '09:30', priority: 'NORMAL' },
    { taskType: 'FEEDING',         title: '🍽️ Supplemental Feed Top-up (Morning)',     dueTime: '10:30', priority: 'NORMAL' },
    { taskType: 'INSPECTION',      title: '🐔 Bird Health Check & Ventilation',         dueTime: '11:15', priority: 'NORMAL' },
    { taskType: 'FEEDING',         title: '🍽️ Midday Feed Top-up',                     dueTime: '12:00', priority: 'NORMAL' },
    { taskType: 'FEEDING',         title: '🍽️ Final Feed Distribution (Batch 2)',      dueTime: '14:30', priority: 'NORMAL' },
    { taskType: 'EGG_COLLECTION',  title: '🥚 Second Egg Collection (Batch 2)',         dueTime: '15:30', priority: 'HIGH'   },
    { taskType: 'INSPECTION',      title: '🌇 End-of-Day Inspection',                   dueTime: '17:00', priority: 'NORMAL' },
    { taskType: 'REPORT_SUBMISSION', title: '📋 Daily Production Report',              dueTime: '18:30', priority: 'NORMAL' },
  ].map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.errors }, { status: 422 });

    const { pointOfLayDate, notes } = parsed.data;

    const flock = await prisma.flock.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { name: true } },
            workerAssignments: {
              where:  { isActive: true },
              select: { userId: true, user: { select: { id: true, firstName: true, role: true } } },
            },
          },
        },
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.stage !== 'REARING')
      return NextResponse.json({ error: `Flock must be in REARING stage (current: ${flock.stage})` }, { status: 409 });
    if (flock.operationType !== 'LAYER')
      return NextResponse.json({ error: 'Only layer flocks advance to PRODUCTION via this route' }, { status: 409 });

    const [yr, mo, dy] = pointOfLayDate.split('-').map(Number);
    const polDateUTC   = new Date(Date.UTC(yr, mo - 1, dy));

    // ── Advance flock to PRODUCTION ───────────────────────────────────────────
    const updated = await prisma.flock.update({
      where: { id: flock.id },
      data: {
        stage:          'PRODUCTION',
        stageUpdatedAt: new Date(),
        pointOfLayDate: polDateUTC,
        ...(notes && { notes }),
      },
    });

    // ── Generate today's PRODUCTION tasks for the section immediately ─────────
    // This ensures the worker sees egg collection tasks the same day the PM advances,
    // without waiting for tomorrow's login-triggered generation.
    const section  = flock.penSection;
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Find primary worker (PEN_WORKER role first, fall back to any active assignment)
    const workerAssignment =
      section.workerAssignments.find(a => a.user.role === 'PEN_WORKER') ||
      section.workerAssignments[0];

    let tasksCreated = 0;
    if (workerAssignment) {
      // Check which tasks already exist today to avoid duplicates
      const existingToday = await prisma.task.findMany({
        where: {
          penSectionId:   section.id,
          dueDate:        { gte: today, lt: tomorrow },
          isRecurring:    true,
          recurrenceRule: 'DAILY',
          status:         { not: 'CANCELLED' },
        },
        select: { title: true },
      });
      const existingTitles = new Set(existingToday.map(t => t.title));

      // Cancel any rearing tasks that are still pending for today
      await prisma.task.updateMany({
        where: {
          penSectionId:   section.id,
          dueDate:        { gte: today, lt: tomorrow },
          isRecurring:    true,
          recurrenceRule: 'DAILY',
          status:         'PENDING',
        },
        data: { status: 'CANCELLED' },
      });

      // Create production tasks for today
      const templates = todayProductionTemplates(today);
      for (const tmpl of templates) {
        if (existingTitles.has(tmpl.title)) continue;
        await prisma.task.create({
          data: {
            tenantId:       user.tenantId,
            penSectionId:   section.id,
            assignedToId:   workerAssignment.userId,
            createdById:    user.sub,
            taskType:       tmpl.taskType,
            title:          tmpl.title,
            dueDate:        tmpl.dueDate,
            priority:       tmpl.priority,
            status:         'PENDING',
            isRecurring:    true,
            recurrenceRule: 'DAILY',
          },
        });
        tasksCreated++;
      }
    }

    // ── Notify workers ────────────────────────────────────────────────────────
    const workers = section.workerAssignments.map(a => a.user);
    const penName = `${section.pen?.name} · ${section.name}`;

    for (const worker of workers) {
      await prisma.notification.create({
        data: {
          tenantId:    user.tenantId,
          recipientId: worker.id,
          senderId:    user.sub,
          type:        'SYSTEM',
          title:       `🥚 Flock Advanced to Production — ${flock.batchCode}`,
          message:     `${flock.batchCode} in ${penName} has reached Point-of-Lay and is now in Production stage. `
                     + `Egg collection tasks have been added to your task list for today. `
                     + `Please log the first egg collection using your task card.`,
          channel:     'IN_APP',
          data: { flockId: flock.id, batchCode: flock.batchCode, fromStage: 'REARING', toStage: 'PRODUCTION', penSectionId: flock.penSectionId },
        },
      }).catch(() => {});
    }

    // ── Notify supervisors ────────────────────────────────────────────────────
    const supervisors = await prisma.user.findMany({
      where: { tenantId: user.tenantId, isActive: true,
               role: { in: ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL'] } },
      select: { id: true },
    });

    for (const supervisor of supervisors) {
      await prisma.notification.create({
        data: {
          tenantId:    user.tenantId,
          recipientId: supervisor.id,
          senderId:    user.sub,
          type:        'REPORT_SUBMITTED',
          title:       `📋 Flock Advanced to Production — ${flock.batchCode}`,
          message:     `${flock.batchCode} (${penName}) has advanced to Production stage. `
                     + `Point-of-Lay date: ${pointOfLayDate}. Workers have been notified to log the first egg collection today.`,
          channel:     'IN_APP',
          data: { flockId: flock.id, batchCode: flock.batchCode, penSectionId: flock.penSectionId },
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      flock:               updated,
      fromStage:           'REARING',
      toStage:             'PRODUCTION',
      tasksCreated,
      notified:            workers.length,
      supervisorsNotified: supervisors.length,
      message: `Flock advanced to Production. ${tasksCreated} task(s) created for today. `
             + `${workers.length} worker(s) notified to log first egg collection.`,
    });
  } catch (err) {
    console.error('POST /api/rearing/[id]/advance error:', err);
    return NextResponse.json({ error: 'Failed to advance flock', detail: err?.message }, { status: 500 });
  }
}
