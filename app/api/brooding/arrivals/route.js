// app/api/brooding/arrivals/route.js
// GET  — list chick delivery records (optionally filtered by flockId)
// POST — log a chick delivery manifest linked to a flock + auto-generate brooding Tasks
// Prisma accessor: prisma.chick_arrivals
// Relation names (from db pull): pen_sections, flocks, users (for createdById FK)
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const BROODING_TASKS_LAYER = [
  { time:'06:00', taskType:'FEEDING',           title:'Morning feed & water check',           priority:'HIGH'   },
  { time:'07:00', taskType:'MORTALITY_CHECK',   title:'Morning mortality check',               priority:'HIGH'   },
  { time:'08:00', taskType:'INSPECTION',        title:'Brooder temperature & humidity check',  priority:'HIGH'   },
  { time:'12:00', taskType:'FEEDING',           title:'Midday feed & water top-up',            priority:'NORMAL' },
  { time:'16:00', taskType:'FEEDING',           title:'Afternoon feed & water check',          priority:'NORMAL' },
  { time:'17:00', taskType:'MORTALITY_CHECK',   title:'Evening mortality count',               priority:'HIGH'   },
  { time:'17:30', taskType:'INSPECTION',        title:'Evening brooder temperature check',     priority:'NORMAL' },
  { time:'19:00', taskType:'REPORT_SUBMISSION', title:'Brooding daily report submission',      priority:'NORMAL' },
];

const BROODING_TASKS_BROILER = [
  { time:'06:00', taskType:'FEEDING',           title:'Morning feed & water check',            priority:'HIGH'   },
  { time:'07:00', taskType:'MORTALITY_CHECK',   title:'Morning mortality check',               priority:'HIGH'   },
  { time:'08:00', taskType:'INSPECTION',        title:'Brooder temperature & tarpaulin check', priority:'HIGH'   },
  { time:'13:00', taskType:'FEEDING',           title:'Midday feed & water top-up',            priority:'NORMAL' },
  { time:'17:00', taskType:'MORTALITY_CHECK',   title:'Evening mortality count',               priority:'HIGH'   },
  { time:'17:30', taskType:'INSPECTION',        title:'Evening brooder heat source check',     priority:'NORMAL' },
  { time:'19:00', taskType:'REPORT_SUBMISSION', title:'Brooding daily report submission',      priority:'NORMAL' },
];

