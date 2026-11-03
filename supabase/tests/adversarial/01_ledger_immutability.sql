-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- pgTAP Test Suite: D14 Adversarial RLS & Attack Suite - Part 1: Ledger Immutability
-- Scope: Direct UPDATE/DELETE denial, TRUNCATE/DROP prevention, Derived view immutability

BEGIN;
SELECT plan(33);

-- ============================================================================
-- 0. TEST FIXTURES SETUP
-- ============================================================================
DO $$
DECLARE
  v_test_user uuid := 'a1000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- Insert test user in auth.users
  INSERT INTO auth.users (id, email)
  VALUES (v_test_user, 'ledger_adversary@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- Insert test user in public.m_users
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES (v_test_user::text, 'ledger_adversary@example.test', 'Ledger Adversary Test User', true)
  ON CONFLICT (user_id) DO NOTHING;

  -- Ensure test store exists
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  -- Ensure test warehouse exists
  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES ('WH-DEL01-DRY', 'IND-DEL-01', 'Delhi Store 1 Dry Store', 'DRY_STORE', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;

  -- Ensure test item exists
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES ('ITM-ADV-001', 'Adversarial Test Flour', 'DRY_GOODS', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- Seed initial ledger movement
  INSERT INTO public.t_stock_movements (
    movement_id, store_id, warehouse_id, item_code, movement_type,
    quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
  ) VALUES (
    'm1000000-0000-0000-0000-000000000001'::uuid,
    'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-ADV-001', 'GRPO_IMPORT',
    100.000, 'kg', 'BAT-ADV-001', CURRENT_DATE + 45, 'REF-ADV-INIT', v_test_user::text
  ) ON CONFLICT (movement_id) DO NOTHING;
END $$;

-- ============================================================================
-- 1. IMMUTABILITY ARCHITECTURE & PRECONDITIONS
-- ============================================================================
SELECT has_table('public', 't_stock_movements', 'Table t_stock_movements exists in public schema');
SELECT has_function('public', 'tg_prevent_ledger_mutation', ARRAY[]::text[], 'Trigger function tg_prevent_ledger_mutation exists');
SELECT has_trigger('public', 't_stock_movements', 'trg_prevent_ledger_mutation', 'Trigger trg_prevent_ledger_mutation attached to t_stock_movements');

SELECT ok(
  relrowsecurity,
  'RLS is enabled on t_stock_movements'
) FROM pg_class WHERE relname = 't_stock_movements';

SELECT has_view('public', 'v_stock_current', 'Derived stock view v_stock_current exists');
SELECT has_view('public', 'v_stock_lots_fifo', 'Derived stock view v_stock_lots_fifo exists');

-- ============================================================================
-- 2. DIRECT UPDATE ATTACK VECTORS ON t_stock_movements
-- ============================================================================
-- Attack 2.1: Tampering with physical quantity
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET quantity = 500.000 WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on quantity is blocked by append-only trigger'
);

-- Attack 2.2: Tampering with item code
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET item_code = 'ITM-ADV-TAMPER' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on item_code is blocked by append-only trigger'
);

-- Attack 2.3: Tampering with store_id
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET store_id = 'IND-DEL-02' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on store_id is blocked by append-only trigger'
);

-- Attack 2.4: Tampering with warehouse_id
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET warehouse_id = 'WH-DEL01-COLD' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on warehouse_id is blocked by append-only trigger'
);

-- Attack 2.5: Tampering with movement_type
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET movement_type = 'WASTE_DISPOSAL' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on movement_type is blocked by append-only trigger'
);

-- Attack 2.6: Tampering with batch_number
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET batch_number = 'BAT-ADV-TAMPER' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on batch_number is blocked by append-only trigger'
);

-- Attack 2.7: Tampering with expiry_date
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET expiry_date = CURRENT_DATE + 365 WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on expiry_date is blocked by append-only trigger'
);

-- Attack 2.8: Tampering with reference_doc_id
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET reference_doc_id = 'TAMPERED-DOC' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on reference_doc_id is blocked by append-only trigger'
);

-- Attack 2.9: Tampering with created_by_user_id
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET created_by_user_id = 'usr-admin-01' WHERE item_code = 'ITM-ADV-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Adversarial UPDATE on created_by_user_id is blocked by append-only trigger'
);

-- Attack 2.10: Authenticated role attempting UPDATE
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET quantity = 999.000 WHERE item_code = 'ITM-ADV-001' $$,
  NULL,
  NULL,
  'Authenticated role direct UPDATE is blocked by privilege revocation or trigger'
);
RESET ROLE;

-- ============================================================================
-- 3. DIRECT DELETE ATTACK VECTORS ON t_stock_movements
-- ============================================================================
-- Attack 3.1: Targeted DELETE on single movement
SELECT throws_ok(
  $$ DELETE FROM public.t_stock_movements WHERE movement_id = 'm1000000-0000-0000-0000-000000000001'::uuid $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Targeted direct DELETE on t_stock_movements is blocked by append-only trigger'
);

-- Attack 3.2: Bulk DELETE attempting to erase ledger history
SELECT throws_ok(
  $$ DELETE FROM public.t_stock_movements $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Bulk DELETE on t_stock_movements is blocked by append-only trigger'
);

