-- pgTAP Test Suite for Domain D13: Approvals Inbox and Store/Warehouse Proposals
-- Migration: 0130_approvals_inbox.sql
-- Table: t_store_warehouse_approvals
-- View: v_approval_inbox
-- RPCs: propose_store_or_warehouse, decide_store_warehouse_proposal
-- Non-negotiable: Quantities only. Zero price, cost, valuation, tax, or vendor data anywhere.
-- Append-only principle: never mutate or delete t_stock_movements.

BEGIN;
SELECT plan(54);

-- ---------------------------------------------------------------------------
-- 0. TEST FIXTURES SETUP
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user_rm     uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  v_user_admin  uuid := 'a0000000-0000-0000-0000-000000000002'::uuid;
  v_user_fc     uuid := 'a0000000-0000-0000-0000-000000000003'::uuid;
  v_user_cust1  uuid := 'a0000000-0000-0000-0000-000000000004'::uuid;
  v_user_cust2  uuid := 'a0000000-0000-0000-0000-000000000005'::uuid;
  v_user_runner uuid := 'a0000000-0000-0000-0000-000000000006'::uuid;
  v_user_viewer uuid := 'a0000000-0000-0000-0000-000000000007'::uuid;
  v_user_fc2    uuid := 'a0000000-0000-0000-0000-000000000008'::uuid;
BEGIN
  -- Insert into auth.users for foreign key integrity
  INSERT INTO auth.users (id, email)
  VALUES
    (v_user_rm,     'test_rm_d13@example.test'),
    (v_user_admin,  'test_admin_d13@example.test'),
    (v_user_fc,     'test_fc_d13@example.test'),
    (v_user_cust1,  'test_cust1_d13@example.test'),
    (v_user_cust2,  'test_cust2_d13@example.test'),
    (v_user_runner, 'test_runner_d13@example.test'),
    (v_user_viewer, 'test_viewer_d13@example.test'),
    (v_user_fc2,    'test_fc2_d13@example.test')
  ON CONFLICT (id) DO NOTHING;

  -- Ensure test item exists for cross-domain tables
  INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active)
  VALUES ('RM-TST-01', 'Test Mozzarella Block', 'CHEESE', 'kg', true)
  ON CONFLICT (item_code) DO NOTHING;

  -- Ensure secondary test store exists
  INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
  VALUES ('IND-DEL-02', 'Delhi Connaught Place', 'Delhi', 'ACTIVE', true)
  ON CONFLICT (store_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 1. TABLE EXISTENCE & PRIMARY KEY
-- ---------------------------------------------------------------------------
SELECT has_table('public', 't_store_warehouse_approvals', 'Table t_store_warehouse_approvals exists');
SELECT col_is_pk('public', 't_store_warehouse_approvals', 'approval_id', 'approval_id is primary key');

-- ---------------------------------------------------------------------------
-- 2. EXACT COLUMNS & DATA TYPES
-- ---------------------------------------------------------------------------
SELECT columns_are(
  'public',
  't_store_warehouse_approvals',
  ARRAY[
    'approval_id',
    'proposal_type',
    'proposed_name',
    'store_id',
    'storage_type',
    'nominated_custodian_id',
    'nominated_backup_id',
    'fc_decision',
    'fc_comment',
    'requested_by_user_id',
    'requested_at',
    'decided_by_user_id',
    'decided_at'
  ],
  't_store_warehouse_approvals has exact expected columns'
);

SELECT col_type_is('public', 't_store_warehouse_approvals', 'approval_id', 'uuid', 'approval_id is uuid');
SELECT col_type_is('public', 't_store_warehouse_approvals', 'nominated_custodian_id', 'uuid', 'nominated_custodian_id is uuid');
SELECT col_type_is('public', 't_store_warehouse_approvals', 'nominated_backup_id', 'uuid', 'nominated_backup_id is uuid');
SELECT col_type_is('public', 't_store_warehouse_approvals', 'requested_by_user_id', 'uuid', 'requested_by_user_id is uuid');
SELECT col_type_is('public', 't_store_warehouse_approvals', 'decided_by_user_id', 'uuid', 'decided_by_user_id is uuid');

-- ---------------------------------------------------------------------------
-- 3. FOREIGN KEY RELATIONSHIPS
-- ---------------------------------------------------------------------------
SELECT fk_ok('public', 't_store_warehouse_approvals', 'store_id', 'public', 'm_stores', 'store_id');
SELECT fk_ok('public', 't_store_warehouse_approvals', 'nominated_custodian_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_store_warehouse_approvals', 'nominated_backup_id', 'auth', 'users', 'id');
SELECT fk_ok('public', 't_store_warehouse_approvals', 'requested_by_user_id', 'auth', 'users', 'id');

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) STATUS
-- ---------------------------------------------------------------------------
SELECT is(rowsecurity, true, 't_store_warehouse_approvals has rowsecurity enabled')
FROM pg_tables WHERE schemaname = 'public' AND tablename = 't_store_warehouse_approvals';