const createSchema = z.object({
  flockId:          z.string().min(1),
  penSectionId:     z.string().min(1),
  batchCode:        z.string().min(1),
  arrivalDate:      z.string().min(1),
  chicksReceived:   z.number().int().min(1),
  doaCount:         z.number().int().min(0).default(0),
  supplier:         z.string().optional().nullable(),
  chickCostPerBird: z.number().min(0).optional().nullable(),
  currency:         z.string().optional().default('NGN'),
  notes:            z.string().max(1000).optional().nullable(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId          = searchParams.get('flockId');

  try {
    const arrivals = await prisma.chick_arrivals.findMany({
      where: {
        tenantId: user.tenantId,
        ...(flockId ? { flockId } : {}),
      },
      // Use raw relation names Prisma generated from db pull
      // pen_sections, flocks, users are the relation names
      include: {
        pen_sections: { select: { id: true, name: true, pens: { select: { name: true } } } },
        flocks:       { select: { id: true, batchCode: true, stage: true } },
        users:        { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { arrivalDate: 'desc' },
    });

    // Normalise relation names for the UI
    const normalised = arrivals.map(a => ({
      ...a,
      penSection: a.pen_sections,
      flock:      a.flocks,
      createdBy:  a.users,
      pen_sections: undefined,
      flocks:       undefined,
      users:        undefined,
    }));

    return NextResponse.json({ arrivals: normalised });
  } catch (err) {
    console.error('GET /api/brooding/arrivals error:', err);
    return NextResponse.json({ error: 'Failed to fetch deliveries', detail: err?.message }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.errors }, { status: 422 });

    const data = parsed.data;

    const flock = await prisma.flock.findFirst({
      where: { id: data.flockId, tenantId: user.tenantId },
      include: {
        penSection: {
          select: {
            pen: { select: { operationType: true } },
            workerAssignments: {
              where:   { isActive: true },
              include: { user: { select: { id: true, role: true, isActive: true } } },
            },
          },
        },
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found or not in tenant' }, { status: 404 });

    const [yr, mo, dy]   = data.arrivalDate.split('-').map(Number);
    const arrivalDateUTC = new Date(Date.UTC(yr, mo - 1, dy));

    const liveBirdsFromThisDelivery = data.chicksReceived - data.doaCount;

    // Check if this is the first delivery for this flock.
    // New Intake creates the flock with correct net counts already set,
    // so we must NOT increment on the first delivery — only on subsequent ones.
    const existingDeliveryCount = await prisma.chick_arrivals.count({
      where: { flockId: data.flockId },
    });
    const isFirstDelivery = existingDeliveryCount === 0;

    // Run both writes in parallel: create arrival record + conditionally adjust flock counts
    const [arrival] = await Promise.all([
      prisma.chick_arrivals.create({
        data: {
          tenantId:         user.tenantId,
          penSectionId:     data.penSectionId,
          flockId:          data.flockId,
          batchCode:        data.batchCode,
          arrivalDate:      arrivalDateUTC,
          chicksReceived:   data.chicksReceived,
          doaCount:         data.doaCount,
          supplier:         data.supplier         || null,
          chickCostPerBird: data.chickCostPerBird ?? null,
          currency:         data.currency,
          status:           'ACTIVE',
          notes:            data.notes            || null,
          createdById:      user.sub,
        },
      }),

      // Only update flock counts for subsequent deliveries (e.g. second truck load).
      // The first delivery comes from New Intake which already set the correct net counts.
      ...(!isFirstDelivery ? [prisma.flock.update({
        where: { id: data.flockId },
        data: {
          currentCount: { increment: liveBirdsFromThisDelivery },
          initialCount: { increment: liveBirdsFromThisDelivery },
        },
      })] : []),
    ]);

    const opType    = flock.penSection?.pen?.operationType;
    const templates = opType === 'BROILER' ? BROODING_TASKS_BROILER : BROODING_TASKS_LAYER;
    const workers   = (flock.penSection?.workerAssignments ?? [])
      .map(a => a.user)
      .filter(u => u.isActive && ['PEN_WORKER','PEN_MANAGER'].includes(u.role));
    const assignee     = workers.find(u => u.role === 'PEN_WORKER') || workers[0];
    const assignedToId = assignee?.id || user.sub;

    const taskDueDate = new Date(arrivalDateUTC);
    taskDueDate.setUTCHours(23, 59, 0, 0);

    let tasksCreated = 0;
    for (const tmpl of templates) {
      await prisma.task.create({
        data: {
          tenantId:     user.tenantId,
          penSectionId: data.penSectionId,
          assignedToId,
          createdById:  user.sub,
          taskType:     tmpl.taskType,
          title:        `[Brooding ${data.batchCode}] ${tmpl.title}`,
          description:  `Scheduled ${tmpl.time} — Batch ${data.batchCode} (${data.chicksReceived} chicks, ${data.doaCount} DOA on arrival)`,
          dueDate:      taskDueDate,
          priority:     tmpl.priority,
          status:       'PENDING',
          isRecurring:  false,
        },
      });
      tasksCreated++;
    }

    // ── Broiler weight spot tasks: Day 1, 3, 7, 14 ─────────────────────────────
    // These are date-specific tasks, not recurring weekly — critical for FCR baseline
    if (opType === 'BROILER') {
      const weightDays = [
        { day: 1,  title: 'Day 1 Baseline Weigh-In',  desc: 'Weigh 30+ birds to establish placement weight baseline. Compare to hatchery certificate.' },
        { day: 3,  title: 'Day 3 Weight Check',        desc: 'Early weight check — birds should show 3-4g/day gain. Flag poor starters.' },
        { day: 7,  title: 'Day 7 Weekly Weigh-In',     desc: 'End of week 1. Target: ~170g (Ross 308). Record uniformity %.' },
        { day: 14, title: 'Day 14 Weigh-In (End Brooding)', desc: 'End of brooding weight. Critical FCR baseline. Compare to breed standard.' },
      ];
      for (const wt of weightDays) {
        const wtDueDate = new Date(arrivalDateUTC);
        wtDueDate.setUTCDate(wtDueDate.getUTCDate() + wt.day);
        wtDueDate.setUTCHours(10, 0, 0, 0); // Due at 10:00 AM
        await prisma.task.create({
          data: {
            tenantId:     user.tenantId,
            penSectionId: data.penSectionId,
            assignedToId,
            createdById:  user.sub,
            taskType:     'WEIGHT_RECORDING',
            title:        `[${data.batchCode}] ${wt.title}`,
            description:  wt.desc,
            dueDate:      wtDueDate,
            priority:     wt.day === 1 ? 'HIGH' : 'NORMAL',
            status:       'PENDING',
            isRecurring:  false,
          },
        });
        tasksCreated++;
      }
    }

    return NextResponse.json({
      arrival,
      tasksGenerated: tasksCreated,
      message: `Delivery logged (${data.chicksReceived} chicks, ${data.doaCount} DOA). ${tasksCreated} tasks generated.`,
    }, { status: 201 });

  } catch (err) {
    if (err?.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('POST /api/brooding/arrivals error:', err);
    return NextResponse.json({ error: 'Failed to log delivery', detail: err?.message }, { status: 500 });
  }
}
