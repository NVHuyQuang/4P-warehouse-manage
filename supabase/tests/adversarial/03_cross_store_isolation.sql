-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- pgTAP Test Suite: D14 Adversarial RLS & Attack Suite - Part 3: Cross-Store Isolation
-- Scope:
-- 1. Store staff assigned to Store 1 (IND-DEL-01) cannot SELECT requests, balances, counts, custody logs of Store 2 (IND-DEL-02)
-- 2. Store staff cannot INSERT records targeting another store
-- 3. Store switcher context (app.current_store_id) prevents leakage across tenants

BEGIN;
SELECT plan(32);

-- ============================================================================
-- 0. TEST FIXTURES SETUP
-- ============================================================================
DO $$
DECLARE
  v_staff_s1   uuid := 'c1000000-0000-0000-0000-000000000001'::uuid;
  v_staff_s2   uuid := 'c1000000-0000-0000-0000-000000000002'::uuid;
  v_sysadmin   uuid := 'c1000000-0000-0000-0000-000000000003'::uuid;

  v_req_s1     uuid := 'r0000001-0000-0000-0000-000000000001'::uuid;
  v_req_s2     uuid := 'r0000002-0000-0000-0000-000000000002'::uuid;
  v_item_s2    uuid := 'r0000002-0000-0000-0000-000000000012'::uuid;

  v_bal_s1     uuid := 'b0000001-0000-0000-0000-000000000001'::uuid;
  v_bal_s2     uuid := 'b0000002-0000-0000-0000-000000000002'::uuid;

  v_cnt_s1     uuid := 'k0000001-0000-0000-0000-000000000001'::uuid;
  v_cnt_s2     uuid := 'k0000002-0000-0000-0000-000000000002'::uuid;

  v_cust_s1    uuid := 'l0000001-0000-0000-0000-000000000001'::uuid;
  v_cust_s2    uuid := 'l0000002-0000-0000-0000-000000000002'::uuid;

  v_shf_s1     uuid := 's0000001-0000-0000-0000-000000000001'::uuid;
  v_shf_s2     uuid := 's0000002-0000-0000-0000-000000000002'::uuid;