-- ---------------------------------------------------------------------------
-- 5. TABLE CONSTRAINTS
-- ---------------------------------------------------------------------------
-- 5.1 chk_proposal_distinct_custodians blocks identical custodian and backup
SELECT throws_ok(
  $$
    INSERT INTO public.t_store_warehouse_approvals (
      proposal_type, proposed_name, store_id, storage_type,
      nominated_custodian_id, nominated_backup_id, requested_by_user_id
    ) VALUES (
      'NEW_STORE', 'Invalid Store', NULL, NULL,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_proposal_distinct_custodians blocks identical custodian and backup'
);

-- 5.2 chk_proposal_proposed_name_not_empty blocks blank proposed name
SELECT throws_ok(
  $$
    INSERT INTO public.t_store_warehouse_approvals (
      proposal_type, proposed_name, store_id, storage_type,
      nominated_custodian_id, nominated_backup_id, requested_by_user_id
    ) VALUES (
      'NEW_STORE', '   ', NULL, NULL,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid,
      'a0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Constraint chk_proposal_proposed_name_not_empty blocks empty name'
);

-- 5.3 Invalid proposal_type is rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_store_warehouse_approvals (
      proposal_type, proposed_name, store_id, storage_type,
      nominated_custodian_id, nominated_backup_id, requested_by_user_id
    ) VALUES (
      'NEW_FRANCHISE', 'Franchise 1', NULL, NULL,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid,
      'a0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Invalid proposal_type rejected by check constraint'
);

-- 5.4 Invalid fc_decision is rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_store_warehouse_approvals (
      proposal_type, proposed_name, store_id, storage_type,
      nominated_custodian_id, nominated_backup_id, requested_by_user_id, fc_decision
    ) VALUES (
      'NEW_STORE', 'Pending Store', NULL, NULL,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid,
      'a0000000-0000-0000-0000-000000000001'::uuid,
      'HOLD'
    );
  $$,
  '23514',
  NULL,
  'Invalid fc_decision rejected by check constraint'
);

-- 5.5 Invalid storage_type is rejected
SELECT throws_ok(
  $$
    INSERT INTO public.t_store_warehouse_approvals (
      proposal_type, proposed_name, store_id, storage_type,
      nominated_custodian_id, nominated_backup_id, requested_by_user_id
    ) VALUES (
      'NEW_WAREHOUSE', 'Test Room', 'IND-DEL-01', 'OUTDOOR_SHED',
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid,
      'a0000000-0000-0000-0000-000000000001'::uuid
    );
  $$,
  '23514',
  NULL,
  'Invalid storage_type rejected by check constraint'
);

-- ---------------------------------------------------------------------------
-- 6. IMMUTABILITY & AUDIT TRIGGER ENFORCEMENT
-- ---------------------------------------------------------------------------
-- Direct DELETE on t_store_warehouse_approvals is blocked by trigger
INSERT INTO public.t_store_warehouse_approvals (
  approval_id, proposal_type, proposed_name, store_id, storage_type,
  nominated_custodian_id, nominated_backup_id, requested_by_user_id
) VALUES (
  'b0000000-0000-0000-0000-000000000099'::uuid,
  'NEW_STORE', 'Delete Test Store', NULL, NULL,
  'a0000000-0000-0000-0000-000000000004'::uuid,
  'a0000000-0000-0000-0000-000000000005'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid
);

SELECT throws_ok(
  $$
    DELETE FROM public.t_store_warehouse_approvals
    WHERE approval_id = 'b0000000-0000-0000-0000-000000000099'::uuid;
  $$,
  'P0001',
  'Store and warehouse proposals are audit records and cannot be deleted.',
  'Direct DELETE on t_store_warehouse_approvals blocked by tg_enforce_proposal_lifecycle'
);

-- ---------------------------------------------------------------------------
-- 7. RPC: propose_store_or_warehouse
-- ---------------------------------------------------------------------------
-- 7.1 Unauthorized role (RUNNER) cannot propose store
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000006';
SET LOCAL "app.current_role" = 'RUNNER';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

SELECT throws_ok(
  $$
    SELECT public.propose_store_or_warehouse(
      'NEW_STORE', 'Runner Proposed Store', NULL, NULL,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid
    );
  $$,
  'P0001',
  'Unauthorized: Only RM or Admin can propose new stores or warehouses.',
  'Non-RM/Admin (RUNNER) cannot propose stores or warehouses'
);

-- 7.2 Restaurant Manager (RM) can propose a NEW_STORE
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.propose_store_or_warehouse(
    'NEW_STORE',
    'Pizza 4Ps Bengaluru Indiranagar',
    'IND-BLR-01',
    NULL,
    'a0000000-0000-0000-0000-000000000004'::uuid,
    'a0000000-0000-0000-0000-000000000005'::uuid
  );
  PERFORM set_config('test.prop_store_id', v_id::text, true);
END $$;

SELECT ok(
  nullif(current_setting('test.prop_store_id', true), '') IS NOT NULL,
  'RM successfully proposed NEW_STORE and received approval_id'
);

SELECT is(
  (SELECT fc_decision FROM public.t_store_warehouse_approvals WHERE approval_id = current_setting('test.prop_store_id', true)::uuid),
  'PENDING',
  'Newly proposed store is initialized with fc_decision PENDING'
);

-- 7.3 Storekeeper / Admin can propose a NEW_WAREHOUSE
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000002';
SET LOCAL "app.current_role" = 'ADMIN';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.propose_store_or_warehouse(
    'NEW_WAREHOUSE',
    'Delhi Main Freezer Room',
    'IND-DEL-01',
    'FREEZER',
    'a0000000-0000-0000-0000-000000000004'::uuid,
    'a0000000-0000-0000-0000-000000000005'::uuid
  );
  PERFORM set_config('test.prop_wh_id', v_id::text, true);
END $$;

SELECT ok(
  nullif(current_setting('test.prop_wh_id', true), '') IS NOT NULL,
  'Admin successfully proposed NEW_WAREHOUSE and received approval_id'
);

SELECT is(
  (SELECT fc_decision FROM public.t_store_warehouse_approvals WHERE approval_id = current_setting('test.prop_wh_id', true)::uuid),
  'PENDING',
  'Newly proposed warehouse is initialized with fc_decision PENDING'
);

-- 7.4 Proposing warehouse without store_id throws
SELECT throws_ok(
  $$
    SELECT public.propose_store_or_warehouse(
      'NEW_WAREHOUSE', 'Orphan Warehouse', NULL, 'COLD_ROOM',
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid
    );
  $$,
  'P0001',
  'Store ID is required when proposing a new warehouse.',
  'Proposing warehouse without store_id is rejected'
);

-- 7.5 Proposing warehouse with non-existent store_id throws
SELECT throws_ok(
  $$
    SELECT public.propose_store_or_warehouse(
      'NEW_WAREHOUSE', 'Ghost Store Warehouse', 'IND-NONEXISTENT', 'COLD_ROOM',
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid
    );
  $$,
  'P0001',
  'Store IND-NONEXISTENT does not exist.',
  'Proposing warehouse with non-existent store_id is rejected'
);

-- 7.6 Proposing warehouse with invalid storage_type throws
SELECT throws_ok(
  $$
    SELECT public.propose_store_or_warehouse(
      'NEW_WAREHOUSE', 'Invalid Storage Room', 'IND-DEL-01', 'ATTIC',
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000005'::uuid
    );
  $$,
  'P0001',
  'Invalid storage_type: ATTIC. Must be COLD_ROOM, DRY_STORE, or FREEZER.',
  'Proposing warehouse with invalid storage_type is rejected'
);

-- 7.7 Proposing with identical custodian and backup throws
SELECT throws_ok(
  $$
    SELECT public.propose_store_or_warehouse(
      'NEW_STORE', 'Valid Store Name', NULL, NULL,
      'a0000000-0000-0000-0000-000000000004'::uuid,
      'a0000000-0000-0000-0000-000000000004'::uuid
    );
  $$,
  'P0001',
  'Nominated custodian and backup custodian must be distinct users.',
  'Proposing with identical custodian and backup is rejected by RPC'
);

-- ---------------------------------------------------------------------------
-- 8. SEGREGATION OF DUTIES (Proposer cannot approve own proposal)
-- ---------------------------------------------------------------------------
-- Create a proposal where requester is FC (e.g. system admin or FC acted as proposer)
INSERT INTO public.t_store_warehouse_approvals (
  approval_id, proposal_type, proposed_name, store_id, storage_type,
  nominated_custodian_id, nominated_backup_id, requested_by_user_id
) VALUES (
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'NEW_STORE', 'FC Self Proposed Store', NULL, NULL,
  'a0000000-0000-0000-0000-000000000004'::uuid,
  'a0000000-0000-0000-0000-000000000005'::uuid,
  'a0000000-0000-0000-0000-000000000003'::uuid -- requested by FC (user 0003)
);

-- Set active user context to that same FC
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'FC';

SELECT throws_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'APPROVED',
      'Attempting self-approval'
    );
  $$,
  'P0001',
  'Segregation of duties violation: Proposer cannot approve their own proposal.',
  'Proposer cannot approve their own proposal (segregation of duties strictly enforced)'
);

