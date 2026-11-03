-- pgTAP Test Suite for Domain D8: Daily Benchmark Balance, Reconciliation & Sign-Off
-- Tables: t_daily_balances, t_daily_balance_items
-- View: v_daily_balance_escalations
-- RPCs: submit_daily_balance, sign_off_daily_balance
-- Non-negotiable: Quantities only. Zero financial, valuation, or commercial data.

BEGIN;
SELECT plan(66);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_custodian_id  uuid := 'c0000000-0000-0000-0000-000000000001'::uuid;
  v_rm_id         uuid := 'c0000000-0000-0000-0000-000000000002'::uuid;
  v_admin_id      uuid := 'c0000000-0000-0000-0000-000000000003'::uuid;
  v_runner_id     uuid := 'c0000000-0000-0000-0000-000000000004'::uuid;
  v_accountant_id uuid := 'c0000000-0000-0000-0000-000000000005'::uuid;
  v_approver_id   uuid := 'c0000000-0000-0000-0000-000000000006'::uuid;
  v_viewer_id     uuid := 'c0000000-0000-0000-0000-000000000007'::uuid;
BEGIN
  -- 1. Insert test users in auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_custodian_id,  'custodian_d8@example.test'),
    (v_rm_id,         'rm_d8@example.test'),
    (v_admin_id,      'admin_d8@example.test'),
    (v_runner_id,     'runner_d8@example.test'),
    (v_accountant_id, 'accountant_d8@example.test'),
    (v_approver_id,   'approver_d8@example.test'),
    (v_viewer_id,     'viewer_d8@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Ensure stores exist
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES
    ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true),
    ('IND-DEL-02', 'Delhi Store 2', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  -- 3. Ensure warehouses exist
  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES
    ('WH-DEL01-COLD', 'IND-DEL-01', 'Delhi 1 Cold Room', 'COLD_ROOM', 'ACTIVE', true),
    ('WH-DEL01-DRY',  'IND-DEL-01', 'Delhi 1 Dry Store', 'DRY_STORE', 'ACTIVE', true),
    ('WH-DEL02-COLD', 'IND-DEL-02', 'Delhi 2 Cold Room', 'COLD_ROOM', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;

  -- 4. Seed benchmark items in m_items
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES
    ('ITEM-MOZZ-01', 'Mozzarella Cheese', 'DAIRY', 'kg', true),
    ('ITEM-FLOUR-01', 'Caputo Flour', 'DRY_GOODS', 'kg', true),
    ('ITEM-TOM-01', 'San Marzano Tomato', 'PRODUCE', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TABLE & VIEW EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_table('public', 't_daily_balances', 'Table t_daily_balances exists');
SELECT has_table('public', 't_daily_balance_items', 'Table t_daily_balance_items exists');
SELECT has_view('public', 'v_daily_balance_escalations', 'View v_daily_balance_escalations exists');

-- ---------------------------------------------------------------------------
-- 2. PRIMARY KEYS
-- ---------------------------------------------------------------------------
SELECT col_is_pk('public', 't_daily_balances', 'balance_id', 't_daily_balances.balance_id is primary key');
SELECT col_is_pk('public', 't_daily_balance_items', 'balance_item_id', 't_daily_balance_items.balance_item_id is primary key');

-- ---------------------------------------------------------------------------
-- 3. EXACT COLUMNS
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'public',
  't_daily_balances',
  ARRAY[
    'balance_id',
    'store_id',
    'warehouse_id',
    'balance_date',
    'custodian_user_id',
    'status',
    'is_unexplained',
    'finance_lead_signoff_id',
    'signoff_notes',
    'signed_off_at',
    'created_at'
  ],
  't_daily_balances has exact expected columns'
);

SELECT columns_are(
  'public',
  't_daily_balance_items',
  ARRAY[
    'balance_item_id',
    'balance_id',
    'item_code',
    'opening_qty',
    'received_qty',
    'issued_qty',
    'expected_qty',
    'counted_qty',
    'variance_qty',
    'variance_reason',
    'responsible_person',
    'created_at'
  ],
  't_daily_balance_items has exact expected columns'
);

-- ---------------------------------------------------------------------------
-- 4. COLUMN DATA TYPES
-- ---------------------------------------------------------------------------
SELECT col_type_is('public', 't_daily_balances', 'balance_id', 'uuid', 't_daily_balances.balance_id is uuid');
SELECT col_type_is('public', 't_daily_balances', 'store_id', 'text', 't_daily_balances.store_id is text');
SELECT col_type_is('public', 't_daily_balances', 'warehouse_id', 'text', 't_daily_balances.warehouse_id is text');
SELECT col_type_is('public', 't_daily_balances', 'balance_date', 'date', 't_daily_balances.balance_date is date');
SELECT col_type_is('public', 't_daily_balances', 'custodian_user_id', 'uuid', 't_daily_balances.custodian_user_id is uuid');
SELECT col_type_is('public', 't_daily_balances', 'status', 'text', 't_daily_balances.status is text');
SELECT col_type_is('public', 't_daily_balances', 'is_unexplained', 'boolean', 't_daily_balances.is_unexplained is boolean');
SELECT col_type_is('public', 't_daily_balances', 'finance_lead_signoff_id', 'uuid', 't_daily_balances.finance_lead_signoff_id is uuid');
SELECT col_type_is('public', 't_daily_balances', 'signed_off_at', 'timestamp with time zone', 't_daily_balances.signed_off_at is timestamptz');

SELECT col_type_is('public', 't_daily_balance_items', 'balance_item_id', 'uuid', 't_daily_balance_items.balance_item_id is uuid');
SELECT col_type_is('public', 't_daily_balance_items', 'opening_qty', 'numeric(12,3)', 't_daily_balance_items.opening_qty is numeric(12,3)');
SELECT col_type_is('public', 't_daily_balance_items', 'received_qty', 'numeric(12,3)', 't_daily_balance_items.received_qty is numeric(12,3)');
SELECT col_type_is('public', 't_daily_balance_items', 'issued_qty', 'numeric(12,3)', 't_daily_balance_items.issued_qty is numeric(12,3)');
SELECT col_type_is('public', 't_daily_balance_items', 'expected_qty', 'numeric(12,3)', 't_daily_balance_items.expected_qty is numeric(12,3)');
SELECT col_type_is('public', 't_daily_balance_items', 'variance_qty', 'numeric(12,3)', 't_daily_balance_items.variance_qty is numeric(12,3)');

-- ---------------------------------------------------------------------------
-- 5. FOREIGN KEYS
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 't_daily_balances', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_daily_balances', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_daily_balances', 'custodian_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_daily_balances', 'finance_lead_signoff_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_daily_balance_items', 'balance_id', 'public', 't_daily_balances', 'balance_id');
SELECT fk_ok('public', 't_daily_balance_items', 'item_code', 'public', 'm_items', 'item_code');

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) STATUS
-- ---------------------------------------------------------------------------
SELECT is(rowsecurity, true, 't_daily_balances has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_daily_balances';

SELECT is(rowsecurity, true, 't_daily_balance_items has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_daily_balance_items';

-- ---------------------------------------------------------------------------
-- 7. MATHEMATICAL & SCHEMA CONSTRAINTS
-- ---------------------------------------------------------------------------
-- Seed reference balance row for constraint tests
INSERT INTO public.t_daily_balances (
  balance_id, store_id, warehouse_id, balance_date, custodian_user_id, status
) VALUES (
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'IND-DEL-01',
  'WH-DEL01-COLD',
  '2025-01-01'::date,
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'BALANCED'
);

-- 7.1 chk_expected_qty: blocks expected_qty != opening_qty + received_qty - issued_qty
SELECT throws_ok(
  $$
    INSERT INTO public.t_daily_balance_items (
      balance_id, item_code, opening_qty, received_qty, issued_qty, expected_qty, counted_qty, variance_qty
    ) VALUES (
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'ITEM-MOZZ-01',
      10.0, 5.0, 2.0, 99.0, -- mathematical error (expected 13.0)
      13.0, 0.0
    );
  $$,
  '23514',
  NULL,
  'chk_expected_qty blocks incorrect expected_qty calculation'
);

-- 7.2 chk_variance_qty: blocks variance_qty != counted_qty - expected_qty
SELECT throws_ok(
  $$
    INSERT INTO public.t_daily_balance_items (
      balance_id, item_code, opening_qty, received_qty, issued_qty, expected_qty, counted_qty, variance_qty
    ) VALUES (
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'ITEM-MOZZ-01',
      10.0, 5.0, 2.0, 13.0,
      15.0, 99.0 -- mathematical error (expected 2.0)
    );
  $$,
  '23514',
  NULL,
  'chk_variance_qty blocks incorrect variance_qty calculation'
);

-- Insert valid line item
INSERT INTO public.t_daily_balance_items (
  balance_id, item_code, opening_qty, received_qty, issued_qty, expected_qty, counted_qty, variance_qty
) VALUES (
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'ITEM-MOZZ-01',
  10.0, 5.0, 2.0, 13.0,
  13.0, 0.0
);

-- 7.3 uq_balance_item: blocks duplicate item within same balance
SELECT throws_ok(
  $$
    INSERT INTO public.t_daily_balance_items (
      balance_id, item_code, opening_qty, received_qty, issued_qty, expected_qty, counted_qty, variance_qty
    ) VALUES (
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'ITEM-MOZZ-01',
      10.0, 5.0, 2.0, 13.0,
      13.0, 0.0
    );
  $$,
  '23505',
  NULL,
  'uq_balance_item blocks duplicate item in same daily balance'
);

-- 7.4 uq_daily_balance_store_wh_date: blocks duplicate daily balance for same store, wh, date
SELECT throws_ok(
  $$
    INSERT INTO public.t_daily_balances (
      balance_id, store_id, warehouse_id, balance_date, custodian_user_id, status
    ) VALUES (
      'b0000000-0000-0000-0000-000000000002'::uuid,
      'IND-DEL-01',
      'WH-DEL01-COLD',
      '2025-01-01'::date,
      'c0000000-0000-0000-0000-000000000001'::uuid,
      'BALANCED'
    );
  $$,
  '23505',
  NULL,
  'uq_daily_balance_store_wh_date blocks duplicate daily balance for same store, warehouse, and date'
);

-- 7.5 Status check constraint: rejects unlisted status
SELECT throws_ok(
  $$
    INSERT INTO public.t_daily_balances (
      store_id, warehouse_id, balance_date, custodian_user_id, status
    ) VALUES (
      'IND-DEL-01',
      'WH-DEL01-COLD',
      '2025-01-02'::date,
      'c0000000-0000-0000-0000-000000000001'::uuid,
      'PENDING_APPROVAL'
    );
  $$,
  '23514',
  NULL,
  'status check constraint rejects invalid status'
);

-- ---------------------------------------------------------------------------
-- 8. IMMUTABILITY TRIGGERS
-- ---------------------------------------------------------------------------
-- 8.1 Prevent UPDATE on t_daily_balance_items
SELECT throws_ok(
  $$
    UPDATE public.t_daily_balance_items
    SET counted_qty = 99.0
    WHERE balance_id = 'b0000000-0000-0000-0000-000000000001'::uuid;
  $$,
  'P0001',
  'Daily balance items are append-only and cannot be updated or deleted.',
  'Trigger blocks UPDATE on t_daily_balance_items'
);

-- 8.2 Prevent DELETE on t_daily_balance_items
SELECT throws_ok(
  $$
    DELETE FROM public.t_daily_balance_items
    WHERE balance_id = 'b0000000-0000-0000-0000-000000000001'::uuid;
  $$,
  'P0001',
  'Daily balance items are append-only and cannot be updated or deleted.',
  'Trigger blocks DELETE on t_daily_balance_items'
);

-- 8.3 Prevent DELETE on t_daily_balances
SELECT throws_ok(
  $$
    DELETE FROM public.t_daily_balances
    WHERE balance_id = 'b0000000-0000-0000-0000-000000000001'::uuid;
  $$,
  'P0001',
  'Daily balances cannot be deleted.',
  'Trigger blocks DELETE on t_daily_balances'
);

-- ---------------------------------------------------------------------------
-- 9. RPC: submit_daily_balance
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _test_ids (key text PRIMARY KEY, val uuid);

-- Configure Custodian context
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 9.1 Submit balanced benchmark balance (WH-DEL01-COLD)
INSERT INTO _test_ids (key, val)
SELECT 'bal_balanced', public.submit_daily_balance(
  'IND-DEL-01',
  'WH-DEL01-COLD',
  jsonb_build_array(
    jsonb_build_object(
      'item_code', 'ITEM-MOZZ-01',
      'opening_qty', 10.0,
      'received_qty', 5.0,
      'issued_qty', 2.0,
      'counted_qty', 13.0
    ),
    jsonb_build_object(
      'item_code', 'ITEM-FLOUR-01',
      'opening_qty', 20.0,
      'received_qty', 0.0,
      'issued_qty', 5.0,
      'counted_qty', 15.0
    )
  )
);

SELECT is(
  (SELECT status FROM public.t_daily_balances WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_balanced')),
  'BALANCED',
  'submit_daily_balance with matching counts produces BALANCED status'
);

SELECT is(
  (SELECT is_unexplained FROM public.t_daily_balances WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_balanced')),
  false,
  'submit_daily_balance with matching counts has is_unexplained = false'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balance_items WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_balanced') AND variance_qty = 0),
  2,
  'All line items in balanced submission have variance_qty = 0'
);

-- 9.2 Submit variance benchmark balance (WH-DEL01-DRY)
INSERT INTO _test_ids (key, val)
SELECT 'bal_variance', public.submit_daily_balance(
  'IND-DEL-01',
  'WH-DEL01-DRY',
  jsonb_build_array(
    jsonb_build_object(
      'item_code', 'ITEM-FLOUR-01',
      'opening_qty', 50.0,
      'received_qty', 10.0,
      'issued_qty', 5.0,
      'counted_qty', 52.0,
      'variance_reason', 'Spill observed during morning prep',
      'responsible_person', 'Prep Team'
    )
  )
);

SELECT is(
  (SELECT status FROM public.t_daily_balances WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_variance')),
  'VARIANCE_FLAGGED',
  'submit_daily_balance with count mismatch produces VARIANCE_FLAGGED status'
);

SELECT is(
  (SELECT variance_qty FROM public.t_daily_balance_items WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_variance')),
  -3.000,
  'Line item records correct negative variance_qty (-3.000)'
);

-- 9.3 Submit unexplained variance balance (IND-DEL-02, WH-DEL02-COLD)
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

INSERT INTO _test_ids (key, val)
SELECT 'bal_unexplained', public.submit_daily_balance(
  'IND-DEL-02',
  'WH-DEL02-COLD',
  jsonb_build_array(
    jsonb_build_object(
      'item_code', 'ITEM-TOM-01',
      'opening_qty', 30.0,
      'received_qty', 10.0,
      'issued_qty', 0.0,
      'counted_qty', 38.0,
      'variance_reason', 'Evening close difference; FL not on duty'
    )
  ),
  true -- p_is_unexplained = true
);

SELECT is(
  (SELECT is_unexplained FROM public.t_daily_balances WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_unexplained')),
  true,
  'submit_daily_balance with is_unexplained=true sets is_unexplained=true'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.v_daily_balance_escalations WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_unexplained')),
  'v_daily_balance_escalations includes the unexplained variance record for morning digest'
);

SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 9.4 Denied: Runner cannot submit daily balance
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000004';

SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-01', 'WH-DEL01-COLD',
      jsonb_build_array(jsonb_build_object('item_code', 'ITEM-MOZZ-01', 'opening_qty', 10.0, 'counted_qty', 10.0))
    );
  $$,
  'P0001',
  'Unauthorized: Only Keeper or Custodian can submit daily balance.',
  'Runner cannot submit daily balance'
);

-- 9.5 Denied: Store scope mismatch
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-02', 'WH-DEL02-COLD',
      jsonb_build_array(jsonb_build_object('item_code', 'ITEM-MOZZ-01', 'opening_qty', 10.0, 'counted_qty', 10.0))
    );
  $$,
  'P0001',
  NULL,
  'Store scope mismatch rejected by submit_daily_balance'
);

-- 9.6 Denied: Non-existent warehouse
SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-01', 'WH-NONEXISTENT',
      jsonb_build_array(jsonb_build_object('item_code', 'ITEM-MOZZ-01', 'opening_qty', 10.0, 'counted_qty', 10.0))
    );
  $$,
  'P0001',
  NULL,
  'Non-existent warehouse rejected by submit_daily_balance'
);

-- 9.7 Denied: Non-existent item code
SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-01', 'WH-DEL01-COLD',
      jsonb_build_array(jsonb_build_object('item_code', 'NON-EXISTENT-ITEM', 'opening_qty', 10.0, 'counted_qty', 10.0))
    );
  $$,
  'P0001',
  NULL,
  'Non-existent item code rejected by submit_daily_balance'
);

