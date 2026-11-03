/**
 * Stores & Warehouses Data Layer (Domain D10 / Flow H)
 *
 * Governs:
 * 1. Active Store and Storeroom administration (m_stores, m_warehouses)
 * 2. Go-Live Assignment Checklist verification (m_go_live_assignments)
 * 3. Flow H Store / Warehouse Proposal lifecycle (t_store_warehouse_approvals)
 * 4. Financial Controller authorization & automatic master data provisioning
 *
 * NON-NEGOTIABLE RULES:
 * - Physical movements and facility quantities only. Zero commercial indicators.
 * - Strict segregation of duties: Proposer cannot approve their own proposal.
 */

import { supabase } from '@/lib/supabase/client';

export type StorageType = 'COLD_ROOM' | 'DRY_STORE' | 'FREEZER';
export type ProposalType = 'NEW_STORE' | 'NEW_WAREHOUSE';
export type ProposalDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WarehouseRecord {
  warehouse_id: string;
  store_id: string;
  warehouse_name: string;
  floor_level: string;
  storage_type: StorageType;
  status: 'ACTIVE' | 'FROZEN_FOR_COUNT' | 'INACTIVE';
  is_active: boolean;
  approval_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StoreRecord {
  store_id: string;
  store_name: string;
  city: string;
  status: 'ACTIVE' | 'INACTIVE';
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StoreWithWarehouses extends StoreRecord {
  warehouses: WarehouseRecord[];
}

export interface GoLiveChecklist {
  store_id: string;
  cold_room_custodian_id: string | null;
  cold_room_custodian_name?: string | null;
  cold_room_backup_id: string | null;
  cold_room_backup_name?: string | null;
  dry_store_custodian_id: string | null;
  dry_store_custodian_name?: string | null;
  dry_store_backup_id: string | null;
  dry_store_backup_name?: string | null;
  kitchen_runner_id: string | null;
  kitchen_runner_name?: string | null;
  evening_key_holder_id: string | null;
  evening_key_holder_name?: string | null;
  morning_receiving_window: string | null;
  afternoon_receiving_window: string | null;
  morning_issue_window: string | null;
  afternoon_issue_window: string | null;
  created_at?: string;
  updated_at?: string;
  is_complete: boolean;
}

export interface ProposeStoreOrWarehouseParams {
  proposalType: ProposalType;
  proposedName: string;
  storeId?: string | null;
  storageType?: StorageType | null;
  nominatedCustodianId: string;
  nominatedBackupId: string;
  requestedByUserId?: string;
  reason?: string;
}

export interface StoreWarehouseApprovalRecord {
  approval_id: string;
  proposal_type: ProposalType;
  proposed_name: string;
  store_id: string | null;
  store_name?: string | null;
  storage_type: StorageType | null;
  nominated_custodian_id: string;
  nominated_custodian_name?: string;
  nominated_backup_id: string;
  nominated_backup_name?: string;
  fc_decision: ProposalDecision;
  fc_comment: string | null;
  requested_by_user_id: string;
  requested_by_name?: string;
  requested_at: string;
  decided_by_user_id: string | null;
  decided_by_name?: string | null;
  decided_at: string | null;
}

export interface CustodianCandidate {
  userId: string;
  uuid: string;
  fullName: string;
  role: string;
  storeId: string;
}

// Deterministic UUID mapping for seed staff members
export const USER_UUID_MAP: Record<string, string> = {
  'usr-rm-01': 'a0000000-0000-0000-0000-000000000001',
  'usr-admin-01': 'a0000000-0000-0000-0000-000000000002',
  'usr-approver-01': 'a0000000-0000-0000-0000-000000000003',
  'usr-custodian-01': 'a0000000-0000-0000-0000-000000000004',
  'usr-cust-backup': 'a0000000-0000-0000-0000-000000000005',
  'usr-dry-01': 'a0000000-0000-0000-0000-000000000006',
  'usr-runner-01': 'a0000000-0000-0000-0000-000000000007',
  'usr-evening-01': 'a0000000-0000-0000-0000-000000000008',
  'usr-custodian-02': 'a0000000-0000-0000-0000-000000000009',
  'usr-admin-02': 'a0000000-0000-0000-0000-000000000010',
  'usr-rm-02': 'a0000000-0000-0000-0000-000000000011',
  'usr-custodian-03': 'a0000000-0000-0000-0000-000000000012',
  'usr-rm-03': 'a0000000-0000-0000-0000-000000000013',
};

export const CUSTODIAN_CANDIDATES: readonly CustodianCandidate[] = [
  {
    userId: 'usr-custodian-01',
    uuid: 'a0000000-0000-0000-0000-000000000004',
    fullName: 'Rajesh Sharma',
    role: 'Cold Room Custodian',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-cust-backup',
    uuid: 'a0000000-0000-0000-0000-000000000005',
    fullName: 'Amit Patel',
    role: 'Backup Custodian',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-dry-01',
    uuid: 'a0000000-0000-0000-0000-000000000006',
    fullName: 'Manoj Gupta',
    role: 'Dry Store Custodian',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-admin-01',
    uuid: 'a0000000-0000-0000-0000-000000000002',
    fullName: 'Sunil Rao',
    role: 'Warehouse Keeper',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-rm-01',
    uuid: 'a0000000-0000-0000-0000-000000000001',
    fullName: 'Priya Verma',
    role: 'Restaurant Manager',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-evening-01',
    uuid: 'a0000000-0000-0000-0000-000000000008',
    fullName: 'Vikram Singh',
    role: 'Evening Duty Manager',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-custodian-02',
    uuid: 'a0000000-0000-0000-0000-000000000009',
    fullName: 'Kavita Nair',
    role: 'Cold Room Custodian',
    storeId: 'IND-DEL-02',
  },
  {
    userId: 'usr-admin-02',
    uuid: 'a0000000-0000-0000-0000-000000000010',
    fullName: 'Deepak Joshi',
    role: 'Warehouse Keeper',
    storeId: 'IND-DEL-02',
  },
  {
    userId: 'usr-rm-02',
    uuid: 'a0000000-0000-0000-0000-000000000011',
    fullName: 'Rohan Mehra',
    role: 'Restaurant Manager',
    storeId: 'IND-DEL-02',
  },
  {
    userId: 'usr-custodian-03',
    uuid: 'a0000000-0000-0000-0000-000000000012',
    fullName: 'Suresh Gowda',
    role: 'Cold Room Custodian',
    storeId: 'IND-BLR-01',
  },
  {
    userId: 'usr-rm-03',
    uuid: 'a0000000-0000-0000-0000-000000000013',
    fullName: 'Ananya Reddy',
    role: 'Restaurant Manager',
    storeId: 'IND-BLR-01',
  },
];

export function getCustodianCandidates(): CustodianCandidate[] {
  return [...CUSTODIAN_CANDIDATES];
}

export function resolveStaffName(idOrUuid: string | null | undefined): string {
  if (!idOrUuid) return 'Unassigned';
  const candidate = CUSTODIAN_CANDIDATES.find(
    (c) => c.userId === idOrUuid || c.uuid === idOrUuid
  );
  if (candidate) return candidate.fullName;
  return idOrUuid;
}

function normalizeToUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  return USER_UUID_MAP[id] || 'a0000000-0000-0000-0000-000000000004';
}

// ---------------------------------------------------------------------------
// IN-MEMORY MOCK STORE FOR PROTOTYPE / OFFLINE EXECUTION
// ---------------------------------------------------------------------------

const mockStores: StoreRecord[] = [
  {
    store_id: 'IND-DEL-01',
    store_name: 'Delhi Store 1',
    city: 'Delhi',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    store_id: 'IND-DEL-02',
    store_name: 'Delhi Store 2',
    city: 'Delhi',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    store_id: 'IND-BLR-01',
    store_name: 'Bengaluru Store 1',
    city: 'Bengaluru',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
  },
];

const mockWarehouses: WarehouseRecord[] = [
  {
    warehouse_id: 'WH-DEL01-COLD',
    store_id: 'IND-DEL-01',
    warehouse_name: 'Cold Room (WH-01)',
    floor_level: 'GROUND',
    storage_type: 'COLD_ROOM',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    warehouse_id: 'WH-DEL01-DRY',
    store_id: 'IND-DEL-01',
    warehouse_name: 'Dry Store (WH-02)',
    floor_level: 'GROUND',
    storage_type: 'DRY_STORE',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    warehouse_id: 'WH-DEL02-COLD',
    store_id: 'IND-DEL-02',
    warehouse_name: 'Cold Room (WH-01)',
    floor_level: 'GROUND',
    storage_type: 'COLD_ROOM',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    warehouse_id: 'WH-DEL02-DRY',
    store_id: 'IND-DEL-02',
    warehouse_name: 'Dry Store (WH-02)',
    floor_level: 'GROUND',
    storage_type: 'DRY_STORE',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    warehouse_id: 'WH-BLR01-COLD',
    store_id: 'IND-BLR-01',
    warehouse_name: 'Cold Room (WH-01)',
    floor_level: 'GROUND',
    storage_type: 'COLD_ROOM',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
  },
  {
    warehouse_id: 'WH-BLR01-DRY',
    store_id: 'IND-BLR-01',
    warehouse_name: 'Dry Store (WH-02)',
    floor_level: 'GROUND',
    storage_type: 'DRY_STORE',
    status: 'ACTIVE',
    is_active: true,
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
  },
];

const mockChecklists: Record<string, GoLiveChecklist> = {
  'IND-DEL-01': {
    store_id: 'IND-DEL-01',
    cold_room_custodian_id: 'usr-custodian-01',
    cold_room_custodian_name: 'Rajesh Sharma',
    cold_room_backup_id: 'usr-cust-backup',
    cold_room_backup_name: 'Amit Patel',
    dry_store_custodian_id: 'usr-dry-01',
    dry_store_custodian_name: 'Manoj Gupta',
    dry_store_backup_id: 'usr-admin-01',
    dry_store_backup_name: 'Sunil Rao',
    kitchen_runner_id: 'usr-runner-01',
    kitchen_runner_name: 'Ravi Kumar',
    evening_key_holder_id: 'usr-evening-01',
    evening_key_holder_name: 'Vikram Singh',
    morning_receiving_window: '07:00-09:00',
    afternoon_receiving_window: '14:00-16:00',
    morning_issue_window: '06:00-08:30',
    afternoon_issue_window: '14:30-16:00',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    is_complete: true,
  },
  'IND-DEL-02': {
    store_id: 'IND-DEL-02',
    cold_room_custodian_id: 'usr-custodian-02',
    cold_room_custodian_name: 'Kavita Nair',
    cold_room_backup_id: 'usr-admin-02',
    cold_room_backup_name: 'Deepak Joshi',
    dry_store_custodian_id: 'usr-admin-02',
    dry_store_custodian_name: 'Deepak Joshi',
    dry_store_backup_id: 'usr-rm-02',
    dry_store_backup_name: 'Rohan Mehra',
    kitchen_runner_id: 'usr-runner-01',
    kitchen_runner_name: 'Ravi Kumar',
    evening_key_holder_id: 'usr-rm-02',
    evening_key_holder_name: 'Rohan Mehra',
    morning_receiving_window: '07:00-09:00',
    afternoon_receiving_window: '14:00-16:00',
    morning_issue_window: '06:00-08:30',
    afternoon_issue_window: '14:30-16:00',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    is_complete: true,
  },
  'IND-BLR-01': {
    store_id: 'IND-BLR-01',
    cold_room_custodian_id: 'usr-custodian-03',
    cold_room_custodian_name: 'Suresh Gowda',
    cold_room_backup_id: 'usr-rm-03',
    cold_room_backup_name: 'Ananya Reddy',
    dry_store_custodian_id: 'usr-custodian-03',
    dry_store_custodian_name: 'Suresh Gowda',
    dry_store_backup_id: 'usr-rm-03',
    dry_store_backup_name: 'Ananya Reddy',
    kitchen_runner_id: 'usr-runner-01',
    kitchen_runner_name: 'Ravi Kumar',
    evening_key_holder_id: 'usr-rm-03',
    evening_key_holder_name: 'Ananya Reddy',
    morning_receiving_window: '07:00-09:00',
    afternoon_receiving_window: '14:00-16:00',
    morning_issue_window: '06:00-08:30',
    afternoon_issue_window: '14:30-16:00',
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
    is_complete: true,
  },
};

let mockProposals: StoreWarehouseApprovalRecord[] = [
  {
    approval_id: 'b1000000-0000-0000-0000-000000000001',
    proposal_type: 'NEW_WAREHOUSE',
    proposed_name: 'Delhi Central Walk-in Deep Freezer',
    store_id: 'IND-DEL-01',
    store_name: 'Delhi Store 1',
    storage_type: 'FREEZER',
    nominated_custodian_id: 'usr-custodian-01',
    nominated_custodian_name: 'Rajesh Sharma',
    nominated_backup_id: 'usr-cust-backup',
    nominated_backup_name: 'Amit Patel',
    fc_decision: 'PENDING',
    fc_comment: null,
    requested_by_user_id: 'usr-admin-01',
    requested_by_name: 'Sunil Rao',
    requested_at: '2026-11-02T09:30:00Z',
    decided_by_user_id: null,
    decided_by_name: null,
    decided_at: null,
  },
  {
    approval_id: 'b1000000-0000-0000-0000-000000000002',
    proposal_type: 'NEW_STORE',
    proposed_name: 'Mumbai Bandra Store 1',
    store_id: 'IND-BOM-01',
    store_name: null,
    storage_type: 'COLD_ROOM',
    nominated_custodian_id: 'usr-rm-01',
    nominated_custodian_name: 'Priya Verma',
    nominated_backup_id: 'usr-evening-01',
    nominated_backup_name: 'Vikram Singh',
    fc_decision: 'PENDING',
    fc_comment: null,
    requested_by_user_id: 'usr-admin-01',
    requested_by_name: 'Sunil Rao',
    requested_at: '2026-11-01T14:15:00Z',
    decided_by_user_id: null,
    decided_by_name: null,
    decided_at: null,
  },
  {
    approval_id: 'b1000000-0000-0000-0000-000000000003',
    proposal_type: 'NEW_WAREHOUSE',
    proposed_name: 'Bengaluru Dry Expansion Storeroom',
    store_id: 'IND-BLR-01',
    store_name: 'Bengaluru Store 1',
    storage_type: 'DRY_STORE',
    nominated_custodian_id: 'usr-custodian-03',
    nominated_custodian_name: 'Suresh Gowda',
    nominated_backup_id: 'usr-rm-03',
    nominated_backup_name: 'Ananya Reddy',
    fc_decision: 'APPROVED',
    fc_comment: 'Approved. Space inspection completed and dry shelving layout verified.',
    requested_by_user_id: 'usr-rm-03',
    requested_by_name: 'Ananya Reddy',
    requested_at: '2026-10-28T11:00:00Z',
    decided_by_user_id: 'usr-approver-01',
    decided_by_name: 'Financial Controller Approver',
    decided_at: '2026-10-29T16:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// DATA ACCESS METHODS
// ---------------------------------------------------------------------------

/**
 * Returns all active stores along with their associated storerooms.
 */
export async function getStoresAndWarehouses(): Promise<StoreWithWarehouses[]> {
  try {
    const [storesRes, whRes] = await Promise.all([
      supabase.from('m_stores').select('*').order('store_id', { ascending: true }),
      supabase.from('m_warehouses').select('*').order('warehouse_id', { ascending: true }),
    ]);

    if (!storesRes.error && storesRes.data && storesRes.data.length > 0) {
      const liveStores = storesRes.data as StoreRecord[];
      const liveWarehouses = (whRes.data || []) as WarehouseRecord[];

      return liveStores.map((s) => ({
        ...s,
        warehouses: liveWarehouses.filter((w) => w.store_id === s.store_id),
      }));
    }
  } catch (e) {
    console.warn('Supabase getStoresAndWarehouses query fallback:', e);
  }

  // Fallback to local memory mock state
  return mockStores.map((s) => ({
    ...s,
    warehouses: mockWarehouses.filter((w) => w.store_id === s.store_id),
  }));
}

/**
 * Returns the operational Go-Live checklist configuration for a specific store.
 */
export async function getGoLiveChecklist(storeId: string): Promise<GoLiveChecklist | null> {
  try {
    const { data, error } = await supabase
      .from('m_go_live_assignments')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle();

    if (!error && data) {
      const row = data as Record<string, string | null>;
      const isComplete = Boolean(
        row.cold_room_custodian_id &&
        row.cold_room_backup_id &&
        row.morning_issue_window &&
        row.afternoon_issue_window
      );

      return {
        store_id: storeId,
        cold_room_custodian_id: row.cold_room_custodian_id,
        cold_room_custodian_name: resolveStaffName(row.cold_room_custodian_id),
        cold_room_backup_id: row.cold_room_backup_id,
        cold_room_backup_name: resolveStaffName(row.cold_room_backup_id),
        dry_store_custodian_id: row.dry_store_custodian_id,
        dry_store_custodian_name: resolveStaffName(row.dry_store_custodian_id),
        dry_store_backup_id: row.dry_store_backup_id,
        dry_store_backup_name: resolveStaffName(row.dry_store_backup_id),
        kitchen_runner_id: row.kitchen_runner_id,
        kitchen_runner_name: resolveStaffName(row.kitchen_runner_id),
        evening_key_holder_id: row.evening_key_holder_id,
        evening_key_holder_name: resolveStaffName(row.evening_key_holder_id),
        morning_receiving_window: row.morning_receiving_window || '07:00-09:00',
        afternoon_receiving_window: row.afternoon_receiving_window || '14:00-16:00',
        morning_issue_window: row.morning_issue_window || '06:00-08:30',
        afternoon_issue_window: row.afternoon_issue_window || '14:30-16:00',
        created_at: row.created_at || undefined,
        updated_at: row.updated_at || undefined,
        is_complete: isComplete,
      };
    }
  } catch (e) {
    console.warn('Supabase getGoLiveChecklist fallback:', e);
  }

  // Fallback to local memory mock state
  const found = mockChecklists[storeId];
  if (found) return { ...found };

  // Generate blank template if newly provisioned store
  const store = mockStores.find((s) => s.store_id === storeId);
  if (store) {
    const blank: GoLiveChecklist = {
      store_id: storeId,
      cold_room_custodian_id: null,
      cold_room_custodian_name: null,
      cold_room_backup_id: null,
      cold_room_backup_name: null,
      dry_store_custodian_id: null,
      dry_store_custodian_name: null,
      dry_store_backup_id: null,
      dry_store_backup_name: null,
      kitchen_runner_id: null,
      kitchen_runner_name: null,
      evening_key_holder_id: null,
      evening_key_holder_name: null,
      morning_receiving_window: '07:00-09:00',
      afternoon_receiving_window: '14:00-16:00',
      morning_issue_window: '06:00-08:30',
      afternoon_issue_window: '14:30-16:00',
      is_complete: false,
    };
    mockChecklists[storeId] = blank;
    return blank;
  }

  return null;
}

/**
 * Returns all store & warehouse proposals from t_store_warehouse_approvals.
 */
export async function getStoreProposals(): Promise<StoreWarehouseApprovalRecord[]> {
  try {
    const { data, error } = await supabase
      .from('t_store_warehouse_approvals')
      .select('*')
      .order('requested_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return (data as Record<string, unknown>[]).map((d) => ({
        approval_id: String(d.approval_id),
        proposal_type: d.proposal_type as ProposalType,
        proposed_name: String(d.proposed_name),
        store_id: (d.store_id as string) || null,
        store_name: d.store_id ? (mockStores.find((s) => s.store_id === d.store_id)?.store_name || String(d.store_id)) : null,
        storage_type: (d.storage_type as StorageType) || null,
        nominated_custodian_id: String(d.nominated_custodian_id),
        nominated_custodian_name: resolveStaffName(String(d.nominated_custodian_id)),
        nominated_backup_id: String(d.nominated_backup_id),
        nominated_backup_name: resolveStaffName(String(d.nominated_backup_id)),
        fc_decision: d.fc_decision as ProposalDecision,
        fc_comment: (d.fc_comment as string) || null,
        requested_by_user_id: String(d.requested_by_user_id),
        requested_by_name: resolveStaffName(String(d.requested_by_user_id)),
        requested_at: String(d.requested_at),
        decided_by_user_id: (d.decided_by_user_id as string) || null,
        decided_by_name: d.decided_by_user_id ? resolveStaffName(String(d.decided_by_user_id)) : null,
        decided_at: (d.decided_at as string) || null,
      }));
    }
  } catch (e) {
    console.warn('Supabase getStoreProposals fallback:', e);
  }

  return [...mockProposals];
}