-- ---------------------------------------------------------------------------
-- 9. RPC: decide_store_warehouse_proposal
-- ---------------------------------------------------------------------------
-- 9.1 Unauthorized role (RM) cannot decide proposal
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'RM';

SELECT throws_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      current_setting('test.prop_wh_id', true)::uuid,
      'APPROVED',
      'RM unauthorized decision'
    );
  $$,
  'P0001',
  'Unauthorized: Only Financial Controller (FC/APPROVER) can decide proposals.',
  'RM cannot decide store/warehouse proposals'
);

-- 9.2 Unauthorized role (ADMIN) cannot decide proposal
SET LOCAL "app.current_role" = 'ADMIN';

SELECT throws_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      current_setting('test.prop_wh_id', true)::uuid,
      'APPROVED',
      'Admin unauthorized decision'
    );
  $$,
  'P0001',
  'Unauthorized: Only Financial Controller (FC/APPROVER) can decide proposals.',
  'ADMIN cannot decide store/warehouse proposals'
);

-- 9.3 Invalid decision input throws
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'FC';

SELECT throws_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      current_setting('test.prop_wh_id', true)::uuid,
      'MAYBE',
      'Invalid decision'
    );
  $$,
  'P0001',
  'Invalid decision: MAYBE. Must be APPROVED or REJECTED.',
  'Invalid decision string is rejected'
);

