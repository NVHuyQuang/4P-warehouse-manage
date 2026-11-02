import { describe, it, expect } from 'vitest';
import {
  deriveBookStock,
  deriveBookStockSigned,
  deriveBookStockMap,
  createIssuePendingMovement,
  createIssueReversalMovement,
  createIssueConfirmationMovements,
  calculateDailyUsage,
  calculateADU,
  calculateSuggestedReorderQty,
  evaluateExpiryRadar,
  type RawStockMovement,
} from '@/lib/testing/ledger-oracle';
import {
  SEED_ITEMS,
  SEED_STORES,
  SEED_WAREHOUSES,
  SEED_USERS,
  buildInitialStockMovements,
} from '@/lib/testing/synthetic-seed';
import {
  getTestUserByRole,
  canRolePerformAction,
} from '@/lib/testing/auth-helpers';

describe('Doc §4.1 Two-Stage Issue Ledger Oracle & Worked Examples', () => {
  const storeId = 'IND-DEL-01';
  const warehouseId = 'WH-DEL01-COLD';
  const itemCode = 'ITM-CHZ-001';

  // Base initial stock movement of 100kg as specified in Doc §4.1
  const initialStockMovement: RawStockMovement = {
    movement_id: 'mvt-init-001',
    store_id: storeId,
    warehouse_id: warehouseId,
    item_code: itemCode,
    movement_type: 'GRPO_IMPORT',
    quantity: 100,
    uom: 'kg',
    batch_number: 'LOT-2026-CHZ-001',
    expiry_date: '2026-11-20',
    reference_doc_id: 'GRPO-INIT-001',
    created_at: new Date('2026-11-01T08:00:00Z'),
  };

  it('verifies Worked Example 1: Issue 5 kg, Runner Declines 5 kg (Net delta = 0, final = 100 kg)', () => {
    const movements: RawStockMovement[] = [initialStockMovement];
    expect(deriveBookStock(movements)).toBe(100);

    // Step 1: Admin picks & issues 5 kg (ISSUE_PENDING quantity -5)
    const pendingMovement = createIssuePendingMovement({
      store_id: storeId,
      warehouse_id: warehouseId,
      item_code: itemCode,
      quantity: 5,
      uom: 'kg',
      reference_doc_id: 'REQ-2026-001',
    });
    movements.push(pendingMovement);

    // Shelf stock is immediately reserved: 100 - 5 = 95 kg
    expect(deriveBookStock(movements)).toBe(95);

    // Step 2: Runner declines at door: goods physically returned to shelf (ISSUE_REVERSAL quantity +5)
    const reversalMovement = createIssueReversalMovement({
      store_id: storeId,
      warehouse_id: warehouseId,
      item_code: itemCode,
      quantity: 5,
      uom: 'kg',
      reference_doc_id: 'REQ-2026-001',
    });
    movements.push(reversalMovement);

    // Derived stock returns to 95 + 5 = 100 kg
    expect(deriveBookStock(movements)).toBe(100);

    // Net ledger impact: 0 kg, past rows untouched
    expect(deriveBookStockSigned(movements)).toBe(100);
    expect(movements.length).toBe(3);
  });

  it('verifies Worked Example 2: Issue 5 kg, Runner Confirms 5 kg (Net delta = -5, final = 95 kg)', () => {
    const movements: RawStockMovement[] = [initialStockMovement];
    expect(deriveBookStock(movements)).toBe(100);

    // Step 1: Admin picks & issues 5 kg (ISSUE_PENDING quantity -5)
    const pendingMovement = createIssuePendingMovement({
      store_id: storeId,
      warehouse_id: warehouseId,
      item_code: itemCode,
      quantity: 5,
      uom: 'kg',
      reference_doc_id: 'REQ-2026-002',
    });
    movements.push(pendingMovement);
    expect(deriveBookStock(movements)).toBe(95);

    // Step 2: Runner confirms on mobile: ISSUE_PENDING_OFFSET (+5) and ISSUE_CONFIRMED (-5)
    const [offsetMvt, confirmedMvt] = createIssueConfirmationMovements({
      store_id: storeId,
      warehouse_id: warehouseId,
      item_code: itemCode,
      stagedQuantity: 5,
      confirmedQuantity: 5,
      uom: 'kg',
      reference_doc_id: 'REQ-2026-002',
    });
    movements.push(offsetMvt, confirmedMvt);

    // Derived stock: 95 + 5 - 5 = 95 kg
    expect(deriveBookStock(movements)).toBe(95);
    expect(deriveBookStockSigned(movements)).toBe(95);

    // Exactly 5 kg deducted from storeroom, zero double-counting
    const totalDeduction = deriveBookStock([initialStockMovement]) - deriveBookStock(movements);
    expect(totalDeduction).toBe(5);
  });

  it('verifies Worked Example 3: Issue 5 kg, Runner Confirms 3 kg and Declines 2 kg (Net delta = -3, final = 97 kg)', () => {
    const movements: RawStockMovement[] = [initialStockMovement];
    expect(deriveBookStock(movements)).toBe(100);

    // Step 1: Admin picks & issues 5 kg (ISSUE_PENDING quantity -5)
    const pendingMovement = createIssuePendingMovement({
      store_id: storeId,
      warehouse_id: warehouseId,
      item_code: itemCode,
      quantity: 5,
      uom: 'kg',
      reference_doc_id: 'REQ-2026-003',
    });
    movements.push(pendingMovement);
    expect(deriveBookStock(movements)).toBe(95);

    // Step 2: Runner accepts 3 kg, declines 2 kg
    // App appends ISSUE_PENDING_OFFSET (+5) and ISSUE_CONFIRMED (-3)
    const [offsetMvt, confirmedMvt] = createIssueConfirmationMovements({
      store_id: storeId,
      warehouse_id: warehouseId,
      item_code: itemCode,
      stagedQuantity: 5,
      confirmedQuantity: 3,
      uom: 'kg',
      reference_doc_id: 'REQ-2026-003',
    });
    movements.push(offsetMvt, confirmedMvt);

    // Derived stock: 95 + 5 - 3 = 97 kg
    expect(deriveBookStock(movements)).toBe(97);
    expect(deriveBookStockSigned(movements)).toBe(97);

    // Exactly 3 kg deducted from storeroom stock (97 kg on shelf, 3 kg in kitchen)
    const netDeduction = deriveBookStock([initialStockMovement]) - deriveBookStock(movements);
    expect(netDeduction).toBe(3);
  });
});

