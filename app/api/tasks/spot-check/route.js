// app/api/tasks/spot-check/route.js
// POST — generates randomised, unannounced spot-check tasks for weight recording or inspection.
//
// The system selects a random subset of active pen sections using a weighted
// algorithm that prioritises:
//   1. Sections that haven't been spot-checked recently (higher weight)
//   2. Sections with anomalous metrics (high mortality, FCR deviation, laying drop)
//   3. Pure randomness for the remainder — so all sections get checked over time
//
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN, INTERNAL_CONTROL
//
// Body:
//   {
//     checkType:   'WEIGHT_RECORDING' | 'INSPECTION',  // what to check
//     assigneeId:  string,           // who to assign (defaults to requester)
//     sectionCount: number,          // how many sections to check (1–10, default 3)
//     dueHours:    number,           // hours from now until due (default 4)
//     operationType: 'LAYER' | 'BROILER' | null,  // filter to one op type (null = both)
//   }
//
// Response:
//   { tasks: Task[], skipped: number, reason: string }

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL',
];

const schema = z.object({
  checkType:     z.enum(['WEIGHT_RECORDING', 'INSPECTION']).default('WEIGHT_RECORDING'),
  assigneeId:    z.string().uuid().optional(),          // defaults to requester
  sectionCount:  z.number().int().min(1).max(10).default(3),
  dueHours:      z.number().min(0.5).max(48).default(4),
  operationType: z.enum(['LAYER', 'BROILER']).nullable().optional(),
});

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Farm Managers and IC Officers can generate spot checks' }, { status: 403 });

  try {
    const body = await request.json();
    const data = schema.parse(body);

    const assigneeId = data.assigneeId || user.sub;

    // Verify assignee exists and belongs to tenant
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, tenantId: user.tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
    });
    if (!assignee)
      return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });

    // ── Fetch all active flocks with their sections ───────────────────────────
    const activeFlocks = await prisma.flock.findMany({
      where: {
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        status: 'ACTIVE',
        ...(data.operationType && { operationType: data.operationType }),
      },
      select: {
        id:              true,
        batchCode:       true,
        operationType:   true,
        currentCount:    true,
        dateOfPlacement: true,
        penSectionId:    true,
        penSection: {
          select: {
            id:   true,
            name: true,
            pen:  { select: { name: true, operationType: true } },
          },
        },
        // Latest weight record for comparison baseline
        weightRecords: {
          orderBy: { recordDate: 'desc' },
          take:    1,
          select:  { avgWeightG: true, recordDate: true },
        },
        // 7-day mortality for anomaly detection
        mortalityRecords: {
          where: { recordDate: { gte: new Date(Date.now() - 7 * 86400000) } },
          select: { count: true },
        },
      },
    });

    if (activeFlocks.length === 0)
      return NextResponse.json({ tasks: [], skipped: 0, reason: 'No active flocks found' });

    // ── Check which sections already have a spot-check task today ────────────
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const existingToday = await prisma.task.findMany({
      where: {
        tenantId:    user.tenantId,
        taskType:    data.checkType,
        dueDate:     { gte: todayStart, lte: todayEnd },
        status:      { in: ['PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL'] },
        description: { contains: 'SPOT-CHECK' },
      },
      select: { penSectionId: true },
    });
    const alreadyCheckedToday = new Set(existingToday.map(t => t.penSectionId));

    // ── Check last spot-check date per section ────────────────────────────────
    const recentChecks = await prisma.task.findMany({
      where: {
        tenantId:    user.tenantId,
        taskType:    data.checkType,
        description: { contains: 'SPOT-CHECK' },
        penSectionId: { in: activeFlocks.map(f => f.penSectionId) },
        createdAt:   { gte: new Date(Date.now() - 30 * 86400000) }, // last 30 days
      },
      select: { penSectionId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // Map section → days since last check (null = never checked)
    const lastCheckBySection = {};
    recentChecks.forEach(c => {
      if (!lastCheckBySection[c.penSectionId]) {
        const daysSince = Math.floor((Date.now() - new Date(c.createdAt)) / 86400000);
        lastCheckBySection[c.penSectionId] = daysSince;
      }
    });

    // ── Score each section (higher = more likely to be selected) ─────────────
    const WEIGHT_RECORDING_MIN_AGE = 14; // broilers need to be at least 14d old

    const candidates = activeFlocks
      .filter(f => {
        // Skip sections already checked today
        if (alreadyCheckedToday.has(f.penSectionId)) return false;
        // Weight recording only makes sense for broilers with some age
        if (data.checkType === 'WEIGHT_RECORDING' && f.operationType === 'BROILER') {
          const ageInDays = f.dateOfPlacement
            ? Math.floor((Date.now() - new Date(f.dateOfPlacement)) / 86400000)
            : 0;
          if (ageInDays < WEIGHT_RECORDING_MIN_AGE) return false;
        }
        return true;
      })
      .map(flock => {
        let score = 10; // base score

        // Recency bonus: sections not checked recently get higher priority
        const daysSince = lastCheckBySection[flock.penSectionId] ?? 999;
        if      (daysSince >= 14) score += 8;
        else if (daysSince >= 7)  score += 4;
        else if (daysSince >= 3)  score += 2;
        else                      score -= 3; // checked very recently — deprioritise

        // Anomaly bonus: elevated mortality → higher priority
        const weekMort = flock.mortalityRecords.reduce((s, r) => s + r.count, 0);
        const mortRate = flock.currentCount > 0 ? (weekMort / flock.currentCount) * 100 : 0;
        if      (mortRate > 2)   score += 6;
        else if (mortRate > 1)   score += 3;

        // Weight gap bonus: no weight record in 7+ days → higher priority for WEIGHT_RECORDING
        if (data.checkType === 'WEIGHT_RECORDING') {
          const lastWeight = flock.weightRecords[0];
          if (!lastWeight) {
            score += 5;
          } else {
            const daysSinceWeight = Math.floor((Date.now() - new Date(lastWeight.recordDate)) / 86400000);
            if (daysSinceWeight >= 7) score += 4;
            else if (daysSinceWeight >= 3) score += 2;
          }
        }

        // Add randomness (±3 points) so identical scores don't always pick the same sections
        score += (Math.random() * 6) - 3;

        return { flock, score };
      });

    if (candidates.length === 0) {
      return NextResponse.json({
        tasks:   [],
        skipped: 0,
        reason:  alreadyCheckedToday.size > 0
          ? `All eligible sections already have a ${data.checkType} spot-check task today.`
          : 'No eligible sections found for the requested check type.',
      });
    }

    // ── Select top N sections by score ────────────────────────────────────────
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates.slice(0, Math.min(data.sectionCount, candidates.length));
    const skipped  = candidates.length - selected.length + alreadyCheckedToday.size;

    // ── Create tasks ──────────────────────────────────────────────────────────
    const dueAt = new Date(Date.now() + data.dueHours * 3600000);

    const checkTypeLabel = data.checkType === 'WEIGHT_RECORDING'
      ? 'Weight Check'
      : 'Section Inspection';

    const createdTasks = await Promise.all(
      selected.map(({ flock }) =>
        prisma.task.create({
          data: {
            tenantId:    user.tenantId,
            penSectionId:flock.penSectionId,
            assignedToId:assigneeId,
            createdById: user.sub,
            taskType:    data.checkType,
            title:       `🎲 Spot Check: ${checkTypeLabel} — ${flock.penSection.pen.name} › ${flock.penSection.name}`,
            description: [
              'SPOT-CHECK', // marker used for deduplication — do not remove
              `Unannounced ${checkTypeLabel.toLowerCase()} for flock ${flock.batchCode}.`,
              data.checkType === 'WEIGHT_RECORDING'
                ? `Weigh a random sample of at least 30 birds and record average, min, max weight. Current bird count: ${flock.currentCount.toLocaleString('en-NG')}.`
                : `Inspect the section for feed access, water, bird behaviour, litter condition, and any signs of disease or injury. Note all findings.`,
              flock.weightRecords[0]
                ? `Last recorded weight: ${Number(flock.weightRecords[0].avgWeightG).toFixed(0)} g (${Math.floor((Date.now() - new Date(flock.weightRecords[0].recordDate)) / 86400000)} days ago).`
                : 'No previous weight recorded for this flock.',
            ].join('\n'),
            dueDate:  dueAt,
            priority: 'HIGH',
            status:   'PENDING',
          },
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
            penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
          },
        })
      )
    );

    // ── Notify the assignee ───────────────────────────────────────────────────
    await prisma.notification.create({
      data: {
        tenantId:    user.tenantId,
        recipientId: assigneeId,
        type:        'TASK_ASSIGNED',
        title:       `🎲 ${createdTasks.length} Spot-Check Task${createdTasks.length !== 1 ? 's' : ''} Assigned`,
        message:     `You have been assigned ${createdTasks.length} unannounced ${checkTypeLabel.toLowerCase()} spot-check${createdTasks.length !== 1 ? 's' : ''}. Due: ${dueAt.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} today.`,
        data: {
          taskIds:   createdTasks.map(t => t.id),
          checkType: data.checkType,
          dueAt:     dueAt.toISOString(),
        },
        channel: 'IN_APP',
      },
    }).catch(() => {});

    // ── Audit log ─────────────────────────────────────────────────────────────
    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'Task',
        entityId:   createdTasks[0]?.id || 'batch',
        changes: {
          action:       'SPOT_CHECK_GENERATED',
          checkType:    data.checkType,
          sectionCount: createdTasks.length,
          assigneeId,
          taskIds:      createdTasks.map(t => t.id),
          sections:     createdTasks.map(t => t.penSection?.name),
          dueAt:        dueAt.toISOString(),
        },
      },
    }).catch(() => {});

    return NextResponse.json({
      tasks:   createdTasks,
      skipped,
      reason:  `Generated ${createdTasks.length} spot-check task${createdTasks.length !== 1 ? 's' : ''} from ${candidates.length} eligible section${candidates.length !== 1 ? 's' : ''}.`,
    }, { status: 201 });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/tasks/spot-check]', err);
    return NextResponse.json({ error: 'Failed to generate spot-check tasks' }, { status: 500 });
  }
}

// ── GET /api/tasks/spot-check — recent spot-check history ─────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const tasks = await prisma.task.findMany({
      where: {
        tenantId:    user.tenantId,
        taskType:    { in: ['WEIGHT_RECORDING', 'INSPECTION'] },
        description: { contains: 'SPOT-CHECK' },
        createdAt:   { gte: new Date(Date.now() - 30 * 86400000) },
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
        createdBy:  { select: { id: true, firstName: true, lastName: true } },
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const summary = {
      total:     tasks.length,
      completed: tasks.filter(t => t.status === 'COMPLETED').length,
      pending:   tasks.filter(t => ['PENDING','IN_PROGRESS'].includes(t.status)).length,
      overdue:   tasks.filter(t => t.status === 'OVERDUE').length,
    };

    return NextResponse.json({ tasks, summary });
  } catch (err) {
    console.error('[GET /api/tasks/spot-check]', err);
    return NextResponse.json({ error: 'Failed to fetch spot-check history' }, { status: 500 });
  }
}
