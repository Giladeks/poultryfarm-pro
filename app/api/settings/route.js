// app/api/settings/route.js — Tenant-level settings (SMS + Email config, alert preferences, Operation Mode)
// GET  — returns current settings for this tenant
// PATCH — updates settings (FARM_ADMIN / FARM_MANAGER / CHAIRPERSON / SUPER_ADMIN only)
//
// Requires `settings Json? @default("{}")` on the Tenant model in schema.prisma

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ADMIN_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

const DEFAULT_SETTINGS = {
  // ── Phase 8A: Operation Mode ─────────────────────────────────────────────────
  // operationMode drives nav visibility, dashboards, task templates and reports.
  // hasFeedMillModule / hasProcessingModule are optional add-on flags.
  operationMode:        'LAYER_ONLY', // LAYER_ONLY | BROILER_ONLY | BOTH
  hasFeedMillModule:    false,
  hasProcessingModule:  false,

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
      select: {
        settings: true,
        // Core tenant fields used to pre-populate Farm Profile when
        // settings.farmProfile has not yet been explicitly saved
        farmName: true,
        address:  true,
        phone:    true,
        email:    true,
        logoUrl:  true,
      },
    });

    const settings = deepMerge(DEFAULT_SETTINGS, tenant?.settings || {});

    // Expose tenant core fields so the client can fall back to them
    // when settings.farmProfile fields are empty
    const tenantDefaults = {
      farmName: tenant?.farmName || null,
      address:  tenant?.address  || null,
      phone:    tenant?.phone    || null,
      email:    tenant?.email    || null,
      logoUrl:  tenant?.logoUrl  || null,
    };

    return NextResponse.json({ settings, tenantDefaults });
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

    // Validate operationMode if it's being changed
    if (body.operationMode !== undefined) {
      const valid = ['LAYER_ONLY', 'BROILER_ONLY', 'BOTH'];
      if (!valid.includes(body.operationMode)) {
        return NextResponse.json({ error: 'Invalid operationMode value' }, { status: 400 });
      }
    }

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
