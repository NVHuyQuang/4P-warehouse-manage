-- pgTAP Test Suite for Domain D6: Issue & Confirmation Domain (Flow C-2)
-- Tables: t_requests, t_request_items, t_stock_movements
-- Views: v_stock_current, v_stock_lots_fifo
-- RPCs: stage_issue, confirm_issue, decline_issue
-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- Append-only: all ledger adjustments are strictly append-only.

BEGIN;
SELECT plan(53);

-- ============================================================================
-- 0. TEST FIXTURES SETUP
-- ============================================================================
DO $$
DECLARE
  v_admin_id uuid        := '60000000-0000-0000-0000-000000000001'::uuid; -- Storekeeper Store 1
  v_runner_id uuid       := '60000000-0000-0000-0000-000000000002'::uuid; -- Kitchen Runner Store 1
  v_req_id uuid          := '60000000-0000-0000-0000-000000000003'::uuid; -- Kitchen Requester Store 1
  v_sysadmin_id uuid     := '60000000-0000-0000-0000-000000000004'::uuid; -- Global System Admin
  v_other_runner_id uuid := '60000000-0000-0000-0000-000000000005'::uuid; -- Kitchen Runner Store 2
  v_other_admin_id uuid  := '60000000-0000-0000-0000-000000000006'::uuid; -- Second Keeper Store 1
  v_viewer_id uuid       := '60000000-0000-0000-0000-000000000007'::uuid; -- Auditor (VIEWER)

  v_req_ex1_id uuid;
  v_item_ex1_id uuid;
  v_req_ex2_id uuid;
  v_item_ex2_id uuid;
  v_req_ex3_id uuid;
  v_item_ex3_id uuid;
  v_req_exp_id uuid;
  v_item_exp_id uuid;
  v_req_sod_id uuid;
  v_item_sod_id uuid;
  v_req_sys_id uuid;
  v_item_sys_id uuid;
  v_req_queued_id uuid;
  v_item_queued_id uuid;
