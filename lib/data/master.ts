import { supabase } from '@/lib/supabase/client';

export type MasterCategory = 'Dairy' | 'Meat' | 'Produce' | 'Seafood' | 'Dry' | 'Packaging';
export type BaseUom = 'kg' | 'pcs';

export interface MasterItem {
  itemCode: string;
  itemName: string;
  categoryGroup: MasterCategory;
  baseUom: BaseUom;
  dualUomRequired: boolean;
  warehouseId: string;
  storageType: 'COLD_ROOM' | 'DRY_STORE';
  // User-defined Reorder Policies (Doc §4.4)
  reorderPoint: number | null; // null indicates [Owner to set]
  parLevel: number | null; // null indicates [Owner to set]
  minOrderQty: number | null;
  // Expiry Tracking Configuration (Doc §4.5)
  requiresExpiryTracking: boolean;
  expiryWarningDays: number;
  shelfLifeDays: number;
  isActive: boolean;
}

export interface UomConversion {
  conversionId: string;
  itemCode: string;
  itemName: string;
  categoryGroup: MasterCategory;
  baseUom: BaseUom;
  secondaryUom: string;
  conversionFactor: number;
  dualUomRequired: boolean;
  sampleExpression: string;
}

export interface StoreOperationalWindows {
  storeId: string;
  morningIssueWindow: string; // e.g. "08:30-10:30"
  afternoonIssueWindow: string; // e.g. "14:30-16:00"
  morningReceivingWindow?: string; // e.g. "07:00-09:00"
  afternoonReceivingWindow?: string; // e.g. "14:00-16:00"
}

// ---------------------------------------------------------------------------
// 20 Canonical Benchmark Items (Doc §4.4 & §4.5)
// Categories: Dairy (5), Meat (4), Produce (4), Seafood (2), Dry (3), Packaging (2)
// Invariants: Quantities only. Physical unit stock measurements only.
// ---------------------------------------------------------------------------

