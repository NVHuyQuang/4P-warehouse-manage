-- pgTAP Test Suite for Domain D7: Custody & Shift Handover
-- Tables: t_custody_logs, t_shift_custody_logs
-- RPCs: record_custody_event, transfer_shift_custody
-- Non-negotiable: Quantities only. Zero financial or commercial data.

BEGIN;
SELECT plan(47);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
-- Seed test users in auth.users for foreign key integrity
DO $$
DECLARE
  v_custodian_id uuid := 'c0000000-0000-0000-0000-000000000001'::uuid;
  v_rm_id uuid        := 'c0000000-0000-0000-0000-000000000002'::uuid;
  v_admin_id uuid     := 'c0000000-0000-0000-0000-000000000003'::uuid;
  v_runner_id uuid    := 'c0000000-0000-0000-0000-000000000004'::uuid;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES
    (v_custodian_id, 'test_custodian@example.test'),
    (v_rm_id,        'test_rm@example.test'),
    (v_admin_id,     'test_admin@example.test'),
    (v_runner_id,    'test_runner@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- Add warehouse in IND-DEL-02 for cross-store testing
  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES ('WH-DEL02-COLD', 'IND-DEL-02', 'Delhi Store 2 Cold Room', 'COLD_ROOM', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TABLE EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_table('public', 't_custody_logs', 'Table t_custody_logs exists');
SELECT has_table('public', 't_shift_custody_logs', 'Table t_shift_custody_logs exists');

-- ---------------------------------------------------------------------------
-- 2. PRIMARY KEYS
-- ---------------------------------------------------------------------------
SELECT col_is_pk('public', 't_custody_logs', 'log_id', 't_custody_logs.log_id is primary key');
SELECT col_is_pk('public', 't_shift_custody_logs', 'shift_log_id', 't_shift_custody_logs.shift_log_id is primary key');

-- ---------------------------------------------------------------------------
-- 3. EXACT COLUMNS
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'public',
  't_custody_logs',
  ARRAY['log_id', 'store_id', 'warehouse_id', 'event_type', 'custodian_user_id', 'urgent_reason', 'created_at'],
  't_custody_logs has exact expected columns'
);

SELECT columns_are(
  'public',
  't_shift_custody_logs',
  ARRAY['shift_log_id', 'store_id', 'warehouse_id', 'outgoing_custodian_id', 'incoming_holder_id', 'shift_type', 'signature_blob', 'transferred_at'],
  't_shift_custody_logs has exact expected columns'
);

-- ---------------------------------------------------------------------------
-- 4. COLUMN DATA TYPES
-- ---------------------------------------------------------------------------
SELECT col_type_is('public', 't_custody_logs', 'log_id', 'uuid', 't_custody_logs.log_id is uuid');
SELECT col_type_is('public', 't_custody_logs', 'custodian_user_id', 'uuid', 't_custody_logs.custodian_user_id is uuid');
SELECT col_type_is('public', 't_shift_custody_logs', 'shift_log_id', 'uuid', 't_shift_custody_logs.shift_log_id is uuid');
SELECT col_type_is('public', 't_shift_custody_logs', 'outgoing_custodian_id', 'uuid', 't_shift_custody_logs.outgoing_custodian_id is uuid');
SELECT col_type_is('public', 't_shift_custody_logs', 'incoming_holder_id', 'uuid', 't_shift_custody_logs.incoming_holder_id is uuid');

-- ---------------------------------------------------------------------------
-- 5. FOREIGN KEYS
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 't_custody_logs', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_custody_logs', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_custody_logs', 'custodian_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_shift_custody_logs', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_shift_custody_logs', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_shift_custody_logs', 'outgoing_custodian_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_shift_custody_logs', 'incoming_holder_id', 'auth', 'users', 'id');

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) STATUS
-- ---------------------------------------------------------------------------
SELECT is(rowsecurity, true, 't_custody_logs has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_custody_logs';

SELECT is(rowsecurity, true, 't_shift_custody_logs has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_shift_custody_logs';

-- ---------------------------------------------------------------------------
-- 7. TABLE CONSTRAINTS & SEGREGATION CHECKS
-- ---------------------------------------------------------------------------
-- 7.1 t_shift_custody_logs: outgoing cannot equal incoming
SELECT throws_ok(
  $$
    INSERT INTO public.t_shift_custody_logs (
      store_id, warehouse_id, outgoing_custodian_id, incoming_holder_id, shift_type, signature_blob
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000001'::uuid,
      'c0000000-0000-0000-0000-000000000001'::uuid,
      'DAY_TO_EVENING',
      'data:sig-same-holder'
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_shift_custody_distinct_holders blocks identical outgoing and incoming holder'
);

-- 7.2 t_custody_logs: invalid event_type rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_custody_logs (
      store_id, warehouse_id, event_type, custodian_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'UNAUTHORIZED_ENTRY', 'c0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint check rejects invalid event_type'
);

-- 7.3 t_shift_custody_logs: invalid shift_type rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_shift_custody_logs (
      store_id, warehouse_id, outgoing_custodian_id, incoming_holder_id, shift_type, signature_blob
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000001'::uuid,
      'c0000000-0000-0000-0000-000000000002'::uuid,
      'MIDNIGHT_TO_DAWN',
      'data:sig'
    );
  $$,
  '23514',
  NULL,
  'Constraint check rejects invalid shift_type'
);

-- 7.4 t_custody_logs: URGENT_ACCESS requires urgent_reason
SELECT throws_ok(
  $$
    INSERT INTO public.t_custody_logs (
      store_id, warehouse_id, event_type, custodian_user_id, urgent_reason
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'URGENT_ACCESS', 'c0000000-0000-0000-0000-000000000001'::uuid, NULL
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_custody_urgent_reason blocks URGENT_ACCESS with NULL urgent_reason'
);

-- ---------------------------------------------------------------------------
-- 8. APPEND-ONLY IMMUTABILITY (Triggers)
-- ---------------------------------------------------------------------------
-- Insert sample record directly as superuser to test immutability triggers
INSERT INTO public.t_custody_logs (
  log_id, store_id, warehouse_id, event_type, custodian_user_id, urgent_reason
) VALUES (
  'd0000000-0000-0000-0000-000000000001'::uuid,
  'IND-DEL-01', 'WH-DEL01-COLD', 'WINDOW_UNLOCK',
  'c0000000-0000-0000-0000-000000000001'::uuid, NULL
);

INSERT INTO public.t_shift_custody_logs (
  shift_log_id, store_id, warehouse_id, outgoing_custodian_id, incoming_holder_id, shift_type, signature_blob
) VALUES (
  'd0000000-0000-0000-0000-000000000002'::uuid,
  'IND-DEL-01', 'WH-DEL01-COLD',
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'c0000000-0000-0000-0000-000000000002'::uuid,
  'DAY_TO_EVENING', 'data:sig-sample'
);

SELECT throws_ok(
  'UPDATE public.t_custody_logs SET event_type = ''WINDOW_LOCK'' WHERE log_id = ''d0000000-0000-0000-0000-000000000001''::uuid',
  'P0001',
  'Custody logs are append-only and cannot be updated or deleted.',
  'UPDATE on t_custody_logs is blocked by append-only trigger'
);

SELECT throws_ok(
  'DELETE FROM public.t_custody_logs WHERE log_id = ''d0000000-0000-0000-0000-000000000001''::uuid',
  'P0001',
  'Custody logs are append-only and cannot be updated or deleted.',
  'DELETE on t_custody_logs is blocked by append-only trigger'
);

SELECT throws_ok(
  'UPDATE public.t_shift_custody_logs SET signature_blob = ''tampered'' WHERE shift_log_id = ''d0000000-0000-0000-0000-000000000002''::uuid',
  'P0001',
  'Custody logs are append-only and cannot be updated or deleted.',
  'UPDATE on t_shift_custody_logs is blocked by append-only trigger'
);

SELECT throws_ok(
  'DELETE FROM public.t_shift_custody_logs WHERE shift_log_id = ''d0000000-0000-0000-0000-000000000002''::uuid',
  'P0001',
  'Custody logs are append-only and cannot be updated or deleted.',
  'DELETE on t_shift_custody_logs is blocked by append-only trigger'
);

-- ---------------------------------------------------------------------------
-- 9. RPC: record_custody_event (Allowed & Denied)
-- ---------------------------------------------------------------------------
-- 9.1 Custodian can record WINDOW_UNLOCK and WINDOW_LOCK
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-DEL01-COLD', 'WINDOW_UNLOCK', NULL); $$,
  'Custodian can record WINDOW_UNLOCK via RPC'
);

SELECT lives_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-DEL01-COLD', 'WINDOW_LOCK', NULL); $$,
  'Custodian can record WINDOW_LOCK via RPC'
);

-- 9.2 Keeper (ADMIN) can record WINDOW_UNLOCK
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT lives_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-DEL01-DRY', 'WINDOW_UNLOCK', NULL); $$,
  'Keeper (ADMIN) can record WINDOW_UNLOCK via RPC'
);

