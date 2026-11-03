import { supabase } from '@/lib/supabase/client';

export type CustodyEventType = 'WINDOW_UNLOCK' | 'WINDOW_LOCK' | 'URGENT_ACCESS';
export type ShiftType = 'DAY_TO_EVENING' | 'EVENING_TO_MORNING';

export interface CustodyLogRecord {
  log_id: string;
  store_id: string;
  warehouse_id: string;
  warehouse_name?: string;
  event_type: CustodyEventType;
  custodian_user_id: string;
  custodian_name?: string;
  custodian_role?: string;
  urgent_reason?: string | null;
  created_at: string;
  timestamp: string;
}

export interface ShiftCustodyLogRecord {
  shift_log_id: string;
  store_id: string;
  warehouse_id: string;
  warehouse_name?: string;
  outgoing_custodian_id: string;
  outgoing_custodian_name?: string;
  incoming_holder_id: string;
  incoming_holder_name?: string;
  incoming_holder_role?: string;
  shift_type: ShiftType;
  signature_blob: string;
  transferred_at: string;
  notes?: string;
}

export interface StaffMember {
  userId: string;
  fullName: string;
  role: string;
  roleTitle: string;
  storeId: string;
}

export interface WarehouseOption {
  warehouseId: string;
  storeId: string;
  name: string;
  storageType: 'COLD_ROOM' | 'DRY_STORE';
}

export const STORE_WAREHOUSES: readonly WarehouseOption[] = [
  {
    warehouseId: 'WH-DEL01-COLD',
    storeId: 'IND-DEL-01',
    name: 'Cold Room',
    storageType: 'COLD_ROOM',
  },
  {
    warehouseId: 'WH-DEL01-DRY',
    storeId: 'IND-DEL-01',
    name: 'Dry Store',
    storageType: 'DRY_STORE',
  },
  {
    warehouseId: 'WH-DEL02-COLD',
    storeId: 'IND-DEL-02',
    name: 'Cold Room',
    storageType: 'COLD_ROOM',
  },
  {
    warehouseId: 'WH-DEL02-DRY',
    storeId: 'IND-DEL-02',
    name: 'Dry Store',
    storageType: 'DRY_STORE',
  },
  {
    warehouseId: 'WH-BLR01-COLD',
    storeId: 'IND-BLR-01',
    name: 'Cold Room',
    storageType: 'COLD_ROOM',
  },
  {
    warehouseId: 'WH-BLR01-DRY',
    storeId: 'IND-BLR-01',
    name: 'Dry Store',
    storageType: 'DRY_STORE',
  },
] as const;

export const STORE_STAFF: readonly StaffMember[] = [
  {
    userId: 'usr-custodian-01',
    fullName: 'Rajesh Sharma',
    role: 'CUSTODIAN',
    roleTitle: 'Cold Room Custodian',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-admin-01',
    fullName: 'Sunil Rao',
    role: 'ADMIN',
    roleTitle: 'Warehouse Keeper',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-rm-01',
    fullName: 'Priya Verma',
    role: 'RM',
    roleTitle: 'Restaurant Manager',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-evening-01',
    fullName: 'Vikram Singh',
    role: 'RM',
    roleTitle: 'Evening Duty Manager',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-cust-backup',
    fullName: 'Amit Patel',
    role: 'CUSTODIAN',
    roleTitle: 'Backup Custodian',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-dry-01',
    fullName: 'Manoj Gupta',
    role: 'CUSTODIAN',
    roleTitle: 'Dry Store Custodian',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-runner-01',
    fullName: 'Ravi Kumar',
    role: 'RUNNER',
    roleTitle: 'Kitchen Runner',
    storeId: 'IND-DEL-01',
  },
  {
    userId: 'usr-kitchen-01',
    fullName: 'Arjun Mehta',
    role: 'KITCHEN_REQ',
    roleTitle: 'Kitchen Section Requester',
    storeId: 'IND-DEL-01',
  },
  // Store IND-DEL-02
  {
    userId: 'usr-custodian-02',
    fullName: 'Kavita Nair',
    role: 'CUSTODIAN',
    roleTitle: 'Cold Room Custodian',
    storeId: 'IND-DEL-02',
  },
  {
    userId: 'usr-rm-02',
    fullName: 'Rohan Mehra',
    role: 'RM',
    roleTitle: 'Restaurant Manager',
    storeId: 'IND-DEL-02',
  },
  {
    userId: 'usr-admin-02',
    fullName: 'Deepak Joshi',
    role: 'ADMIN',
    roleTitle: 'Warehouse Keeper',
    storeId: 'IND-DEL-02',
  },
  // Store IND-BLR-01
  {
    userId: 'usr-custodian-03',
    fullName: 'Suresh Gowda',
    role: 'CUSTODIAN',
    roleTitle: 'Cold Room Custodian',
    storeId: 'IND-BLR-01',
  },
  {
    userId: 'usr-rm-03',
    fullName: 'Ananya Reddy',
    role: 'RM',
    roleTitle: 'Restaurant Manager',
    storeId: 'IND-BLR-01',
  },
] as const;

