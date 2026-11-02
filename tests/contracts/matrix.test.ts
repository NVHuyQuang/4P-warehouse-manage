import { describe, it, expect } from 'vitest';
import { UserRole } from '../../lib/contracts/enums';
import {
  canPerform,
  getActionsForRole,
  getRolesForAction,
  resolveMatrixRole,
  resolveActionKey,
  MATRIX_ROLES,
  DOC_ROLE_NAMES,
  DOC_ROLE_NAME_TO_KEY,
  OperationalAction,
  OPERATIONAL_ACTION_KEYS,
  DOC_ACTION_NAME_TO_KEY,
  ROLE_ACTION_MATRIX,
  type MatrixRole,
  type OperationalActionKey,
} from '../../lib/rbac/matrix';

/**
 * Expected Doc §1.3 Table Ground Truth:
 * 19 Actions x 10 Roles
 * Columns:
 * [0] SYSTEM_ADMIN (Sys Admin)
 * [1] ADMIN (Admin (Keeper))
 * [2] RM (RM)
 * [3] SECTION_REQ (Section Req)
 * [4] RUNNER (Runner)
 * [5] CUSTODIAN (Custodian)
 * [6] SCM (SCM)
 * [7] ACCOUNTANT (Accountant)
 * [8] APPROVER (Approver (FC))
 * [9] VIEWER (Viewer)
 */