-- 9.8 Denied: Negative stock quantity
SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-01', 'WH-DEL01-COLD',
      jsonb_build_array(jsonb_build_object('item_code', 'ITEM-MOZZ-01', 'opening_qty', -5.0, 'counted_qty', 10.0))
    );
  $$,
  'P0001',
  NULL,
  'Negative stock quantity rejected by submit_daily_balance'
);

-- 9.9 Denied: Expected qty mismatch in payload
SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-01', 'WH-DEL01-COLD',
      jsonb_build_array(jsonb_build_object('item_code', 'ITEM-MOZZ-01', 'opening_qty', 10.0, 'received_qty', 5.0, 'issued_qty', 2.0, 'expected_qty', 99.0, 'counted_qty', 13.0))
    );
  $$,
  'P0001',
  NULL,
  'Expected qty mismatch rejected by submit_daily_balance'
);

-- 9.10 Denied: Empty items array
SELECT throws_ok(
  $$
    SELECT public.submit_daily_balance(
      'IND-DEL-01', 'WH-DEL01-COLD',
      '[]'::jsonb
    );
  $$,
  'P0001',
  'Daily balance items payload must be a non-empty JSON array.',
  'Empty items payload rejected by submit_daily_balance'
);

-- ---------------------------------------------------------------------------
-- 10. RPC: sign_off_daily_balance
-- ---------------------------------------------------------------------------
-- Configure RM context
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 10.1 RM signs off balanced daily balance
SELECT lives_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_balanced'),
      'Confirmed balanced count by RM'
    );
  $$,
  'RM can sign off a balanced daily balance'
);