export function getStaffForStore(storeId: string): StaffMember[] {
  return STORE_STAFF.filter((s) => s.storeId === storeId);
}

export function getWarehousesForStore(storeId: string): WarehouseOption[] {
  const matched = STORE_WAREHOUSES.filter((w) => w.storeId === storeId);
  return matched.length > 0
    ? [...matched]
    : [
        {
          warehouseId: `${storeId}-COLD`,
          storeId,
          name: 'Cold Room',
          storageType: 'COLD_ROOM',
        },
        {
          warehouseId: `${storeId}-DRY`,
          storeId,
          name: 'Dry Store',
          storageType: 'DRY_STORE',
        },
      ];
}

// In-memory mock storage ensuring immediate local state updates and graceful offline behavior
const inMemoryCustodyLogs: CustodyLogRecord[] = [
  {
    log_id: 'cst-001',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    warehouse_name: 'Cold Room',
    event_type: 'WINDOW_LOCK',
    custodian_user_id: 'usr-custodian-01',
    custodian_name: 'Rajesh Sharma',
    custodian_role: 'Cold Room Custodian',
    urgent_reason: null,
    created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    log_id: 'cst-002',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    warehouse_name: 'Cold Room',
    event_type: 'WINDOW_UNLOCK',
    custodian_user_id: 'usr-custodian-01',
    custodian_name: 'Rajesh Sharma',
    custodian_role: 'Cold Room Custodian',
    urgent_reason: null,
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  },
  {
    log_id: 'cst-003',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    warehouse_name: 'Cold Room',
    event_type: 'URGENT_ACCESS',
    custodian_user_id: 'usr-custodian-01',
    custodian_name: 'Rajesh Sharma',
    custodian_role: 'Cold Room Custodian',
    urgent_reason: 'Off-window extraction: 8 kg Mozzarella block and 2.5 kg Basil for early kitchen mise-en-place',
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    timestamp: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    log_id: 'cst-004',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-DRY',
    warehouse_name: 'Dry Store',
    event_type: 'WINDOW_LOCK',
    custodian_user_id: 'usr-admin-01',
    custodian_name: 'Sunil Rao',
    custodian_role: 'Warehouse Keeper',
    urgent_reason: null,
    created_at: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
    timestamp: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
  },
  {
    log_id: 'cst-005',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-DRY',
    warehouse_name: 'Dry Store',
    event_type: 'WINDOW_UNLOCK',
    custodian_user_id: 'usr-admin-01',
    custodian_name: 'Sunil Rao',
    custodian_role: 'Warehouse Keeper',
    urgent_reason: null,
    created_at: new Date(Date.now() - 21 * 3600 * 1000).toISOString(),
    timestamp: new Date(Date.now() - 21 * 3600 * 1000).toISOString(),
  },
];

