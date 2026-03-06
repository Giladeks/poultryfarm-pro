// app/api/auth/login/route.js
import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret');

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password)
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      include: {
        tenant: { include: { subscription: { include: { plan: true } } } },
        farm: { select: { id: true, name: true } },
        penAssignments: {
          where: { isActive: true },
          include: {
            penSection: {
              include: { pen: { select: { id: true, name: true, operationType: true } } },
            },
          },
          take: 1,
        },
      },
    });

    if (!user)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    if (user.tenant.status === 'SUSPENDED')
      return NextResponse.json({ error: 'Your farm account has been suspended. Please contact support.' }, { status: 403 });

    // Primary pen section for workers (first assignment)
    const primarySection = user.penAssignments[0]?.penSection || null;

    const token = await new SignJWT({
      sub: user.id,
      tenantId: user.tenantId,
      farmId: user.farmId,
      role: user.role,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Audit login
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
      },
    }).catch(() => {});

    const response = NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        farmId: user.farmId,
        farmName: user.farm?.name || user.tenant.farmName,
        tenantName: user.tenant.farmName,
        subdomain: user.tenant.subdomain,
        defaultCurrency: user.tenant.defaultCurrency,
        primarySection: primarySection
          ? { id: primarySection.id, name: primarySection.name, penName: primarySection.pen.name, operationType: primarySection.pen.operationType }
          : null,
        plan: user.tenant.subscription?.plan?.name || 'Trial',
      },
    });

    response.cookies.set('pfp_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
