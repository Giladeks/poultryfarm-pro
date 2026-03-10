// app/api/finance/suppliers/route.js
// GET — returns all active suppliers for use in AP invoice creation dropdowns
// Gated on FINANCE_VIEW_ROLES so Accountant and IC Officer can access them.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const suppliers = await prisma.supplier.findMany({
      where:   { tenantId: user.tenantId, isActive: true },
      select:  { id: true, name: true, supplierType: true, contactName: true, phone: true, email: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ suppliers });
  } catch (err) {
    console.error('[FINANCE SUPPLIERS GET]', err);
    return NextResponse.json({ error: 'Failed to load suppliers' }, { status: 500 });
  }
}
