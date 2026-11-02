import { z } from 'zod';

/**
 * 1.1 User Roles (UserRole)
 * Strictly matches docs/build/CONTRACTS.md §1.1
 */
export const UserRole = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN', // Global admin: user provisioning, security, system ops
  ADMIN: 'ADMIN', // Warehouse Keeper / Storekeeper: receiving, picking, benchmark count
  RM: 'RM', // Restaurant Manager: daily balance review, minor waste approval
  KITCHEN_REQ: 'KITCHEN_REQ', // Kitchen Section Requester: create/amend kitchen requests
  BAR_REQ: 'BAR_REQ', // Bar Section Requester: create/amend bar requests
  CHEESE_REQ: 'CHEESE_REQ', // Cheese Section Requester: create/amend cheese requests
  RUNNER: 'RUNNER', // Kitchen Runner: door inspection and digital receipt confirmation
  CUSTODIAN: 'CUSTODIAN', // Named Room Custodian: room security, shift custody, benchmark count
  SCM: 'SCM', // Supply Chain Lead: dock receiving issue escalation
  ACCOUNTANT: 'ACCOUNTANT', // Store Accountant: cycle/month-end count, reconciliation vouchers
  APPROVER: 'APPROVER', // Financial Controller: store/wh approvals, major waste, count adjustments
  VIEWER: 'VIEWER', // Internal Audit / Executive: read-only access to ledger & audit trail
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const userRoleSchema = z.nativeEnum(UserRole);

/**
 * 1.2 Store Sections (SectionId)
 * Strictly matches docs/build/CONTRACTS.md §1.2
 */
export const SectionId = {
  KITCHEN: 'KITCHEN',
  BAR: 'BAR',
  CHEESE: 'CHEESE',
  ALL: 'ALL',
} as const;

export type SectionId = (typeof SectionId)[keyof typeof SectionId];
export const sectionIdSchema = z.nativeEnum(SectionId);

/**
 * 1.3 Warehouse Storage Types (StorageType)
 * Strictly matches docs/build/CONTRACTS.md §1.3
 */
export const StorageType = {
  COLD_ROOM: 'COLD_ROOM',
  DRY_STORE: 'DRY_STORE',
} as const;

export type StorageType = (typeof StorageType)[keyof typeof StorageType];
export const storageTypeSchema = z.nativeEnum(StorageType);

/**
 * 1.4 Warehouse Operating Status (WarehouseStatus)
 * Strictly matches docs/build/CONTRACTS.md §1.4
 */
export const WarehouseStatus = {
  ACTIVE: 'ACTIVE',
  FROZEN_FOR_COUNT: 'FROZEN_FOR_COUNT',
  INACTIVE: 'INACTIVE',
} as const;

export type WarehouseStatus = (typeof WarehouseStatus)[keyof typeof WarehouseStatus];
export const warehouseStatusSchema = z.nativeEnum(WarehouseStatus);

/**
 * Store Status
 */
export const StoreStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type StoreStatus = (typeof StoreStatus)[keyof typeof StoreStatus];
export const storeStatusSchema = z.nativeEnum(StoreStatus);

/**
 * 1.5 Unit of Measure (UomCode)
 * Strictly matches docs/build/CONTRACTS.md §1.5
 */
export const UomCode = {
  KG: 'kg',
  PIECE: 'pcs',
} as const;

export type UomCode = (typeof UomCode)[keyof typeof UomCode];
export const uomCodeSchema = z.nativeEnum(UomCode);

/**
 * 2. Stock Ledger Movement Types & Signs
 * Strictly matches docs/build/CONTRACTS.md §2
 */
