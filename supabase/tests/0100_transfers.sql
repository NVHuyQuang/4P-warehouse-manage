-- pgTAP Test Suite for Domain D10: Store Transfers
-- Tables: t_transfer_intransit
-- RPCs: dispatch_store_transfer, receive_store_transfer, approve_transfer_variance, reject_transfer_variance
-- Invariants: Physical quantities and unit counts only. Strictly non-commercial inventory movements.

BEGIN;
SELECT plan(84);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_disp_id uuid  := 'e0000000-0000-0000-0000-000000000001'::uuid;
  v_recv_id uuid  := 'e0000000-0000-0000-0000-000000000002'::uuid;
  v_fc_id   uuid  := 'e0000000-0000-0000-0000-000000000003'::uuid;
  v_unauth_id uuid:= 'e0000000-0000-0000-0000-000000000004'::uuid;
BEGIN
  -- 1. Insert test users into auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_disp_id,   'test_disp_admin@example.test'),
    (v_recv_id,   'test_recv_admin@example.test'),
    (v_fc_id,     'test_fc_approver@example.test'),
    (v_unauth_id, 'test_unauth_runner@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert test users into public.m_users
  INSERT INTO public.m_users (user_id, email, full_name, failed_login_count, is_active)
  VALUES
    (v_disp_id::text,   'test_disp_admin@example.test',   'Test Dispatcher Admin',   0, true),
    (v_recv_id::text,   'test_recv_admin@example.test',   'Test Receiver Admin',     0, true),
    (v_fc_id::text,     'test_fc_approver@example.test', 'Test FC Approver',        0, true),
    (v_unauth_id::text, 'test_unauth_runner@example.test', 'Test Runner User',       0, true)
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Ensure test warehouses exist for Target Store IND-DEL-02
  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, floor_level, storage_type, status, is_active)
  VALUES
    ('WH-DEL02-COLD', 'IND-DEL-02', 'Delhi Store 2 Cold Room', 'GROUND', 'COLD_ROOM', 'ACTIVE', true),
    ('WH-DEL02-DRY',  'IND-DEL-02', 'Delhi Store 2 Dry Store', 'GROUND', 'DRY_STORE', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 1. SCHEMA STRUCTURE & TYPE CHECKS
-- ---------------------------------------------------------------------------
-- 1.1 Table existence
SELECT has_table('public', 't_transfer_intransit', 'Table t_transfer_intransit exists');

-- 1.2 Primary key
SELECT col_is_pk('public', 't_transfer_intransit', 'transfer_id', 't_transfer_intransit.transfer_id is primary key');

-- 1.3 Exact columns
SELECT columns_are(
  'public',
  't_transfer_intransit',
  ARRAY[
    'transfer_id',
    'source_store_id',
    'source_warehouse_id',
    'target_store_id',
    'target_warehouse_id',
    'item_code',
    'dispatch_qty_kg',
    'dispatch_qty_pcs',
    'vehicle_seal_no',
    'dispatcher_user_id',
    'dispatched_at',
    'receive_qty_kg',
    'receive_qty_pcs',
    'receiver_user_id',
    'received_at',
    'variance_qty',
    'fc_approval_id',
    'status',
    'out_movement_id',
    'in_movement_id',
    'notes',
    'created_at',
    'updated_at'
  ],
  't_transfer_intransit has exact expected columns'
);

-- 1.4 Column types
SELECT col_type_is('public', 't_transfer_intransit', 'transfer_id', 'uuid', 'transfer_id is uuid');
SELECT col_type_is('public', 't_transfer_intransit', 'source_store_id', 'text', 'source_store_id is text');
SELECT col_type_is('public', 't_transfer_intransit', 'source_warehouse_id', 'text', 'source_warehouse_id is text');
SELECT col_type_is('public', 't_transfer_intransit', 'target_store_id', 'text', 'target_store_id is text');
SELECT col_type_is('public', 't_transfer_intransit', 'target_warehouse_id', 'text', 'target_warehouse_id is text');
SELECT col_type_is('public', 't_transfer_intransit', 'item_code', 'text', 'item_code is text');
SELECT col_type_is('public', 't_transfer_intransit', 'dispatch_qty_kg', 'numeric(12,3)', 'dispatch_qty_kg is numeric(12,3)');
SELECT col_type_is('public', 't_transfer_intransit', 'dispatch_qty_pcs', 'numeric(12,3)', 'dispatch_qty_pcs is numeric(12,3)');
SELECT col_type_is('public', 't_transfer_intransit', 'vehicle_seal_no', 'text', 'vehicle_seal_no is text');
SELECT col_type_is('public', 't_transfer_intransit', 'dispatcher_user_id', 'uuid', 'dispatcher_user_id is uuid');
SELECT col_type_is('public', 't_transfer_intransit', 'receive_qty_kg', 'numeric(12,3)', 'receive_qty_kg is numeric(12,3)');
SELECT col_type_is('public', 't_transfer_intransit', 'receive_qty_pcs', 'numeric(12,3)', 'receive_qty_pcs is numeric(12,3)');
SELECT col_type_is('public', 't_transfer_intransit', 'receiver_user_id', 'uuid', 'receiver_user_id is uuid');
SELECT col_type_is('public', 't_transfer_intransit', 'variance_qty', 'numeric(12,3)', 'variance_qty is numeric(12,3)');
SELECT col_type_is('public', 't_transfer_intransit', 'fc_approval_id', 'uuid', 'fc_approval_id is uuid');
SELECT col_type_is('public', 't_transfer_intransit', 'status', 'text', 'status is text');
SELECT col_type_is('public', 't_transfer_intransit', 'out_movement_id', 'uuid', 'out_movement_id is uuid');
SELECT col_type_is('public', 't_transfer_intransit', 'in_movement_id', 'uuid', 'in_movement_id is uuid');
SELECT col_type_is('public', 't_transfer_intransit', 'notes', 'text', 'notes is text');

-- 1.5 Foreign keys
SELECT fk_ok('public', 't_transfer_intransit', 'source_store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_transfer_intransit', 'source_warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_transfer_intransit', 'target_store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_transfer_intransit', 'target_warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_transfer_intransit', 'item_code', 'public', 'm_items', 'item_code');
SELECT fk_ok('public', 't_transfer_intransit', 'dispatcher_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_transfer_intransit', 'receiver_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_transfer_intransit', 'fc_approval_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_transfer_intransit', 'out_movement_id', 'public', 't_stock_movements', 'movement_id');
SELECT fk_ok('public', 't_transfer_intransit', 'in_movement_id', 'public', 't_stock_movements', 'movement_id');

-- 1.6 RPC functions existence
SELECT has_function('public', 'dispatch_store_transfer', ARRAY['text', 'text', 'text', 'text', 'text', 'numeric', 'numeric', 'text'], 'dispatch_store_transfer exists');
SELECT has_function('public', 'receive_store_transfer', ARRAY['uuid', 'numeric', 'numeric'], 'receive_store_transfer exists');
SELECT has_function('public', 'approve_transfer_variance', ARRAY['uuid', 'text'], 'approve_transfer_variance exists');
SELECT has_function('public', 'reject_transfer_variance', ARRAY['uuid', 'text'], 'reject_transfer_variance exists');

-- 1.7 RLS enabled
SELECT is(rowsecurity, true, 't_transfer_intransit has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_transfer_intransit';

-- ---------------------------------------------------------------------------
-- 2. TABLE CONSTRAINTS & INTEGRITY CHECKS
-- ---------------------------------------------------------------------------
-- 2.1 Identical source and target store blocked
SELECT throws_ok(
  $$
    INSERT INTO public.t_transfer_intransit (
      source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
      item_code, dispatch_qty_kg, vehicle_seal_no, dispatcher_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-01', 'WH-DEL01-DRY',
      'ITM-DRY-001', 10.000, 'SEAL-ERR-01', 'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_transfer_different_stores blocks transfer to same store'
);

-- 2.2 Receiver cannot equal dispatcher
SELECT throws_ok(
  $$
    INSERT INTO public.t_transfer_intransit (
      source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
      item_code, dispatch_qty_kg, vehicle_seal_no, dispatcher_user_id, receiver_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-DRY-001', 10.000, 'SEAL-ERR-02',
      'e0000000-0000-0000-0000-000000000001'::uuid,
      'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_transfer_distinct_users blocks identical dispatcher and receiver'
);

-- 2.3 FC Approver cannot equal dispatcher
SELECT throws_ok(
  $$
    INSERT INTO public.t_transfer_intransit (
      source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
      item_code, dispatch_qty_kg, vehicle_seal_no, dispatcher_user_id, fc_approval_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-DRY-001', 10.000, 'SEAL-ERR-03',
      'e0000000-0000-0000-0000-000000000001'::uuid,
      'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_transfer_distinct_fc blocks identical dispatcher and FC approver'
);

-- 2.4 Non-positive dispatch quantity rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_transfer_intransit (
      source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
      item_code, dispatch_qty_kg, vehicle_seal_no, dispatcher_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-DRY-001', 0.000, 'SEAL-ERR-04', 'e0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint checks dispatch_qty_kg > 0'
);

-- 2.5 Invalid status rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_transfer_intransit (
      source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
      item_code, dispatch_qty_kg, vehicle_seal_no, dispatcher_user_id, status
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-DRY-001', 10.000, 'SEAL-ERR-05', 'e0000000-0000-0000-0000-000000000001'::uuid,
      'INVALID_TRANSFER_STATUS'
    );
  $$,
  '23514',
  NULL,
  'Constraint checks valid transfer status'
);

-- ---------------------------------------------------------------------------
-- 3. IMMUTABILITY & APPEND-ONLY GUARANTEES
-- ---------------------------------------------------------------------------
-- Insert a sample transfer directly to test immutability triggers
INSERT INTO public.t_transfer_intransit (
  transfer_id, source_store_id, source_warehouse_id, target_store_id, target_warehouse_id,
  item_code, dispatch_qty_kg, vehicle_seal_no, dispatcher_user_id, status
) VALUES (
  'e0000000-0000-0000-0000-000000000099'::uuid,
  'IND-DEL-01', 'WH-DEL01-DRY', 'IND-DEL-02', 'WH-DEL02-DRY',
  'ITM-DRY-001', 5.000, 'SEAL-IMMUTABLE-01', 'e0000000-0000-0000-0000-000000000001'::uuid, 'IN_TRANSIT'
);

SELECT throws_ok(
  'DELETE FROM public.t_transfer_intransit WHERE transfer_id = ''e0000000-0000-0000-0000-000000000099''::uuid',
  'P0001',
  'Transfer records cannot be deleted.',
  'DELETE on t_transfer_intransit is blocked by immutability trigger'
);

SELECT throws_ok(
  'UPDATE public.t_stock_movements SET quantity = 999.000 WHERE item_code = ''ITM-DRY-001'' LIMIT 1',
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'UPDATE on t_stock_movements is blocked by append-only trigger'
);

SELECT throws_ok(
  'DELETE FROM public.t_stock_movements WHERE item_code = ''ITM-DRY-001'' LIMIT 1',
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'DELETE on t_stock_movements is blocked by append-only trigger'
);

-- ---------------------------------------------------------------------------
-- 4. DUAL-UNIT RULE VALIDATIONS (Cheese & Meat)
-- ---------------------------------------------------------------------------
-- Set caller as Store 1 Admin
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 4.1 Cheese item missing piece count throws
SELECT throws_ok(
  $$
    SELECT public.dispatch_store_transfer(
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-CHZ-001', 12.000, NULL, 'SEAL-DUAL-01'
    );
  $$,
  'P0001',
  'Dual-unit required: Cheese and meat items require both dispatch_qty_kg and dispatch_qty_pcs.',
  'Cheese item without pieces is blocked by dual-unit rule'
);

-- 4.2 Meat item missing piece count throws
SELECT throws_ok(
  $$
    SELECT public.dispatch_store_transfer(
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-MET-001', 8.000, NULL, 'SEAL-DUAL-02'
    );
  $$,
  'P0001',
  'Dual-unit required: Cheese and meat items require both dispatch_qty_kg and dispatch_qty_pcs.',
  'Meat item without pieces is blocked by dual-unit rule'
);

-- 4.3 Dry Goods without piece count succeeds
SELECT lives_ok(
  $$
    SELECT public.dispatch_store_transfer(
      'IND-DEL-01', 'WH-DEL01-DRY', 'IND-DEL-02', 'WH-DEL02-DRY',
      'ITM-DRY-001', 20.000, NULL, 'SEAL-DRY-01'
    );
  $$,
  'Dry goods transfer without pieces succeeds'
);

-- ---------------------------------------------------------------------------
-- 5. SCENARIO 1: TRANSFER CREATION & IN-TRANSIT MOVEMENT
-- ---------------------------------------------------------------------------
-- Store 1 Admin dispatches 15.000 kg (15 pcs) Mozzarella Fior di Latte to Store 2
DO $$
DECLARE
  v_tid uuid;
BEGIN
  v_tid := public.dispatch_store_transfer(
    'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
    'ITM-CHZ-001', 15.000, 15.000, 'SEAL-PERFECT-01'
  );
  PERFORM set_config('app.test_transfer_1', v_tid::text, true);
END $$;

SELECT ok(
  current_setting('app.test_transfer_1', true) IS NOT NULL,
  'Dispatch cheese transfer with dual-units succeeds'
);

SELECT is(
  status,
  'IN_TRANSIT',
  'Transfer status is initially IN_TRANSIT'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT is(
  dispatch_qty_kg,
  15.000,
  'Transfer dispatch_qty_kg is 15.000'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT is(
  dispatch_qty_pcs,
  15.000,
  'Transfer dispatch_qty_pcs is 15.000'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT ok(
  out_movement_id IS NOT NULL,
  'Transfer out_movement_id is populated'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT is(
  quantity,
  -15.000,
  'Outbound movement quantity is -15.000 kg'
) FROM public.t_stock_movements
WHERE movement_id = (SELECT out_movement_id FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid);

SELECT is(
  movement_type,
  'TRANSFER_OUT_INTRANSIT',
  'Outbound movement type is TRANSFER_OUT_INTRANSIT'
) FROM public.t_stock_movements
WHERE movement_id = (SELECT out_movement_id FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid);

-- ---------------------------------------------------------------------------
-- 6. SCENARIO 2: SEGREGATION OF DUTIES ENFORCEMENT (RPC LEVEL)
-- ---------------------------------------------------------------------------
-- Dispatcher attempts to receive their own transfer
SELECT throws_ok(
  $$
    SELECT public.receive_store_transfer(
      current_setting('app.test_transfer_1', true)::uuid,
      15.000,
      15.000
    );
  $$,
  'P0001',
  'Segregation of duties violation: Transfer dispatcher cannot receive their own transfer.',
  'Dispatcher cannot receive their own transfer'
);

-- ---------------------------------------------------------------------------
-- 7. SCENARIO 3: PERFECT MATCH RECEIPT
-- ---------------------------------------------------------------------------
-- Switch session context to Store 2 Admin (Receiver)
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT lives_ok(
  $$
    SELECT public.receive_store_transfer(
      current_setting('app.test_transfer_1', true)::uuid,
      15.000,
      15.000
    );
  $$,
  'Receiver confirms perfect match receipt via RPC'
);

SELECT is(
  status,
  'RECEIVED_MATCH',
  'Transfer status transitions to RECEIVED_MATCH'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT is(
  variance_qty,
  0.000,
  'Transfer variance_qty is 0.000 on match'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT is(
  receiver_user_id,
  'e0000000-0000-0000-0000-000000000002'::uuid,
  'Receiver user id is recorded on transfer'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT ok(
  in_movement_id IS NOT NULL,
  'Transfer in_movement_id is populated on match'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid;

SELECT is(
  quantity,
  15.000,
  'Inbound movement quantity is +15.000 kg'
) FROM public.t_stock_movements
WHERE movement_id = (SELECT in_movement_id FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid);

SELECT is(
  movement_type,
  'TRANSFER_IN_RECEIVED',
  'Inbound movement type is TRANSFER_IN_RECEIVED'
) FROM public.t_stock_movements
WHERE movement_id = (SELECT in_movement_id FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_1', true)::uuid);

-- ---------------------------------------------------------------------------
-- 8. SCENARIO 4: VARIANCE FLOW & FC APPROVAL
-- ---------------------------------------------------------------------------
-- Switch back to Store 1 Admin to dispatch a second transfer
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

DO $$
DECLARE
  v_tid uuid;
BEGIN
  v_tid := public.dispatch_store_transfer(
    'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
    'ITM-CHZ-001', 25.000, 25.000, 'SEAL-VARIANCE-02'
  );
  PERFORM set_config('app.test_transfer_2', v_tid::text, true);
END $$;

SELECT ok(
  current_setting('app.test_transfer_2', true) IS NOT NULL,
  'Dispatch second cheese transfer for variance testing'
);

-- Switch to Store 2 Admin to receive with variance: 22.5 kg (22 pcs) instead of 25.0 kg
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT lives_ok(
  $$
    SELECT public.receive_store_transfer(
      current_setting('app.test_transfer_2', true)::uuid,
      22.500,
      22.000
    );
  $$,
  'Receiver receives transfer with quantity discrepancy'
);

SELECT is(
  status,
  'VARIANCE_PENDING_FC',
  'Transfer status transitions to VARIANCE_PENDING_FC'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid;

SELECT is(
  variance_qty,
  -2.500,
  'Transfer variance_qty is -2.500 kg'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid;

SELECT ok(
  in_movement_id IS NULL,
  'No inbound movement booked yet while pending FC approval'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid;

-- Non-FC role (Store 2 Admin) cannot approve variance
SELECT throws_ok(
  $$
    SELECT public.approve_transfer_variance(
      current_setting('app.test_transfer_2', true)::uuid,
      'Attempted unauthorized approval'
    );
  $$,
  'P0001',
  'Unauthorized: Only Financial Controller (APPROVER) or System Admin can approve transfer variances.',
  'Admin cannot approve transfer variance'
);

-- Dispatcher cannot approve their own transfer variance
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'APPROVER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.approve_transfer_variance(
      current_setting('app.test_transfer_2', true)::uuid,
      'Dispatcher trying to approve'
    );
  $$,
  'P0001',
  'Segregation of duties violation: Transfer dispatcher cannot approve their own transfer variance.',
  'Dispatcher cannot approve their own transfer variance'
);

-- Cannot re-receive a transfer already processed into VARIANCE_PENDING_FC
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$
    SELECT public.receive_store_transfer(
      current_setting('app.test_transfer_2', true)::uuid,
      25.000,
      25.000
    );
  $$,
  'P0001',
  NULL,
  'Cannot receive transfer that is already in VARIANCE_PENDING_FC status'
);

-- Financial Controller approves the variance
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.approve_transfer_variance(
      current_setting('app.test_transfer_2', true)::uuid,
      'Approved: 2.5 kg lost due to transit temperature fluctuation'
    );
  $$,
  'FC approves transfer variance via RPC'
);

SELECT is(
  status,
  'RECEIVED_VARIANCE_APPROVED',
  'Transfer status is now RECEIVED_VARIANCE_APPROVED'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid;

SELECT is(
  fc_approval_id,
  'e0000000-0000-0000-0000-000000000003'::uuid,
  'FC approval user id is recorded'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid;

SELECT ok(
  in_movement_id IS NOT NULL,
  'Inbound movement is now populated following FC approval'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid;

SELECT is(
  quantity,
  22.500,
  'Inbound movement quantity matches counted 22.500 kg'
) FROM public.t_stock_movements
WHERE movement_id = (SELECT in_movement_id FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_2', true)::uuid);

-- ---------------------------------------------------------------------------
-- 9. SCENARIO 5: VARIANCE REJECTION FLOW (Flow G Step G8)
-- ---------------------------------------------------------------------------
-- Dispatch third transfer
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

DO $$
DECLARE
  v_tid uuid;
BEGIN
  v_tid := public.dispatch_store_transfer(
    'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
    'ITM-CHZ-001', 10.000, 10.000, 'SEAL-REJECT-03'
  );
  PERFORM set_config('app.test_transfer_3', v_tid::text, true);
END $$;

SELECT ok(
  current_setting('app.test_transfer_3', true) IS NOT NULL,
  'Dispatch third transfer for rejection testing'
);

-- Receive with variance
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT lives_ok(
  $$
    SELECT public.receive_store_transfer(
      current_setting('app.test_transfer_3', true)::uuid,
      5.000,
      5.000
    );
  $$,
  'Receiver receives third transfer with 5 kg discrepancy'
);

-- FC rejects the variance
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.reject_transfer_variance(
      current_setting('app.test_transfer_3', true)::uuid,
      'Rejected: seal was broken prior to arrival, full claim investigation opened'
    );
  $$,
  'FC rejects transfer variance via reject RPC'
);

SELECT is(
  status,
  'REJECTED',
  'Third transfer status transitions to REJECTED'
) FROM public.t_transfer_intransit WHERE transfer_id = current_setting('app.test_transfer_3', true)::uuid;

-- ---------------------------------------------------------------------------
-- 10. AUTHORIZATION & SCOPE GUARDS
-- ---------------------------------------------------------------------------
-- 10.1 Store scope mismatch on dispatch
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$
    SELECT public.dispatch_store_transfer(
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-CHZ-001', 5.000, 5.000, 'SEAL-SCOPE-01'
    );
  $$,
  'P0001',
  NULL,
  'Dispatch from unassigned store scope throws exception'
);

-- 10.2 Unauthorized role (RUNNER) cannot dispatch
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.dispatch_store_transfer(
      'IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-CHZ-001', 5.000, 5.000, 'SEAL-UNAUTH-01'
    );
  $$,
  'P0001',
  'Unauthorized: Only Keeper, RM, or System Admin can dispatch store transfers.',
  'Runner cannot dispatch store transfer'
);

-- 10.3 Unauthorized role (RUNNER) cannot receive
SELECT throws_ok(
  $$
    SELECT public.receive_store_transfer(
      current_setting('app.test_transfer_2', true)::uuid,
      20.000,
      20.000
    );
  $$,
  'P0001',
  'Unauthorized: Only Keeper, RM, or System Admin can receive store transfers.',
  'Runner cannot receive store transfer'
);

-- 10.4 Non-existent warehouse rejected
SET LOCAL "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'e0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.dispatch_store_transfer(
      'IND-DEL-01', 'WH-NONEXISTENT', 'IND-DEL-02', 'WH-DEL02-COLD',
      'ITM-CHZ-001', 5.000, 5.000, 'SEAL-ERR-99'
    );
  $$,
  'P0001',
  NULL,
  'Non-existent source warehouse rejected'
);

SELECT * FROM finish();
ROLLBACK;
