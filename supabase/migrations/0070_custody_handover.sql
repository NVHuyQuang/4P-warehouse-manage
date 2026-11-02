-- Migration 0070: Custody & Shift Handover
-- Pizza 4P's India Inventory Control Tool (Quantities Only)
-- Flow B: Custodian Storeroom Access & Issue Windows
-- Flow E: Custodian Shift Handover & Mutual Sign-Off
-- Non-negotiable: Quantities only. Zero financial or commercial data.

-- 1. CUSTODY LOGS TABLE (Flow B)
CREATE TABLE IF NOT EXISTS public.t_custody_logs (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('WINDOW_UNLOCK', 'WINDOW_LOCK', 'URGENT_ACCESS')),
  custodian_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  urgent_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_custody_urgent_reason CHECK (
    event_type != 'URGENT_ACCESS' OR (urgent_reason IS NOT NULL AND length(trim(urgent_reason)) > 0)
  )
);

-- 2. SHIFT CUSTODY LOGS TABLE (Flow E)
CREATE TABLE IF NOT EXISTS public.t_shift_custody_logs (
  shift_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  outgoing_custodian_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  incoming_holder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  shift_type text NOT NULL CHECK (shift_type IN ('DAY_TO_EVENING', 'EVENING_TO_MORNING')),
  signature_blob text NOT NULL,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_shift_custody_distinct_holders CHECK (outgoing_custodian_id != incoming_holder_id),
  CONSTRAINT chk_shift_signature_not_empty CHECK (length(trim(signature_blob)) > 0)
);

-- 3. INDEXES FOR PERFORMANCE & AUDIT QUERIES
CREATE INDEX IF NOT EXISTS idx_custody_logs_store_wh ON public.t_custody_logs(store_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_custody_logs_created_at ON public.t_custody_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_custody_logs_custodian ON public.t_custody_logs(custodian_user_id);

CREATE INDEX IF NOT EXISTS idx_shift_custody_logs_store_wh ON public.t_shift_custody_logs(store_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_shift_custody_logs_transferred_at ON public.t_shift_custody_logs(transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_custody_logs_outgoing ON public.t_shift_custody_logs(outgoing_custodian_id);
CREATE INDEX IF NOT EXISTS idx_shift_custody_logs_incoming ON public.t_shift_custody_logs(incoming_holder_id);

-- 4. APPEND-ONLY IMMUTABILITY TRIGGERS
CREATE OR REPLACE FUNCTION public.tg_prevent_custody_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Custody logs are append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_custody_logs_mutation ON public.t_custody_logs;
CREATE TRIGGER trg_prevent_custody_logs_mutation
  BEFORE UPDATE OR DELETE ON public.t_custody_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_custody_mutation();

DROP TRIGGER IF EXISTS trg_prevent_shift_custody_mutation ON public.t_shift_custody_logs;
CREATE TRIGGER trg_prevent_shift_custody_mutation
  BEFORE UPDATE OR DELETE ON public.t_shift_custody_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_custody_mutation();

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.t_custody_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_shift_custody_logs ENABLE ROW LEVEL SECURITY;

-- 5.1 t_custody_logs policies
-- Authenticated read within store scope
DROP POLICY IF EXISTS t_custody_logs_select ON public.t_custody_logs;
CREATE POLICY t_custody_logs_select ON public.t_custody_logs
  FOR SELECT
  TO authenticated
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('VIEWER')
    OR has_role('APPROVER')
  );

-- Write restricted to Keeper (ADMIN), Custodian (CUSTODIAN), RM (RM), and SYSTEM_ADMIN within store scope
DROP POLICY IF EXISTS t_custody_logs_insert ON public.t_custody_logs;
CREATE POLICY t_custody_logs_insert ON public.t_custody_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS t_custody_logs_update ON public.t_custody_logs;
CREATE POLICY t_custody_logs_update ON public.t_custody_logs
  FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS t_custody_logs_delete ON public.t_custody_logs;
CREATE POLICY t_custody_logs_delete ON public.t_custody_logs
  FOR DELETE
  TO authenticated
  USING (false);

-- 5.2 t_shift_custody_logs policies
-- Authenticated read within store scope
DROP POLICY IF EXISTS t_shift_custody_logs_select ON public.t_shift_custody_logs;
CREATE POLICY t_shift_custody_logs_select ON public.t_shift_custody_logs
  FOR SELECT
  TO authenticated
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('VIEWER')
    OR has_role('APPROVER')
  );

-- Write restricted to Keeper (ADMIN), Custodian (CUSTODIAN), RM (RM), and SYSTEM_ADMIN within store scope
DROP POLICY IF EXISTS t_shift_custody_logs_insert ON public.t_shift_custody_logs;
CREATE POLICY t_shift_custody_logs_insert ON public.t_shift_custody_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    AND outgoing_custodian_id != incoming_holder_id
  );

DROP POLICY IF EXISTS t_shift_custody_logs_update ON public.t_shift_custody_logs;
CREATE POLICY t_shift_custody_logs_update ON public.t_shift_custody_logs
  FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS t_shift_custody_logs_delete ON public.t_shift_custody_logs;
CREATE POLICY t_shift_custody_logs_delete ON public.t_shift_custody_logs
  FOR DELETE
  TO authenticated
  USING (false);

-- 6. SECURITY DEFINER RPCs