const EXPECTED_DOC_MATRIX: Record<OperationalActionKey, Record<MatrixRole, boolean>> = {
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

describe('Doc §1.3 Role-by-Action Matrix Verification', () => {
  it('has exactly 10 roles and 19 operational actions', () => {
    expect(MATRIX_ROLES).toHaveLength(10);
    expect(OPERATIONAL_ACTION_KEYS).toHaveLength(19);
    expect(Object.keys(ROLE_ACTION_MATRIX)).toHaveLength(19);
  });

  describe('Exhaustive 19 Actions x 10 Roles Matrix Check (190 combinations)', () => {
    for (const actionKey of OPERATIONAL_ACTION_KEYS) {
      const actionName = OperationalAction[actionKey];

      describe(`Action: ${actionName} (${actionKey})`, () => {
        for (const role of MATRIX_ROLES) {
          const docRole = DOC_ROLE_NAMES[role];
          const expected = EXPECTED_DOC_MATRIX[actionKey][role];

          it(`role ${role} (${docRole}) -> ${expected ? 'ALLOWED' : 'DENIED'}`, () => {
            // Check direct matrix lookup
            expect(ROLE_ACTION_MATRIX[actionKey][role]).toBe(expected);

            // Check canPerform with actionKey + role
            expect(canPerform(role, actionKey)).toBe(expected);

            // Check canPerform with actionName + docRole
            expect(canPerform(docRole, actionName)).toBe(expected);

            // Check canPerform with actionKey + docRole
            expect(canPerform(docRole, actionKey)).toBe(expected);

            // Check canPerform with actionName + role
            expect(canPerform(role, actionName)).toBe(expected);
          });
        }
      });
    }
  });

  describe('Section Requester Sub-Roles Mapping', () => {
    const sectionRoles = [
      UserRole.KITCHEN_REQ,
      UserRole.BAR_REQ,
      UserRole.CHEESE_REQ,
      'KITCHEN_REQ',
      'BAR_REQ',
      'CHEESE_REQ',
    ] as const;

    for (const subRole of sectionRoles) {
      it(`maps ${subRole} to identical permissions as SECTION_REQ across all 19 actions`, () => {
        for (const actionKey of OPERATIONAL_ACTION_KEYS) {
          const expected = EXPECTED_DOC_MATRIX[actionKey].SECTION_REQ;
          expect(canPerform(subRole, actionKey)).toBe(expected);
        }
      });
    }

    it('confirms section requesters can create/amend requests and log waste, but nothing else', () => {
      const allowedActions = getActionsForRole(UserRole.KITCHEN_REQ);
      expect(allowedActions.sort()).toEqual(
        [
          'CREATE_SECTION_STOCK_REQUEST',
          'AMEND_CANCEL_PENDING_REQUEST',
          'LOG_WASTE_DISPOSAL_MOVEMENT',
        ].sort()
      );
    });
  });

  describe('Role-Specific Invariant Checks', () => {
    it('Sys Admin: only user invitation & password reset permitted', () => {
      const allowed = getActionsForRole('SYSTEM_ADMIN');
      expect(allowed).toEqual(['INVITE_USERS_AND_RESET_PASSWORD']);
    });

    it('Viewer: strictly read-only with 0 operational actions', () => {
      const allowed = getActionsForRole('VIEWER');
      expect(allowed).toEqual([]);
      for (const actionKey of OPERATIONAL_ACTION_KEYS) {
        expect(canPerform('VIEWER', actionKey)).toBe(false);
      }
    });

    it('SCM: dock receiving escalation/audit only, 0 direct write actions in storeroom', () => {
      const allowed = getActionsForRole('SCM');
      expect(allowed).toEqual([]);
      for (const actionKey of OPERATIONAL_ACTION_KEYS) {
        expect(canPerform('SCM', actionKey)).toBe(false);
      }
    });

    it('Runner: only Confirm Receipt at Storeroom Door permitted', () => {
      const allowed = getActionsForRole('RUNNER');
      expect(allowed).toEqual(['CONFIRM_RECEIPT_AT_STOREROOM_DOOR']);
    });

    it('Accountant: only Conduct Periodic Stock Count & Submit Post-Cutoff Adjustment', () => {
      const allowed = getActionsForRole('ACCOUNTANT');
      expect(allowed.sort()).toEqual(
        ['CONDUCT_PERIODIC_STOCK_COUNT', 'SUBMIT_POST_CUTOFF_ADJUSTMENT'].sort()
      );
    });

    it('Approver (FC): only approvals, issue window config, and expiry tracking config', () => {
      const allowed = getActionsForRole('APPROVER');
      expect(allowed.sort()).toEqual(
        [
          'CONFIGURE_STORE_ISSUE_WINDOWS',
          'DEFINE_EXPIRY_TRACKING_GROUPS',
          'APPROVE_STOCK_ADJUSTMENT_VOUCHER',
          'APPROVE_WASTE_DISPOSAL_CLAIM',
          'APPROVE_TRANSFER_DISCREPANCY',
          'APPROVE_NEW_STORE_OR_WAREHOUSE',
        ].sort()
      );
    });
  });

  describe('Action-Specific Permitted Roles (getRolesForAction)', () => {
    it('Import SAP GRPO Export File is exclusive to Admin (Keeper)', () => {
      const roles = getRolesForAction('IMPORT_SAP_GRPO_EXPORT_FILE');
      expect(roles).toEqual(['ADMIN']);
    });

    it('Approve Stock Adjustment Voucher is exclusive to Approver (FC)', () => {
      const roles = getRolesForAction('APPROVE_STOCK_ADJUSTMENT_VOUCHER');
      expect(roles).toEqual(['APPROVER']);
    });

    it('Approve Transfer Discrepancy is exclusive to Approver (FC)', () => {
      const roles = getRolesForAction('APPROVE_TRANSFER_DISCREPANCY');
      expect(roles).toEqual(['APPROVER']);
    });

    it('Approve New Store or Warehouse is exclusive to Approver (FC)', () => {
      const roles = getRolesForAction('APPROVE_NEW_STORE_OR_WAREHOUSE');
      expect(roles).toEqual(['APPROVER']);
    });

    it('Confirm Receipt at Storeroom Door is exclusive to Runner', () => {
      const roles = getRolesForAction('CONFIRM_RECEIPT_AT_STOREROOM_DOOR');
      expect(roles).toEqual(['RUNNER']);
    });
  });

  describe('Helper & Resolver Edge Cases', () => {
    it('resolveMatrixRole resolves known roles and returns null for unknown', () => {
      expect(resolveMatrixRole('SYSTEM_ADMIN')).toBe('SYSTEM_ADMIN');
      expect(resolveMatrixRole('Admin (Keeper)')).toBe('ADMIN');
      expect(resolveMatrixRole('RM')).toBe('RM');
      expect(resolveMatrixRole('KITCHEN_REQ')).toBe('SECTION_REQ');
      expect(resolveMatrixRole('BAR_REQ')).toBe('SECTION_REQ');
      expect(resolveMatrixRole('CHEESE_REQ')).toBe('SECTION_REQ');
      expect(resolveMatrixRole('UNKNOWN_ROLE')).toBeNull();
      expect(resolveMatrixRole('')).toBeNull();
    });

    it('resolveActionKey resolves keys and doc names, returns null for unknown', () => {
      expect(resolveActionKey('INVITE_USERS_AND_RESET_PASSWORD')).toBe(
        'INVITE_USERS_AND_RESET_PASSWORD'
      );
      expect(resolveActionKey('Invite Users & Reset Password')).toBe(
        'INVITE_USERS_AND_RESET_PASSWORD'
      );
      expect(resolveActionKey('NON_EXISTENT_ACTION')).toBeNull();
      expect(resolveActionKey('')).toBeNull();
    });

    it('canPerform returns false for unknown role or action', () => {
      expect(canPerform('UNKNOWN_ROLE', 'INVITE_USERS_AND_RESET_PASSWORD')).toBe(false);
      expect(canPerform('ADMIN', 'UNKNOWN_ACTION')).toBe(false);
      expect(canPerform('INVALID', 'INVALID')).toBe(false);
    });

    it('getActionsForRole returns empty array for unknown role', () => {
      expect(getActionsForRole('NON_EXISTENT_ROLE')).toEqual([]);
    });

    it('getRolesForAction returns empty array for unknown action', () => {
      expect(getRolesForAction('NON_EXISTENT_ACTION')).toEqual([]);
    });

    it('verifies bidirectionality between DOC_ROLE_NAMES and DOC_ROLE_NAME_TO_KEY', () => {
      for (const role of MATRIX_ROLES) {
        const docName = DOC_ROLE_NAMES[role];
        expect(DOC_ROLE_NAME_TO_KEY[docName]).toBe(role);
      }
    });

    it('verifies bidirectionality between OperationalAction and DOC_ACTION_NAME_TO_KEY', () => {
      for (const actionKey of OPERATIONAL_ACTION_KEYS) {
        const docName = OperationalAction[actionKey];
        expect(DOC_ACTION_NAME_TO_KEY[docName]).toBe(actionKey);
      }
    });
  });
});
