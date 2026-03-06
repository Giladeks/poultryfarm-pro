// app/api/auth/users/route.js — Staff management: list, create, update roles
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

// Roles that Farm Admin / Manager can create
const CREATABLE_ROLES = [
  'FARM_MANAGER','STORE_MANAGER','FEED_MILL_MANAGER',
  'PEN_MANAGER','STORE_CLERK','QC_TECHNICIAN','PRODUCTION_STAFF','PEN_WORKER',
];

const createUserSchema = z.object({
  email:     z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  role:      z.enum(CREATABLE_ROLES),
  password:  z.string().min(8),
  farmId:    z.string().uuid().optional(),
  phone:     z.string().optional(),
});

const ADMIN_ROLES = ['FARM_ADMIN','FARM_MANAGER','CHAIRPERSON','SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      where: { tenantId: user.tenantId },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        role: true, farmId: true, isActive: true, lastLoginAt: true, createdAt: true,
        farm: { select: { name: true } },
        penAssignments: {
          where: { isActive: true },
          select: {
            penSection: { select: { name: true, pen: { select: { name: true } } } },
          },
        },
        staffProfile: { select: { employeeId: true, contractType: true, baseSalary: true } },
      },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    });

    const summary = {
      total: users.length,
      active: users.filter(u => u.isActive).length,
      byRole: users.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
      }, {}),
    };

    return NextResponse.json({ users, summary });
  } catch (error) {
    console.error('Users fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createUserSchema.parse(body);

    // Check plan user limit
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: user.tenantId },
      include: { plan: true },
    });
    const currentCount = await prisma.user.count({
      where: { tenantId: user.tenantId, isActive: true },
    });
    if (subscription?.plan?.maxUsers && currentCount >= subscription.plan.maxUsers) {
      return NextResponse.json({
        error: `User limit reached. Your ${subscription.plan.name} plan allows ${subscription.plan.maxUsers} users.`,
      }, { status: 403 });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const newUser = await prisma.user.create({
      data: {
        tenantId: user.tenantId,
        farmId: data.farmId || null,
        email: data.email.toLowerCase(),
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        role: data.role,
        isActive: true,
      },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entityType: 'User',
        entityId: newUser.id,
        changes: { email: newUser.email, role: newUser.role },
      },
    }).catch(() => {});

    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    if (error.code === 'P2002')
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    console.error('User create error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { userId, isActive, role, farmId } = await request.json();

    const target = await prisma.user.findFirst({
      where: { id: userId, tenantId: user.tenantId },
    });
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (userId === user.sub && isActive === false)
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 });

    // Only CHAIRPERSON / FARM_ADMIN can change roles
    if (role && !['CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN'].includes(user.role))
      return NextResponse.json({ error: 'Insufficient permissions to change roles' }, { status: 403 });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(role && { role }),
        ...(farmId !== undefined && { farmId }),
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.sub,
        action: role ? 'ROLE_CHANGE' : 'UPDATE',
        entityType: 'User',
        entityId: userId,
        changes: { role, isActive, farmId },
      },
    }).catch(() => {});

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
