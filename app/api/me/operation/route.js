// app/api/me/operation/route.js
// GET — Returns the current user's operation type, pen purposes, and active flock stages.
//
// flockStages drives Brooding nav visibility:
//   flockStages.includes('BROODING') → show Brooding nav
//   operationType === 'LAYER'        → show Rearing nav

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const PEN_SCOPED_ROLES = ['PEN_WORKER', 'PEN_MANAGER'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!PEN_SCOPED_ROLES.includes(user.role)) {
    return NextResponse.json({ operationType: null, penPurposes: [], flockStages: [] });
  }

  try {
    // Step 1 — get assigned section IDs + pen metadata
    const assignments = await prisma.penWorkerAssignment.findMany({
      where:  { userId: user.sub, isActive: true },
      select: {
        penSection: {
          select: {
            id:  true,
            pen: { select: { operationType: true, penPurpose: true } },
          },
        },
      },
    });

    if (assignments.length === 0) {
      return NextResponse.json({ operationType: null, penPurposes: [], flockStages: [] });
    }

    const sectionIds = assignments.map(a => a.penSection?.id).filter(Boolean);
    const opTypes    = [...new Set(assignments.map(a => a.penSection?.pen?.operationType).filter(Boolean))];
    const purposes   = [...new Set(assignments.map(a => a.penSection?.pen?.penPurpose).filter(Boolean))];

    // Step 2 — separately fetch active flock stages for these sections
    // (Prisma doesn't support include inside select in the same query)
    const activeFlocks = await prisma.flock.findMany({
      where:  { penSectionId: { in: sectionIds }, status: 'ACTIVE' },
      select: { stage: true },
    });

    const stages = [...new Set(activeFlocks.map(f => f.stage).filter(Boolean))];
    const operationType = opTypes.length === 1 ? opTypes[0] : null;

    return NextResponse.json({ operationType, penPurposes: purposes, flockStages: stages });
  } catch (err) {
    console.error('GET /api/me/operation error:', err);
    return NextResponse.json({ error: 'Failed', detail: err?.message }, { status: 500 });
  }
}
