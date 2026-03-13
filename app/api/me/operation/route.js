// app/api/me/operation/route.js
// GET — Returns the current user's operation type derived from their live pen assignments.
//
// Only meaningful for PEN_WORKER and PEN_MANAGER roles. For all other roles returns null
// (they are not scoped to a single operation and see the full nav).
//
// Called by AppShell every 30 seconds for pen-scoped roles so that reassignments are
// reflected without requiring a logout. Fast query — single join, no aggregations.
//
// Response shape:
//   { operationType: 'LAYER' | 'BROILER' | null }
//
// operationType is null when:
//   - The user's role is not PEN_WORKER or PEN_MANAGER
//   - The user has no active pen assignments yet
//   - Their assigned pens have mixed operation types (edge case — show all in that case)

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const PEN_SCOPED_ROLES = ['PEN_WORKER', 'PEN_MANAGER'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Non-pen-scoped roles: return null immediately — no DB query needed
  if (!PEN_SCOPED_ROLES.includes(user.role)) {
    return NextResponse.json({ operationType: null });
  }

  try {
    // Fetch all active pen assignments for this user, pulling operationType from the pen
    const assignments = await prisma.penWorkerAssignment.findMany({
      where: { userId: user.sub },
      select: {
        penSection: {
          select: {
            pen: { select: { operationType: true } },
          },
        },
      },
    });

    if (assignments.length === 0) {
      return NextResponse.json({ operationType: null });
    }

    // Collect unique operation types across all assigned pens
    const opTypes = [...new Set(
      assignments
        .map(a => a.penSection?.pen?.operationType)
        .filter(Boolean)
    )];

    // Single operation type → return it; mixed (edge case) → return null (show all)
    const operationType = opTypes.length === 1 ? opTypes[0] : null;

    return NextResponse.json({ operationType });
  } catch (err) {
    console.error('GET /api/me/operation error:', err);
    return NextResponse.json({ error: 'Failed to fetch operation type' }, { status: 500 });
  }
}
