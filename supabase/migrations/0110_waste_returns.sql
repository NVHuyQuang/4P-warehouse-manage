-- Migration 0110: Waste and Supplier Returns (Domain D11)
-- Pizza 4P's India Inventory Control Tool
-- Flow G: Non-Standard Stock Outflows (Waste Disposal & Supplier Returns)
-- Non-negotiable: Quantities only. Zero price, cost, valuation, tax, or vendor data anywhere.
-- Append-only principles: Approved waste appends WASTE_DISPOSAL (-Q);
-- approved supplier return appends SUPPLIER_RETURN (-Q); never update or delete t_stock_movements.

-- 1. WASTE THRESHOLD CONFIGURATION TABLE (t_waste_threshold_config)
-- Defines minor vs major threshold quantity per store for Restaurant Manager (RM) vs Financial Controller (FC/APPROVER) authorization.
CREATE TABLE IF NOT EXISTS public.t_waste_threshold_config (
  config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  minor_threshold_qty numeric(12,3) NOT NULL DEFAULT 5.000 CHECK (minor_threshold_qty > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_waste_config_store UNIQUE (store_id)
);

-- 2. WASTE & SUPPLIER RETURNS LOG TABLE (t_waste_returns_log)
-- Governs logging, documentation, and dual-party authorization for waste disposal and supplier returns.
CREATE TABLE IF NOT EXISTS public.t_waste_returns_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  movement_id uuid NULL REFERENCES public.t_stock_movements(movement_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('WASTE_DISPOSAL', 'SUPPLIER_RETURN')),
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  uom text NOT NULL,
  po_number text NULL,
  grpo_doc_no text NULL,
  photo_url text NULL,
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  logged_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  approver_user_id uuid NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  approver_decision text NOT NULL CHECK (approver_decision IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
  approver_comment text NULL,
  driver_signature_blob text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz NULL,
  CONSTRAINT chk_waste_distinct_users CHECK (
    approver_user_id IS NULL OR logged_by_user_id != approver_user_id
  ),
  CONSTRAINT chk_supplier_return_requirements CHECK (
    movement_type != 'SUPPLIER_RETURN' OR (
      (po_number IS NOT NULL OR grpo_doc_no IS NOT NULL) AND
      (driver_signature_blob IS NOT NULL AND length(trim(driver_signature_blob)) > 0)
    )
  )
);

-- 3. INDEXES FOR PERFORMANCE AND WORKFLOW QUERIES
CREATE INDEX IF NOT EXISTS idx_waste_config_store 
  ON public.t_waste_threshold_config(store_id);

CREATE INDEX IF NOT EXISTS idx_waste_returns_store_wh 
  ON public.t_waste_returns_log(store_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_waste_returns_decision 
  ON public.t_waste_returns_log(approver_decision);

CREATE INDEX IF NOT EXISTS idx_waste_returns_item 
  ON public.t_waste_returns_log(item_code);

CREATE INDEX IF NOT EXISTS idx_waste_returns_created 
  ON public.t_waste_returns_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waste_returns_logged_by 
  ON public.t_waste_returns_log(logged_by_user_id);

CREATE INDEX IF NOT EXISTS idx_waste_returns_movement_id 
  ON public.t_waste_returns_log(movement_id);

-- 4. TIMESTAMPS AND IMMUTABILITY TRIGGERS
CREATE OR REPLACE FUNCTION public.tg_waste_threshold_config_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_waste_threshold_config_timestamp ON public.t_waste_threshold_config;
CREATE TRIGGER trg_waste_threshold_config_timestamp
  BEFORE UPDATE ON public.t_waste_threshold_config
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_waste_threshold_config_timestamp();

CREATE OR REPLACE FUNCTION public.tg_prevent_waste_returns_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Waste and supplier return logs are append-only and cannot be deleted.';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Finalized decisions cannot be altered
    IF OLD.approver_decision != 'PENDING' THEN
      RAISE EXCEPTION 'Finalized waste or return records cannot be modified (current status: %).', OLD.approver_decision;
    END IF;
    -- Initial logged fields cannot be tampered with during approval
    IF NEW.log_id != OLD.log_id OR
       NEW.store_id != OLD.store_id OR
       NEW.warehouse_id != OLD.warehouse_id OR
       NEW.movement_type != OLD.movement_type OR
       NEW.item_code != OLD.item_code OR
       NEW.quantity != OLD.quantity OR
       NEW.uom != OLD.uom OR
       NEW.logged_by_user_id != OLD.logged_by_user_id OR
       NEW.created_at != OLD.created_at THEN
      RAISE EXCEPTION 'Core logged fields in waste/return records cannot be modified.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_waste_returns_mutation ON public.t_waste_returns_log;
CREATE TRIGGER trg_prevent_waste_returns_mutation
  BEFORE UPDATE OR DELETE ON public.t_waste_returns_log
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_waste_returns_mutation();

REVOKE DELETE ON public.t_waste_returns_log FROM PUBLIC, authenticated, anon;

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.t_waste_threshold_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_waste_returns_log ENABLE ROW LEVEL SECURITY;

-- 5.1 t_waste_threshold_config policies
DROP POLICY IF EXISTS t_waste_threshold_config_select ON public.t_waste_threshold_config;
CREATE POLICY t_waste_threshold_config_select ON public.t_waste_threshold_config
  FOR SELECT TO authenticated
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('APPROVER')
    OR has_role('VIEWER')
  );

DROP POLICY IF EXISTS t_waste_threshold_config_insert ON public.t_waste_threshold_config;
CREATE POLICY t_waste_threshold_config_insert ON public.t_waste_threshold_config
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS t_waste_threshold_config_update ON public.t_waste_threshold_config;
CREATE POLICY t_waste_threshold_config_update ON public.t_waste_threshold_config
  FOR UPDATE TO authenticated
  USING (
    has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS t_waste_threshold_config_delete ON public.t_waste_threshold_config;
CREATE POLICY t_waste_threshold_config_delete ON public.t_waste_threshold_config
  FOR DELETE TO authenticated
  USING (
    has_role('SYSTEM_ADMIN')
  );

-- 5.2 t_waste_returns_log policies
DROP POLICY IF EXISTS t_waste_returns_log_select ON public.t_waste_returns_log;
CREATE POLICY t_waste_returns_log_select ON public.t_waste_returns_log
  FOR SELECT TO authenticated
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('APPROVER')
    OR has_role('VIEWER')
  );

DROP POLICY IF EXISTS t_waste_returns_log_insert ON public.t_waste_returns_log;
CREATE POLICY t_waste_returns_log_insert ON public.t_waste_returns_log
  FOR INSERT TO authenticated
  WITH CHECK (
    (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN') OR has_role('APPROVER'))
    AND NOT (has_role('VIEWER') AND NOT (
      has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR
      has_role('KITCHEN_REQ') OR has_role('BAR_REQ') OR has_role('CHEESE_REQ') OR
      has_role('RUNNER') OR has_role('ACCOUNTANT') OR has_role('SCM') OR
      has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
    ))
    AND approver_decision = 'PENDING'
    AND approver_user_id IS NULL
    AND movement_id IS NULL
  );

DROP POLICY IF EXISTS t_waste_returns_log_update ON public.t_waste_returns_log;
CREATE POLICY t_waste_returns_log_update ON public.t_waste_returns_log
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS t_waste_returns_log_delete ON public.t_waste_returns_log;
CREATE POLICY t_waste_returns_log_delete ON public.t_waste_returns_log
  FOR DELETE TO authenticated
  USING (false);

-- 6. STORED PROCEDURES (SECURITY DEFINER RPCs)

-- 6.1 log_waste_or_return
CREATE OR REPLACE FUNCTION public.log_waste_or_return(
  p_store_id text,
  p_warehouse_id text,
  p_movement_type text,
  p_item_code text,
  p_quantity numeric,
  p_uom text,
  p_reason_code text,
  p_reason_text text,
  p_photo_url text DEFAULT NULL,
  p_po_number text DEFAULT NULL,
  p_grpo_doc_no text DEFAULT NULL,
  p_driver_signature text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_raw_id text;
  v_caller_id uuid;
  v_log_id uuid;
BEGIN
  -- 1. Authorization: Resolve caller UUID
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
    RAISE EXCEPTION 'Unauthorized: No active user session.';
  END IF;

  -- 2. Viewers cannot log
  IF has_role('VIEWER') AND NOT (
    has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR
    has_role('KITCHEN_REQ') OR has_role('BAR_REQ') OR has_role('CHEESE_REQ') OR
    has_role('RUNNER') OR has_role('ACCOUNTANT') OR has_role('SCM') OR
    has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Viewers have read-only access.';
  END IF;

  -- 3. Store Scope Verification
  IF current_store_id() IS NOT NULL AND current_store_id() != p_store_id AND NOT (has_role('SYSTEM_ADMIN') OR has_role('APPROVER')) THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested store is %.', current_store_id(), p_store_id;
  END IF;

  -- 4. Movement Type Validation
  IF p_movement_type NOT IN ('WASTE_DISPOSAL', 'SUPPLIER_RETURN') THEN
    RAISE EXCEPTION 'Invalid movement_type: %. Must be WASTE_DISPOSAL or SUPPLIER_RETURN.', p_movement_type;
  END IF;

  -- 5. Quantity Validation
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be strictly positive (> 0). Provided: %', p_quantity;
  END IF;

  -- 6. UoM Validation
  IF p_uom IS NULL OR length(trim(p_uom)) = 0 THEN
    RAISE EXCEPTION 'UoM (Unit of Measure) is required.';
  END IF;

  -- 7. Reason Validation
  IF p_reason_code IS NULL OR length(trim(p_reason_code)) = 0 THEN
    RAISE EXCEPTION 'Reason code is required.';
  END IF;
  IF p_reason_text IS NULL OR length(trim(p_reason_text)) = 0 THEN
    RAISE EXCEPTION 'Reason text is required.';
  END IF;

  -- 8. Warehouse and Store Existence
  IF NOT EXISTS (
    SELECT 1 FROM public.m_warehouses
    WHERE warehouse_id = p_warehouse_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Warehouse % does not exist in store %.', p_warehouse_id, p_store_id;
  END IF;

  -- 9. Item Existence
  IF NOT EXISTS (
    SELECT 1 FROM public.m_items
    WHERE item_code = p_item_code
  ) THEN
    RAISE EXCEPTION 'Item % does not exist in item master.', p_item_code;
  END IF;

  -- 10. Movement Specific Rules: Supplier Return requires driver sign & doc ref
  IF p_movement_type = 'SUPPLIER_RETURN' THEN
    IF (p_po_number IS NULL OR length(trim(p_po_number)) = 0) AND
       (p_grpo_doc_no IS NULL OR length(trim(p_grpo_doc_no)) = 0) THEN
      RAISE EXCEPTION 'Supplier return requires a PO number or GRPO document reference.';
    END IF;

    IF p_driver_signature IS NULL OR length(trim(p_driver_signature)) = 0 THEN
      RAISE EXCEPTION 'Supplier return requires a driver signature blob.';
    END IF;
  END IF;

  -- 11. Insert Log Entry
  INSERT INTO public.t_waste_returns_log (
    log_id,
    store_id,
    warehouse_id,
    movement_id,
    movement_type,
    item_code,
    quantity,
    uom,
    po_number,
    grpo_doc_no,
    photo_url,
    reason_code,
    reason_text,
    logged_by_user_id,
    approver_user_id,
    approver_decision,
    approver_comment,
    driver_signature_blob,
    created_at,
    authorized_at
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_warehouse_id,
    NULL,
    p_movement_type,
    p_item_code,
    p_quantity,
    trim(p_uom),
    nullif(trim(p_po_number), ''),
    nullif(trim(p_grpo_doc_no), ''),
    nullif(trim(p_photo_url), ''),
    trim(p_reason_code),
    trim(p_reason_text),
    v_caller_id,
    NULL,
    'PENDING',
    NULL,
    nullif(trim(p_driver_signature), ''),
    now(),
    NULL
  ) RETURNING log_id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- 6.2 approve_waste_or_return
CREATE OR REPLACE FUNCTION public.approve_waste_or_return(
  p_log_id uuid,
  p_decision text,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_raw_id text;
  v_caller_id uuid;
  v_log public.t_waste_returns_log%ROWTYPE;
  v_minor_threshold numeric(12,3);
  v_movement_id uuid;
BEGIN
  -- 1. Validate Decision Parameter
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid decision: %. Must be APPROVED or REJECTED.', p_decision;
  END IF;

  -- 2. Resolve Caller User ID
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
    RAISE EXCEPTION 'Unauthorized: No active user session.';
  END IF;

  -- 3. Lock and fetch record
  SELECT * INTO v_log
  FROM public.t_waste_returns_log
  WHERE log_id = p_log_id
  FOR UPDATE;

  IF v_log.log_id IS NULL THEN
    RAISE EXCEPTION 'Waste or return record % not found.', p_log_id;
  END IF;

  IF v_log.approver_decision != 'PENDING' THEN
    RAISE EXCEPTION 'Record % has already been processed with decision %.', p_log_id, v_log.approver_decision;
  END IF;

  -- 4. Segregation of Duties Check: Logger cannot approve or reject own claim
  IF v_caller_id = v_log.logged_by_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Logger cannot approve or reject own claim.';
  END IF;

  -- 5. Store Scope Check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_log.store_id AND NOT (has_role('SYSTEM_ADMIN') OR has_role('APPROVER')) THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, claim store is %.', current_store_id(), v_log.store_id;
  END IF;

  -- 6. Threshold & Role Authorization
  SELECT minor_threshold_qty INTO v_minor_threshold
  FROM public.t_waste_threshold_config
  WHERE store_id = v_log.store_id;

  IF v_minor_threshold IS NULL THEN
    v_minor_threshold := 5.000;
  END IF;

  IF has_role('APPROVER') OR has_role('SYSTEM_ADMIN') THEN
    -- Financial Controller (APPROVER) and System Admin can authorize any claim
    NULL;
  ELSIF has_role('RM') THEN
    IF v_log.movement_type = 'SUPPLIER_RETURN' THEN
      RAISE EXCEPTION 'Unauthorized: Restaurant Manager (RM) cannot approve supplier returns. Approver (FC) role required.';
    END IF;

    IF v_log.movement_type = 'WASTE_DISPOSAL' AND v_log.quantity > v_minor_threshold THEN
      RAISE EXCEPTION 'Unauthorized: Restaurant Manager (RM) cannot approve major waste (quantity % exceeds minor threshold %). Approver (FC) role required.', v_log.quantity, v_minor_threshold;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unauthorized: Only Restaurant Manager (RM) for minor waste or Financial Controller (APPROVER) can approve claims.';
  END IF;

  -- 7. Execute Decision
  IF p_decision = 'REJECTED' THEN
    UPDATE public.t_waste_returns_log
    SET approver_user_id = v_caller_id,
        approver_decision = 'REJECTED',
        approver_comment = p_comment,
        authorized_at = now()
    WHERE log_id = p_log_id;
  ELSIF p_decision = 'APPROVED' THEN
    -- Ensure approver user exists in m_users if table exists
    IF to_regclass('public.m_users') IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.m_users WHERE user_id = v_caller_id::text) THEN
        INSERT INTO public.m_users (user_id, email, full_name)
        SELECT id::text, email, coalesce(raw_user_meta_data->>'full_name', email, id::text)
        FROM auth.users WHERE id = v_caller_id
        ON CONFLICT (user_id) DO NOTHING;
      END IF;
    END IF;

    v_movement_id := gen_random_uuid();

    -- Append-only ledger insert: negative quantity (-Q)
    INSERT INTO public.t_stock_movements (
      movement_id,
      store_id,
      warehouse_id,
      item_code,
      movement_type,
      quantity,
      uom,
      batch_number,
      expiry_date,
      reference_doc_id,
      created_by_user_id,
      created_at
    ) VALUES (
      v_movement_id,
      v_log.store_id,
      v_log.warehouse_id,
      v_log.item_code,
      v_log.movement_type,
      -abs(v_log.quantity),
      v_log.uom,
      NULL,
      NULL,
      v_log.log_id::text,
      v_caller_id::text,
      now()
    );

    UPDATE public.t_waste_returns_log
    SET approver_user_id = v_caller_id,
        approver_decision = 'APPROVED',
        approver_comment = p_comment,
        movement_id = v_movement_id,
        authorized_at = now()
    WHERE log_id = p_log_id;
  END IF;
END;
$$;

-- 7. GRANTS AND PRIVILEGES
GRANT SELECT ON public.t_waste_threshold_config TO authenticated, anon;
GRANT SELECT ON public.t_waste_returns_log TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.log_waste_or_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_waste_or_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_prevent_waste_returns_mutation TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_waste_threshold_config_timestamp TO authenticated;

-- 8. SEED CONFIGURATION FOR KNOWN STORES
INSERT INTO public.t_waste_threshold_config (store_id, minor_threshold_qty)
VALUES
  ('IND-DEL-01', 5.000),
  ('IND-DEL-02', 5.000)
ON CONFLICT (store_id) DO NOTHING;
