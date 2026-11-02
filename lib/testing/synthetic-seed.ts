/**
 * Synthetic Seed Data Harness
 *
 * Implements deterministic fixtures for test suites:
 * - 10 role-titled test users on @example.test
 * - 2 stores (IND-DEL-01, IND-DEL-02)
 * - 2 warehouses (WH-DEL01-COLD, WH-DEL01-DRY)
 * - 20 sample items with categories, UoMs, lots, and expiry dates
 *
 * NON-NEGOTIABLE RULE: Quantities only. Physical movements and quantities only.
 */

import type { RawStockMovement } from './ledger-oracle';

export interface SeedStore {
  store_id: string;
  store_name: string;
  city: string;
  is_active: boolean;
}

export interface SeedWarehouse {
  warehouse_id: string;
  store_id: string;
  warehouse_name: string;
  storage_type: 'COLD_ROOM' | 'DRY_STORE';
  is_active: boolean;
  status: 'ACTIVE' | 'FROZEN_FOR_COUNT' | 'INACTIVE';
}

export interface SeedUser {
  user_id: string;
  email: string;
  full_name: string;
  role:
    | 'SYSTEM_ADMIN'
    | 'ADMIN'
    | 'RM'
    | 'KITCHEN_REQ'
    | 'BAR_REQ'
    | 'CHEESE_REQ'
    | 'RUNNER'
    | 'CUSTODIAN'
    | 'SCM'
    | 'ACCOUNTANT'
    | 'APPROVER'
    | 'VIEWER';
  store_id: string;
  warehouse_id?: string;
  section_id?: string;
  is_active: boolean;
}

export interface SeedExpiryConfig {
  config_id: string;
  category_group: string;
  requires_lot_expiry_tracking: boolean;
  expiry_warning_days: number;
}

