/**
 * lib/constants/roles.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all role definitions and permission groups
 * in PoultryFarm Pro.
 *
 * NEVER re-declare these arrays inline in pages or API routes.
 * Import the appropriate group constant instead.
 *
 * Usage (client pages):
 *   import { MANAGER_ROLES, isManager } from '@/lib/constants/roles';
 *
 * Usage (API routes):
 *   import { MANAGER_ROLES } from '@/lib/constants/roles';
 */

// ─── All valid roles in the system ───────────────────────────────────────────

export const ALL_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'STORE_MANAGER',
  'FEED_MILL_MANAGER',
  'PEN_MANAGER',
  'STORE_CLERK',
  'QC_TECHNICIAN',
  'PRODUCTION_STAFF',
  'PEN_WORKER',
];

// ─── Permission groups ────────────────────────────────────────────────────────

/**
 * Full management access — can create, edit, delete most records,
 * approve POs, manage users, and access financial data.
 */
export const MANAGER_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'STORE_MANAGER',
];

/**
 * Senior leadership — own the farm or the organisation.
 * Access to billing, analytics, and final approval flows.
 */
export const LEADERSHIP_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
];

/**
 * Can manage farm operations: flocks, health, feed, structure.
 * Cannot access billing or user administration.
 */
export const OPERATIONS_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'PEN_MANAGER',
];

/**
 * Can access feed and store features.
 */
export const STORE_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'STORE_MANAGER',
  'STORE_CLERK',
];

/**
 * Can access feed mill features.
 */
export const FEED_MILL_ROLES = [
  'SUPER_ADMIN',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'FEED_MILL_MANAGER',
  'QC_TECHNICIAN',
  'PRODUCTION_STAFF',
];

/**
 * Can perform verification and reconciliation.
 */
export const VERIFIER_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'STORE_MANAGER',
  'STORE_CLERK',
];

/**
 * Field workers — daily check-in, task completion.
 * Access is limited to the worker portal.
 */
export const WORKER_ROLES = [
  'PEN_WORKER',
  'PEN_MANAGER',
  'PRODUCTION_STAFF',
  'STORE_CLERK',
  'QC_TECHNICIAN',
];

/**
 * Roles that can create and manage other user accounts.
 */
export const USER_ADMIN_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
];

/**
 * Roles that can approve or reject purchase orders.
 */
export const PO_APPROVAL_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
  'STORE_MANAGER',
];

// ─── Human-readable role labels ───────────────────────────────────────────────

export const ROLE_LABELS = {
  SUPER_ADMIN:       'Super Admin',
  CHAIRPERSON:       'Chairperson',
  FARM_ADMIN:        'Farm Admin',
  FARM_MANAGER:      'Farm Manager',
  STORE_MANAGER:     'Store Manager',
  FEED_MILL_MANAGER: 'Feed Mill Manager',
  PEN_MANAGER:       'Pen Manager',
  STORE_CLERK:       'Store Clerk',
  QC_TECHNICIAN:     'QC Technician',
  PRODUCTION_STAFF:  'Production Staff',
  PEN_WORKER:        'Pen Worker',
};

/** Returns the human-readable label for a role string. */
export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// ─── Permission helpers ───────────────────────────────────────────────────────

/** True if the role has full management permissions. */
export function isManager(role) {
  return MANAGER_ROLES.includes(role);
}

/** True if the role has leadership / owner-level access. */
export function isLeadership(role) {
  return LEADERSHIP_ROLES.includes(role);
}

/** True if the role is a field worker (limited portal access). */
export function isWorker(role) {
  return WORKER_ROLES.includes(role);
}

/** True if the role can approve purchase orders. */
export function canApprovePO(role) {
  return PO_APPROVAL_ROLES.includes(role);
}

/** True if the role can administer users. */
export function canAdminUsers(role) {
  return USER_ADMIN_ROLES.includes(role);
}