BEGIN
  -- 1. Ensure test users exist in auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_admin_id,        'd6_admin@example.test'),
    (v_runner_id,       'd6_runner@example.test'),
    (v_req_id,          'd6_req@example.test'),
    (v_sysadmin_id,     'd6_sysadmin@example.test'),
    (v_other_runner_id, 'd6_other_runner@example.test'),
    (v_other_admin_id,  'd6_other_admin@example.test'),
    (v_viewer_id,       'd6_viewer@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Ensure test users exist in m_users
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES
    (v_admin_id::text,        'd6_admin@example.test',        'D6 Keeper Admin',       true),
    (v_runner_id::text,       'd6_runner@example.test',       'D6 Store Runner',       true),
    (v_req_id::text,          'd6_req@example.test',          'D6 Kitchen Requester',  true),
    (v_sysadmin_id::text,     'd6_sysadmin@example.test',     'D6 System Admin',       true),
    (v_other_runner_id::text, 'd6_other_runner@example.test', 'D6 Store 2 Runner',     true),
    (v_other_admin_id::text,  'd6_other_admin@example.test',  'D6 Second Keeper',      true),
    (v_viewer_id::text,       'd6_viewer@example.test',       'D6 Auditor Viewer',     true)
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Ensure test user permissions exist in m_user_permissions
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-d6-admin',        v_admin_id::text,        'ADMIN'::user_role,        'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-d6-runner',       v_runner_id::text,       'RUNNER'::user_role,       'IND-DEL-01', NULL,           'KITCHEN'::section_id),
    ('perm-d6-req',          v_req_id::text,          'KITCHEN_REQ'::user_role,  'IND-DEL-01', NULL,           'KITCHEN'::section_id),
    ('perm-d6-sysadmin',     v_sysadmin_id::text,     'SYSTEM_ADMIN'::user_role, 'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-d6-other-runner', v_other_runner_id::text, 'RUNNER'::user_role,       'IND-DEL-02', NULL,           'KITCHEN'::section_id),
    ('perm-d6-other-admin',  v_other_admin_id::text,  'ADMIN'::user_role,        'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-d6-viewer',       v_viewer_id::text,       'VIEWER'::user_role,       'IND-DEL-01', NULL,           'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- 4. Ensure stores and warehouses exist
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

  -- 5. Ensure dedicated items exist in m_items
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES
    ('ITM-D6-EX1', 'Flour Worked Example 1', 'DRY_GOODS', 'kg', true),
    ('ITM-D6-EX2', 'Flour Worked Example 2', 'DRY_GOODS', 'kg', true),
    ('ITM-D6-EX3', 'Flour Worked Example 3', 'DRY_GOODS', 'kg', true),
    ('ITM-D6-EXP', 'Cheese Expired Radar',   'CHEESE',    'kg', true),
    ('ITM-D6-SOD', 'Olive Oil Segregation',  'DRY_GOODS', 'kg', true),
    ('ITM-D6-SYS', 'Yeast Admin Override',   'DRY_GOODS', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- 6. Initial Inbound Receipts (100 kg initial shelf stock per Doc §4.1)
  INSERT INTO public.t_stock_movements (
    store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
  ) VALUES
    ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-D6-EX1', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-D6-01', CURRENT_DATE + 60, 'GRPO-D6-INIT-1', v_admin_id::text),
    ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-D6-EX2', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-D6-02', CURRENT_DATE + 60, 'GRPO-D6-INIT-2', v_admin_id::text),
    ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-D6-EX3', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-D6-03', CURRENT_DATE + 60, 'GRPO-D6-INIT-3', v_admin_id::text),
    ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-D6-EXP', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-D6-EXP', CURRENT_DATE + 60, 'GRPO-D6-INIT-4', v_admin_id::text),
    ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-D6-SOD', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-D6-SOD', CURRENT_DATE + 60, 'GRPO-D6-INIT-5', v_admin_id::text),
    ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-D6-SYS', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-D6-SYS', CURRENT_DATE + 60, 'GRPO-D6-INIT-6', v_admin_id::text);

  -- 7. Create Section Requisitions
  -- Requisition 1 (For Worked Example 1)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'QUEUED')
  RETURNING request_id INTO v_req_ex1_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_ex1_id, 'ITM-D6-EX1', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_ex1_id;

  -- Requisition 2 (For Worked Example 2)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'QUEUED')
  RETURNING request_id INTO v_req_ex2_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_ex2_id, 'ITM-D6-EX2', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_ex2_id;

  -- Requisition 3 (For Worked Example 3)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'QUEUED')
  RETURNING request_id INTO v_req_ex3_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_ex3_id, 'ITM-D6-EX3', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_ex3_id;

  -- Requisition 4 (For Expired Lot test)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'PICKING')
  RETURNING request_id INTO v_req_exp_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_exp_id, 'ITM-D6-EXP', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_exp_id;

  -- Requisition 5 (For Segregation of Duties test)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'PICKING')
  RETURNING request_id INTO v_req_sod_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_sod_id, 'ITM-D6-SOD', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_sod_id;

  -- Requisition 6 (For System Admin override test)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'PICKING')
  RETURNING request_id INTO v_req_sys_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_sys_id, 'ITM-D6-SYS', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_sys_id;

  -- Requisition 7 (For QUEUED state guard check)
  INSERT INTO public.t_requests (store_id, section_id, requester_user_id, status)
  VALUES ('IND-DEL-01', 'KITCHEN', v_req_id, 'QUEUED')
  RETURNING request_id INTO v_req_queued_id;

  INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
  VALUES (v_req_queued_id, 'ITM-D6-EX1', 5.000, 'kg')
  RETURNING request_item_id INTO v_item_queued_id;

  -- Store UUIDs in session context for subsequent test blocks
  PERFORM set_config('app.test_req_ex1_id', v_req_ex1_id::text, true);
  PERFORM set_config('app.test_item_ex1_id', v_item_ex1_id::text, true);
  PERFORM set_config('app.test_req_ex2_id', v_req_ex2_id::text, true);
  PERFORM set_config('app.test_item_ex2_id', v_item_ex2_id::text, true);
  PERFORM set_config('app.test_req_ex3_id', v_req_ex3_id::text, true);
  PERFORM set_config('app.test_item_ex3_id', v_item_ex3_id::text, true);
  PERFORM set_config('app.test_req_exp_id', v_req_exp_id::text, true);
  PERFORM set_config('app.test_item_exp_id', v_item_exp_id::text, true);
  PERFORM set_config('app.test_req_sod_id', v_req_sod_id::text, true);
  PERFORM set_config('app.test_item_sod_id', v_item_sod_id::text, true);
  PERFORM set_config('app.test_req_sys_id', v_req_sys_id::text, true);
  PERFORM set_config('app.test_item_sys_id', v_item_sys_id::text, true);
  PERFORM set_config('app.test_req_queued_id', v_req_queued_id::text, true);
  PERFORM set_config('app.test_item_queued_id', v_item_queued_id::text, true);
