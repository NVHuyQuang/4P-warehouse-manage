import { z } from 'zod';
import {
  userRoleSchema,
  sectionIdSchema,
  storageTypeSchema,
  invitationStatusSchema,
  proposalTypeSchema,
  approvalDecisionSchema,
  securityEventTypeSchema,
  custodyEventTypeSchema,
  shiftTypeSchema,
} from './enums';

/**
 * User Profile (m_users)
 */
export const userSchema = z.object({
  user_id: z.string().min(1),
  email: z.string().email(),
  full_name: z.string().min(1),
  failed_login_count: z.number().int().min(0).default(0),
  lockout_until: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  created_at: z.string().min(1),
});

export type User = z.infer<typeof userSchema>;

/**
 * User Invitation (m_user_invitations)
 * System Admin creates invitation; APPROVER role requires independent second approval.
 */
export const userInvitationSchema = z.object({
  invitation_id: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema,
  store_id: z.string().min(1),
  activation_token: z.string().min(1),
  expires_at: z.string().min(1),
  status: invitationStatusSchema,
  created_at: z.string().min(1),
});

export type UserInvitation = z.infer<typeof userInvitationSchema>;

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: userRoleSchema,
  store_id: z.string().min(1),
});

export type CreateInvitation = z.infer<typeof createInvitationSchema>;

/**
 * User Permissions & Scope (m_user_permissions)
 */
export const userPermissionSchema = z.object({
  permission_id: z.string().min(1),
  user_id: z.string().min(1),
  role: userRoleSchema,
  store_id: z.string().min(1),
  warehouse_id: z.string().nullable().optional(),
  section_id: sectionIdSchema,
});

export type UserPermission = z.infer<typeof userPermissionSchema>;

/**
 * Security & Access Audit Log (t_security_logs)
 */
export const securityLogSchema = z.object({
  log_id: z.string().min(1),
  user_id: z.string().min(1),
  event_type: securityEventTypeSchema,
  ip_address: z.string().nullable().optional(),
  device_info: z.string().nullable().optional(),
  timestamp: z.string().min(1),
});

export type SecurityLog = z.infer<typeof securityLogSchema>;

/**
 * Room Access & Custody Log (t_custody_logs)
 */
export const custodyLogSchema = z.object({
  log_id: z.string().min(1),
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  event_type: custodyEventTypeSchema,
  custodian_user_id: z.string().min(1),
  urgent_reason: z.string().nullable().optional(),
  timestamp: z.string().min(1),
});

export type CustodyLog = z.infer<typeof custodyLogSchema>;

/**
 * Shift Custody Key Transfer Log (t_shift_custody_logs)
 */
export const shiftCustodyLogSchema = z.object({
  shift_log_id: z.string().min(1),
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  outgoing_custodian_id: z.string().min(1),
  incoming_holder_id: z.string().min(1),
  shift_type: shiftTypeSchema,
  signature_blob: z.string().min(1),
  transferred_at: z.string().min(1),
});

export type ShiftCustodyLog = z.infer<typeof shiftCustodyLogSchema>;

/**
 * Store / Warehouse Proposal & Approval (t_store_warehouse_approvals)
 */
export const storeWarehouseApprovalSchema = z.object({
  approval_id: z.string().min(1),
  proposal_type: proposalTypeSchema,
  proposed_name: z.string().min(1),
  store_id: z.string().nullable().optional(),
  storage_type: storageTypeSchema.nullable().optional(),
  nominated_custodian_id: z.string().nullable().optional(),
  nominated_backup_id: z.string().nullable().optional(),
  fc_decision: approvalDecisionSchema,
  fc_comment: z.string().nullable().optional(),
  decided_at: z.string().nullable().optional(),
  created_at: z.string().min(1),
});

export type StoreWarehouseApproval = z.infer<typeof storeWarehouseApprovalSchema>;
