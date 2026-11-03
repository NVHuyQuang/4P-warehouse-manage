-- Migration 0130: Approvals Inbox and Store/Warehouse Workflow Domain
-- Pizza 4P's India Inventory Control Tool (Quantities Only)
-- Flow H: Propose & Approve Store / Warehouse
-- Global Inbox: Unified v_approval_inbox across all operational domains
-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- Append-only principle: never mutate or delete t_stock_movements.

-- 1. EXTENSIONS & STORAGE TYPE ENUM SUPPORT
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Ensure storage_type enum supports FREEZER if not already present
DO $$ BEGIN
  ALTER TYPE storage_type ADD VALUE IF NOT EXISTS 'FREEZER';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 2. PREREQUISITE CROSS-DOMAIN TABLES (IF NOT EXISTS FOR STANDALONE RUNNABILITY)
-- These tables belong to other domains (D9, D10, D11, D12) and are defined here with IF NOT EXISTS
-- so that the unified v_approval_inbox view compiles cleanly regardless of migration execution order.

-- D9: Flow F Stock Counts
CREATE TABLE IF NOT EXISTS public.t_stock_counts (
  count_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  count_type text NOT NULL DEFAULT 'WEEKLY_CYCLE',
  freeze_status text NOT NULL DEFAULT 'FROZEN',
  keeper_user_id uuid NULL REFERENCES auth.users(id),
  accountant_user_id uuid NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'IN_PROGRESS',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- D10: Flow G Inter-Store Transfers
CREATE TABLE IF NOT EXISTS public.t_transfer_intransit (
  transfer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  target_store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  dispatch_qty_kg numeric(12,3) NOT NULL DEFAULT 0,
  dispatch_qty_pcs numeric(12,3) NOT NULL DEFAULT 0,
  vehicle_seal_no text NULL,
  dispatcher_user_id uuid NOT NULL REFERENCES auth.users(id),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  receive_qty_kg numeric(12,3) NULL,
  receive_qty_pcs numeric(12,3) NULL,
  receiver_user_id uuid NULL REFERENCES auth.users(id),
  received_at timestamptz NULL,
  variance_qty numeric(12,3) NULL,
  fc_approval_id uuid NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'IN_TRANSIT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- D11: Flow G Waste & Supplier Return Authorization Audit
CREATE TABLE IF NOT EXISTS public.t_waste_returns_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  movement_id uuid NULL,
  movement_type text NOT NULL DEFAULT 'WASTE_DISPOSAL',
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL,
  uom text NOT NULL DEFAULT 'kg',
  po_number text NULL,
  grpo_doc_no text NULL,
  photo_url text NULL,
  reason_code text NOT NULL DEFAULT 'SPOILAGE',
  reason_text text NULL,
  logged_by_user_id uuid NOT NULL REFERENCES auth.users(id),
  approver_user_id uuid NULL REFERENCES auth.users(id),
  approver_decision text NOT NULL DEFAULT 'PENDING',
  approver_comment text NULL,
  driver_signature_blob text NULL,
  authorized_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- D12: Flow A-2 SAP GRPO File Imports Audit
CREATE TABLE IF NOT EXISTS public.t_grpo_imports (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  file_name text NOT NULL,
  file_hash text NOT NULL UNIQUE,
  detected_header_row integer DEFAULT 1,
  total_rows integer DEFAULT 0,
  imported_rows integer DEFAULT 0,
  error_count integer DEFAULT 0,
  uploaded_by_user_id uuid NULL REFERENCES auth.users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- D12: Flow A-2 SAP GRPO Parsed Line Items
CREATE TABLE IF NOT EXISTS public.t_grpo_import_items (
  import_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.t_grpo_imports(import_id) ON UPDATE CASCADE ON DELETE CASCADE,
  store_id text NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  po_number text NULL,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  counted_qty numeric(12,3) NOT NULL DEFAULT 0,
  batch_number text NULL,
  expiry_date date NULL,
  status text NOT NULL DEFAULT 'IMPORTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. DOMAIN TABLE: t_store_warehouse_approvals (Flow H)
CREATE TABLE IF NOT EXISTS public.t_store_warehouse_approvals (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_type text NOT NULL CHECK (proposal_type IN ('NEW_STORE', 'NEW_WAREHOUSE')),
  proposed_name text NOT NULL,
  store_id text NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  storage_type text NULL CHECK (storage_type IS NULL OR storage_type IN ('COLD_ROOM', 'DRY_STORE', 'FREEZER')),
  nominated_custodian_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  nominated_backup_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  fc_decision text NOT NULL CHECK (fc_decision IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
  fc_comment text NULL,
  requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at timestamptz NULL,
  CONSTRAINT chk_proposal_distinct_custodians CHECK (nominated_custodian_id != nominated_backup_id),
  CONSTRAINT chk_proposal_proposed_name_not_empty CHECK (length(trim(proposed_name)) > 0)
);

-- Indexes for performance and inbox lookups
CREATE INDEX IF NOT EXISTS idx_store_wh_approvals_decision ON public.t_store_warehouse_approvals(fc_decision);
CREATE INDEX IF NOT EXISTS idx_store_wh_approvals_store_id ON public.t_store_warehouse_approvals(store_id);
CREATE INDEX IF NOT EXISTS idx_store_wh_approvals_requested_by ON public.t_store_warehouse_approvals(requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_store_wh_approvals_requested_at ON public.t_store_warehouse_approvals(requested_at DESC);

-- 4. PROPOSAL AUDIT IMMUTABILITY TRIGGER
-- Once a proposal decision is finalized (APPROVED or REJECTED), it cannot be altered. Proposals cannot be deleted.
CREATE OR REPLACE FUNCTION public.tg_enforce_proposal_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Store and warehouse proposals are audit records and cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.fc_decision IN ('APPROVED', 'REJECTED') THEN
      RAISE EXCEPTION 'Cannot modify proposal % because it has already been finalized with decision %.', OLD.approval_id, OLD.fc_decision;
    END IF;

    -- Segregation of duties: Proposer cannot approve own proposal
    IF NEW.fc_decision IN ('APPROVED', 'REJECTED') AND NEW.decided_by_user_id IS NOT NULL THEN
      IF NEW.decided_by_user_id = OLD.requested_by_user_id THEN
        RAISE EXCEPTION 'Segregation of duties violation: Proposer cannot approve their own proposal.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_proposal_lifecycle ON public.t_store_warehouse_approvals;
CREATE TRIGGER trg_enforce_proposal_lifecycle
  BEFORE UPDATE OR DELETE ON public.t_store_warehouse_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_proposal_lifecycle();

-- 5. UNIFIED VIEW: v_approval_inbox (Flow H & Global Inbox)
-- Unifies pending approvals across:
--   a) Approver invitations: m_user_invitations WHERE status = 'PENDING_SECOND_APPROVAL' (target_role: 'FC')
--   b) Stock counts pending recount / adjustment: t_stock_counts WHERE status = 'RECOUNT' (target_role: 'FC')
--   c) Transfer variances: t_transfer_intransit WHERE status = 'VARIANCE_PENDING_FC' (target_role: 'FC')
--   d) Waste claims: t_waste_returns_log WHERE approver_decision = 'PENDING' (target_role: case when quantity <= 5.000 then 'RM' else 'FC' end)
--   e) SAP import corrections: t_grpo_import_items WHERE status = 'NEEDS_2ND_APPROVAL' (target_role: 'SCM')
--   f) Store/warehouse proposals: t_store_warehouse_approvals WHERE fc_decision = 'PENDING' (target_role: 'FC')
CREATE OR REPLACE VIEW public.v_approval_inbox AS
-- a) Approver invitations pending second approval
SELECT
  'USER_INVITATION'::text AS item_type,
  CASE
    WHEN inv.invitation_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN inv.invitation_id::uuid
    WHEN substring(inv.invitation_id from 5) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN substring(inv.invitation_id from 5)::uuid
    ELSE extensions.uuid_generate_v5(extensions.uuid_ns_url(), inv.invitation_id)
  END AS item_id,
  inv.store_id::text AS store_id,
  ('Approver invitation second approval for ' || inv.email)::text AS summary,
  CASE
    WHEN inv.invited_by_user_id IS NULL THEN NULL
    WHEN inv.invited_by_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN inv.invited_by_user_id::uuid
    ELSE extensions.uuid_generate_v5(extensions.uuid_ns_url(), inv.invited_by_user_id)
  END AS requested_by_user_id,
  inv.created_at AS requested_at,
  'FC'::text AS target_role,
  inv.status::text AS status
