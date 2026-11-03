-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- pgTAP Test Suite: D14 Adversarial RLS & Attack Suite - Part 2: Segregation of Duties
-- Scope:
-- 1. Counter cannot approve own count adjustment in t_stock_adjustments
-- 2. Transfer dispatcher cannot receive their own transfer in t_transfer_intransit
-- 3. Waste logger cannot approve their own waste claim in t_waste_returns_log
-- 4. Keeper staging stock cannot confirm receipt at door in confirm_issue
-- 5. Proposer cannot approve own store/warehouse proposal in decide_store_warehouse_proposal

BEGIN;
SELECT plan(25);

-- ============================================================================
-- 0. TEST FIXTURES SETUP
-- ============================================================================
DO $$
DECLARE
  v_keeper_id       uuid := 'b0000000-0000-0000-0000-000000000001'::uuid;
  v_acct_id         uuid := 'b0000000-0000-0000-0000-000000000002'::uuid;
  v_fc_id           uuid := 'b0000000-0000-0000-0000-000000000003'::uuid;
  v_runner_id       uuid := 'b0000000-0000-0000-0000-000000000004'::uuid;
  v_req_id          uuid := 'b0000000-0000-0000-0000-000000000005'::uuid;
  v_other_keeper_id uuid := 'b0000000-0000-0000-0000-000000000006'::uuid;
  v_other_fc_id     uuid := 'b0000000-0000-0000-0000-000000000007'::uuid;
  v_rm_id           uuid := 'b0000000-0000-0000-0000-000000000008'::uuid;

  v_count_id        uuid := 'c1000000-0000-0000-0000-000000000001'::uuid;
  v_req_c2_id       uuid := 'r1000000-0000-0000-0000-000000000001'::uuid;
  v_req_item_id     uuid := 'r2000000-0000-0000-0000-000000000001'::uuid;
  v_transfer_id     uuid := 't1000000-0000-0000-0000-000000000001'::uuid;
  v_waste_id        uuid := 'w1000000-0000-0000-0000-000000000001'::uuid;
  v_prop_id         uuid := 'p1000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- 1. Insert test users in auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_keeper_id,       'sod_keeper@example.test'),
    (v_acct_id,         'sod_acct@example.test'),
    (v_fc_id,           'sod_fc@example.test'),
    (v_runner_id,       'sod_runner@example.test'),
    (v_req_id,          'sod_req@example.test'),
    (v_other_keeper_id, 'sod_other_keeper@example.test'),
    (v_other_fc_id,     'sod_other_fc@example.test'),
    (v_rm_id,           'sod_rm@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert test users in public.m_users
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES
    (v_keeper_id::text,       'sod_keeper@example.test',       'SOD Storekeeper',       true),
    (v_acct_id::text,         'sod_acct@example.test',         'SOD Accountant',        true),
    (v_fc_id::text,           'sod_fc@example.test',           'SOD FC Approver',       true),
    (v_runner_id::text,       'sod_runner@example.test',       'SOD Kitchen Runner',    true),
    (v_req_id::text,          'sod_req@example.test',          'SOD Kitchen Requester', true),
    (v_other_keeper_id::text, 'sod_other_keeper@example.test', 'SOD Second Keeper',     true),
    (v_other_fc_id::text,     'sod_other_fc@example.test',     'SOD Independent FC',    true),
    (v_rm_id::text,           'sod_rm@example.test',           'SOD Restaurant Manager',true)
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Permissions mapping
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-sod-keeper',   v_keeper_id::text,       'ADMIN'::user_role,        'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-sod-acct',     v_acct_id::text,         'ACCOUNTANT'::user_role,   'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-sod-fc',       v_fc_id::text,           'APPROVER'::user_role,     'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-sod-runner',   v_runner_id::text,       'RUNNER'::user_role,       'IND-DEL-01', NULL,           'KITCHEN'::section_id),
    ('perm-sod-req',      v_req_id::text,          'KITCHEN_REQ'::user_role,  'IND-DEL-01', NULL,           'KITCHEN'::section_id),
    ('perm-sod-otherk',   v_other_keeper_id::text, 'ADMIN'::user_role,        'IND-DEL-02', 'WH-DEL02-DRY', 'ALL'::section_id),
    ('perm-sod-otherfc',  v_other_fc_id::text,     'APPROVER'::user_role,     'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-sod-rm',       v_rm_id::text,           'RM'::user_role,           'IND-DEL-01', NULL,           'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- 4. Stores & Warehouses
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

  -- 5. Items
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES ('ITM-SOD-001', 'Segregation Test Item', 'DRY_GOODS', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- Initial shelf stock
  INSERT INTO public.t_stock_movements (
    movement_id, store_id, warehouse_id, item_code, movement_type,
    quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
  ) VALUES (
    'm2000000-0000-0000-0000-000000000001'::uuid,
    'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-SOD-001', 'GRPO_IMPORT',
    200.000, 'kg', 'BAT-SOD-001', CURRENT_DATE + 60, 'REF-SOD-INIT', v_keeper_id::text
  ) ON CONFLICT (movement_id) DO NOTHING;

  -- Fixture for SoD 1: Stock Count and Adjustment
  INSERT INTO public.t_stock_counts (
    count_id, store_id, warehouse_id, count_type, count_date,
    keeper_user_id, accountant_user_id, status
  ) VALUES (
    v_count_id, 'IND-DEL-01', 'WH-DEL01-DRY', 'CYCLE_COUNT', CURRENT_DATE,
    v_keeper_id, v_acct_id, 'IN_PROGRESS'
  ) ON CONFLICT (count_id) DO NOTHING;

  -- Fixture for SoD 2: Transfer In-Transit
  INSERT INTO public.t_transfer_intransit (
    transfer_id, source_store_id, source_warehouse_id,
    target_store_id, target_warehouse_id, item_code,
    dispatch_qty_kg, uom, batch_number, expiry_date,
    status, dispatcher_user_id
  ) VALUES (
    v_transfer_id, 'IND-DEL-01', 'WH-DEL01-DRY',
    'IND-DEL-02', 'WH-DEL02-DRY', 'ITM-SOD-001',
    15.000, 'kg', 'BAT-SOD-001', CURRENT_DATE + 60,
    'IN_TRANSIT', v_keeper_id
  ) ON CONFLICT (transfer_id) DO NOTHING;

  -- Fixture for SoD 3: Waste Claim
  INSERT INTO public.t_waste_threshold_config (store_id, minor_threshold_qty)
  VALUES ('IND-DEL-01', 5.000)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.t_waste_returns_log (
    log_id, store_id, warehouse_id, item_code, movement_type,
    quantity, uom, batch_number, expiry_date, reason_code,
    logged_by_user_id, approver_decision
  ) VALUES (
    v_waste_id, 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-SOD-001', 'WASTE_DISPOSAL',
    3.000, 'kg', 'BAT-SOD-001', CURRENT_DATE + 60, 'SPOILED_BATCH',
    v_keeper_id, 'PENDING'
  ) ON CONFLICT (log_id) DO NOTHING;

  -- Fixture for SoD 4: Staged Issue Requisition
  INSERT INTO public.t_requests (
    request_id, store_id, section_id, requester_user_id, status
  ) VALUES (
    v_req_c2_id, 'IND-DEL-01', 'KITCHEN', v_req_id, 'QUEUED'
  ) ON CONFLICT (request_id) DO NOTHING;

  INSERT INTO public.t_request_items (
    request_item_id, request_id, item_code, requested_qty, uom
  ) VALUES (
    v_req_item_id, v_req_c2_id, 'ITM-SOD-001', 5.000, 'kg'
  ) ON CONFLICT (request_item_id) DO NOTHING;

  -- Fixture for SoD 5: Store/Warehouse Proposal
  INSERT INTO public.t_store_warehouse_approvals (
    approval_id, proposal_type, store_id, warehouse_id,
    proposed_name, floor_level, storage_type,
    requested_by_user_id, fc_decision
  ) VALUES (
    v_prop_id, 'NEW_WAREHOUSE', 'IND-DEL-01', 'WH-DEL01-EXTRA',
    'Extra Dry Storage Room', 'BASEMENT', 'DRY_STORE',
    v_fc_id, 'PENDING'
  ) ON CONFLICT (approval_id) DO NOTHING;

END $$;

-- ============================================================================
-- 1. PRECONDITIONS & CONSTRAINT REGISTRATION
-- ============================================================================
SELECT has_trigger(
  'public', 't_stock_adjustments', 'trg_enforce_stock_adjustment_sod',
  'Trigger trg_enforce_stock_adjustment_sod is active on t_stock_adjustments'
);

SELECT col_has_check(
  'public', 't_transfer_intransit', 'receiver_user_id',
  'Check constraint chk_transfer_distinct_users exists on t_transfer_intransit'
);

SELECT col_has_check(
  'public', 't_waste_returns_log', 'approver_user_id',
  'Check constraint chk_waste_distinct_users exists on t_waste_returns_log'
);

-- ============================================================================
-- 2. STOCK COUNT ADJUSTMENT SOD: COUNTER CANNOT APPROVE OWN VOUCHER
-- ============================================================================
-- Attack 2.1: Direct INSERT into t_stock_adjustments with keeper as approver
SELECT throws_ok(
  $$ INSERT INTO public.t_stock_adjustments (
       count_id, warehouse_id, item_code, variance_qty, uom, reason_code, fc_approval_id
     ) VALUES (
       'c1000000-0000-0000-0000-000000000001'::uuid, 'WH-DEL01-DRY', 'ITM-SOD-001',
       -2.000, 'kg', 'DAMAGED_BAG', 'b0000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  '23514',
  'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.',
  'Direct INSERT with keeper counter as fc_approval_id throws 23514 SoD exception'
);

-- Attack 2.2: Direct INSERT into t_stock_adjustments with accountant as approver
SELECT throws_ok(
  $$ INSERT INTO public.t_stock_adjustments (
       count_id, warehouse_id, item_code, variance_qty, uom, reason_code, fc_approval_id
     ) VALUES (
       'c1000000-0000-0000-0000-000000000001'::uuid, 'WH-DEL01-DRY', 'ITM-SOD-001',
       -2.000, 'kg', 'DAMAGED_BAG', 'b0000000-0000-0000-0000-000000000002'::uuid
     ) $$,
  '23514',
  'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.',
  'Direct INSERT with accountant counter as fc_approval_id throws 23514 SoD exception'
);

-- Setup pending adjustment voucher for UPDATE & RPC tests
INSERT INTO public.t_stock_adjustments (
  adjustment_id, count_id, warehouse_id, item_code, variance_qty, uom, reason_code, fc_approval_id
) VALUES (
  'a2000000-0000-0000-0000-000000000001'::uuid,
  'c1000000-0000-0000-0000-000000000001'::uuid,
  'WH-DEL01-DRY', 'ITM-SOD-001', -2.000, 'kg', 'DAMAGED_BAG', NULL
) ON CONFLICT (adjustment_id) DO NOTHING;

-- Attack 2.3: Direct UPDATE setting fc_approval_id = keeper_user_id
SELECT throws_ok(
  $$ UPDATE public.t_stock_adjustments
     SET fc_approval_id = 'b0000000-0000-0000-0000-000000000001'::uuid
     WHERE adjustment_id = 'a2000000-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.',
  'Direct UPDATE setting keeper counter as approver is blocked by SoD trigger'
);

-- Attack 2.4: Direct UPDATE setting fc_approval_id = accountant_user_id
SELECT throws_ok(
  $$ UPDATE public.t_stock_adjustments
     SET fc_approval_id = 'b0000000-0000-0000-0000-000000000002'::uuid
     WHERE adjustment_id = 'a2000000-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.',
  'Direct UPDATE setting accountant counter as approver is blocked by SoD trigger'
);

-- Attack 2.5: Keeper calls approve_stock_adjustment RPC
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'APPROVER'; -- Rogue role override attempt
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.approve_stock_adjustment('a2000000-0000-0000-0000-000000000001'::uuid, 'Rogue keeper approval') $$,
  '23514',
  'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.',
  'Keeper calling approve_stock_adjustment RPC throws 23514 SoD violation'
);

-- Attack 2.6: Accountant calls approve_stock_adjustment RPC
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT throws_ok(
  $$ SELECT public.approve_stock_adjustment('a2000000-0000-0000-0000-000000000001'::uuid, 'Rogue accountant approval') $$,
  '23514',
  'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.',
  'Accountant calling approve_stock_adjustment RPC throws 23514 SoD violation'
);

-- Proof: Independent FC (v_fc_id) successfully approves
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  $$ SELECT public.approve_stock_adjustment('a2000000-0000-0000-0000-000000000001'::uuid, 'Legitimate FC approval') $$,
  'Independent Financial Controller successfully approves adjustment voucher'
);
RESET ROLE;

-- ============================================================================
-- 3. TRANSFER IN-TRANSIT SOD: DISPATCHER CANNOT RECEIVE OWN TRANSFER
-- ============================================================================
-- Attack 3.1: Direct INSERT with dispatcher_user_id = receiver_user_id
SELECT throws_ok(
  $$ INSERT INTO public.t_transfer_intransit (
       source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
       item_code, dispatch_qty_kg, uom, status, dispatcher_user_id, receiver_user_id
     ) VALUES (
       'IND-DEL-01', 'WH-DEL01-DRY', 'IND-DEL-02', 'WH-DEL02-DRY',
       'ITM-SOD-001', 10.000, 'kg', 'IN_TRANSIT',
       'b0000000-0000-0000-0000-000000000001'::uuid,
       'b0000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  '23514',
  NULL,
  'Direct INSERT on t_transfer_intransit with identical dispatcher and receiver throws 23514 check violation'
);

-- Attack 3.2: Direct UPDATE setting receiver_user_id equal to dispatcher_user_id
SELECT throws_ok(
  $$ UPDATE public.t_transfer_intransit
     SET receiver_user_id = 'b0000000-0000-0000-0000-000000000001'::uuid
     WHERE transfer_id = 't1000000-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  NULL,
  'Direct UPDATE setting receiver equal to dispatcher violates chk_transfer_distinct_users'
);

-- Attack 3.3: Dispatcher calling receive_store_transfer RPC
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02'; -- Simulating physical presence at target store

SELECT throws_ok(
  $$ SELECT public.receive_store_transfer('t1000000-0000-0000-0000-000000000001'::uuid, 15.000, NULL) $$,
  'P0001',
  'Segregation of duties violation: Transfer dispatcher cannot receive their own transfer.',
  'Dispatcher calling receive_store_transfer RPC throws segregation of duties exception'
);

-- Attack 3.4: Dispatcher attempting to approve variance on own transfer
SELECT throws_ok(
  $$ SELECT public.approve_transfer_variance('t1000000-0000-0000-0000-000000000001'::uuid, 'Rogue variance approval') $$,
  'P0001',
  'Segregation of duties violation: Transfer dispatcher cannot approve their own transfer variance.',
  'Dispatcher calling approve_transfer_variance RPC throws segregation of duties exception'
);

-- Proof: Independent receiver (v_other_keeper_id) successfully receives transfer
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT lives_ok(
  $$ SELECT public.receive_store_transfer('t1000000-0000-0000-0000-000000000001'::uuid, 15.000, NULL) $$,
  'Independent receiver at target store successfully receives transfer'
);
RESET ROLE;

-- ============================================================================
-- 4. WASTE RETURNS SOD: LOGGER CANNOT APPROVE OWN CLAIM
-- ============================================================================
-- Attack 4.1: Direct INSERT with logged_by_user_id = approver_user_id
SELECT throws_ok(
  $$ INSERT INTO public.t_waste_returns_log (
       store_id, warehouse_id, item_code, movement_type,
       quantity, uom, reason_code, logged_by_user_id, approver_user_id
     ) VALUES (
       'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-SOD-001', 'WASTE_DISPOSAL',
       4.000, 'kg', 'DAMAGED_BAG',
       'b0000000-0000-0000-0000-000000000001'::uuid,
       'b0000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  '23514',
  NULL,
  'Direct INSERT on t_waste_returns_log with identical logger and approver violates chk_waste_distinct_users'
);

-- Attack 4.2: Direct UPDATE setting approver_user_id equal to logged_by_user_id
SELECT throws_ok(
  $$ UPDATE public.t_waste_returns_log
     SET approver_user_id = 'b0000000-0000-0000-0000-000000000001'::uuid
     WHERE log_id = 'w1000000-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  NULL,
  'Direct UPDATE setting approver equal to logger violates chk_waste_distinct_users'
);

-- Attack 4.3: Logger keeper calls approve_waste_or_return RPC
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'RM'; -- Spoofing RM role to approve minor waste
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return('w1000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'Self approval') $$,
  'P0001',
  'Segregation of duties violation: Logger cannot approve or reject own claim.',
  'Logger calling approve_waste_or_return RPC throws segregation of duties exception'
);

-- Proof: Independent Restaurant Manager (v_rm_id) approves minor waste
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000008';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000008';
SET LOCAL "app.current_role" = 'RM';

SELECT lives_ok(
  $$ SELECT public.approve_waste_or_return('w1000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'Legitimate RM approval') $$,
  'Independent Restaurant Manager successfully approves minor waste claim'
);
RESET ROLE;

-- ============================================================================
-- 5. ISSUE CONFIRMATION SOD: STAGING KEEPER CANNOT CONFIRM RECEIPT AT DOOR
-- ============================================================================
-- First, Keeper stages stock (advancing request to AWAITING_RUNNER and appending ISSUE_PENDING)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT public.stage_issue(
  'r1000000-0000-0000-0000-000000000001'::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'request_item_id', 'r2000000-0000-0000-0000-000000000001'::uuid,
      'staged_qty', 5.000,
      'warehouse_id', 'WH-DEL01-DRY',
      'batch_number', 'BAT-SOD-001',
      'expiry_date', CURRENT_DATE + 60
    )
  )
);

-- Attack 5.1: Staging keeper attempts to confirm receipt at door as themselves
SELECT throws_ok(
  $$ SELECT public.confirm_issue(
       'r1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'r2000000-0000-0000-0000-000000000001'::uuid,
           'accepted_qty', 5.000
         )
       )
     ) $$,
  'P0001',
  'Segregation of duties violation: Staging keeper cannot confirm their own issue.',
  'Staging keeper calling confirm_issue throws segregation of duties exception'
);

-- Attack 5.2: Staging keeper attempts role spoof to RUNNER
SET LOCAL "app.current_role" = 'RUNNER';
SELECT throws_ok(
  $$ SELECT public.confirm_issue(
       'r1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'r2000000-0000-0000-0000-000000000001'::uuid,
           'accepted_qty', 5.000
         )
       )
     ) $$,
  'P0001',
  'Segregation of duties violation: Staging keeper cannot confirm their own issue.',
  'Staging keeper with spoofed RUNNER role still blocked by user identity SoD check'
);

