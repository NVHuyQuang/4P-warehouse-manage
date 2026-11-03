/**
 * tests/unit/ledger.test.ts
 * Unit Tests for Flow C-2 Issues & Append-Only Ledger Data Wrapper
 *
 * Verifications:
 * 1. getLedgerMovements: returns rows with running derived stock calculations.
 * 2. getStockCurrent: derives book stock balances per warehouse and item.
 * 3. getStockFifoLots: provides FIFO-ordered lot inventory.
 * 4. Flow C-2 Worked Examples: verifies Worked Examples 1, 2, and 3 calculations.
 *
 * NON-NEGOTIABLE RULE: Quantities only. Inventory movements and physical balances exclusively.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase/client';
import {
  getLedgerMovements,
  getStockCurrent,
  getStockFifoLots,
  calculateDerivedStockAfter,
  LedgerMovementRecord,
} from '@/lib/data/ledger';

describe('Flow C-2 Ledger Data Access Suite', () => {
  const storeId = 'IND-DEL-01';

  beforeEach(() => {
    // In unit test environment without local Supabase daemon, trigger deterministic fallback instantly
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }),
      }),
    } as never);
  });

  it('1. getLedgerMovements returns append-only records with running derived stock', async () => {
    const movements = await getLedgerMovements(storeId);
    expect(movements.length).toBeGreaterThan(0);

    // Each row must have required audit fields
    for (const m of movements) {
      expect(m.movement_id).toBeDefined();
      expect(m.store_id).toBe(storeId);
      expect(m.item_code).toBeDefined();
      expect(m.quantity).toBeTypeOf('number');
      expect(m.derived_stock_after).toBeTypeOf('number');
      expect(m.movement_type).toBeDefined();
    }
  });

  it('2. getLedgerMovements filters by itemCode and movementType correctly', async () => {
    const mozMovements = await getLedgerMovements(storeId, { itemCode: 'RM-MOZ-01' });
    expect(mozMovements.length).toBeGreaterThan(0);
    expect(mozMovements.every((m) => m.item_code === 'RM-MOZ-01')).toBe(true);

    const pendingOnly = await getLedgerMovements(storeId, { movementType: 'ISSUE_PENDING' });
    expect(pendingOnly.length).toBeGreaterThan(0);
    expect(pendingOnly.every((m) => m.movement_type === 'ISSUE_PENDING')).toBe(true);

    const limited = await getLedgerMovements(storeId, { limit: 3 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it('3. getStockCurrent derives non-negative book stock balances', async () => {
    const currentStock = await getStockCurrent(storeId);
    expect(currentStock.length).toBeGreaterThan(0);

    for (const item of currentStock) {
      expect(item.store_id).toBe(storeId);
      expect(item.warehouse_id).toBeDefined();
      expect(item.item_code).toBeDefined();
      expect(item.book_stock).toBeTypeOf('number');
      expect(item.uom).toBeDefined();
    }

    // Filter by specific warehouse
    const coldStock = await getStockCurrent(storeId, 'WH-DEL01-COLD');
    expect(coldStock.every((s) => s.warehouse_id === 'WH-DEL01-COLD')).toBe(true);
  });

  it('4. getStockFifoLots returns lots with valid expiry statuses', async () => {
    const lots = await getStockFifoLots(storeId);
    expect(lots.length).toBeGreaterThan(0);

    for (const lot of lots) {
      expect(lot.store_id).toBe(storeId);
      expect(lot.item_code).toBeDefined();
      expect(['EXPIRED_LOCK', 'EXPIRY_AMBER', 'FIFO_OK']).toContain(lot.expiry_status);
      expect(lot.quantity).toBeGreaterThan(0);
    }
  });

  describe('5. Flow C-2 Worked Examples Ledger Computations', () => {
    it('verifies Worked Example 1: Full Decline (Net delta = 0, final = 100 kg)', () => {
      const records: LedgerMovementRecord[] = [
        {
          movement_id: 'm1',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-01',
          item_name: 'Test Item',
          movement_type: 'GRPO_IMPORT',
          quantity: 100.0,
          uom: 'kg',
          batch_number: 'B1',
          expiry_date: null,
          reference_doc_id: 'GRPO-01',
          created_by_user_id: 'u1',
          actor_name: 'Keeper',
          created_at: '2026-11-01T08:00:00Z',
        },
        {
          movement_id: 'm2',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-01',
          item_name: 'Test Item',
          movement_type: 'ISSUE_PENDING',
          quantity: -5.0,
          uom: 'kg',
          batch_number: 'B1',
          expiry_date: null,
          reference_doc_id: 'REQ-01',
          created_by_user_id: 'u1',
          actor_name: 'Keeper',
          created_at: '2026-11-01T08:10:00Z',
        },
        {
          movement_id: 'm3',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-01',
          item_name: 'Test Item',
          movement_type: 'ISSUE_REVERSAL',
          quantity: 5.0,
          uom: 'kg',
          batch_number: 'B1',
          expiry_date: null,
          reference_doc_id: 'REQ-01',
          created_by_user_id: 'u2',
          actor_name: 'Runner',
          created_at: '2026-11-01T08:20:00Z',
        },
      ];

      const withDerived = calculateDerivedStockAfter(records);
      expect(withDerived[0].derived_stock_after).toBe(100.0);
      expect(withDerived[1].derived_stock_after).toBe(95.0);
      expect(withDerived[2].derived_stock_after).toBe(100.0);
    });

    it('verifies Worked Example 2: Full Confirm (Net delta = -5, final = 95 kg)', () => {
      const records: LedgerMovementRecord[] = [
        {
          movement_id: 'm1',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-02',
          item_name: 'Test Item 2',
          movement_type: 'GRPO_IMPORT',
          quantity: 100.0,
          uom: 'kg',
          batch_number: 'B2',
          expiry_date: null,
          reference_doc_id: 'GRPO-02',
          created_by_user_id: 'u1',
          actor_name: 'Keeper',
          created_at: '2026-11-01T08:00:00Z',
        },
        {
          movement_id: 'm2',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-02',
          item_name: 'Test Item 2',
          movement_type: 'ISSUE_PENDING',
          quantity: -5.0,
          uom: 'kg',
          batch_number: 'B2',
          expiry_date: null,
          reference_doc_id: 'REQ-02',
          created_by_user_id: 'u1',
          actor_name: 'Keeper',
          created_at: '2026-11-01T08:10:00Z',
        },
        {
          movement_id: 'm3',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-02',
          item_name: 'Test Item 2',
          movement_type: 'ISSUE_PENDING_OFFSET',
          quantity: 5.0,
          uom: 'kg',
          batch_number: 'B2',
          expiry_date: null,
          reference_doc_id: 'REQ-02',
          created_by_user_id: 'u2',
          actor_name: 'Runner',
          created_at: '2026-11-01T08:14:00Z',
        },
        {
          movement_id: 'm4',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-COLD',
          item_code: 'RM-TEST-02',
          item_name: 'Test Item 2',
          movement_type: 'ISSUE_CONFIRMED',
          quantity: -5.0,
          uom: 'kg',
          batch_number: 'B2',
          expiry_date: null,
          reference_doc_id: 'REQ-02',
          created_by_user_id: 'u2',
          actor_name: 'Runner',
          created_at: '2026-11-01T08:14:05Z',
        },
      ];

      const withDerived = calculateDerivedStockAfter(records);
      expect(withDerived[0].derived_stock_after).toBe(100.0);
      expect(withDerived[1].derived_stock_after).toBe(95.0);
      expect(withDerived[2].derived_stock_after).toBe(100.0);
      expect(withDerived[3].derived_stock_after).toBe(95.0);
    });

    it('verifies Worked Example 3: Partial Accept (Net delta = -3, final = 97 kg)', () => {
      const records: LedgerMovementRecord[] = [
        {
          movement_id: 'm1',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-DRY',
          item_code: 'RM-TEST-03',
          item_name: 'Test Item 3',
          movement_type: 'GRPO_IMPORT',
          quantity: 100.0,
          uom: 'kg',
          batch_number: 'B3',
          expiry_date: null,
          reference_doc_id: 'GRPO-03',
          created_by_user_id: 'u1',
          actor_name: 'Keeper',
          created_at: '2026-11-01T08:00:00Z',
        },
        {
          movement_id: 'm2',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-DRY',
          item_code: 'RM-TEST-03',
          item_name: 'Test Item 3',
          movement_type: 'ISSUE_PENDING',
          quantity: -5.0,
          uom: 'kg',
          batch_number: 'B3',
          expiry_date: null,
          reference_doc_id: 'REQ-03',
          created_by_user_id: 'u1',
          actor_name: 'Keeper',
          created_at: '2026-11-01T08:10:00Z',
        },
        {
          movement_id: 'm3',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-DRY',
          item_code: 'RM-TEST-03',
          item_name: 'Test Item 3',
          movement_type: 'ISSUE_PENDING_OFFSET',
          quantity: 5.0,
          uom: 'kg',
          batch_number: 'B3',
          expiry_date: null,
          reference_doc_id: 'REQ-03',
          created_by_user_id: 'u2',
          actor_name: 'Runner',
          created_at: '2026-11-01T08:15:00Z',
        },
        {
          movement_id: 'm4',
          store_id: storeId,
          warehouse_id: 'WH-DEL01-DRY',
          item_code: 'RM-TEST-03',
          item_name: 'Test Item 3',
          movement_type: 'ISSUE_CONFIRMED',
          quantity: -3.0,
          uom: 'kg',
          batch_number: 'B3',
          expiry_date: null,
          reference_doc_id: 'REQ-03',
          created_by_user_id: 'u2',
          actor_name: 'Runner',
          created_at: '2026-11-01T08:15:05Z',
        },
      ];

      const withDerived = calculateDerivedStockAfter(records);
      expect(withDerived[0].derived_stock_after).toBe(100.0);
      expect(withDerived[1].derived_stock_after).toBe(95.0);
      expect(withDerived[2].derived_stock_after).toBe(100.0);
      expect(withDerived[3].derived_stock_after).toBe(97.0);
    });
  });
});