FROM public.m_user_invitations inv
WHERE inv.status::text = 'PENDING_SECOND_APPROVAL'

UNION ALL

-- b) Stock counts pending recount / adjustment
SELECT
  'STOCK_COUNT'::text AS item_type,
  sc.count_id AS item_id,
  sc.store_id::text AS store_id,
  ('Stock count recount pending FC adjustment approval for warehouse ' || sc.warehouse_id)::text AS summary,
  coalesce(sc.accountant_user_id, sc.keeper_user_id) AS requested_by_user_id,
  sc.created_at AS requested_at,
  'FC'::text AS target_role,
  sc.status::text AS status
FROM public.t_stock_counts sc
WHERE sc.status::text = 'RECOUNT'

UNION ALL

-- c) Transfer variances
SELECT
  'TRANSFER_VARIANCE'::text AS item_type,
  trf.transfer_id AS item_id,
  coalesce(trf.target_store_id, trf.source_store_id)::text AS store_id,
  ('Inter-store transfer variance pending FC approval: item ' || coalesce(trf.item_code, 'N/A') || ' (variance ' || coalesce(trf.variance_qty::text, '0') || ')')::text AS summary,
  coalesce(trf.receiver_user_id, trf.dispatcher_user_id) AS requested_by_user_id,
  coalesce(trf.received_at, trf.dispatched_at, trf.created_at) AS requested_at,
  'FC'::text AS target_role,
  trf.status::text AS status
