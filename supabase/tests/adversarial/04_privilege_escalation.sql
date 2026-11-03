-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- pgTAP Test Suite: D14 Adversarial RLS & Attack Suite - Part 4: Privilege Escalation
-- Scope:
-- 1. Non-SysAdmin cannot call create_user_invitation or assign roles
-- 2. Non-FC cannot approve major waste (> 5 kg) or stock adjustment vouchers
-- 3. Non-Keeper cannot pick or stage stock
-- 4. Requester cannot cancel or edit request once picking started (Flow C-1 lock)

BEGIN;
SELECT plan(37);

-- ============================================================================
-- 0. TEST FIXTURES SETUP
-- ============================================================================
DO $$
DECLARE
  v_sysadmin_pe   uuid := 'd0000000-0000-0000-0000-000000000001'::uuid;
  v_keeper_pe     uuid := 'd0000000-0000-0000-0000-000000000002'::uuid;
  v_req_pe        uuid := 'd0000000-0000-0000-0000-000000000003'::uuid;
  v_runner_pe     uuid := 'd0000000-0000-0000-0000-000000000004'::uuid;
  v_rm_pe         uuid := 'd0000000-0000-0000-0000-000000000005'::uuid;
  v_fc_pe         uuid := 'd0000000-0000-0000-0000-000000000006'::uuid;
  v_viewer_pe     uuid := 'd0000000-0000-0000-0000-000000000007'::uuid;
  v_accountant_pe uuid := 'd0000000-0000-0000-0000-000000000008'::uuid;

  v_req_queued_id uuid := 'e1000000-0000-0000-0000-000000000001'::uuid;
  v_item_queued_id uuid := 'e2000000-0000-0000-0000-000000000001'::uuid;

  v_req_locked_id uuid := 'e1000000-0000-0000-0000-000000000002'::uuid;
  v_item_locked_id uuid := 'e2000000-0000-0000-0000-000000000002'::uuid;

  v_waste_major_id uuid := 'e3000000-0000-0000-0000-000000000001'::uuid;
  v_count_id       uuid := 'e4000000-0000-0000-0000-000000000001'::uuid;
  v_adj_id         uuid := 'e5000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- 1. Insert test users in auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_sysadmin_pe,   'pe_sysadmin@example.test'),
    (v_keeper_pe,     'pe_keeper@example.test'),
    (v_req_pe,        'pe_requester@example.test'),
    (v_runner_pe,     'pe_runner@example.test'),
    (v_rm_pe,         'pe_rm@example.test'),
    (v_fc_pe,         'pe_fc@example.test'),
    (v_viewer_pe,     'pe_viewer@example.test'),
    (v_accountant_pe, 'pe_accountant@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert test users in public.m_users
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES
    (v_sysadmin_pe::text,   'pe_sysadmin@example.test',   'PE System Admin',       true),
    (v_keeper_pe::text,     'pe_keeper@example.test',     'PE Warehouse Keeper',   true),
    (v_req_pe::text,        'pe_requester@example.test',  'PE Kitchen Requester',  true),
    (v_runner_pe::text,     'pe_runner@example.test',     'PE Kitchen Runner',     true),
    (v_rm_pe::text,         'pe_rm@example.test',         'PE Restaurant Manager', true),
    (v_fc_pe::text,         'pe_fc@example.test',         'PE Financial Controller',true),
    (v_viewer_pe::text,     'pe_viewer@example.test',     'PE Auditor Viewer',     true),
    (v_accountant_pe::text, 'pe_accountant@example.test', 'PE Store Accountant',   true)
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Assign permissions in public.m_user_permissions
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-pe-sysadmin', v_sysadmin_pe::text,   'SYSTEM_ADMIN'::user_role, 'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-pe-keeper',   v_keeper_pe::text,     'ADMIN'::user_role,        'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-pe-req',      v_req_pe::text,        'KITCHEN_REQ'::user_role,  'IND-DEL-01', NULL,           'KITCHEN'::section_id),
    ('perm-pe-runner',   v_runner_pe::text,     'RUNNER'::user_role,       'IND-DEL-01', NULL,           'KITCHEN'::section_id),
    ('perm-pe-rm',       v_rm_pe::text,         'RM'::user_role,           'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-pe-fc',       v_fc_pe::text,         'APPROVER'::user_role,     'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-pe-viewer',   v_viewer_pe::text,     'VIEWER'::user_role,       'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-pe-acct',     v_accountant_pe::text, 'ACCOUNTANT'::user_role,   'IND-DEL-01', NULL,           'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- 4. Store and Warehouse
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES ('WH-DEL01-DRY', 'IND-DEL-01', 'Delhi Store 1 Dry Store', 'DRY_STORE', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;

  -- 5. Items
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES ('ITM-PE-001', 'Privilege Escalation Test Material', 'DRY_GOODS', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- Initial shelf stock
  INSERT INTO public.t_stock_movements (
    movement_id, store_id, warehouse_id, item_code, movement_type,
    quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
  ) VALUES (
    'm4000000-0000-0000-0000-000000000001'::uuid,
    'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-PE-001', 'GRPO_IMPORT',
    200.000, 'kg', 'BAT-PE-001', CURRENT_DATE + 60, 'REF-PE-INIT', v_keeper_pe::text
  ) ON CONFLICT (movement_id) DO NOTHING;

  -- 6. Waste Config & Major Waste Claim (> 5 kg)
  INSERT INTO public.t_waste_threshold_config (store_id, minor_threshold_qty)
  VALUES ('IND-DEL-01', 5.000)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.t_waste_returns_log (
    log_id, store_id, warehouse_id, item_code, movement_type,
    quantity, uom, batch_number, expiry_date, reason_code,
    logged_by_user_id, approver_decision
  ) VALUES (
    v_waste_major_id, 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-PE-001', 'WASTE_DISPOSAL',
    12.000, 'kg', 'BAT-PE-001', CURRENT_DATE + 60, 'CONTAMINATED',
    v_keeper_pe, 'PENDING'
  ) ON CONFLICT (log_id) DO NOTHING;

  -- 7. Count & Adjustment Voucher
  INSERT INTO public.t_stock_counts (
    count_id, store_id, warehouse_id, count_type, count_date, keeper_user_id, status
  ) VALUES (
    v_count_id, 'IND-DEL-01', 'WH-DEL01-DRY', 'CYCLE_COUNT', CURRENT_DATE, v_keeper_pe, 'IN_PROGRESS'
  ) ON CONFLICT (count_id) DO NOTHING;

  INSERT INTO public.t_stock_adjustments (
    adjustment_id, count_id, warehouse_id, item_code, variance_qty, uom, reason_code, fc_approval_id
  ) VALUES (
    v_adj_id, v_count_id, 'WH-DEL01-DRY', 'ITM-PE-001', -5.000, 'kg', 'COUNT_SHORTAGE', NULL
  ) ON CONFLICT (adjustment_id) DO NOTHING;

  -- 8. Requests:
  -- Queued request for picking & staging tests
  INSERT INTO public.t_requests (request_id, store_id, section_id, requester_user_id, status)
  VALUES (v_req_queued_id, 'IND-DEL-01', 'KITCHEN', v_req_pe, 'QUEUED')
  ON CONFLICT (request_id) DO NOTHING;

  INSERT INTO public.t_request_items (request_item_id, request_id, item_code, requested_qty, uom)
  VALUES (v_item_queued_id, v_req_queued_id, 'ITM-PE-001', 10.000, 'kg')
  ON CONFLICT (request_item_id) DO NOTHING;

  -- Locked request in status PICKING for Flow C-1 lock tests
  INSERT INTO public.t_requests (request_id, store_id, section_id, requester_user_id, status)
  VALUES (v_req_locked_id, 'IND-DEL-01', 'KITCHEN', v_req_pe, 'PICKING')
  ON CONFLICT (request_id) DO NOTHING;

  INSERT INTO public.t_request_items (request_item_id, request_id, item_code, requested_qty, uom)
  VALUES (v_item_locked_id, v_req_locked_id, 'ITM-PE-001', 7.000, 'kg')
  ON CONFLICT (request_item_id) DO NOTHING;

END $$;

-- ============================================================================
-- 1. PRECONDITIONS & LOCK TRIGGERS VERIFICATION
-- ============================================================================
SELECT ok(relrowsecurity, 'RLS is enabled on m_user_permissions')
FROM pg_class WHERE relname = 'm_user_permissions';

SELECT has_trigger(
  'public', 't_requests', 'trg_enforce_request_lock',
  'Trigger trg_enforce_request_lock is attached to t_requests'
);

SELECT has_trigger(
  'public', 't_request_items', 'trg_enforce_request_item_lock',
  'Trigger trg_enforce_request_item_lock is attached to t_request_items'
);

-- ============================================================================
-- 2. USER INVITATION & ROLE ASSIGNMENT ESCALATION (NON-SYSADMIN DENIAL)
-- ============================================================================
-- Attack 2.1: Keeper attempts to call create_user_invitation
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$ SELECT public.create_user_invitation('rogue_user@example.test', 'ADMIN'::user_role, 'IND-DEL-01') $$,
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.',
  'Keeper cannot call create_user_invitation'
);

-- Attack 2.2: Kitchen Requester attempts to call create_user_invitation
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

SELECT throws_ok(
  $$ SELECT public.create_user_invitation('rogue_user@example.test', 'ADMIN'::user_role, 'IND-DEL-01') $$,
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.',
  'Requester cannot call create_user_invitation'
);

-- Attack 2.3: Kitchen Runner attempts to call create_user_invitation
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$ SELECT public.create_user_invitation('rogue_user@example.test', 'ADMIN'::user_role, 'IND-DEL-01') $$,
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.',
  'Runner cannot call create_user_invitation'
);

-- Attack 2.4: Restaurant Manager attempts to call create_user_invitation
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RM';

SELECT throws_ok(
  $$ SELECT public.create_user_invitation('rogue_user@example.test', 'ADMIN'::user_role, 'IND-DEL-01') $$,
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.',
  'Restaurant Manager cannot call create_user_invitation'
);

-- Attack 2.5: Financial Controller attempts to call create_user_invitation
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT throws_ok(
  $$ SELECT public.create_user_invitation('rogue_user@example.test', 'ADMIN'::user_role, 'IND-DEL-01') $$,
  'P0001',
  'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.',
  'Financial Controller cannot call create_user_invitation'
);

-- Attack 2.6: Keeper attempts direct INSERT into m_user_permissions to elevate role
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$ INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id)
     VALUES ('perm-rogue-sa', 'd0000000-0000-0000-0000-000000000002', 'SYSTEM_ADMIN'::user_role, 'IND-DEL-01') $$,
  '42501',
  NULL,
  'Non-SysAdmin direct INSERT into m_user_permissions is blocked by RLS'
);

