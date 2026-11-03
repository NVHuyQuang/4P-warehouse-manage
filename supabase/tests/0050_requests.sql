-- pgTAP Test Suite for Domain D5: Requests Domain (Flow C-1 Section Stock Request)
-- Tables: t_requests, t_request_items
-- RPCs: create_section_request, update_section_request, cancel_section_request, begin_request_picking, is_store_issue_window_open
-- Non-negotiable: Quantities only. Zero price, cost, valuation, tax, or vendor data.

BEGIN;
SELECT plan(62);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_req_k1 uuid := 'k0000000-0000-0000-0000-000000000001'::uuid; -- Kitchen Requester Store 1
  v_req_b1 uuid := 'k0000000-0000-0000-0000-000000000002'::uuid; -- Bar Requester Store 1
  v_admin  uuid := 'k0000000-0000-0000-0000-000000000003'::uuid; -- Storekeeper (ADMIN) Store 1
  v_runner uuid := 'k0000000-0000-0000-0000-000000000004'::uuid; -- Kitchen Runner Store 1
  v_req_k2 uuid := 'k0000000-0000-0000-0000-000000000005'::uuid; -- Kitchen Requester Store 2
  v_viewer uuid := 'k0000000-0000-0000-0000-000000000006'::uuid; -- Auditor (VIEWER)
  v_req_k3 uuid := 'k0000000-0000-0000-0000-000000000007'::uuid; -- Kitchen Requester 2 Store 1