-- 9.4 FC can reject a proposal
-- Setup a rejectable proposal requested by RM
INSERT INTO public.t_store_warehouse_approvals (
  approval_id, proposal_type, proposed_name, store_id, storage_type,
  nominated_custodian_id, nominated_backup_id, requested_by_user_id
) VALUES (
  'b0000000-0000-0000-0000-000000000002'::uuid,
  'NEW_STORE', 'Rejected Store Spec', NULL, NULL,
  'a0000000-0000-0000-0000-000000000004'::uuid,
  'a0000000-0000-0000-0000-000000000005'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid
);

SELECT lives_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      'b0000000-0000-0000-0000-000000000002'::uuid,
      'REJECTED',
      'Location not viable'
    );
  $$,
  'FC successfully rejected proposal'
);

SELECT is(
  (SELECT fc_decision FROM public.t_store_warehouse_approvals WHERE approval_id = 'b0000000-0000-0000-0000-000000000002'::uuid),
  'REJECTED',
  'Proposal status updated to REJECTED with decider and comment recorded'
);

SELECT is(
  (SELECT count(*)::integer FROM public.m_stores WHERE store_name = 'Rejected Store Spec'),
  0,
  'Rejected proposal does not create store record in m_stores'
);

-- 9.5 Finalized proposal cannot be decided again
SELECT throws_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      'b0000000-0000-0000-0000-000000000002'::uuid,
      'APPROVED',
      'Attempting re-decision'
    );
  $$,
  'P0001',
  'Proposal b0000000-0000-0000-0000-000000000002 has already been decided with status REJECTED.',
  'Cannot decide an already finalized proposal'
);