-- Attack 2.7: Requester attempts direct INSERT into m_user_permissions
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

SELECT throws_ok(
  $$ INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id)
     VALUES ('perm-rogue-req', 'd0000000-0000-0000-0000-000000000003', 'ADMIN'::user_role, 'IND-DEL-01') $$,
  '42501',
  NULL,
  'Requester direct INSERT into m_user_permissions is blocked by RLS'
);

-- Attack 2.8: Runner attempts direct UPDATE on m_user_permissions
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$ UPDATE public.m_user_permissions SET role = 'SYSTEM_ADMIN'::user_role WHERE user_id = 'd0000000-0000-0000-0000-000000000004' $$,
  '42501',
  NULL,
  'Runner direct UPDATE on m_user_permissions is blocked by RLS'
);

-- Attack 2.9: Keeper attempts direct DELETE on m_user_permissions
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$ DELETE FROM public.m_user_permissions WHERE user_id = 'd0000000-0000-0000-0000-000000000001' $$,
  '42501',
  NULL,
  'Keeper direct DELETE on m_user_permissions is blocked by RLS'
);

-- Proof: SYSTEM_ADMIN successfully creates user invitation
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'SYSTEM_ADMIN';

SELECT lives_ok(
  $$ SELECT public.create_user_invitation('new_cook@example.test', 'KITCHEN_REQ'::user_role, 'IND-DEL-01') $$,
  'SYSTEM_ADMIN successfully calls create_user_invitation'
);
RESET ROLE;