BEGIN
  -- 1. Ensure test users exist in auth.users
  INSERT INTO auth.users (id, email)
  VALUES
    (v_req_k1, 'requester_k1@example.test'),
    (v_req_b1, 'requester_b1@example.test'),
    (v_admin,  'admin_keeper@example.test'),
    (v_runner, 'runner_del1@example.test'),
    (v_req_k2, 'requester_k2@example.test'),
    (v_viewer, 'viewer_audit@example.test'),
    (v_req_k3, 'requester_k3@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Ensure test stores exist in m_stores
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES
    ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true),
    ('IND-DEL-02', 'Delhi Store 2', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  -- 3. Ensure test items exist in m_items
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES
    ('ITM-CHZ-001', 'Fresh Mozzarella Bocconcini', 'CHEESE', 'kg', true),
    ('ITM-DRY-001', 'Caputo Type 00 Pizza Flour', 'DRY_GOODS', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TABLE EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_table('public', 't_requests', 'Table t_requests exists');
SELECT has_table('public', 't_request_items', 'Table t_request_items exists');

-- ---------------------------------------------------------------------------
-- 2. PRIMARY KEYS
-- ---------------------------------------------------------------------------
SELECT col_is_pk('public', 't_requests', 'request_id', 't_requests.request_id is primary key');
SELECT col_is_pk('public', 't_request_items', 'request_item_id', 't_request_items.request_item_id is primary key');

-- ---------------------------------------------------------------------------
-- 3. EXACT COLUMNS
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'public',
  't_requests',
  ARRAY[
    'request_id',
    'store_id',
    'section_id',
    'requester_user_id',
    'is_urgent',
    'urgent_reason',
    'status',
    'runner_user_id',
    'runner_confirmed_at',
    'created_at',
    'updated_at'
  ],
  't_requests has exact expected columns'
);

SELECT columns_are(
  'public',
  't_request_items',
  ARRAY[
    'request_item_id',
    'request_id',
    'item_code',
    'requested_qty',
    'issued_qty',
    'uom',
    'variance_reason',
    'created_at'
  ],
  't_request_items has exact expected columns'
);

-- ---------------------------------------------------------------------------
-- 4. COLUMN DATA TYPES
-- ---------------------------------------------------------------------------
SELECT col_type_is('public', 't_requests', 'request_id', 'uuid', 't_requests.request_id is uuid');
SELECT col_type_is('public', 't_requests', 'store_id', 'text', 't_requests.store_id is text');
SELECT col_type_is('public', 't_requests', 'section_id', 'text', 't_requests.section_id is text');
SELECT col_type_is('public', 't_requests', 'requester_user_id', 'uuid', 't_requests.requester_user_id is uuid');
SELECT col_type_is('public', 't_requests', 'is_urgent', 'boolean', 't_requests.is_urgent is boolean');
SELECT col_type_is('public', 't_requests', 'urgent_reason', 'text', 't_requests.urgent_reason is text');
SELECT col_type_is('public', 't_requests', 'status', 'text', 't_requests.status is text');
SELECT col_type_is('public', 't_requests', 'runner_user_id', 'uuid', 't_requests.runner_user_id is uuid');
SELECT col_type_is('public', 't_requests', 'runner_confirmed_at', 'timestamp with time zone', 't_requests.runner_confirmed_at is timestamptz');
SELECT col_type_is('public', 't_requests', 'created_at', 'timestamp with time zone', 't_requests.created_at is timestamptz');
SELECT col_type_is('public', 't_requests', 'updated_at', 'timestamp with time zone', 't_requests.updated_at is timestamptz');

SELECT col_type_is('public', 't_request_items', 'request_item_id', 'uuid', 't_request_items.request_item_id is uuid');
SELECT col_type_is('public', 't_request_items', 'request_id', 'uuid', 't_request_items.request_id is uuid');
SELECT col_type_is('public', 't_request_items', 'item_code', 'text', 't_request_items.item_code is text');
SELECT col_type_is('public', 't_request_items', 'requested_qty', 'numeric', 't_request_items.requested_qty is numeric');
SELECT col_type_is('public', 't_request_items', 'issued_qty', 'numeric', 't_request_items.issued_qty is numeric');
SELECT col_type_is('public', 't_request_items', 'uom', 'text', 't_request_items.uom is text');
SELECT col_type_is('public', 't_request_items', 'variance_reason', 'text', 't_request_items.variance_reason is text');
SELECT col_type_is('public', 't_request_items', 'created_at', 'timestamp with time zone', 't_request_items.created_at is timestamptz');

-- ---------------------------------------------------------------------------
-- 5. FOREIGN KEYS
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 't_requests', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_requests', 'requester_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_requests', 'runner_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_request_items', 'request_id', 'public', 't_requests', 'request_id');
SELECT fk_ok('public', 't_request_items', 'item_code', 'public', 'm_items', 'item_code');

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) STATUS
-- ---------------------------------------------------------------------------
SELECT is(rowsecurity, true, 't_requests has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_requests';

SELECT is(rowsecurity, true, 't_request_items has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_request_items';

-- ---------------------------------------------------------------------------
-- 7. CONSTRAINTS & SEGREGATION CHECKS
-- ---------------------------------------------------------------------------
-- 7.1 chk_urgent_reason blocks is_urgent = true with NULL urgent_reason
SELECT throws_ok(
  $$
    INSERT INTO public.t_requests (
      store_id, section_id, requester_user_id, is_urgent, urgent_reason, status
    ) VALUES (
      'IND-DEL-01', 'KITCHEN', 'k0000000-0000-0000-0000-000000000001'::uuid, true, NULL, 'QUEUED'
    );
  $$,
  '23514',
  NULL,
  'chk_urgent_reason blocks is_urgent = true with NULL urgent_reason'
);

-- 7.2 chk_urgent_reason blocks is_urgent = true with empty/whitespace urgent_reason
SELECT throws_ok(
  $$
    INSERT INTO public.t_requests (
      store_id, section_id, requester_user_id, is_urgent, urgent_reason, status
    ) VALUES (
      'IND-DEL-01', 'KITCHEN', 'k0000000-0000-0000-0000-000000000001'::uuid, true, '   ', 'QUEUED'
    );
  $$,
  '23514',
  NULL,
  'chk_urgent_reason blocks is_urgent = true with whitespace urgent_reason'
);

-- 7.3 Invalid status string rejected by CHECK constraint
SELECT throws_ok(
  $$
    INSERT INTO public.t_requests (
      store_id, section_id, requester_user_id, is_urgent, urgent_reason, status
    ) VALUES (
      'IND-DEL-01', 'KITCHEN', 'k0000000-0000-0000-0000-000000000001'::uuid, false, NULL, 'INVALID_STATUS'
    );
  $$,
  '23514',
  NULL,
  'Constraint check blocks invalid request status'
);

-- 7.4 Invalid section_id string rejected by CHECK constraint
SELECT throws_ok(
  $$
    INSERT INTO public.t_requests (
      store_id, section_id, requester_user_id, is_urgent, urgent_reason, status
    ) VALUES (
      'IND-DEL-01', 'INVALID_SECTION', 'k0000000-0000-0000-0000-000000000001'::uuid, false, NULL, 'QUEUED'
    );
  $$,
  '23514',
  NULL,
  'Constraint check blocks invalid section_id'
);

-- 7.5 requested_qty must be > 0
SELECT throws_ok(
  $$
    INSERT INTO public.t_request_items (
      request_id, item_code, requested_qty, uom
    ) VALUES (
      gen_random_uuid(), 'ITM-CHZ-001', 0, 'kg'
    );
  $$,
  '23514',
  NULL,
  'Constraint check blocks requested_qty <= 0'
);

-- 7.6 issued_qty must be >= 0 when provided
SELECT throws_ok(
  $$
    INSERT INTO public.t_request_items (
      request_id, item_code, requested_qty, issued_qty, uom
    ) VALUES (
      gen_random_uuid(), 'ITM-CHZ-001', 5.0, -1.0, 'kg'
    );
  $$,
  '23514',
  NULL,
  'Constraint check blocks negative issued_qty'
);

-- ---------------------------------------------------------------------------
-- 8. WINDOW LOGIC & RPC CREATION (Inside vs Outside Window)
-- ---------------------------------------------------------------------------
-- 8.1 Unit checks on is_time_in_window
SELECT is(public.is_time_in_window('07:30'::time, '06:00-08:30'), true, '07:30 falls inside 06:00-08:30 window');
SELECT is(public.is_time_in_window('10:00'::time, '06:00-08:30'), false, '10:00 falls outside 06:00-08:30 window');

-- Setup session for Kitchen Requester in Store 1
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 8.2 Inside window: request without urgent_reason succeeds, is_urgent is false
SET LOCAL "app.test_inside_window" = 'true';

SELECT lives_ok(
  $$
    SELECT public.create_section_request(
      'IND-DEL-01',
      'KITCHEN',
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 10.0}]'::jsonb,
      NULL
    );
  $$,
  'create_section_request inside window succeeds without urgent_reason'
);

