/**
 * Append-Only Stock Movements & Derived Stock Data Wrapper
 *
 * Implements Flow C-2 two-stage issue transactions and append-only ledger queries:
 * - t_stock_movements (immutable append-only log)
 * - v_stock_current (derived book stock)
 * - v_stock_lots_fifo (FIFO lot tracking)
 *
 * NON-NEGOTIABLE RULE: Quantities only. Inventory movements and physical balances exclusively.
 */

import { supabase } from '@/lib/supabase/client';
import { MovementType } from '@/lib/contracts/enums';
import { resolveMovementDelta } from '@/lib/testing/ledger-oracle';
import { SEED_ITEMS } from '@/lib/testing/synthetic-seed';

export interface LedgerMovementRecord {
  movement_id: string;
  store_id: string;
  warehouse_id: string;
  item_code: string;
  item_name: string;
  movement_type: MovementType;
  quantity: number; // Signed: positive for inbound/offsets/reversals, negative for issues/disposals
  uom: string;
  batch_number: string | null;
  expiry_date: string | null;
  reference_doc_id: string;
  created_by_user_id: string;
  actor_name: string;
  created_at: string;
  derived_stock_after?: number;
}

export interface StockCurrentRecord {
  store_id: string;
  warehouse_id: string;
  item_code: string;
  item_name: string;
  book_stock: number;
  uom: string;
}

export interface StockFifoLotRecord {
  store_id: string;
  warehouse_id: string;
  item_code: string;
  item_name: string;
  batch_number: string | null;
  expiry_date: string | null;
  uom: string;
  quantity: number;
  days_to_expiry: number | null;
  expiry_status: 'EXPIRED_LOCK' | 'EXPIRY_AMBER' | 'FIFO_OK';
  created_at: string;
}