-- ============================================================================
-- 3. APPROVAL PRIVILEGE ESCALATION (MAJOR WASTE & STOCK ADJUSTMENT VOUCHERS)
-- ============================================================================
-- 3.1 Major Waste (> 5 kg) Escalation
-- Attack 3.1: RM attempts to approve 12 kg major waste (threshold is 5 kg)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return('e3000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'RM major waste approval attempt') $$,
  'P0001',
  'Unauthorized: Restaurant Manager (RM) cannot approve major waste (quantity 12.000 exceeds minor threshold 5.000). Approver (FC) role required.',
  'Restaurant Manager cannot approve major waste exceeding 5 kg threshold'
);

-- Attack 3.2: Keeper attempts to approve major waste
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return('e3000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'Keeper waste approval attempt') $$,
  'P0001',
  'Unauthorized: Only Restaurant Manager (RM) for minor waste or Financial Controller (APPROVER) can approve claims.',
  'Warehouse Keeper cannot approve waste claims'
);

-- Attack 3.3: Requester attempts to approve waste
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return('e3000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'Requester waste approval attempt') $$,
  'P0001',
  'Unauthorized: Only Restaurant Manager (RM) for minor waste or Financial Controller (APPROVER) can approve claims.',
  'Kitchen Requester cannot approve waste claims'
);

