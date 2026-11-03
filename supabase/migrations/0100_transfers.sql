-- Migration 0100: Store Transfers Domain (D10)
-- Pizza 4P's India Inventory Control Tool (Quantities Only)
-- Flow G: Inter-Store Transfers, In-Transit Tracking & FC Variance Approval
-- Invariants: Physical quantities and unit counts only. Strictly non-commercial inventory movements.

-- 1. INTER-STORE TRANSFERS TABLE (t_transfer_intransit)
CREATE TABLE IF NOT EXISTS public.t_transfer_intransit (
  transfer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  target_store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  target_warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  dispatch_qty_kg numeric(12,3) NOT NULL CHECK (dispatch_qty_kg > 0),
  dispatch_qty_pcs numeric(12,3) NULL CHECK (dispatch_qty_pcs IS NULL OR dispatch_qty_pcs > 0),
  vehicle_seal_no text NOT NULL CHECK (length(trim(vehicle_seal_no)) > 0),
  dispatcher_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  receive_qty_kg numeric(12,3) NULL CHECK (receive_qty_kg IS NULL OR receive_qty_kg >= 0),
  receive_qty_pcs numeric(12,3) NULL CHECK (receive_qty_pcs IS NULL OR receive_qty_pcs >= 0),
  receiver_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_at timestamptz NULL,
  variance_qty numeric(12,3) NULL,
  fc_approval_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('IN_TRANSIT', 'RECEIVED_MATCH', 'VARIANCE_PENDING_FC', 'RECEIVED_VARIANCE_APPROVED', 'REJECTED')) DEFAULT 'IN_TRANSIT',
  out_movement_id uuid NULL REFERENCES public.t_stock_movements(movement_id) ON UPDATE CASCADE ON DELETE SET NULL,
  in_movement_id uuid NULL REFERENCES public.t_stock_movements(movement_id) ON UPDATE CASCADE ON DELETE SET NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_different_stores CHECK (source_store_id != target_store_id),
  CONSTRAINT chk_transfer_distinct_users CHECK (receiver_user_id IS NULL OR dispatcher_user_id != receiver_user_id),
  CONSTRAINT chk_transfer_distinct_fc CHECK (fc_approval_id IS NULL OR dispatcher_user_id != fc_approval_id)
);

