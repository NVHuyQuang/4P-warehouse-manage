import { UserRole } from '../contracts/enums';

/**
 * 10 Canonical Roles from Doc §1.3 Role-by-Action Matrix
 */
export const MATRIX_ROLES = [
  'SYSTEM_ADMIN',
  'ADMIN',
  'RM',
  'SECTION_REQ',
  'RUNNER',
  'CUSTODIAN',
  'SCM',
  'ACCOUNTANT',
  'APPROVER',
  'VIEWER',
] as const;

export type MatrixRole = (typeof MATRIX_ROLES)[number];

export const DOC_ROLE_NAMES: Record<MatrixRole, string> = {
  SYSTEM_ADMIN: 'Sys Admin',
  ADMIN: 'Admin (Keeper)',
  RM: 'RM',
  SECTION_REQ: 'Section Req',
  RUNNER: 'Runner',
  CUSTODIAN: 'Custodian',
  SCM: 'SCM',
  ACCOUNTANT: 'Accountant',
  APPROVER: 'Approver (FC)',
  VIEWER: 'Viewer',
};

export const DOC_ROLE_NAME_TO_KEY: Record<string, MatrixRole> = {
  'Sys Admin': 'SYSTEM_ADMIN',
  'Admin (Keeper)': 'ADMIN',
  RM: 'RM',
  'Section Req': 'SECTION_REQ',
  Runner: 'RUNNER',
  Custodian: 'CUSTODIAN',
  SCM: 'SCM',
  Accountant: 'ACCOUNTANT',
  'Approver (FC)': 'APPROVER',
  Viewer: 'VIEWER',
};

/**
 * 19 Operational Actions from Doc §1.3
 */
export const OperationalAction = {
  INVITE_USERS_AND_RESET_PASSWORD: 'Invite Users & Reset Password',
  CONFIGURE_STORE_ISSUE_WINDOWS: 'Configure Store Issue Windows',
  DEFINE_EXPIRY_TRACKING_GROUPS: 'Define Expiry Tracking Groups',
  IMPORT_SAP_GRPO_EXPORT_FILE: 'Import SAP GRPO Export File',
  CREATE_SECTION_STOCK_REQUEST: 'Create Section Stock Request',
  AMEND_CANCEL_PENDING_REQUEST: 'Amend / Cancel Pending Request',
  PICK_STAGE_STOCK_FROM_STOREROOM: 'Pick & Stage Stock from Storeroom',
  CONFIRM_RECEIPT_AT_STOREROOM_DOOR: 'Confirm Receipt at Storeroom Door',
  PERFORM_DAILY_BENCHMARK_COUNT: 'Perform Daily Benchmark Count',
  SIGN_SHIFT_HANDOVER: 'Sign Shift Handover (Key/Log)',
  CONDUCT_PERIODIC_STOCK_COUNT: 'Conduct Periodic Stock Count',
  SUBMIT_POST_CUTOFF_ADJUSTMENT: 'Submit Post-Cutoff Adjustment',
  APPROVE_STOCK_ADJUSTMENT_VOUCHER: 'Approve Stock Adjustment Voucher',
  LOG_WASTE_DISPOSAL_MOVEMENT: 'Log Waste Disposal Movement',
  APPROVE_WASTE_DISPOSAL_CLAIM: 'Approve Waste Disposal Claim',
  DISPATCH_RECEIVE_STORE_TRANSFER: 'Dispatch / Receive Store Transfer',
  APPROVE_TRANSFER_DISCREPANCY: 'Approve Transfer Discrepancy',
  REQUEST_NEW_STORE_OR_WAREHOUSE: 'Request New Store or Warehouse',
  APPROVE_NEW_STORE_OR_WAREHOUSE: 'Approve New Store or Warehouse',
} as const;

export type OperationalActionKey = keyof typeof OperationalAction;
export type OperationalActionName = (typeof OperationalAction)[OperationalActionKey];