FROM public.t_transfer_intransit trf
WHERE trf.status::text = 'VARIANCE_PENDING_FC'

UNION ALL

-- d) Waste claims
SELECT
  'WASTE_CLAIM'::text AS item_type,
  wst.log_id AS item_id,
  wst.store_id::text AS store_id,
  ('Waste & return claim for item ' || wst.item_code || ' (qty ' || wst.quantity::text || ' ' || coalesce(wst.uom, 'kg') || ')')::text AS summary,
  wst.logged_by_user_id AS requested_by_user_id,
  wst.created_at AS requested_at,
  (CASE WHEN wst.quantity <= 5.000 THEN 'RM' ELSE 'FC' END)::text AS target_role,
  wst.approver_decision::text AS status
FROM public.t_waste_returns_log wst
WHERE wst.approver_decision::text = 'PENDING'

UNION ALL

-- e) SAP import corrections
SELECT
  'SAP_IMPORT_CORRECTION'::text AS item_type,
  gii.import_item_id AS item_id,
  coalesce(gii.store_id, gi.store_id)::text AS store_id,
  ('SAP GRPO import line correction requiring 2nd approval for item ' || gii.item_code || ' (qty ' || coalesce(gii.counted_qty::text, '0') || ')')::text AS summary,
  gi.uploaded_by_user_id AS requested_by_user_id,
  coalesce(gii.created_at, gi.imported_at, now()) AS requested_at,
  'SCM'::text AS target_role,
  gii.status::text AS status
FROM public.t_grpo_import_items gii
LEFT JOIN public.t_grpo_imports gi ON gi.import_id = gii.import_id
WHERE gii.status::text = 'NEEDS_2ND_APPROVAL'

UNION ALL