-- 9.6 FC approves NEW_STORE proposal -> creates store in m_stores & initializes m_go_live_assignments
SELECT lives_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      current_setting('test.prop_store_id', true)::uuid,
      'APPROVED',
      'Store location approved by Financial Controller'
    );
  $$,
  'FC successfully approved NEW_STORE proposal'
);

SELECT is(
  (SELECT status FROM public.m_stores WHERE store_id = 'IND-BLR-01'),
  'ACTIVE',
  'Approved store instantiated in m_stores with status ACTIVE'
);

SELECT is(
  (SELECT cold_room_custodian_id FROM public.m_go_live_assignments WHERE store_id = 'IND-BLR-01'),
  'a0000000-0000-0000-0000-000000000004',
  'Approved store initializes m_go_live_assignments with nominated custodian'
);

-- 9.7 FC approves NEW_WAREHOUSE proposal -> creates warehouse in m_warehouses with matching storage_type & approval_id
SELECT lives_ok(
  $$
    SELECT public.decide_store_warehouse_proposal(
      current_setting('test.prop_wh_id', true)::uuid,
      'APPROVED',
      'Freezer expansion approved'
    );
  $$,
  'FC successfully approved NEW_WAREHOUSE proposal'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.m_warehouses
    WHERE store_id = 'IND-DEL-01'
      AND warehouse_name = 'Delhi Main Freezer Room'
      AND storage_type = 'FREEZER'::storage_type
      AND status = 'ACTIVE'::warehouse_status
  ),
  'Approved warehouse instantiated in m_warehouses with status ACTIVE and storage_type FREEZER'
);

SELECT is(
  (SELECT approval_id FROM public.m_warehouses WHERE warehouse_name = 'Delhi Main Freezer Room'),
  current_setting('test.prop_wh_id', true),
  'Approved warehouse links approval_id back to proposal'
);

-- ---------------------------------------------------------------------------
-- 10. UNIFIED VIEW: v_approval_inbox
-- ---------------------------------------------------------------------------
SELECT has_view('public', 'v_approval_inbox', 'View v_approval_inbox exists');

SELECT columns_are(
  'public',
  'v_approval_inbox',
  ARRAY[
    'item_type',
    'item_id',
    'store_id',
    'summary',
    'requested_by_user_id',
    'requested_at',
    'target_role',
    'status'
  ],
  'v_approval_inbox has exact expected columns'
);