-- Proof: Independent Kitchen Runner (v_runner_id) confirms receipt at door
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT lives_ok(
  $$ SELECT public.confirm_issue(
       'r1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'r2000000-0000-0000-0000-000000000001'::uuid,
           'accepted_qty', 5.000
         )
       )
     ) $$,
  'Independent Kitchen Runner successfully confirms receipt at storeroom door'
);
RESET ROLE;

-- ============================================================================
-- 6. STORE/WAREHOUSE PROPOSAL SOD: PROPOSER CANNOT APPROVE OWN PROPOSAL
-- ============================================================================
-- Attack 6.1: Proposer (v_fc_id) attempts to approve own proposal
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.decide_store_warehouse_proposal(
       'p1000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'Self approval attempt'
     ) $$,
  'P0001',
  'Segregation of duties violation: Proposer cannot approve their own proposal.',
  'Proposer calling decide_store_warehouse_proposal with APPROVED throws SoD exception'
);

-- Attack 6.2: Proposer (v_fc_id) attempts to reject own proposal
SELECT throws_ok(
  $$ SELECT public.decide_store_warehouse_proposal(
       'p1000000-0000-0000-0000-000000000001'::uuid, 'REJECTED', 'Self rejection attempt'
     ) $$,
  'P0001',
  'Segregation of duties violation: Proposer cannot approve their own proposal.',
  'Proposer calling decide_store_warehouse_proposal with REJECTED throws SoD exception'
);

-- Proof: Independent FC (v_other_fc_id) successfully decides proposal
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_user_id" = 'b0000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  $$ SELECT public.decide_store_warehouse_proposal(
       'p1000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'Legitimate second-pair-of-eyes decision'
     ) $$,
  'Independent Financial Controller successfully approves proposed warehouse'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