-- 6.1 record_custody_event
CREATE OR REPLACE FUNCTION public.record_custody_event(
  p_store_id text,
  p_warehouse_id text,
  p_event_type text,
  p_urgent_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_log_id uuid;
BEGIN
  -- 1. Authorization: Only Keeper (ADMIN), Custodian (CUSTODIAN), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR 
    has_role('CUSTODIAN') OR 
    has_role('RM') OR 
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper, Custodian, or RM can record custody events.';
  END IF;

  -- 2. Store Scope Verification
  IF current_store_id() IS NOT NULL AND current_store_id() != p_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested store is %.', current_store_id(), p_store_id;
  END IF;

  -- 3. Resolve Caller User ID (UUID)
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

  -- 4. Validate Event Type
  IF p_event_type NOT IN ('WINDOW_UNLOCK', 'WINDOW_LOCK', 'URGENT_ACCESS') THEN
    RAISE EXCEPTION 'Invalid event_type: %. Must be WINDOW_UNLOCK, WINDOW_LOCK, or URGENT_ACCESS.', p_event_type;
  END IF;

  -- 5. Validate Urgent Reason for URGENT_ACCESS
  IF p_event_type = 'URGENT_ACCESS' AND (p_urgent_reason IS NULL OR trim(p_urgent_reason) = '') THEN
    RAISE EXCEPTION 'Urgent reason is required for URGENT_ACCESS event.';
  END IF;

  -- 6. Verify Warehouse exists within Store
  IF NOT EXISTS (
    SELECT 1 FROM public.m_warehouses
    WHERE warehouse_id = p_warehouse_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Warehouse % does not belong to store % or does not exist.', p_warehouse_id, p_store_id;
  END IF;

  -- 7. Insert Custody Log
  INSERT INTO public.t_custody_logs (
    log_id,
    store_id,
    warehouse_id,
    event_type,
    custodian_user_id,
    urgent_reason,
    created_at
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_warehouse_id,
    p_event_type,
    v_caller_id,
    CASE WHEN p_event_type = 'URGENT_ACCESS' THEN trim(p_urgent_reason) ELSE p_urgent_reason END,
    now()
  )
  RETURNING log_id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- 6.2 transfer_shift_custody
CREATE OR REPLACE FUNCTION public.transfer_shift_custody(
  p_store_id text,
  p_warehouse_id text,
  p_incoming_holder_id uuid,
  p_shift_type text,
  p_signature_blob text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_shift_log_id uuid;
BEGIN
  -- 1. Authorization: Only Keeper (ADMIN), Custodian (CUSTODIAN), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR 
    has_role('CUSTODIAN') OR 
    has_role('RM') OR 
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper, Custodian, or RM can transfer shift custody.';
  END IF;

  -- 2. Store Scope Verification
  IF current_store_id() IS NOT NULL AND current_store_id() != p_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested store is %.', current_store_id(), p_store_id;
  END IF;

  -- 3. Resolve Caller User ID (Outgoing Custodian)
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

  -- 4. Segregation of Duties: Outgoing Custodian != Incoming Holder
  IF v_caller_id = p_incoming_holder_id THEN
    RAISE EXCEPTION 'Segregation violation: Outgoing custodian cannot transfer custody to themselves.';
  END IF;

  -- 5. Validate Shift Type
  IF p_shift_type NOT IN ('DAY_TO_EVENING', 'EVENING_TO_MORNING') THEN
    RAISE EXCEPTION 'Invalid shift_type: %. Must be DAY_TO_EVENING or EVENING_TO_MORNING.', p_shift_type;
  END IF;

  -- 6. Validate Signature Blob
  IF p_signature_blob IS NULL OR trim(p_signature_blob) = '' THEN
    RAISE EXCEPTION 'Signature blob cannot be empty.';
  END IF;

  -- 7. Verify Warehouse exists within Store
  IF NOT EXISTS (
    SELECT 1 FROM public.m_warehouses
    WHERE warehouse_id = p_warehouse_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Warehouse % does not belong to store % or does not exist.', p_warehouse_id, p_store_id;
  END IF;

  -- 8. Verify Incoming Holder Exists in auth.users
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_incoming_holder_id
  ) THEN
    RAISE EXCEPTION 'Incoming holder user % does not exist in auth.users.', p_incoming_holder_id;
  END IF;

  -- 9. Insert Shift Custody Log (Master Data assignment remains untouched per Flow E)
  INSERT INTO public.t_shift_custody_logs (
    shift_log_id,
    store_id,
    warehouse_id,
    outgoing_custodian_id,
    incoming_holder_id,
    shift_type,
    signature_blob,
    transferred_at
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_warehouse_id,
    v_caller_id,
    p_incoming_holder_id,
    p_shift_type,
    trim(p_signature_blob),
    now()
  )
  RETURNING shift_log_id INTO v_shift_log_id;

  RETURN v_shift_log_id;
END;
$$;

-- 7. PERMISSIONS & GRANTS
REVOKE UPDATE, DELETE ON public.t_custody_logs FROM PUBLIC, authenticated;
REVOKE UPDATE, DELETE ON public.t_shift_custody_logs FROM PUBLIC, authenticated;

GRANT SELECT, INSERT ON public.t_custody_logs TO authenticated;
GRANT SELECT, INSERT ON public.t_shift_custody_logs TO authenticated;
GRANT ALL ON public.t_custody_logs TO service_role;
GRANT ALL ON public.t_shift_custody_logs TO service_role;

GRANT EXECUTE ON FUNCTION public.record_custody_event(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_shift_custody(text, text, uuid, text, text) TO authenticated, service_role;
