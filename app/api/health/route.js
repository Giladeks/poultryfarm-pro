// app/api/health/route.js — Vaccinations, medications, health events
// Phase 5.2: sends overdue vaccination emails when status is auto-marked OVERDUE
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { sendOverdueVaccinationEmail, resolveEmailSettings } from '@/lib/services/notifications';

const vaccinationSchema = z.object({
  flockId: z.string().uuid(),
  vaccineName: z.string().min(2).max(200),
  scheduledDate: z.string(),
  doseMlPerBird: z.number().positive().optional(),
  notes: z.string().optional(),
});

const completeVaccinationSchema = z.object({
  vaccinationId: z.string().uuid(),
  batchNumber: z.string().optional(),
  doseMlPerBird: z.number().positive().optional(),
  nextDueDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId = searchParams.get('flockId');
  const statusFilter = searchParams.get('status');

  try {
    // PEN_MANAGER: scope to their assigned sections only
    let allowedSectionIds = null;
    if (user.role === 'PEN_MANAGER') {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { userId: user.sub },
        select: { penSectionId: true },
      });
      allowedSectionIds = assignments.map(a => a.penSectionId);
    }

    const vaccinations = await prisma.vaccination.findMany({
      where: {
        flock: {
          penSection: {
            pen: { farm: { tenantId: user.tenantId } },
            ...(allowedSectionIds && { id: { in: allowedSectionIds } }),
          },
        },
        ...(flockId && { flockId }),
        ...(statusFilter && { status: statusFilter }),
      },
      include: {
        flock: {
          select: {
            batchCode: true,
            operationType: true,
            breed: true,
            penSection: { include: { pen: { select: { name: true } } } },
          },
        },
        administeredBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    // Auto-mark overdue + collect newly-overdue IDs for email alerts
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newlyOverdue = vaccinations.filter(
      v => v.status === 'SCHEDULED' && new Date(v.scheduledDate) < today
    );
    const overdueIds = newlyOverdue.map(v => v.id);

    if (overdueIds.length > 0) {
      await prisma.vaccination.updateMany({
        where: { id: { in: overdueIds } },
        data:  { status: 'OVERDUE' },
      });

      // Phase 5.2: fire-and-forget email alerts for newly-overdue vaccinations
      sendOverdueVaccinationAlerts(user.tenantId, newlyOverdue).catch(console.error);
    }

    const upcomingCount = vaccinations.filter(v =>
      v.status === 'SCHEDULED' && new Date(v.scheduledDate) >= today
    ).length;
    const overdueCount = vaccinations.filter(v =>
      v.status === 'OVERDUE' || (v.status === 'SCHEDULED' && new Date(v.scheduledDate) < today)
    ).length;
    const completedThisMonth = vaccinations.filter(v => {
      if (v.status !== 'COMPLETED' || !v.administeredDate) return false;
      const d = new Date(v.administeredDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    // Get active flocks for scheduling UI
    const flocks = await prisma.flock.findMany({
      where: {
        penSection: {
          pen: { farm: { tenantId: user.tenantId } },
          ...(allowedSectionIds && { id: { in: allowedSectionIds } }),
        },
        status: 'ACTIVE',
      },
      select: { id: true, batchCode: true, operationType: true },
    });

    return NextResponse.json({
      vaccinations,
      flocks,
      summary: {
        dueSoon:        upcomingCount,
        overdue:        overdueCount,
        completedMonth: completedThisMonth,
        completedTotal: vaccinations.filter(v => v.status === 'COMPLETED').length,
        scheduled:      vaccinations.filter(v => v.status === 'SCHEDULED').length,
      },
    });
  } catch (error) {
    console.error('Health fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'schedule';

  try {
    if (action === 'schedule') {
      const data = vaccinationSchema.parse(await request.json());

      const flock = await prisma.flock.findFirst({
        where: {
          id: data.flockId,
          penSection: { pen: { farm: { tenantId: user.tenantId } } },
        },
      });
      if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

      const vaccination = await prisma.vaccination.create({
        data: {
          ...data,
          scheduledDate: new Date(data.scheduledDate),
          status: 'SCHEDULED',
        },
      });

      // Auto-create tasks for assigned workers via PenWorkerAssignment
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { penSectionId: flock.penSectionId },
        include: { user: { select: { id: true, role: true, isActive: true } } },
      });

      const workers = assignments
        .map(a => a.user)
        .filter(u => u.role === 'PEN_WORKER' && u.isActive);

      if (workers.length > 0) {
        await prisma.task.createMany({
          data: workers.map(w => ({
            tenantId:     user.tenantId,
            assignedToId: w.id,
            createdById:  user.sub,
            taskType:     'VACCINATION',
            title:        `Administer ${data.vaccineName}`,
            penSectionId: flock.penSectionId,
            dueDate:      new Date(data.scheduledDate),
            status:       'PENDING',
            priority:     'HIGH',
          })),
        });
      }

      return NextResponse.json({ vaccination }, { status: 201 });
    }

    if (action === 'complete') {
      const data = completeVaccinationSchema.parse(await request.json());

      const existing = await prisma.vaccination.findFirst({
        where: {
          id: data.vaccinationId,
          flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
        },
      });
      if (!existing) return NextResponse.json({ error: 'Vaccination not found' }, { status: 404 });

      const vaccination = await prisma.vaccination.update({
        where: { id: data.vaccinationId },
        data: {
          administeredDate:  new Date(),
          administeredById:  user.sub,
          batchNumber:       data.batchNumber,
          doseMlPerBird:     data.doseMlPerBird,
          nextDueDate:       data.nextDueDate ? new Date(data.nextDueDate) : null,
          notes:             data.notes,
          status:            'COMPLETED',
        },
      });

      // Schedule next booster automatically
      if (data.nextDueDate) {
        await prisma.vaccination.create({
          data: {
            flockId:       existing.flockId,
            vaccineName:   existing.vaccineName,
            scheduledDate: new Date(data.nextDueDate),
            status:        'SCHEDULED',
          },
        });
      }

      return NextResponse.json({ vaccination });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Health action error:', error);
    return NextResponse.json({ error: 'Health operation failed' }, { status: 500 });
  }
}

// ─── Overdue vaccination email helper ─────────────────────────────────────────

/**
 * Sends overdue vaccination emails to farm managers for a batch of newly-overdue vaccinations.
 * Deduplicated per vaccine — groups by flockId+vaccineName so one email covers each vaccine.
 */
async function sendOverdueVaccinationAlerts(tenantId, overdueVaccinations) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { farmName: true, settings: true },
  });

  const emailSettings = resolveEmailSettings(tenant?.settings);
  if (!emailSettings?.enabled || !emailSettings?.overdueVaccination?.enabled) return;

  const managers = await prisma.user.findMany({
    where: {
      tenantId,
      role:     { in: ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'PEN_MANAGER'] },
      isActive: true,
      email:    { not: null },
    },
    select: { email: true },
  });

  const toEmails = managers.map(m => m.email).filter(Boolean);
  if (toEmails.length === 0) return;

  const farmName = tenant?.farmName || 'Farm';
  const today    = new Date();

  // Send one email per overdue vaccination
  const emailPromises = overdueVaccinations.map(v => {
    const scheduled    = new Date(v.scheduledDate);
    const daysOverdue  = Math.floor((today - scheduled) / 86400000);
    const pen          = v.flock?.penSection?.pen?.name;
    const section      = v.flock?.penSection?.name;
    const penName      = pen ? (section ? `${pen} › ${section}` : pen) : '—';

    return sendOverdueVaccinationEmail({
      to:              toEmails,
      farmName,
      flockBatchCode:  v.flock?.batchCode || v.flockId,
      vaccineName:     v.vaccineName,
      scheduledDate:   v.scheduledDate,
      daysOverdue,
      penName,
    }).catch(err => console.error('[EMAIL] Vaccination overdue error:', err.message));
  });

  await Promise.allSettled(emailPromises);
}