-- Attack 3.3: Authenticated role attempting DELETE
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ DELETE FROM public.t_stock_movements WHERE item_code = 'ITM-ADV-001' $$,
  NULL,
  NULL,
  'Authenticated role direct DELETE is blocked by privilege revocation or trigger'
);
RESET ROLE;

-- ============================================================================
-- 4. TRUNCATE & DROP BYPASS ATTACK VECTORS
-- ============================================================================
-- Attack 4.1: Authenticated role attempting TRUNCATE
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ TRUNCATE TABLE public.t_stock_movements $$,
  '42501',
  NULL,
  'TRUNCATE by authenticated role is denied with permission denied (42501)'
);
RESET ROLE;

-- Attack 4.2: Superuser TRUNCATE without CASCADE fails due to foreign keys
SELECT throws_ok(
  $$ TRUNCATE TABLE public.t_stock_movements $$,
  '0A000',
  NULL,
  'TRUNCATE on t_stock_movements is blocked by foreign key constraints referencing movement_id'
);

-- Attack 4.3: Authenticated role attempting DROP TABLE
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ DROP TABLE public.t_stock_movements $$,
  '42501',
  NULL,
  'DROP TABLE by authenticated role is denied with permission denied (42501)'
);

-- Attack 4.4: Authenticated role attempting DROP TABLE CASCADE
SELECT throws_ok(
  $$ DROP TABLE public.t_stock_movements CASCADE $$,
  '42501',
  NULL,
  'DROP TABLE CASCADE by authenticated role is denied with permission denied (42501)'
);
RESET ROLE;

-- ============================================================================
-- 5. DERIVED STOCK VIEWS DIRECT MUTATION ATTACK VECTORS
-- ============================================================================
-- Attack 5.1: Direct UPDATE on v_stock_current
SELECT throws_ok(
  $$ UPDATE public.v_stock_current SET book_stock = 999.000 WHERE item_code = 'ITM-ADV-001' $$,
  '55000',
  NULL,
  'Direct UPDATE on v_stock_current throws 55000 (view containing GROUP BY is not updatable)'
);

-- Attack 5.2: Direct INSERT into v_stock_current
SELECT throws_ok(
  $$ INSERT INTO public.v_stock_current (store_id, warehouse_id, item_code, book_stock)
     VALUES ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-ADV-001', 500.000) $$,
  '55000',
  NULL,
  'Direct INSERT into v_stock_current throws 55000 (view not updatable)'
);

-- Attack 5.3: Direct DELETE from v_stock_current
SELECT throws_ok(
  $$ DELETE FROM public.v_stock_current WHERE item_code = 'ITM-ADV-001' $$,
  '55000',
  NULL,
  'Direct DELETE from v_stock_current throws 55000 (view not updatable)'
);

-- Attack 5.4: Direct UPDATE on v_stock_lots_fifo
SELECT throws_ok(
  $$ UPDATE public.v_stock_lots_fifo SET quantity = 999.000 WHERE item_code = 'ITM-ADV-001' $$,
  '55000',
  NULL,
  'Direct UPDATE on v_stock_lots_fifo throws 55000 (view containing GROUP BY is not updatable)'
);

-- Attack 5.5: Direct INSERT into v_stock_lots_fifo
SELECT throws_ok(
  $$ INSERT INTO public.v_stock_lots_fifo (store_id, warehouse_id, item_code, quantity)
     VALUES ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-ADV-001', 50.000) $$,
  '55000',
  NULL,
  'Direct INSERT into v_stock_lots_fifo throws 55000 (view not updatable)'
);

-- Attack 5.6: Direct DELETE from v_stock_lots_fifo
SELECT throws_ok(
  $$ DELETE FROM public.v_stock_lots_fifo WHERE item_code = 'ITM-ADV-001' $$,
  '55000',
  NULL,
  'Direct DELETE from v_stock_lots_fifo throws 55000 (view not updatable)'
);

-- Attack 5.7: Direct UPDATE on v_expiry_radar
SELECT throws_ok(
  $$ UPDATE public.v_expiry_radar SET days_to_expiry = 999 WHERE item_code = 'ITM-ADV-001' $$,
  '55000',
  NULL,
  'Direct UPDATE on v_expiry_radar throws 55000 (view not updatable)'
);

-- ============================================================================
-- 6. LEGITIMATE APPEND-ONLY DYNAMICS VERIFICATION
-- ============================================================================
-- Legitimate append-only operation succeeds
SELECT lives_ok(
  $$ INSERT INTO public.t_stock_movements (
       store_id, warehouse_id, item_code, movement_type,
       quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
     ) VALUES (
       'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-ADV-001', 'ISSUE_PENDING',
       -10.000, 'kg', 'BAT-ADV-001', CURRENT_DATE + 45, 'REF-ADV-STAGE', 'a1000000-0000-0000-0000-000000000001'
     ) $$,
  'Legitimate append-only INSERT into t_stock_movements succeeds'
);

-- Derived view reflects calculation without mutating historical rows
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-ADV-001' AND warehouse_id = 'WH-DEL01-DRY'),
  90.000,
  'Derived stock in v_stock_current updates correctly (100 - 10 = 90 kg) via append-only delta'
);

-- Verify historical movement remains untouched
SELECT is(
  (SELECT quantity FROM public.t_stock_movements WHERE movement_id = 'm1000000-0000-0000-0000-000000000001'::uuid),
  100.000,
  'Historical ledger movement remains exactly 100 kg, proving immutability'
);

SELECT * FROM finish();
ROLLBACK;