const mockMasterItems: MasterItem[] = [
  // 1. Dairy (CHEESE) - Dual-unit kg + pcs required
  {
    itemCode: 'ITM-CHZ-001',
    itemName: 'Mozzarella Fior di Latte',
    categoryGroup: 'Dairy',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: 50.0,
    parLevel: 150.0,
    minOrderQty: 30.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 3,
    shelfLifeDays: 28,
    isActive: true,
  },
  {
    itemCode: 'ITM-CHZ-002',
    itemName: 'Fresh Burrata 150g',
    categoryGroup: 'Dairy',
    baseUom: 'pcs',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 20.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 2,
    shelfLifeDays: 7,
    isActive: true,
  },
  {
    itemCode: 'ITM-CHZ-003',
    itemName: 'Buffalo Mozzarella 200g',
    categoryGroup: 'Dairy',
    baseUom: 'pcs',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 15.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 3,
    shelfLifeDays: 10,
    isActive: true,
  },
  {
    itemCode: 'ITM-CHZ-004',
    itemName: 'House Artisanal Ricotta',
    categoryGroup: 'Dairy',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: 10.0,
    parLevel: 40.0,
    minOrderQty: 10.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 2,
    shelfLifeDays: 5,
    isActive: true,
  },
  {
    itemCode: 'ITM-CHZ-005',
    itemName: 'Gorgonzola Dolce DOP',
    categoryGroup: 'Dairy',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 5,
    shelfLifeDays: 45,
    isActive: true,
  },

  // 2. Meat (MEAT) - Dual-unit kg + pcs required
  {
    itemCode: 'ITM-MET-001',
    itemName: 'Prosciutto di Parma 24M',
    categoryGroup: 'Meat',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: 15.0,
    parLevel: 50.0,
    minOrderQty: 10.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 7,
    shelfLifeDays: 60,
    isActive: true,
  },
  {
    itemCode: 'ITM-MET-002',
    itemName: 'Spicy Salami Spianata',
    categoryGroup: 'Meat',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 5,
    shelfLifeDays: 60,
    isActive: true,
  },
  {
    itemCode: 'ITM-MET-003',
    itemName: 'Guanciale Stagionato',
    categoryGroup: 'Meat',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 7,
    shelfLifeDays: 90,
    isActive: true,
  },
  {
    itemCode: 'ITM-MET-004',
    itemName: 'Fresh Chicken Breast Fillet',
    categoryGroup: 'Meat',
    baseUom: 'kg',
    dualUomRequired: true,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: 12.0,
    parLevel: 40.0,
    minOrderQty: 10.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 1,
    shelfLifeDays: 4,
    isActive: true,
  },

  // 3. Produce (VEGETABLE)
  {
    itemCode: 'ITM-VEG-001',
    itemName: 'Fresh Sweet Basil',
    categoryGroup: 'Produce',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: 5.0,
    parLevel: 15.0,
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 1,
    shelfLifeDays: 4,
    isActive: true,
  },
  {
    itemCode: 'ITM-VEG-002',
    itemName: 'Organic Cherry Tomatoes',
    categoryGroup: 'Produce',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 10.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 2,
    shelfLifeDays: 7,
    isActive: true,
  },
  {
    itemCode: 'ITM-VEG-003',
    itemName: 'Wild Rocket Arugula',
    categoryGroup: 'Produce',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: 6.0,
    parLevel: 20.0,
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 2,
    shelfLifeDays: 5,
    isActive: true,
  },
  {
    itemCode: 'ITM-VEG-004',
    itemName: 'Fresh Button Mushrooms',
    categoryGroup: 'Produce',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 2,
    shelfLifeDays: 5,
    isActive: true,
  },

  // 4. Seafood
  {
    itemCode: 'ITM-SEA-001',
    itemName: 'Fresh Salmon Fillet Sashimi Grade',
    categoryGroup: 'Seafood',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 1,
    shelfLifeDays: 3,
    isActive: true,
  },
  {
    itemCode: 'ITM-SEA-002',
    itemName: 'Tiger Prawns Deveined 16/20',
    categoryGroup: 'Seafood',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-COLD',
    storageType: 'COLD_ROOM',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 5.0,
    requiresExpiryTracking: true,
    expiryWarningDays: 1,
    shelfLifeDays: 3,
    isActive: true,
  },

  // 5. Dry Goods (DRY_GOODS)
  {
    itemCode: 'ITM-DRY-001',
    itemName: 'Caputo Type 00 Pizza Flour',
    categoryGroup: 'Dry',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-DRY',
    storageType: 'DRY_STORE',
    reorderPoint: 150.0,
    parLevel: 500.0,
    minOrderQty: 100.0,
    requiresExpiryTracking: false,
    expiryWarningDays: 14,
    shelfLifeDays: 180,
    isActive: true,
  },
  {
    itemCode: 'ITM-DRY-002',
    itemName: 'San Marzano Tomato Pelati Passata',
    categoryGroup: 'Dry',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-DRY',
    storageType: 'DRY_STORE',
    reorderPoint: 60.0,
    parLevel: 200.0,
    minOrderQty: 40.0,
    requiresExpiryTracking: false,
    expiryWarningDays: 30,
    shelfLifeDays: 365,
    isActive: true,
  },
  {
    itemCode: 'ITM-DRY-003',
    itemName: 'Extra Virgin Olive Oil Cold-Pressed',
    categoryGroup: 'Dry',
    baseUom: 'kg',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-DRY',
    storageType: 'DRY_STORE',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 20.0,
    requiresExpiryTracking: false,
    expiryWarningDays: 30,
    shelfLifeDays: 365,
    isActive: true,
  },

  // 6. Packaging (PACKAGING)
  {
    itemCode: 'ITM-PKG-001',
    itemName: 'Pizza Takeaway Box 12-inch Kraft',
    categoryGroup: 'Packaging',
    baseUom: 'pcs',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-DRY',
    storageType: 'DRY_STORE',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 200.0,
    requiresExpiryTracking: false,
    expiryWarningDays: 0,
    shelfLifeDays: 730,
    isActive: true,
  },
  {
    itemCode: 'ITM-PKG-002',
    itemName: 'Biodegradable Delivery Carrier Bag',
    categoryGroup: 'Packaging',
    baseUom: 'pcs',
    dualUomRequired: false,
    warehouseId: 'WH-DEL01-DRY',
    storageType: 'DRY_STORE',
    reorderPoint: null, // [Owner to set]
    parLevel: null, // [Owner to set]
    minOrderQty: 500.0,
    requiresExpiryTracking: false,
    expiryWarningDays: 0,
    shelfLifeDays: 730,
    isActive: true,
  },
];

// ---------------------------------------------------------------------------
// Secondary UoM Conversions
// ---------------------------------------------------------------------------

