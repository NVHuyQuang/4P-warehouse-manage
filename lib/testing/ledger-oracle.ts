/**
 * Independent Pure TypeScript Ledger Oracle
 *
 * Implements the append-only stock derivation formula and invariants from:
 * - docs/INVENTORY-TOOL-FLOW.md (§4.1 Two-Stage Issue Ledger formulas & Worked Examples 1, 2, 3)
 * - docs/build/CONTRACTS.md (§2 Stock Ledger Movement Types & Signs)
 *
 * NON-NEGOTIABLE RULE: Quantities only. Physical movements and quantities only.
 */

export type MovementType =
  | 'GRPO_IMPORT'
  | 'ISSUE_PENDING'
  | 'ISSUE_PENDING_OFFSET'
  | 'ISSUE_CONFIRMED'
  | 'ISSUE_REVERSAL'
  | 'WASTE_DISPOSAL'
  | 'SUPPLIER_RETURN'
  | 'TRANSFER_OUT_INTRANSIT'
  | 'TRANSFER_IN_RECEIVED'
  | 'COUNT_ADJUSTMENT';

export interface RawStockMovement {
  movement_id?: string;
  store_id: string;
  warehouse_id: string;
  item_code: string;
  movement_type: MovementType;
  quantity: number; // Signed or magnitude; resolved consistently by oracle
  uom?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  reference_doc_id?: string;
  created_by_user_id?: string;
  created_at?: string | Date;
}

export interface StockFilter {
  store_id?: string;
  warehouse_id?: string;
  item_code?: string;
}

export type ExpiryRadarStatus = 'EXPIRED_LOCK' | 'EXPIRY_AMBER' | 'FIFO_OK';

/**
 * Resolves the signed ledger delta for a movement type and quantity.
 * Follows Doc §4.1 formula & CONTRACTS.md Section 2 signs:
 *   + GRPO_IMPORT
 *   - ISSUE_PENDING
 *   + ISSUE_PENDING_OFFSET
 *   - ISSUE_CONFIRMED
 *   + ISSUE_REVERSAL
 *   - WASTE_DISPOSAL
 *   - SUPPLIER_RETURN
 *   - TRANSFER_OUT_INTRANSIT
 *   + TRANSFER_IN_RECEIVED
 *   +/- COUNT_ADJUSTMENT
 */
