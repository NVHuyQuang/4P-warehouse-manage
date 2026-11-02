-- pgTAP Test Suite for Domain D4: Ledger Core, Immutability, Views, Functions & RLS
-- Non-negotiable: Quantities only. Zero financial or valuation data.

BEGIN;
SELECT plan(44);

-- ---------------------------------------------------------------------------
-- 1. TABLE & VIEWS EXISTENCE
-- ---------------------------------------------------------------------------
SELECT has_table('t_stock_movements', 'Table t_stock_movements exists');
SELECT col_is_pk('t_stock_movements', 'movement_id', 't_stock_movements PK is movement_id');

SELECT columns_are(
  't_stock_movements',
  ARRAY[
    'movement_id',
    'store_id',
    'warehouse_id',
    'item_code',
    'movement_type',
    'quantity',
    'uom',
    'batch_number',
    'expiry_date',
    'reference_doc_id',
    'created_by_user_id',
    'created_at'
  ],
  't_stock_movements has exact expected columns'
);

-- Foreign keys
SELECT fk_ok('t_stock_movements', 'store_id', 'm_stores', 'store_id');
SELECT fk_ok('t_stock_movements', 'warehouse_id', 'm_warehouses', 'warehouse_id');
SELECT fk_ok('t_stock_movements', 'item_code', 'm_items', 'item_code');
SELECT fk_ok('t_stock_movements', 'created_by_user_id', 'm_users', 'user_id');

-- Views
SELECT has_view('v_stock_current', 'View v_stock_current exists');
SELECT has_view('v_stock_lots_fifo', 'View v_stock_lots_fifo exists');
SELECT has_view('v_expiry_radar', 'View v_expiry_radar exists');

-- Functions
SELECT has_function('get_suggested_reorder', ARRAY['text', 'text', 'text'], 'Function get_suggested_reorder exists');
SELECT has_function('calculate_adu', ARRAY['text', 'text', 'text', 'integer'], 'Function calculate_adu exists');
SELECT has_function('tg_prevent_ledger_mutation', 'Function tg_prevent_ledger_mutation exists');

-- RLS Enabled
SELECT ok(relrowsecurity, 'RLS is enabled on t_stock_movements')
FROM pg_class WHERE relname = 't_stock_movements';

-- ---------------------------------------------------------------------------
-- 2. IMMUTABILITY ENFORCEMENT (Triggers & Permission Revocation)
-- ---------------------------------------------------------------------------
-- UPDATE on t_stock_movements throws exception
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET quantity = 999.000 WHERE item_code = 'ITM-DRY-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'UPDATE on t_stock_movements throws append-only immutability exception'
);

-- DELETE on t_stock_movements throws exception
SELECT throws_ok(
  $$ DELETE FROM public.t_stock_movements WHERE item_code = 'ITM-DRY-001' $$,
  'P0001',
  'Stock movements are append-only and cannot be updated or deleted.',
  'DELETE on t_stock_movements throws append-only immutability exception'
);

-- ---------------------------------------------------------------------------
-- 3. CHECK CONSTRAINT: MOVEMENT TYPE
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.t_stock_movements (
       store_id, warehouse_id, item_code, movement_type, quantity, uom, reference_doc_id, created_by_user_id
     ) VALUES (
       'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 'INVALID_MOVEMENT_TYPE', 10, 'kg', 'REF-ERR', 'usr-admin-01'
     ) $$,
  '23514',
  NULL,
  'Invalid movement_type throws check constraint violation'
);

-- ---------------------------------------------------------------------------
-- 4. DERIVED BOOK STOCK: DOC §4.1 WORKED EXAMPLES
-- ---------------------------------------------------------------------------
-- Example 1: Issue 5 kg, Runner Declines 5 kg (100 - 5 + 5 = 100 kg)
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-001'),
  100.000,
  'Worked Example 1: Reversal restores derived stock to 100 kg'
);

-- Example 2: Issue 5 kg, Runner Confirms 5 kg (100 - 5 + 5 - 5 = 95 kg)
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-002'),
  95.000,
  'Worked Example 2: Confirmation deducts exactly 5 kg to 95 kg'
);

-- Example 3: Issue 5 kg, Runner Confirms 3 kg and Declines 2 kg (100 - 5 + 5 - 3 = 97 kg)
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-003'),
  97.000,
  'Worked Example 3: Partial acceptance leaves 97 kg on shelf'
);

-- ---------------------------------------------------------------------------
-- 5. DYNAMIC TWO-STAGE ISSUE LIFECYCLE VERIFICATION
-- ---------------------------------------------------------------------------
-- Test item: ITM-DRY-004 (Fresh Active Yeast)
-- Step 0: Inbound receipt of 50 kg
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'GRPO_IMPORT', 50.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'GRPO-TEST-001', 'usr-admin-01'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-004'),
  50.000,
  'Step 0: Initial GRPO creates 50 kg book stock'
);