-- Seed pending approval records across all 6 operational domains
DO $$
DECLARE
  v_grpo_id uuid := 'e0000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- a) Approver invitation pending second approval
  INSERT INTO public.m_user_invitations (
    invitation_id, email, role, store_id, activation_token, expires_at, status, invited_by_user_id
  ) VALUES (
    'inv-c0000000-0000-0000-0000-000000000001',
    'pending_approver@example.test',
    'APPROVER'::user_role,
    'IND-DEL-01',
    'token-d13-test-second-approval',
    now() + interval '2 days',
    'PENDING_SECOND_APPROVAL'::invitation_status,
    'a0000000-0000-0000-0000-000000000001'
  ) ON CONFLICT (activation_token) DO NOTHING;

  -- b) Stock count pending recount / adjustment
  INSERT INTO public.t_stock_counts (
    count_id, store_id, warehouse_id, count_type, freeze_status, keeper_user_id, accountant_user_id, status
  ) VALUES (
    'c0000000-0000-0000-0000-000000000002'::uuid,
    'IND-DEL-01',
    'WH-DEL01-COLD',
    'WEEKLY_CYCLE',
    'FROZEN',
    'a0000000-0000-0000-0000-000000000002'::uuid,
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'RECOUNT'
  ) ON CONFLICT (count_id) DO NOTHING;

  -- c) Transfer variance pending FC approval
  INSERT INTO public.t_transfer_intransit (
    transfer_id, source_store_id, target_store_id, item_code,
    dispatch_qty_kg, dispatch_qty_pcs, dispatcher_user_id,
    receive_qty_kg, receive_qty_pcs, receiver_user_id, variance_qty, status
  ) VALUES (
    'c0000000-0000-0000-0000-000000000003'::uuid,
    'IND-DEL-01', 'IND-DEL-02', 'RM-TST-01',
    10.000, 10.000, 'a0000000-0000-0000-0000-000000000002'::uuid,
    9.200, 10.000, 'a0000000-0000-0000-0000-000000000004'::uuid, -0.800,
    'VARIANCE_PENDING_FC'
  ) ON CONFLICT (transfer_id) DO NOTHING;

  -- d) Waste claims: minor (<= 5 kg) and major (> 5 kg)
  INSERT INTO public.t_waste_returns_log (
    log_id, store_id, item_code, quantity, uom, logged_by_user_id, approver_decision
  ) VALUES
    ('c0000000-0000-0000-0000-000000000004'::uuid, 'IND-DEL-01', 'RM-TST-01', 2.500, 'kg', 'a0000000-0000-0000-0000-000000000002'::uuid, 'PENDING'),
    ('c0000000-0000-0000-0000-000000000005'::uuid, 'IND-DEL-01', 'RM-TST-01', 12.000, 'kg', 'a0000000-0000-0000-0000-000000000002'::uuid, 'PENDING')
  ON CONFLICT (log_id) DO NOTHING;

  -- e) SAP import line item correction needing 2nd approval
  INSERT INTO public.t_grpo_imports (
    import_id, store_id, file_name, file_hash, uploaded_by_user_id
  ) VALUES (
    v_grpo_id, 'IND-DEL-01', 'grpo_d13_test.xlsx', 'hash-d13-001', 'a0000000-0000-0000-0000-000000000002'::uuid
  ) ON CONFLICT (file_hash) DO NOTHING;

  INSERT INTO public.t_grpo_import_items (
    import_item_id, import_id, store_id, item_code, counted_qty, status
  ) VALUES (
    'c0000000-0000-0000-0000-000000000006'::uuid,
    v_grpo_id, 'IND-DEL-01', 'RM-TST-01', 15.000, 'NEEDS_2ND_APPROVAL'
  ) ON CONFLICT (import_item_id) DO NOTHING;

  -- f) Pending store/warehouse proposal
  INSERT INTO public.t_store_warehouse_approvals (
    approval_id, proposal_type, proposed_name, store_id, storage_type,
    nominated_custodian_id, nominated_backup_id, requested_by_user_id, fc_decision
  ) VALUES (
    'c0000000-0000-0000-0000-000000000007'::uuid,
    'NEW_STORE', 'Pizza 4Ps Mumbai BKC', NULL, NULL,
    'a0000000-0000-0000-0000-000000000004'::uuid,
    'a0000000-0000-0000-0000-000000000005'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'PENDING'
  ) ON CONFLICT (approval_id) DO NOTHING;