const mockUomConversions: UomConversion[] = [
  {
    conversionId: 'uom-conv-01',
    itemCode: 'ITM-DRY-002',
    itemName: 'San Marzano Tomato Pelati Passata',
    categoryGroup: 'Dry',
    baseUom: 'kg',
    secondaryUom: 'tin',
    conversionFactor: 2.5,
    dualUomRequired: false,
    sampleExpression: '1 tin = 2.5 kg passata',
  },
  {
    conversionId: 'uom-conv-02',
    itemCode: 'ITM-CHZ-002',
    itemName: 'Fresh Burrata 150g',
    categoryGroup: 'Dairy',
    baseUom: 'pcs',
    secondaryUom: 'pack',
    conversionFactor: 12.0,
    dualUomRequired: true,
    sampleExpression: '1 pack = 12 pcs burrata',
  },
  {
    conversionId: 'uom-conv-03',
    itemCode: 'ITM-CHZ-001',
    itemName: 'Mozzarella Fior di Latte',
    categoryGroup: 'Dairy',
    baseUom: 'kg',
    secondaryUom: 'block',
    conversionFactor: 1.0,
    dualUomRequired: true,
    sampleExpression: '1 block = 1.0 kg mozzarella',
  },
  {
    conversionId: 'uom-conv-04',
    itemCode: 'ITM-CHZ-003',
    itemName: 'Buffalo Mozzarella 200g',
    categoryGroup: 'Dairy',
    baseUom: 'pcs',
    secondaryUom: 'tub',
    conversionFactor: 5.0,
    dualUomRequired: true,
    sampleExpression: '1 tub = 5 pcs / 1.0 kg buffalo',
  },
  {
    conversionId: 'uom-conv-05',
    itemCode: 'ITM-MET-001',
    itemName: 'Prosciutto di Parma 24M',
    categoryGroup: 'Meat',
    baseUom: 'kg',
    secondaryUom: 'leg',
    conversionFactor: 7.5,
    dualUomRequired: true,
    sampleExpression: '1 leg = 7.5 kg prosciutto',
  },
  {
    conversionId: 'uom-conv-06',
    itemCode: 'ITM-MET-002',
    itemName: 'Spicy Salami Spianata',
    categoryGroup: 'Meat',
    baseUom: 'kg',
    secondaryUom: 'piece',
    conversionFactor: 1.8,
    dualUomRequired: true,
    sampleExpression: '1 piece = 1.8 kg salami',
  },
  {
    conversionId: 'uom-conv-07',
    itemCode: 'ITM-DRY-001',
    itemName: 'Caputo Type 00 Pizza Flour',
    categoryGroup: 'Dry',
    baseUom: 'kg',
    secondaryUom: 'sack',
    conversionFactor: 25.0,
    dualUomRequired: false,
    sampleExpression: '1 sack = 25.0 kg flour',
  },
  {
    conversionId: 'uom-conv-08',
    itemCode: 'ITM-DRY-003',
    itemName: 'Extra Virgin Olive Oil Cold-Pressed',
    categoryGroup: 'Dry',
    baseUom: 'kg',
    secondaryUom: 'can',
    conversionFactor: 5.0,
    dualUomRequired: false,
    sampleExpression: '1 can = 5.0 kg olive oil',
  },
  {
    conversionId: 'uom-conv-09',
    itemCode: 'ITM-PKG-001',
    itemName: 'Pizza Takeaway Box 12-inch Kraft',
    categoryGroup: 'Packaging',
    baseUom: 'pcs',
    secondaryUom: 'bundle',
    conversionFactor: 100.0,
    dualUomRequired: false,
    sampleExpression: '1 bundle = 100 pcs boxes',
  },
  {
    conversionId: 'uom-conv-10',
    itemCode: 'ITM-PKG-002',
    itemName: 'Biodegradable Delivery Carrier Bag',
    categoryGroup: 'Packaging',
    baseUom: 'pcs',
    secondaryUom: 'pack',
    conversionFactor: 50.0,
    dualUomRequired: false,
    sampleExpression: '1 pack = 50 pcs bags',
  },
];

// ---------------------------------------------------------------------------
// Store Operational Windows (Flow B)
// ---------------------------------------------------------------------------

const mockOperationalWindows: Record<string, StoreOperationalWindows> = {
  'IND-DEL-01': {
    storeId: 'IND-DEL-01',
    morningIssueWindow: '08:30-10:30',
    afternoonIssueWindow: '14:30-16:00',
    morningReceivingWindow: '07:00-09:00',
    afternoonReceivingWindow: '14:00-16:00',
  },
  'IND-DEL-02': {
    storeId: 'IND-DEL-02',
    morningIssueWindow: '08:30-10:30',
    afternoonIssueWindow: '14:30-16:00',
    morningReceivingWindow: '07:00-09:00',
    afternoonReceivingWindow: '14:00-16:00',
  },
  'IND-BLR-01': {
    storeId: 'IND-BLR-01',
    morningIssueWindow: '08:30-10:30',
    afternoonIssueWindow: '14:30-16:00',
    morningReceivingWindow: '07:00-09:00',
    afternoonReceivingWindow: '14:00-16:00',
  },
};