-- Step 1: Admin stages 10 kg (ISSUE_PENDING: -10)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'ISSUE_PENDING', -10.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'REQ-TEST-001', 'usr-admin-01'
);

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-004'),
  40.000,
  'Step 1: Staging 10 kg immediately drops book stock to 40 kg'
);

-- Step 2: Runner confirms 7 kg, declines 3 kg
-- Appends ISSUE_PENDING_OFFSET (+10) and ISSUE_CONFIRMED (-7)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
) VALUES 
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'ISSUE_PENDING_OFFSET', 10.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'REQ-TEST-001', 'usr-admin-01'),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'ISSUE_CONFIRMED', -7.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'REQ-TEST-001', 'usr-admin-01');

SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-004'),
  43.000,
  'Step 2: Confirmation of 7 kg yields net 43 kg on shelf (50 - 7 = 43)'
);

-- Step 3: Additional movement types: Waste, Transfer Out/In, Count Adjustment
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
) VALUES 
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'WASTE_DISPOSAL', -3.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'WST-TEST-001', 'usr-admin-01'),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'TRANSFER_OUT_INTRANSIT', -5.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'TRF-OUT-001', 'usr-admin-01'),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'TRANSFER_IN_RECEIVED', 15.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'TRF-IN-001', 'usr-admin-01'),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 'COUNT_ADJUSTMENT', 5.000, 'kg', 'BAT-YST-001', CURRENT_DATE + 30, 'CNT-ADJ-001', 'usr-admin-01');

-- Net: 43 - 3 - 5 + 15 + 5 = 55 kg
SELECT is(
  (SELECT book_stock FROM public.v_stock_current WHERE item_code = 'ITM-DRY-004'),
  55.000,
  'Step 3: Waste, Transfers, and Count Adjustment correctly apply to book stock (55 kg)'
);

-- ---------------------------------------------------------------------------
-- 6. FIFO ORDERING & LOT LIFECYCLE (v_stock_lots_fifo)
-- ---------------------------------------------------------------------------
-- Earliest expiry date lot sorts first
SELECT results_eq(
  $$ SELECT batch_number, quantity, expiry_status FROM public.v_stock_lots_fifo WHERE item_code = 'ITM-CHZ-001' ORDER BY expiry_date ASC NULLS LAST $$,
  $$ VALUES 
       ('BAT-CHZ-EXP'::text, 3.000::numeric, 'EXPIRED_LOCK'::text),
       ('BAT-CHZ-AMB'::text, 25.000::numeric, 'EXPIRY_AMBER'::text),
       ('BAT-CHZ-OK'::text, 36.000::numeric, 'FIFO_OK'::text)
  $$,
  'v_stock_lots_fifo lists active lots in FIFO order by expiry date'
);

-- Consume BAT-CHZ-EXP completely (3 kg remaining -> issue 3 kg)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
) VALUES (
  'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 'WASTE_DISPOSAL', -3.000, 'kg', 'BAT-CHZ-EXP', CURRENT_DATE - 2, 'WST-CHZ-DEPLETE', 'usr-admin-01'
);

-- Fully consumed lot should no longer appear in v_stock_lots_fifo
SELECT is_empty(
  $$ SELECT 1 FROM public.v_stock_lots_fifo WHERE item_code = 'ITM-CHZ-001' AND batch_number = 'BAT-CHZ-EXP' $$,
  'Depleted lot (remaining qty = 0) is excluded from v_stock_lots_fifo'
);

-- ---------------------------------------------------------------------------
-- 7. EXPIRY RADAR (v_expiry_radar)
-- ---------------------------------------------------------------------------
-- Lot with expiry_date <= CURRENT_DATE has status EXPIRED_LOCK
-- Seed a new expired lot for ITM-MET-001 (category MEAT, warning_days = 5)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id
) VALUES 
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-001', 'GRPO_IMPORT', 12.000, 'kg', 'BAT-MET-EXP', CURRENT_DATE - 1, 'GRPO-MET-EXP', 'usr-admin-01'),
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-001', 'GRPO_IMPORT', 8.000, 'kg', 'BAT-MET-AMB', CURRENT_DATE + 3, 'GRPO-MET-AMB', 'usr-admin-01'),
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-001', 'GRPO_IMPORT', 20.000, 'kg', 'BAT-MET-SAFE', CURRENT_DATE + 20, 'GRPO-MET-SAFE', 'usr-admin-01');

SELECT is(
  (SELECT status FROM public.v_expiry_radar WHERE item_code = 'ITM-MET-001' AND batch_number = 'BAT-MET-EXP'),
  'EXPIRED_LOCK',
  'Expiry radar assigns EXPIRED_LOCK when days_to_expiry <= 0'
);

SELECT is(
  (SELECT status FROM public.v_expiry_radar WHERE item_code = 'ITM-MET-001' AND batch_number = 'BAT-MET-AMB'),
  'EXPIRY_AMBER',
  'Expiry radar assigns EXPIRY_AMBER when 0 < days_to_expiry <= warning_days'
);

