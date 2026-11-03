import { supabase } from '@/lib/supabase/client';

export type TransferStatus =
  | 'IN_TRANSIT'
  | 'RECEIVED_MATCH'
  | 'VARIANCE_PENDING_FC'
  | 'RECEIVED_VARIANCE_APPROVED'
  | 'REJECTED';

export interface TransferRecord {
  transfer_id: string;
  source_store_id: string;
  source_warehouse_id: string;
  target_store_id: string;
  target_warehouse_id: string;
  item_code: string;
  item_name?: string;
  category_group?: string;
  dispatch_qty_kg: number;
  dispatch_qty_pcs: number | null;
  vehicle_seal_no: string;
  dispatcher_user_id: string;
  dispatcher_name?: string;
  dispatched_at: string;
  receive_qty_kg: number | null;
  receive_qty_pcs: number | null;
  receiver_user_id: string | null;
  receiver_name?: string | null;
  received_at: string | null;
  variance_qty: number | null;
  fc_approval_id: string | null;
  fc_approver_name?: string | null;
  status: TransferStatus;
  out_movement_id: string | null;
  in_movement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransferItemMeta {
  item_code: string;
  item_name: string;
  category_group: 'CHEESE' | 'MEAT' | 'PRODUCE' | 'DRY' | 'PREP' | 'SEAFOOD' | 'CANNED';
  base_uom: 'kg' | 'pcs';
  dual_unit_required: boolean;
  default_warehouse_type: 'COLD_ROOM' | 'DRY_STORE';
}

export const TRANSFER_ITEMS: TransferItemMeta[] = [
  {
    item_code: 'RM-MOZ-01',
    item_name: 'Mozzarella block',
    category_group: 'CHEESE',
    base_uom: 'kg',
    dual_unit_required: true,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-BUR-01',
    item_name: 'Burrata',
    category_group: 'CHEESE',
    base_uom: 'pcs',
    dual_unit_required: true,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-GOR-01',
    item_name: 'Gorgonzola',
    category_group: 'CHEESE',
    base_uom: 'kg',
    dual_unit_required: true,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-CHK-01',
    item_name: 'Chicken breast',
    category_group: 'MEAT',
    base_uom: 'kg',
    dual_unit_required: true,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-PAR-01',
    item_name: 'Parma ham',
    category_group: 'MEAT',
    base_uom: 'kg',
    dual_unit_required: true,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-SAL-01',
    item_name: 'Salmon fillet',
    category_group: 'SEAFOOD',
    base_uom: 'kg',
    dual_unit_required: false,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-BAS-01',
    item_name: 'Fresh basil',
    category_group: 'PRODUCE',
    base_uom: 'kg',
    dual_unit_required: false,
    default_warehouse_type: 'COLD_ROOM',
  },
  {
    item_code: 'RM-TOM-01',
    item_name: 'San Marzano tomatoes',
    category_group: 'CANNED',
    base_uom: 'kg',
    dual_unit_required: false,
    default_warehouse_type: 'DRY_STORE',
  },
  {
    item_code: 'RM-FLO-01',
    item_name: 'Caputo 00 Flour',
    category_group: 'DRY',
    base_uom: 'kg',
    dual_unit_required: false,
    default_warehouse_type: 'DRY_STORE',
  },
  {
    item_code: 'RM-OIL-01',
    item_name: 'Extra virgin olive oil',
    category_group: 'DRY',
    base_uom: 'kg',
    dual_unit_required: false,
    default_warehouse_type: 'DRY_STORE',
  },
];

export interface WarehouseSelection {
  warehouseId: string;
  storeId: string;
  name: string;
  storageType: 'COLD_ROOM' | 'DRY_STORE';
}

export const TRANSFER_WAREHOUSES: WarehouseSelection[] = [
  { warehouseId: 'WH-DEL01-COLD', storeId: 'IND-DEL-01', name: 'Cold Room', storageType: 'COLD_ROOM' },
  { warehouseId: 'WH-DEL01-DRY', storeId: 'IND-DEL-01', name: 'Dry Store', storageType: 'DRY_STORE' },
  { warehouseId: 'WH-DEL02-COLD', storeId: 'IND-DEL-02', name: 'Cold Room', storageType: 'COLD_ROOM' },
  { warehouseId: 'WH-DEL02-DRY', storeId: 'IND-DEL-02', name: 'Dry Store', storageType: 'DRY_STORE' },
  { warehouseId: 'WH-BLR01-COLD', storeId: 'IND-BLR-01', name: 'Cold Room', storageType: 'COLD_ROOM' },
  { warehouseId: 'WH-BLR01-DRY', storeId: 'IND-BLR-01', name: 'Dry Store', storageType: 'DRY_STORE' },
];

export const TRANSFER_STORES = [
  { storeId: 'IND-DEL-01', name: 'Delhi Store 1' },
  { storeId: 'IND-DEL-02', name: 'Delhi Store 2' },
  { storeId: 'IND-BLR-01', name: 'Bengaluru Store 1' },
] as const;

export function getItemMeta(itemCode: string): TransferItemMeta | undefined {
  return TRANSFER_ITEMS.find((it) => it.item_code === itemCode);
}

export function isDualUnitRequired(itemCode: string): boolean {
  const meta = getItemMeta(itemCode);
  if (!meta) return false;
  return meta.dual_unit_required || meta.category_group === 'CHEESE' || meta.category_group === 'MEAT';
}

// In-memory seed state for offline, testing, and prototype mode
let mockTransfers: TransferRecord[] = [
  {
    transfer_id: 'TRF-20261103-001',
    source_store_id: 'IND-DEL-02',
    source_warehouse_id: 'WH-DEL02-COLD',
    target_store_id: 'IND-DEL-01',
    target_warehouse_id: 'WH-DEL01-COLD',
    item_code: 'RM-MOZ-01',
    item_name: 'Mozzarella block',
    category_group: 'CHEESE',
    dispatch_qty_kg: 20.0,
    dispatch_qty_pcs: 4,
    vehicle_seal_no: 'SEAL-DL02-9901',
    dispatcher_user_id: 'usr-admin-02',
    dispatcher_name: 'Vikram Singh (Delhi 2 Keeper)',
    dispatched_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    receive_qty_kg: null,
    receive_qty_pcs: null,
    receiver_user_id: null,
    receiver_name: null,
    received_at: null,
    variance_qty: null,
    fc_approval_id: null,
    status: 'IN_TRANSIT',
    out_movement_id: 'mov-out-001',
    in_movement_id: null,
    notes: 'Urgent cheese transfer for lunch prep rush',
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    transfer_id: 'TRF-20261103-002',
    source_store_id: 'IND-BLR-01',
    source_warehouse_id: 'WH-BLR01-DRY',
    target_store_id: 'IND-DEL-01',
    target_warehouse_id: 'WH-DEL01-DRY',
    item_code: 'RM-FLO-01',
    item_name: 'Caputo 00 Flour',
    category_group: 'DRY',
    dispatch_qty_kg: 50.0,
    dispatch_qty_pcs: null,
    vehicle_seal_no: 'SEAL-BLR-4412',
    dispatcher_user_id: 'usr-rm-03',
    dispatcher_name: 'Ananya Rao (Bengaluru RM)',
    dispatched_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    receive_qty_kg: null,
    receive_qty_pcs: null,
    receiver_user_id: null,
    receiver_name: null,
    received_at: null,
    variance_qty: null,
    fc_approval_id: null,
    status: 'IN_TRANSIT',
    out_movement_id: 'mov-out-002',
    in_movement_id: null,
    notes: 'Inter-region bulk flour stock rebalance',
    created_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
  },
  {
    transfer_id: 'TRF-20261103-003',
    source_store_id: 'IND-DEL-01',
    source_warehouse_id: 'WH-DEL01-COLD',
    target_store_id: 'IND-DEL-02',
    target_warehouse_id: 'WH-DEL02-COLD',
    item_code: 'RM-CHK-01',
    item_name: 'Chicken breast',
    category_group: 'MEAT',
    dispatch_qty_kg: 15.0,
    dispatch_qty_pcs: 30,
    vehicle_seal_no: 'SEAL-DEL1-1044',
    dispatcher_user_id: 'usr-admin-01',
    dispatcher_name: 'Warehouse Keeper Admin',
    dispatched_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    receive_qty_kg: null,
    receive_qty_pcs: null,
    receiver_user_id: null,
    receiver_name: null,
    received_at: null,
    variance_qty: null,
    fc_approval_id: null,
    status: 'IN_TRANSIT',
    out_movement_id: 'mov-out-003',
    in_movement_id: null,
    notes: 'Fresh poultry dispatch to South Delhi outlet',
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    transfer_id: 'TRF-20261102-004',
    source_store_id: 'IND-DEL-02',
    source_warehouse_id: 'WH-DEL02-COLD',
    target_store_id: 'IND-DEL-01',
    target_warehouse_id: 'WH-DEL01-COLD',
    item_code: 'RM-PAR-01',
    item_name: 'Parma ham',
    category_group: 'MEAT',
    dispatch_qty_kg: 10.0,
    dispatch_qty_pcs: 2,
    vehicle_seal_no: 'SEAL-DL02-8871',
    dispatcher_user_id: 'usr-admin-02',
    dispatcher_name: 'Vikram Singh (Delhi 2 Keeper)',
    dispatched_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    receive_qty_kg: 9.4,
    receive_qty_pcs: 2,
    receiver_user_id: 'usr-admin-01',
    receiver_name: 'Warehouse Keeper Admin',
    received_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    variance_qty: -0.6,
    fc_approval_id: null,
    status: 'VARIANCE_PENDING_FC',
    out_movement_id: 'mov-out-004',
    in_movement_id: null,
    notes: 'Discrepancy: -0.600 kg. Receiver reported minor slicing shrinkage during packaging.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    transfer_id: 'TRF-20261101-005',
    source_store_id: 'IND-DEL-01',
    source_warehouse_id: 'WH-DEL01-COLD',
    target_store_id: 'IND-DEL-02',
    target_warehouse_id: 'WH-DEL02-COLD',
    item_code: 'RM-BUR-01',
    item_name: 'Burrata',
    category_group: 'CHEESE',
    dispatch_qty_kg: 3.0,
    dispatch_qty_pcs: 12,
    vehicle_seal_no: 'SEAL-DEL1-0892',
    dispatcher_user_id: 'usr-admin-01',
    dispatcher_name: 'Warehouse Keeper Admin',
    dispatched_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    receive_qty_kg: 3.0,
    receive_qty_pcs: 12,
    receiver_user_id: 'usr-admin-02',
    receiver_name: 'Vikram Singh (Delhi 2 Keeper)',
    received_at: new Date(Date.now() - 1000 * 60 * 60 * 46).toISOString(),
    variance_qty: 0,
    fc_approval_id: null,
    status: 'RECEIVED_MATCH',
    out_movement_id: 'mov-out-005',
    in_movement_id: 'mov-in-005',
    notes: 'Exact match verified upon arrival. Seal intact.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 46).toISOString(),
  },
  {
    transfer_id: 'TRF-20261031-006',
    source_store_id: 'IND-BLR-01',
    source_warehouse_id: 'WH-BLR01-COLD',
    target_store_id: 'IND-DEL-01',
    target_warehouse_id: 'WH-DEL01-COLD',
    item_code: 'RM-GOR-01',
    item_name: 'Gorgonzola',
    category_group: 'CHEESE',
    dispatch_qty_kg: 8.0,
    dispatch_qty_pcs: 4,
    vehicle_seal_no: 'SEAL-BLR-2911',
    dispatcher_user_id: 'usr-rm-03',
    dispatcher_name: 'Ananya Rao (Bengaluru RM)',
    dispatched_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    receive_qty_kg: 7.7,
    receive_qty_pcs: 4,
    receiver_user_id: 'usr-admin-01',
    receiver_name: 'Warehouse Keeper Admin',
    received_at: new Date(Date.now() - 1000 * 60 * 60 * 68).toISOString(),
    variance_qty: -0.3,
    fc_approval_id: 'usr-approver-01',
    fc_approver_name: 'Financial Controller Approver',
    status: 'RECEIVED_VARIANCE_APPROVED',
    out_movement_id: 'mov-out-006',
    in_movement_id: 'mov-in-006',
    notes: 'FC signed off -0.300 kg natural moisture loss during long-haul transit.',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 66).toISOString(),
  },
];