// ---------------------------------------------------------------------------
// Data Access Functions
// ---------------------------------------------------------------------------

/**
 * Retrieves the 20 benchmark master items with reorder rules and shelf-life parameters.
 */
export async function getMasterItems(storeId: string = 'IND-DEL-01'): Promise<MasterItem[]> {
  try {
    const { data: dbItems, error: itemsError } = await supabase
      .from('m_items')
      .select('item_code, item_name, category_group, base_uom, is_active');

    const { data: dbRules } = await supabase
      .from('m_reorder_rules')
      .select('item_code, reorder_point, par_level, min_order_qty')
      .eq('store_id', storeId);

    const { data: dbExpiry } = await supabase
      .from('m_expiry_tracking_config')
      .select('category_group, requires_lot_expiry_tracking, expiry_warning_days');

    if (!itemsError && dbItems && dbItems.length > 0) {
      const ruleMap = new Map((dbRules || []).map((r) => [r.item_code, r]));
      const expMap = new Map((dbExpiry || []).map((e) => [e.category_group.toUpperCase(), e]));

      return mockMasterItems.map((mock) => {
        const foundItem = dbItems.find((d) => d.item_code === mock.itemCode);
        const rule = ruleMap.get(mock.itemCode);
        const exp = expMap.get(mock.categoryGroup.toUpperCase());

        return {
          ...mock,
          itemName: foundItem?.item_name || mock.itemName,
          baseUom: (foundItem?.base_uom?.toLowerCase() === 'pcs' ? 'pcs' : 'kg') as BaseUom,
          isActive: foundItem?.is_active ?? mock.isActive,
          reorderPoint: rule ? Number(rule.reorder_point) : mock.reorderPoint,
          parLevel: rule ? Number(rule.par_level) : mock.parLevel,
          minOrderQty: rule ? Number(rule.min_order_qty) : mock.minOrderQty,
          expiryWarningDays: exp ? exp.expiry_warning_days : mock.expiryWarningDays,
          requiresExpiryTracking: exp ? exp.requires_lot_expiry_tracking : mock.requiresExpiryTracking,
        };
      });
    }
  } catch {
    // Database connection fallback
  }

  return [...mockMasterItems];
}

/**
 * Updates or sets the user-defined reorder rule for an item (Doc §4.4).
 * Reorder Point and Par Level have no automated defaults [Owner to set].
 */
export async function updateItemReorderRule(
  itemCode: string,
  storeId: string,
  reorderPoint: number,
  parLevel: number
): Promise<void> {
  if (reorderPoint < 0 || parLevel < 0) {
    throw new Error('Reorder Point and Par Level quantities must be non-negative numbers.');
  }

  // Update in-memory mock record
  const itemIndex = mockMasterItems.findIndex((it) => it.itemCode === itemCode);
  if (itemIndex >= 0) {
    mockMasterItems[itemIndex] = {
      ...mockMasterItems[itemIndex],
      reorderPoint,
      parLevel,
    };
  }

  try {
    const warehouseId = mockMasterItems[itemIndex]?.warehouseId || 'WH-DEL01-COLD';
    await supabase.from('m_reorder_rules').upsert(
      {
        rule_id: `rr-${storeId.toLowerCase()}-${itemCode.toLowerCase()}`,
        store_id: storeId,
        warehouse_id: warehouseId,
        item_code: itemCode,
        reorder_point: reorderPoint,
        par_level: parLevel,
        min_order_qty: mockMasterItems[itemIndex]?.minOrderQty || 0,
        adu_window_days: 7,
      },
      { onConflict: 'store_id, warehouse_id, item_code' }
    );
  } catch {
    // In-memory update preserved for prototype execution
  }
}

/**
 * Updates expiry warning threshold in days for an item or category group (Doc §4.5).
 * Triggers amber highlight when Days to Expiry <= warningDays.
 */
export async function updateExpiryConfig(itemCode: string, warningDays: number): Promise<void> {
  if (warningDays < 0) {
    throw new Error('Expiry warning days must be a non-negative number.');
  }

  const item = mockMasterItems.find((it) => it.itemCode === itemCode);
  if (item) {
    item.expiryWarningDays = warningDays;
  }

  // Also update category group if matched
  for (const it of mockMasterItems) {
    if (item && it.categoryGroup === item.categoryGroup) {
      it.expiryWarningDays = warningDays;
    }
  }

  try {
    const category = item?.categoryGroup || itemCode;
    await supabase.from('m_expiry_tracking_config').upsert(
      {
        config_id: `cfg-exp-${category.toLowerCase().slice(0, 3)}`,
        category_group: category.toUpperCase(),
        requires_lot_expiry_tracking: true,
        expiry_warning_days: warningDays,
      },
      { onConflict: 'category_group' }
    );
  } catch {
    // Fallback to in-memory update
  }
}