-- f) Store/warehouse proposals
SELECT
  'STORE_WAREHOUSE_PROPOSAL'::text AS item_type,
  prop.approval_id AS item_id,
  prop.store_id::text AS store_id,
  ('Store/warehouse proposal: ' || prop.proposal_type || ' - ' || prop.proposed_name)::text AS summary,
  prop.requested_by_user_id AS requested_by_user_id,
  prop.requested_at AS requested_at,
  'FC'::text AS target_role,
  prop.fc_decision::text AS status
FROM public.t_store_warehouse_approvals prop
WHERE prop.fc_decision::text = 'PENDING';

-- 6. SECURITY DEFINER RPCs

-- 6.1 propose_store_or_warehouse
CREATE OR REPLACE FUNCTION public.propose_store_or_warehouse(
  p_proposal_type text,
  p_proposed_name text,
  p_store_id text DEFAULT NULL,
  p_storage_type text DEFAULT NULL,
  p_nominated_custodian_id uuid DEFAULT NULL,
  p_nominated_backup_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_approval_id uuid;
BEGIN
  -- 1. Authorization: RM, Admin (Keeper), or System Admin
  IF NOT (
    has_role('RM') OR
    has_role('ADMIN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only RM or Admin can propose new stores or warehouses.';
  END IF;

  -- 2. Resolve caller user ID
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );

  BEGIN
    IF v_raw_id IS NOT NULL THEN
      IF v_raw_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_caller_id := v_raw_id::uuid;
      ELSE
        SELECT id INTO v_caller_id FROM auth.users WHERE id::text = v_raw_id OR email = v_raw_id LIMIT 1;
        IF v_caller_id IS NULL THEN
          v_caller_id := extensions.uuid_generate_v5(extensions.uuid_ns_url(), v_raw_id);
        END IF;
      END IF;
    ELSE
      v_caller_id := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := auth.uid();
  END;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 3. Proposal type validation
  IF p_proposal_type NOT IN ('NEW_STORE', 'NEW_WAREHOUSE') THEN
    RAISE EXCEPTION 'Invalid proposal_type: %. Must be NEW_STORE or NEW_WAREHOUSE.', p_proposal_type;
  END IF;

  -- 4. Proposed name validation
  IF p_proposed_name IS NULL OR length(trim(p_proposed_name)) = 0 THEN
    RAISE EXCEPTION 'Proposed name cannot be empty.';
  END IF;

  -- 5. Custodian validations
  IF p_nominated_custodian_id IS NULL THEN
    RAISE EXCEPTION 'Nominated custodian ID is required.';
  END IF;

  IF p_nominated_backup_id IS NULL THEN
    RAISE EXCEPTION 'Nominated backup custodian ID is required.';
  END IF;

  IF p_nominated_custodian_id = p_nominated_backup_id THEN
    RAISE EXCEPTION 'Nominated custodian and backup custodian must be distinct users.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_nominated_custodian_id) THEN
    RAISE EXCEPTION 'Nominated custodian % does not exist in auth.users.', p_nominated_custodian_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_nominated_backup_id) THEN
    RAISE EXCEPTION 'Nominated backup custodian % does not exist in auth.users.', p_nominated_backup_id;
  END IF;

  -- 6. Proposal type specific validations
  IF p_proposal_type = 'NEW_WAREHOUSE' THEN
    IF p_store_id IS NULL OR length(trim(p_store_id)) = 0 THEN
      RAISE EXCEPTION 'Store ID is required when proposing a new warehouse.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = p_store_id) THEN
      RAISE EXCEPTION 'Store % does not exist.', p_store_id;
    END IF;

    IF p_storage_type IS NULL OR p_storage_type NOT IN ('COLD_ROOM', 'DRY_STORE', 'FREEZER') THEN
      RAISE EXCEPTION 'Invalid storage_type: %. Must be COLD_ROOM, DRY_STORE, or FREEZER.', p_storage_type;
    END IF;

    -- Store scope enforcement for non-system admins
    IF current_store_id() IS NOT NULL AND current_store_id() != p_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
      RAISE EXCEPTION 'Store scope mismatch: cannot propose warehouse for store % while scoped to %.', p_store_id, current_store_id();
    END IF;
  ELSE
    -- NEW_STORE
    IF p_storage_type IS NOT NULL AND p_storage_type NOT IN ('COLD_ROOM', 'DRY_STORE', 'FREEZER') THEN
      RAISE EXCEPTION 'Invalid storage_type: %. Must be COLD_ROOM, DRY_STORE, or FREEZER.', p_storage_type;
    END IF;

    IF p_store_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = p_store_id) THEN
      RAISE EXCEPTION 'Store % already exists.', p_store_id;
    END IF;
  END IF;

  -- 7. Insert proposal
  INSERT INTO public.t_store_warehouse_approvals (
    approval_id,
    proposal_type,
    proposed_name,
    store_id,
    storage_type,
    nominated_custodian_id,
    nominated_backup_id,
    fc_decision,
    fc_comment,
    requested_by_user_id,
    requested_at,
    decided_by_user_id,
    decided_at
  ) VALUES (
    gen_random_uuid(),
    p_proposal_type,
    trim(p_proposed_name),
    nullif(trim(p_store_id), ''),
    p_storage_type,
    p_nominated_custodian_id,
    p_nominated_backup_id,
    'PENDING',
    NULL,
    v_caller_id,
    now(),
    NULL,
    NULL
  )
  RETURNING approval_id INTO v_approval_id;

  RETURN v_approval_id;