-- 9.3 RM can record URGENT_ACCESS with urgent_reason
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RM';

SELECT lives_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-DEL01-COLD', 'URGENT_ACCESS', 'Emergency cheese restock for dinner rush'); $$,
  'RM can record URGENT_ACCESS with reason via RPC'
);

-- 9.4 Denied: URGENT_ACCESS without urgent_reason throws exception
SELECT throws_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-DEL01-COLD', 'URGENT_ACCESS', '   '); $$,
  'P0001',
  'Urgent reason is required for URGENT_ACCESS event.',
  'RPC rejects URGENT_ACCESS with empty urgent_reason'
);

-- 9.5 Denied: Unauthorized role (RUNNER) cannot record custody event
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-DEL01-COLD', 'WINDOW_UNLOCK', NULL); $$,
  'P0001',
  'Unauthorized: Only Keeper, Custodian, or RM can record custody events.',
  'Runner cannot record custody event'
);

-- 9.6 Denied: Store scope mismatch
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.record_custody_event('IND-DEL-02', 'WH-DEL02-COLD', 'WINDOW_UNLOCK', NULL); $$,
  'P0001',
  NULL,
  'Store scope mismatch rejected by record_custody_event'
);

-- 9.7 Denied: Warehouse not belonging to Store
SELECT throws_ok(
  $$ SELECT public.record_custody_event('IND-DEL-01', 'WH-NONEXISTENT', 'WINDOW_UNLOCK', NULL); $$,
  'P0001',
  NULL,
  'Non-existent warehouse rejected by record_custody_event'
);

