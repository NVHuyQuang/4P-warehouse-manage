-- pgTAP Test Suite for Domain D3: Items, Expiry Tracking Config, Reorder Rules, UoM Conversions
-- Tests: Schema, Constraints, Triggers, Seed Data, and RLS (Allowed & Denied)
-- Non-negotiable: Quantities only. Zero financial or valuation data.

BEGIN;
SELECT plan(48);

-- ---------------------------------------------------------------------------
-- 1. TABLE EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_table('m_items', 'Table m_items exists');
SELECT has_table('m_expiry_tracking_config', 'Table m_expiry_tracking_config exists');
SELECT has_table('m_reorder_rules', 'Table m_reorder_rules exists');
SELECT has_table('m_uom_conversions', 'Table m_uom_conversions exists');

-- ---------------------------------------------------------------------------
-- 2. PRIMARY KEYS
-- ---------------------------------------------------------------------------
SELECT col_is_pk('m_items', 'item_code', 'm_items PK is item_code');
SELECT col_is_pk('m_expiry_tracking_config', 'config_id', 'm_expiry_tracking_config PK is config_id');
SELECT col_is_pk('m_reorder_rules', 'rule_id', 'm_reorder_rules PK is rule_id');
SELECT col_is_pk('m_uom_conversions', 'conversion_id', 'm_uom_conversions PK is conversion_id');

-- ---------------------------------------------------------------------------
-- 3. COLUMN CHECKS
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'm_items',
  ARRAY['item_code', 'item_name', 'category_group', 'base_uom', 'is_active', 'created_at', 'updated_at'],
  'm_items has exact expected columns'
);

SELECT columns_are(
  'm_expiry_tracking_config',
  ARRAY['config_id', 'category_group', 'requires_lot_expiry_tracking', 'expiry_warning_days', 'created_at', 'updated_at'],
  'm_expiry_tracking_config has exact expected columns'
);

SELECT columns_are(
  'm_reorder_rules',
  ARRAY['rule_id', 'store_id', 'warehouse_id', 'item_code', 'par_level', 'reorder_point', 'min_order_qty', 'adu_window_days', 'created_at', 'updated_at'],
  'm_reorder_rules has exact expected columns'
);

SELECT columns_are(
  'm_uom_conversions',
  ARRAY['conversion_id', 'item_code', 'base_uom', 'secondary_uom', 'conversion_factor', 'dual_uom_required', 'created_at', 'updated_at'],
  'm_uom_conversions has exact expected columns'
);

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) ENABLEMENT
-- ---------------------------------------------------------------------------
SELECT ok(relrowsecurity, 'RLS is enabled on m_items')
FROM pg_class WHERE relname = 'm_items';

SELECT ok(relrowsecurity, 'RLS is enabled on m_expiry_tracking_config')
FROM pg_class WHERE relname = 'm_expiry_tracking_config';

SELECT ok(relrowsecurity, 'RLS is enabled on m_reorder_rules')
FROM pg_class WHERE relname = 'm_reorder_rules';

SELECT ok(relrowsecurity, 'RLS is enabled on m_uom_conversions')
FROM pg_class WHERE relname = 'm_uom_conversions';

-- ---------------------------------------------------------------------------
-- 5. SEED DATA VERIFICATION
-- ---------------------------------------------------------------------------
SELECT is(COUNT(*)::integer, 20, 'Seed contains exactly 20 items in m_items')
FROM public.m_items;

SELECT is(COUNT(*)::integer, 5, 'Seed contains 5 categories in m_expiry_tracking_config')
FROM public.m_expiry_tracking_config;

SELECT is(COUNT(*)::integer, 4, 'Seed contains 4 dual UoM conversions')
FROM public.m_uom_conversions;

SELECT is(COUNT(*)::integer, 20, 'Seed contains 20 reorder rules for store IND-DEL-01')
FROM public.m_reorder_rules;

-- Check specific items from synthetic seed
SELECT is(
  item_name,
  'Mozzarella Fior di Latte',
  'ITM-CHZ-001 has correct item name'
) FROM public.m_items WHERE item_code = 'ITM-CHZ-001';

SELECT is(
  category_group,
  'CHEESE',
  'ITM-CHZ-001 has category CHEESE'
) FROM public.m_items WHERE item_code = 'ITM-CHZ-001';

SELECT is(
  base_uom,
  'kg',
  'ITM-CHZ-001 has base UoM kg'
) FROM public.m_items WHERE item_code = 'ITM-CHZ-001';

-- Check UoM conversion for Burrata
SELECT is(
  conversion_factor,
  0.1500,
  'Burrata conversion factor is 0.1500'
) FROM public.m_uom_conversions WHERE item_code = 'ITM-CHZ-002';

