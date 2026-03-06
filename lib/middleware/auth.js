// lib/middleware/auth.js — JWT verification & RBAC middleware
import { jwtVerify } from 'jose';
import { NextResponse } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret');

export const ROLE_HIERARCHY = {
  SUPER_ADMIN: 5,
  FARM_OWNER: 4,
  FARM_MANAGER: 3,
  PEN_MANAGER: 2,
  PEN_WORKER: 1,
};

/**
 * Verifies JWT from Authorization header or cookie.
 * Returns decoded payload or null.
 */
export async function verifyToken(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : request.cookies.get('pfp_token')?.value;

    if (!token) return null;

    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Route handler wrapper that enforces authentication + optional role check.
 */
export function withAuth(handler, { minRole = 'PEN_WORKER' } = {}) {
  return async (request, context) => {
    const user = await verifyToken(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0;

    if (userLevel < requiredLevel) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Attach user to request for downstream use
    request.user = user;
    return handler(request, context);
  };
}

/**
 * Checks that the user's tenantId matches the resource being accessed.
 */
export function assertTenant(user, tenantId) {
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.tenantId !== tenantId) {
    throw new Error('Cross-tenant access denied');
  }
  return true;
}