const inMemoryShiftLogs: ShiftCustodyLogRecord[] = [
  {
    shift_log_id: 'shf-001',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    warehouse_name: 'Cold Room',
    outgoing_custodian_id: 'usr-evening-01',
    outgoing_custodian_name: 'Vikram Singh',
    incoming_holder_id: 'usr-custodian-01',
    incoming_holder_name: 'Rajesh Sharma',
    incoming_holder_role: 'Cold Room Custodian',
    shift_type: 'EVENING_TO_MORNING',
    signature_blob: 'SIG-VERIFIED-HASH:9b8f2d7a31e84c50a112f94d0c',
    transferred_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    notes: 'Morning shift handover: Physical padlocks intact, cold room temperature logged at 3.1 C. Keys accepted.',
  },
  {
    shift_log_id: 'shf-002',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    warehouse_name: 'Cold Room',
    outgoing_custodian_id: 'usr-custodian-01',
    outgoing_custodian_name: 'Rajesh Sharma',
    incoming_holder_id: 'usr-evening-01',
    incoming_holder_name: 'Vikram Singh',
    incoming_holder_role: 'Evening Duty Manager',
    shift_type: 'DAY_TO_EVENING',
    signature_blob: 'SIG-VERIFIED-HASH:4c81a29f8d10b7e21a30c5e7b2',
    transferred_at: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
    notes: 'Day to evening handover: Day pick queue confirmed cleared, storeroom double-locked.',
  },
  {
    shift_log_id: 'shf-003',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-DRY',
    warehouse_name: 'Dry Store',
    outgoing_custodian_id: 'usr-admin-01',
    outgoing_custodian_name: 'Sunil Rao',
    incoming_holder_id: 'usr-rm-01',
    incoming_holder_name: 'Priya Verma',
    incoming_holder_role: 'Restaurant Manager',
    shift_type: 'DAY_TO_EVENING',
    signature_blob: 'SIG-VERIFIED-HASH:88d2c94ea1041b369e8f4c2810',
    transferred_at: new Date(Date.now() - 23 * 3600 * 1000).toISOString(),
    notes: 'Dry store key handover to Manager on Duty for evening service access.',
  },
];

/**
 * Record a storeroom custody event (Window unlock, lock, or off-window urgent access)
 * Strictly enforces non-empty justification for URGENT_ACCESS.
 */