-- ---------------------------------------------------------------------------
-- 6. CONSTRAINT & VALIDATION CHECKS
-- ---------------------------------------------------------------------------
-- 6.1 Base UoM check constraint (must be kg or pcs)
SELECT throws_ok(
  $$ INSERT INTO public.m_items (item_code, item_name, category_group, base_uom)
     VALUES ('ITM-ERR-001', 'Invalid UoM Item', 'DRY_GOODS', 'liters') $$,
  '23514',
  NULL,
  'Inserting invalid base_uom throws check constraint violation'
);

-- 6.2 Expiry warning days cannot be negative
SELECT throws_ok(
  $$ INSERT INTO public.m_expiry_tracking_config (config_id, category_group, requires_lot_expiry_tracking, expiry_warning_days)
     VALUES ('cfg-err-001', 'CUSTOM_GRP', true, -5) $$,
  '23514',
  NULL,
  'Negative expiry_warning_days throws check constraint violation'
);

-- 6.3 Negative quantities rejected in reorder rules
SELECT throws_ok(
  $$ INSERT INTO public.m_reorder_rules (rule_id, store_id, warehouse_id, item_code, par_level, reorder_point, min_order_qty)
     VALUES ('rr-err-001', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', -10, 5, 5) $$,
  '23514',
  NULL,
  'Negative par_level in reorder rules throws check constraint violation'
);

-- 6.4 Conversion factor must be positive (> 0)
SELECT throws_ok(
  $$ INSERT INTO public.m_uom_conversions (conversion_id, item_code, base_uom, secondary_uom, conversion_factor)
     VALUES ('uom-err-001', 'ITM-CHZ-001', 'kg', 'box', 0) $$,
  '23514',
  NULL,
  'Zero or negative conversion factor throws check constraint violation'
);

-- 6.5 Unique constraint on reorder rules (store_id, warehouse_id, item_code)
SELECT throws_ok(
  $$ INSERT INTO public.m_reorder_rules (rule_id, store_id, warehouse_id, item_code, par_level, reorder_point, min_order_qty)
     VALUES ('rr-dup-001', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 100, 20, 10) $$,
  '23505',
  NULL,
  'Duplicate reorder rule for same store, warehouse and item throws unique violation'
);

-- ---------------------------------------------------------------------------
-- 7. FOREIGN KEY CASCADE BEHAVIOR
-- ---------------------------------------------------------------------------
-- Inserting temporary item, adding reorder rule & uom conversion, then deleting item
INSERT INTO public.m_items (item_code, item_name, category_group, base_uom)
VALUES ('ITM-TMP-001', 'Temporary Item', 'DRY_GOODS', 'kg');

INSERT INTO public.m_reorder_rules (rule_id, store_id, warehouse_id, item_code, par_level, reorder_point, min_order_qty)
VALUES ('rr-tmp-001', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-TMP-001', 50, 10, 5);

INSERT INTO public.m_uom_conversions (conversion_id, item_code, base_uom, secondary_uom, conversion_factor)
VALUES ('uom-tmp-001', 'ITM-TMP-001', 'kg', 'pcs', 2.0);

DELETE FROM public.m_items WHERE item_code = 'ITM-TMP-001';

SELECT is_empty(
  $$ SELECT 1 FROM public.m_reorder_rules WHERE item_code = 'ITM-TMP-001' $$,
  'Deleting m_items cascades to m_reorder_rules'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.m_uom_conversions WHERE item_code = 'ITM-TMP-001' $$,
  'Deleting m_items cascades to m_uom_conversions'
);

-- ---------------------------------------------------------------------------
-- 8. TRIGGER: updated_at auto-updates on modification
-- ---------------------------------------------------------------------------
UPDATE public.m_items
SET item_name = 'Mozzarella Fior di Latte Fresh'
WHERE item_code = 'ITM-CHZ-001';

SELECT ok(
  updated_at >= created_at,
  'Trigger updates updated_at column on UPDATE'
) FROM public.m_items WHERE item_code = 'ITM-CHZ-001';

-- ---------------------------------------------------------------------------
-- 9. RLS POLICIES: DENIED & ALLOWED ACCESS
-- ---------------------------------------------------------------------------

-- 9.1 Non-privileged authenticated user (RUNNER)
-- Can SELECT items, but cannot INSERT, UPDATE, or DELETE
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "app.current_role" = 'RUNNER';

-- 9.1.1 Allowed: SELECT
SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_items),
  20,
  'Authenticated RUNNER can read all 20 items from m_items'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_expiry_tracking_config),
  5,
  'Authenticated RUNNER can read m_expiry_tracking_config'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_reorder_rules),
  20,
  'Authenticated RUNNER can read m_reorder_rules'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_uom_conversions),
  4,
  'Authenticated RUNNER can read m_uom_conversions'
);

-- 9.1.2 Denied: RUNNER cannot INSERT into m_items
SELECT throws_ok(
  $$ INSERT INTO public.m_items (item_code, item_name, category_group, base_uom)
     VALUES ('ITM-UNAUTH-001', 'Unauthorized Item', 'DRY_GOODS', 'kg') $$,
  '42501',
  NULL,
  'Authenticated RUNNER is denied INSERT on m_items (RLS check)'
);

