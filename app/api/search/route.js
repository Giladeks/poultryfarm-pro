// app/api/search/route.js — Global cross-entity search
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'PEN_MANAGER'];
const STORE_ROLES   = ['STORE_MANAGER', 'STORE_CLERK'];

// Map entity type → the page href to navigate to
function hrefFor(type, entity) {
  switch (type) {
    case 'pen':       return '/farm-structure';
    case 'section':   return '/farm-structure';
    case 'flock':     return '/farm';
    case 'user':      return '/users';
    case 'supplier':  return '/feed';
    case 'inventory': return '/feed';
    default:          return '/dashboard';
  }
}

// Score a result — exact prefix match scores higher than substring match
function score(text, q) {
  const t = (text || '').toLowerCase();
  const s = q.toLowerCase();
  if (t === s)              return 100;
  if (t.startsWith(s))     return 80;
  if (t.includes(s))       return 50;
  return 0;
}

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  if (q.length < 2) return NextResponse.json({ results: [] });

  const tid = user.tenantId;
  const isManager = MANAGER_ROLES.includes(user.role);
  const isStore   = STORE_ROLES.includes(user.role);

  try {
    const [pens, sections, flocks, users, suppliers, inventory] = await Promise.all([
      // Pens
      isManager ? prisma.pen.findMany({
        where: {
          farm: { tenantId: tid },
          name: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true, name: true, operationType: true, capacity: true,
          farm: { select: { name: true } },
          _count: { select: { sections: true } },
        },
        take: 8,
      }) : [],

      // Sections
      isManager ? prisma.penSection.findMany({
        where: {
          pen: { farm: { tenantId: tid } },
          name: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true, name: true, capacity: true, currentBirds: true,
          pen: { select: { name: true, operationType: true, farm: { select: { name: true } } } },
        },
        take: 8,
      }) : [],

      // Flocks
      isManager ? prisma.flock.findMany({
        where: {
          tenantId: tid,
          status: { not: 'ARCHIVED' },
          OR: [
            { batchCode: { contains: q, mode: 'insensitive' } },
            { strain:    { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true, batchCode: true, strain: true, status: true,
          operationType: true, currentCount: true,
          penSection: { select: { name: true, pen: { select: { name: true } } } },
        },
        take: 8,
      }) : [],

      // Users — managers can search all, workers only see themselves
      isManager ? prisma.user.findMany({
        where: {
          tenantId: tid,
          isActive: true,
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName:  { contains: q, mode: 'insensitive' } },
            { email:     { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true, firstName: true, lastName: true, email: true, role: true,
        },
        take: 6,
      }) : [],

      // Suppliers — store roles + managers
      (isManager || isStore) ? prisma.supplier.findMany({
        where: {
          tenantId: tid,
          isActive: true,
          name: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true, name: true, contactName: true, phone: true, email: true,
        },
        take: 5,
      }) : [],

      // Feed inventory items
      (isManager || isStore) ? prisma.feedInventory.findMany({
        where: {
          store: { farm: { tenantId: tid } },
          feedType: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true, feedType: true, currentStockKg: true, reorderThresholdKg: true,
          store: { select: { name: true } },
        },
        take: 5,
      }) : [],
    ]);

    // ── Shape results ─────────────────────────────────────────────────────────
    const results = [];

    pens.forEach(p => {
      const s = Math.max(score(p.name, q));
      if (s > 0) results.push({
        type:    'pen',
        id:      p.id,
        title:   p.name,
        sub:     `${p.farm.name} · ${p._count.sections} sections · ${p.capacity} capacity`,
        icon:    p.operationType === 'LAYER' ? '🥚' : '🍗',
        href:    hrefFor('pen', p),
        score:   s,
      });
    });

    sections.forEach(s => {
      const sc = score(s.name, q);
      if (sc > 0) results.push({
        type:  'section',
        id:    s.id,
        title: s.name,
        sub:   `${s.pen.farm.name} › ${s.pen.name} · ${s.currentBirds ?? 0} birds`,
        icon:  s.pen.operationType === 'LAYER' ? '🏠' : '🏚',
        href:  hrefFor('section', s),
        score: sc,
      });
    });

    flocks.forEach(f => {
      const sc = Math.max(score(f.batchCode, q), score(f.strain, q));
      if (sc > 0) results.push({
        type:  'flock',
        id:    f.id,
        title: f.batchCode,
        sub:   `${f.strain || '—'} · ${f.penSection?.pen?.name ?? ''} › ${f.penSection?.name ?? ''} · ${f.currentCount} birds`,
        icon:  f.operationType === 'LAYER' ? '🐔' : '🐣',
        href:  hrefFor('flock', f),
        badge: f.status,
        score: sc,
      });
    });

    users.forEach(u => {
      const sc = Math.max(score(`${u.firstName} ${u.lastName}`, q), score(u.email, q));
      if (sc > 0) results.push({
        type:  'user',
        id:    u.id,
        title: `${u.firstName} ${u.lastName}`,
        sub:   `${u.role.replace(/_/g, ' ')} · ${u.email}`,
        icon:  '👤',
        href:  hrefFor('user', u),
        score: sc,
      });
    });

    suppliers.forEach(s => {
      const sc = score(s.name, q);
      if (sc > 0) results.push({
        type:  'supplier',
        id:    s.id,
        title: s.name,
        sub:   [s.contactName, s.phone].filter(Boolean).join(' · '),
        icon:  '🚚',
        href:  hrefFor('supplier', s),
        score: sc,
      });
    });

    inventory.forEach(i => {
      const sc = score(i.feedType, q);
      if (sc > 0) {
        const low = i.currentStockKg <= (i.reorderThresholdKg ?? 0);
        results.push({
          type:  'inventory',
          id:    i.id,
          title: i.feedType,
          sub:   `${i.store.name} · ${Number(i.currentStockKg).toFixed(0)} kg in stock${low ? ' · ⚠ Low stock' : ''}`,
          icon:  '🌾',
          href:  hrefFor('inventory', i),
          score: sc,
        });
      }
    });

    // Sort by score desc, then alpha
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    return NextResponse.json({ results: results.slice(0, 20) });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
