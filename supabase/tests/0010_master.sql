BEGIN;
SELECT plan(40);

-- 1. Table & View Existence
SELECT has_table('public', 'm_stores', 'Table m_stores exists');
SELECT has_table('public', 'm_warehouses', 'Table m_warehouses exists');
SELECT has_table('public', 'm_go_live_assignments', 'Table m_go_live_assignments exists');
SELECT has_view('public', 'v_store_switcher', 'View v_store_switcher exists');

-- 2. Primary Keys
SELECT col_is_pk('public', 'm_stores', 'store_id', 'm_stores.store_id is primary key');
SELECT col_is_pk('public', 'm_warehouses', 'warehouse_id', 'm_warehouses.warehouse_id is primary key');
SELECT col_is_pk('public', 'm_go_live_assignments', 'store_id', 'm_go_live_assignments.store_id is primary key');

-- 3. Foreign Keys
SELECT fk_ok('public', 'm_warehouses', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 'm_go_live_assignments', 'store_id', 'public', 'm_stores', 'store_id');

-- 4. RLS Enabled Status
SELECT is(rowsecurity, true, 'm_stores has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_stores';

SELECT is(rowsecurity, true, 'm_warehouses has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_warehouses';

SELECT is(rowsecurity, true, 'm_go_live_assignments has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_go_live_assignments';

-- 5. Seed Data Checks
SELECT results_eq(
  'SELECT store_id, store_name, city, status, is_active FROM public.m_stores ORDER BY store_id',
  $$VALUES
    ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true),
    ('IND-DEL-02', 'Delhi Store 2', 'Delhi', 'ACTIVE', true)
  $$,
  'm_stores seeded with IND-DEL-01 and IND-DEL-02'
);

SELECT results_eq(
  'SELECT warehouse_id, store_id, warehouse_name, storage_type, status FROM public.m_warehouses ORDER BY warehouse_id',
  $$VALUES
    ('WH-DEL01-COLD', 'IND-DEL-01', 'Delhi Store 1 Cold Room', 'COLD_ROOM'::storage_type, 'ACTIVE'::warehouse_status),
    ('WH-DEL01-DRY', 'IND-DEL-01', 'Delhi Store 1 Dry Store', 'DRY_STORE'::storage_type, 'ACTIVE'::warehouse_status)
  $$,
  'm_warehouses seeded with WH-DEL01-COLD and WH-DEL01-DRY'
);

SELECT results_eq(
  'SELECT store_id, store_name, city FROM public.v_store_switcher ORDER BY store_id',
  $$VALUES
    ('IND-DEL-01', 'Delhi Store 1', 'Delhi'),
    ('IND-DEL-02', 'Delhi Store 2', 'Delhi')
  $$,
  'v_store_switcher shows active stores'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.m_go_live_assignments
    WHERE store_id = 'IND-DEL-01'
      AND morning_receiving_window = '07:00-09:00'
      AND morning_issue_window = '06:00-08:30'
  ),
  'm_go_live_assignments contains IND-DEL-01 operational windows'
);

-- 6. Status and is_active synchronization trigger
INSERT INTO public.m_stores (store_id, store_name, city, status)
VALUES ('IND-TEST-SYNC', 'Sync Test Store', 'Delhi', 'INACTIVE');

SELECT is(
  is_active,
  false,
  'm_stores status=INACTIVE automatically sets is_active=false'
) FROM public.m_stores WHERE store_id = 'IND-TEST-SYNC';

UPDATE public.m_stores SET is_active = true WHERE store_id = 'IND-TEST-SYNC';

SELECT is(
  status,
  'ACTIVE',
  'm_stores is_active=true automatically sets status=ACTIVE'
) FROM public.m_stores WHERE store_id = 'IND-TEST-SYNC';

DELETE FROM public.m_stores WHERE store_id = 'IND-TEST-SYNC';

-- 7. RLS Verification: APPROVER Allowed Operations
SET LOCAL ROLE authenticated;
SELECT set_config('app.current_role', 'APPROVER', true);

-- APPROVER can read
SELECT ok(
  (SELECT count(*) FROM public.m_stores) >= 2,
  'APPROVER can read m_stores'
);

-- APPROVER can insert store
INSERT INTO public.m_stores (store_id, store_name, city, status)
VALUES ('IND-BLR-99', 'Bengaluru Approver Branch', 'Bengaluru', 'ACTIVE');

SELECT ok(
  EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = 'IND-BLR-99'),
  'APPROVER can insert into m_stores'
);

-- APPROVER can insert warehouse
INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status)
VALUES ('WH-BLR99-COLD', 'IND-BLR-99', 'Bengaluru Cold Store', 'COLD_ROOM', 'ACTIVE');

SELECT ok(
  EXISTS (SELECT 1 FROM public.m_warehouses WHERE warehouse_id = 'WH-BLR99-COLD'),
  'APPROVER can insert into m_warehouses'
);

-- APPROVER can insert go-live assignments
INSERT INTO public.m_go_live_assignments (store_id, morning_receiving_window)
VALUES ('IND-BLR-99', '08:00-10:00');

SELECT ok(
  EXISTS (SELECT 1 FROM public.m_go_live_assignments WHERE store_id = 'IND-BLR-99'),
  'APPROVER can insert into m_go_live_assignments'
);

-- APPROVER can update store
UPDATE public.m_stores SET store_name = 'Bengaluru Updated' WHERE store_id = 'IND-BLR-99';
SELECT is(
  (SELECT store_name FROM public.m_stores WHERE store_id = 'IND-BLR-99'),
  'Bengaluru Updated',
  'APPROVER can update m_stores'
);

