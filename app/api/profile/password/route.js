// app/api/profile/password/route.js
// PATCH — change own password (requires current password verification)
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import bcrypt           from 'bcryptjs';
import { z }            from 'zod';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8).max(128),
});

export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = schema.parse(body);

    const dbUser = await prisma.user.findUnique({
      where:  { id: user.sub },
      select: { id: true, passwordHash: true },
    });
    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const match = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!match)
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.sub },
      data:  { passwordHash: newHash },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'PASSWORD_CHANGE',
        entityType: 'User',
        entityId:   user.sub,
        changes:    {},
      },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('Password change error:', err);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