END $$;

-- ============================================================================
-- 1. FUNCTION SIGNATURES & EXISTENCE
-- ============================================================================
SELECT has_function('public', 'stage_issue', ARRAY['uuid', 'jsonb'], 'RPC stage_issue(uuid, jsonb) exists');
SELECT has_function('public', 'confirm_issue', ARRAY['uuid', 'jsonb', 'jsonb'], 'RPC confirm_issue(uuid, jsonb, jsonb) exists');
SELECT has_function('public', 'decline_issue', ARRAY['uuid', 'text'], 'RPC decline_issue(uuid, text) exists');

-- ============================================================================
-- 2. WORKED EXAMPLE 1 (Doc §4.1: Issue 5 kg, Runner Declines 5 kg)
-- ============================================================================
-- Initial shelf stock = 100 kg
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX1'),
  100.000,
  'Worked Example 1 - Step 0: Initial shelf stock is 100 kg'
);

-- Step 1: Admin picks & stages 5 kg (ISSUE_PENDING: -5)
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_ex1_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_ex1_id')::uuid,
          'staged_qty', 5.000,
          'batch_number', 'BAT-D6-01',
          'expiry_date', (CURRENT_DATE + 30)::text,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'Worked Example 1 - Step 1: Keeper stages 5 kg via stage_issue'
);

SELECT is(
  (SELECT status FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex1_id')::uuid),
  'AWAITING_RUNNER',
  'Worked Example 1 - Step 1: Request status advances to AWAITING_RUNNER'
);

SELECT is(
  (SELECT issued_qty FROM public.t_request_items WHERE request_item_id = current_setting('app.test_item_ex1_id')::uuid),
  5.000,
  'Worked Example 1 - Step 1: Line item issued_qty updated to 5.000'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX1'),
  95.000,
  'Worked Example 1 - Step 1: Derived stock drops immediately to 95 kg (100 - 5)'
);

-- Step 2: Runner declines goods at storeroom door
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.decline_issue(
      current_setting('app.test_req_ex1_id')::uuid,
      'Damaged packing carton at storeroom door'
    );
  $$,
  'Worked Example 1 - Step 2: Runner declines goods via decline_issue'
);

SELECT is(
  (SELECT status FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex1_id')::uuid),
  'PARTIAL_DECLINED',
  'Worked Example 1 - Step 2: Request status transitions to PARTIAL_DECLINED'
);

SELECT is(
  (SELECT runner_user_id FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex1_id')::uuid),
  '60000000-0000-0000-0000-000000000002'::uuid,
  'Worked Example 1 - Step 2: runner_user_id recorded'
);

SELECT ok(
  (SELECT runner_confirmed_at IS NOT NULL FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex1_id')::uuid),
  'Worked Example 1 - Step 2: runner_confirmed_at timestamp recorded'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.t_stock_movements
    WHERE reference_doc_id = current_setting('app.test_req_ex1_id')
      AND movement_type = 'ISSUE_REVERSAL'
      AND quantity = 5.000
  ),
  'Worked Example 1 - Step 2: ISSUE_REVERSAL with +5.000 kg appended to ledger'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX1'),
  100.000,
  'Worked Example 1 - Step 2: Net ledger delta = 0, stock restored to 100 kg (95 + 5 = 100)'
);

-- ============================================================================
-- 3. WORKED EXAMPLE 2 (Doc §4.1: Issue 5 kg, Runner Confirms 5 kg)
-- ============================================================================
-- Initial shelf stock = 100 kg
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX2'),
  100.000,
  'Worked Example 2 - Step 0: Initial shelf stock is 100 kg'
);

-- Step 1: Admin picks & stages 5 kg (ISSUE_PENDING: -5)
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_ex2_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_ex2_id')::uuid,
          'staged_qty', 5.000,
          'batch_number', 'BAT-D6-02',
          'expiry_date', (CURRENT_DATE + 45)::text,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'Worked Example 2 - Step 1: Keeper stages 5 kg via stage_issue'
);

