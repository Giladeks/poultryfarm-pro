// app/api/settings/route.js — Tenant-level settings (SMS + Email config, alert preferences)
// GET  — returns current settings for this tenant
// PATCH — updates settings (FARM_ADMIN / FARM_MANAGER / CHAIRPERSON / SUPER_ADMIN only)
//
// Requires `settings Json? @default("{}")` on the Tenant model in schema.prisma

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ADMIN_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

const DEFAULT_SETTINGS = {
  sms: {
    enabled:        false,
    alertPhones:    [],
    mortalityAlert: { enabled: true, threshold: 10 },
    lowFeedAlert:   { enabled: true },
    rejectionAlert: { enabled: true },
  },
  // Phase 5.2: email alert preferences
  email: {
    enabled:              true,   // true as long as SMTP_HOST is configured
    lowFeedAlert:         { enabled: true,  daysRemainingThreshold: 14 },
    overdueVaccination:   { enabled: true },
    mortalitySpike:       { enabled: true },
    verificationRejected: { enabled: true },
  },
};

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const tenant = await prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { settings: true },
    });

    const settings = deepMerge(DEFAULT_SETTINGS, tenant?.settings || {});
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('Settings GET error:', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();

    const tenant  = await prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { settings: true },
    });
    const current = deepMerge(DEFAULT_SETTINGS, tenant?.settings || {});
    const updated = deepMerge(current, body);

    await prisma.tenant.update({
      where: { id: user.tenantId },
      data:  { settings: updated },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'TenantSettings',
        entityId:   user.tenantId,
        changes:    { updated: Object.keys(body) },
      },
    }).catch(() => {});

    return NextResponse.json({ settings: updated });
  } catch (err) {
    console.error('Settings PATCH error:', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override ?? {})) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}
