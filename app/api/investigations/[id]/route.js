// app/api/investigations/[id]/route.js
import { NextResponse }  from 'next/server';
import { prisma }        from '@/lib/db/prisma';
import { verifyToken }   from '@/lib/middleware/auth';

const IC_ROLES      = ['INTERNAL_CONTROL', 'SUPER_ADMIN'];
const RESOLVE_ROLES = ['CHAIRPERSON', 'FARM_ADMIN', 'SUPER_ADMIN'];
const VIEW_ROLES    = ['INTERNAL_CONTROL', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// GET /api/investigations/[id]
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const investigation = await prisma.investigation.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        flaggedBy:   { select: { id: true, firstName: true, lastName: true, role: true } },
        escalatedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
        resolvedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });
    if (!investigation)
      return NextResponse.json({ error: 'Investigation not found' }, { status: 404 });

    return NextResponse.json({ investigation });
  } catch (err) {
    console.error('[investigations/[id] GET]', err);
    return NextResponse.json({ error: 'Failed to load investigation' }, { status: 500 });
  }
}

// PATCH /api/investigations/[id]
// Supported actions:
//   { action: 'review' }                                    — IC marks UNDER_REVIEW
//   { action: 'escalate', escalatedToId?, findings? }      — IC escalates to Chairperson
//   { action: 'close',    findings }                        — Chairperson/FarmAdmin closes
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body   = await request.json();
    const { action, findings, escalatedToId } = body;

    const inv = await prisma.investigation.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!inv) return NextResponse.json({ error: 'Investigation not found' }, { status: 404 });

    let update = {};

    if (action === 'review') {
      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only IC Officers can mark under review' }, { status: 403 });
      if (inv.status !== 'OPEN')
        return NextResponse.json({ error: 'Can only review OPEN investigations' }, { status: 400 });
      update = { status: 'UNDER_REVIEW' };
    }

    else if (action === 'escalate') {
      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only IC Officers can escalate' }, { status: 403 });
      if (!['OPEN','UNDER_REVIEW'].includes(inv.status))
        return NextResponse.json({ error: 'Can only escalate OPEN or UNDER_REVIEW investigations' }, { status: 400 });

      // If escalatedToId not provided, find the first Chairperson in the tenant
      let targetId = escalatedToId || null;
      if (!targetId) {
        const chair = await prisma.user.findFirst({
          where: { tenantId: user.tenantId, role: 'CHAIRPERSON', isActive: true },
          select: { id: true },
        });
        targetId = chair?.id || null;
      }

      update = {
        status:       'ESCALATED',
        escalatedToId: targetId,
        escalatedAt:  new Date(),
        ...(findings?.trim() && { findings: findings.trim() }),
      };
    }

    else if (action === 'close') {
      if (![...IC_ROLES, ...RESOLVE_ROLES].includes(user.role))
        return NextResponse.json({ error: 'Insufficient permissions to close investigation' }, { status: 403 });
      if (!findings?.trim())
        return NextResponse.json({ error: 'findings are required to close an investigation' }, { status: 400 });

      update = {
        status:      'CLOSED',
        findings:    findings.trim(),
        resolvedById: user.id,
        resolvedAt:  new Date(),
      };
    }

    else {
      return NextResponse.json({ error: 'Invalid action. Must be review | escalate | close' }, { status: 400 });
    }

    const investigation = await prisma.investigation.update({
      where: { id: params.id },
      data:  update,
      include: {
        flaggedBy:   { select: { id: true, firstName: true, lastName: true, role: true } },
        escalatedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
        resolvedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    return NextResponse.json({ investigation });
  } catch (err) {
    console.error('[investigations/[id] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update investigation' }, { status: 500 });
  }
}