/**
 * Submits a new Store or Warehouse expansion proposal (Flow H).
 * Enforces:
 * - Distinct primary and backup custodian users
 * - Non-empty proposal name
 * - Mandatory parent store_id for storeroom proposals
 * Calls propose_store_or_warehouse RPC.
 */
export async function proposeStoreOrWarehouse(
  params: ProposeStoreOrWarehouseParams
): Promise<string> {
  const {
    proposalType,
    proposedName,
    storeId,
    storageType,
    nominatedCustodianId,
    nominatedBackupId,
    requestedByUserId = 'usr-admin-01',
  } = params;

  if (!proposedName || proposedName.trim().length === 0) {
    throw new Error('Proposed facility name cannot be blank.');
  }

  if (!nominatedCustodianId) {
    throw new Error('Nominated primary custodian is mandatory.');
  }

  if (!nominatedBackupId) {
    throw new Error('Nominated backup custodian is mandatory.');
  }

  if (nominatedCustodianId === nominatedBackupId) {
    throw new Error('Nominated primary custodian and backup custodian must be two distinct staff members.');
  }

  if (proposalType === 'NEW_WAREHOUSE' && (!storeId || storeId.trim().length === 0)) {
    throw new Error('A parent restaurant store must be selected when proposing a new storeroom.');
  }

  const custodianUuid = normalizeToUuid(nominatedCustodianId);
  const backupUuid = normalizeToUuid(nominatedBackupId);

  try {
    const { data, error } = await supabase.rpc('propose_store_or_warehouse', {
      p_proposal_type: proposalType,
      p_proposed_name: proposedName.trim(),
      p_store_id: storeId ? storeId.trim() : null,
      p_storage_type: storageType || null,
      p_nominated_custodian_id: custodianUuid,
      p_nominated_backup_id: backupUuid,
    });

    if (error) {
      // Propagate explicit business rule violations from database
      if (error.code && error.code !== 'PGRST202' && !error.message.includes('fetch')) {
        throw new Error(error.message);
      }
      console.warn('Supabase propose_store_or_warehouse RPC fallback:', error.message);
    } else if (data) {
      return String(data);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('fetch') && !msg.includes('offline') && !msg.includes('PGRST202')) {
      throw err;
    }
  }

  // Offline / Prototype mock handling
  const newApprovalId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `prop-${Date.now()}`;

  const parentStore = storeId ? mockStores.find((s) => s.store_id === storeId) : null;

  const newRecord: StoreWarehouseApprovalRecord = {
    approval_id: newApprovalId,
    proposal_type: proposalType,
    proposed_name: proposedName.trim(),
    store_id: storeId ? storeId.trim() : null,
    store_name: parentStore?.store_name || storeId || null,
    storage_type: storageType || null,
    nominated_custodian_id: nominatedCustodianId,
    nominated_custodian_name: resolveStaffName(nominatedCustodianId),
    nominated_backup_id: nominatedBackupId,
    nominated_backup_name: resolveStaffName(nominatedBackupId),
    fc_decision: 'PENDING',
    fc_comment: null,
    requested_by_user_id: requestedByUserId,
    requested_by_name: resolveStaffName(requestedByUserId),
    requested_at: new Date().toISOString(),
    decided_by_user_id: null,
    decided_by_name: null,
    decided_at: null,
  };

  mockProposals = [newRecord, ...mockProposals];
  return newApprovalId;
}