SELECT is(
  (
    SELECT is_urgent FROM public.t_requests
    WHERE requester_user_id = 'k0000000-0000-0000-0000-000000000001'::uuid
    ORDER BY created_at DESC LIMIT 1
  ),
  false,
  'Request created inside window has is_urgent = false'
);

-- 8.3 Outside window: request without urgent_reason is rejected
SET LOCAL "app.test_inside_window" = 'false';

SELECT throws_ok(
  $$
    SELECT public.create_section_request(
      'IND-DEL-01',
      'KITCHEN',
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 5.0}]'::jsonb,
      NULL
    );
  $$,
  'P0001',
  'Request is outside the active issue window. An urgent reason is required.',
  'create_section_request outside window requires urgent reason'
);

-- 8.4 Outside window: request with urgent_reason is accepted (never blocked)
SELECT lives_ok(
  $$
    SELECT public.create_section_request(
      'IND-DEL-01',
      'KITCHEN',
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 5.0}]'::jsonb,
      'Dinner rush unanticipated surge'
    );
  $$,
  'create_section_request outside window with urgent_reason is accepted'
);

SELECT is(
  (
    SELECT is_urgent FROM public.t_requests
    WHERE requester_user_id = 'k0000000-0000-0000-0000-000000000001'::uuid
    ORDER BY created_at DESC LIMIT 1
  ),
  true,
  'Request created outside window with reason has is_urgent = true'
);

-- ---------------------------------------------------------------------------
-- 9. FLOW C-1 EDIT & CANCEL WHILE STATUS IS QUEUED
-- ---------------------------------------------------------------------------
-- Create a dedicated QUEUED request to test edit and cancel
DO $$
DECLARE
  v_req_id uuid;