SELECT is(
  (SELECT status FROM public.v_expiry_radar WHERE item_code = 'ITM-MET-001' AND batch_number = 'BAT-MET-SAFE'),
  'FIFO_OK',
  'Expiry radar assigns FIFO_OK when days_to_expiry > warning_days'
);

-- Non-tracked category (DRY_GOODS) always has status FIFO_OK
SELECT is(
  (SELECT status FROM public.v_expiry_radar WHERE item_code = 'ITM-DRY-001'),
  'FIFO_OK',
  'Non-lot-tracked category always receives status FIFO_OK'
);

-- ---------------------------------------------------------------------------
-- 8. REORDER & ADU FUNCTIONS
-- ---------------------------------------------------------------------------
-- 8.1 get_suggested_reorder:
-- For ITM-DRY-001: par_level = 500, reorder_point = 150. Current book_stock = 100.
-- Since 100 <= 150, suggested reorder = 500 - 100 = 400.
SELECT is(
  public.get_suggested_reorder('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001'),
  400.000,
  'get_suggested_reorder returns par_level - book_stock when stock <= reorder_point'
);

-- When stock > reorder_point: suggested reorder = 0
-- For ITM-DRY-002: par_level = 200, reorder_point = 60. Current book_stock = 95.
-- Since 95 > 60, suggested reorder = 0.
SELECT is(
  public.get_suggested_reorder('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-002'),
  0.000,
  'get_suggested_reorder returns 0 when stock > reorder_point'
);

-- When item has no reorder rule: returns 0
SELECT is(
  public.get_suggested_reorder('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-NONEXISTENT'),
  0.000,
  'get_suggested_reorder returns 0 when no rule exists'
);

-- 8.2 calculate_adu:
-- For ITM-CHZ-001: 14 kg confirmed issue + 7 kg waste + 3 kg waste = 24 kg in past 7 days.
-- ADU = 24 / 7 = 3.4286.
SELECT is(
  public.calculate_adu('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 7),
  3.4286,
  'calculate_adu computes average daily consumption over 7 days'
);

-- calculate_adu for item with zero consumption returns 0.0000
SELECT is(
  public.calculate_adu('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 7),
  0.0000,
  'calculate_adu returns 0 when no issues or waste exist in window'
);

-- ---------------------------------------------------------------------------
-- 9. ROW-LEVEL SECURITY & PERMISSIONS
-- ---------------------------------------------------------------------------

-- 9.1 Authenticated user (RUNNER) can SELECT from ledger and views
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "app.current_role" = 'RUNNER';

SELECT ok(
  (SELECT count(*) FROM public.t_stock_movements) > 0,
  'Authenticated RUNNER can read t_stock_movements'
);

SELECT ok(
  (SELECT count(*) FROM public.v_stock_current) > 0,
  'Authenticated RUNNER can read v_stock_current'
);

SELECT ok(
  (SELECT count(*) FROM public.v_stock_lots_fifo) > 0,
  'Authenticated RUNNER can read v_stock_lots_fifo'
);

SELECT ok(
  (SELECT count(*) FROM public.v_expiry_radar) > 0,
  'Authenticated RUNNER can read v_expiry_radar'
);

-- 9.2 Authenticated user can INSERT movements
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, reference_doc_id, created_by_user_id
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 'ISSUE_CONFIRMED', -1.000, 'kg', 'REQ-RLS-TEST', 'usr-runner-01'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.t_stock_movements WHERE reference_doc_id = 'REQ-RLS-TEST'),
  'Authenticated user can insert new movements into ledger'
);

-- 9.3 Authenticated user cannot UPDATE or DELETE
SELECT throws_ok(
  $$ UPDATE public.t_stock_movements SET quantity = 100 WHERE reference_doc_id = 'REQ-RLS-TEST' $$,
  NULL,
  NULL,
  'Authenticated user cannot UPDATE t_stock_movements'
);

SELECT throws_ok(
  $$ DELETE FROM public.t_stock_movements WHERE reference_doc_id = 'REQ-RLS-TEST' $$,
  NULL,
  NULL,
  'Authenticated user cannot DELETE t_stock_movements'
);

-- 9.4 Anon user is denied SELECT and INSERT on t_stock_movements
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claim.role" = 'anon';

SELECT is(
  (SELECT count(*) FROM public.t_stock_movements),
  0::bigint,
  'Anon user gets 0 rows from t_stock_movements under RLS'
);

SELECT throws_ok(
  $$ INSERT INTO public.t_stock_movements (
       store_id, warehouse_id, item_code, movement_type, quantity, uom, reference_doc_id, created_by_user_id
     ) VALUES (
       'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 'GRPO_IMPORT', 10, 'kg', 'ANON-REF', 'usr-admin-01'
     ) $$,
  '42501',
  NULL,
  'Anon user is denied INSERT on t_stock_movements'
);

SELECT * FROM finish();
ROLLBACK;