export const MovementType = {
  GRPO_IMPORT: 'GRPO_IMPORT',
  ISSUE_PENDING: 'ISSUE_PENDING',
  ISSUE_PENDING_OFFSET: 'ISSUE_PENDING_OFFSET',
  ISSUE_CONFIRMED: 'ISSUE_CONFIRMED',
  ISSUE_REVERSAL: 'ISSUE_REVERSAL',
  WASTE_DISPOSAL: 'WASTE_DISPOSAL',
  SUPPLIER_RETURN: 'SUPPLIER_RETURN',
  TRANSFER_OUT_INTRANSIT: 'TRANSFER_OUT_INTRANSIT',
  TRANSFER_IN_RECEIVED: 'TRANSFER_IN_RECEIVED',
  COUNT_ADJUSTMENT: 'COUNT_ADJUSTMENT',
} as const;

export type MovementType = (typeof MovementType)[keyof typeof MovementType];
export const movementTypeSchema = z.nativeEnum(MovementType);

export const MOVEMENT_SIGNS: Record<MovementType, 1 | -1 | 'signed'> = {
  GRPO_IMPORT: 1,
  ISSUE_PENDING: -1,
  ISSUE_PENDING_OFFSET: 1,
  ISSUE_CONFIRMED: -1,
  ISSUE_REVERSAL: 1,
  WASTE_DISPOSAL: -1,
  SUPPLIER_RETURN: -1,
  TRANSFER_OUT_INTRANSIT: -1,
  TRANSFER_IN_RECEIVED: 1,
  COUNT_ADJUSTMENT: 'signed',
};

/**
 * 3.1 Section Stock Request Status
 * Strictly matches docs/build/CONTRACTS.md §3.1
 */
export const RequestStatus = {
  QUEUED: 'QUEUED',
  PICKING: 'PICKING',
  AWAITING_RUNNER: 'AWAITING_RUNNER',
  CONFIRMED: 'CONFIRMED',
  PARTIAL_ACCEPTED: 'PARTIAL_ACCEPTED',
  PARTIAL_DECLINED: 'PARTIAL_DECLINED',
  CANCELLED_BY_REQUESTER: 'CANCELLED_BY_REQUESTER',
  URGENT_PENDING: 'URGENT_PENDING',
} as const;

export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];
export const requestStatusSchema = z.nativeEnum(RequestStatus);

/**
 * 3.2 Inter-Store Transfer Status
 * Strictly matches docs/build/CONTRACTS.md §3.2
 */
export const TransferStatus = {
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED_MATCH: 'RECEIVED_MATCH',
  VARIANCE_PENDING_FC: 'VARIANCE_PENDING_FC',
  RECEIVED_VARIANCE_APPROVED: 'RECEIVED_VARIANCE_APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];
export const transferStatusSchema = z.nativeEnum(TransferStatus);

/**
 * 3.3 Periodic Stock Count Status
 * Strictly matches docs/build/CONTRACTS.md §3.3
 */
export const StockCountStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  RECOUNT: 'RECOUNT',
  COMPLETED: 'COMPLETED',
} as const;

export type StockCountStatus = (typeof StockCountStatus)[keyof typeof StockCountStatus];
export const stockCountStatusSchema = z.nativeEnum(StockCountStatus);

export const CountFreezeStatus = {
  FROZEN: 'FROZEN',
  UNFROZEN: 'UNFROZEN',
} as const;

export type CountFreezeStatus = (typeof CountFreezeStatus)[keyof typeof CountFreezeStatus];
export const countFreezeStatusSchema = z.nativeEnum(CountFreezeStatus);

export const CountType = {
  WEEKLY_CYCLE: 'WEEKLY_CYCLE',
  MONTH_END_FULL: 'MONTH_END_FULL',
} as const;

export type CountType = (typeof CountType)[keyof typeof CountType];
export const countTypeSchema = z.nativeEnum(CountType);

/**
 * 3.4 Daily Balance Status
 * Strictly matches docs/build/CONTRACTS.md §3.4
 */
export const DailyBalanceStatus = {
  BALANCED: 'BALANCED',
  VARIANCE_FLAGGED: 'VARIANCE_FLAGGED',
} as const;

export type DailyBalanceStatus = (typeof DailyBalanceStatus)[keyof typeof DailyBalanceStatus];
export const dailyBalanceStatusSchema = z.nativeEnum(DailyBalanceStatus);