BEGIN
  -- 1. Insert test users in auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_staff_s1, 'cross_staff_s1@example.test'),
    (v_staff_s2, 'cross_staff_s2@example.test'),
    (v_sysadmin, 'cross_sysadmin@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert test users in public.m_users
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES
    (v_staff_s1::text, 'cross_staff_s1@example.test', 'Store 1 Staff',  true),
    (v_staff_s2::text, 'cross_staff_s2@example.test', 'Store 2 Staff',  true),
    (v_sysadmin::text, 'cross_sysadmin@example.test', 'Global SysAdmin',true)
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Stores & Warehouses
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES
    ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true),
    ('IND-DEL-02', 'Delhi Store 2', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES
    ('WH-DEL01-DRY', 'IND-DEL-01', 'Delhi Store 1 Dry Store', 'DRY_STORE', 'ACTIVE', true),
    ('WH-DEL02-DRY', 'IND-DEL-02', 'Delhi Store 2 Dry Store', 'DRY_STORE', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;

  -- 4. User permissions
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-iso-s1', v_staff_s1::text, 'ADMIN'::user_role,        'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-iso-s2', v_staff_s2::text, 'ADMIN'::user_role,        'IND-DEL-02', 'WH-DEL02-DRY', 'ALL'::section_id),
    ('perm-iso-sa', v_sysadmin::text, 'SYSTEM_ADMIN'::user_role, 'IND-DEL-01', NULL,           'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- 5. Items
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES ('ITM-ISO-001', 'Store Isolation Test Item', 'DRY_GOODS', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- 6. Initial Inbound Movement for testing
  INSERT INTO public.t_stock_movements (
    movement_id, store_id, warehouse_id, item_code, movement_type,
    quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
  ) VALUES
    ('m3000000-0000-0000-0000-000000000001'::uuid, 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-ISO-001', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-ISO-01', CURRENT_DATE + 30, 'REF-S1-INIT', v_staff_s1::text),
    ('m3000000-0000-0000-0000-000000000002'::uuid, 'IND-DEL-02', 'WH-DEL02-DRY', 'ITM-ISO-001', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-ISO-02', CURRENT_DATE + 30, 'REF-S2-INIT', v_staff_s2::text)
  ON CONFLICT (movement_id) DO NOTHING;

  -- 7. Seed Records for Store 1 & Store 2 across all 4 domains:
  -- 7.1 Requests
  INSERT INTO public.t_requests (request_id, store_id, section_id, requester_user_id, status)
  VALUES
    (v_req_s1, 'IND-DEL-01', 'KITCHEN', v_staff_s1, 'QUEUED'),
    (v_req_s2, 'IND-DEL-02', 'KITCHEN', v_staff_s2, 'QUEUED')
  ON CONFLICT (request_id) DO NOTHING;

  INSERT INTO public.t_request_items (request_item_id, request_id, item_code, requested_qty, uom)
  VALUES
    ('r0000001-0000-0000-0000-000000000011'::uuid, v_req_s1, 'ITM-ISO-001', 5.000, 'kg'),
    (v_item_s2,                                    v_req_s2, 'ITM-ISO-001', 8.000, 'kg')
  ON CONFLICT (request_item_id) DO NOTHING;

  -- 7.2 Daily Balances
  INSERT INTO public.t_daily_balances (balance_id, store_id, warehouse_id, balance_date, status, submitted_by_user_id)
  VALUES
    (v_bal_s1, 'IND-DEL-01', 'WH-DEL01-DRY', CURRENT_DATE, 'BALANCED', v_staff_s1),
    (v_bal_s2, 'IND-DEL-02', 'WH-DEL02-DRY', CURRENT_DATE, 'BALANCED', v_staff_s2)
  ON CONFLICT (balance_id) DO NOTHING;

  -- 7.3 Stock Counts
  INSERT INTO public.t_stock_counts (count_id, store_id, warehouse_id, count_type, count_date, keeper_user_id, status)
  VALUES
    (v_cnt_s1, 'IND-DEL-01', 'WH-DEL01-DRY', 'CYCLE_COUNT', CURRENT_DATE, v_staff_s1, 'IN_PROGRESS'),
    (v_cnt_s2, 'IND-DEL-02', 'WH-DEL02-DRY', 'CYCLE_COUNT', CURRENT_DATE, v_staff_s2, 'IN_PROGRESS')
  ON CONFLICT (count_id) DO NOTHING;

  -- 7.4 Custody Logs & Shift Custody Logs
  INSERT INTO public.t_custody_logs (log_id, store_id, warehouse_id, action_type, logged_by_user_id, notes)
  VALUES
    (v_cust_s1, 'IND-DEL-01', 'WH-DEL01-DRY', 'DOOR_OPEN',  v_staff_s1, 'Store 1 Morning open'),
    (v_cust_s2, 'IND-DEL-02', 'WH-DEL02-DRY', 'DOOR_OPEN',  v_staff_s2, 'Store 2 Morning open')
  ON CONFLICT (log_id) DO NOTHING;

  INSERT INTO public.t_shift_custody_logs (shift_log_id, store_id, warehouse_id, shift_type, shift_date, handed_over_by_user_id, received_by_user_id)
  VALUES
    (v_shf_s1, 'IND-DEL-01', 'WH-DEL01-DRY', 'MORNING', CURRENT_DATE, v_staff_s1, v_staff_s1),
    (v_shf_s2, 'IND-DEL-02', 'WH-DEL02-DRY', 'MORNING', CURRENT_DATE, v_staff_s2, v_staff_s2)
  ON CONFLICT (shift_log_id) DO NOTHING;

END $$;

-- ============================================================================
-- 1. RLS ACTIVATION PRECONDITIONS
-- ============================================================================
SELECT ok(relrowsecurity, 'RLS is enabled on t_requests')
FROM pg_class WHERE relname = 't_requests';

SELECT ok(relrowsecurity, 'RLS is enabled on t_daily_balances')
FROM pg_class WHERE relname = 't_daily_balances';

SELECT ok(relrowsecurity, 'RLS is enabled on t_stock_counts')
FROM pg_class WHERE relname = 't_stock_counts';

SELECT ok(relrowsecurity, 'RLS is enabled on t_custody_logs')
FROM pg_class WHERE relname = 't_custody_logs';

SELECT ok(relrowsecurity, 'RLS is enabled on t_shift_custody_logs')
FROM pg_class WHERE relname = 't_shift_custody_logs';

-- ============================================================================
-- 2. CROSS-STORE SELECT ISOLATION: STORE 1 STAFF CANNOT READ STORE 2 DATA
-- ============================================================================
-- Activate session for Store 1 Staff (IND-DEL-01)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c1000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 2.1 Requests Isolation
SELECT is(
  (SELECT count(*)::integer FROM public.t_requests WHERE store_id = 'IND-DEL-01'),
  1,
  'Store 1 staff can read Store 1 requests'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_requests WHERE store_id = 'IND-DEL-02'),
  0,
  'Store 1 staff CANNOT see Store 2 requests (returns 0 rows)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_request_items WHERE request_item_id = 'r0000002-0000-0000-0000-000000000012'::uuid),
  0,
  'Store 1 staff CANNOT see Store 2 request line items'
);

-- 2.2 Daily Balances Isolation
SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-01'),
  1,
  'Store 1 staff can read Store 1 daily balances'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-02'),
  0,
  'Store 1 staff CANNOT see Store 2 daily balances (returns 0 rows)'
);

-- 2.3 Stock Counts Isolation
SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_counts WHERE store_id = 'IND-DEL-01'),
  1,
  'Store 1 staff can read Store 1 stock counts'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_counts WHERE store_id = 'IND-DEL-02'),
  0,
  'Store 1 staff CANNOT see Store 2 stock counts (returns 0 rows)'
);

