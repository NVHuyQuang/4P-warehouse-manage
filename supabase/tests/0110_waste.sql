-- pgTAP Test Suite for Domain D11: Waste & Supplier Returns
-- Tables: t_waste_threshold_config, t_waste_returns_log
-- RPCs: log_waste_or_return, approve_waste_or_return
-- Non-negotiable: Quantities only. Zero financial or commercial data.

BEGIN;
SELECT plan(54);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _test_waste_ids (
  key text PRIMARY KEY,
  id uuid NOT NULL
);

DO $$
DECLARE
  v_staff_id   uuid := 'w0000000-0000-0000-0000-000000000001'::uuid;
  v_rm_id      uuid := 'w0000000-0000-0000-0000-000000000002'::uuid;
  v_fc_id      uuid := 'w0000000-0000-0000-0000-000000000003'::uuid;
  v_viewer_id  uuid := 'w0000000-0000-0000-0000-000000000004'::uuid;
  v_rm_del02   uuid := 'w0000000-0000-0000-0000-000000000005'::uuid;
BEGIN
  -- Insert into auth.users for foreign key integrity
  INSERT INTO auth.users (id, email)
  VALUES
    (v_staff_id,   'test_waste_staff@example.test'),
    (v_rm_id,      'test_waste_rm@example.test'),
    (v_fc_id,      'test_waste_fc@example.test'),
    (v_viewer_id,  'test_waste_viewer@example.test'),
    (v_rm_del02,   'test_waste_rm_del02@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- Insert into m_users for stock movement created_by_user_id FK
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES
    (v_staff_id::text,  'test_waste_staff@example.test',  'Test Waste Staff', true),
    (v_rm_id::text,     'test_waste_rm@example.test',     'Test Waste RM', true),
    (v_fc_id::text,     'test_waste_fc@example.test',     'Test Waste FC', true),
    (v_viewer_id::text, 'test_waste_viewer@example.test', 'Test Waste Viewer', true),
    (v_rm_del02::text,  'test_waste_rm_del02@example.test','Test Waste RM Delhi 2', true)
  ON CONFLICT (user_id) DO NOTHING;

  -- Setup role permissions
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-w-staff',   v_staff_id::text,  'ADMIN'::user_role,    'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-w-rm',      v_rm_id::text,     'RM'::user_role,       'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-w-fc',      v_fc_id::text,     'APPROVER'::user_role, 'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-w-viewer',  v_viewer_id::text, 'VIEWER'::user_role,   'IND-DEL-01', NULL,           'ALL'::section_id),
    ('perm-w-rmdel02', v_rm_del02::text,  'RM'::user_role,       'IND-DEL-02', NULL,           'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- Ensure store and warehouses exist
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES
    ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true),
    ('IND-DEL-02', 'Delhi Store 2', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;

  INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, storage_type, status, is_active)
  VALUES
    ('WH-DEL01-DRY',  'IND-DEL-01', 'Delhi Store 1 Dry Store',  'DRY_STORE', 'ACTIVE', true),
    ('WH-DEL01-COLD', 'IND-DEL-01', 'Delhi Store 1 Cold Room',  'COLD_ROOM', 'ACTIVE', true),
    ('WH-DEL02-COLD', 'IND-DEL-02', 'Delhi Store 2 Cold Room',  'COLD_ROOM', 'ACTIVE', true)
  ON CONFLICT (warehouse_id) DO NOTHING;

  -- Ensure test item exists
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES
    ('ITM-DRY-001', 'San Marzano Canned Tomatoes', 'CANNED', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- Ensure threshold config for store IND-DEL-01 is explicitly 5.000 kg
  INSERT INTO public.t_waste_threshold_config (store_id, minor_threshold_qty)
  VALUES
    ('IND-DEL-01', 5.000),
    ('IND-DEL-02', 5.000)
  ON CONFLICT (store_id) DO UPDATE SET minor_threshold_qty = 5.000;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TABLE EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_table('public', 't_waste_threshold_config', 'Table t_waste_threshold_config exists');
SELECT has_table('public', 't_waste_returns_log', 'Table t_waste_returns_log exists');

-- ---------------------------------------------------------------------------
-- 2. PRIMARY KEYS
-- ---------------------------------------------------------------------------
SELECT col_is_pk('public', 't_waste_threshold_config', 'config_id', 't_waste_threshold_config PK is config_id');
SELECT col_is_pk('public', 't_waste_returns_log', 'log_id', 't_waste_returns_log PK is log_id');

-- ---------------------------------------------------------------------------
-- 3. EXACT COLUMNS
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'public',
  't_waste_threshold_config',
  ARRAY['config_id', 'store_id', 'minor_threshold_qty', 'created_at', 'updated_at'],
  't_waste_threshold_config has exact expected columns'
);

SELECT columns_are(
  'public',
  't_waste_returns_log',
  ARRAY[
    'log_id', 'store_id', 'warehouse_id', 'movement_id', 'movement_type',
    'item_code', 'quantity', 'uom', 'po_number', 'grpo_doc_no', 'photo_url',
    'reason_code', 'reason_text', 'logged_by_user_id', 'approver_user_id',
    'approver_decision', 'approver_comment', 'driver_signature_blob',
    'created_at', 'authorized_at'
  ],
  't_waste_returns_log has exact expected columns'
);

-- ---------------------------------------------------------------------------
-- 4. COLUMN DATA TYPES
-- ---------------------------------------------------------------------------
SELECT col_type_is('public', 't_waste_threshold_config', 'config_id', 'uuid', 't_waste_threshold_config.config_id is uuid');
SELECT col_type_is('public', 't_waste_threshold_config', 'minor_threshold_qty', 'numeric(12,3)', 't_waste_threshold_config.minor_threshold_qty is numeric(12,3)');
SELECT col_type_is('public', 't_waste_returns_log', 'log_id', 'uuid', 't_waste_returns_log.log_id is uuid');
SELECT col_type_is('public', 't_waste_returns_log', 'quantity', 'numeric(12,3)', 't_waste_returns_log.quantity is numeric(12,3)');
SELECT col_type_is('public', 't_waste_returns_log', 'logged_by_user_id', 'uuid', 't_waste_returns_log.logged_by_user_id is uuid');
SELECT col_type_is('public', 't_waste_returns_log', 'approver_user_id', 'uuid', 't_waste_returns_log.approver_user_id is uuid');

-- ---------------------------------------------------------------------------
-- 5. FOREIGN KEYS
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 't_waste_threshold_config', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_waste_returns_log', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_waste_returns_log', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_waste_returns_log', 'item_code', 'public', 'm_items', 'item_code');
SELECT fk_ok('public', 't_waste_returns_log', 'movement_id', 'public', 't_stock_movements', 'movement_id');
SELECT fk_ok('public', 't_waste_returns_log', 'logged_by_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_waste_returns_log', 'approver_user_id', 'auth', 'users', 'id');

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) STATUS
-- ---------------------------------------------------------------------------
SELECT is(rowsecurity, true, 't_waste_threshold_config has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_waste_threshold_config';

SELECT is(rowsecurity, true, 't_waste_returns_log has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_waste_returns_log';

-- ---------------------------------------------------------------------------
-- 7. TABLE CONSTRAINTS & SEGREGATION CHECKS
-- ---------------------------------------------------------------------------
-- 7.1 Quantity must be strictly positive
SELECT throws_ok(
  $$
    INSERT INTO public.t_waste_returns_log (
      store_id, warehouse_id, movement_type, item_code, quantity, uom,
      reason_code, reason_text, logged_by_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', -5.000, 'kg',
      'TEST', 'Negative quantity', 'w0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint check rejects non-positive quantity'
);

-- 7.2 Movement type must be WASTE_DISPOSAL or SUPPLIER_RETURN
SELECT throws_ok(
  $$
    INSERT INTO public.t_waste_returns_log (
      store_id, warehouse_id, movement_type, item_code, quantity, uom,
      reason_code, reason_text, logged_by_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'INVALID_OUTFLOW', 'ITM-DRY-001', 1.000, 'kg',
      'TEST', 'Invalid movement type', 'w0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint check rejects invalid movement_type'
);

-- 7.3 Approver decision must be PENDING, APPROVED, or REJECTED
SELECT throws_ok(
  $$
    INSERT INTO public.t_waste_returns_log (
      store_id, warehouse_id, movement_type, item_code, quantity, uom,
      reason_code, reason_text, logged_by_user_id, approver_decision
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
      'TEST', 'Invalid status', 'w0000000-0000-0000-0000-000000000001'::uuid, 'UNKNOWN'
    );
  $$,
  '23514',
  NULL,
  'Constraint check rejects invalid approver_decision'
);

-- 7.4 Segregation of duties: logger cannot equal approver
SELECT throws_ok(
  $$
    INSERT INTO public.t_waste_returns_log (
      store_id, warehouse_id, movement_type, item_code, quantity, uom,
      reason_code, reason_text, logged_by_user_id, approver_user_id
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
      'TEST', 'Same user', 'w0000000-0000-0000-0000-000000000001'::uuid, 'w0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_waste_distinct_users blocks identical logger and approver'
);

-- 7.5 Supplier return requires reference doc and driver signature
SELECT throws_ok(
  $$
    INSERT INTO public.t_waste_returns_log (
      store_id, warehouse_id, movement_type, item_code, quantity, uom,
      reason_code, reason_text, logged_by_user_id, po_number, driver_signature_blob
    ) VALUES (
      'IND-DEL-01', 'WH-DEL01-DRY', 'SUPPLIER_RETURN', 'ITM-DRY-001', 1.000, 'kg',
      'TEST', 'Missing sig', 'w0000000-0000-0000-0000-000000000001'::uuid, 'PO-123', NULL
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_supplier_return_requirements blocks supplier return without driver signature'
);

-- ---------------------------------------------------------------------------
-- 8. IMMUTABILITY TRIGGERS & MUTATION PROTECTION
-- ---------------------------------------------------------------------------
-- 8.1 DELETE on t_waste_returns_log is blocked
INSERT INTO public.t_waste_returns_log (
  log_id, store_id, warehouse_id, movement_type, item_code, quantity, uom,
  reason_code, reason_text, logged_by_user_id
) VALUES (
  'w0000000-0000-0000-0000-000000000099'::uuid,
  'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
  'TEST', 'Test delete immutability', 'w0000000-0000-0000-0000-000000000001'::uuid
);

SELECT throws_ok(
  $$ DELETE FROM public.t_waste_returns_log WHERE log_id = 'w0000000-0000-0000-0000-000000000099'::uuid $$,
  'P0001',
  'Waste and supplier return logs are append-only and cannot be deleted.',
  'DELETE on t_waste_returns_log is blocked by append-only trigger'
);

-- 8.2 Direct UPDATE on finalized record is blocked
INSERT INTO public.t_waste_returns_log (
  log_id, store_id, warehouse_id, movement_type, item_code, quantity, uom,
  reason_code, reason_text, logged_by_user_id, approver_user_id, approver_decision, authorized_at
) VALUES (
  'w0000000-0000-0000-0000-000000000098'::uuid,
  'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
  'TEST', 'Test finalized tamper', 'w0000000-0000-0000-0000-000000000001'::uuid,
  'w0000000-0000-0000-0000-000000000002'::uuid, 'APPROVED', now()
);

SELECT throws_ok(
  $$ UPDATE public.t_waste_returns_log SET quantity = 999.000 WHERE log_id = 'w0000000-0000-0000-0000-000000000098'::uuid $$,
  'P0001',
  'Finalized waste or return records cannot be modified (current status: APPROVED).',
  'Direct UPDATE on finalized t_waste_returns_log is blocked by trigger'
);

-- ---------------------------------------------------------------------------
-- 9. RPC FUNCTION EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public',
  'log_waste_or_return',
  ARRAY['text', 'text', 'text', 'text', 'numeric', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
  'Function log_waste_or_return exists with expected argument signature'
);

SELECT has_function(
  'public',
  'approve_waste_or_return',
  ARRAY['uuid', 'text', 'text'],
  'Function approve_waste_or_return exists with expected argument signature'
);

-- ---------------------------------------------------------------------------
-- 10. RPC: log_waste_or_return (Allowed & Denied Scenarios)
-- ---------------------------------------------------------------------------
-- 10.1 Staff can log minor waste
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

INSERT INTO _test_waste_ids (key, id)
VALUES ('minor_waste', public.log_waste_or_return(
  'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 2.500, 'kg',
  'SPOILAGE', 'Expired basil wilted', 'https://example.test/photo1.jpg'
));

SELECT ok(
  (SELECT id FROM _test_waste_ids WHERE key = 'minor_waste') IS NOT NULL,
  'Staff can log minor waste via RPC'
);

-- 10.2 Staff can log major waste
INSERT INTO _test_waste_ids (key, id)
VALUES ('major_waste', public.log_waste_or_return(
  'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 12.000, 'kg',
  'CONTAMINATION', 'Bulk bag damaged during storm', 'https://example.test/photo2.jpg'
));

SELECT ok(
  (SELECT id FROM _test_waste_ids WHERE key = 'major_waste') IS NOT NULL,
  'Staff can log major waste via RPC'
);

-- 10.3 Staff can log supplier return with PO reference and driver signature
INSERT INTO _test_waste_ids (key, id)
VALUES ('supplier_return', public.log_waste_or_return(
  'IND-DEL-01', 'WH-DEL01-DRY', 'SUPPLIER_RETURN', 'ITM-DRY-001', 8.000, 'kg',
  'SUPPLIER_DEFECT', 'Damaged cans on delivery', NULL, 'PO-2026-991', NULL, 'data:image/png;base64,driver_sig_123'
));

SELECT ok(
  (SELECT id FROM _test_waste_ids WHERE key = 'supplier_return') IS NOT NULL,
  'Staff can log supplier return via RPC'
);

-- 10.4 Denied: Supplier return missing both PO and GRPO references
SELECT throws_ok(
  $$ SELECT public.log_waste_or_return(
       'IND-DEL-01', 'WH-DEL01-DRY', 'SUPPLIER_RETURN', 'ITM-DRY-001', 5.000, 'kg',
       'DEFECT', 'No ref doc', NULL, NULL, NULL, 'data:sig'
     ); $$,
  'P0001',
  'Supplier return requires a PO number or GRPO document reference.',
  'RPC rejects supplier return missing both PO and GRPO references'
);

-- 10.5 Denied: Supplier return missing driver signature
SELECT throws_ok(
  $$ SELECT public.log_waste_or_return(
       'IND-DEL-01', 'WH-DEL01-DRY', 'SUPPLIER_RETURN', 'ITM-DRY-001', 5.000, 'kg',
       'DEFECT', 'No driver sig', NULL, 'PO-100', NULL, NULL
     ); $$,
  'P0001',
  'Supplier return requires a driver signature blob.',
  'RPC rejects supplier return missing driver signature'
);

-- 10.6 Denied: Non-existent warehouse
SELECT throws_ok(
  $$ SELECT public.log_waste_or_return(
       'IND-DEL-01', 'WH-NONEXISTENT', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
       'DEFECT', 'Invalid warehouse', NULL, NULL, NULL, NULL
     ); $$,
  'P0001',
  NULL,
  'RPC rejects logging for non-existent warehouse'
);

-- 10.7 Denied: Viewer role cannot log waste
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'VIEWER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.log_waste_or_return(
       'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
       'DEFECT', 'Viewer log attempt', NULL, NULL, NULL, NULL
     ); $$,
  'P0001',
  'Unauthorized: Viewers have read-only access.',
  'Viewer role is blocked from logging waste'
);

-- 10.8 Denied: Store scope mismatch
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$ SELECT public.log_waste_or_return(
       'IND-DEL-02', 'WH-DEL02-COLD', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
       'DEFECT', 'Cross store log attempt', NULL, NULL, NULL, NULL
     ); $$,
  'P0001',
  NULL,
  'Store scope mismatch rejected by log_waste_or_return'
);

-- ---------------------------------------------------------------------------
-- 11. RPC: approve_waste_or_return (Thresholds, Roles, Ledger Append)
-- ---------------------------------------------------------------------------
-- 11.1 Segregation of duties: Logger cannot approve own claim
SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return((SELECT id FROM _test_waste_ids WHERE key = 'minor_waste'), 'APPROVED'); $$,
  'P0001',
  'Segregation of duties violation: Logger cannot approve or reject own claim.',
  'Logger cannot approve own claim (segregation of duties)'
);

-- 11.2 RM can approve minor waste (quantity 2.500 <= threshold 5.000)
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$ SELECT public.approve_waste_or_return(
       (SELECT id FROM _test_waste_ids WHERE key = 'minor_waste'),
       'APPROVED',
       'RM approved minor waste disposal'
     ); $$,
  'Restaurant Manager (RM) can approve minor waste below threshold'
);

-- 11.3 Verify minor waste row is marked APPROVED with RM approver
SELECT is(
  (SELECT approver_decision || ':' || approver_user_id::text
   FROM public.t_waste_returns_log
   WHERE log_id = (SELECT id FROM _test_waste_ids WHERE key = 'minor_waste')),
  'APPROVED:w0000000-0000-0000-0000-000000000002',
  'Minor waste log is marked APPROVED with approver_user_id matching RM'
);

-- 11.4 Verify minor waste appends WASTE_DISPOSAL (-2.500) to t_stock_movements
SELECT is(
  (SELECT quantity FROM public.t_stock_movements
   WHERE movement_id = (SELECT movement_id FROM public.t_waste_returns_log WHERE log_id = (SELECT id FROM _test_waste_ids WHERE key = 'minor_waste'))),
  -2.500,
  'Approved minor waste appends WASTE_DISPOSAL movement with -2.500 kg to ledger'
);

-- 11.5 Denied: RM cannot approve major waste (quantity 12.000 > threshold 5.000)
SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return(
       (SELECT id FROM _test_waste_ids WHERE key = 'major_waste'),
       'APPROVED',
       'RM trying to approve major waste'
     ); $$,
  'P0001',
  'Unauthorized: Restaurant Manager (RM) cannot approve major waste (quantity 12.000 exceeds minor threshold 5.000). Approver (FC) role required.',
  'RM attempting to approve major waste is rejected'
);