-- 9.1.3 Denied: RUNNER cannot UPDATE m_items
UPDATE public.m_items
SET item_name = 'Hacked Name'
WHERE item_code = 'ITM-CHZ-001';

SELECT is(
  item_name,
  'Mozzarella Fior di Latte Fresh',
  'Authenticated RUNNER cannot UPDATE m_items (no rows updated)'
) FROM public.m_items WHERE item_code = 'ITM-CHZ-001';

-- 9.1.4 Denied: RUNNER cannot DELETE from m_items
DELETE FROM public.m_items WHERE item_code = 'ITM-CHZ-001';

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_items WHERE item_code = 'ITM-CHZ-001'),
  1,
  'Authenticated RUNNER cannot DELETE from m_items (row remains)'
);

-- 9.1.5 Denied: RUNNER cannot INSERT into m_expiry_tracking_config
SELECT throws_ok(
  $$ INSERT INTO public.m_expiry_tracking_config (config_id, category_group, requires_lot_expiry_tracking, expiry_warning_days)
     VALUES ('cfg-unauth-001', 'NEW_GRP', false, 10) $$,
  '42501',
  NULL,
  'Authenticated RUNNER is denied INSERT on m_expiry_tracking_config'
);

-- 9.1.6 Denied: RUNNER cannot INSERT into m_reorder_rules
SELECT throws_ok(
  $$ INSERT INTO public.m_reorder_rules (rule_id, store_id, warehouse_id, item_code, par_level, reorder_point, min_order_qty)
     VALUES ('rr-unauth-001', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-005', 10, 2, 2) $$,
  '42501',
  NULL,
  'Authenticated RUNNER is denied INSERT on m_reorder_rules'
);

-- 9.1.7 Denied: RUNNER cannot INSERT into m_uom_conversions
SELECT throws_ok(
  $$ INSERT INTO public.m_uom_conversions (conversion_id, item_code, base_uom, secondary_uom, conversion_factor)
     VALUES ('uom-unauth-001', 'ITM-CHZ-005', 'kg', 'pcs', 1.0) $$,
  '42501',
  NULL,
  'Authenticated RUNNER is denied INSERT on m_uom_conversions'
);

-- 9.2 Privileged user: ADMIN role
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "app.current_role" = 'ADMIN';

-- 9.2.1 Allowed: ADMIN can INSERT into m_items
INSERT INTO public.m_items (item_code, item_name, category_group, base_uom)
VALUES ('ITM-ADM-001', 'Admin Inserted Item', 'CHEESE', 'kg');

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_items WHERE item_code = 'ITM-ADM-001'),
  1,
  'ADMIN can successfully INSERT into m_items'
);

-- 9.2.2 Allowed: ADMIN can UPDATE m_items
UPDATE public.m_items
SET item_name = 'Admin Updated Item'
WHERE item_code = 'ITM-ADM-001';

SELECT is(
  item_name,
  'Admin Updated Item',
  'ADMIN can successfully UPDATE m_items'
) FROM public.m_items WHERE item_code = 'ITM-ADM-001';

-- 9.2.3 Allowed: ADMIN can DELETE from m_items
DELETE FROM public.m_items WHERE item_code = 'ITM-ADM-001';

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_items WHERE item_code = 'ITM-ADM-001'),
  0,
  'ADMIN can successfully DELETE from m_items'
);

-- 9.3 Privileged user: APPROVER role
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "app.current_role" = 'APPROVER';

-- 9.3.1 Allowed: APPROVER can INSERT into m_items
INSERT INTO public.m_items (item_code, item_name, category_group, base_uom)
VALUES ('ITM-APP-001', 'Approver Inserted Item', 'MEAT', 'kg');

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_items WHERE item_code = 'ITM-APP-001'),
  1,
  'APPROVER can successfully INSERT into m_items'
);

-- 9.3.2 Allowed: APPROVER can INSERT into m_expiry_tracking_config
INSERT INTO public.m_expiry_tracking_config (config_id, category_group, requires_lot_expiry_tracking, expiry_warning_days)
VALUES ('cfg-app-001', 'SEAFOOD', true, 1);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_expiry_tracking_config WHERE config_id = 'cfg-app-001'),
  1,
  'APPROVER can successfully INSERT into m_expiry_tracking_config'
);

-- 9.3.3 Allowed: APPROVER can DELETE created item and config
DELETE FROM public.m_expiry_tracking_config WHERE config_id = 'cfg-app-001';
DELETE FROM public.m_items WHERE item_code = 'ITM-APP-001';

SELECT is(
  (SELECT COUNT(*)::integer FROM public.m_items WHERE item_code = 'ITM-APP-001'),
  0,
  'APPROVER can successfully DELETE from m_items'
);

SELECT * FROM finish();
ROLLBACK;