export async function recordCustodyEvent(
  storeId: string,
  warehouseId: string,
  eventType: 'WINDOW_UNLOCK' | 'WINDOW_LOCK' | 'URGENT_ACCESS',
  urgentReason?: string
): Promise<string> {
  if (!storeId || storeId.trim().length === 0) {
    throw new Error('Store identifier is required.');
  }
  if (!warehouseId || warehouseId.trim().length === 0) {
    throw new Error('Warehouse identifier is required.');
  }
  if (!['WINDOW_UNLOCK', 'WINDOW_LOCK', 'URGENT_ACCESS'].includes(eventType)) {
    throw new Error(`Invalid custody event type: ${eventType}.`);
  }
  if (eventType === 'URGENT_ACCESS' && (!urgentReason || urgentReason.trim().length === 0)) {
    throw new Error('Urgent reason is required for off-window emergency access.');
  }

  const cleanReason = urgentReason ? urgentReason.trim() : null;

  try {
    const { data, error } = await supabase.rpc('record_custody_event', {
      p_store_id: storeId,
      p_warehouse_id: warehouseId,
      p_event_type: eventType,
      p_urgent_reason: cleanReason,
    });

    if (error) {
      const msg = error.message || '';
      if (!msg.toLowerCase().includes('fetch') && !msg.toLowerCase().includes('network')) {
        throw new Error(msg);
      }
    } else if (data) {
      const wh = STORE_WAREHOUSES.find((w) => w.warehouseId === warehouseId);
      const newEntry: CustodyLogRecord = {
        log_id: String(data),
        store_id: storeId,
        warehouse_id: warehouseId,
        warehouse_name: wh?.name || warehouseId,
        event_type: eventType,
        custodian_user_id: 'usr-custodian-01',
        custodian_name: 'Rajesh Sharma',
        custodian_role: 'Cold Room Custodian',
        urgent_reason: cleanReason,
        created_at: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      };
      inMemoryCustodyLogs.unshift(newEntry);
      return String(data);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('fetch') && !msg.toLowerCase().includes('network')) {
      throw err;
    }
  }

  // Graceful prototype fallback
  const mockId = `cst-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const wh = STORE_WAREHOUSES.find((w) => w.warehouseId === warehouseId);
  const newEntry: CustodyLogRecord = {
    log_id: mockId,
    store_id: storeId,
    warehouse_id: warehouseId,
    warehouse_name: wh?.name || warehouseId,
    event_type: eventType,
    custodian_user_id: 'usr-custodian-01',
    custodian_name: 'Rajesh Sharma',
    custodian_role: 'Cold Room Custodian',
    urgent_reason: cleanReason,
    created_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  };
  inMemoryCustodyLogs.unshift(newEntry);
  return mockId;
}

/**
 * Transfer storeroom physical key custody between shift custodians.
 * Strictly enforces Segregation of Duties: outgoing !== incoming.
 */
export async function transferShiftCustody(
  storeId: string,
  warehouseId: string,
  incomingHolderId: string,
  shiftType: 'DAY_TO_EVENING' | 'EVENING_TO_MORNING',
  signatureBlob: string,
  outgoingCustodianId: string = 'usr-custodian-01'
): Promise<string> {
  if (!storeId || storeId.trim().length === 0) {
    throw new Error('Store identifier is required.');
  }
  if (!warehouseId || warehouseId.trim().length === 0) {
    throw new Error('Warehouse identifier is required.');
  }
  if (!incomingHolderId || incomingHolderId.trim().length === 0) {
    throw new Error('Incoming key holder must be selected.');
  }
  if (!['DAY_TO_EVENING', 'EVENING_TO_MORNING'].includes(shiftType)) {
    throw new Error(`Invalid shift type: ${shiftType}.`);
  }
  if (!signatureBlob || signatureBlob.trim().length === 0) {
    throw new Error('Digital signature is required to confirm physical key transfer.');
  }
  if (outgoingCustodianId && outgoingCustodianId === incomingHolderId) {
    throw new Error('Segregation violation: Outgoing custodian cannot transfer custody to themselves.');
  }

  const cleanSignature = signatureBlob.trim();

  try {
    const { data, error } = await supabase.rpc('transfer_shift_custody', {
      p_store_id: storeId,
      p_warehouse_id: warehouseId,
      p_incoming_holder_id: incomingHolderId,
      p_shift_type: shiftType,
      p_signature_blob: cleanSignature,
    });

    if (error) {
      const msg = error.message || '';
      if (!msg.toLowerCase().includes('fetch') && !msg.toLowerCase().includes('network')) {
        throw new Error(msg);
      }
    } else if (data) {
      const wh = STORE_WAREHOUSES.find((w) => w.warehouseId === warehouseId);
      const incomingStaff = STORE_STAFF.find((s) => s.userId === incomingHolderId);
      const outgoingStaff = STORE_STAFF.find((s) => s.userId === outgoingCustodianId);
      const newShiftRecord: ShiftCustodyLogRecord = {
        shift_log_id: String(data),
        store_id: storeId,
        warehouse_id: warehouseId,
        warehouse_name: wh?.name || warehouseId,
        outgoing_custodian_id: outgoingCustodianId,
        outgoing_custodian_name: outgoingStaff?.fullName || 'Outgoing Custodian',
        incoming_holder_id: incomingHolderId,
        incoming_holder_name: incomingStaff?.fullName || 'Incoming Holder',
        incoming_holder_role: incomingStaff?.roleTitle || 'Key Holder',
        shift_type: shiftType,
        signature_blob: cleanSignature,
        transferred_at: new Date().toISOString(),
        notes: `Physical key transferred for ${wh?.name || warehouseId} (${shiftType.replace(/_/g, ' ')})`,
      };
      inMemoryShiftLogs.unshift(newShiftRecord);
      return String(data);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('fetch') && !msg.toLowerCase().includes('network')) {
      throw err;
    }
  }

  // Graceful prototype fallback
  const mockShiftId = `shf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const wh = STORE_WAREHOUSES.find((w) => w.warehouseId === warehouseId);
  const incomingStaff = STORE_STAFF.find((s) => s.userId === incomingHolderId);
  const outgoingStaff = STORE_STAFF.find((s) => s.userId === outgoingCustodianId);
  const newShiftRecord: ShiftCustodyLogRecord = {
    shift_log_id: mockShiftId,
    store_id: storeId,
    warehouse_id: warehouseId,
    warehouse_name: wh?.name || warehouseId,
    outgoing_custodian_id: outgoingCustodianId,
    outgoing_custodian_name: outgoingStaff?.fullName || 'Outgoing Custodian',
    incoming_holder_id: incomingHolderId,
    incoming_holder_name: incomingStaff?.fullName || 'Incoming Holder',
    incoming_holder_role: incomingStaff?.roleTitle || 'Key Holder',
    shift_type: shiftType,
    signature_blob: cleanSignature,
    transferred_at: new Date().toISOString(),
    notes: `Physical key transferred for ${wh?.name || warehouseId} (${shiftType.replace(/_/g, ' ')})`,
  };
  inMemoryShiftLogs.unshift(newShiftRecord);
  return mockShiftId;
}

