// app/api/users/route.js — Full user management + pen assignments
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import bcrypt from 'bcryptjs';

const ADMIN_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

// Roles that can read a limited user directory (names + roles only).
// Used by the verification page escalation picker and IC dashboard.
const DIRECTORY_ROLES = [
  'FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN',
  'INTERNAL_CONTROL', 'PEN_MANAGER', 'STORE_MANAGER',
];

// ── GET /api/users ─────────────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const roleFilter  = searchParams.get('role');
  const rolesFilter = searchParams.get('roles');
  const farmId      = searchParams.get('farmId');
  const status      = searchParams.get('status');
  const search      = searchParams.get('search');

  const isAdmin     = ADMIN_ROLES.includes(user.role);
  const isDirectory = DIRECTORY_ROLES.includes(user.role);

  if (!isAdmin && !isDirectory)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Directory mode: non-admin with ?roles= — returns id/name/role only
  if (!isAdmin && rolesFilter) {
    const SAFE_LOOKUP_ROLES = [
      'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL',
    ];
    const filteredRoles = rolesFilter
      .split(',').map(r => r.trim())
      .filter(r => SAFE_LOOKUP_ROLES.includes(r));
    if (filteredRoles.length === 0)
      return NextResponse.json({ users: [] });
    try {
      const users = await prisma.user.findMany({
        where:   { tenantId: user.tenantId, role: { in: filteredRoles }, isActive: true },
        select:  { id: true, firstName: true, lastName: true, role: true },
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      });
      return NextResponse.json({ users });
    } catch (error) {
      console.error('Users directory fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
  }

  // Full admin mode
  if (!isAdmin)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        ...(roleFilter  && { role: roleFilter }),
        ...(rolesFilter && { role: { in: rolesFilter.split(',').map(r => r.trim()) } }),
        ...(farmId      && { farmId }),
        ...(status === 'active'   && { isActive: true }),
        ...(status === 'inactive' && { isActive: false }),
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName:  { contains: search, mode: 'insensitive' } },
            { email:     { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, farmId: true, isActive: true,
        lastLoginAt: true, createdAt: true,
        farm: { select: { id: true, name: true } },
        penAssignments: {
          where: { isActive: true },
          select: {
            id: true,
            penSection: {
              select: {
                id: true, name: true,
                pen: { select: { id: true, name: true, operationType: true } },
              },
            },
          },
        },
        staffProfile: {
          select: {
            employeeId: true, contractType: true,
            baseSalary: true, currency: true,
            dateOfJoining: true, department: true,
          },
        },
        _count: { select: { tasksAssigned: true } },
      },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    });

    const summary = {
      total:    users.length,
      active:   users.filter(u => u.isActive).length,
      inactive: users.filter(u => !u.isActive).length,
      byRole:   users.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
      }, {}),
    };

    const [farms, penSections] = await Promise.all([
      prisma.farm.findMany({
        where:  { tenantId: user.tenantId, isActive: true },
        select: { id: true, name: true },
      }),
      prisma.penSection.findMany({
        where:   { pen: { farm: { tenantId: user.tenantId } }, isActive: true },
        select: {
          id: true, name: true,
          pen: { select: { id: true, name: true, operationType: true } },
        },
        orderBy: { pen: { name: 'asc' } },
      }),
    ]);

    return NextResponse.json({ users, summary, farms, penSections });
  } catch (error) {
    console.error('Users fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// ── POST /api/users — create user ──────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const { email, firstName, lastName, phone, role, farmId, password, penSectionIds = [] } = body;

    if (!email || !firstName || !lastName || !role || !password)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    if (password.length < 8)
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });

    const [subscription, currentCount] = await Promise.all([
      prisma.subscription.findUnique({
        where:   { tenantId: user.tenantId },
        include: { plan: true },
      }),
      prisma.user.count({ where: { tenantId: user.tenantId, isActive: true } }),
    ]);

    if (subscription?.plan?.maxUsers && currentCount >= subscription.plan.maxUsers) {
      return NextResponse.json({
        error: `User limit reached. Your ${subscription.plan.name} plan allows ${subscription.plan.maxUsers} users.`,
      }, { status: 403 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        tenantId:     user.tenantId,
        farmId:       farmId || null,
        email:        email.toLowerCase().trim(),
        passwordHash,
        firstName:    firstName.trim(),
        lastName:     lastName.trim(),
        phone:        phone || null,
        role,
        isActive:     true,
      },
    });

    if (penSectionIds.length > 0) {
      await prisma.penWorkerAssignment.createMany({
        data: penSectionIds.map(sId => ({
          userId:       newUser.id,
          penSectionId: sId,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'User',
        entityId:   newUser.id,
        changes:    { email: newUser.email, role: newUser.role },
      },
    }).catch(() => {});

    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    if (error.code === 'P2002')
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    console.error('User create error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

// ── PATCH /api/users — update user ─────────────────────────────────────────────
export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const {
      userId, isActive, role, farmId, phone,
      penSectionIds, firstName, lastName, email, newPassword,
    } = body;

    if (!userId)
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    const target = await prisma.user.findFirst({
      where: { id: userId, tenantId: user.tenantId },
    });
    if (!target)
      return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (userId === user.sub && isActive === false)
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 });

    if (newPassword && userId === user.sub)
      return NextResponse.json({ error: 'Use your profile settings to change your own password' }, { status: 400 });
    if (newPassword && newPassword.length < 8)
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });

    if (role && !['CHAIRPERSON', 'FARM_ADMIN', 'SUPER_ADMIN'].includes(user.role))
      return NextResponse.json({ error: 'Insufficient permissions to change roles' }, { status: 403 });

    const updateData = {
      ...(isActive  !== undefined && { isActive }),
      ...(role      !== undefined && { role }),
      ...(farmId    !== undefined && { farmId }),
      ...(phone     !== undefined && { phone }),
      ...(firstName                && { firstName: firstName.trim() }),
      ...(lastName                 && { lastName:  lastName.trim() }),
      ...(email                    && { email:     email.toLowerCase().trim() }),
    };

    if (newPassword) {
      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data:  updateData,
    });

    if (penSectionIds !== undefined) {
      await prisma.penWorkerAssignment.updateMany({
        where: { userId },
        data:  { isActive: false },
      });
      if (penSectionIds.length > 0) {
        await prisma.penWorkerAssignment.createMany({
          data: penSectionIds.map(sId => ({
            userId,
            penSectionId: sId,
            isActive:     true,
          })),
          skipDuplicates: true,
        });
        await prisma.penWorkerAssignment.updateMany({
          where: { userId, penSectionId: { in: penSectionIds } },
          data:  { isActive: true },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     role ? 'ROLE_CHANGE' : 'UPDATE',
        entityType: 'User',
        entityId:   userId,
        changes:    { role, isActive, farmId },
      },
    }).catch(() => {});

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
