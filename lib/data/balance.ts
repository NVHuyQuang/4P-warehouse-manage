import { supabase } from '@/lib/supabase/client';

export interface BenchmarkItemDef {
  item_code: string;
  name: string;
  uom: 'kg' | 'pcs';
  storage_type: 'COLD' | 'DRY';
  category: string;
  opening_qty: number;
  received_qty: number;
  issued_qty: number;
  sample_counted_qty: number;
}

export interface DailyBalanceLineItemInput {
  item_code: string;
  opening_qty: number;
  received_qty: number;
  issued_qty: number;
  counted_qty: number;
  expected_qty?: number;
  variance_qty?: number;
  variance_reason?: string | null;
  responsible_person?: string | null;
}

export interface DailyBalanceItemRecord {
  balance_item_id: string;
  balance_id: string;
  item_code: string;
  opening_qty: number;
  received_qty: number;
  issued_qty: number;
  expected_qty: number;
  counted_qty: number;
  variance_qty: number;
  variance_reason?: string | null;
  responsible_person?: string | null;
  created_at?: string;
}

export interface DailyBalanceRecord {
  balance_id: string;
  store_id: string;
  warehouse_id: string;
  balance_date: string;
  custodian_user_id: string;
  status: 'BALANCED' | 'VARIANCE_FLAGGED';
  is_unexplained: boolean;
  finance_lead_signoff_id?: string | null;
  signoff_notes?: string | null;
  signed_off_at?: string | null;
  created_at: string;
  items?: DailyBalanceItemRecord[];
}

export interface StoreroomOption {
  id: string;
  code: string;
  name: string;
  type: 'COLD' | 'DRY';
  floor: string;
}

export const CAUSE_CODES = [
  'Select cause',
  'Trimming or prep loss',
  'Spillage or breakage',
  'Unrecorded issue',
  'Mis-picked unit (kg vs pcs)',
  'Receiving error',
  'Unknown, escalate',
] as const;

export const BENCHMARK_ITEMS: BenchmarkItemDef[] = [
  // Cold Room Benchmark Items
  {
    item_code: 'RM-MOZ-01',
    name: 'Mozzarella block',
    uom: 'kg',
    storage_type: 'COLD',
    category: 'Dairy',
    opening_qty: 50.0,
    received_qty: 0.0,
    issued_qty: 7.5,
    sample_counted_qty: 42.5,
  },
  {
    item_code: 'RM-BAS-01',
    name: 'Fresh basil',
    uom: 'kg',
    storage_type: 'COLD',
    category: 'Produce',
    opening_qty: 4.0,
    received_qty: 2.0,
    issued_qty: 2.8,
    sample_counted_qty: 3.0,
  },
  {
    item_code: 'RM-BUR-01',
    name: 'Burrata',
    uom: 'pcs',
    storage_type: 'COLD',
    category: 'Dairy',
    opening_qty: 30,
    received_qty: 0,
    issued_qty: 12,
    sample_counted_qty: 18,
  },
  {
    item_code: 'RM-CHK-01',
    name: 'Chicken breast',
    uom: 'kg',
    storage_type: 'COLD',
    category: 'Meat',
    opening_qty: 40.0,
    received_qty: 0.0,
    issued_qty: 14.0,
    sample_counted_qty: 26.0,
  },
  {
    item_code: 'RM-DOU-01',
    name: 'Pizza dough ball',
    uom: 'pcs',
    storage_type: 'COLD',
    category: 'Bakery',
    opening_qty: 200,
    received_qty: 0,
    issued_qty: 60,
    sample_counted_qty: 140,
  },
  // Dry Store Benchmark Items
  {
    item_code: 'DS-FLO-00',
    name: 'Flour 00',
    uom: 'kg',
    storage_type: 'DRY',
    category: 'Dry Grocery',
    opening_qty: 85.0,
    received_qty: 10.0,
    issued_qty: 10.0,
    sample_counted_qty: 85.0,
  },
  {
    item_code: 'DS-PAS-01',
    name: 'Tomato passata 2.5 kg tin',
    uom: 'pcs',
    storage_type: 'DRY',
    category: 'Dry Grocery',
    opening_qty: 36,
    received_qty: 0,
    issued_qty: 6,
    sample_counted_qty: 30,
  },
  {
    item_code: 'DS-BOX-12',
    name: 'Pizza box 12 in',
    uom: 'pcs',
    storage_type: 'DRY',
    category: 'Packaging',
    opening_qty: 400,
    received_qty: 0,
    issued_qty: 50,
    sample_counted_qty: 350,
  },
];