// Master metadata lookups for fallback mode
const ITEM_DIRECTORY: Record<string, { name: string; uom: string; wh: string }> = {
  'RM-MOZ-01': { name: 'Mozzarella block', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'RM-BAS-01': { name: 'Fresh basil', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'RM-BUR-01': { name: 'Burrata', uom: 'pcs', wh: 'WH-DEL01-COLD' },
  'RM-CHK-01': { name: 'Chicken breast', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'RM-DOU-01': { name: 'Pizza dough ball', uom: 'pcs', wh: 'WH-DEL01-COLD' },
  'RM-SAL-01': { name: 'Salmon fillet', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'RM-PAR-01': { name: 'Parma ham', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'RM-TOM-01': { name: 'San Marzano tomatoes', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'RM-FLO-01': { name: 'Caputo 00 Flour', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'RM-OIL-01': { name: 'Extra virgin olive oil', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'RM-YST-01': { name: 'Active dry yeast', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'RM-SLT-01': { name: 'Sea salt', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'ITM-CHZ-001': { name: 'Fresh Mozzarella Block', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'ITM-CHZ-002': { name: 'Burrata Artisanal 125g', uom: 'pcs', wh: 'WH-DEL01-COLD' },
  'ITM-DRY-001': { name: 'Caputo Type 00 Pizza Flour', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'ITM-DRY-002': { name: 'San Marzano Tomato Pelati', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'ITM-DRY-003': { name: 'Extra Virgin Olive Oil', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'ITM-DRY-004': { name: 'Fresh Active Yeast', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'ITM-DRY-005': { name: 'Sea Salt Coarse', uom: 'kg', wh: 'WH-DEL01-DRY' },
  'ITM-MET-001': { name: 'Prosciutto di Parma', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'ITM-MET-002': { name: 'Spicy Salami Spianata', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'ITM-VEG-001': { name: 'Fresh Sweet Basil', uom: 'kg', wh: 'WH-DEL01-COLD' },
  'ITM-BEV-001': { name: 'San Pellegrino Sparkling Water 750ml', uom: 'pcs', wh: 'WH-DEL01-DRY' },
};

const USER_DIRECTORY: Record<string, string> = {
  'usr-sysadmin-01': 'System Admin',
  'usr-admin-01': 'Warehouse Keeper (Admin)',
  'usr-rm-01': 'Restaurant Manager',
  'usr-kitchen-01': 'Kitchen Requester',
  'usr-bar-01': 'Bar Requester',
  'usr-cheese-01': 'Cheese Requester',
  'usr-runner-01': 'Kitchen Runner',
  'usr-custodian-01': 'Cold Room Custodian',
  'usr-accountant-01': 'Store Accountant',
  'usr-approver-01': 'Financial Controller Approver',
  'usr-viewer-01': 'Internal Auditor',
};

// Deterministic seed movements demonstrating Flow C-2 Worked Examples 1, 2, and 3
function buildFallbackMovements(storeId: string): LedgerMovementRecord[] {
  return [
    // Step 0: Inbound baseline receipts (100 kg baseline for worked examples)
    {
      movement_id: 'mvt-1001',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-MOZ-01',
      item_name: 'Mozzarella block',
      movement_type: 'GRPO_IMPORT',
      quantity: 100.0,
      uom: 'kg',
      batch_number: 'LOT-2026-MOZ-01',
      expiry_date: '2026-11-20',
      reference_doc_id: 'GRPO-2026-901',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-01T08:00:00.000Z',
    },
    {
      movement_id: 'mvt-1002',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-BAS-01',
      item_name: 'Fresh basil',
      movement_type: 'GRPO_IMPORT',
      quantity: 100.0,
      uom: 'kg',
      batch_number: 'LOT-2026-BAS-01',
      expiry_date: '2026-11-06',
      reference_doc_id: 'GRPO-2026-902',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-01T08:15:00.000Z',
    },
    {
      movement_id: 'mvt-1003',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-TOM-01',
      item_name: 'San Marzano tomatoes',
      movement_type: 'GRPO_IMPORT',
      quantity: 100.0,
      uom: 'kg',
      batch_number: 'LOT-2026-TOM-01',
      expiry_date: '2027-10-31',
      reference_doc_id: 'GRPO-2026-903',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-01T08:30:00.000Z',
    },
    {
      movement_id: 'mvt-1004',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-FLO-01',
      item_name: 'Caputo 00 Flour',
      movement_type: 'GRPO_IMPORT',
      quantity: 350.0,
      uom: 'kg',
      batch_number: 'LOT-2026-FLR-01',
      expiry_date: '2027-05-01',
      reference_doc_id: 'GRPO-2026-904',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-01T08:45:00.000Z',
    },
    {
      movement_id: 'mvt-1005',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-BUR-01',
      item_name: 'Burrata',
      movement_type: 'GRPO_IMPORT',
      quantity: 48.0,
      uom: 'pcs',
      batch_number: 'LOT-2026-BUR-01',
      expiry_date: '2026-11-12',
      reference_doc_id: 'GRPO-2026-905',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-01T09:00:00.000Z',
    },

    // Flow C-2 Worked Example 1: Issue 5 kg Mozzarella, Runner Declines 5 kg at Door
    // Step 1: Admin stages 5 kg (ISSUE_PENDING -5.000) -> Book stock = 95.000 kg
    {
      movement_id: 'mvt-1010',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-MOZ-01',
      item_name: 'Mozzarella block',
      movement_type: 'ISSUE_PENDING',
      quantity: -5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-MOZ-01',
      expiry_date: '2026-11-20',
      reference_doc_id: 'REQ-2026-001',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-02T09:10:00.000Z',
    },
    // Step 2: Runner declines at door: goods physically returned to shelf (ISSUE_REVERSAL +5.000) -> Book stock = 100.000 kg
    {
      movement_id: 'mvt-1011',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-MOZ-01',
      item_name: 'Mozzarella block',
      movement_type: 'ISSUE_REVERSAL',
      quantity: 5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-MOZ-01',
      expiry_date: '2026-11-20',
      reference_doc_id: 'REQ-2026-001',
      created_by_user_id: 'usr-runner-01',
      actor_name: 'Kitchen Runner',
      created_at: '2026-11-02T09:20:00.000Z',
    },

    // Flow C-2 Worked Example 2: Issue 5 kg Fresh Basil, Runner Confirms 5 kg at Door
    // Step 1: Admin stages 5 kg (ISSUE_PENDING -5.000) -> Book stock = 95.000 kg
    {
      movement_id: 'mvt-1020',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-BAS-01',
      item_name: 'Fresh basil',
      movement_type: 'ISSUE_PENDING',
      quantity: -5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-BAS-01',
      expiry_date: '2026-11-06',
      reference_doc_id: 'REQ-2026-002',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-02T10:00:00.000Z',
    },
    // Step 2a: Clear reservation upon runner inspection (ISSUE_PENDING_OFFSET +5.000)
    {
      movement_id: 'mvt-1021',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-BAS-01',
      item_name: 'Fresh basil',
      movement_type: 'ISSUE_PENDING_OFFSET',
      quantity: 5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-BAS-01',
      expiry_date: '2026-11-06',
      reference_doc_id: 'REQ-2026-002',
      created_by_user_id: 'usr-runner-01',
      actor_name: 'Kitchen Runner',
      created_at: '2026-11-02T10:14:00.000Z',
    },
    // Step 2b: Confirmed physical issue handed over to runner (ISSUE_CONFIRMED -5.000) -> Book stock = 95.000 kg
    {
      movement_id: 'mvt-1022',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-BAS-01',
      item_name: 'Fresh basil',
      movement_type: 'ISSUE_CONFIRMED',
      quantity: -5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-BAS-01',
      expiry_date: '2026-11-06',
      reference_doc_id: 'REQ-2026-002',
      created_by_user_id: 'usr-runner-01',
      actor_name: 'Kitchen Runner',
      created_at: '2026-11-02T10:14:05.000Z',
    },

    // Flow C-2 Worked Example 3: Issue 5 kg Tomato, Runner Confirms 3 kg and Declines 2 kg at Door
    // Step 1: Admin stages 5 kg (ISSUE_PENDING -5.000) -> Book stock = 95.000 kg
    {
      movement_id: 'mvt-1030',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-TOM-01',
      item_name: 'San Marzano tomatoes',
      movement_type: 'ISSUE_PENDING',
      quantity: -5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-TOM-01',
      expiry_date: '2027-10-31',
      reference_doc_id: 'REQ-2026-003',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-02T11:00:00.000Z',
    },
    // Step 2a: Clear entire 5 kg pending reservation (ISSUE_PENDING_OFFSET +5.000)
    {
      movement_id: 'mvt-1031',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-TOM-01',
      item_name: 'San Marzano tomatoes',
      movement_type: 'ISSUE_PENDING_OFFSET',
      quantity: 5.0,
      uom: 'kg',
      batch_number: 'LOT-2026-TOM-01',
      expiry_date: '2027-10-31',
      reference_doc_id: 'REQ-2026-003',
      created_by_user_id: 'usr-runner-01',
      actor_name: 'Kitchen Runner',
      created_at: '2026-11-02T11:15:00.000Z',
    },
    // Step 2b: Confirmed issue for 3 kg accepted by kitchen (ISSUE_CONFIRMED -3.000) -> Book stock = 97.000 kg
    {
      movement_id: 'mvt-1032',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-TOM-01',
      item_name: 'San Marzano tomatoes',
      movement_type: 'ISSUE_CONFIRMED',
      quantity: -3.0,
      uom: 'kg',
      batch_number: 'LOT-2026-TOM-01',
      expiry_date: '2027-10-31',
      reference_doc_id: 'REQ-2026-003',
      created_by_user_id: 'usr-runner-01',
      actor_name: 'Kitchen Runner',
      created_at: '2026-11-02T11:15:05.000Z',
    },

    // Additional Operational Movements
    // Waste disposal (damaged basil)
    {
      movement_id: 'mvt-1040',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-BAS-01',
      item_name: 'Fresh basil',
      movement_type: 'WASTE_DISPOSAL',
      quantity: -1.2,
      uom: 'kg',
      batch_number: 'LOT-2026-BAS-01',
      expiry_date: '2026-11-06',
      reference_doc_id: 'WST-2026-001',
      created_by_user_id: 'usr-rm-01',
      actor_name: 'Restaurant Manager',
      created_at: '2026-11-02T14:30:00.000Z',
    },
    // Inter-store transfer outbound
    {
      movement_id: 'mvt-1050',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-FLO-01',
      item_name: 'Caputo 00 Flour',
      movement_type: 'TRANSFER_OUT_INTRANSIT',
      quantity: -50.0,
      uom: 'kg',
      batch_number: 'LOT-2026-FLR-01',
      expiry_date: '2027-05-01',
      reference_doc_id: 'TR-2026-010',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-02T16:00:00.000Z',
    },
    // Periodic count adjustment (+0.5 kg flour bag variance)
    {
      movement_id: 'mvt-1060',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'RM-FLO-01',
      item_name: 'Caputo 00 Flour',
      movement_type: 'COUNT_ADJUSTMENT',
      quantity: 0.5,
      uom: 'kg',
      batch_number: 'LOT-2026-FLR-01',
      expiry_date: '2027-05-01',
      reference_doc_id: 'CNT-2026-M11',
      created_by_user_id: 'usr-accountant-01',
      actor_name: 'Store Accountant',
      created_at: '2026-11-02T18:00:00.000Z',
    },

    // Active issue currently staged, awaiting runner confirmation (Flow C-2 active item)
    {
      movement_id: 'mvt-1070',
      store_id: storeId,
      warehouse_id: 'WH-DEL01-COLD',
      item_code: 'RM-MOZ-01',
      item_name: 'Mozzarella block',
      movement_type: 'ISSUE_PENDING',
      quantity: -15.0,
      uom: 'kg',
      batch_number: 'LOT-2026-MOZ-01',
      expiry_date: '2026-11-20',
      reference_doc_id: 'REQ-2026-1103-01',
      created_by_user_id: 'usr-admin-01',
      actor_name: 'Warehouse Keeper (Admin)',
      created_at: '2026-11-03T10:05:00.000Z',
    },
  ];
}

/**
 * Computes running derived book stock per item across chronological movements.
 */
export function calculateDerivedStockAfter(
  movements: LedgerMovementRecord[]
): LedgerMovementRecord[] {
  // Sort oldest to newest to calculate cumulative running balances
  const sorted = [...movements].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const runningStock: Record<string, number> = {};

  return sorted.map((m) => {
    const key = `${m.store_id}:${m.warehouse_id}:${m.item_code}`;
    const delta = resolveMovementDelta(m.movement_type, m.quantity);
    const updated = (runningStock[key] ?? 0) + delta;
    runningStock[key] = updated;

    return {
      ...m,
      derived_stock_after: Math.round(updated * 1000) / 1000,
    };
  });
}

/**
 * 1. getLedgerMovements
 * Retrieves append-only movement ledger rows for a store, with optional filters and running derived book stock.
 */
export async function getLedgerMovements(
  storeId: string,
  options?: {
    limit?: number;
    itemCode?: string;
    movementType?: string;
  }
): Promise<LedgerMovementRecord[]> {
  try {
    let query = supabase
      .from('t_stock_movements')
      .select('*, m_items(item_name), m_users(full_name)')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true });

    if (options?.itemCode) {
      query = query.eq('item_code', options.itemCode);
    }
    if (options?.movementType) {
      query = query.eq('movement_type', options.movementType);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      interface RowMovement {
        movement_id: string;
        store_id: string;
        warehouse_id: string;
        item_code: string;
        m_items?: { item_name?: string };
        movement_type: string;
        quantity: number | string;
        uom?: string;
        batch_number?: string | null;
        expiry_date?: string | null;
        reference_doc_id: string;
        created_by_user_id: string;
        m_users?: { full_name?: string };
        created_at: string;
      }
      const records: LedgerMovementRecord[] = (data as unknown as RowMovement[]).map((row) => ({
        movement_id: row.movement_id,
        store_id: row.store_id,
        warehouse_id: row.warehouse_id,
        item_code: row.item_code,
        item_name:
          row.m_items?.item_name ||
          ITEM_DIRECTORY[row.item_code]?.name ||
          row.item_code,
        movement_type: row.movement_type as MovementType,
        quantity: Number(row.quantity),
        uom: row.uom || ITEM_DIRECTORY[row.item_code]?.uom || 'kg',
        batch_number: row.batch_number ?? null,
        expiry_date: row.expiry_date ?? null,
        reference_doc_id: row.reference_doc_id,
        created_by_user_id: row.created_by_user_id,
        actor_name:
          row.m_users?.full_name ||
          USER_DIRECTORY[row.created_by_user_id] ||
          row.created_by_user_id,
        created_at: row.created_at,
      }));

      const withDerived = calculateDerivedStockAfter(records);

      if (options?.limit && options.limit > 0) {
        return withDerived.slice(-options.limit).reverse();
      }
      return withDerived.reverse();
    }
  } catch {
    // Fall back to deterministic seed dataset on network or configuration absence
  }

  // Fallback mode using deterministic seed movements
  let fallback = buildFallbackMovements(storeId);

  if (options?.itemCode) {
    fallback = fallback.filter((m) => m.item_code === options.itemCode);
  }
  if (options?.movementType) {
    fallback = fallback.filter((m) => m.movement_type === options.movementType);
  }

  const withDerived = calculateDerivedStockAfter(fallback);

  if (options?.limit && options.limit > 0) {
    return withDerived.slice(-options.limit).reverse();
  }
  return withDerived.reverse();
}

/**
 * 2. getStockCurrent
 * Derives current book stock grouped by store, warehouse, and item.
 */
export async function getStockCurrent(
  storeId: string,
  warehouseId?: string
): Promise<StockCurrentRecord[]> {
  try {
    let query = supabase
      .from('v_stock_current')
      .select('*, m_items(item_name, base_uom)')
      .eq('store_id', storeId);

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      interface RowStock {
        store_id: string;
        warehouse_id: string;
        item_code: string;
        m_items?: { item_name?: string; base_uom?: string };
        book_stock: number | string;
      }
      return (data as unknown as RowStock[]).map((row) => ({
        store_id: row.store_id,
        warehouse_id: row.warehouse_id,
        item_code: row.item_code,
        item_name:
          row.m_items?.item_name ||
          ITEM_DIRECTORY[row.item_code]?.name ||
          row.item_code,
        book_stock: Number(row.book_stock),
        uom: row.m_items?.base_uom || ITEM_DIRECTORY[row.item_code]?.uom || 'kg',
      }));
    }
  } catch {
    // Fall back to local calculation
  }

  // Fallback calculation: aggregate from fallback movements
  const movements = buildFallbackMovements(storeId);
  const stockMap: Record<string, { wh: string; item: string; stock: number }> = {};

  for (const m of movements) {
    if (warehouseId && m.warehouse_id !== warehouseId) continue;
    const key = `${m.warehouse_id}:${m.item_code}`;
    const delta = resolveMovementDelta(m.movement_type, m.quantity);
    if (!stockMap[key]) {
      stockMap[key] = { wh: m.warehouse_id, item: m.item_code, stock: 0 };
    }
    stockMap[key].stock += delta;
  }

  return Object.values(stockMap).map((entry) => ({
    store_id: storeId,
    warehouse_id: entry.wh,
    item_code: entry.item,
    item_name: ITEM_DIRECTORY[entry.item]?.name || entry.item,
    book_stock: Math.round(entry.stock * 1000) / 1000,
    uom: ITEM_DIRECTORY[entry.item]?.uom || 'kg',
  }));
}

/**
 * 3. getStockFifoLots
 * Retrieves per-lot inventory sorted by FIFO order (expiry_date ASC, created_at ASC).
 */
export async function getStockFifoLots(
  storeId: string,
  itemCode?: string
): Promise<StockFifoLotRecord[]> {
  try {
    let query = supabase
      .from('v_expiry_radar')
      .select('*')
      .eq('store_id', storeId)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    if (itemCode) {
      query = query.eq('item_code', itemCode);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      return (data as unknown as Record<string, unknown>[]).map((row) => ({
        store_id: String(row.store_id),
        warehouse_id: String(row.warehouse_id),
        item_code: String(row.item_code),
        item_name: String(row.item_name || ITEM_DIRECTORY[String(row.item_code)]?.name || row.item_code),
        batch_number: (row.batch_number as string | null) ?? null,
        expiry_date: (row.expiry_date as string | null) ?? null,
        uom: String(row.uom || 'kg'),
        quantity: Number(row.quantity),
        days_to_expiry: row.days_to_expiry != null ? Number(row.days_to_expiry) : null,
        expiry_status: (row.expiry_status as StockFifoLotRecord['expiry_status']) || 'FIFO_OK',
        created_at: String(row.created_at),
      }));
    }
  } catch {
    // Fall back to seed lots
  }

  // Fallback lots from SEED_ITEMS and fallback movements
  const lots: StockFifoLotRecord[] = SEED_ITEMS.filter((item) => {
    if (itemCode && item.item_code !== itemCode) return false;
    return true;
  }).map((item) => {
    const today = new Date('2026-11-03');
    const exp = new Date(item.expiry_date);
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    let status: 'EXPIRED_LOCK' | 'EXPIRY_AMBER' | 'FIFO_OK' = 'FIFO_OK';
    if (diffDays <= 0) status = 'EXPIRED_LOCK';
    else if (diffDays <= 3) status = 'EXPIRY_AMBER';

    return {
      store_id: storeId,
      warehouse_id: item.warehouse_id,
      item_code: item.item_code,
      item_name: item.item_name,
      batch_number: item.lot_number,
      expiry_date: item.expiry_date,
      uom: item.base_uom,
      quantity: item.initial_stock_qty,
      days_to_expiry: diffDays,
      expiry_status: status,
      created_at: '2026-11-01T08:00:00.000Z',
    };
  });

  return lots;
}