END;
$$;

-- 6.2 decide_store_warehouse_proposal
CREATE OR REPLACE FUNCTION public.decide_store_warehouse_proposal(
  p_approval_id uuid,
  p_decision text,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_proposal record;
  v_new_store_id text;
  v_new_warehouse_id text;
  v_city text;
  v_storage_type storage_type;
BEGIN
  -- 1. Authorization: Only Financial Controller (FC / APPROVER) or SYSTEM_ADMIN
  IF NOT (
    has_role('FC') OR
    has_role('APPROVER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Financial Controller (FC/APPROVER) can decide proposals.';
  END IF;

  -- 2. Resolve caller user ID
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );

  BEGIN
    IF v_raw_id IS NOT NULL THEN
      IF v_raw_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_caller_id := v_raw_id::uuid;
      ELSE
        SELECT id INTO v_caller_id FROM auth.users WHERE id::text = v_raw_id OR email = v_raw_id LIMIT 1;
        IF v_caller_id IS NULL THEN
          v_caller_id := extensions.uuid_generate_v5(extensions.uuid_ns_url(), v_raw_id);
        END IF;
      END IF;
    ELSE
      v_caller_id := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := auth.uid();
  END;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 3. Validate decision input
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid decision: %. Must be APPROVED or REJECTED.', p_decision;
  END IF;

  -- 4. Fetch and validate existing proposal
  SELECT * INTO v_proposal
  FROM public.t_store_warehouse_approvals
  WHERE approval_id = p_approval_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal with approval_id % not found.', p_approval_id;
  END IF;

  IF v_proposal.fc_decision != 'PENDING' THEN
    RAISE EXCEPTION 'Proposal % has already been decided with status %.', p_approval_id, v_proposal.fc_decision;
  END IF;

  -- 5. Segregation of duties: Proposer cannot approve own proposal
  IF v_proposal.requested_by_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Proposer cannot approve their own proposal.';
  END IF;

  -- 6. Apply decision to proposal record
  UPDATE public.t_store_warehouse_approvals
  SET fc_decision = p_decision,
      fc_comment = trim(p_comment),
      decided_by_user_id = v_caller_id,
      decided_at = now()
  WHERE approval_id = p_approval_id;

  -- 7. If APPROVED, instantiate store or warehouse master records
  IF p_decision = 'APPROVED' THEN
    IF v_proposal.proposal_type = 'NEW_STORE' THEN
      v_new_store_id := coalesce(
        v_proposal.store_id,
        CASE
          WHEN v_proposal.proposed_name ~ '^IND-[A-Za-z0-9_-]+$' THEN v_proposal.proposed_name
          ELSE 'IND-' || upper(regexp_replace(v_proposal.proposed_name, '[^a-zA-Z0-9]+', '-', 'g'))
        END
      );

      v_city := CASE
        WHEN v_proposal.proposed_name ILIKE '%Delhi%' THEN 'Delhi'
        WHEN v_proposal.proposed_name ILIKE '%Bengaluru%' OR v_proposal.proposed_name ILIKE '%Bangalore%' THEN 'Bengaluru'
        WHEN v_proposal.proposed_name ILIKE '%Mumbai%' THEN 'Mumbai'
        WHEN v_new_store_id LIKE 'IND-DEL%' THEN 'Delhi'
        WHEN v_new_store_id LIKE 'IND-BLR%' THEN 'Bengaluru'
        WHEN v_new_store_id LIKE 'IND-BOM%' THEN 'Mumbai'
        ELSE 'India'
      END;

      -- Insert into m_stores
      INSERT INTO public.m_stores (
        store_id,
        store_name,
        city,
        status,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        v_new_store_id,
        v_proposal.proposed_name,
        v_city,
        'ACTIVE',
        true,
        now(),
        now()
      )
      ON CONFLICT (store_id) DO UPDATE
        SET store_name = EXCLUDED.store_name,
            status = 'ACTIVE',
            is_active = true,
            updated_at = now();

      -- Initialize m_go_live_assignments with nominated custodians
      INSERT INTO public.m_go_live_assignments (
        store_id,
        cold_room_custodian_id,
        cold_room_backup_id,
        created_at,
        updated_at
      ) VALUES (
        v_new_store_id,
        v_proposal.nominated_custodian_id::text,
        v_proposal.nominated_backup_id::text,
        now(),
        now()
      )
      ON CONFLICT (store_id) DO UPDATE
        SET cold_room_custodian_id = coalesce(public.m_go_live_assignments.cold_room_custodian_id, EXCLUDED.cold_room_custodian_id),
            cold_room_backup_id = coalesce(public.m_go_live_assignments.cold_room_backup_id, EXCLUDED.cold_room_backup_id),
            updated_at = now();

      -- Link generated store_id back to proposal if store_id was initially null
      IF v_proposal.store_id IS NULL THEN
        UPDATE public.t_store_warehouse_approvals
        SET store_id = v_new_store_id
        WHERE approval_id = p_approval_id;
      END IF;

    ELSIF v_proposal.proposal_type = 'NEW_WAREHOUSE' THEN
      v_storage_type := coalesce(v_proposal.storage_type, 'COLD_ROOM')::storage_type;

      v_new_warehouse_id := CASE
        WHEN v_proposal.proposed_name ~ '^WH-[A-Za-z0-9_-]+$' THEN v_proposal.proposed_name
        ELSE 'WH-' || replace(v_proposal.store_id, 'IND-', '') || '-' ||
             CASE
               WHEN v_proposal.storage_type = 'DRY_STORE' THEN 'DRY'
               WHEN v_proposal.storage_type = 'FREEZER' THEN 'FREEZ'
               ELSE 'COLD'
             END || '-' || substring(replace(v_proposal.approval_id::text, '-', '') from 1 for 4)
      END;

      IF EXISTS (SELECT 1 FROM public.m_warehouses WHERE warehouse_id = v_new_warehouse_id) THEN
        v_new_warehouse_id := v_new_warehouse_id || '-' || substring(replace(v_proposal.approval_id::text, '-', '') from 5 for 4);
      END IF;

      -- Insert into m_warehouses
      INSERT INTO public.m_warehouses (
        warehouse_id,
        store_id,
        warehouse_name,
        floor_level,
        storage_type,
        status,
        is_active,
        approval_id,
        created_at,
        updated_at
      ) VALUES (
        v_new_warehouse_id,
        v_proposal.store_id,
        v_proposal.proposed_name,
        'GROUND',
        v_storage_type,
        'ACTIVE'::warehouse_status,
        true,
        p_approval_id::text,
        now(),
        now()
      )
      ON CONFLICT (warehouse_id) DO UPDATE
        SET warehouse_name = EXCLUDED.warehouse_name,
            storage_type = EXCLUDED.storage_type,
            status = 'ACTIVE'::warehouse_status,
            is_active = true,
            approval_id = EXCLUDED.approval_id,
            updated_at = now();
    END IF;
  END IF;
END;
$$;

-- 7. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.t_store_warehouse_approvals ENABLE ROW LEVEL SECURITY;

-- 7.1 SELECT Policy
-- SYSTEM_ADMIN, FC / APPROVER, and VIEWER can see all proposals.
-- RM and ADMIN can see proposals within their active store scope or proposals they personally created.
DROP POLICY IF EXISTS t_store_warehouse_approvals_select ON public.t_store_warehouse_approvals;
CREATE POLICY t_store_warehouse_approvals_select
  ON public.t_store_warehouse_approvals
  FOR SELECT
  TO authenticated
  USING (
    has_role('SYSTEM_ADMIN')
    OR has_role('APPROVER')
    OR has_role('FC')
    OR has_role('VIEWER')
    OR (
      (has_role('RM') OR has_role('ADMIN'))
      AND (
        current_store_id() IS NULL
        OR store_id = current_store_id()
        OR store_id IS NULL
        OR requested_by_user_id = auth.uid()
      )
    )
  );

-- 7.2 INSERT Policy
-- RM, ADMIN, and SYSTEM_ADMIN can insert proposals within store scope
DROP POLICY IF EXISTS t_store_warehouse_approvals_insert ON public.t_store_warehouse_approvals;
CREATE POLICY t_store_warehouse_approvals_insert
  ON public.t_store_warehouse_approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('RM') OR has_role('ADMIN') OR has_role('SYSTEM_ADMIN'))
    AND (
      current_store_id() IS NULL
      OR store_id IS NULL
      OR store_id = current_store_id()
      OR has_role('SYSTEM_ADMIN')
    )
  );