SELECT is(
  (SELECT status FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex2_id')::uuid),
  'AWAITING_RUNNER',
  'Worked Example 2 - Step 1: Request status advances to AWAITING_RUNNER'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX2'),
  95.000,
  'Worked Example 2 - Step 1: Derived stock drops immediately to 95 kg (100 - 5)'
);

-- Step 2: Runner confirms full 5 kg receipt at door
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_ex2_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_ex2_id')::uuid,
          'accepted_qty', 5.000
        )
      )
    );
  $$,
  'Worked Example 2 - Step 2: Runner confirms full 5 kg receipt via confirm_issue'
);

SELECT is(
  (SELECT status FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex2_id')::uuid),
  'CONFIRMED',
  'Worked Example 2 - Step 2: Request status transitions to CONFIRMED'
);

SELECT is(
  (SELECT runner_user_id FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex2_id')::uuid),
  '60000000-0000-0000-0000-000000000002'::uuid,
  'Worked Example 2 - Step 2: runner_user_id recorded'
);

SELECT ok(
  (SELECT runner_confirmed_at IS NOT NULL FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex2_id')::uuid),
  'Worked Example 2 - Step 2: runner_confirmed_at timestamp recorded'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.t_stock_movements
    WHERE reference_doc_id = current_setting('app.test_req_ex2_id')
      AND movement_type = 'ISSUE_PENDING_OFFSET'
      AND quantity = 5.000
  ),
  'Worked Example 2 - Step 2: ISSUE_PENDING_OFFSET with +5.000 kg appended to ledger'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.t_stock_movements
    WHERE reference_doc_id = current_setting('app.test_req_ex2_id')
      AND movement_type = 'ISSUE_CONFIRMED'
      AND quantity = -5.000
  ),
  'Worked Example 2 - Step 2: ISSUE_CONFIRMED with -5.000 kg appended to ledger'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX2'),
  95.000,
  'Worked Example 2 - Step 2: Net ledger delta = -5 kg, derived stock is 95 kg (95 + 5 - 5 = 95)'
);

-- ============================================================================
-- 4. WORKED EXAMPLE 3 (Doc §4.1: Issue 5 kg, Runner Confirms 3 kg & Declines 2 kg)
-- ============================================================================
-- Initial shelf stock = 100 kg
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX3'),
  100.000,
  'Worked Example 3 - Step 0: Initial shelf stock is 100 kg'
);

-- Step 1: Admin picks & stages 5 kg (ISSUE_PENDING: -5)
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_ex3_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_ex3_id')::uuid,
          'staged_qty', 5.000,
          'batch_number', 'BAT-D6-03',
          'expiry_date', (CURRENT_DATE + 30)::text,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'Worked Example 3 - Step 1: Keeper stages 5 kg via stage_issue'
);

SELECT is(
  (SELECT status FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex3_id')::uuid),
  'AWAITING_RUNNER',
  'Worked Example 3 - Step 1: Request status advances to AWAITING_RUNNER'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX3'),
  95.000,
  'Worked Example 3 - Step 1: Derived stock drops immediately to 95 kg (100 - 5)'
);

-- Step 2: Runner confirms 3 kg and declines 2 kg (partial acceptance)
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_ex3_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_ex3_id')::uuid,
          'accepted_qty', 3.000
        )
      ),
      jsonb_build_object(
        current_setting('app.test_item_ex3_id'), 'Partial accept: 2kg torn packaging returned to shelf'
      )
    );
  $$,
  'Worked Example 3 - Step 2: Runner confirms 3 kg (declining 2 kg) via confirm_issue'
);