export interface SeedItem {
  item_code: string;
  item_name: string;
  category_group: 'CHEESE' | 'DRY_GOODS' | 'MEAT' | 'VEGETABLE' | 'BEVERAGE';
  base_uom: 'kg' | 'pcs';
  secondary_uom?: 'pcs' | 'kg';
  dual_uom_required?: boolean;
  conversion_factor?: number;
  warehouse_id: string;
  lot_number: string;
  expiry_date: string; // ISO YYYY-MM-DD
  par_level: number;
  reorder_point: number;
  min_order_qty: number;
  initial_stock_qty: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// 1. Stores (2 Stores)
// ---------------------------------------------------------------------------
export const SEED_STORES: readonly SeedStore[] = [
  {
    store_id: 'IND-DEL-01',
    store_name: 'Connaught Place',
    city: 'New Delhi',
    is_active: true,
  },
  {
    store_id: 'IND-DEL-02',
    store_name: 'Saket',
    city: 'New Delhi',
    is_active: true,
  },
] as const;

// ---------------------------------------------------------------------------
// 2. Warehouses (2 Warehouses)
// ---------------------------------------------------------------------------
export const SEED_WAREHOUSES: readonly SeedWarehouse[] = [
  {
    warehouse_id: 'WH-DEL01-COLD',
    store_id: 'IND-DEL-01',
    warehouse_name: 'Cold Room',
    storage_type: 'COLD_ROOM',
    is_active: true,
    status: 'ACTIVE',
  },
  {
    warehouse_id: 'WH-DEL01-DRY',
    store_id: 'IND-DEL-01',
    warehouse_name: 'Dry Store',
    storage_type: 'DRY_STORE',
    is_active: true,
    status: 'ACTIVE',
  },
] as const;

// ---------------------------------------------------------------------------
// 3. Test Users (10 Primary Role-Titled Test Users on @example.test)
// ---------------------------------------------------------------------------
export const SEED_USERS: readonly SeedUser[] = [
  {
    user_id: 'usr-sysadmin-01',
    email: 'sysadmin@example.test',
    full_name: 'System Admin',
    role: 'SYSTEM_ADMIN',
    store_id: 'IND-DEL-01',
    is_active: true,
  },
  {
    user_id: 'usr-admin-01',
    email: 'admin@example.test',
    full_name: 'Warehouse Keeper Admin',
    role: 'ADMIN',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-DRY',
    is_active: true,
  },
  {
    user_id: 'usr-rm-01',
    email: 'rm@example.test',
    full_name: 'Restaurant Manager Delhi',
    role: 'RM',
    store_id: 'IND-DEL-01',
    is_active: true,
  },
  {
    user_id: 'usr-kitchen-01',
    email: 'kitchen@example.test',
    full_name: 'Kitchen Section Requester',
    role: 'KITCHEN_REQ',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    is_active: true,
  },
  {
    user_id: 'usr-bar-01',
    email: 'bar@example.test',
    full_name: 'Bar Section Requester',
    role: 'BAR_REQ',
    store_id: 'IND-DEL-01',
    section_id: 'BAR',
    is_active: true,
  },
  {
    user_id: 'usr-cheese-01',
    email: 'cheese@example.test',
    full_name: 'Cheese Section Requester',
    role: 'CHEESE_REQ',
    store_id: 'IND-DEL-01',
    section_id: 'CHEESE',
    is_active: true,
  },
  {
    user_id: 'usr-runner-01',
    email: 'runner@example.test',
    full_name: 'Kitchen Runner',
    role: 'RUNNER',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    is_active: true,
  },
  {
    user_id: 'usr-custodian-01',
    email: 'custodian@example.test',
    full_name: 'Cold Room Custodian',
    role: 'CUSTODIAN',
    store_id: 'IND-DEL-01',
    warehouse_id: 'WH-DEL01-COLD',
    is_active: true,
  },
  {
    user_id: 'usr-accountant-01',
    email: 'accountant@example.test',
    full_name: 'Store Accountant',
    role: 'ACCOUNTANT',
    store_id: 'IND-DEL-01',
    is_active: true,
  },
  {
    user_id: 'usr-approver-01',
    email: 'approver@example.test',
    full_name: 'Financial Controller Approver',
    role: 'APPROVER',
    store_id: 'IND-DEL-01',
    is_active: true,
  },
] as const;

// Additional optional role users for extended coverage
export const EXTENDED_SEED_USERS: readonly SeedUser[] = [
  ...SEED_USERS,
  {
    user_id: 'usr-scm-01',
    email: 'scm@example.test',
    full_name: 'Supply Chain Lead',
    role: 'SCM',
    store_id: 'IND-DEL-01',
    is_active: true,
  },
  {
    user_id: 'usr-viewer-01',
    email: 'viewer@example.test',
    full_name: 'Internal Auditor Viewer',
    role: 'VIEWER',
    store_id: 'IND-DEL-01',
    is_active: true,
  },
] as const;

// ---------------------------------------------------------------------------
// 4. Expiry Tracking Configurations
// ---------------------------------------------------------------------------
export const SEED_EXPIRY_CONFIGS: readonly SeedExpiryConfig[] = [
  {
    config_id: 'cfg-exp-chz',
    category_group: 'CHEESE',
    requires_lot_expiry_tracking: true,
    expiry_warning_days: 3,
  },
  {
    config_id: 'cfg-exp-dry',
    category_group: 'DRY_GOODS',
    requires_lot_expiry_tracking: false,
    expiry_warning_days: 14,
  },
  {
    config_id: 'cfg-exp-met',
    category_group: 'MEAT',
    requires_lot_expiry_tracking: true,
    expiry_warning_days: 5,
  },
  {
    config_id: 'cfg-exp-veg',
    category_group: 'VEGETABLE',
    requires_lot_expiry_tracking: true,
    expiry_warning_days: 2,
  },
  {
    config_id: 'cfg-exp-bev',
    category_group: 'BEVERAGE',
    requires_lot_expiry_tracking: false,
    expiry_warning_days: 30,
  },
] as const;

// ---------------------------------------------------------------------------
// 5. 20 Sample Items (with categories, UoMs, lots and expiry dates)
// Quantities only; physical movement attributes only.
// ---------------------------------------------------------------------------
export const SEED_ITEMS: readonly SeedItem[] = [
  // 5 Cheese Items (Cold Room)
  {
    item_code: 'ITM-CHZ-001',
    item_name: 'Mozzarella Fior di Latte',
    category_group: 'CHEESE',
    base_uom: 'kg',
    secondary_uom: 'pcs',
    dual_uom_required: true,
    conversion_factor: 1, // 1 block ~ 1kg
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-CHZ-001',
    expiry_date: '2026-11-20',
    par_level: 150,
    reorder_point: 50,
    min_order_qty: 30,
    initial_stock_qty: 100,
    is_active: true,
  },
  {
    item_code: 'ITM-CHZ-002',
    item_name: 'Fresh Burrata 150g',
    category_group: 'CHEESE',
    base_uom: 'pcs',
    secondary_uom: 'kg',
    dual_uom_required: true,
    conversion_factor: 0.15,
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-BUR-002',
    expiry_date: '2026-11-08',
    par_level: 80,
    reorder_point: 20,
    min_order_qty: 20,
    initial_stock_qty: 45,
    is_active: true,
  },
  {
    item_code: 'ITM-CHZ-003',
    item_name: 'Buffalo Mozzarella 200g',
    category_group: 'CHEESE',
    base_uom: 'pcs',
    secondary_uom: 'kg',
    dual_uom_required: true,
    conversion_factor: 0.2,
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-BUF-003',
    expiry_date: '2026-11-12',
    par_level: 60,
    reorder_point: 15,
    min_order_qty: 15,
    initial_stock_qty: 30,
    is_active: true,
  },
  {
    item_code: 'ITM-CHZ-004',
    item_name: 'House Ricotta',
    category_group: 'CHEESE',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-RIC-004',
    expiry_date: '2026-11-15',
    par_level: 40,
    reorder_point: 10,
    min_order_qty: 10,
    initial_stock_qty: 25,
    is_active: true,
  },
  {
    item_code: 'ITM-CHZ-005',
    item_name: 'Gorgonzola Dolce',
    category_group: 'CHEESE',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-GOR-005',
    expiry_date: '2026-12-05',
    par_level: 25,
    reorder_point: 8,
    min_order_qty: 5,
    initial_stock_qty: 15,
    is_active: true,
  },

  // 5 Dry Goods Items (Dry Store)
  {
    item_code: 'ITM-DRY-001',
    item_name: 'Caputo Type 00 Pizza Flour',
    category_group: 'DRY_GOODS',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-FLR-001',
    expiry_date: '2027-05-01',
    par_level: 500,
    reorder_point: 150,
    min_order_qty: 100,
    initial_stock_qty: 350,
    is_active: true,
  },
  {
    item_code: 'ITM-DRY-002',
    item_name: 'San Marzano Tomato Pelati',
    category_group: 'DRY_GOODS',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-TOM-002',
    expiry_date: '2027-10-31',
    par_level: 200,
    reorder_point: 60,
    min_order_qty: 40,
    initial_stock_qty: 120,
    is_active: true,
  },
  {
    item_code: 'ITM-DRY-003',
    item_name: 'Extra Virgin Olive Oil',
    category_group: 'DRY_GOODS',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-EVO-003',
    expiry_date: '2027-08-15',
    par_level: 100,
    reorder_point: 30,
    min_order_qty: 20,
    initial_stock_qty: 60,
    is_active: true,
  },
  {
    item_code: 'ITM-DRY-004',
    item_name: 'Fresh Active Yeast',
    category_group: 'DRY_GOODS',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-YST-004',
    expiry_date: '2026-11-25',
    par_level: 20,
    reorder_point: 5,
    min_order_qty: 5,
    initial_stock_qty: 12,
    is_active: true,
  },
  {
    item_code: 'ITM-DRY-005',
    item_name: 'Sea Salt Coarse',
    category_group: 'DRY_GOODS',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-SLT-005',
    expiry_date: '2028-01-01',
    par_level: 50,
    reorder_point: 15,
    min_order_qty: 10,
    initial_stock_qty: 35,
    is_active: true,
  },

  // 4 Meat Items (Cold Room)
  {
    item_code: 'ITM-MET-001',
    item_name: 'Prosciutto di Parma',
    category_group: 'MEAT',
    base_uom: 'kg',
    secondary_uom: 'pcs',
    dual_uom_required: true,
    conversion_factor: 7, // ~7kg per whole leg
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-PRM-001',
    expiry_date: '2026-12-15',
    par_level: 50,
    reorder_point: 15,
    min_order_qty: 10,
    initial_stock_qty: 28,
    is_active: true,
  },
  {
    item_code: 'ITM-MET-002',
    item_name: 'Spicy Salami Spianata',
    category_group: 'MEAT',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-SAL-002',
    expiry_date: '2026-12-30',
    par_level: 30,
    reorder_point: 10,
    min_order_qty: 5,
    initial_stock_qty: 18,
    is_active: true,
  },
  {
    item_code: 'ITM-MET-003',
    item_name: 'Guanciale Affumicato',
    category_group: 'MEAT',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-GUA-003',
    expiry_date: '2027-01-15',
    par_level: 25,
    reorder_point: 8,
    min_order_qty: 5,
    initial_stock_qty: 14,
    is_active: true,
  },
  {
    item_code: 'ITM-MET-004',
    item_name: 'Cooked Ham Cotto',
    category_group: 'MEAT',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-HAM-004',
    expiry_date: '2026-11-30',
    par_level: 40,
    reorder_point: 12,
    min_order_qty: 10,
    initial_stock_qty: 22,
    is_active: true,
  },

  // 4 Vegetable Items (Cold Room)
  {
    item_code: 'ITM-VEG-001',
    item_name: 'Fresh Sweet Basil',
    category_group: 'VEGETABLE',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-BSL-001',
    expiry_date: '2026-11-06',
    par_level: 15,
    reorder_point: 5,
    min_order_qty: 5,
    initial_stock_qty: 8,
    is_active: true,
  },
  {
    item_code: 'ITM-VEG-002',
    item_name: 'Organic Cherry Tomatoes',
    category_group: 'VEGETABLE',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-CTR-002',
    expiry_date: '2026-11-09',
    par_level: 35,
    reorder_point: 10,
    min_order_qty: 10,
    initial_stock_qty: 18,
    is_active: true,
  },
  {
    item_code: 'ITM-VEG-003',
    item_name: 'Wild Rocket Arugula',
    category_group: 'VEGETABLE',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-ARG-003',
    expiry_date: '2026-11-07',
    par_level: 20,
    reorder_point: 6,
    min_order_qty: 5,
    initial_stock_qty: 10,
    is_active: true,
  },
  {
    item_code: 'ITM-VEG-004',
    item_name: 'Fresh Button Mushrooms',
    category_group: 'VEGETABLE',
    base_uom: 'kg',
    warehouse_id: 'WH-DEL01-COLD',
    lot_number: 'LOT-2026-MSH-004',
    expiry_date: '2026-11-08',
    par_level: 25,
    reorder_point: 8,
    min_order_qty: 5,
    initial_stock_qty: 12,
    is_active: true,
  },

  // 2 Beverage Items (Dry Store)
  {
    item_code: 'ITM-BEV-001',
    item_name: 'San Pellegrino Sparkling Water 750ml',
    category_group: 'BEVERAGE',
    base_uom: 'pcs',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-SPW-001',
    expiry_date: '2027-11-01',
    par_level: 120,
    reorder_point: 36,
    min_order_qty: 24,
    initial_stock_qty: 72,
    is_active: true,
  },
  {
    item_code: 'ITM-BEV-002',
    item_name: 'House Brew IPA Draft Keg 20L',
    category_group: 'BEVERAGE',
    base_uom: 'pcs',
    warehouse_id: 'WH-DEL01-DRY',
    lot_number: 'LOT-2026-IPA-002',
    expiry_date: '2026-12-10',
    par_level: 10,
    reorder_point: 3,
    min_order_qty: 2,
    initial_stock_qty: 6,
    is_active: true,
  },
] as const;

/**
 * Builds baseline initial stock movements (GRPO_IMPORT) for all 20 seed items
 * in store IND-DEL-01.
 */
export function buildInitialStockMovements(
  storeId: string = 'IND-DEL-01'
): RawStockMovement[] {
  return SEED_ITEMS.map((item, index) => ({
    movement_id: `mvt-init-${(index + 1).toString().padStart(3, '0')}`,
    store_id: storeId,
    warehouse_id: item.warehouse_id,
    item_code: item.item_code,
    movement_type: 'GRPO_IMPORT',
    quantity: item.initial_stock_qty,
    uom: item.base_uom,
    batch_number: item.lot_number,
    expiry_date: item.expiry_date,
    reference_doc_id: `GRPO-INIT-${item.item_code}`,
    created_by_user_id: 'usr-admin-01',
    created_at: new Date('2026-11-01T08:00:00.000Z'),
  }));
}