BEGIN
  v_req_id := public.create_section_request(
    'IND-DEL-01',
    'KITCHEN',
    '[{"item_code": "ITM-CHZ-001", "requested_qty": 15.0}]'::jsonb,
    'Urgent restock for prep'
  );
  -- Stash request_id in session setting for subsequent tests
  PERFORM set_config('app.test_request_id_1', v_req_id::text, true);
END $$;

-- 9.1 update_section_request succeeds while QUEUED
SELECT lives_ok(
  $$
    SELECT public.update_section_request(
      current_setting('app.test_request_id_1')::uuid,
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 25.0}]'::jsonb
    );
  $$,
  'Requester can edit item quantity while status is QUEUED'
);

SELECT is(
  (
    SELECT requested_qty FROM public.t_request_items
    WHERE request_id = current_setting('app.test_request_id_1')::uuid
      AND item_code = 'ITM-CHZ-001'
  ),
  25.000,
  'Requested quantity successfully updated to 25.000 in t_request_items'
);

-- 9.2 cancel_section_request succeeds while QUEUED
SELECT lives_ok(
  $$
    SELECT public.cancel_section_request(
      current_setting('app.test_request_id_1')::uuid
    );
  $$,
  'Requester can cancel requisition while status is QUEUED'
);

SELECT is(
  (
    SELECT status FROM public.t_requests
    WHERE request_id = current_setting('app.test_request_id_1')::uuid
  ),
  'CANCELLED_BY_REQUESTER',
  'Request status is CANCELLED_BY_REQUESTER'
);

-- ---------------------------------------------------------------------------
-- 10. FLOW C-1 HARD LOCK IN PICKING AND BEYOND
-- ---------------------------------------------------------------------------
-- Create a new request and transition it to PICKING
DO $$
DECLARE
  v_req_id uuid;
BEGIN
  v_req_id := public.create_section_request(
    'IND-DEL-01',
    'KITCHEN',
    '[{"item_code": "ITM-CHZ-001", "requested_qty": 12.0}]'::jsonb,
    'Prep batch 2'
  );
  PERFORM set_config('app.test_request_id_2', v_req_id::text, true);
END $$;

-- Switch to Keeper role to begin picking
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'ADMIN';

-- 10.1 Keeper transitions request to PICKING
SELECT lives_ok(
  $$
    SELECT public.begin_request_picking(
      current_setting('app.test_request_id_2')::uuid
    );
  $$,
  'Keeper can begin picking to advance status to PICKING'
);

SELECT is(
  (
    SELECT status FROM public.t_requests
    WHERE request_id = current_setting('app.test_request_id_2')::uuid
  ),
  'PICKING',
  'Request status transitioned to PICKING'
);

-- Switch back to Requester to test edit and cancel lock
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

-- 10.2 update_section_request locked in PICKING
SELECT throws_ok(
  $$
    SELECT public.update_section_request(
      current_setting('app.test_request_id_2')::uuid,
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 30.0}]'::jsonb
    );
  $$,
  'P0001',
  'Cannot edit request: request is in status PICKING, modifications locked once picking has commenced.',
  'update_section_request is locked once picking has commenced'
);

-- 10.3 cancel_section_request locked in PICKING
SELECT throws_ok(
  $$
    SELECT public.cancel_section_request(
      current_setting('app.test_request_id_2')::uuid
    );
  $$,
  'P0001',
  'Cannot cancel request: request is in status PICKING, cancellation locked once picking has commenced.',
  'cancel_section_request is locked once picking has commenced'
);

-- Switch to superuser to test database triggers enforce lock regardless of caller
RESET ROLE;

-- 10.4 Direct UPDATE to CANCELLED_BY_REQUESTER blocked by trigger
SELECT throws_ok(
  $$
    UPDATE public.t_requests
    SET status = 'CANCELLED_BY_REQUESTER'
    WHERE request_id = current_setting('app.test_request_id_2')::uuid;
  $$,
  'P0001',
  'Cannot cancel request: request is in status PICKING, only QUEUED requests can be cancelled.',
  'Trigger tg_enforce_request_lock blocks direct status cancellation in PICKING'
);