-- 11.6 Verify major waste remains PENDING after unauthorized RM attempt
SELECT is(
  (SELECT approver_decision FROM public.t_waste_returns_log WHERE log_id = (SELECT id FROM _test_waste_ids WHERE key = 'major_waste')),
  'PENDING',
  'Major waste remains PENDING after unauthorized RM approval attempt'
);

-- 11.7 FC (APPROVER) can approve major waste
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT lives_ok(
  $$ SELECT public.approve_waste_or_return(
       (SELECT id FROM _test_waste_ids WHERE key = 'major_waste'),
       'APPROVED',
       'FC authorized bulk storm disposal'
     ); $$,
  'Financial Controller (APPROVER) can approve major waste'
);

-- 11.8 Verify major waste row is marked APPROVED with FC approver
SELECT is(
  (SELECT approver_decision || ':' || approver_user_id::text
   FROM public.t_waste_returns_log
   WHERE log_id = (SELECT id FROM _test_waste_ids WHERE key = 'major_waste')),
  'APPROVED:w0000000-0000-0000-0000-000000000003',
  'Major waste log is marked APPROVED with approver_user_id matching FC'
);

-- 11.9 Verify major waste appends WASTE_DISPOSAL (-12.000) to t_stock_movements
SELECT is(
  (SELECT quantity FROM public.t_stock_movements
   WHERE movement_id = (SELECT movement_id FROM public.t_waste_returns_log WHERE log_id = (SELECT id FROM _test_waste_ids WHERE key = 'major_waste'))),
  -12.000,
  'Approved major waste appends WASTE_DISPOSAL movement with -12.000 kg to ledger'
);