-- ---------------------------------------------------------------------------
-- 10. RPC: transfer_shift_custody (Allowed & Denied)
-- ---------------------------------------------------------------------------
-- 10.1 Custodian transfers to RM (DAY_TO_EVENING)
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$
    SELECT public.transfer_shift_custody(
      'IND-DEL-01',
      'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000002'::uuid,
      'DAY_TO_EVENING',
      'data:image/png;base64,incoming-rm-signature-hash'
    );
  $$,
  'Custodian can transfer shift custody to RM (DAY_TO_EVENING)'
);

-- 10.2 RM transfers to Keeper (EVENING_TO_MORNING)
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RM';

SELECT lives_ok(
  $$
    SELECT public.transfer_shift_custody(
      'IND-DEL-01',
      'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000003'::uuid,
      'EVENING_TO_MORNING',
      'data:image/png;base64,incoming-keeper-signature-hash'
    );
  $$,
  'RM can transfer shift custody to Keeper (EVENING_TO_MORNING)'
);

-- 10.3 Segregation of Duties: Outgoing custodian cannot transfer to themselves
SELECT throws_ok(
  $$
    SELECT public.transfer_shift_custody(
      'IND-DEL-01',
      'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000002'::uuid,
      'DAY_TO_EVENING',
      'data:image/png;base64,self-transfer-signature'
    );
  $$,
  'P0001',
  'Segregation violation: Outgoing custodian cannot transfer custody to themselves.',
  'Self-transfer is blocked by segregation check in transfer_shift_custody'
);

