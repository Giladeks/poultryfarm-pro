// app/api/stores/route.js
// GET /api/stores  — list stores (GENERAL type by default, ?type=ALL for all)
// POST /api/stores — create a new store (Farm Admin and above only)

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const READ_ROLES = [
  'PEN_MANAGER',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
  'STORE_MANAGER', 'STORE_CLERK',
  'INTERNAL_CONTROL',
];

const WRITE_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const createStoreSchema = z.object({
  name:      z.string().min(2).max(100),
  storeType: z.enum(['FEED', 'MEDICATION', 'EQUIPMENT', 'PACKAGING', 'GENERAL']),
  location:  z.string().max(200).optional().nullable(),
  managerId: z.string().min(1).optional().nullable(),
});

// ── GET /api/stores ───────────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user)                           return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!READ_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },   { status: 403 });

  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get('type') || 'GENERAL';

  try {
    const stores = await prisma.store.findMany({
      where: {
        farm:     { tenantId: user.tenantId },
        isActive: true,
        ...(typeFilter !== 'ALL' && { storeType: typeFilter }),
      },
      select: {
        id: true, name: true, storeType: true, location: true, managerId: true,
      },
      orderBy: [{ storeType: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ stores });
  } catch (err) {
    console.error('[GET /api/stores]', err);
    return NextResponse.json({ error: 'Failed to load stores', detail: err?.message }, { status: 500 });
  }
}

// ── POST /api/stores ──────────────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user)                             return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!WRITE_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden — Farm Admin or above required' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createStoreSchema.parse(body);

    // Resolve the farm for this tenant
    const farm = await prisma.farm.findFirst({
      where:   { tenantId: user.tenantId, isActive: true },
      select:  { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!farm)
      return NextResponse.json({ error: 'No active farm found for this tenant' }, { status: 404 });

    // Validate manager belongs to this tenant (if provided)
    if (data.managerId) {
      const manager = await prisma.user.findFirst({
        where:  { id: data.managerId, tenantId: user.tenantId, isActive: true },
        select: { id: true },
      });
      if (!manager)
        return NextResponse.json({ error: 'Selected manager not found' }, { status: 404 });
    }

    const store = await prisma.store.create({
      data: {
        farmId:    farm.id,
        name:      data.name.trim(),
        storeType: data.storeType,
        location:  data.location  ?? null,
        managerId: data.managerId ?? null,
        isActive:  true,
      },
      select: {
        id: true, name: true, storeType: true, location: true, managerId: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'Store',
        entityId:   store.id,
        changes:    { name: store.name, storeType: store.storeType, location: store.location },
      },
    }).catch(() => {});

    return NextResponse.json({ store }, { status: 201 });
  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/stores]', err);
    return NextResponse.json({ error: 'Failed to create store', detail: err?.message }, { status: 500 });
  }
}

// ── PATCH /api/stores ─────────────────────────────────────────────────────────
// Body: { id, name?, location?, managerId? }
// storeType is intentionally NOT patchable — changing type has inventory implications.
export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user)                            return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!WRITE_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden — Farm Admin or above required' }, { status: 403 });

  try {
    const body = await request.json();
    const { id, name, location, managerId } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (name !== undefined && name.trim().length < 2)
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 422 });

    // Verify store belongs to this tenant
    const existing = await prisma.store.findFirst({
      where:  { id, farm: { tenantId: user.tenantId }, isActive: true },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    // Validate manager if provided
    if (managerId) {
      const manager = await prisma.user.findFirst({
        where:  { id: managerId, tenantId: user.tenantId, isActive: true },
        select: { id: true },
      });
      if (!manager) return NextResponse.json({ error: 'Selected manager not found' }, { status: 404 });
    }

    const store = await prisma.store.update({
      where: { id },
      data: {
        ...(name      !== undefined && { name:      name.trim() }),
        ...(location  !== undefined && { location:  location || null }),
        ...(managerId !== undefined && { managerId: managerId || null }),
      },
      select: { id: true, name: true, storeType: true, location: true, managerId: true },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'Store',
        entityId:   store.id,
        changes:    { name: store.name, location: store.location, managerId: store.managerId },
      },
    }).catch(() => {});

    return NextResponse.json({ store });
  } catch (err) {
    console.error('[PATCH /api/stores]', err);
    return NextResponse.json({ error: 'Failed to update store', detail: err?.message }, { status: 500 });
  }
}