-- 2.4 Custody Logs Isolation
SELECT is(
  (SELECT count(*)::integer FROM public.t_custody_logs WHERE store_id = 'IND-DEL-01'),
  1,
  'Store 1 staff can read Store 1 custody logs'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_custody_logs WHERE store_id = 'IND-DEL-02'),
  0,
  'Store 1 staff CANNOT see Store 2 custody logs (returns 0 rows)'
);

-- 2.5 Shift Custody Logs Isolation
SELECT is(
  (SELECT count(*)::integer FROM public.t_shift_custody_logs WHERE store_id = 'IND-DEL-01'),
  1,
  'Store 1 staff can read Store 1 shift custody logs'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_shift_custody_logs WHERE store_id = 'IND-DEL-02'),
  0,
  'Store 1 staff CANNOT see Store 2 shift custody logs (returns 0 rows)'
);

-- ============================================================================
-- 3. CROSS-STORE INSERT DENIAL: STORE 1 STAFF CANNOT INSERT INTO STORE 2
-- ============================================================================
-- Attack 3.1: Direct INSERT into t_requests targeting Store 2
SELECT throws_ok(
  $$ INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
     VALUES ('IND-DEL-02', 'KITCHEN', 'c1000000-0000-0000-0000-000000000001'::uuid, 'QUEUED') $$,
  '42501',
  NULL,
  'Direct INSERT into t_requests for Store 2 is blocked by RLS WITH CHECK policy'
);

-- Attack 3.2: Direct INSERT into t_daily_balances targeting Store 2
SELECT throws_ok(
  $$ INSERT INTO public.t_daily_balances (store_id, warehouse_id, balance_date, status, submitted_by_user_id)
     VALUES ('IND-DEL-02', 'WH-DEL02-DRY', CURRENT_DATE, 'BALANCED', 'c1000000-0000-0000-0000-000000000001'::uuid) $$,
  '42501',
  NULL,
  'Direct INSERT into t_daily_balances for Store 2 is blocked by RLS WITH CHECK policy'
);

-- Attack 3.3: Direct INSERT into t_stock_counts targeting Store 2
SELECT throws_ok(
  $$ INSERT INTO public.t_stock_counts (store_id, warehouse_id, count_type, count_date, keeper_user_id, status)
     VALUES ('IND-DEL-02', 'WH-DEL02-DRY', 'CYCLE_COUNT', CURRENT_DATE, 'c1000000-0000-0000-0000-000000000001'::uuid, 'IN_PROGRESS') $$,
  '42501',
  NULL,
  'Direct INSERT into t_stock_counts for Store 2 is blocked by RLS WITH CHECK policy'
);

-- Attack 3.4: Direct INSERT into t_custody_logs targeting Store 2
SELECT throws_ok(
  $$ INSERT INTO public.t_custody_logs (store_id, warehouse_id, action_type, logged_by_user_id, notes)
     VALUES ('IND-DEL-02', 'WH-DEL02-DRY', 'DOOR_OPEN', 'c1000000-0000-0000-0000-000000000001'::uuid, 'Rogue cross-store log') $$,
  '42501',
  NULL,
  'Direct INSERT into t_custody_logs for Store 2 is blocked by RLS WITH CHECK policy'
);

-- Attack 3.5: Direct INSERT into t_shift_custody_logs targeting Store 2
SELECT throws_ok(
  $$ INSERT INTO public.t_shift_custody_logs (store_id, warehouse_id, shift_type, shift_date, handed_over_by_user_id, received_by_user_id)
     VALUES ('IND-DEL-02', 'WH-DEL02-DRY', 'EVENING', CURRENT_DATE, 'c1000000-0000-0000-0000-000000000001'::uuid, 'c1000000-0000-0000-0000-000000000001'::uuid) $$,
  '42501',
  NULL,
  'Direct INSERT into t_shift_custody_logs for Store 2 is blocked by RLS WITH CHECK policy'
);

