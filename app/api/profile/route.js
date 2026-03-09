// app/api/profile/route.js
// GET  — return own user record
// PATCH — update firstName, lastName, phone, profilePicUrl
//         email is only patchable by FARM_ADMIN / CHAIRPERSON / SUPER_ADMIN
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ADMIN_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const patchSchema = z.object({
  firstName:     z.string().min(1).max(80).optional(),
  lastName:      z.string().min(1).max(80).optional(),
  phone:         z.string().max(30).nullable().optional(),
  profilePicUrl: z.string().url().nullable().optional(),
  // Email only accepted for admin roles — enforced in handler
  email:         z.string().email().optional(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const profile = await prisma.user.findUnique({
      where:  { id: user.sub },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, farmId: true, isActive: true,
        profilePicUrl: true, createdAt: true, lastLoginAt: true,
        farm: { select: { name: true } },
      },
    });
    if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json({ user: profile });
  } catch (err) {
    console.error('Profile GET error:', err);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    // Email changes only allowed for admin roles
    if (data.email !== undefined && !ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'Email address can only be changed by a Farm Admin or Chairperson' },
        { status: 403 }
      );
    }

    const updateData = {
      ...(data.firstName     !== undefined && { firstName:     data.firstName }),
      ...(data.lastName      !== undefined && { lastName:      data.lastName }),
      ...(data.phone         !== undefined && { phone:         data.phone }),
      ...(data.profilePicUrl !== undefined && { profilePicUrl: data.profilePicUrl }),
      ...(data.email         !== undefined && ADMIN_ROLES.includes(user.role) && { email: data.email.toLowerCase() }),
    };

    const updated = await prisma.user.update({
      where: { id: user.sub },
      data:  updateData,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, profilePicUrl: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'User',
        entityId:   user.sub,
        changes:    { fields: Object.keys(updateData) },
      },
    }).catch(() => {});

    return NextResponse.json({ user: updated });
  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    if (err.code === 'P2002')
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    console.error('Profile PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
