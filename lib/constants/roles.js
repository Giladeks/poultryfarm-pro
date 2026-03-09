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
  'INTERNAL_CONTROL',   // ← Phase 7: IC Officer
  'ACCOUNTANT',         // ← Phase 7: Accounts
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

/**
 * Roles that can view all verified records (read-only across modules).
 * Internal Control gets full read visibility for audit purposes.
 */
export const AUDIT_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'INTERNAL_CONTROL',
];

/**
 * Roles that can flag records for investigation.
 */
export const INVESTIGATION_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'INTERNAL_CONTROL',
];

/**
 * Roles that can escalate investigations to Chairperson level.
 */
export const IC_ESCALATION_ROLES = [
  'SUPER_ADMIN',
  'INTERNAL_CONTROL',
];

/**
 * Roles that can create and manage financial records (invoices, payments).
 */
export const FINANCE_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'ACCOUNTANT',
];

/**
 * Roles that can approve supplier invoices for payment.
 */
export const INVOICE_APPROVAL_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'FARM_MANAGER',
];

/**
 * Roles that can view financial reports and P&L.
 * Chairperson gets read-only; IC Officer gets read for review.
 */
export const FINANCE_VIEW_ROLES = [
  'SUPER_ADMIN',
  'CHAIRPERSON',
  'FARM_ADMIN',
  'ACCOUNTANT',
  'INTERNAL_CONTROL',
];

/**
 * Roles that can perform bank reconciliation.
 */
export const RECONCILIATION_ROLES = [
  'SUPER_ADMIN',
  'FARM_ADMIN',
  'ACCOUNTANT',
];

// ─── Human-readable role labels ───────────────────────────────────────────────

export const ROLE_LABELS = {
  SUPER_ADMIN:       'Super Admin',
  CHAIRPERSON:       'Chairperson',
  FARM_ADMIN:        'Farm Admin',
  FARM_MANAGER:      'Farm Manager',
  INTERNAL_CONTROL:  'Internal Control',  // ← Phase 7
  ACCOUNTANT:        'Accountant',        // ← Phase 7
  STORE_MANAGER:     'Store Manager',
  FEED_MILL_MANAGER: 'Feed Mill Manager',
  PEN_MANAGER:       'Pen Manager',
  STORE_CLERK:       'Store Clerk',
  QC_TECHNICIAN:     'QC Technician',
  PRODUCTION_STAFF:  'Production Staff',
  PEN_WORKER:        'Pen Worker',
};

// ─── Role descriptions (for User Admin UI) ───────────────────────────────────

export const ROLE_DESCRIPTIONS = {
  SUPER_ADMIN:       'Full system access across all tenants',
  CHAIRPERSON:       'Farm owner — full access, final approvals, financial reports',
  FARM_ADMIN:        'Senior administrator — manages users, settings, and operations',
  FARM_MANAGER:      'Oversees daily operations, approves records and POs',
  INTERNAL_CONTROL:  'Audits records, flags anomalies, escalates to Chairperson',
  ACCOUNTANT:        'Manages invoices, payments, AP/AR and financial reporting',
  STORE_MANAGER:     'Manages inventory, GRNs and stock reconciliation',
  FEED_MILL_MANAGER: 'Manages feed production batches and QC sign-off',
  PEN_MANAGER:       'Supervises pen workers, approves daily pen reports',
  STORE_CLERK:       'Records receipts, issuances and stock counts',
  QC_TECHNICIAN:     'Performs quality tests and certifies batches',
  PRODUCTION_STAFF:  'Operates feed mill equipment, logs production',
  PEN_WORKER:        'Records mortality, feed consumption and egg collection daily',
};

/** Returns the human-readable label for a role string. */
export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

/** Returns the description for a role string. */
export function roleDescription(role) {
  return ROLE_DESCRIPTIONS[role] || '';
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

/** True if the role can view audit logs and flag investigations. */
export function canAudit(role) {
  return AUDIT_ROLES.includes(role);
}

/** True if the role can access financial records. */
export function canAccessFinance(role) {
  return FINANCE_VIEW_ROLES.includes(role);
}

/** True if the role can create/edit invoices. */
export function canManageFinance(role) {
  return FINANCE_ROLES.includes(role);
}

/** True if the role can flag records for IC investigation. */
export function canInvestigate(role) {
  return INVESTIGATION_ROLES.includes(role);
}

/** True if the role can reconcile bank payments. */
export function canReconcile(role) {
  return RECONCILIATION_ROLES.includes(role);
}
