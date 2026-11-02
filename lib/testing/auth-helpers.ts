/**
 * Authentication & Authorization Test Helpers
 *
 * Provides utilities for:
 * - Looking up seed test users by role or email
 * - Creating mock user sessions and auth headers for Vitest / Playwright tests
 * - Emulating active role switching for development & test harnesses
 * - Verifying permission invariants against the CONTRACTS.md Section 4 matrix
 *
 * NON-NEGOTIABLE RULE: Quantities only. Zero price, cost, valuation, tax, or vendor names.
 */

import { SEED_USERS, EXTENDED_SEED_USERS, type SeedUser } from './synthetic-seed';

export type UserRole = SeedUser['role'];

export interface MockAuthSession {
  user: SeedUser;
  token: string;
  expires_at: string;
  store_id: string;
  warehouse_id?: string;
  section_id?: string;
}

export type OperationalAction =
  | 'INVITE_USERS_RESET_PASSWORD'
  | 'CONFIGURE_ISSUE_WINDOWS'
  | 'DEFINE_EXPIRY_GROUPS'
  | 'IMPORT_SAP_GRPO'
  | 'CREATE_SECTION_REQUEST'
  | 'AMEND_CANCEL_PENDING_REQUEST'
  | 'PICK_STAGE_STOCK'
  | 'CONFIRM_RECEIPT_AT_DOOR'
  | 'PERFORM_DAILY_BENCHMARK_COUNT'
  | 'SIGN_SHIFT_HANDOVER'
  | 'CONDUCT_PERIODIC_STOCK_COUNT'
  | 'SUBMIT_POST_CUTOFF_ADJUSTMENT'
  | 'APPROVE_STOCK_ADJUSTMENT'
  | 'LOG_WASTE_DISPOSAL'
  | 'APPROVE_WASTE_DISPOSAL'
  | 'DISPATCH_RECEIVE_TRANSFER'
  | 'APPROVE_TRANSFER_DISCREPANCY'
  | 'REQUEST_NEW_STORE_WAREHOUSE'
  | 'APPROVE_NEW_STORE_WAREHOUSE';

/**
 * Role-by-Action Permission Matrix ground truth from CONTRACTS.md (§4).
 */
export const ROLE_PERMISSIONS_MATRIX: Readonly<Record<OperationalAction, readonly UserRole[]>> = {
  INVITE_USERS_RESET_PASSWORD: ['SYSTEM_ADMIN'],
  CONFIGURE_ISSUE_WINDOWS: ['ADMIN', 'APPROVER'],
  DEFINE_EXPIRY_GROUPS: ['ADMIN', 'APPROVER'],
  IMPORT_SAP_GRPO: ['ADMIN'],
  CREATE_SECTION_REQUEST: ['KITCHEN_REQ', 'BAR_REQ', 'CHEESE_REQ'],
  AMEND_CANCEL_PENDING_REQUEST: ['KITCHEN_REQ', 'BAR_REQ', 'CHEESE_REQ'],
  PICK_STAGE_STOCK: ['ADMIN', 'CUSTODIAN'],
  CONFIRM_RECEIPT_AT_DOOR: ['RUNNER'], // Note: Q8 allows Requester acting as Runner if profile associated
  PERFORM_DAILY_BENCHMARK_COUNT: ['ADMIN', 'CUSTODIAN'],
  SIGN_SHIFT_HANDOVER: ['ADMIN', 'RM', 'CUSTODIAN'],
  CONDUCT_PERIODIC_STOCK_COUNT: ['ADMIN', 'CUSTODIAN', 'ACCOUNTANT'],
  SUBMIT_POST_CUTOFF_ADJUSTMENT: ['ACCOUNTANT'],
  APPROVE_STOCK_ADJUSTMENT: ['APPROVER'],
  LOG_WASTE_DISPOSAL: ['ADMIN', 'KITCHEN_REQ', 'BAR_REQ', 'CHEESE_REQ', 'CUSTODIAN'],
  APPROVE_WASTE_DISPOSAL: ['RM', 'APPROVER'],
  DISPATCH_RECEIVE_TRANSFER: ['ADMIN', 'CUSTODIAN'],
  APPROVE_TRANSFER_DISCREPANCY: ['APPROVER'],
  REQUEST_NEW_STORE_WAREHOUSE: ['ADMIN', 'RM'],
  APPROVE_NEW_STORE_WAREHOUSE: ['APPROVER'],
};

/**
 * Finds a test user by their role.
 */
export function getTestUserByRole(role: UserRole): SeedUser {
  const user = EXTENDED_SEED_USERS.find((u) => u.role === role);
  if (!user) {
    throw new Error(`No test user found for role: ${role}`);
  }
  return user;
}

/**
 * Finds a test user by their email address.
 */
export function getTestUserByEmail(email: string): SeedUser {
  const user = EXTENDED_SEED_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    throw new Error(`No test user found for email: ${email}`);
  }
  return user;
}

/**
 * Verifies whether a role is authorized to perform an operational action.
 */
export function canRolePerformAction(role: UserRole, action: OperationalAction): boolean {
  const allowedRoles = ROLE_PERMISSIONS_MATRIX[action];
  return allowedRoles ? allowedRoles.includes(role) : false;
}

/**
 * Generates a mock authentication token for test scenarios.
 */
export function generateMockToken(user: SeedUser): string {
  const payload = {
    sub: user.user_id,
    email: user.email,
    role: user.role,
    store_id: user.store_id,
    warehouse_id: user.warehouse_id,
    section_id: user.section_id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // +24 hours
  };
  return `mock-jwt.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

/**
 * Creates a mock session for a given user or role.
 */
export function createMockSession(
  userOrRole: SeedUser | UserRole,
  overrides?: Partial<MockAuthSession>
): MockAuthSession {
  const user = typeof userOrRole === 'string' ? getTestUserByRole(userOrRole) : userOrRole;
  const token = generateMockToken(user);
  const expires_at = new Date(Date.now() + 86400 * 1000).toISOString();

  return {
    user,
    token,
    expires_at,
    store_id: user.store_id,
    warehouse_id: user.warehouse_id,
    section_id: user.section_id,
    ...overrides,
  };
}

/**
 * Creates mock HTTP headers simulating an authenticated request from a specific role.
 */
export function createMockAuthHeaders(
  userOrRole: SeedUser | UserRole,
  storeId?: string
): Record<string, string> {
  const session = createMockSession(userOrRole, storeId ? { store_id: storeId } : undefined);
  return {
    Authorization: `Bearer ${session.token}`,
    'X-Test-User-Id': session.user.user_id,
    'X-Test-User-Email': session.user.email,
    'X-Test-User-Role': session.user.role,
    'X-Test-Store-Id': session.store_id,
  };
}

/**
 * Emulates dev/testing role switching.
 */
export function switchActiveRole(
  targetRole: UserRole,
  storeId?: string
): MockAuthSession {
  const targetUser = getTestUserByRole(targetRole);
  return createMockSession(targetUser, storeId ? { store_id: storeId } : undefined);
}
