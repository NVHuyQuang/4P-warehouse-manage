import { supabase } from '@/lib/supabase/client';

export type CountType = 'WEEKLY_CYCLE' | 'MONTH_END_FULL';
export type StockCountStatus = 'IN_PROGRESS' | 'RECOUNT' | 'COMPLETED';
export type CountFreezeStatus = 'FROZEN' | 'UNFROZEN';

export interface FirstCountEntry {
  itemCode: string;
  countedQty: number;
}

export interface RecountEntry {
  itemCode: string;
  recountQty: number;
}

export interface StockCountItem {
  count_item_id: string;
  count_id: string;
  item_code: string;
  item_name?: string;
  book_qty: number;
  first_count_qty: number | null;
  recount_qty: number | null;
  final_counted_qty: number | null;
  difference_qty: number | null;
  uom: string;
  bin_location?: string;
  bin_description?: string;
}

export interface StockCount {
  count_id: string;
  store_id: string;
  warehouse_id: string;
  count_type: CountType;
  freeze_status: CountFreezeStatus;
  keeper_user_id: string;
  accountant_user_id: string | null;
  status: StockCountStatus;
  created_at: string;
  completed_at: string | null;
  items?: StockCountItem[];
}

export interface StockAdjustmentVoucher {
  adjustment_id: string;
  count_id: string;
  item_code: string;
  warehouse_id: string;
  adjustment_qty: number;
  root_cause_reason: string;
  fc_approval_id: string;
  movement_id: string | null;
  approved_at: string | null;
  notes?: string | null;
}

/**
 * Initiates a periodic stock count session.
 * Freezes the storeroom, snapshots current physical stock, and creates the count header.
 */
export async function initiateStockCount(
  storeId: string,
  warehouseId: string,
  countType: CountType
): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('initiate_stock_count', {
      p_store_id: storeId,
      p_warehouse_id: warehouseId,
      p_count_type: countType,
    });

    if (error) {
      // Propagate business exceptions from PostgreSQL (e.g. count already in progress)
      if (error.code && error.code !== 'PGRST202' && !error.message.includes('fetch')) {
        throw new Error(error.message);
      }
      // Offline / prototype fallback
      return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `cnt-${Date.now()}`;
    }

    return String(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('fetch') || msg.includes('offline') || msg.includes('PGRST202')) {
      return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `cnt-${Date.now()}`;
    }
    throw err;
  }
}

/**
 * Submits the blind first physical count by the Warehouse Keeper or Custodian.
 * Evaluates discrepancies between entered physical count and snapshotted book quantity.
 * If all differences are zero, marks count COMPLETED and unfreezes the storeroom.
 * If discrepancies exist, transitions count to RECOUNT status.
 */
export async function submitFirstCount(
  countId: string,
  counts: FirstCountEntry[]
): Promise<void> {
  try {
    const { error } = await supabase.rpc('submit_first_count', {
      p_count_id: countId,
      p_counts: counts.map((c) => ({
        item_code: c.itemCode,
        counted_qty: c.countedQty,
        first_count_qty: c.countedQty,
      })),
    });

    if (error) {
      if (error.code && error.code !== 'PGRST202' && !error.message.includes('fetch')) {
        throw new Error(error.message);
      }
      console.warn('submit_first_count RPC offline / fallback mode:', error.message);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('fetch') && !msg.includes('offline') && !msg.includes('PGRST202')) {
      throw err;
    }
  }
}

/**
 * Submits the recount conducted by an independent second counter (Store Accountant).
 * If the recount resolves all differences, completes count and unfreezes the storeroom.
 * If differences persist, remains in RECOUNT awaiting Financial Controller adjustment voucher.
 */
export async function submitRecount(
  countId: string,
  counts: RecountEntry[]
): Promise<void> {
  try {
    const { error } = await supabase.rpc('submit_recount', {
      p_count_id: countId,
      p_counts: counts.map((c) => ({
        item_code: c.itemCode,
        recount_qty: c.recountQty,
        counted_qty: c.recountQty,
      })),
    });

    if (error) {
      if (error.code && error.code !== 'PGRST202' && !error.message.includes('fetch')) {
        throw new Error(error.message);
      }
      console.warn('submit_recount RPC offline / fallback mode:', error.message);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('fetch') && !msg.includes('offline') && !msg.includes('PGRST202')) {
      throw err;
    }
  }
}

/**
 * Financial Controller authorizes a physical stock adjustment voucher.
 * Segregation of duties prevents physical counters from approving their own counts.
 * Appends COUNT_ADJUSTMENT movement to immutable t_stock_movements ledger,
 * unfreezes warehouse back to ACTIVE, and marks the count COMPLETED.
 */
export async function approveStockAdjustment(
  adjustmentId: string,
  notes?: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('approve_stock_adjustment', {
      p_adjustment_id: adjustmentId,
      p_notes: notes ?? null,
    });

    if (error) {
      if (error.code && error.code !== 'PGRST202' && !error.message.includes('fetch')) {
        throw new Error(error.message);
      }
      console.warn('approve_stock_adjustment RPC offline / fallback mode:', error.message);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('fetch') && !msg.includes('offline') && !msg.includes('PGRST202')) {
      throw err;
    }
  }
}

/**
 * Fetches active or in-progress stock count sessions for a restaurant branch.
 */
export async function getActiveCounts(storeId: string): Promise<StockCount[]> {
  try {
    const { data, error } = await supabase
      .from('t_stock_counts')
      .select(`
        count_id,
        store_id,
        warehouse_id,
        count_type,
        freeze_status,
        keeper_user_id,
        accountant_user_id,
        status,
        created_at,
        completed_at,
        items:t_stock_count_items(
          count_item_id,
          count_id,
          item_code,
          book_qty,
          first_count_qty,
          recount_qty,
          final_counted_qty,
          difference_qty,
          uom
        )
      `)
      .eq('store_id', storeId)
      .in('status', ['IN_PROGRESS', 'RECOUNT'])
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('getActiveCounts query warning:', error.message);
      return [];
    }

    return (data as StockCount[]) || [];
  } catch (err) {
    console.warn('getActiveCounts error:', err);
    return [];
  }
}

/**
 * Helper to record a stock adjustment voucher awaiting Financial Controller authorization.
 */
export async function createStockAdjustmentVoucher(payload: {
  countId: string;
  warehouseId: string;
  itemCode: string;
  adjustmentQty: number;
  rootCauseReason: string;
  fcApprovalId?: string;
}): Promise<string> {
  const adjustmentId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `adj-${Date.now()}`;

  try {
    const { error } = await supabase.from('t_stock_adjustments').insert({
      adjustment_id: adjustmentId,
      count_id: payload.countId,
      warehouse_id: payload.warehouseId,
      item_code: payload.itemCode,
      adjustment_qty: payload.adjustmentQty,
      root_cause_reason: payload.rootCauseReason,
      fc_approval_id: payload.fcApprovalId || 'e0000000-0000-0000-0000-000000000003',
    });

    if (error) {
      console.warn('createStockAdjustmentVoucher warning:', error.message);
    }
  } catch (err) {
    console.warn('createStockAdjustmentVoucher error:', err);
  }

  return adjustmentId;
}