SELECT is(
  (SELECT status FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex3_id')::uuid),
  'PARTIAL_ACCEPTED',
  'Worked Example 3 - Step 2: Request status transitions to PARTIAL_ACCEPTED'
);

SELECT is(
  (SELECT runner_user_id FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex3_id')::uuid),
  '60000000-0000-0000-0000-000000000002'::uuid,
  'Worked Example 3 - Step 2: runner_user_id recorded'
);

SELECT ok(
  (SELECT runner_confirmed_at IS NOT NULL FROM public.t_requests WHERE request_id = current_setting('app.test_req_ex3_id')::uuid),
  'Worked Example 3 - Step 2: runner_confirmed_at timestamp recorded'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.t_stock_movements
    WHERE reference_doc_id = current_setting('app.test_req_ex3_id')
      AND movement_type = 'ISSUE_PENDING_OFFSET'
      AND quantity = 5.000
  ),
  'Worked Example 3 - Step 2: ISSUE_PENDING_OFFSET with full +5.000 kg appended to clear reservation'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.t_stock_movements
    WHERE reference_doc_id = current_setting('app.test_req_ex3_id')
      AND movement_type = 'ISSUE_CONFIRMED'
      AND quantity = -3.000
  ),
  'Worked Example 3 - Step 2: ISSUE_CONFIRMED with -3.000 kg appended for accepted portion'
);

SELECT is(
  (SELECT variance_reason FROM public.t_request_items WHERE request_item_id = current_setting('app.test_item_ex3_id')::uuid),
  'Partial accept: 2kg torn packaging returned to shelf',
  'Worked Example 3 - Step 2: variance_reason recorded in request line item'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-D6-EX3'),
  97.000,
  'Worked Example 3 - Step 2: Net ledger delta = -3 kg, derived stock is 97 kg (95 + 5 - 3 = 97)'
);

-- ============================================================================
-- 5. EXPIRED LOT RULE ENFORCEMENT
-- ============================================================================
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 5.1 Candidate lot expired in the past throws exception
SELECT throws_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_exp_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_exp_id')::uuid,
          'staged_qty', 5.000,
          'batch_number', 'BAT-EXP-PAST',
          'expiry_date', (CURRENT_DATE - 1)::text,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'P0001',
  'Candidate lot is expired and locked',
  'Expired lot in past throws Candidate lot is expired and locked'
);

-- 5.2 Candidate lot expiring today (CURRENT_DATE) throws exception
SELECT throws_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_exp_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_exp_id')::uuid,
          'staged_qty', 5.000,
          'batch_number', 'BAT-EXP-TODAY',
          'expiry_date', CURRENT_DATE::text,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'P0001',
  'Candidate lot is expired and locked',
  'Expired lot expiring today throws Candidate lot is expired and locked'
);

-- ============================================================================
-- 6. SEGREGATION OF DUTIES ENFORCEMENT
-- ============================================================================
-- 6.1 Keeper stages issue for Requisition 5
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT public.stage_issue(
  current_setting('app.test_req_sod_id')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'request_item_id', current_setting('app.test_item_sod_id')::uuid,
      'staged_qty', 5.000,
      'batch_number', 'BAT-D6-SOD',
      'expiry_date', (CURRENT_DATE + 30)::text,
      'warehouse_id', 'WH-DEL01-DRY'
    )
  )
);

-- 6.2 Staging keeper attempting to confirm own issue fails
SELECT throws_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_sod_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_sod_id')::uuid,
          'accepted_qty', 5.000
        )
      )
    );
  $$,
  'P0001',
  'Segregation of duties violation: Staging keeper cannot confirm their own issue.',
  'Staging keeper attempting to confirm own issue throws segregation exception'
);

-- 6.3 Staging keeper attempting to decline own issue fails
SELECT throws_ok(
  $$
    SELECT public.decline_issue(
      current_setting('app.test_req_sod_id')::uuid,
      'Self decline attempt'
    );
  $$,
  'P0001',
  'Segregation of duties violation: Staging keeper cannot decline their own issue.',
  'Staging keeper attempting to decline own issue throws segregation exception'
);

-- 6.4 System Admin override allows confirmation even if staged by system admin
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'SYSTEM_ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT public.stage_issue(
  current_setting('app.test_req_sys_id')::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'request_item_id', current_setting('app.test_item_sys_id')::uuid,
      'staged_qty', 5.000,
      'batch_number', 'BAT-D6-SYS',
      'expiry_date', (CURRENT_DATE + 30)::text,
      'warehouse_id', 'WH-DEL01-DRY'
    )
  )
);