describe('Ledger Invariants & Property-Based Tests', () => {
  const storeId = 'IND-DEL-01';
  const warehouseId = 'WH-DEL01-COLD';
  const itemCode = 'ITM-CHZ-001';

  it('property: zero double-counting across arbitrary staged and accepted quantities', () => {
    const testCases = [
      { initial: 100, staged: 5, accepted: 0 },   // full decline
      { initial: 100, staged: 5, accepted: 5 },   // full accept
      { initial: 100, staged: 5, accepted: 3 },   // partial accept
      { initial: 250, staged: 40, accepted: 25 }, // large partial
      { initial: 50, staged: 12.5, accepted: 8.5 }, // fractional
      { initial: 1000, staged: 150, accepted: 150 }, // bulk full
    ];

    for (const { initial, staged, accepted } of testCases) {
      const history: RawStockMovement[] = [
        {
          store_id: storeId,
          warehouse_id: warehouseId,
          item_code: itemCode,
          movement_type: 'GRPO_IMPORT',
          quantity: initial,
        },
      ];

      // Stage
      history.push(
        createIssuePendingMovement({
          store_id: storeId,
          warehouse_id: warehouseId,
          item_code: itemCode,
          quantity: staged,
        })
      );
      expect(deriveBookStock(history)).toBeCloseTo(initial - staged);

      // Confirm / Decline
      if (accepted === 0) {
        history.push(
          createIssueReversalMovement({
            store_id: storeId,
            warehouse_id: warehouseId,
            item_code: itemCode,
            quantity: staged,
          })
        );
        expect(deriveBookStock(history)).toBeCloseTo(initial);
      } else {
        const [offset, confirmed] = createIssueConfirmationMovements({
          store_id: storeId,
          warehouse_id: warehouseId,
          item_code: itemCode,
          stagedQuantity: staged,
          confirmedQuantity: accepted,
        });
        history.push(offset, confirmed);
        expect(deriveBookStock(history)).toBeCloseTo(initial - accepted);
      }
    }
  });

  it('property: deriveBookStock equals deriveBookStockSigned for standard signed rows', () => {
    const movements: RawStockMovement[] = [
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'GRPO_IMPORT', quantity: 200 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'ISSUE_PENDING', quantity: -20 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'ISSUE_PENDING_OFFSET', quantity: 20 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'ISSUE_CONFIRMED', quantity: -15 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'WASTE_DISPOSAL', quantity: -2 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'COUNT_ADJUSTMENT', quantity: 1.5 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'TRANSFER_OUT_INTRANSIT', quantity: -10 },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'TRANSFER_IN_RECEIVED', quantity: 5 },
    ];

    expect(deriveBookStock(movements)).toBe(deriveBookStockSigned(movements));
    // 200 - 20 + 20 - 15 - 2 + 1.5 - 10 + 5 = 179.5
    expect(deriveBookStock(movements)).toBe(179.5);
  });

  it('property: store, warehouse, and item isolation', () => {
    const multiMovements: RawStockMovement[] = [
      { store_id: 'IND-DEL-01', warehouse_id: 'WH-DEL01-COLD', item_code: 'ITM-CHZ-001', movement_type: 'GRPO_IMPORT', quantity: 100 },
      { store_id: 'IND-DEL-01', warehouse_id: 'WH-DEL01-COLD', item_code: 'ITM-CHZ-002', movement_type: 'GRPO_IMPORT', quantity: 50 },
      { store_id: 'IND-DEL-01', warehouse_id: 'WH-DEL01-DRY', item_code: 'ITM-DRY-001', movement_type: 'GRPO_IMPORT', quantity: 300 },
      { store_id: 'IND-DEL-02', warehouse_id: 'WH-DEL02-COLD', item_code: 'ITM-CHZ-001', movement_type: 'GRPO_IMPORT', quantity: 80 },
    ];

    expect(deriveBookStock(multiMovements, { store_id: 'IND-DEL-01', warehouse_id: 'WH-DEL01-COLD', item_code: 'ITM-CHZ-001' })).toBe(100);
    expect(deriveBookStock(multiMovements, { store_id: 'IND-DEL-01', warehouse_id: 'WH-DEL01-COLD', item_code: 'ITM-CHZ-002' })).toBe(50);
    expect(deriveBookStock(multiMovements, { store_id: 'IND-DEL-01', warehouse_id: 'WH-DEL01-DRY', item_code: 'ITM-DRY-001' })).toBe(300);
    expect(deriveBookStock(multiMovements, { store_id: 'IND-DEL-02', warehouse_id: 'WH-DEL02-COLD', item_code: 'ITM-CHZ-001' })).toBe(80);

    const map = deriveBookStockMap(multiMovements);
    expect(map.get('IND-DEL-01:WH-DEL01-COLD:ITM-CHZ-001')).toBe(100);
    expect(map.get('IND-DEL-01:WH-DEL01-DRY:ITM-DRY-001')).toBe(300);
  });

  it('property: daily usage and ADU formula compliance (Doc §4.2 & §4.3)', () => {
    const today = new Date('2026-11-02T12:00:00Z');
    const yesterday = new Date('2026-11-01T12:00:00Z');

    const movements: RawStockMovement[] = [
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'ISSUE_CONFIRMED', quantity: -10, created_at: today },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'WASTE_DISPOSAL', quantity: -2, created_at: today },
      { store_id: storeId, warehouse_id: warehouseId, item_code: itemCode, movement_type: 'ISSUE_CONFIRMED', quantity: -8, created_at: yesterday },
    ];

    // Daily usage today: 10 + 2 = 12
    expect(calculateDailyUsage(movements, today)).toBe(12);

    // ADU over 2 days: (12 + 8) / 2 = 10
    const adu = calculateADU({
      movements,
      windowDays: 2,
      asOfDate: today,
    });
    expect(adu).toBe(10);
  });

  it('property: reorder trigger and suggested quantity formula (Doc §4.4)', () => {
    // Current stock (40) <= Reorder Point (50): Suggested = Par (150) - Stock (40) - OpenPO (30) = 80
    const reorderNeeded = calculateSuggestedReorderQty({
      currentStock: 40,
      reorderPoint: 50,
      parLevel: 150,
      openPoQty: 30,
    });
    expect(reorderNeeded).toBe(80);

    // Current stock (60) > Reorder Point (50): Suggested = 0
    const noReorder = calculateSuggestedReorderQty({
      currentStock: 60,
      reorderPoint: 50,
      parLevel: 150,
      openPoQty: 0,
    });
    expect(noReorder).toBe(0);
  });

  it('property: expiry radar status evaluation (Doc §4.5)', () => {
    const today = '2026-11-02';

    // 0 days left or past -> EXPIRED_LOCK
    expect(evaluateExpiryRadar({ expiryDate: '2026-11-02', currentDate: today, warningDays: 3 })).toBe('EXPIRED_LOCK');
    expect(evaluateExpiryRadar({ expiryDate: '2026-11-01', currentDate: today, warningDays: 3 })).toBe('EXPIRED_LOCK');

    // 2 days left (<= warningDays 3) -> EXPIRY_AMBER
    expect(evaluateExpiryRadar({ expiryDate: '2026-11-04', currentDate: today, warningDays: 3 })).toBe('EXPIRY_AMBER');

    // 10 days left (> warningDays 3) -> FIFO_OK
    expect(evaluateExpiryRadar({ expiryDate: '2026-11-12', currentDate: today, warningDays: 3 })).toBe('FIFO_OK');

    // Requires tracking false -> always FIFO_OK
    expect(evaluateExpiryRadar({ expiryDate: '2026-11-01', currentDate: today, warningDays: 3, requiresTracking: false })).toBe('FIFO_OK');
  });
});

