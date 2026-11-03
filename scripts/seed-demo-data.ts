/**
 * scripts/seed-demo-data.ts
 *
 * Populates local Supabase instance with prototype sample data:
 * - 2 Stores & 4 Storerooms
 * - 10 Synthetic Staff Accounts (@example.test)
 * - 20 Item Masters (Quantities only)
 * - Flow C-2 Ledger history with initial book stock balances
 *
 * Non-negotiable: Quantities only. Zero financial or commercial data.
 */

import { createClient } from '@supabase/supabase-js';
import {
  SEED_STORES,
  SEED_WAREHOUSES,
  SEED_ITEMS,
  SEED_EXPIRY_CONFIGS,
  buildInitialStockMovements,
} from '../lib/testing/synthetic-seed';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy';

const supabase = createClient(supabaseUrl, supabaseKey);

export async function seedDemoData() {
  console.log('==> Seeding Demo Master & Ledger Data...');

  // 1. Seed Stores
  for (const s of SEED_STORES) {
    await supabase.from('m_stores').upsert({
      store_id: s.store_id,
      store_name: s.store_name,
      city: s.city,
      is_active: s.is_active,
    });
  }
  console.log(`✓ Seeded ${SEED_STORES.length} stores`);

  // 2. Seed Warehouses
  for (const w of SEED_WAREHOUSES) {
    await supabase.from('m_warehouses').upsert({
      warehouse_id: w.warehouse_id,
      store_id: w.store_id,
      warehouse_name: w.warehouse_name,
      storage_type: w.storage_type,
      status: w.status,
      is_active: w.is_active,
    });
  }
  console.log(`✓ Seeded ${SEED_WAREHOUSES.length} warehouses`);

  // 3. Seed Expiry Config
  for (const c of SEED_EXPIRY_CONFIGS) {
    await supabase.from('m_expiry_tracking_config').upsert({
      config_id: c.config_id,
      category_group: c.category_group,
      requires_lot_expiry_tracking: c.requires_lot_expiry_tracking,
      expiry_warning_days: c.expiry_warning_days,
    });
  }
  console.log(`✓ Seeded ${SEED_EXPIRY_CONFIGS.length} expiry configs`);

  // 4. Seed Items
  for (const i of SEED_ITEMS) {
    await supabase.from('m_items').upsert({
      item_code: i.item_code,
      item_name: i.item_name,
      category_group: i.category_group,
      base_uom: i.base_uom,
      is_active: i.is_active,
    });
  }
  console.log(`✓ Seeded ${SEED_ITEMS.length} catalog items`);

  // 5. Seed Ledger Movements
  const movements = buildInitialStockMovements('IND-DEL-01');
  for (const m of movements) {
    await supabase.from('t_stock_movements').insert({
      movement_id: m.movement_id,
      store_id: m.store_id,
      warehouse_id: m.warehouse_id,
      item_code: m.item_code,
      movement_type: m.movement_type,
      quantity: m.quantity,
      uom: m.uom,
      batch_number: m.batch_number,
      expiry_date: m.expiry_date,
      reference_doc_id: m.reference_doc_id,
      created_by_user_id: m.created_by_user_id,
      created_at: m.created_at,
    });
  }
  console.log(`✓ Seeded ${movements.length} append-only ledger rows`);
  console.log('✅ Demo seeding complete.');
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  seedDemoData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