/**
 * Reviews and authorizes or rejects a store or warehouse proposal (Flow H Step H8/H9).
 * Calls decide_store_warehouse_proposal RPC.
 * On approval: automatically provisions the store / warehouse in master data.
 */
export async function decideStoreProposal(params: {
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
  reviewerUserId?: string;
}): Promise<void> {
  const { approvalId, decision, comment, reviewerUserId = 'usr-approver-01' } = params;

  if (decision === 'REJECTED' && (!comment || comment.trim().length === 0)) {
    throw new Error('Mandatory written justification is required when rejecting a proposal.');
  }

  try {
    const { error } = await supabase.rpc('decide_store_warehouse_proposal', {
      p_approval_id: approvalId,
      p_decision: decision,
      p_comment: comment ? comment.trim() : null,
    });

    if (error) {
      if (error.code && error.code !== 'PGRST202' && !error.message.includes('fetch')) {
        throw new Error(error.message);
      }
      console.warn('Supabase decide_store_warehouse_proposal RPC fallback:', error.message);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('fetch') && !msg.includes('offline') && !msg.includes('PGRST202')) {
      throw err;
    }
  }

  // Update in-memory mock proposals
  const proposal = mockProposals.find((p) => p.approval_id === approvalId);
  if (proposal) {
    proposal.fc_decision = decision;
    proposal.fc_comment = comment ? comment.trim() : null;
    proposal.decided_by_user_id = reviewerUserId;
    proposal.decided_by_name = resolveStaffName(reviewerUserId);
    proposal.decided_at = new Date().toISOString();

    // Automatic provisioning on approval
    if (decision === 'APPROVED') {
      if (proposal.proposal_type === 'NEW_STORE') {
        const slug = proposal.proposed_name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .slice(0, 8);
        const newStoreId = proposal.store_id || `IND-${slug}`;

        let city = 'Delhi';
        const nameUpper = proposal.proposed_name.toUpperCase();
        if (nameUpper.includes('MUMBAI') || nameUpper.includes('BOM')) city = 'Mumbai';
        else if (nameUpper.includes('BENGALURU') || nameUpper.includes('BANGALORE')) city = 'Bengaluru';
        else if (nameUpper.includes('DELHI')) city = 'Delhi';

        // Provision store
        if (!mockStores.some((s) => s.store_id === newStoreId)) {
          mockStores.push({
            store_id: newStoreId,
            store_name: proposal.proposed_name,
            city,
            status: 'ACTIVE',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }

        // Provision default storerooms (Cold Room + Dry Store)
        const coldWhId = `WH-${newStoreId.replace('IND-', '')}-COLD`;
        const dryWhId = `WH-${newStoreId.replace('IND-', '')}-DRY`;

        if (!mockWarehouses.some((w) => w.warehouse_id === coldWhId)) {
          mockWarehouses.push({
            warehouse_id: coldWhId,
            store_id: newStoreId,
            warehouse_name: 'Cold Room (WH-01)',
            floor_level: 'GROUND',
            storage_type: 'COLD_ROOM',
            status: 'ACTIVE',
            is_active: true,
            approval_id: approvalId,
            created_at: new Date().toISOString(),
          });
        }

        if (!mockWarehouses.some((w) => w.warehouse_id === dryWhId)) {
          mockWarehouses.push({
            warehouse_id: dryWhId,
            store_id: newStoreId,
            warehouse_name: 'Dry Store (WH-02)',
            floor_level: 'GROUND',
            storage_type: 'DRY_STORE',
            status: 'ACTIVE',
            is_active: true,
            approval_id: approvalId,
            created_at: new Date().toISOString(),
          });
        }

        // Initialize Go-Live Checklist with nominated custodians
        mockChecklists[newStoreId] = {
          store_id: newStoreId,
          cold_room_custodian_id: proposal.nominated_custodian_id,
          cold_room_custodian_name: resolveStaffName(proposal.nominated_custodian_id),
          cold_room_backup_id: proposal.nominated_backup_id,
          cold_room_backup_name: resolveStaffName(proposal.nominated_backup_id),
          dry_store_custodian_id: null,
          dry_store_custodian_name: null,
          dry_store_backup_id: null,
          dry_store_backup_name: null,
          kitchen_runner_id: null,
          kitchen_runner_name: null,
          evening_key_holder_id: null,
          evening_key_holder_name: null,
          morning_receiving_window: '07:00-09:00',
          afternoon_receiving_window: '14:00-16:00',
          morning_issue_window: '06:00-08:30',
          afternoon_issue_window: '14:30-16:00',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_complete: true,
        };
      } else if (proposal.proposal_type === 'NEW_WAREHOUSE' && proposal.store_id) {
        const storeSuffix = proposal.store_id.replace('IND-', '');
        const typeSlug =
          proposal.storage_type === 'FREEZER'
            ? 'FREEZ'
            : proposal.storage_type === 'DRY_STORE'
            ? 'DRY'
            : 'COLD';
        const newWhId = `WH-${storeSuffix}-${typeSlug}-${approvalId.slice(0, 4).toUpperCase()}`;

        if (!mockWarehouses.some((w) => w.warehouse_id === newWhId)) {
          mockWarehouses.push({
            warehouse_id: newWhId,
            store_id: proposal.store_id,
            warehouse_name: proposal.proposed_name,
            floor_level: 'GROUND',
            storage_type: proposal.storage_type || 'COLD_ROOM',
            status: 'ACTIVE',
            is_active: true,
            approval_id: approvalId,
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }
}