export const STOREROOMS: Record<string, StoreroomOption[]> = {
  'IND-DEL-01': [
    { id: 'WH-DEL01-COLD', code: 'WH-01', name: 'Cold Room', type: 'COLD', floor: 'Ground floor' },
    { id: 'WH-DEL01-DRY', code: 'WH-02', name: 'Dry Store', type: 'DRY', floor: 'Ground floor' },
  ],
  'IND-DEL-02': [
    { id: 'WH-DEL02-COLD', code: 'WH-01', name: 'Cold Room', type: 'COLD', floor: 'Ground floor' },
    { id: 'WH-DEL02-DRY', code: 'WH-02', name: 'Dry Store', type: 'DRY', floor: 'Ground floor' },
  ],
  'IND-BLR-01': [
    { id: 'WH-BLR01-COLD', code: 'WH-01', name: 'Cold Room', type: 'COLD', floor: 'Ground floor' },
    { id: 'WH-BLR01-DRY', code: 'WH-02', name: 'Dry Store', type: 'DRY', floor: 'Ground floor' },
  ],
};

// Seeded in-memory fallback history for demo & offline resilience
const mockBalanceHistory: DailyBalanceRecord[] = [
  {
    balance_id: 'bal-seed-01',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    balance_date: '2026-10-31',
    custodian_user_id: 'custodian-01',
    status: 'BALANCED',
    is_unexplained: false,
    finance_lead_signoff_id: 'rm-01',
    signoff_notes: 'Shift close verified with physical counts.',
    signed_off_at: '2026-10-31T21:45:00Z',
    created_at: '2026-10-31T21:30:00Z',
    items: [
      {
        balance_item_id: 'item-seed-01',
        balance_id: 'bal-seed-01',
        item_code: 'RM-MOZ-01',
        opening_qty: 48.0,
        received_qty: 12.0,
        issued_qty: 10.0,
        expected_qty: 50.0,
        counted_qty: 50.0,
        variance_qty: 0,
        variance_reason: null,
        responsible_person: null,
      },
      {
        balance_item_id: 'item-seed-02',
        balance_id: 'bal-seed-01',
        item_code: 'RM-BAS-01',
        opening_qty: 3.5,
        received_qty: 2.0,
        issued_qty: 1.5,
        expected_qty: 4.0,
        counted_qty: 4.0,
        variance_qty: 0,
        variance_reason: null,
        responsible_person: null,
      },
    ],
  },
  {
    balance_id: 'bal-seed-02',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-DRY',
    balance_date: '2026-10-31',
    custodian_user_id: 'custodian-01',
    status: 'BALANCED',
    is_unexplained: false,
    finance_lead_signoff_id: 'rm-01',
    signoff_notes: 'Dry store balance aligned with closing ledger.',
    signed_off_at: '2026-10-31T22:00:00Z',
    created_at: '2026-10-31T21:50:00Z',
    items: [
      {
        balance_item_id: 'item-seed-03',
        balance_id: 'bal-seed-02',
        item_code: 'DS-FLO-00',
        opening_qty: 100.0,
        received_qty: 0.0,
        issued_qty: 15.0,
        expected_qty: 85.0,
        counted_qty: 85.0,
        variance_qty: 0,
        variance_reason: null,
        responsible_person: null,
      },
    ],
  },
];

export interface DailyBalanceItemInput {
  item_code: string;
  opening_qty: number;
  received_qty?: number;
  issued_qty?: number;
  expected_qty?: number;
  counted_qty: number;
  variance_qty?: number;
  variance_reason?: string | null;
  responsible_person?: string | null;
}

/**
 * Submit daily benchmark balance and physical counts (Flow D).
 * Invokes public.submit_daily_balance RPC.
 */