-- Proof: Financial Controller (APPROVER) successfully approves 12 kg major waste
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  $$ SELECT public.approve_waste_or_return('e3000000-0000-0000-0000-000000000001'::uuid, 'APPROVED', 'FC major waste authorized') $$,
  'Financial Controller (APPROVER) successfully approves major waste claim'
);

-- 3.2 Stock Adjustment Voucher Escalation
-- Attack 3.4: Restaurant Manager attempts to approve adjustment voucher
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RM';

SELECT throws_ok(
  $$ SELECT public.approve_stock_adjustment('e5000000-0000-0000-0000-000000000001'::uuid, 'RM rogue voucher approval') $$,
  'P0001',
  'Unauthorized: Only Financial Controller (APPROVER) or SYSTEM_ADMIN can approve stock adjustments.',
  'Restaurant Manager cannot approve stock adjustment vouchers'
);

-- Attack 3.5: Keeper attempts to approve adjustment voucher
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$ SELECT public.approve_stock_adjustment('e5000000-0000-0000-0000-000000000001'::uuid, 'Keeper rogue voucher approval') $$,
  'P0001',
  'Unauthorized: Only Financial Controller (APPROVER) or SYSTEM_ADMIN can approve stock adjustments.',
  'Warehouse Keeper cannot approve stock adjustment vouchers'
);

-- Attack 3.6: Runner attempts to approve adjustment voucher
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$ SELECT public.approve_stock_adjustment('e5000000-0000-0000-0000-000000000001'::uuid, 'Runner rogue voucher approval') $$,
  'P0001',
  'Unauthorized: Only Financial Controller (APPROVER) or SYSTEM_ADMIN can approve stock adjustments.',
  'Runner cannot approve stock adjustment vouchers'
);