export const OPERATIONAL_ACTION_KEYS = Object.keys(OperationalAction) as OperationalActionKey[];

export const DOC_ACTION_NAME_TO_KEY: Record<string, OperationalActionKey> = {
  'Invite Users & Reset Password': 'INVITE_USERS_AND_RESET_PASSWORD',
  'Configure Store Issue Windows': 'CONFIGURE_STORE_ISSUE_WINDOWS',
  'Define Expiry Tracking Groups': 'DEFINE_EXPIRY_TRACKING_GROUPS',
  'Import SAP GRPO Export File': 'IMPORT_SAP_GRPO_EXPORT_FILE',
  'Create Section Stock Request': 'CREATE_SECTION_STOCK_REQUEST',
  'Amend / Cancel Pending Request': 'AMEND_CANCEL_PENDING_REQUEST',
  'Pick & Stage Stock from Storeroom': 'PICK_STAGE_STOCK_FROM_STOREROOM',
  'Confirm Receipt at Storeroom Door': 'CONFIRM_RECEIPT_AT_STOREROOM_DOOR',
  'Perform Daily Benchmark Count': 'PERFORM_DAILY_BENCHMARK_COUNT',
  'Sign Shift Handover (Key/Log)': 'SIGN_SHIFT_HANDOVER',
  'Conduct Periodic Stock Count': 'CONDUCT_PERIODIC_STOCK_COUNT',
  'Submit Post-Cutoff Adjustment': 'SUBMIT_POST_CUTOFF_ADJUSTMENT',
  'Approve Stock Adjustment Voucher': 'APPROVE_STOCK_ADJUSTMENT_VOUCHER',
  'Log Waste Disposal Movement': 'LOG_WASTE_DISPOSAL_MOVEMENT',
  'Approve Waste Disposal Claim': 'APPROVE_WASTE_DISPOSAL_CLAIM',
  'Dispatch / Receive Store Transfer': 'DISPATCH_RECEIVE_STORE_TRANSFER',
  'Approve Transfer Discrepancy': 'APPROVE_TRANSFER_DISCREPANCY',
  'Request New Store or Warehouse': 'REQUEST_NEW_STORE_OR_WAREHOUSE',
  'Approve New Store or Warehouse': 'APPROVE_NEW_STORE_OR_WAREHOUSE',
};

/**
 * Concrete Role-by-Action Matrix Data Structure
 * Encodes Doc §1.3 Ground Truth exactly (19 Actions x 10 Roles).
 */
export const ROLE_ACTION_MATRIX: Record<OperationalActionKey, Record<MatrixRole, boolean>> = {
  INVITE_USERS_AND_RESET_PASSWORD: {
    SYSTEM_ADMIN: true,
    ADMIN: false,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  CONFIGURE_STORE_ISSUE_WINDOWS: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: true,
    VIEWER: false,
  },
  DEFINE_EXPIRY_TRACKING_GROUPS: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: true,
    VIEWER: false,
  },
  IMPORT_SAP_GRPO_EXPORT_FILE: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  CREATE_SECTION_STOCK_REQUEST: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: true,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  AMEND_CANCEL_PENDING_REQUEST: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: true,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  PICK_STAGE_STOCK_FROM_STOREROOM: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: true,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  CONFIRM_RECEIPT_AT_STOREROOM_DOOR: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: false,
    RUNNER: true,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  PERFORM_DAILY_BENCHMARK_COUNT: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: true,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  SIGN_SHIFT_HANDOVER: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: true,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: true,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  CONDUCT_PERIODIC_STOCK_COUNT: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: true,
    SCM: false,
    ACCOUNTANT: true,
    APPROVER: false,
    VIEWER: false,
  },
  SUBMIT_POST_CUTOFF_ADJUSTMENT: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: true,
    APPROVER: false,
    VIEWER: false,
  },
  APPROVE_STOCK_ADJUSTMENT_VOUCHER: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: true,
    VIEWER: false,
  },
  LOG_WASTE_DISPOSAL_MOVEMENT: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: true,
    RUNNER: false,
    CUSTODIAN: true,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  APPROVE_WASTE_DISPOSAL_CLAIM: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: true,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: true,
    VIEWER: false,
  },
  DISPATCH_RECEIVE_STORE_TRANSFER: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: true,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  APPROVE_TRANSFER_DISCREPANCY: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: true,
    VIEWER: false,
  },
  REQUEST_NEW_STORE_OR_WAREHOUSE: {
    SYSTEM_ADMIN: false,
    ADMIN: true,
    RM: true,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: false,
    VIEWER: false,
  },
  APPROVE_NEW_STORE_OR_WAREHOUSE: {
    SYSTEM_ADMIN: false,
    ADMIN: false,
    RM: false,
    SECTION_REQ: false,
    RUNNER: false,
    CUSTODIAN: false,
    SCM: false,
    ACCOUNTANT: false,
    APPROVER: true,
    VIEWER: false,
  },
};