SELECT lives_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_sys_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_sys_id')::uuid,
          'accepted_qty', 5.000
        )
      )
    );
  $$,
  'System admin override allows confirmation by staging keeper'
);

-- ============================================================================
-- 7. ROLE-BASED ACCESS CONTROL & STORE SCOPING
-- ============================================================================
-- 7.1 Kitchen Section Requester cannot stage issue
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_queued_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_queued_id')::uuid,
          'staged_qty', 5.000,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can stage stock.',
  'Requester calling stage_issue throws unauthorized'
);

-- 7.2 Auditor Viewer cannot stage issue
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_role" = 'VIEWER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_queued_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_queued_id')::uuid,
          'staged_qty', 5.000,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can stage stock.',
  'Auditor Viewer calling stage_issue throws unauthorized'
);

-- 7.3 Other Keeper (not staging keeper, but without RUNNER role) cannot confirm issue
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_sod_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_sod_id')::uuid,
          'accepted_qty', 5.000
        )
      )
    );
  $$,
  'P0001',
  'Unauthorized: Only Kitchen Runner can confirm issue.',
  'Warehouse Keeper without RUNNER role cannot confirm issue'
);

-- 7.4 Cross-store runner (IND-DEL-02) cannot confirm IND-DEL-01 request
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_sod_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_sod_id')::uuid,
          'accepted_qty', 5.000
        )
      )
    );
  $$,
  'P0001',
  'Unauthorized: Store scope mismatch. Active store is IND-DEL-02, request store is IND-DEL-01.',
  'Cross-store runner cannot confirm issue'
);

-- ============================================================================
-- 8. STATE MACHINE & PARAMETER GUARDS
-- ============================================================================
-- 8.1 stage_issue with staged_qty = 0 throws exception
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_queued_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_queued_id')::uuid,
          'staged_qty', 0,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'P0001',
  'Invalid staged_qty: 0. Must be greater than 0.',
  'Zero staged_qty throws exception'
);

-- 8.2 confirm_issue with accepted_qty > staged_qty throws exception
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_sod_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_sod_id')::uuid,
          'accepted_qty', 10.000
        )
      )
    );
  $$,
  'P0001',
  NULL,
  'Accepted quantity exceeding staged quantity throws exception'
);

-- 8.3 decline_issue with empty reason throws exception
SELECT throws_ok(
  $$
    SELECT public.decline_issue(
      current_setting('app.test_req_sod_id')::uuid,
      '   '
    );
  $$,
  'P0001',
  'Decline reason is required.',
  'Empty decline reason throws exception'
);

-- 8.4 confirm_issue on request in status QUEUED throws exception
SELECT throws_ok(
  $$
    SELECT public.confirm_issue(
      current_setting('app.test_req_queued_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_queued_id')::uuid,
          'accepted_qty', 5.000
        )
      )
    );
  $$,
  'P0001',
  'Cannot confirm issue: request is in status QUEUED, expected AWAITING_RUNNER.',
  'Confirming QUEUED request throws exception'
);

-- 8.5 stage_issue on request in terminal status CONFIRMED throws exception
SET LOCAL "app.current_user_id" = '60000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.stage_issue(
      current_setting('app.test_req_ex2_id')::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'request_item_id', current_setting('app.test_item_ex2_id')::uuid,
          'staged_qty', 5.000,
          'warehouse_id', 'WH-DEL01-DRY'
        )
      )
    );
  $$,
  'P0001',
  NULL,
  'Staging CONFIRMED request throws exception'
);

-- ============================================================================
-- 9. APPEND-ONLY IMMUTABILITY OF STOCK MOVEMENTS
-- ============================================================================
-- Direct UPDATE on t_stock_movements fails
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET quantity = 999.000 WHERE item_code = 'ITM-D6-EX1' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Direct UPDATE on t_stock_movements blocked by trigger'
);

-- Direct DELETE on t_stock_movements fails
SELECT throws_ok(
  $$ DELETE FROM public.t_stock_movements WHERE item_code = 'ITM-D6-EX1' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'Direct DELETE on t_stock_movements blocked by trigger'
);

SELECT * FROM finish();
ROLLBACK;
