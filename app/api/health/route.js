// app/api/health/route.js — Vaccinations, medications, health events
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

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
    const vaccinations = await prisma.vaccination.findMany({
      where: {
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
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

    // Auto-mark overdue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueIds = vaccinations
      .filter(v => v.status === 'SCHEDULED' && new Date(v.scheduledDate) < today)
      .map(v => v.id);
    if (overdueIds.length > 0) {
      await prisma.vaccination.updateMany({
        where: { id: { in: overdueIds } },
        data: { status: 'OVERDUE' },
      });
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

    // Get all active flocks for scheduling UI
    const flocks = await prisma.flock.findMany({
      where: {
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        status: 'ACTIVE',
      },
      select: { id: true, batchCode: true, operationType: true },
    });

    return NextResponse.json({
      vaccinations,
      flocks,
      summary: {
        dueSoon: upcomingCount,
        overdue: overdueCount,
        completedMonth: completedThisMonth,
        completedTotal: vaccinations.filter(v => v.status === 'COMPLETED').length,
        scheduled: vaccinations.filter(v => v.status === 'SCHEDULED').length,
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
        where: { penSectionId: flock.penSectionId, isActive: true },
        include: { user: { select: { id: true, role: true, isActive: true } } },
      });

      const workers = assignments
        .map(a => a.user)
        .filter(u => u.role === 'PEN_WORKER' && u.isActive);

      if (workers.length > 0) {
        await prisma.task.createMany({
          data: workers.map(w => ({
            tenantId: user.tenantId,
            assignedToId: w.id,
            createdById: user.sub,
            taskType: 'VACCINATION',
            title: `Administer ${data.vaccineName}`,
            penSectionId: flock.penSectionId,
            dueDate: new Date(data.scheduledDate),
            status: 'PENDING',
            priority: 'HIGH',
          })),
        });
      }

      return NextResponse.json({ vaccination }, { status: 201 });
    }

    if (action === 'complete') {
      const data = completeVaccinationSchema.parse(await request.json());

      // Verify vaccination belongs to this tenant
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
          administeredDate: new Date(),
          administeredById: user.sub,
          batchNumber: data.batchNumber,
          doseMlPerBird: data.doseMlPerBird,
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
          notes: data.notes,
          status: 'COMPLETED',
        },
      });

      // Schedule next booster automatically
      if (data.nextDueDate) {
        await prisma.vaccination.create({
          data: {
            flockId: existing.flockId,
            vaccineName: existing.vaccineName,
            scheduledDate: new Date(data.nextDueDate),
            status: 'SCHEDULED',
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