-- 7.3 UPDATE Policy
-- FC, APPROVER, and SYSTEM_ADMIN can update decision, enforcing segregation of duties
DROP POLICY IF EXISTS t_store_warehouse_approvals_update ON public.t_store_warehouse_approvals;
CREATE POLICY t_store_warehouse_approvals_update
  ON public.t_store_warehouse_approvals
  FOR UPDATE
  TO authenticated
  USING (
    (has_role('FC') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
    AND (requested_by_user_id != auth.uid() OR has_role('SYSTEM_ADMIN'))
  )
  WITH CHECK (
    (has_role('FC') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
    AND (requested_by_user_id != auth.uid() OR has_role('SYSTEM_ADMIN'))
  );

-- 7.4 DELETE Policy
-- Deletes are strictly disallowed
DROP POLICY IF EXISTS t_store_warehouse_approvals_delete ON public.t_store_warehouse_approvals;
CREATE POLICY t_store_warehouse_approvals_delete
  ON public.t_store_warehouse_approvals
  FOR DELETE
  TO authenticated
  USING (false);

-- 8. REVOKE & GRANTS
REVOKE DELETE ON public.t_store_warehouse_approvals FROM PUBLIC, authenticated, anon;

GRANT SELECT, INSERT, UPDATE ON public.t_store_warehouse_approvals TO authenticated;
GRANT SELECT ON public.t_store_warehouse_approvals TO anon;

GRANT SELECT ON public.v_approval_inbox TO authenticated, anon;

GRANT EXECUTE ON FUNCTION public.propose_store_or_warehouse(text, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_store_warehouse_proposal(uuid, text, text) TO authenticated;
