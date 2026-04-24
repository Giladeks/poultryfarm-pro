// middleware.js — Edge middleware: protects routes, enforces role-based access
import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret'
);

// Routes that don't need authentication
const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/billing/webhook',
];

// Role-based route restrictions
const ROLE_ROUTES = {
  '/owner':                 ['CHAIRPERSON', 'SUPER_ADMIN'],
  '/billing':               ['CHAIRPERSON', 'FARM_ADMIN', 'SUPER_ADMIN'],
  '/farm':                  ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'PEN_MANAGER', 'SUPER_ADMIN'],
  '/farm-structure':        ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'PEN_MANAGER', 'SUPER_ADMIN'],
  '/health':                ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'PEN_MANAGER', 'SUPER_ADMIN'],
  '/feed-changes':          ['PEN_MANAGER', 'STORE_MANAGER', 'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/feed-requisitions':     ['PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', 'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/feed':                  ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', 'INTERNAL_CONTROL', 'SUPER_ADMIN'],
  '/users':                 ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/eggs':                  ['PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/mortality':             ['PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/reports':               ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'STORE_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/audit':                 ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL'],
  '/verification':          ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'PEN_MANAGER', 'STORE_MANAGER', 'SUPER_ADMIN'],
  '/production/layers':     ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/production/broilers':   ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/egg-store':             ['STORE_MANAGER', 'STORE_CLERK', 'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/store':                 ['STORE_MANAGER', 'STORE_CLERK', 'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/settings':              ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/pen-manager':           ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/rearing':               ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/brooding':              ['PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
  '/finance':               ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'ACCOUNTANT', 'INTERNAL_CONTROL'],
};

// Default landing page per role
const ROLE_HOME = {
  CHAIRPERSON:        '/owner',
  FARM_ADMIN:         '/dashboard',
  FARM_MANAGER:       '/dashboard',
  PEN_MANAGER:        '/dashboard',
  PEN_WORKER:         '/dashboard',
  STORE_MANAGER:      '/dashboard',
  FEED_MILL_MANAGER:  '/dashboard',
  STORE_CLERK:        '/dashboard',
  QC_TECHNICIAN:      '/dashboard',
  PRODUCTION_STAFF:   '/dashboard',
  SUPER_ADMIN:        '/dashboard',
  INTERNAL_CONTROL:   '/dashboard',
  ACCOUNTANT:         '/dashboard',
};

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Always allow public routes and static assets
  if (
    PUBLIC_ROUTES.some(r => pathname.startsWith(r)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public')
  ) {
    return NextResponse.next();
  }

  // Get token from cookie or Authorization header
  const token =
    request.cookies.get('pfp_token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '');

  // No token → redirect to login
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify token
  let payload;
  try {
    const result = await jwtVerify(token, JWT_SECRET);
    payload = result.payload;
  } catch {
    // Invalid/expired token
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 });
    }
    const response = NextResponse.redirect(new URL('/auth/login', request.url));
    response.cookies.delete('pfp_token');
    return response;
  }

  // Check role-based access for specific routes
  for (const [route, allowedRoles] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(route) && !allowedRoles.includes(payload.role)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      // Redirect to their home page instead of showing 403
      const home = ROLE_HOME[payload.role] || '/dashboard';
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  // Forward user info to page/API via headers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id',       payload.sub);
  requestHeaders.set('x-user-role',     payload.role);
  requestHeaders.set('x-tenant-id',     payload.tenantId);
  requestHeaders.set('x-user-email',    payload.email);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