/**
 * 3.5 SAP GRPO Line Item Classification Status
 * Strictly matches docs/build/CONTRACTS.md §3.5
 */
export const GrpoItemStatus = {
  IMPORTED: 'IMPORTED',
  REFRESHED: 'REFRESHED',
  NEEDS_2ND_APPROVAL: 'NEEDS_2ND_APPROVAL',
  QUARANTINED: 'QUARANTINED',
  REJECTED_MISMATCH: 'REJECTED_MISMATCH',
} as const;

export type GrpoItemStatus = (typeof GrpoItemStatus)[keyof typeof GrpoItemStatus];
export const grpoItemStatusSchema = z.nativeEnum(GrpoItemStatus);

/**
 * 3.6 User Invitations & Approver Lifecycle Status
 * Strictly matches docs/build/CONTRACTS.md §3.6
 */
export const InvitationStatus = {
  PENDING_SECOND_APPROVAL: 'PENDING_SECOND_APPROVAL',
  PENDING: 'PENDING',
  ACTIVATED: 'ACTIVATED',
  EXPIRED: 'EXPIRED',
} as const;

export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];
export const invitationStatusSchema = z.nativeEnum(InvitationStatus);

/**
 * 5.3 Expiry Radar Status
 * Strictly matches docs/build/CONTRACTS.md §5.3
 */
export const ExpiryRadarStatus = {
  EXPIRED_LOCK: 'EXPIRED_LOCK',
  EXPIRY_AMBER: 'EXPIRY_AMBER',
  FIFO_OK: 'FIFO_OK',
} as const;

export type ExpiryRadarStatus = (typeof ExpiryRadarStatus)[keyof typeof ExpiryRadarStatus];
export const expiryRadarStatusSchema = z.nativeEnum(ExpiryRadarStatus);

/**
 * Store / Warehouse Proposal Types & Decisions
 */
export const ProposalType = {
  NEW_STORE: 'NEW_STORE',
  NEW_WAREHOUSE: 'NEW_WAREHOUSE',
} as const;

export type ProposalType = (typeof ProposalType)[keyof typeof ProposalType];
export const proposalTypeSchema = z.nativeEnum(ProposalType);

export const ApprovalDecision = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];
export const approvalDecisionSchema = z.nativeEnum(ApprovalDecision);

/**
 * Security, Custody & Handover Event Types
 */
export const SecurityEventType = {
  INVITATION_SENT: 'INVITATION_SENT',
  PASSWORD_SET: 'PASSWORD_SET',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  DEACTIVATION: 'DEACTIVATION',
} as const;

export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];
export const securityEventTypeSchema = z.nativeEnum(SecurityEventType);

export const CustodyEventType = {
  WINDOW_UNLOCK: 'WINDOW_UNLOCK',
  WINDOW_LOCK: 'WINDOW_LOCK',
  URGENT_ACCESS: 'URGENT_ACCESS',
} as const;

export type CustodyEventType = (typeof CustodyEventType)[keyof typeof CustodyEventType];
export const custodyEventTypeSchema = z.nativeEnum(CustodyEventType);

export const ShiftType = {
  DAY_TO_EVENING: 'DAY_TO_EVENING',
  EVENING_TO_MORNING: 'EVENING_TO_MORNING',
} as const;

export type ShiftType = (typeof ShiftType)[keyof typeof ShiftType];
export const shiftTypeSchema = z.nativeEnum(ShiftType);

export const WasteMovementType = {
  WASTE_DISPOSAL: 'WASTE_DISPOSAL',
  SUPPLIER_RETURN: 'SUPPLIER_RETURN',
} as const;

export type WasteMovementType = (typeof WasteMovementType)[keyof typeof WasteMovementType];
export const wasteMovementTypeSchema = z.nativeEnum(WasteMovementType);

export const WasteApproverDecision = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type WasteApproverDecision = (typeof WasteApproverDecision)[keyof typeof WasteApproverDecision];
export const wasteApproverDecisionSchema = z.nativeEnum(WasteApproverDecision);