-- 10.5 Direct DELETE on t_request_items blocked by trigger
SELECT throws_ok(
  $$
    DELETE FROM public.t_request_items
    WHERE request_id = current_setting('app.test_request_id_2')::uuid;
  $$,
  'P0001',
  'Cannot delete item: request is in status PICKING, modifications locked once picking has commenced.',
  'Trigger tg_enforce_request_item_lock blocks item deletion in PICKING'
);

-- 10.6 Direct UPDATE of requested_qty on t_request_items blocked by trigger
SELECT throws_ok(
  $$
    UPDATE public.t_request_items
    SET requested_qty = 99.0
    WHERE request_id = current_setting('app.test_request_id_2')::uuid;
  $$,
  'P0001',
  'Cannot edit requested item or quantity once picking has commenced (status: PICKING).',
  'Trigger tg_enforce_request_item_lock blocks quantity edits in PICKING'
);

-- ---------------------------------------------------------------------------
-- 11. RLS ISOLATION ACROSS STORES AND ROLES
-- ---------------------------------------------------------------------------
-- 11.1 Store 1 Requester can see Store 1 requests
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT is(
  (
    SELECT count(*)::int FROM public.t_requests
    WHERE request_id = current_setting('app.test_request_id_2')::uuid
  ),
  1,
  'Store 1 requester can read their store request under RLS'
);

-- 11.2 Store 2 Requester is isolated from Store 1 requests
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT is_empty(
  $$
    SELECT 1 FROM public.t_requests
    WHERE request_id = current_setting('app.test_request_id_2')::uuid
  $$,
  'Store 2 requester cannot view requests belonging to Store 1'
);

-- 11.3 Requester from different section blocked from mismatch section request
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';
SET LOCAL "app.test_inside_window" = 'true';

SELECT throws_ok(
  $$
    SELECT public.create_section_request(
      'IND-DEL-01',
      'BAR',
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 3.0}]'::jsonb,
      NULL
    );
  $$,
  'P0001',
  'Role KITCHEN_REQ is only permitted to request for KITCHEN section.',
  'KITCHEN_REQ cannot create request for BAR section'
);

-- 11.4 User with unauthorized role (VIEWER) cannot create request
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'VIEWER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.create_section_request(
      'IND-DEL-01',
      'KITCHEN',
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 3.0}]'::jsonb,
      NULL
    );
  $$,
  'P0001',
  'Unauthorized: Only section requesters or administrators can create section requests.',
  'VIEWER role is blocked from creating section requests'
);

-- 11.5 Requester cannot update another requester's request
-- Create a new request as Requester 1 in QUEUED
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

DO $$
DECLARE
  v_req_id uuid;
BEGIN
  v_req_id := public.create_section_request(
    'IND-DEL-01',
    'KITCHEN',
    '[{"item_code": "ITM-CHZ-001", "requested_qty": 10.0}]'::jsonb,
    NULL
  );
  PERFORM set_config('app.test_request_id_3', v_req_id::text, true);
END $$;

-- Switch to Requester 3 (different user in same store)
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000007';
SET LOCAL "app.current_role" = 'KITCHEN_REQ';

SELECT throws_ok(
  $$
    SELECT public.update_section_request(
      current_setting('app.test_request_id_3')::uuid,
      '[{"item_code": "ITM-CHZ-001", "requested_qty": 20.0}]'::jsonb
    );
  $$,
  'P0001',
  'Unauthorized: Only the original requester or administrator can update this request.',
  'Requester cannot update another requester''s request'
);

-- 11.6 Auditor (VIEWER) can read requests across stores under RLS
SET LOCAL "request.jwt.claim.sub" = 'k0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_user_id" = 'k0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'VIEWER';
SET LOCAL "app.current_store_id" = '';

SELECT is(
  (
    SELECT count(*)::int FROM public.t_requests
    WHERE request_id = current_setting('app.test_request_id_3')::uuid
  ),
  1,
  'Auditor (VIEWER) can read requests under RLS'
);

-- ---------------------------------------------------------------------------
-- FINISH AND ROLLBACK
-- ---------------------------------------------------------------------------
SELECT * FROM finish();
ROLLBACK;