export function resolveMovementDelta(
  movementType: MovementType,
  quantity: number
): number {
  const magnitude = Math.abs(quantity);

  switch (movementType) {
    case 'GRPO_IMPORT':
    case 'ISSUE_PENDING_OFFSET':
    case 'ISSUE_REVERSAL':
    case 'TRANSFER_IN_RECEIVED':
      return magnitude;

    case 'ISSUE_PENDING':
    case 'ISSUE_CONFIRMED':
    case 'WASTE_DISPOSAL':
    case 'SUPPLIER_RETURN':
    case 'TRANSFER_OUT_INTRANSIT':
      return -magnitude;

    case 'COUNT_ADJUSTMENT':
      // Adjustments retain their explicit positive/negative sign
      return quantity;

    default: {
      const exhaustiveCheck: never = movementType;
      throw new Error(`Unsupported movement type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Filters movements matching optional store_id, warehouse_id, and item_code criteria.
 */
export function filterMovements(
  movements: readonly RawStockMovement[],
  filter?: StockFilter
): RawStockMovement[] {
  if (!filter) return [...movements];

  return movements.filter((m) => {
    if (filter.store_id && m.store_id !== filter.store_id) return false;
    if (filter.warehouse_id && m.warehouse_id !== filter.warehouse_id) return false;
    if (filter.item_code && m.item_code !== filter.item_code) return false;
    return true;
  });
}

/**
 * Derives current book stock by applying the Doc §4.1 formula across raw movements.
 */
export function deriveBookStock(
  movements: readonly RawStockMovement[],
  filter?: StockFilter
): number {
  const matching = filterMovements(movements, filter);
  return matching.reduce((acc, m) => acc + resolveMovementDelta(m.movement_type, m.quantity), 0);
}

/**
 * Derives current book stock using direct sum of signed quantities (CONTRACTS.md Invariant 1).
 */
export function deriveBookStockSigned(
  movements: readonly RawStockMovement[],
  filter?: StockFilter
): number {
  const matching = filterMovements(movements, filter);
  return matching.reduce((acc, m) => acc + m.quantity, 0);
}

/**
 * Groups movements by composite key `${store_id}:${warehouse_id}:${item_code}`
 * and returns a Map of derived book stock balances.
 */
export function deriveBookStockMap(
  movements: readonly RawStockMovement[]
): Map<string, number> {
  const stockMap = new Map<string, number>();

  for (const m of movements) {
    const key = `${m.store_id}:${m.warehouse_id}:${m.item_code}`;
    const delta = resolveMovementDelta(m.movement_type, m.quantity);
    stockMap.set(key, (stockMap.get(key) ?? 0) + delta);
  }

  return stockMap;
}

/**
 * Doc §4.1 Two-Stage Issue Step 1: Admin picks & stages stock.
 * Creates an ISSUE_PENDING row (deducts stock immediately).
 */
export function createIssuePendingMovement(params: {
  store_id: string;
  warehouse_id: string;
  item_code: string;
  quantity: number;
  uom?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  reference_doc_id?: string;
  created_by_user_id?: string;
  created_at?: string | Date;
}): RawStockMovement {
  return {
    ...params,
    movement_type: 'ISSUE_PENDING',
    quantity: -Math.abs(params.quantity),
  };
}

/**
 * Doc §4.1 Worked Example 1: Runner declines staged goods at door.
 * Creates an ISSUE_REVERSAL row (restores stock to shelf).
 */
export function createIssueReversalMovement(params: {
  store_id: string;
  warehouse_id: string;
  item_code: string;
  quantity: number;
  uom?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  reference_doc_id?: string;
  created_by_user_id?: string;
  created_at?: string | Date;
}): RawStockMovement {
  return {
    ...params,
    movement_type: 'ISSUE_REVERSAL',
    quantity: Math.abs(params.quantity),
  };
}

/**
 * Doc §4.1 Worked Examples 2 & 3: Runner confirms full or partial issue at door.
 * Appends:
 * 1. ISSUE_PENDING_OFFSET (+stagedQuantity) clearing pending reservation
 * 2. ISSUE_CONFIRMED (-confirmedQuantity) recording physical issue handed over
 */
export function createIssueConfirmationMovements(params: {
  store_id: string;
  warehouse_id: string;
  item_code: string;
  stagedQuantity: number;
  confirmedQuantity: number;
  uom?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  reference_doc_id?: string;
  created_by_user_id?: string;
  created_at?: string | Date;
}): [RawStockMovement, RawStockMovement] {
  const staged = Math.abs(params.stagedQuantity);
  const confirmed = Math.abs(params.confirmedQuantity);

  if (confirmed > staged) {
    throw new Error(
      `Confirmed quantity (${confirmed}) cannot exceed staged quantity (${staged})`
    );
  }

  const offsetMovement: RawStockMovement = {
    store_id: params.store_id,
    warehouse_id: params.warehouse_id,
    item_code: params.item_code,
    movement_type: 'ISSUE_PENDING_OFFSET',
    quantity: staged,
    uom: params.uom,
    batch_number: params.batch_number,
    expiry_date: params.expiry_date,
    reference_doc_id: params.reference_doc_id,
    created_by_user_id: params.created_by_user_id,
    created_at: params.created_at,
  };

  const confirmedMovement: RawStockMovement = {
    store_id: params.store_id,
    warehouse_id: params.warehouse_id,
    item_code: params.item_code,
    movement_type: 'ISSUE_CONFIRMED',
    quantity: -confirmed,
    uom: params.uom,
    batch_number: params.batch_number,
    expiry_date: params.expiry_date,
    reference_doc_id: params.reference_doc_id,
    created_by_user_id: params.created_by_user_id,
    created_at: params.created_at,
  };

  return [offsetMovement, confirmedMovement];
}

/**
 * Doc §4.2: Daily Actual Usage = Sum(ISSUE_CONFIRMED) + Sum(WASTE_DISPOSAL)
 */
export function calculateDailyUsage(
  movements: readonly RawStockMovement[],
  targetDate?: string | Date,
  filter?: StockFilter
): number {
  const matching = filterMovements(movements, filter);
  let totalUsage = 0;

  const targetDateStr = targetDate
    ? new Date(targetDate).toISOString().slice(0, 10)
    : null;

  for (const m of matching) {
    if (m.movement_type === 'ISSUE_CONFIRMED' || m.movement_type === 'WASTE_DISPOSAL') {
      if (targetDateStr && m.created_at) {
        const movementDateStr = new Date(m.created_at).toISOString().slice(0, 10);
        if (movementDateStr !== targetDateStr) continue;
      }
      totalUsage += Math.abs(m.quantity);
    }
  }

  return totalUsage;
}

/**
 * Doc §4.3 & §5.1: Average Daily Usage (ADU)
 * ADU = Total Actual Consumption over Rolling N Days / N Days
 */
export function calculateADU(params: {
  movements: readonly RawStockMovement[];
  windowDays: number;
  asOfDate?: string | Date;
  filter?: StockFilter;
}): number {
  const { movements, windowDays, asOfDate = new Date(), filter } = params;
  if (windowDays <= 0) return 0;

  const endDate = new Date(asOfDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - windowDays);

  const matching = filterMovements(movements, filter);
  let totalConsumption = 0;

  for (const m of matching) {
    if (m.movement_type === 'ISSUE_CONFIRMED' || m.movement_type === 'WASTE_DISPOSAL') {
      if (m.created_at) {
        const mDate = new Date(m.created_at);
        if (mDate >= startDate && mDate <= endDate) {
          totalConsumption += Math.abs(m.quantity);
        }
      } else {
        totalConsumption += Math.abs(m.quantity);
      }
    }
  }

  return totalConsumption / windowDays;
}

/**
 * Doc §4.4 & §5.2: Suggested Reorder Quantity
 * When Current Book Stock <= Reorder Point:
 *   Suggested Qty = max(0, Par Level - Current Book Stock - Open PO Qty)
 * Otherwise: 0
 */
export function calculateSuggestedReorderQty(params: {
  currentStock: number;
  reorderPoint: number;
  parLevel: number;
  openPoQty?: number;
}): number {
  const { currentStock, reorderPoint, parLevel, openPoQty = 0 } = params;
  if (currentStock <= reorderPoint) {
    return Math.max(0, parLevel - currentStock - openPoQty);
  }
  return 0;
}

/**
 * Doc §4.5 & §5.3: Expiry Radar Status
 * Days to Expiry = Batch Expiry Date - Current Date
 * - <= 0: EXPIRED_LOCK (hard lock)
 * - <= warningDays: EXPIRY_AMBER (amber warning badge, FIFO prioritized)
 * - > warningDays: FIFO_OK
 */
export function evaluateExpiryRadar(params: {
  expiryDate: string | Date;
  currentDate?: string | Date;
  warningDays: number;
  requiresTracking?: boolean;
}): ExpiryRadarStatus {
  const { expiryDate, currentDate = new Date(), warningDays, requiresTracking = true } = params;

  if (!requiresTracking) {
    return 'FIFO_OK';
  }

  const exp = new Date(expiryDate);
  const cur = new Date(currentDate);

  // Strip hours/minutes for date-only comparison
  const expUtc = Date.UTC(exp.getFullYear(), exp.getMonth(), exp.getDate());
  const curUtc = Date.UTC(cur.getFullYear(), cur.getMonth(), cur.getDate());
  const diffDays = Math.floor((expUtc - curUtc) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return 'EXPIRED_LOCK';
  }
  if (diffDays <= warningDays) {
    return 'EXPIRY_AMBER';
  }
  return 'FIFO_OK';
}
