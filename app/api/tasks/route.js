//FILE: app/api/tasks/route.js
//================================================
// app/api/tasks/route.js — Task assignment and completion
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const createTaskSchema = z.object({
  assignedToId: z.string().uuid(),
  taskType: z.enum([
    'FEEDING','VACCINATION','EGG_COLLECTION','WEIGHT_RECORDING',
    'CLEANING','MEDICATION','INSPECTION','MORTALITY_CHECK',
    'BIOSECURITY','MAINTENANCE','STORE_COUNT','REPORT_SUBMISSION','OTHER',
  ]),
  title: z.string().min(3).max(200),
  description: z.string().optional(),
  penSectionId: z.string().min(1),
  dueDate: z.string(),
  priority: z.enum(['LOW','NORMAL','HIGH','URGENT']).default('NORMAL'),
});

const completeTaskSchema = z.object({
  taskId: z.string().min(1),
  completionNotes: z.string().max(1000).optional(),
});

const CREATOR_ROLES = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const myTasks    = searchParams.get('mine') === 'true';
  const sectionIds  = searchParams.get('sectionIds');
  const date = searchParams.get('date');
  const status = searchParams.get('status');

  try {
    const today = date ? new Date(date) : new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where = {
      tenantId: user.tenantId,
      dueDate: { gte: today, lt: tomorrow },
      ...(myTasks && { assignedToId: user.sub }),
      ...(status && { status }),
    };

    // Workers: if sectionIds provided, show all tasks for those sections;
    // otherwise fall back to tasks assigned to this worker only.
    // This ensures all section tasks show regardless of which worker was assigned.
    if (user.role === 'PEN_WORKER') {
      if (sectionIds) {
        const ids = sectionIds.split(',').map(id => id.trim()).filter(Boolean);
        where.penSectionId = { in: ids };
        // Remove the assignedToId restriction so all section tasks are visible
        delete where.assignedToId;
      } else {
        where.assignedToId = user.sub;
      }
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        penSection: { include: { pen: { select: { name: true, operationType: true } } } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });

    // Auto-mark overdue
    const now = new Date();
    const overdueIds = tasks
      .filter(t => t.status === 'PENDING' && new Date(t.dueDate) < now)
      .map(t => t.id);
    if (overdueIds.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: overdueIds } },
        data: { status: 'OVERDUE' },
      });
    }

    return NextResponse.json({
      tasks,
      summary: {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'COMPLETED').length,
        pending: tasks.filter(t => t.status === 'PENDING').length,
        inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
        overdue: tasks.filter(t => t.status === 'OVERDUE' || overdueIds.includes(t.id)).length,
      },
    });
  } catch (error) {
    console.error('Tasks fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'create';

  try {
    if (action === 'create') {
      if (!CREATOR_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Insufficient permissions to create tasks' }, { status: 403 });

      const data = createTaskSchema.parse(await request.json());

      const assignee = await prisma.user.findFirst({
        where: { id: data.assignedToId, tenantId: user.tenantId, isActive: true },
      });
      if (!assignee) return NextResponse.json({ error: 'User not found' }, { status: 404 });

      const task = await prisma.task.create({
        data: {
          ...data,
          tenantId: user.tenantId,
          createdById: user.sub,
          dueDate: new Date(data.dueDate),
          status: 'PENDING',
        },
        include: {
          assignedTo: { select: { firstName: true, lastName: true, email: true } },
          penSection: { include: { pen: { select: { name: true } } } },
        },
      });

      return NextResponse.json({ task }, { status: 201 });
    }

    if (action === 'start') {
      const { taskId } = await request.json();
      const task = await prisma.task.findFirst({
        where: { id: taskId, tenantId: user.tenantId, assignedToId: user.sub },
      });
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

      const updated = await prisma.task.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS' },
      });
      return NextResponse.json({ task: updated });
    }

    if (action === 'complete') {
      const data = completeTaskSchema.parse(await request.json());

      const task = await prisma.task.findFirst({
        where: { id: data.taskId, tenantId: user.tenantId },
      });
      if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

      // PEN_WORKERs can complete any task for sections they are assigned to.
      // Tasks are fetched by sectionIds (not assignedToId), so the worker may see
      // tasks originally assigned to another worker in the same section.
      if (user.role === 'PEN_WORKER' && task.penSectionId) {
        const assignment = await prisma.penWorkerAssignment.findFirst({
          where: { userId: user.sub, penSectionId: task.penSectionId, isActive: true },
        });
        if (!assignment)
          return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
      }

      const updated = await prisma.task.update({
        where: { id: data.taskId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completionNotes: data.completionNotes,
        },
      });

      return NextResponse.json({ task: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Task action error:', error);
    return NextResponse.json({ error: 'Task operation failed' }, { status: 500 });
  }
}