/**
 * Fetch append-only custody access logs for a specific store.
 */
export async function getCustodyLogs(storeId: string): Promise<CustodyLogRecord[]> {
  try {
    const { data, error } = await supabase
      .from('t_custody_logs')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return (data as Record<string, unknown>[]).map((row) => {
        const wh = STORE_WAREHOUSES.find((w) => w.warehouseId === row.warehouse_id);
        const staff = STORE_STAFF.find((s) => s.userId === row.custodian_user_id);
        return {
          log_id: String(row.log_id),
          store_id: String(row.store_id),
          warehouse_id: String(row.warehouse_id),
          warehouse_name: wh?.name || String(row.warehouse_id),
          event_type: row.event_type as CustodyEventType,
          custodian_user_id: String(row.custodian_user_id),
          custodian_name: staff?.fullName || 'Custodian',
          custodian_role: staff?.roleTitle || 'Custodian',
          urgent_reason: (row.urgent_reason as string | null) || null,
          created_at: String(row.created_at),
          timestamp: String(row.created_at || row.timestamp || ''),
        };
      });
    }
  } catch {
    // fall through to in-memory store
  }

  return inMemoryCustodyLogs
    .filter((l) => l.store_id === storeId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Fetch append-only shift custody handover logs for a specific store.
 */
export async function getShiftLogs(storeId: string): Promise<ShiftCustodyLogRecord[]> {
  try {
    const { data, error } = await supabase
      .from('t_shift_custody_logs')
      .select('*')
      .eq('store_id', storeId)
      .order('transferred_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return (data as Record<string, unknown>[]).map((row) => {
        const wh = STORE_WAREHOUSES.find((w) => w.warehouseId === row.warehouse_id);
        const outgoing = STORE_STAFF.find((s) => s.userId === row.outgoing_custodian_id);
        const incoming = STORE_STAFF.find((s) => s.userId === row.incoming_holder_id);
        return {
          shift_log_id: String(row.shift_log_id),
          store_id: String(row.store_id),
          warehouse_id: String(row.warehouse_id),
          warehouse_name: wh?.name || String(row.warehouse_id),
          outgoing_custodian_id: String(row.outgoing_custodian_id),
          outgoing_custodian_name: outgoing?.fullName || 'Outgoing Custodian',
          incoming_holder_id: String(row.incoming_holder_id),
          incoming_holder_name: incoming?.fullName || 'Incoming Holder',
          incoming_holder_role: incoming?.roleTitle || 'Key Holder',
          shift_type: row.shift_type as ShiftType,
          signature_blob: String(row.signature_blob || ''),
          transferred_at: String(row.transferred_at),
          notes: String(row.notes || 'Physical key custody signed and transferred.'),
        };
      });
    }
  } catch {
    // fall through to in-memory store
  }

  return inMemoryShiftLogs
    .filter((s) => s.store_id === storeId)
    .sort((a, b) => new Date(b.transferred_at).getTime() - new Date(a.transferred_at).getTime());
}