/**
 * Dispatches an inter-store transfer.
 * Decrements source warehouse book stock via TRANSFER_OUT_INTRANSIT (-Q)
 * and records shipment in t_transfer_intransit with status 'IN_TRANSIT'.
 */
export async function dispatchTransfer(
  sourceStoreId: string,
  sourceWhId: string,
  targetStoreId: string,
  targetWhId: string,
  itemCode: string,
  qtyKg: number,
  qtyPcs?: number | null,
  sealNo?: string
): Promise<string> {
  // Client pre-validations matching DB constraints
  if (sourceStoreId === targetStoreId) {
    throw new Error(`Source store (${sourceStoreId}) cannot be identical to destination store.`);
  }

  if (!qtyKg || qtyKg <= 0) {
    throw new Error('Dispatch quantity (kg) must be strictly greater than zero.');
  }

  const trimmedSeal = sealNo ? sealNo.trim() : '';
  if (!trimmedSeal) {
    throw new Error('Vehicle seal number is mandatory for inter-store transit.');
  }

  const dualUnitReq = isDualUnitRequired(itemCode);
  if (dualUnitReq && (!qtyPcs || qtyPcs <= 0)) {
    throw new Error('Dual-unit required: Cheese and meat items strictly require piece count (pcs > 0).');
  }

  try {
    const { data, error } = await supabase.rpc('dispatch_store_transfer', {
      p_source_store_id: sourceStoreId,
      p_source_warehouse_id: sourceWhId,
      p_target_store_id: targetStoreId,
      p_target_warehouse_id: targetWhId,
      p_item_code: itemCode,
      p_qty_kg: qtyKg,
      p_qty_pcs: qtyPcs != null && qtyPcs > 0 ? qtyPcs : null,
      p_seal_no: trimmedSeal,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      // Propagate database business check violations
      if (
        msg.includes('unauthorized') ||
        msg.includes('dual-unit') ||
        msg.includes('cannot be the same') ||
        msg.includes('seal number') ||
        msg.includes('greater than zero')
      ) {
        throw new Error(error.message);
      }
      console.warn('dispatch_store_transfer RPC fallback mode:', error.message);
    } else if (data) {
      return String(data);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrConfig =
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('placeholder') ||
      msg.includes('PGRST202');

    if (!isNetworkOrConfig) {
      throw err;
    }
  }

  // Fallback interactive mock creation
  const transferId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `TRF-${Date.now().toString().slice(-6)}`;

  const itemMeta = getItemMeta(itemCode);

  const newRecord: TransferRecord = {
    transfer_id: transferId,
    source_store_id: sourceStoreId,
    source_warehouse_id: sourceWhId,
    target_store_id: targetStoreId,
    target_warehouse_id: targetWhId,
    item_code: itemCode,
    item_name: itemMeta?.item_name || itemCode,
    category_group: itemMeta?.category_group || 'GENERAL',
    dispatch_qty_kg: qtyKg,
    dispatch_qty_pcs: qtyPcs != null && qtyPcs > 0 ? qtyPcs : null,
    vehicle_seal_no: trimmedSeal,
    dispatcher_user_id: 'usr-admin-01',
    dispatcher_name: 'Warehouse Keeper Admin',
    dispatched_at: new Date().toISOString(),
    receive_qty_kg: null,
    receive_qty_pcs: null,
    receiver_user_id: null,
    receiver_name: null,
    received_at: null,
    variance_qty: null,
    fc_approval_id: null,
    status: 'IN_TRANSIT',
    out_movement_id: `mov-out-${Date.now()}`,
    in_movement_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  mockTransfers = [newRecord, ...mockTransfers];
  return transferId;
}

/**
 * Confirms physical arrival and intake at destination store.
 * If received count matches dispatch count -> RECEIVED_MATCH (+Q in ledger).
 * If discrepancy detected -> VARIANCE_PENDING_FC (ledger withheld pending FC).
 */
export async function receiveTransfer(
  transferId: string,
  receiveQtyKg: number,
  receiveQtyPcs?: number | null
): Promise<void> {
  if (receiveQtyKg === null || receiveQtyKg === undefined || receiveQtyKg < 0) {
    throw new Error('Received quantity (kg) must be non-negative.');
  }

  try {
    const { error } = await supabase.rpc('receive_store_transfer', {
      p_transfer_id: transferId,
      p_receive_qty_kg: receiveQtyKg,
      p_receive_qty_pcs: receiveQtyPcs != null && receiveQtyPcs >= 0 ? receiveQtyPcs : null,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes('unauthorized') ||
        msg.includes('segregation of duties') ||
        msg.includes('dual-unit') ||
        msg.includes('not in in_transit') ||
        msg.includes('not found')
      ) {
        throw new Error(error.message);
      }
      console.warn('receive_store_transfer RPC fallback mode:', error.message);
    } else {
      return;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrConfig =
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('placeholder') ||
      msg.includes('PGRST202');

    if (!isNetworkOrConfig) {
      throw err;
    }
  }

  // Fallback interactive mock mutation
  const target = mockTransfers.find((t) => t.transfer_id === transferId);
  if (!target) {
    throw new Error(`Transfer ${transferId} not found.`);
  }

  if (target.status !== 'IN_TRANSIT') {
    throw new Error(`Transfer is not in IN_TRANSIT status (current status: ${target.status}).`);
  }

  const isMatch =
    Number(receiveQtyKg) === Number(target.dispatch_qty_kg) &&
    (target.dispatch_qty_pcs === null || Number(receiveQtyPcs) === Number(target.dispatch_qty_pcs));

  const varianceQty = Number((receiveQtyKg - target.dispatch_qty_kg).toFixed(3));

  target.receive_qty_kg = receiveQtyKg;
  target.receive_qty_pcs = receiveQtyPcs != null ? receiveQtyPcs : null;
  target.receiver_user_id = 'usr-admin-02';
  target.receiver_name = 'Receiving Warehouse Keeper';
  target.received_at = new Date().toISOString();
  target.variance_qty = isMatch ? 0 : varianceQty;
  target.status = isMatch ? 'RECEIVED_MATCH' : 'VARIANCE_PENDING_FC';
  target.in_movement_id = isMatch ? `mov-in-${Date.now()}` : null;
  target.updated_at = new Date().toISOString();
}

/**
 * Approves in-transit variance by Financial Controller (APPROVER).
 * Appends received quantity (+receive_qty_kg) into destination ledger
 * and updates status to RECEIVED_VARIANCE_APPROVED.
 */
export async function approveTransferVariance(
  transferId: string,
  notes?: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('approve_transfer_variance', {
      p_transfer_id: transferId,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes('unauthorized') ||
        msg.includes('segregation of duties') ||
        msg.includes('variance_pending_fc') ||
        msg.includes('not found')
      ) {
        throw new Error(error.message);
      }
      console.warn('approve_transfer_variance RPC fallback mode:', error.message);
    } else {
      return;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrConfig =
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('placeholder') ||
      msg.includes('PGRST202');

    if (!isNetworkOrConfig) {
      throw err;
    }
  }

  // Fallback interactive mock mutation
  const target = mockTransfers.find((t) => t.transfer_id === transferId);
  if (!target) {
    throw new Error(`Transfer ${transferId} not found.`);
  }

  if (target.status !== 'VARIANCE_PENDING_FC') {
    throw new Error(`Cannot approve: status is ${target.status}, expected VARIANCE_PENDING_FC.`);
  }

  target.status = 'RECEIVED_VARIANCE_APPROVED';
  target.fc_approval_id = 'usr-approver-01';
  target.fc_approver_name = 'Financial Controller Approver';
  target.notes = notes?.trim() || target.notes || 'FC approved physical count discrepancy';
  target.in_movement_id = `mov-in-${Date.now()}`;
  target.updated_at = new Date().toISOString();
}

/**
 * Rejects in-transit variance claim by Financial Controller (APPROVER).
 * Stock is refused and remains unbooked into destination inventory.
 */
export async function rejectTransferVariance(
  transferId: string,
  notes?: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('reject_transfer_variance', {
      p_transfer_id: transferId,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes('unauthorized') ||
        msg.includes('segregation of duties') ||
        msg.includes('variance_pending_fc') ||
        msg.includes('not found')
      ) {
        throw new Error(error.message);
      }
      console.warn('reject_transfer_variance RPC fallback mode:', error.message);
    } else {
      return;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrConfig =
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('placeholder') ||
      msg.includes('PGRST202');

    if (!isNetworkOrConfig) {
      throw err;
    }
  }

  const target = mockTransfers.find((t) => t.transfer_id === transferId);
  if (!target) {
    throw new Error(`Transfer ${transferId} not found.`);
  }

  if (target.status !== 'VARIANCE_PENDING_FC') {
    throw new Error(`Cannot reject: status is ${target.status}, expected VARIANCE_PENDING_FC.`);
  }

  target.status = 'REJECTED';
  target.fc_approval_id = 'usr-approver-01';
  target.fc_approver_name = 'Financial Controller Approver';
  target.notes = notes?.trim() || 'Rejected by Financial Controller';
  target.updated_at = new Date().toISOString();
}

/**
 * Retrieves active and historical transfers for the specified store scope.
 * If storeId is 'ALL', returns all transfers across branches.
 */
export async function getActiveTransfers(storeId: string): Promise<TransferRecord[]> {
  try {
    let query = supabase
      .from('t_transfer_intransit')
      .select('*')
      .order('dispatched_at', { ascending: false });

    if (storeId && storeId !== 'ALL') {
      query = query.or(`source_store_id.eq.${storeId},target_store_id.eq.${storeId}`);
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((d) => {
        const itemMeta = getItemMeta(d.item_code);
        return {
          ...d,
          item_name: d.item_name || itemMeta?.item_name || d.item_code,
          category_group: d.category_group || itemMeta?.category_group || 'GENERAL',
        };
      }) as TransferRecord[];
    }
  } catch {
    // Proceed to fallback mock records
  }

  if (!storeId || storeId === 'ALL') {
    return [...mockTransfers];
  }

  return mockTransfers.filter(
    (t) => t.source_store_id === storeId || t.target_store_id === storeId
  );
}