/**
 * Resolves any valid role input to a canonical MatrixRole.
 * Maps Section Requesters (KITCHEN_REQ, BAR_REQ, CHEESE_REQ) to SECTION_REQ.
 */
export function resolveMatrixRole(role: UserRole | MatrixRole | string): MatrixRole | null {
  if (
    role === 'KITCHEN_REQ' ||
    role === 'BAR_REQ' ||
    role === 'CHEESE_REQ' ||
    role === 'SECTION_REQ' ||
    role === UserRole.KITCHEN_REQ ||
    role === UserRole.BAR_REQ ||
    role === UserRole.CHEESE_REQ
  ) {
    return 'SECTION_REQ';
  }

  if (role in DOC_ROLE_NAME_TO_KEY) {
    return DOC_ROLE_NAME_TO_KEY[role];
  }

  if (MATRIX_ROLES.includes(role as MatrixRole)) {
    return role as MatrixRole;
  }

  return null;
}

/**
 * Resolves an action input (either key or doc table name) to an OperationalActionKey.
 */
export function resolveActionKey(action: OperationalActionKey | string): OperationalActionKey | null {
  if (action in ROLE_ACTION_MATRIX) {
    return action as OperationalActionKey;
  }

  if (action in DOC_ACTION_NAME_TO_KEY) {
    return DOC_ACTION_NAME_TO_KEY[action];
  }

  return null;
}

/**
 * Core Helper Function: canPerform(role, action): boolean
 * Evaluates whether a role can execute an operational action according to Doc §1.3.
 */
export function canPerform(
  role: UserRole | MatrixRole | string,
  action: OperationalActionKey | OperationalActionName | string
): boolean {
  const resolvedRole = resolveMatrixRole(role);
  const resolvedAction = resolveActionKey(action);

  if (!resolvedRole || !resolvedAction) {
    return false;
  }

  return ROLE_ACTION_MATRIX[resolvedAction]?.[resolvedRole] ?? false;
}

/**
 * Convenience helper to list all actions permitted for a role.
 */
export function getActionsForRole(role: UserRole | MatrixRole | string): OperationalActionKey[] {
  const resolvedRole = resolveMatrixRole(role);
  if (!resolvedRole) return [];

  return OPERATIONAL_ACTION_KEYS.filter((actKey) => ROLE_ACTION_MATRIX[actKey][resolvedRole]);
}

/**
 * Convenience helper to list all roles permitted for an action.
 */
export function getRolesForAction(
  action: OperationalActionKey | OperationalActionName | string
): MatrixRole[] {
  const resolvedAction = resolveActionKey(action);
  if (!resolvedAction) return [];

  return MATRIX_ROLES.filter((role) => ROLE_ACTION_MATRIX[resolvedAction][role]);
}