-- Proof: Financial Controller (APPROVER) successfully approves stock adjustment
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  $$ SELECT public.approve_stock_adjustment('e5000000-0000-0000-0000-000000000001'::uuid, 'FC voucher authorized') $$,
  'Financial Controller (APPROVER) successfully approves stock adjustment voucher'
);
RESET ROLE;

-- ============================================================================
-- 4. WAREHOUSE OPERATIONS ESCALATION (NON-KEEPER PICKING & STAGING DENIAL)
-- ============================================================================
-- 4.1 Picking Authorization Checks
-- Attack 4.1: Kitchen Requester attempts to begin picking
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.begin_request_picking('e1000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can begin picking.',
  'Kitchen Requester cannot begin picking'
);

-- Attack 4.2: Kitchen Runner attempts to begin picking
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$ SELECT public.begin_request_picking('e1000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can begin picking.',
  'Kitchen Runner cannot begin picking'
);

-- Attack 4.3: Restaurant Manager attempts to begin picking
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RM';

SELECT throws_ok(
  $$ SELECT public.begin_request_picking('e1000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can begin picking.',
  'Restaurant Manager cannot begin picking'
);

-- Attack 4.4: Auditor Viewer attempts to begin picking
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_role" = 'VIEWER';

SELECT throws_ok(
  $$ SELECT public.begin_request_picking('e1000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can begin picking.',
  'Auditor Viewer cannot begin picking'
);

-- Proof: Warehouse Keeper (ADMIN) successfully begins picking
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT lives_ok(
  $$ SELECT public.begin_request_picking('e1000000-0000-0000-0000-000000000001'::uuid) $$,
  'Warehouse Keeper (ADMIN) successfully begins picking'
);

-- 4.2 Staging Authorization Checks (Request is now in status PICKING)
-- Attack 4.5: Kitchen Requester attempts to stage stock
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

SELECT throws_ok(
  $$ SELECT public.stage_issue(
       'e1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'e2000000-0000-0000-0000-000000000001'::uuid,
           'staged_qty', 10.000,
           'warehouse_id', 'WH-DEL01-DRY',
           'batch_number', 'BAT-PE-001',
           'expiry_date', CURRENT_DATE + 60
         )
       )
     ) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can stage stock.',
  'Kitchen Requester cannot stage stock'
);

-- Attack 4.6: Kitchen Runner attempts to stage stock
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$ SELECT public.stage_issue(
       'e1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'e2000000-0000-0000-0000-000000000001'::uuid,
           'staged_qty', 10.000,
           'warehouse_id', 'WH-DEL01-DRY',
           'batch_number', 'BAT-PE-001',
           'expiry_date', CURRENT_DATE + 60
         )
       )
     ) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can stage stock.',
  'Kitchen Runner cannot stage stock'
);

-- Attack 4.7: Restaurant Manager attempts to stage stock
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RM';

SELECT throws_ok(
  $$ SELECT public.stage_issue(
       'e1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'e2000000-0000-0000-0000-000000000001'::uuid,
           'staged_qty', 10.000,
           'warehouse_id', 'WH-DEL01-DRY',
           'batch_number', 'BAT-PE-001',
           'expiry_date', CURRENT_DATE + 60
         )
       )
     ) $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper or Custodian can stage stock.',
  'Restaurant Manager cannot stage stock'
);

-- Proof: Warehouse Keeper (ADMIN) successfully stages stock
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT lives_ok(
  $$ SELECT public.stage_issue(
       'e1000000-0000-0000-0000-000000000001'::uuid,
       jsonb_build_array(
         jsonb_build_object(
           'request_item_id', 'e2000000-0000-0000-0000-000000000001'::uuid,
           'staged_qty', 10.000,
           'warehouse_id', 'WH-DEL01-DRY',
           'batch_number', 'BAT-PE-001',
           'expiry_date', CURRENT_DATE + 60
         )
       )
     ) $$,
  'Warehouse Keeper (ADMIN) successfully stages stock for issue'
);
RESET ROLE;