-- 11.10 Denied: RM cannot approve supplier return
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RM';

SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return(
       (SELECT id FROM _test_waste_ids WHERE key = 'supplier_return'),
       'APPROVED',
       'RM trying to approve return'
     ); $$,
  'P0001',
  'Unauthorized: Restaurant Manager (RM) cannot approve supplier returns. Approver (FC) role required.',
  'RM attempting to approve supplier return is rejected'
);

-- 11.11 FC (APPROVER) can approve supplier return
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';

SELECT lives_ok(
  $$ SELECT public.approve_waste_or_return(
       (SELECT id FROM _test_waste_ids WHERE key = 'supplier_return'),
       'APPROVED',
       'FC authorized supplier return'
     ); $$,
  'Financial Controller (APPROVER) can approve supplier return'
);

-- 11.12 Verify supplier return is APPROVED and appends SUPPLIER_RETURN (-8.000) to ledger
SELECT is(
  (SELECT (approver_decision = 'APPROVED') AND (movement_type = 'SUPPLIER_RETURN') AND (quantity = -8.000)
   FROM public.t_stock_movements sm
   JOIN public.t_waste_returns_log wrl ON wrl.movement_id = sm.movement_id
   WHERE wrl.log_id = (SELECT id FROM _test_waste_ids WHERE key = 'supplier_return')),
  true,
  'Supplier return is APPROVED and appends -8.000 SUPPLIER_RETURN movement to ledger'
);