export async function submitDailyBalance(
  storeId: string,
  warehouseId: string,
  items: DailyBalanceItemInput[],
  isUnexplained?: boolean
): Promise<string> {
  const formattedItems = items.map((item) => {
    const opening = Number(item.opening_qty);
    const received = Number(item.received_qty || 0);
    const issued = Number(item.issued_qty || 0);
    const counted = Number(item.counted_qty);
    const expected = Math.round((opening + received - issued) * 1000) / 1000;
    const variance = Math.round((counted - expected) * 1000) / 1000;

    return {
      item_code: String(item.item_code).trim(),
      opening_qty: opening,
      received_qty: received,
      issued_qty: issued,
      expected_qty: expected,
      counted_qty: counted,
      variance_qty: variance,
      variance_reason: item.variance_reason ? String(item.variance_reason).trim() : null,
      responsible_person: item.responsible_person ? String(item.responsible_person).trim() : null,
    };
  });

  const hasVariance = formattedItems.some((i) => i.variance_qty !== 0);
  const finalUnexplained = hasVariance ? Boolean(isUnexplained) : false;

  try {
    const { data, error } = await supabase.rpc('submit_daily_balance', {
      p_store_id: storeId,
      p_warehouse_id: warehouseId,
      p_items: formattedItems,
      p_is_unexplained: finalUnexplained,
    });

    if (error) {
      const isNetworkOrConfigError =
        error.message.includes('fetch failed') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('connection refused') ||
        error.message.includes('placeholder') ||
        error.code === 'PGRST301';

      if (!isNetworkOrConfigError) {
        throw new Error(error.message);
      }
    } else if (data) {
      return String(data);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrConfigError =
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('placeholder');

    if (!isNetworkOrConfigError) {
      throw err;
    }
  }

  // Fallback for prototype / offline sessions
  const generatedId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `bal-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const fallbackRecord: DailyBalanceRecord = {
    balance_id: generatedId,
    store_id: storeId,
    warehouse_id: warehouseId,
    balance_date: new Date().toISOString().split('T')[0],
    custodian_user_id: 'custodian-01',
    status: hasVariance ? 'VARIANCE_FLAGGED' : 'BALANCED',
    is_unexplained: finalUnexplained,
    created_at: new Date().toISOString(),
    items: formattedItems.map((item, idx) => ({
      balance_item_id: `item-${generatedId}-${idx}`,
      balance_id: generatedId,
      ...item,
      created_at: new Date().toISOString(),
    })),
  };

  mockBalanceHistory.unshift(fallbackRecord);
  return generatedId;
}

/**
 * Sign off daily balance by Finance Lead or Restaurant Manager.
 * Invokes public.sign_off_daily_balance RPC.
 */
export async function signOffDailyBalance(
  balanceId: string,
  notes?: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('sign_off_daily_balance', {
      p_balance_id: balanceId,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      const isNetworkOrConfigError =
        error.message.includes('fetch failed') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('connection refused') ||
        error.message.includes('placeholder');

      if (!isNetworkOrConfigError) {
        throw new Error(error.message);
      }
    } else {
      return;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkOrConfigError =
      msg.includes('fetch failed') ||
      msg.includes('Failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('placeholder');

    if (!isNetworkOrConfigError) {
      throw err;
    }
  }

  // Fallback update in mock history
  const found = mockBalanceHistory.find((r) => r.balance_id === balanceId);
  if (found) {
    found.signed_off_at = new Date().toISOString();
    found.signoff_notes = notes?.trim() || null;
    found.finance_lead_signoff_id = 'finance-lead-01';
  }
}

/**
 * Fetch daily balance history for a store.
 */
export async function getDailyBalanceHistory(storeId: string): Promise<DailyBalanceRecord[]> {
  try {
    const { data, error } = await supabase
      .from('t_daily_balances')
      .select(`
        balance_id,
        store_id,
        warehouse_id,
        balance_date,
        custodian_user_id,
        status,
        is_unexplained,
        finance_lead_signoff_id,
        signoff_notes,
        signed_off_at,
        created_at,
        items:t_daily_balance_items(
          balance_item_id,
          balance_id,
          item_code,
          opening_qty,
          received_qty,
          issued_qty,
          expected_qty,
          counted_qty,
          variance_qty,
          variance_reason,
          responsible_person
        )
      `)
      .eq('store_id', storeId)
      .order('balance_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data as unknown as DailyBalanceRecord[];
    }
  } catch {
    // Proceed to return mock history
  }

  return mockBalanceHistory.filter((r) => r.store_id === storeId);
}