-- ============================================================================
-- 5. FLOW C-1 STATUS LOCK (REQUESTER CANNOT CANCEL OR EDIT ONCE PICKING COMMENCED)
-- ============================================================================
-- Using request e1000000-0000-0000-0000-000000000002 which is in status PICKING
-- Session: Original Requester (v_req_pe)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'd0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- Attack 5.1: Requester attempts to cancel request in PICKING status
SELECT throws_ok(
  $$ SELECT public.cancel_section_request('e1000000-0000-0000-0000-000000000002'::uuid) $$,
  'P0001',
  'Cannot cancel request: request is in status PICKING, cancellation locked once picking has commenced.',
  'Requester calling cancel_section_request on PICKING request throws Flow C-1 lock exception'
);

-- Attack 5.2: Requester attempts to update items in request in PICKING status
SELECT throws_ok(
  $$ SELECT public.update_section_request(
       'e1000000-0000-0000-0000-000000000002'::uuid,
       '[{"item_code": "ITM-PE-001", "requested_qty": 20.0}]'::jsonb
     ) $$,
  'P0001',
  'Cannot edit request: request is in status PICKING, modifications locked once picking has commenced.',
  'Requester calling update_section_request on PICKING request throws Flow C-1 lock exception'
);

-- Attack 5.3: Direct UPDATE on t_requests setting status = CANCELLED_BY_REQUESTER
SELECT throws_ok(
  $$ UPDATE public.t_requests
     SET status = 'CANCELLED_BY_REQUESTER'
     WHERE request_id = 'e1000000-0000-0000-0000-000000000002'::uuid $$,
  'P0001',
  'Cannot cancel request: request is in status PICKING, only QUEUED requests can be cancelled.',
  'Direct table UPDATE on status is blocked by trigger trg_enforce_request_lock'
);

-- Attack 5.4: Direct UPDATE on t_requests modifying metadata (is_urgent)
SELECT throws_ok(
  $$ UPDATE public.t_requests
     SET is_urgent = true, urgent_reason = 'Tampered urgency'
     WHERE request_id = 'e1000000-0000-0000-0000-000000000002'::uuid $$,
  'P0001',
  'Cannot modify request fields once picking has commenced (status: PICKING).',
  'Direct table UPDATE on metadata is blocked by trigger trg_enforce_request_lock'
);

-- Attack 5.5: Direct UPDATE on t_request_items altering requested quantity
SELECT throws_ok(
  $$ UPDATE public.t_request_items
     SET requested_qty = 99.000
     WHERE request_item_id = 'e2000000-0000-0000-0000-000000000002'::uuid $$,
  'P0001',
  'Cannot modify item: request is in status PICKING, modifications locked once picking has commenced.',
  'Direct UPDATE on requested line items is blocked by trigger trg_enforce_request_item_lock'
);

-- Attack 5.6: Direct DELETE on t_request_items
SELECT throws_ok(
  $$ DELETE FROM public.t_request_items
     WHERE request_item_id = 'e2000000-0000-0000-0000-000000000002'::uuid $$,
  'P0001',
  'Cannot delete item: request is in status PICKING, modifications locked once picking has commenced.',
  'Direct DELETE on line items is blocked by trigger trg_enforce_request_item_lock'
);

-- Attack 5.7: Direct INSERT into t_request_items adding extra items
SELECT throws_ok(
  $$ INSERT INTO public.t_request_items (request_id, item_code, requested_qty, uom)
     VALUES ('e1000000-0000-0000-0000-000000000002'::uuid, 'ITM-PE-001', 5.000, 'kg') $$,
  'P0001',
  'Cannot add item: request is in status PICKING, modifications locked once picking has commenced.',
  'Direct INSERT of new line items into locked request is blocked by trigger trg_enforce_request_item_lock'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