-- 11.13 RM can reject a minor claim with comment
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';

INSERT INTO _test_waste_ids (key, id)
VALUES ('reject_claim', public.log_waste_or_return(
  'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
  'MISTAKE', 'Accidental damage suspected', 'https://example.test/photo-reject.jpg'
));

SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'RM';

SELECT lives_ok(
  $$ SELECT public.approve_waste_or_return(
       (SELECT id FROM _test_waste_ids WHERE key = 'reject_claim'),
       'REJECTED',
       'Goods reinspected and found usable in kitchen'
     ); $$,
  'Restaurant Manager (RM) can reject a waste claim with comment'
);

-- 11.14 Verify rejected claim has decision REJECTED, authorized_at set, and movement_id is null
SELECT is(
  (SELECT (approver_decision = 'REJECTED') AND (movement_id IS NULL) AND (authorized_at IS NOT NULL)
   FROM public.t_waste_returns_log
   WHERE log_id = (SELECT id FROM _test_waste_ids WHERE key = 'reject_claim')),
  true,
  'Rejected claim has approver_decision REJECTED, authorized_at set, and no movement created'
);

-- 11.15 Denied: Attempting to approve an already finalized claim
SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return((SELECT id FROM _test_waste_ids WHERE key = 'reject_claim'), 'APPROVED'); $$,
  'P0001',
  NULL,
  'Attempting to re-approve a finalized claim throws exception'
);

-- 11.16 Denied: Store scope mismatch when RM from another store attempts approval
SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';

INSERT INTO _test_waste_ids (key, id)
VALUES ('store2_test', public.log_waste_or_return(
  'IND-DEL-01', 'WH-DEL01-DRY', 'WASTE_DISPOSAL', 'ITM-DRY-001', 1.000, 'kg',
  'SPOILAGE', 'Minor spoilage test', 'https://example.test/photo.jpg'
));

SET LOCAL "request.jwt.claim.sub" = 'w0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_user_id" = 'w0000000-0000-0000-0000-000000000005';
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_store_id" = 'IND-DEL-02';

SELECT throws_ok(
  $$ SELECT public.approve_waste_or_return((SELECT id FROM _test_waste_ids WHERE key = 'store2_test'), 'APPROVED'); $$,
  'P0001',
  NULL,
  'Store scope mismatch rejected when RM from another store attempts approval'
);

-- ---------------------------------------------------------------------------
-- FINISH TESTING
-- ---------------------------------------------------------------------------
SELECT * FROM finish();
ROLLBACK;