/**
 * Retrieves the secondary Unit of Measure (UoM) conversion definitions.
 */
export async function getUomConversions(): Promise<UomConversion[]> {
  try {
    const { data, error } = await supabase
      .from('m_uom_conversions')
      .select('conversion_id, item_code, base_uom, secondary_uom, conversion_factor, dual_uom_required');

    if (!error && data && data.length > 0) {
      return data.map((d) => {
        const item = mockMasterItems.find((m) => m.itemCode === d.item_code);
        return {
          conversionId: d.conversion_id,
          itemCode: d.item_code,
          itemName: item?.itemName || d.item_code,
          categoryGroup: item?.categoryGroup || 'Dry',
          baseUom: (d.base_uom?.toLowerCase() === 'pcs' ? 'pcs' : 'kg') as BaseUom,
          secondaryUom: d.secondary_uom,
          conversionFactor: Number(d.conversion_factor),
          dualUomRequired: Boolean(d.dual_uom_required),
          sampleExpression: `1 ${d.secondary_uom} = ${d.conversion_factor} ${d.base_uom} ${item?.itemName || ''}`.trim(),
        };
      });
    }
  } catch {
    // Fallback
  }

  return [...mockUomConversions];
}

/**
 * Updates a secondary UoM conversion factor and dual-unit mandate flag.
 */
export async function updateUomConversion(
  conversionId: string,
  conversionFactor: number,
  dualUomRequired: boolean
): Promise<void> {
  if (conversionFactor <= 0) {
    throw new Error('UoM conversion factor must be strictly greater than zero.');
  }

  const idx = mockUomConversions.findIndex((c) => c.conversionId === conversionId);
  if (idx >= 0) {
    const existing = mockUomConversions[idx];
    mockUomConversions[idx] = {
      ...existing,
      conversionFactor,
      dualUomRequired,
      sampleExpression: `1 ${existing.secondaryUom} = ${conversionFactor} ${existing.baseUom} ${existing.itemName}`,
    };
  }

  try {
    await supabase
      .from('m_uom_conversions')
      .update({
        conversion_factor: conversionFactor,
        dual_uom_required: dualUomRequired,
      })
      .eq('conversion_id', conversionId);
  } catch {
    // Preserved in mock
  }
}

/**
 * Retrieves the operational requisition and intake windows for a store (Flow B).
 */
export async function getStoreOperationalWindows(storeId: string): Promise<StoreOperationalWindows> {
  try {
    const { data, error } = await supabase
      .from('m_go_live_assignments')
      .select('store_id, morning_issue_window, afternoon_issue_window, morning_receiving_window, afternoon_receiving_window')
      .eq('store_id', storeId)
      .maybeSingle();

    if (!error && data) {
      return {
        storeId: data.store_id,
        morningIssueWindow: data.morning_issue_window || '08:30-10:30',
        afternoonIssueWindow: data.afternoon_issue_window || '14:30-16:00',
        morningReceivingWindow: data.morning_receiving_window || '07:00-09:00',
        afternoonReceivingWindow: data.afternoon_receiving_window || '14:00-16:00',
      };
    }
  } catch {
    // Fallback
  }

  return (
    mockOperationalWindows[storeId] || {
      storeId,
      morningIssueWindow: '08:30-10:30',
      afternoonIssueWindow: '14:30-16:00',
      morningReceivingWindow: '07:00-09:00',
      afternoonReceivingWindow: '14:00-16:00',
    }
  );
}

/**
 * Updates the scheduled morning and afternoon issue windows for a store (Flow B).
 */
export async function updateStoreOperationalWindows(
  storeId: string,
  morningIssueWindow: string,
  afternoonIssueWindow: string
): Promise<void> {
  const current = mockOperationalWindows[storeId] || {
    storeId,
    morningIssueWindow: '08:30-10:30',
    afternoonIssueWindow: '14:30-16:00',
  };

  mockOperationalWindows[storeId] = {
    ...current,
    morningIssueWindow,
    afternoonIssueWindow,
  };

  try {
    await supabase.from('m_go_live_assignments').upsert(
      {
        store_id: storeId,
        morning_issue_window: morningIssueWindow,
        afternoon_issue_window: afternoonIssueWindow,
      },
      { onConflict: 'store_id' }
    );
  } catch {
    // In-memory preserved
  }
}