describe('Harness Fixtures & Anti-Leak Safety Verification', () => {
  it('strictly contains quantities only: zero price, cost, valuation, tax, or vendor properties', () => {
    const forbiddenKeywords = ['price', 'cost', 'valuation', 'tax', 'vendor'];

    const checkObject = (obj: Record<string, unknown>, label: string) => {
      for (const key of Object.keys(obj)) {
        for (const forbidden of forbiddenKeywords) {
          expect(
            key.toLowerCase(),
            `Forbidden keyword "${forbidden}" detected in ${label} key "${key}"`
          ).not.toContain(forbidden);
        }
      }
    };

    SEED_ITEMS.forEach((item, idx) => checkObject(item as unknown as Record<string, unknown>, `SEED_ITEMS[${idx}]`));
    SEED_STORES.forEach((store, idx) => checkObject(store as unknown as Record<string, unknown>, `SEED_STORES[${idx}]`));
    SEED_WAREHOUSES.forEach((wh, idx) => checkObject(wh as unknown as Record<string, unknown>, `SEED_WAREHOUSES[${idx}]`));
    SEED_USERS.forEach((usr, idx) => checkObject(usr as unknown as Record<string, unknown>, `SEED_USERS[${idx}]`));

    const initialMovements = buildInitialStockMovements();
    initialMovements.forEach((mvt, idx) => checkObject(mvt as unknown as Record<string, unknown>, `initialMovements[${idx}]`));
  });

  it('contains exactly 10 primary role-titled test users on @example.test', () => {
    expect(SEED_USERS.length).toBe(10);
    for (const user of SEED_USERS) {
      expect(user.email).toMatch(/^[a-z0-9_-]+@example\.test$/);
    }
  });

  it('contains exactly 2 stores and 2 specified warehouses', () => {
    expect(SEED_STORES.map((s) => s.store_id)).toEqual(['IND-DEL-01', 'IND-DEL-02']);
    expect(SEED_WAREHOUSES.map((w) => w.warehouse_id)).toEqual(['WH-DEL01-COLD', 'WH-DEL01-DRY']);
  });

  it('contains exactly 20 sample items with valid categories, UoMs, lots and expiry dates', () => {
    expect(SEED_ITEMS.length).toBe(20);
    for (const item of SEED_ITEMS) {
      expect(item.item_code).toMatch(/^ITM-[A-Z]{3}-\d{3}$/);
      expect(['CHEESE', 'DRY_GOODS', 'MEAT', 'VEGETABLE', 'BEVERAGE']).toContain(item.category_group);
      expect(['kg', 'pcs']).toContain(item.base_uom);
      expect(item.lot_number).toBeTruthy();
      expect(item.expiry_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.initial_stock_qty).toBeGreaterThan(0);
    }
  });

  it('validates auth role permissions matrix compliance', () => {
    const admin = getTestUserByRole('ADMIN');
    expect(admin.role).toBe('ADMIN');

    expect(canRolePerformAction('ADMIN', 'PICK_STAGE_STOCK')).toBe(true);
    expect(canRolePerformAction('RUNNER', 'PICK_STAGE_STOCK')).toBe(false);
    expect(canRolePerformAction('RUNNER', 'CONFIRM_RECEIPT_AT_DOOR')).toBe(true);
    expect(canRolePerformAction('APPROVER', 'APPROVE_STOCK_ADJUSTMENT')).toBe(true);
    expect(canRolePerformAction('SYSTEM_ADMIN', 'INVITE_USERS_RESET_PASSWORD')).toBe(true);
  });
});