END $$;

-- 10.1 Approver invitations in inbox
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'USER_INVITATION' AND target_role = 'FC'),
  1,
  'Pending second approval invitation routes to target_role FC in v_approval_inbox'
);

-- 10.2 Stock recount in inbox
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'STOCK_COUNT' AND target_role = 'FC'),
  1,
  'Stock recount adjustment routes to target_role FC in v_approval_inbox'
);

-- 10.3 Transfer variance in inbox
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'TRANSFER_VARIANCE' AND target_role = 'FC'),
  1,
  'Transfer variance routes to target_role FC in v_approval_inbox'
);

-- 10.4 Minor waste claim routes to RM
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'WASTE_CLAIM' AND target_role = 'RM'),
  1,
  'Minor waste claim (qty <= 5.000) routes to target_role RM in v_approval_inbox'
);

-- 10.5 Major waste claim routes to FC
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'WASTE_CLAIM' AND target_role = 'FC'),
  1,
  'Major waste claim (qty > 5.000) routes to target_role FC in v_approval_inbox'
);

-- 10.6 SAP import correction routes to SCM
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'SAP_IMPORT_CORRECTION' AND target_role = 'SCM'),
  1,
  'SAP import item correction routes to target_role SCM in v_approval_inbox'
);

-- 10.7 Store/warehouse proposal routes to FC
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_type = 'STORE_WAREHOUSE_PROPOSAL' AND target_role = 'FC'),
  1,
  'Store/warehouse proposal routes to target_role FC in v_approval_inbox'
);

-- 10.8 Finalized proposals do not appear in v_approval_inbox
SELECT is(
  (SELECT count(*)::integer FROM public.v_approval_inbox WHERE item_id IN (
    current_setting('test.prop_store_id', true)::uuid,
    current_setting('test.prop_wh_id', true)::uuid,
    'b0000000-0000-0000-0000-000000000002'::uuid
  )),
  0,
  'Decided proposals (APPROVED or REJECTED) do not appear in v_approval_inbox'
);

-- ---------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------------
-- 11.1 RM can only read proposals within their store scope or unassigned store proposals
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL "app.current_role" = 'RM';
SET LOCAL "app.current_store_id" = 'IND-DEL-01';

-- Create proposal for store IND-DEL-02 requested by someone else
INSERT INTO public.t_store_warehouse_approvals (
  approval_id, proposal_type, proposed_name, store_id, storage_type,
  nominated_custodian_id, nominated_backup_id, requested_by_user_id
) VALUES (
  'b0000000-0000-0000-0000-000000000050'::uuid,
  'NEW_WAREHOUSE', 'Store 2 Cold Room', 'IND-DEL-02', 'COLD_ROOM',
  'a0000000-0000-0000-0000-000000000004'::uuid,
  'a0000000-0000-0000-0000-000000000005'::uuid,
  'a0000000-0000-0000-0000-000000000002'::uuid
);

SELECT is(
  (SELECT count(*)::integer FROM public.t_store_warehouse_approvals WHERE approval_id = 'b0000000-0000-0000-0000-000000000050'::uuid),
  0,
  'RM in IND-DEL-01 cannot see proposals belonging to IND-DEL-02 (RLS store isolation)'
);

-- 11.2 FC has global view across all stores
SET LOCAL "app.current_user_id" = 'a0000000-0000-0000-0000-000000000003';
SET LOCAL "app.current_role" = 'FC';

SELECT is(
  (SELECT count(*)::integer FROM public.t_store_warehouse_approvals WHERE approval_id = 'b0000000-0000-0000-0000-000000000050'::uuid),
  1,
  'Financial Controller (FC) has global visibility across all stores in t_store_warehouse_approvals'
);

SELECT * FROM finish();
ROLLBACK;