-- 2. INDEXES FOR PERFORMANCE & AUDITING
CREATE INDEX IF NOT EXISTS idx_transfers_source_store_wh ON public.t_transfer_intransit (source_store_id, source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_target_store_wh ON public.t_transfer_intransit (target_store_id, target_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfers_item ON public.t_transfer_intransit (item_code);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON public.t_transfer_intransit (status);
CREATE INDEX IF NOT EXISTS idx_transfers_dispatcher ON public.t_transfer_intransit (dispatcher_user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_receiver ON public.t_transfer_intransit (receiver_user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_fc_approval ON public.t_transfer_intransit (fc_approval_id);
CREATE INDEX IF NOT EXISTS idx_transfers_dispatched_at ON public.t_transfer_intransit (dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_out_movement ON public.t_transfer_intransit (out_movement_id);
CREATE INDEX IF NOT EXISTS idx_transfers_in_movement ON public.t_transfer_intransit (in_movement_id);

-- 3. TRIGGERS
-- 3.1 Prevent deletion of transfer records
CREATE OR REPLACE FUNCTION public.tg_prevent_transfer_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Transfer records cannot be deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_transfers_delete ON public.t_transfer_intransit;
CREATE TRIGGER trg_prevent_transfers_delete
  BEFORE DELETE ON public.t_transfer_intransit
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_transfer_deletion();

-- 3.2 Automatic updated_at synchronization
DROP TRIGGER IF EXISTS trg_transfers_updated_at ON public.t_transfer_intransit;
CREATE TRIGGER trg_transfers_updated_at
  BEFORE UPDATE ON public.t_transfer_intransit
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. STORED PROCEDURES (SECURITY DEFINER RPCS)

-- 4.1 dispatch_store_transfer
CREATE OR REPLACE FUNCTION public.dispatch_store_transfer(
  p_source_store_id text,
  p_source_warehouse_id text,
  p_target_store_id text,
  p_target_warehouse_id text,
  p_item_code text,
  p_qty_kg numeric,
  p_qty_pcs numeric DEFAULT NULL,
  p_seal_no text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_transfer_id uuid;
  v_out_movement_id uuid;
  v_user_ref text;
  v_category_group text;
  v_base_uom text;
  v_is_active boolean;
  v_dual_unit_required boolean;
BEGIN
  -- 1. Authorization: Only Keeper (ADMIN), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('RM') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper, RM, or System Admin can dispatch store transfers.';
  END IF;

  -- 2. Store Scope Verification (Source Store)
  IF current_store_id() IS NOT NULL AND current_store_id() != p_source_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested source store is %.', current_store_id(), p_source_store_id;
  END IF;

  -- 3. Caller Resolution
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_id := v_raw_id::uuid;
    ELSE
      v_caller_id := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := auth.uid();
  END;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 4. Validation: Different Stores
  IF p_source_store_id = p_target_store_id THEN
    RAISE EXCEPTION 'Transfer source store (%) cannot be the same as target store (%).', p_source_store_id, p_target_store_id;
  END IF;

  -- 5. Validation: Stores & Warehouses Existence
  IF NOT EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = p_source_store_id) THEN
    RAISE EXCEPTION 'Source store % does not exist.', p_source_store_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.m_stores WHERE store_id = p_target_store_id) THEN
    RAISE EXCEPTION 'Target store % does not exist.', p_target_store_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.m_warehouses WHERE warehouse_id = p_source_warehouse_id AND store_id = p_source_store_id) THEN
    RAISE EXCEPTION 'Source warehouse % does not belong to store % or does not exist.', p_source_warehouse_id, p_source_store_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.m_warehouses WHERE warehouse_id = p_target_warehouse_id AND store_id = p_target_store_id) THEN
    RAISE EXCEPTION 'Target warehouse % does not belong to store % or does not exist.', p_target_warehouse_id, p_target_store_id;
  END IF;

  -- 6. Validation: Item Existence & Active Status
  SELECT category_group, base_uom, is_active
  INTO v_category_group, v_base_uom, v_is_active
  FROM public.m_items
  WHERE item_code = p_item_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % does not exist.', p_item_code;
  END IF;

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'Item % is inactive.', p_item_code;
  END IF;

  -- 7. Validation: Quantities & Seal Number
  IF p_qty_kg IS NULL OR p_qty_kg <= 0 THEN
    RAISE EXCEPTION 'Dispatch quantity (kg) must be greater than zero.';
  END IF;

  IF p_seal_no IS NULL OR trim(p_seal_no) = '' THEN
    RAISE EXCEPTION 'Vehicle seal number is mandatory for inter-store transfer.';
  END IF;

  -- 8. Validation: Dual-Unit Rule (Cheese and Meat require both kg and pcs)
  v_dual_unit_required := (
    v_category_group IN ('CHEESE', 'MEAT')
    OR EXISTS (
      SELECT 1 FROM public.m_uom_conversions
      WHERE item_code = p_item_code AND dual_uom_required = true
    )
  );

  IF v_dual_unit_required THEN
    IF p_qty_pcs IS NULL OR p_qty_pcs <= 0 THEN
      RAISE EXCEPTION 'Dual-unit required: Cheese and meat items require both dispatch_qty_kg and dispatch_qty_pcs.';
    END IF;
  ELSIF p_qty_pcs IS NOT NULL AND p_qty_pcs <= 0 THEN
    RAISE EXCEPTION 'Dispatch quantity (pcs) must be greater than zero when provided.';
  END IF;

  -- 9. Resolve user reference for t_stock_movements (created_by_user_id FK)
  SELECT user_id INTO v_user_ref FROM public.m_users WHERE user_id = v_caller_id::text;
  IF v_user_ref IS NULL THEN
    SELECT u.user_id INTO v_user_ref
    FROM public.m_users u
    JOIN auth.users au ON au.email = u.email
    WHERE au.id = v_caller_id
    LIMIT 1;
  END IF;
  IF v_user_ref IS NULL THEN
    v_user_ref := v_caller_id::text;
  END IF;

  v_transfer_id := gen_random_uuid();

  -- 10. Append TRANSFER_OUT_INTRANSIT (-dispatch_qty_kg) to t_stock_movements
  INSERT INTO public.t_stock_movements (
    movement_id,
    store_id,
    warehouse_id,
    item_code,
    movement_type,
    quantity,
    uom,
    reference_doc_id,
    created_by_user_id,
    created_at
  ) VALUES (
    gen_random_uuid(),
    p_source_store_id,
    p_source_warehouse_id,
    p_item_code,
    'TRANSFER_OUT_INTRANSIT',
    -p_qty_kg,
    'kg',
    v_transfer_id::text,
    v_user_ref,
    now()
  )
  RETURNING movement_id INTO v_out_movement_id;

  -- 11. Insert record into t_transfer_intransit
  INSERT INTO public.t_transfer_intransit (
    transfer_id,
    source_store_id,
    source_warehouse_id,
    target_store_id,
    target_warehouse_id,
    item_code,
    dispatch_qty_kg,
    dispatch_qty_pcs,
    vehicle_seal_no,
    dispatcher_user_id,
    dispatched_at,
    status,
    out_movement_id,
    created_at,
    updated_at
  ) VALUES (
    v_transfer_id,
    p_source_store_id,
    p_source_warehouse_id,
    p_target_store_id,
    p_target_warehouse_id,
    p_item_code,
    p_qty_kg,
    p_qty_pcs,
    trim(p_seal_no),
    v_caller_id,
    now(),
    'IN_TRANSIT',
    v_out_movement_id,
    now(),
    now()
  );

  RETURN v_transfer_id;
END;
$$;

-- 4.2 receive_store_transfer
CREATE OR REPLACE FUNCTION public.receive_store_transfer(
  p_transfer_id uuid,
  p_receive_qty_kg numeric,
  p_receive_qty_pcs numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_transfer record;
  v_in_movement_id uuid;
  v_user_ref text;
  v_variance_qty numeric(12,3);
  v_is_match boolean;
BEGIN
  -- 1. Authorization: Only Keeper (ADMIN), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('RM') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper, RM, or System Admin can receive store transfers.';
  END IF;

  -- 2. Caller Resolution
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_id := v_raw_id::uuid;
    ELSE
      v_caller_id := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := auth.uid();
  END;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 3. Fetch & Lock Transfer Record
  SELECT * INTO v_transfer
  FROM public.t_transfer_intransit
  WHERE transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found.', p_transfer_id;
  END IF;

  -- 4. Status Validation
  IF v_transfer.status != 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'Transfer % is not in IN_TRANSIT status (current status: %).', p_transfer_id, v_transfer.status;
  END IF;

  -- 5. Segregation of Duties: Dispatcher cannot receive their own transfer
  IF v_caller_id = v_transfer.dispatcher_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Transfer dispatcher cannot receive their own transfer.';
  END IF;

  -- 6. Store Scope Verification (Target Store)
  IF current_store_id() IS NOT NULL AND current_store_id() != v_transfer.target_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, target store is %.', current_store_id(), v_transfer.target_store_id;
  END IF;

  -- 7. Validation: Quantities
  IF p_receive_qty_kg IS NULL OR p_receive_qty_kg < 0 THEN
    RAISE EXCEPTION 'Receive quantity (kg) must be non-negative.';
  END IF;

  IF v_transfer.dispatch_qty_pcs IS NOT NULL THEN
    IF p_receive_qty_pcs IS NULL OR p_receive_qty_pcs < 0 THEN
      RAISE EXCEPTION 'Dual-unit required: Piece quantity must be recorded and non-negative for this transfer.';
    END IF;
  ELSIF p_receive_qty_pcs IS NOT NULL AND p_receive_qty_pcs < 0 THEN
    RAISE EXCEPTION 'Receive quantity (pcs) must be non-negative.';
  END IF;

  -- 8. Resolve user reference for t_stock_movements (created_by_user_id FK)
  SELECT user_id INTO v_user_ref FROM public.m_users WHERE user_id = v_caller_id::text;
  IF v_user_ref IS NULL THEN
    SELECT u.user_id INTO v_user_ref
    FROM public.m_users u
    JOIN auth.users au ON au.email = u.email
    WHERE au.id = v_caller_id
    LIMIT 1;
  END IF;
  IF v_user_ref IS NULL THEN
    v_user_ref := v_caller_id::text;
  END IF;

  -- 9. Check Perfect Match vs Variance
  v_variance_qty := p_receive_qty_kg - v_transfer.dispatch_qty_kg;
  v_is_match := (p_receive_qty_kg = v_transfer.dispatch_qty_kg)
    AND (v_transfer.dispatch_qty_pcs IS NULL OR p_receive_qty_pcs = v_transfer.dispatch_qty_pcs);

  IF v_is_match THEN
    -- Perfect match: Append TRANSFER_IN_RECEIVED (+p_receive_qty_kg) at target warehouse
    INSERT INTO public.t_stock_movements (
      movement_id,
      store_id,
      warehouse_id,
      item_code,
      movement_type,
      quantity,
      uom,
      reference_doc_id,
      created_by_user_id,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_transfer.target_store_id,
      v_transfer.target_warehouse_id,
      v_transfer.item_code,
      'TRANSFER_IN_RECEIVED',
      p_receive_qty_kg,
      'kg',
      p_transfer_id::text,
      v_user_ref,
      now()
    )
    RETURNING movement_id INTO v_in_movement_id;

    -- Update transfer status to RECEIVED_MATCH
    UPDATE public.t_transfer_intransit
    SET receive_qty_kg = p_receive_qty_kg,
        receive_qty_pcs = p_receive_qty_pcs,
        receiver_user_id = v_caller_id,
        received_at = now(),
        variance_qty = 0,
        status = 'RECEIVED_MATCH',
        in_movement_id = v_in_movement_id,
        updated_at = now()
    WHERE transfer_id = p_transfer_id;
  ELSE
    -- Discrepancy detected: Route to VARIANCE_PENDING_FC (no ledger movement until FC approves)
    UPDATE public.t_transfer_intransit
    SET receive_qty_kg = p_receive_qty_kg,
        receive_qty_pcs = p_receive_qty_pcs,
        receiver_user_id = v_caller_id,
        received_at = now(),
        variance_qty = v_variance_qty,
        status = 'VARIANCE_PENDING_FC',
        updated_at = now()
    WHERE transfer_id = p_transfer_id;
  END IF;
END;
$$;

-- 4.3 approve_transfer_variance
CREATE OR REPLACE FUNCTION public.approve_transfer_variance(
  p_transfer_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_transfer record;
  v_in_movement_id uuid;
  v_user_ref text;
BEGIN
  -- 1. Authorization: Only Financial Controller (APPROVER) or System Admin
  IF NOT (
    has_role('APPROVER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Financial Controller (APPROVER) or System Admin can approve transfer variances.';
  END IF;

  -- 2. Caller Resolution
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_id := v_raw_id::uuid;
    ELSE
      v_caller_id := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := auth.uid();
  END;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 3. Fetch & Lock Transfer Record
  SELECT * INTO v_transfer
  FROM public.t_transfer_intransit
  WHERE transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found.', p_transfer_id;
  END IF;

  -- 4. Status Validation
  IF v_transfer.status != 'VARIANCE_PENDING_FC' THEN
    RAISE EXCEPTION 'Transfer % cannot be approved because status is %, expected VARIANCE_PENDING_FC.', p_transfer_id, v_transfer.status;
  END IF;

  -- 5. Segregation of Duties: Transfer dispatcher cannot approve transit variance
  IF v_caller_id = v_transfer.dispatcher_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Transfer dispatcher cannot approve their own transfer variance.';
  END IF;

  -- 6. Resolve user reference for t_stock_movements (created_by_user_id FK)
  SELECT user_id INTO v_user_ref FROM public.m_users WHERE user_id = v_caller_id::text;
  IF v_user_ref IS NULL THEN
    SELECT u.user_id INTO v_user_ref
    FROM public.m_users u
    JOIN auth.users au ON au.email = u.email
    WHERE au.id = v_caller_id
    LIMIT 1;
  END IF;
  IF v_user_ref IS NULL THEN
    v_user_ref := v_caller_id::text;
  END IF;

  -- 7. Append TRANSFER_IN_RECEIVED (+receive_qty_kg) at target warehouse
  INSERT INTO public.t_stock_movements (
    movement_id,
    store_id,
    warehouse_id,
    item_code,
    movement_type,
    quantity,
    uom,
    reference_doc_id,
    created_by_user_id,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_transfer.target_store_id,
    v_transfer.target_warehouse_id,
    v_transfer.item_code,
    'TRANSFER_IN_RECEIVED',
    v_transfer.receive_qty_kg,
    'kg',
    p_transfer_id::text,
    v_user_ref,
    now()
  )
  RETURNING movement_id INTO v_in_movement_id;

  -- 8. Update transfer record to RECEIVED_VARIANCE_APPROVED
  UPDATE public.t_transfer_intransit
  SET status = 'RECEIVED_VARIANCE_APPROVED',
      fc_approval_id = v_caller_id,
      notes = p_notes,
      in_movement_id = v_in_movement_id,
      updated_at = now()
  WHERE transfer_id = p_transfer_id;
END;
$$;

-- 4.4 reject_transfer_variance (Optional FC rejection workflow per Flow G Step G8)
CREATE OR REPLACE FUNCTION public.reject_transfer_variance(
  p_transfer_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_transfer record;
BEGIN
  -- 1. Authorization: Only Financial Controller (APPROVER) or System Admin
  IF NOT (
    has_role('APPROVER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Financial Controller (APPROVER) or System Admin can reject transfer variances.';
  END IF;

  -- 2. Caller Resolution
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_id := v_raw_id::uuid;
    ELSE
      v_caller_id := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_id := auth.uid();
  END;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 3. Fetch & Lock Transfer Record
  SELECT * INTO v_transfer
  FROM public.t_transfer_intransit
  WHERE transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found.', p_transfer_id;
  END IF;

  -- 4. Status Validation
  IF v_transfer.status != 'VARIANCE_PENDING_FC' THEN
    RAISE EXCEPTION 'Transfer % cannot be rejected because status is %, expected VARIANCE_PENDING_FC.', p_transfer_id, v_transfer.status;
  END IF;

  -- 5. Segregation of Duties: Transfer dispatcher cannot reject their own transfer variance
  IF v_caller_id = v_transfer.dispatcher_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Transfer dispatcher cannot reject their own transfer variance.';
  END IF;

  -- 6. Update transfer record to REJECTED
  UPDATE public.t_transfer_intransit
  SET status = 'REJECTED',
      fc_approval_id = v_caller_id,
      notes = p_notes,
      updated_at = now()
  WHERE transfer_id = p_transfer_id;
END;
$$;

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.t_transfer_intransit ENABLE ROW LEVEL SECURITY;

-- 5.1 SELECT Policy: Viewers, FC Approvers, System Admins, or store users matching source or target
DROP POLICY IF EXISTS t_transfer_intransit_select ON public.t_transfer_intransit;
CREATE POLICY t_transfer_intransit_select ON public.t_transfer_intransit
  FOR SELECT
  TO authenticated
  USING (
    current_store_id() IS NULL
    OR source_store_id = current_store_id()
    OR target_store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('VIEWER')
    OR has_role('APPROVER')
  );

-- 5.2 INSERT Policy: Keeper / RM of source store, or System Admin
DROP POLICY IF EXISTS t_transfer_intransit_insert ON public.t_transfer_intransit;
CREATE POLICY t_transfer_intransit_insert ON public.t_transfer_intransit
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('RM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR source_store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    AND source_store_id != target_store_id
  );

-- 5.3 UPDATE Policy: Target store keeper (for receiving), FC (for variance), or System Admin
DROP POLICY IF EXISTS t_transfer_intransit_update ON public.t_transfer_intransit;
CREATE POLICY t_transfer_intransit_update ON public.t_transfer_intransit
  FOR UPDATE
  TO authenticated
  USING (
    (
      (has_role('ADMIN') OR has_role('RM'))
      AND (current_store_id() IS NULL OR target_store_id = current_store_id())
    )
    OR has_role('APPROVER')
    OR has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    (
      (has_role('ADMIN') OR has_role('RM'))
      AND (current_store_id() IS NULL OR target_store_id = current_store_id())
    )
    OR has_role('APPROVER')
    OR has_role('SYSTEM_ADMIN')
  );

-- 5.4 DELETE Policy: Transfers cannot be deleted
DROP POLICY IF EXISTS t_transfer_intransit_delete ON public.t_transfer_intransit;
CREATE POLICY t_transfer_intransit_delete ON public.t_transfer_intransit
  FOR DELETE
  TO authenticated
  USING (false);

-- 6. PERMISSIONS & GRANTS
REVOKE DELETE, TRUNCATE ON public.t_transfer_intransit FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.t_transfer_intransit TO authenticated;
GRANT ALL ON public.t_transfer_intransit TO service_role;

GRANT EXECUTE ON FUNCTION public.dispatch_store_transfer(text, text, text, text, text, numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_store_transfer(uuid, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_transfer_variance(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_transfer_variance(uuid, text) TO authenticated, service_role;