-- 10.4 Denied: Unauthorized role (RUNNER) cannot transfer shift custody
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$
    SELECT public.transfer_shift_custody(
      'IND-DEL-01',
      'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000001'::uuid,
      'DAY_TO_EVENING',
      'data:image/png;base64,runner-signature'
    );
  $$,
  'P0001',
  'Unauthorized: Only Keeper, Custodian, or RM can transfer shift custody.',
  'Runner cannot transfer shift custody'
);

-- 10.5 Denied: Empty signature blob
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';

SELECT throws_ok(
  $$
    SELECT public.transfer_shift_custody(
      'IND-DEL-01',
      'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000002'::uuid,
      'DAY_TO_EVENING',
      '   '
    );
  $$,
  'P0001',
  'Signature blob cannot be empty.',
  'Empty signature blob rejected by transfer_shift_custody'
);

-- 10.6 Denied: Incoming holder not found in auth.users
SELECT throws_ok(
  $$
    SELECT public.transfer_shift_custody(
      'IND-DEL-01',
      'WH-DEL01-COLD',
      'c0000000-9999-9999-9999-999999999999'::uuid,
      'DAY_TO_EVENING',
      'data:signature'
    );
  $$,
  'P0001',
  NULL,
  'Unknown incoming holder rejected by transfer_shift_custody'
);

-- ---------------------------------------------------------------------------
-- 11. RLS STORE SCOPE ISOLATION & DIRECT INSERTS
-- ---------------------------------------------------------------------------
-- 11.1 Cross-store log isolation
-- Superuser inserts a log in IND-DEL-02
RESET ROLE;
INSERT INTO public.t_custody_logs (
  store_id, warehouse_id, event_type, custodian_user_id
) VALUES (
  'IND-DEL-02', 'WH-DEL02-COLD', 'WINDOW_UNLOCK', 'c0000000-0000-0000-0000-000000000001'::uuid
);

-- Switch to authenticated user scoped to IND-DEL-01
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'CUSTODIAN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- Authenticated caller scoped to IND-DEL-01 cannot see IND-DEL-02 rows
SELECT is(
  (SELECT count(*)::integer FROM public.t_custody_logs WHERE store_id = 'IND-DEL-02'),
  0,
  'Store scope isolation: User scoped to IND-DEL-01 cannot read IND-DEL-02 custody logs'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_shift_custody_logs WHERE store_id = 'IND-DEL-01') > 0,
  true,
  'User can read logs within own store scope (IND-DEL-01)'
);

-- 11.2 Direct INSERT by unauthorized role (RUNNER) is blocked by RLS
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT throws_ok(
  $$
    INSERT INTO public.t_custody_logs (
      store_id, warehouse_id, event_type, custodian_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD', 'WINDOW_UNLOCK', 'c0000000-0000-0000-0000-000000000004'::uuid
    );
  $$,
  '42501',
  NULL,
  'Direct INSERT on t_custody_logs by RUNNER is blocked by RLS'
);

SELECT throws_ok(
  $$
    INSERT INTO public.t_shift_custody_logs (
      store_id, warehouse_id, outgoing_custodian_id, incoming_holder_id, shift_type, signature_blob
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-COLD',
      'c0000000-0000-0000-0000-000000000004'::uuid,
      'c0000000-0000-0000-0000-000000000002'::uuid,
      'DAY_TO_EVENING',
      'data:sig'
    );
  $$,
  '42501',
  NULL,
  'Direct INSERT on t_shift_custody_logs by RUNNER is blocked by RLS'
);

-- 11.3 Direct INSERT by authorized role (ADMIN) within store scope succeeds
SET LOCAL "app.current_user_id" = 'c0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT lives_ok(
  $$
    INSERT INTO public.t_custody_logs (
      store_id, warehouse_id, event_type, custodian_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'WINDOW_LOCK', 'c0000000-0000-0000-0000-000000000003'::uuid
    );
  $$,
  'Direct INSERT on t_custody_logs by Keeper (ADMIN) within store scope succeeds under RLS'
);

SELECT * FROM finish();
ROLLBACK;