-- Attack 3.6: RPC create_section_request targeting Store 2 from Store 1 session
SELECT throws_ok(
  $$ SELECT public.create_section_request(
       'IND-DEL-02', 'KITCHEN',
       '[{"item_code": "ITM-ISO-001", "requested_qty": 3.0}]'::jsonb
     ) $$,
  'P0001',
  'Unauthorized: Store scope mismatch.',
  'Calling create_section_request targeting Store 2 throws Store scope mismatch exception'
);

-- Proof 3.7: Legitimate INSERT into own store (IND-DEL-01) succeeds
SELECT lives_ok(
  $$ INSERT INTO public.t_custody_logs (store_id, warehouse_id, action_type, logged_by_user_id, notes)
     VALUES ('IND-DEL-01', 'WH-DEL01-DRY', 'DOOR_CLOSE', 'c1000000-0000-0000-0000-000000000001'::uuid, 'Store 1 Door close') $$,
  'Legitimate INSERT into assigned store (IND-DEL-01) succeeds'
);

-- ============================================================================
-- 4. STORE SWITCHER CONTEXT & MULTI-TENANT LEAKAGE PREVENTION
-- ============================================================================
-- 4.1 v_store_switcher view reflects active store entities
SELECT ok(
  EXISTS (SELECT 1 FROM public.v_store_switcher WHERE store_id = 'IND-DEL-01'),
  'v_store_switcher exposes active store metadata'
);

-- 4.2 Switch session context to Store 2 Staff (IND-DEL-02)
SET LOCAL "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'c1000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

-- Now Store 2 staff sees Store 2 requests
SELECT is(
  (SELECT count(*)::integer FROM public.t_requests WHERE store_id = 'IND-DEL-02'),
  1,
  'After context switch, Store 2 staff can read Store 2 requests'
);

-- Store 2 staff CANNOT see Store 1 requests
SELECT is(
  (SELECT count(*)::integer FROM public.t_requests WHERE store_id = 'IND-DEL-01'),
  0,
  'Store 2 staff CANNOT see Store 1 requests (complete bidirectional isolation)'
);

-- Store 2 staff CANNOT see Store 1 daily balances
SELECT is(
  (SELECT count(*)::integer FROM public.t_daily_balances WHERE store_id = 'IND-DEL-01'),
  0,
  'Store 2 staff CANNOT see Store 1 daily balances'
);

-- Store 2 staff CANNOT see Store 1 stock counts
SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_counts WHERE store_id = 'IND-DEL-01'),
  0,
  'Store 2 staff CANNOT see Store 1 stock counts'
);

-- Store 2 staff CANNOT see Store 1 custody logs
SELECT is(
  (SELECT count(*)::integer FROM public.t_custody_logs WHERE store_id = 'IND-DEL-01'),
  0,
  'Store 2 staff CANNOT see Store 1 custody logs'
);

-- Attack 4.3: Store 2 staff attempting INSERT into Store 1
SELECT throws_ok(
  $$ INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
     VALUES ('IND-DEL-01', 'KITCHEN', 'c1000000-0000-0000-0000-000000000002'::uuid, 'QUEUED') $$,
  '42501',
  NULL,
  'Store 2 staff attempting INSERT into Store 1 is blocked by RLS'
);

-- 4.4 Tampering with session setting: Unsetting app.current_store_id
SET LOCAL "app.current_store_id" = '';
-- Helper function current_store_id() falls back to m_user_permissions where user is IND-DEL-02
SELECT is(
  public.current_store_id(),
  'IND-DEL-02',
  'Empty session setting falls back securely to database permission table store_id'
);

-- Attack 4.5: Calling stage_issue across stores is rejected by store scope check
SELECT throws_ok(
  $$ SELECT public.stage_issue(
       'r0000001-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'r0000001-0000-0000-0000-000000000011'::uuid,
           'staged_qty', 5.000,
           'warehouse_id', 'WH-DEL01-DRY',
           'batch_number', 'BAT-ISO-01',
           'expiry_date', CURRENT_DATE + 30
         )
       )
     ) $$,
  'P0001',
  NULL,
  'Calling stage_issue on Store 1 request from Store 2 user throws Store scope mismatch exception'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
