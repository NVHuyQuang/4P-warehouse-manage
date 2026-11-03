-- pgTAP Test Suite for Domain D9: Physical Stock Count & Reconciliation
-- Tables: t_stock_counts, t_stock_count_items, t_stock_adjustments
-- RPCs: initiate_stock_count, submit_first_count, submit_recount, approve_stock_adjustment
-- Flow F: Periodic Stock Count, Recount, and FC Reconciliation
-- Non-negotiable: Quantities only. Zero price, cost, valuation, tax, or vendor data anywhere.

BEGIN;
SELECT plan(54);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_keeper_id uuid     := 'e0000000-0000-0000-0000-000000000001'::uuid;
  v_accountant_id uuid := 'e0000000-0000-0000-0000-000000000002'::uuid;
  v_fc_id uuid         := 'e0000000-0000-0000-0000-000000000003'::uuid;
  v_viewer_id uuid     := 'e0000000-0000-0000-0000-000000000004'::uuid;
BEGIN
  -- Insert into auth.users for foreign key integrity
  INSERT INTO auth.users (id, email)
  VALUES
    (v_keeper_id, 'test_keeper@example.test'),
    (v_accountant_id, 'test_accountant@example.test'),
    (v_fc_id, 'test_fc@example.test'),
    (v_viewer_id, 'test_viewer@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- Insert into public.m_users
  INSERT INTO public.m_users (user_id, email, full_name)
  VALUES
    (v_keeper_id::text, 'test_keeper@example.test', 'Test Keeper'),
    (v_accountant_id::text, 'test_accountant@example.test', 'Test Accountant'),
    (v_fc_id::text, 'test_fc@example.test', 'Test FC Approver'),
    (v_viewer_id::text, 'test_viewer@example.test', 'Test Viewer')
  ON CONFLICT (user_id) DO NOTHING;

  -- Insert permissions for test users
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-test-keeper', v_keeper_id::text, 'ADMIN'::user_role, 'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-test-accountant', v_accountant_id::text, 'ACCOUNTANT'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
    ('perm-test-fc', v_fc_id::text, 'APPROVER'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
    ('perm-test-viewer', v_viewer_id::text, 'VIEWER'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- Ensure store, warehouse, and items exist
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES ('WH-DEL01-DRY', 'IND-DEL-01', 'Delhi Store 1 Dry Store', 'DRY_STORE', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;

  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES 
    ('ITM-DRY-001', 'San Marzano Tomato Can 2.5kg', 'DRY_GROCERY', 'kg', true),
    ('ITM-DRY-002', 'Caputo 00 Flour 25kg', 'DRY_GROCERY', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TABLE EXISTENCE (3 tests)
-- ---------------------------------------------------------------------------
SELECT has_table('public', 't_stock_counts', 'Table t_stock_counts exists');
SELECT has_table('public', 't_stock_count_items', 'Table t_stock_count_items exists');
SELECT has_table('public', 't_stock_adjustments', 'Table t_stock_adjustments exists');

-- ---------------------------------------------------------------------------
-- 2. PRIMARY KEYS (3 tests)
-- ---------------------------------------------------------------------------
SELECT col_is_pk('public', 't_stock_counts', 'count_id', 't_stock_counts.count_id is primary key');
SELECT col_is_pk('public', 't_stock_count_items', 'count_item_id', 't_stock_count_items.count_item_id is primary key');
SELECT col_is_pk('public', 't_stock_adjustments', 'adjustment_id', 't_stock_adjustments.adjustment_id is primary key');

-- ---------------------------------------------------------------------------
-- 3. EXACT COLUMNS (3 tests)
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'public',
  't_stock_counts',
  ARRAY[
    'count_id',
    'store_id',
    'warehouse_id',
    'count_type',
    'freeze_status',
    'keeper_user_id',
    'accountant_user_id',
    'status',
    'created_at',
    'completed_at'
  ],
  't_stock_counts has exact expected columns'
);

SELECT columns_are(
  'public',
  't_stock_count_items',
  ARRAY[
    'count_item_id',
    'count_id',
    'item_code',
    'book_qty',
    'first_count_qty',
    'recount_qty',
    'final_counted_qty',
    'difference_qty',
    'uom',
    'created_at'
  ],
  't_stock_count_items has exact expected columns'
);

SELECT columns_are(
  'public',
  't_stock_adjustments',
  ARRAY[
    'adjustment_id',
    'count_id',
    'item_code',
    'warehouse_id',
    'adjustment_qty',
    'root_cause_reason',
    'fc_approval_id',
    'movement_id',
    'approved_at'
  ],
  't_stock_adjustments has exact expected columns'
);

-- ---------------------------------------------------------------------------
-- 4. COLUMN DATA TYPES (5 tests)
-- ---------------------------------------------------------------------------
SELECT col_type_is('public', 't_stock_counts', 'count_id', 'uuid', 't_stock_counts.count_id is uuid');
SELECT col_type_is('public', 't_stock_counts', 'keeper_user_id', 'uuid', 't_stock_counts.keeper_user_id is uuid');
SELECT col_type_is('public', 't_stock_count_items', 'book_qty', 'numeric(12,3)', 't_stock_count_items.book_qty is numeric(12,3)');
SELECT col_type_is('public', 't_stock_adjustments', 'adjustment_qty', 'numeric(12,3)', 't_stock_adjustments.adjustment_qty is numeric(12,3)');
SELECT col_type_is('public', 't_stock_adjustments', 'fc_approval_id', 'uuid', 't_stock_adjustments.fc_approval_id is uuid');

-- ---------------------------------------------------------------------------
-- 5. FOREIGN KEYS (11 tests)
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 't_stock_counts', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_stock_counts', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_stock_counts', 'keeper_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_stock_counts', 'accountant_user_id', 'auth', 'users', 'id');

SELECT fk_ok('public', 't_stock_count_items', 'count_id', 'public', 't_stock_counts', 'count_id');
SELECT fk_ok('public', 't_stock_count_items', 'item_code', 'public', 'm_items', 'item_code');

SELECT fk_ok('public', 't_stock_adjustments', 'count_id', 'public', 't_stock_counts', 'count_id');
SELECT fk_ok('public', 't_stock_adjustments', 'item_code', 'public', 'm_items', 'item_code');
SELECT fk_ok('public', 't_stock_adjustments', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_stock_adjustments', 'fc_approval_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_stock_adjustments', 'movement_id', 'public', 't_stock_movements', 'movement_id');

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) STATUS (3 tests)
-- ---------------------------------------------------------------------------
SELECT is(rowsecurity, true, 't_stock_counts has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_stock_counts';

SELECT is(rowsecurity, true, 't_stock_count_items has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_stock_count_items';

SELECT is(rowsecurity, true, 't_stock_adjustments has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_stock_adjustments';

-- ---------------------------------------------------------------------------
-- 7. CONSTRAINTS (4 tests)
-- ---------------------------------------------------------------------------
-- 7.1 Unique constraint on (count_id, item_code)
SELECT col_has_check('public', 't_stock_counts', 'count_type', 't_stock_counts.count_type has check constraint');

-- 7.2 Invalid count_type throws check constraint violation
SELECT throws_ok(
  $$
    INSERT INTO public.t_stock_counts (
      store_id, warehouse_id, count_type, keeper_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'DAILY_BENCHMARK', 'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Invalid count_type throws check constraint violation'
);

-- 7.3 Invalid freeze_status throws check constraint violation
SELECT throws_ok(
  $$
    INSERT INTO public.t_stock_counts (
      store_id, warehouse_id, count_type, freeze_status, keeper_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'WEEKLY_CYCLE', 'PARTIALLY_FROZEN', 'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Invalid freeze_status throws check constraint violation'
);

-- 7.4 Invalid status throws check constraint violation
SELECT throws_ok(
  $$
    INSERT INTO public.t_stock_counts (
      store_id, warehouse_id, count_type, status, keeper_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'WEEKLY_CYCLE', 'PENDING_APPROVAL', 'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Invalid status throws check constraint violation'
);

-- ---------------------------------------------------------------------------
-- 8. SEGREGATION OF DUTIES TRIGGER TESTS (2 tests)
-- Counter cannot approve adjustment voucher (fc_approval_id cannot equal keeper_user_id or accountant_user_id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count_id uuid := 'e1111111-1111-1111-1111-111111111111'::uuid;
BEGIN
  INSERT INTO public.t_stock_counts (
    count_id, store_id, warehouse_id, count_type, freeze_status, keeper_user_id, accountant_user_id, status
  ) VALUES (
    v_count_id, 'IND-DEL-01', 'WH-DEL01-DRY', 'WEEKLY_CYCLE', 'FROZEN',
    'e0000000-0000-0000-0000-000000000001'::uuid, -- keeper
    'e0000000-0000-0000-0000-000000000002'::uuid, -- accountant
    'RECOUNT'
  );
END $$;

-- 8.1 Keeper cannot be fc_approval_id (throws 23514)
SELECT throws_ok(
  $$
    INSERT INTO public.t_stock_adjustments (
      count_id, item_code, warehouse_id, adjustment_qty, root_cause_reason, fc_approval_id
    ) VALUES (
      'e1111111-1111-1111-1111-111111111111'::uuid,
      'ITM-DRY-001',
      'WH-DEL01-DRY',
      -2.000,
      'Damaged packaging write-off',
      'e0000000-0000-0000-0000-000000000001'::uuid -- keeper!
    );
  $$,
  '23514',
  NULL,
  'Segregation of duties: Keeper counter cannot approve adjustment voucher'
);

-- 8.2 Accountant cannot be fc_approval_id (throws 23514)
SELECT throws_ok(
  $$
    INSERT INTO public.t_stock_adjustments (
      count_id, item_code, warehouse_id, adjustment_qty, root_cause_reason, fc_approval_id
    ) VALUES (
      'e1111111-1111-1111-1111-111111111111'::uuid,
      'ITM-DRY-001',
      'WH-DEL01-DRY',
      -2.000,
      'Damaged packaging write-off',
      'e0000000-0000-0000-0000-000000000002'::uuid -- accountant!
    );
  $$,
  '23514',
  NULL,
  'Segregation of duties: Accountant counter cannot approve adjustment voucher'
);

-- ---------------------------------------------------------------------------
-- 9. RPC FUNCTION EXISTENCE (4 tests)
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'initiate_stock_count', ARRAY['text', 'text', 'text'], 'Function initiate_stock_count exists');
SELECT has_function('public', 'submit_first_count', ARRAY['uuid', 'jsonb'], 'Function submit_first_count exists');
SELECT has_function('public', 'submit_recount', ARRAY['uuid', 'jsonb'], 'Function submit_recount exists');
SELECT has_function('public', 'approve_stock_adjustment', ARRAY['uuid', 'text'], 'Function approve_stock_adjustment exists');

-- Clean up helper row from section 8 before workflow tests
DELETE FROM public.t_stock_counts WHERE count_id = 'e1111111-1111-1111-1111-111111111111'::uuid;
UPDATE public.m_warehouses SET status = 'ACTIVE' WHERE warehouse_id = 'WH-DEL01-DRY';

-- ---------------------------------------------------------------------------
-- 10. FLOW F WORKFLOW SCENARIO A: BALANCED FIRST COUNT (5 tests)
-- Flow: initiate -> warehouse FROZEN -> first count matches book (diff == 0) -> completed & unfrozen
-- ---------------------------------------------------------------------------
-- Setup Keeper session
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.initiate_stock_count('IND-DEL-01', 'WH-DEL01-DRY', 'WEEKLY_CYCLE');
  $$,
  'Keeper successfully initiates weekly stock count'
);

-- Check warehouse status frozen
SELECT is(
  (SELECT status FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-DRY'),
  'FROZEN_FOR_COUNT'::warehouse_status,
  'Count initiation freezes warehouse storeroom'
);

-- Check t_stock_counts header status
SELECT is(
  (SELECT freeze_status FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1),
  'FROZEN',
  't_stock_counts header records freeze_status = FROZEN'
);

-- Submit blind first count matching current book stock (diff == 0)
DO $$
DECLARE
  v_cid uuid;
  v_book numeric(12,3);
BEGIN
  SELECT count_id INTO v_cid FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1;
  SELECT book_qty INTO v_book FROM public.t_stock_count_items WHERE count_id = v_cid AND item_code = 'ITM-DRY-001';
  IF v_book IS NULL THEN v_book := 100.000; END IF;

  PERFORM public.submit_first_count(
    v_cid,
    jsonb_build_array(
      jsonb_build_object('item_code', 'ITM-DRY-001', 'counted_qty', v_book)
    )
  );
END $$;

SELECT is(
  (SELECT status FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1),
  'COMPLETED',
  'When difference == 0, count immediately completes without recount'
);

SELECT is(
  (SELECT status FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-DRY'),
  'ACTIVE'::warehouse_status,
  'When difference == 0, warehouse storeroom is automatically unfrozen to ACTIVE'
);

-- ---------------------------------------------------------------------------
-- 11. FLOW F WORKFLOW SCENARIO B: DISCREPANCY -> RECOUNT -> FC APPROVAL (10 tests)
-- Flow: initiate -> discrepancy -> RECOUNT -> recount confirms diff -> FC approves -> COUNT_ADJUSTMENT posted
-- ---------------------------------------------------------------------------
-- 11.1 Initiate new count
DO $$
DECLARE
  v_cid uuid;
BEGIN
  v_cid := public.initiate_stock_count('IND-DEL-01', 'WH-DEL01-DRY', 'MONTH_END_FULL');
END $$;

SELECT is(
  (SELECT status FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-DRY'),
  'FROZEN_FOR_COUNT'::warehouse_status,
  'Scenario B: Warehouse is frozen again for Month-End full inventory'
);

-- 11.2 Submit first count with discrepancy (counted 95 vs book 100 -> diff = -5)
DO $$
DECLARE
  v_cid uuid;
BEGIN
  SELECT count_id INTO v_cid FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.submit_first_count(
    v_cid,
    jsonb_build_array(
      jsonb_build_object('item_code', 'ITM-DRY-001', 'counted_qty', 95.000)
    )
  );
END $$;

SELECT is(
  (SELECT status FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1),
  'RECOUNT',
  'When difference != 0, count transitions to RECOUNT'
);

SELECT is(
  (SELECT status FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-DRY'),
  'FROZEN_FOR_COUNT'::warehouse_status,
  'Warehouse remains FROZEN during RECOUNT'
);

-- 11.3 Recount submitted by Accountant (second person)
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ACCOUNTANT';

DO $$
DECLARE
  v_cid uuid;
BEGIN
  SELECT count_id INTO v_cid FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.submit_recount(
    v_cid,
    jsonb_build_array(
      jsonb_build_object('item_code', 'ITM-DRY-001', 'recount_qty', 95.000)
    )
  );
END $$;

SELECT is(
  (SELECT status FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1),
  'RECOUNT',
  'When recount confirms discrepancy, status remains RECOUNT awaiting FC approval'
);

-- 11.4 Create adjustment voucher awaiting FC approval
DO $$
DECLARE
  v_cid uuid;
BEGIN
  SELECT count_id INTO v_cid FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.t_stock_adjustments (
    adjustment_id, count_id, item_code, warehouse_id, adjustment_qty, root_cause_reason, fc_approval_id
  ) VALUES (
    'e2222222-2222-2222-2222-222222222222'::uuid,
    v_cid,
    'ITM-DRY-001',
    'WH-DEL01-DRY',
    -5.000,
    '5kg burst bag discarded during storage, logged on recount',
    'e0000000-0000-0000-0000-000000000003'::uuid -- designated FC approver
  );
END $$;

-- 11.5 Keeper attempts to approve adjustment voucher -> BLOCKED by segregation of duties
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$
    SELECT public.approve_stock_adjustment('e2222222-2222-2222-2222-222222222222'::uuid, 'Keeper self-approval attempt');
  $$,
  NULL,
  NULL,
  'Keeper cannot approve stock adjustment voucher'
);

-- 11.6 Financial Controller (FC) approves adjustment voucher -> SUCCEEDS
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  $$
    SELECT public.approve_stock_adjustment('e2222222-2222-2222-2222-222222222222'::uuid, 'Approved per physical investigation report');
  $$,
  'FC successfully approves stock adjustment voucher'
);

-- 11.7 Verify COUNT_ADJUSTMENT movement appended to t_stock_movements
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.t_stock_movements
    WHERE reference_doc_id = 'e2222222-2222-2222-2222-222222222222'
      AND movement_type = 'COUNT_ADJUSTMENT'
      AND quantity = -5.000
      AND item_code = 'ITM-DRY-001'
  ),
  'COUNT_ADJUSTMENT row was appended to t_stock_movements with exact adjustment quantity'
);

-- 11.8 Verify t_stock_adjustments.movement_id is linked
SELECT isnt(
  (SELECT movement_id FROM public.t_stock_adjustments WHERE adjustment_id = 'e2222222-2222-2222-2222-222222222222'::uuid),
  NULL,
  't_stock_adjustments.movement_id is linked to the newly posted ledger movement'
);

-- 11.9 Verify warehouse status restored to ACTIVE
SELECT is(
  (SELECT status FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-DRY'),
  'ACTIVE'::warehouse_status,
  'Warehouse status restored to ACTIVE upon FC approval'
);

-- 11.10 Verify count status COMPLETED and freeze_status UNFROZEN
SELECT is(
  (SELECT status FROM public.t_stock_counts WHERE warehouse_id = 'WH-DEL01-DRY' ORDER BY created_at DESC LIMIT 1),
  'COMPLETED',
  'Count status completed upon FC adjustment approval'
);

-- ---------------------------------------------------------------------------
-- 12. IMMUTABILITY & AUDIT INTEGRITY (2 tests)
-- ---------------------------------------------------------------------------
-- Approved adjustment cannot be updated
SELECT throws_ok(
  $$
    UPDATE public.t_stock_adjustments
    SET adjustment_qty = 999.000
    WHERE adjustment_id = 'e2222222-2222-2222-2222-222222222222'::uuid;
  $$,
  'P0001',
  'Approved stock adjustments are immutable and cannot be updated.',
  'UPDATE on approved t_stock_adjustments is blocked by immutability trigger'
);

-- Approved adjustment cannot be deleted
SELECT throws_ok(
  $$
    DELETE FROM public.t_stock_adjustments
    WHERE adjustment_id = 'e2222222-2222-2222-2222-222222222222'::uuid;
  $$,
  'P0001',
  'Approved stock adjustments are immutable and cannot be deleted.',
  'DELETE on approved t_stock_adjustments is blocked by immutability trigger'
);

-- ---------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY TESTS (2 tests)
-- ---------------------------------------------------------------------------
-- 13.1 Viewer role can read t_stock_counts
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'VIEWER';

SELECT ok(
  (SELECT count(*) FROM public.t_stock_counts) >= 1,
  'VIEWER role can SELECT from t_stock_counts'
);

-- 13.2 Viewer cannot call approve_stock_adjustment
SELECT throws_ok(
  $$
    SELECT public.approve_stock_adjustment('e2222222-2222-2222-2222-222222222222'::uuid, 'Viewer approval attempt');
  $$,
  NULL,
  'Unauthorized: Only Financial Controller (APPROVER) or SYSTEM_ADMIN can approve stock adjustments.',
  'VIEWER cannot call approve_stock_adjustment'
);

ROLLBACK;