SELECT ok(
  (SELECT finance_lead_signoff_id = 'c0000000-0000-0000-0000-000000000002'::uuid AND signed_off_at IS NOT NULL
   FROM public.t_daily_balances WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_balanced')),
  'sign_off_daily_balance updates finance_lead_signoff_id and signed_off_at'
);

-- 10.2 RM signs off variance daily balance (where RM != Custodian)
SELECT lives_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_variance'),
      'Investigated prep spill; replacement planned'
    );
  $$,
  'RM can sign off variance daily balance when different from custodian'
);

-- 10.3 Segregation violation: Custodian who submitted variance CANNOT sign off own variance balance
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001'; -- the custodian who submitted
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_unexplained'),
      'Self-signoff attempt'
    );
  $$,
  'P0001',
  'Segregation violation: Sign-off user cannot be the same as custodian when variance exists.',
  'Segregation check blocks custodian from signing off own variance balance'
);

-- 10.4 Double sign-off blocked
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_balanced'),
      'Duplicate signoff attempt'
    );
  $$,
  'P0001',
  NULL,
  'Double sign-off is blocked for already signed daily balance'
);

-- 10.5 Denied: Custodian cannot call sign_off_daily_balance
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_unexplained'),
      'Custodian attempt'
    );
  $$,
  'P0001',
  'Unauthorized: Only Finance Lead or Restaurant Manager can sign off daily balance.',
  'Custodian cannot call sign_off_daily_balance'
);

