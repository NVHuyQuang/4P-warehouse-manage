-- pgTAP Test Suite for Domain D12: SAP Ingestion Staging (Flow A-2)
-- Tables: m_store_warehouse_mapping, t_grpo_imports, t_grpo_import_items, t_grpo_staging_errors
-- RPCs: commit_grpo_import_batch, approve_grpo_correction
-- Invariants: Quantities only. Zero confidential valuation, tax, or commercial data.
-- Decision CR-02: t_grpo_imports.file_hash allows non-unique re-uploads.

BEGIN;
SELECT plan(62);

-- -----------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_admin_id uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_scm_id   uuid := 'a0000000-0000-0000-0000-000000000002'::uuid;
  v_fc_id    uuid := 'a0000000-0000-0000-0000-000000000003'::uuid;
  v_view_id  uuid := 'a0000000-0000-0000-0000-000000000004'::uuid;
BEGIN
  -- Insert into auth.users for foreign key integrity
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_admin_id, 'test_sap_admin@example.test', '{"full_name": "Test SAP Admin"}'::jsonb),
    (v_scm_id,   'test_sap_scm@example.test',   '{"full_name": "Test SAP SCM"}'::jsonb),
    (v_fc_id,    'test_sap_fc@example.test',    '{"full_name": "Test SAP FC"}'::jsonb),
    (v_view_id,  'test_sap_view@example.test',  '{"full_name": "Test SAP Viewer"}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- Insert into public.m_users
  INSERT INTO public.m_users (user_id, email, full_name, is_active)
  VALUES
    ('a0000000-0000-0000-0000-000000000001', 'test_sap_admin@example.test', 'Test SAP Admin', true),
    ('a0000000-0000-0000-0000-000000000002', 'test_sap_scm@example.test',   'Test SAP SCM', true),
    ('a0000000-0000-0000-0000-000000000003', 'test_sap_fc@example.test',    'Test SAP FC', true),
    ('a0000000-0000-0000-0000-000000000004', 'test_sap_view@example.test',  'Test SAP Viewer', true)
  ON CONFLICT (user_id) DO NOTHING;

  -- Insert permissions for test users
  INSERT INTO public.m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
  VALUES
    ('perm-test-admin', 'a0000000-0000-0000-0000-000000000001', 'ADMIN'::user_role, 'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
    ('perm-test-scm',   'a0000000-0000-0000-0000-000000000002', 'SCM'::user_role,   'IND-DEL-01', NULL, 'ALL'::section_id),
    ('perm-test-fc',    'a0000000-0000-0000-0000-000000000003', 'APPROVER'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
    ('perm-test-view',  'a0000000-0000-0000-0000-000000000004', 'VIEWER'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id)
  ON CONFLICT (permission_id) DO NOTHING;

  -- Add test item for SAP testing
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES ('ITM-SAP-001', 'San Marzano Tomatoes (SAP Test)', 'FOOD_IMPORT', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- Ensure mapping exists
  INSERT INTO public.m_store_warehouse_mapping (sap_store_code, sap_wh_code, store_id, warehouse_id, is_active)
  VALUES ('DEL01', 'DRY', 'IND-DEL-01', 'WH-DEL01-DRY', true)
  ON CONFLICT (sap_store_code, sap_wh_code) DO NOTHING;
END $$;

-- -----------------------------------------------------------------------------
-- 1. TABLE EXISTENCE (4 tests)
-- -----------------------------------------------------------------------------
SELECT has_table('public', 'm_store_warehouse_mapping', 'Table m_store_warehouse_mapping exists');
SELECT has_table('public', 't_grpo_imports', 'Table t_grpo_imports exists');
SELECT has_table('public', 't_grpo_import_items', 'Table t_grpo_import_items exists');
SELECT has_table('public', 't_grpo_staging_errors', 'Table t_grpo_staging_errors exists');

-- -----------------------------------------------------------------------------
-- 2. PRIMARY KEYS (4 tests)
-- -----------------------------------------------------------------------------
SELECT col_is_pk('public', 'm_store_warehouse_mapping', 'mapping_id', 'm_store_warehouse_mapping PK is mapping_id');
SELECT col_is_pk('public', 't_grpo_imports', 'import_id', 't_grpo_imports PK is import_id');
SELECT col_is_pk('public', 't_grpo_import_items', 'import_item_id', 't_grpo_import_items PK is import_item_id');
SELECT col_is_pk('public', 't_grpo_staging_errors', 'error_id', 't_grpo_staging_errors PK is error_id');

-- -----------------------------------------------------------------------------
-- 3. EXACT COLUMNS (4 tests)
-- -----------------------------------------------------------------------------
SELECT columns_are(
  'public',
  'm_store_warehouse_mapping',
  ARRAY['mapping_id', 'sap_store_code', 'sap_wh_code', 'store_id', 'warehouse_id', 'is_active', 'created_at', 'updated_at'],
  'm_store_warehouse_mapping has exact expected columns'
);

SELECT columns_are(
  'public',
  't_grpo_imports',
  ARRAY['import_id', 'store_id', 'file_name', 'file_hash', 'detected_header_row', 'total_rows', 'imported_rows', 'refreshed_rows', 'needs_approval_rows', 'quarantined_rows', 'uploaded_by_user_id', 'imported_at'],
  't_grpo_imports has exact expected columns'
);

SELECT columns_are(
  'public',
  't_grpo_import_items',
  ARRAY['import_item_id', 'import_id', 'grpo_no', 'line_key', 'item_code', 'warehouse_id', 'quantity', 'uom', 'doc_date', 'batch_number', 'expiry_date', 'vendor_code', 'base_document', 'status', 'movement_id', 'second_approver_id', 'second_approved_at', 'created_at'],
  't_grpo_import_items has exact expected columns'
);

SELECT columns_are(
  'public',
  't_grpo_staging_errors',
  ARRAY['error_id', 'import_id', 'row_number', 'raw_line_data', 'error_reason', 'quarantined_at'],
  't_grpo_staging_errors has exact expected columns'
);

-- -----------------------------------------------------------------------------
-- 4. FOREIGN KEYS (10 tests)
-- -----------------------------------------------------------------------------
SELECT fk_ok('public', 'm_store_warehouse_mapping', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 'm_store_warehouse_mapping', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_grpo_imports', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_grpo_imports', 'uploaded_by_user_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_grpo_import_items', 'import_id', 'public', 't_grpo_imports', 'import_id');
SELECT fk_ok('public', 't_grpo_import_items', 'item_code', 'public', 'm_items', 'item_code');
SELECT fk_ok('public', 't_grpo_import_items', 'warehouse_id', 'public', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('public', 't_grpo_import_items', 'movement_id', 'public', 't_stock_movements', 'movement_id');
SELECT fk_ok('public', 't_grpo_import_items', 'second_approver_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_grpo_staging_errors', 'import_id', 'public', 't_grpo_imports', 'import_id');

-- -----------------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY (RLS) STATUS (4 tests)
-- -----------------------------------------------------------------------------
SELECT is(rowsecurity, true, 'm_store_warehouse_mapping has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 'm_store_warehouse_mapping';

SELECT is(rowsecurity, true, 't_grpo_imports has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_grpo_imports';

SELECT is(rowsecurity, true, 't_grpo_import_items has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_grpo_import_items';

SELECT is(rowsecurity, true, 't_grpo_staging_errors has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_grpo_staging_errors';

-- -----------------------------------------------------------------------------
-- 6. RPC FUNCTION EXISTENCE (2 tests)
-- -----------------------------------------------------------------------------
SELECT has_function('public', 'commit_grpo_import_batch', ARRAY['uuid', 'jsonb'], 'Function commit_grpo_import_batch exists');
SELECT has_function('public', 'approve_grpo_correction', ARRAY['uuid', 'text'], 'Function approve_grpo_correction exists');

-- -----------------------------------------------------------------------------
-- 7. IMMUTABILITY OF STAGING ERRORS (2 tests)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_imp_id uuid;
BEGIN
  INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
  VALUES ('IND-DEL-01', 'test_immutability.xlsx', 'hash_immutability_01', 'a0000000-0000-0000-0000-000000000001'::uuid)
  RETURNING import_id INTO v_imp_id;

  INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
  VALUES (v_imp_id, 1, '{"raw": "bad"}', 'FORMAT_ERROR');
END $$;

SELECT throws_ok(
  $$ UPDATE public.t_grpo_staging_errors SET raw_line_data = 'tampered' WHERE error_reason = 'FORMAT_ERROR' $$,
  'P0001',
  'GRPO staging errors are append-only and cannot be updated or deleted.',
  'UPDATE on t_grpo_staging_errors is blocked by append-only immutability trigger'
);

SELECT throws_ok(
  $$ DELETE FROM public.t_grpo_staging_errors WHERE error_reason = 'FORMAT_ERROR' $$,
  'P0001',
  'GRPO staging errors are append-only and cannot be updated or deleted.',
  'DELETE on t_grpo_staging_errors is blocked by append-only immutability trigger'
);

-- -----------------------------------------------------------------------------
-- 8. DECISION CR-02: FILE HASH NON-UNIQUE RE-UPLOAD ALLOWED (1 test)
-- -----------------------------------------------------------------------------
SELECT lives_ok(
  $$
    INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
    VALUES
      ('IND-DEL-01', 'export_rev1.xlsx', 'shared_file_hash_cr02', 'a0000000-0000-0000-0000-000000000001'::uuid),
      ('IND-DEL-01', 'export_rev2_corrected.xlsx', 'shared_file_hash_cr02', 'a0000000-0000-0000-0000-000000000001'::uuid);
  $$,
  'Decision CR-02 verified: Duplicate file_hash does not violate uniqueness'
);

-- -----------------------------------------------------------------------------
-- 9. CONSTRAINTS (5 tests)
-- -----------------------------------------------------------------------------
-- 9.1 Duplicate mapping constraint
SELECT throws_ok(
  $$
    INSERT INTO public.m_store_warehouse_mapping (sap_store_code, sap_wh_code, store_id, warehouse_id)
    VALUES ('DEL01', 'DRY', 'IND-DEL-01', 'WH-DEL01-DRY');
  $$,
  '23505',
  NULL,
  'Constraint uq_sap_mapping blocks duplicate store/warehouse SAP codes'
);

-- 9.2 Quantity > 0 constraint
SELECT throws_ok(
  $$
    INSERT INTO public.t_grpo_import_items (
      import_id, grpo_no, line_key, item_code, warehouse_id, quantity, uom, doc_date
    ) VALUES (
      (SELECT import_id FROM public.t_grpo_imports LIMIT 1),
      'GRPO-TEST-00', 'GRPO-TEST-00_ITM-SAP-001_1', 'ITM-SAP-001', 'WH-DEL01-DRY', -5.000, 'kg', CURRENT_DATE
    );
  $$,
  '23514',
  NULL,
  'Check constraint enforces quantity > 0 on t_grpo_import_items'
);

-- 9.3 Invalid error_reason check
SELECT throws_ok(
  $$
    INSERT INTO public.t_grpo_staging_errors (
      import_id, row_number, raw_line_data, error_reason
    ) VALUES (
      (SELECT import_id FROM public.t_grpo_imports LIMIT 1),
      99, 'bad line data', 'INVALID_REASON_CODE'
    );
  $$,
  '23514',
  NULL,
  'Check constraint blocks unknown error_reason in t_grpo_staging_errors'
);

-- 9.4 Invalid status check
SELECT throws_ok(
  $$
    INSERT INTO public.t_grpo_import_items (
      import_id, grpo_no, line_key, item_code, warehouse_id, quantity, uom, doc_date, status
    ) VALUES (
      (SELECT import_id FROM public.t_grpo_imports LIMIT 1),
      'GRPO-TEST-BAD', 'GRPO-TEST-BAD_ITM-SAP-001_1', 'ITM-SAP-001', 'WH-DEL01-DRY', 10.000, 'kg', CURRENT_DATE, 'INVALID_STATUS'
    );
  $$,
  '23514',
  NULL,
  'Check constraint blocks invalid status on t_grpo_import_items'
);

-- 9.5 Duplicate (grpo_no, line_key) unique constraint
DO $$
DECLARE
  v_test_imp_id uuid;
BEGIN
  INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
  VALUES ('IND-DEL-01', 'dup_check.xlsx', 'hash_dup_check', 'a0000000-0000-0000-0000-000000000001'::uuid)
  RETURNING import_id INTO v_test_imp_id;

  INSERT INTO public.t_grpo_import_items (
    import_id, grpo_no, line_key, item_code, warehouse_id, quantity, uom, doc_date, status
  ) VALUES (
    v_test_imp_id, 'GRPO-DUP-01', 'GRPO-DUP-01_ITM-SAP-001_1', 'ITM-SAP-001', 'WH-DEL01-DRY', 10.000, 'kg', CURRENT_DATE, 'IMPORTED'
  );
END $$;

SELECT throws_ok(
  $$
    INSERT INTO public.t_grpo_import_items (
      import_id, grpo_no, line_key, item_code, warehouse_id, quantity, uom, doc_date, status
    ) VALUES (
      (SELECT import_id FROM public.t_grpo_imports WHERE file_name = 'dup_check.xlsx'),
      'GRPO-DUP-01', 'GRPO-DUP-01_ITM-SAP-001_1', 'ITM-SAP-001', 'WH-DEL01-DRY', 20.000, 'kg', CURRENT_DATE, 'IMPORTED'
    );
  $$,
  '23505',
  NULL,
  'Constraint uq_grpo_import_line_key blocks direct duplicate line keys'
);

-- -----------------------------------------------------------------------------
-- 10. FUNCTIONAL FLOW A-2 TESTS (19 tests)
-- -----------------------------------------------------------------------------
-- Setup session identity as Warehouse Keeper (ADMIN)
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- 10.1 Initial Import Test (5 tests)
DO $$
DECLARE
  v_import_1_id uuid;
  v_lines jsonb;
  v_res jsonb;
BEGIN
  INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
  VALUES ('IND-DEL-01', 'initial_grpo_run.xlsx', 'hash_run_1', 'a0000000-0000-0000-0000-000000000001'::uuid)
  RETURNING import_id INTO v_import_1_id;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'grpo_no', 'GRPO-2026-901',
      'line_key', 'GRPO-2026-901_ITM-SAP-001_1',
      'item_code', 'ITM-SAP-001',
      'sap_store_code', 'DEL01',
      'sap_wh_code', 'DRY',
      'quantity', 40.000,
      'uom', 'kg',
      'doc_date', CURRENT_DATE::text,
      'batch_number', 'BAT-SAP-901',
      'expiry_date', (CURRENT_DATE + 90)::text,
      'vendor_code', 'VEND-INDIA-01',
      'base_document', 'PO-9001'
    )
  );

  v_res := public.commit_grpo_import_batch(v_import_1_id, v_lines);
END $$;

SELECT is(
  (SELECT imported_rows FROM public.t_grpo_imports WHERE file_hash = 'hash_run_1'),
  1,
  'Initial import: imported_rows is 1'
);

SELECT is(
  (SELECT status FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'IMPORTED',
  'Initial import: status is IMPORTED'
);

SELECT ok(
  (SELECT movement_id IS NOT NULL FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'Initial import: movement_id is linked'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE reference_doc_id = 'GRPO-2026-901-GRPO-2026-901_ITM-SAP-001_1' AND quantity = 40.000),
  1,
  'Initial import: exactly 1 GRPO_IMPORT movement posted with +40.000 kg'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-SAP-001' AND warehouse_id = 'WH-DEL01-DRY'),
  40.000,
  'Initial import: derived book stock is 40.000 kg'
);

-- 10.2 O/C Metadata Refresh Test with Zero Stock Change (4 tests)
DO $$
DECLARE
  v_import_2_id uuid;
  v_lines jsonb;
  v_res jsonb;
BEGIN
  INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
  VALUES ('IND-DEL-01', 'refresh_grpo_run.xlsx', 'hash_run_2', 'a0000000-0000-0000-0000-000000000001'::uuid)
  RETURNING import_id INTO v_import_2_id;

  -- Same grpo_no, same line_key, same item, same quantity, updated base_document (simulating O/C status close)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'grpo_no', 'GRPO-2026-901',
      'line_key', 'GRPO-2026-901_ITM-SAP-001_1',
      'item_code', 'ITM-SAP-001',
      'sap_store_code', 'DEL01',
      'sap_wh_code', 'DRY',
      'quantity', 40.000,
      'uom', 'kg',
      'doc_date', CURRENT_DATE::text,
      'batch_number', 'BAT-SAP-901',
      'expiry_date', (CURRENT_DATE + 90)::text,
      'vendor_code', 'VEND-INDIA-01',
      'base_document', 'PO-9001-CLOSED'
    )
  );

  v_res := public.commit_grpo_import_batch(v_import_2_id, v_lines);
END $$;

SELECT is(
  (SELECT refreshed_rows FROM public.t_grpo_imports WHERE file_hash = 'hash_run_2'),
  1,
  'Metadata refresh: refreshed_rows is 1'
);

SELECT is(
  (SELECT status FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'REFRESHED',
  'Metadata refresh: status updated to REFRESHED'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE item_code = 'ITM-SAP-001'),
  1,
  'Metadata refresh: zero new stock movements created'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-SAP-001' AND warehouse_id = 'WH-DEL01-DRY'),
  40.000,
  'Metadata refresh: derived book stock remains unchanged at 40.000 kg'
);

-- 10.3 Quantity Correction Test: NEEDS_2ND_APPROVAL (4 tests)
DO $$
DECLARE
  v_import_3_id uuid;
  v_lines jsonb;
  v_res jsonb;
BEGIN
  INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
  VALUES ('IND-DEL-01', 'corrected_grpo_run.xlsx', 'hash_run_3', 'a0000000-0000-0000-0000-000000000001'::uuid)
  RETURNING import_id INTO v_import_3_id;

  -- Same grpo_no and line_key, but corrected quantity 60.000 kg (changed from 40.000)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'grpo_no', 'GRPO-2026-901',
      'line_key', 'GRPO-2026-901_ITM-SAP-001_1',
      'item_code', 'ITM-SAP-001',
      'sap_store_code', 'DEL01',
      'sap_wh_code', 'DRY',
      'quantity', 60.000,
      'uom', 'kg',
      'doc_date', CURRENT_DATE::text,
      'batch_number', 'BAT-SAP-901-CORR',
      'expiry_date', (CURRENT_DATE + 90)::text,
      'vendor_code', 'VEND-INDIA-01',
      'base_document', 'PO-9001-REV'
    )
  );

  v_res := public.commit_grpo_import_batch(v_import_3_id, v_lines);
END $$;

SELECT is(
  (SELECT needs_approval_rows FROM public.t_grpo_imports WHERE file_hash = 'hash_run_3'),
  1,
  'Quantity correction: needs_approval_rows is 1'
);

SELECT is(
  (SELECT status FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'NEEDS_2ND_APPROVAL',
  'Quantity correction: status set to NEEDS_2ND_APPROVAL'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE item_code = 'ITM-SAP-001'),
  1,
  'Quantity correction: zero stock movements before 2nd approval'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-SAP-001' AND warehouse_id = 'WH-DEL01-DRY'),
  40.000,
  'Quantity correction: derived book stock remains unchanged before approval'
);

-- 10.4 Second Approval: approve_grpo_correction (7 tests)
-- Switch identity to Financial Controller (APPROVER) for second approval
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'APPROVER';

DO $$
DECLARE
  v_item_id uuid;
BEGIN
  SELECT import_item_id INTO v_item_id
  FROM public.t_grpo_import_items
  WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1';

  PERFORM public.approve_grpo_correction(v_item_id, 'Approved invoice correction from 40 to 60 kg');
END $$;

SELECT is(
  (SELECT status FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'APPROVED_REVERSAL',
  'Second approval: status updated to APPROVED_REVERSAL'
);

SELECT is(
  (SELECT second_approver_id FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'a0000000-0000-0000-0000-000000000003'::uuid,
  'Second approval: second_approver_id recorded'
);

SELECT ok(
  (SELECT second_approved_at IS NOT NULL FROM public.t_grpo_import_items WHERE grpo_no = 'GRPO-2026-901' AND line_key = 'GRPO-2026-901_ITM-SAP-001_1'),
  'Second approval: second_approved_at timestamp recorded'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE reference_doc_id LIKE 'REV-GRPO-2026-901%' AND quantity = -40.000),
  1,
  'Second approval: offsetting negative reversal posted (-40.000 kg)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE reference_doc_id = 'GRPO-2026-901-GRPO-2026-901_ITM-SAP-001_1' AND quantity = 60.000),
  1,
  'Second approval: new corrected movement posted (+60.000 kg)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE item_code = 'ITM-SAP-001'),
  3,
  'Second approval: exactly 3 append-only movements exist (40, -40, +60)'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-SAP-001' AND warehouse_id = 'WH-DEL01-DRY'),
  60.000,
  'Second approval: derived book stock correctly updated to 60.000 kg'
);

-- -----------------------------------------------------------------------------
-- 11. QUARANTINED STAGING ERRORS TEST (4 tests)
-- -----------------------------------------------------------------------------
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';

DO $$
DECLARE
  v_import_err_id uuid;
  v_lines jsonb;
  v_res jsonb;
BEGIN
  INSERT INTO public.t_grpo_imports (store_id, file_name, file_hash, uploaded_by_user_id)
  VALUES ('IND-DEL-01', 'quarantine_test.xlsx', 'hash_quarantine', 'a0000000-0000-0000-0000-000000000001'::uuid)
  RETURNING import_id INTO v_import_err_id;

  v_lines := jsonb_build_array(
    jsonb_build_object('row_number', 2, 'grpo_no', 'GRPO-ERR-1', 'line_key', 'LK-1', 'item_code', 'NON_EXISTENT_ITEM', 'quantity', 10, 'uom', 'kg', 'doc_date', CURRENT_DATE::text, 'sap_store_code', 'DEL01', 'sap_wh_code', 'DRY'),
    jsonb_build_object('row_number', 3, 'grpo_no', 'GRPO-ERR-2', 'line_key', 'LK-2', 'item_code', 'ITM-SAP-001', 'quantity', -5, 'uom', 'kg', 'doc_date', CURRENT_DATE::text, 'sap_store_code', 'DEL01', 'sap_wh_code', 'DRY'),
    jsonb_build_object('row_number', 4, 'grpo_no', 'GRPO-ERR-3', 'line_key', 'LK-3', 'item_code', 'ITM-SAP-001', 'quantity', 10, 'uom', 'invalid_uom_code', 'doc_date', CURRENT_DATE::text, 'sap_store_code', 'DEL01', 'sap_wh_code', 'DRY'),
    jsonb_build_object('row_number', 5, 'grpo_no', 'GRPO-ERR-4', 'line_key', 'LK-4', 'item_code', 'ITM-SAP-001', 'quantity', 10, 'uom', 'kg', 'doc_date', CURRENT_DATE::text, 'sap_store_code', 'UNKNOWN_STORE', 'sap_wh_code', 'UNKNOWN_WH')
  );

  v_res := public.commit_grpo_import_batch(v_import_err_id, v_lines);
END $$;

SELECT is(
  (SELECT quarantined_rows FROM public.t_grpo_imports WHERE file_hash = 'hash_quarantine'),
  4,
  'Quarantine test: quarantined_rows count is 4'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_grpo_staging_errors WHERE import_id = (SELECT import_id FROM public.t_grpo_imports WHERE file_hash = 'hash_quarantine')),
  4,
  'Quarantine test: exactly 4 staging error records inserted'
);

SELECT set_eq(
  $$ SELECT error_reason FROM public.t_grpo_staging_errors WHERE import_id = (SELECT import_id FROM public.t_grpo_imports WHERE file_hash = 'hash_quarantine') $$,
  ARRAY['MISSING_ITEM_CODE', 'INVALID_QTY', 'UNMAPPED_UOM', 'UNMAPPED_STORE'],
  'Quarantine test: error reasons correctly classified'
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_stock_movements WHERE reference_doc_id LIKE 'GRPO-ERR%'),
  0,
  'Quarantine test: zero movements posted for quarantined lines'
);

-- -----------------------------------------------------------------------------
-- 12. ROLE-BASED ACCESS CONTROL (RLS & RPC GUARDS) (2 tests)
-- -----------------------------------------------------------------------------
-- 12.1 VIEWER cannot import batches
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000004';
SET LOCAL "app.current_role" = 'VIEWER';

SELECT throws_ok(
  $$
    SELECT public.commit_grpo_import_batch(
      (SELECT import_id FROM public.t_grpo_imports LIMIT 1),
      '[]'::jsonb
    );
  $$,
  'P0001',
  'Unauthorized: Only Warehouse Keeper (ADMIN), SCM, or SYSTEM_ADMIN can import SAP GRPO batches.',
  'VIEWER role is blocked from executing commit_grpo_import_batch'
);

-- 12.2 ADMIN (Keeper) cannot approve corrections (only SCM or FC/APPROVER)
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$
    SELECT public.approve_grpo_correction(
      (SELECT import_item_id FROM public.t_grpo_import_items LIMIT 1),
      'Unauthorized keeper attempt'
    );
  $$,
  'P0001',
  'Unauthorized: Only SCM Lead, Financial Controller (APPROVER), or SYSTEM_ADMIN can approve GRPO corrections.',
  'ADMIN role is blocked from approving GRPO corrections'
);

SELECT * FROM finish();
ROLLBACK;