-- 8. RLS Verification: SYSTEM_ADMIN Allowed Operations
SELECT set_config('app.current_role', 'SYSTEM_ADMIN', true);

UPDATE public.m_warehouses SET warehouse_name = 'Bengaluru Cold SysAdmin Edit' WHERE warehouse_id = 'WH-BLR99-COLD';
SELECT is(
  (SELECT warehouse_name FROM public.m_warehouses WHERE warehouse_id = 'WH-BLR99-COLD'),
  'Bengaluru Cold SysAdmin Edit',
  'SYSTEM_ADMIN can update m_warehouses'
);

-- Cleanup BLR99 records
DELETE FROM public.m_go_live_assignments WHERE store_id = 'IND-BLR-99';
DELETE FROM public.m_warehouses WHERE warehouse_id = 'WH-BLR99-COLD';
DELETE FROM public.m_stores WHERE store_id = 'IND-BLR-99';

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = 'IND-BLR-99'),
  'APPROVER / SYSTEM_ADMIN can delete from m_stores'
);

-- 9. RLS Verification: Non-approver authenticated roles (ADMIN, RUNNER, KITCHEN_REQ)
-- Allowed to SELECT
SELECT set_config('app.current_role', 'RUNNER', true);

SELECT ok(
  (SELECT count(*) FROM public.m_stores) >= 2,
  'RUNNER can read m_stores'
);

SELECT ok(
  (SELECT count(*) FROM public.v_store_switcher) >= 2,
  'RUNNER can read v_store_switcher'
);

SELECT ok(
  (SELECT count(*) FROM public.m_warehouses) >= 2,
  'RUNNER can read m_warehouses'
);

-- Denied INSERT on m_stores
SELECT throws_ok(
  $$INSERT INTO public.m_stores (store_id, store_name, city) VALUES ('IND-FAIL-01', 'Fail Store', 'Delhi')$$,
  '42501',
  NULL,
  'RUNNER cannot insert into m_stores (violates RLS)'
);

-- Denied INSERT on m_warehouses
SELECT throws_ok(
  $$INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type) VALUES ('WH-FAIL-01', 'IND-DEL-01', 'Fail WH', 'COLD_ROOM')$$,
  '42501',
  NULL,
  'RUNNER cannot insert into m_warehouses (violates RLS)'
);

-- Denied INSERT on m_go_live_assignments
SELECT throws_ok(
  $$INSERT INTO public.m_go_live_assignments (store_id) VALUES ('IND-DEL-01')$$,
  '42501',
  NULL,
  'RUNNER cannot insert into m_go_live_assignments (violates RLS)'
);

-- Denied UPDATE on m_stores (RLS USING clause filters row; update affects 0 rows)
UPDATE public.m_stores SET store_name = 'Hacked' WHERE store_id = 'IND-DEL-01';
SELECT is(
  (SELECT store_name FROM public.m_stores WHERE store_id = 'IND-DEL-01'),
  'Delhi Store 1',
  'RUNNER cannot update m_stores (row unaffected by unauthorized update)'
);

-- Denied DELETE on m_stores (RLS USING clause filters row; delete affects 0 rows)
DELETE FROM public.m_stores WHERE store_id = 'IND-DEL-01';
SELECT ok(
  EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = 'IND-DEL-01'),
  'RUNNER cannot delete from m_stores (row persists)'
);

-- Denied UPDATE on m_warehouses
UPDATE public.m_warehouses SET warehouse_name = 'Hacked WH' WHERE warehouse_id = 'WH-DEL01-COLD';
SELECT is(
  (SELECT warehouse_name FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-COLD'),
  'Delhi Store 1 Cold Room',
  'RUNNER cannot update m_warehouses (row unaffected)'
);

-- Denied DELETE on m_warehouses
DELETE FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-COLD';
SELECT ok(
  EXISTS (SELECT 1 FROM public.m_warehouses WHERE warehouse_id = 'WH-DEL01-COLD'),
  'RUNNER cannot delete from m_warehouses (row persists)'
);

-- Repeat check for ADMIN (storekeeper)
SELECT set_config('app.current_role', 'ADMIN', true);
SELECT throws_ok(
  $$INSERT INTO public.m_stores (store_id, store_name, city) VALUES ('IND-FAIL-ADMIN', 'Fail Store Admin', 'Delhi')$$,
  '42501',
  NULL,
  'ADMIN (Storekeeper) cannot insert into m_stores (violates RLS)'
);

-- 10. RLS Verification: Anonymous role (Unauthenticated)
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*) FROM public.m_stores),
  0::bigint,
  'anon role cannot read rows from m_stores (RLS restricts to authenticated)'
);

SELECT throws_ok(
  $$INSERT INTO public.m_stores (store_id, store_name, city) VALUES ('IND-ANON-01', 'Anon Store', 'Delhi')$$,
  '42501',
  NULL,
  'anon role cannot insert into m_stores'
);

-- 11. Foreign Key Constraint Integrity
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type)
    VALUES ('WH-NONEXIST', 'IND-NON-EXISTENT', 'Ghost Store WH', 'COLD_ROOM')$$,
  '23503',
  NULL,
  'Inserting warehouse for non-existent store violates foreign key constraint'
);

SELECT throws_ok(
  $$DELETE FROM public.m_stores WHERE store_id = 'IND-DEL-01'$$,
  '23503',
  NULL,
  'Deleting store with active warehouses violates foreign key RESTRICT constraint'
);

SELECT * FROM finish();
ROLLBACK;