-- 10.6 Denied: Runner cannot call sign_off_daily_balance
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_unexplained'),
      'Runner attempt'
    );
  $$,
  'P0001',
  'Unauthorized: Only Finance Lead or Restaurant Manager can sign off daily balance.',
  'Runner cannot call sign_off_daily_balance'
);

-- 10.7 Denied: Store scope mismatch
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.sign_off_daily_balance(
      (SELECT val FROM _test_ids WHERE key = 'bal_unexplained'),
      'Cross store attempt'
    );
  $$,
  'P0001',
  NULL,
  'Store scope mismatch rejected by sign_off_daily_balance'
);

-- 10.8 Immutability post sign-off: modifying signed balance throws exception
SELECT throws_ok(
  $$
    UPDATE public.t_daily_balances
    SET signoff_notes = 'Tampered notes'
    WHERE balance_id = (SELECT val FROM _test_ids WHERE key = 'bal_balanced');
  $$,
  'P0001',
  'Daily balance is already signed off and locked from further modification.',
  'Trigger blocks modifying a signed daily balance'
);

-- ---------------------------------------------------------------------------
-- 11. RLS READ ACCESS & SCOPE ISOLATION
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 11.1 Custodian can read own store daily balances
SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-01') >= 2,
  true,
  'Custodian can read daily balances for assigned store (IND-DEL-01)'
);

-- 11.2 Custodian cannot read other store daily balances
SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-02'),
  0,
  'Store scope isolation: Custodian scoped to IND-DEL-01 cannot see IND-DEL-02 balances'
);

-- 11.3 Approver (FC) can read across stores
SET LOCAL "app.current_role" = 'APPROVER';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000006';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000006';

SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-02') >= 1,
  true,
  'Approver (FC) can read daily balances across stores'
);

-- 11.4 Viewer can read across stores
SET LOCAL "app.current_role" = 'VIEWER';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000007';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000007';

SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-02') >= 1,
  true,
  'Viewer can read daily balances across stores'
);

-- 11.5 Unauthorized role (RUNNER) cannot read daily balances
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000004';

SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances),
  0,
  'Unauthorized role (RUNNER) cannot read daily balances under RLS'
);

SELECT * FROM finish();
ROLLBACK;
