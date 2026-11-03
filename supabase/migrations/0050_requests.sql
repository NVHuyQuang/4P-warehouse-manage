-- Migration 0050: Requests Domain (Flow C-1 Section Stock Request)
-- Pizza 4P's India Inventory Control Tool
-- Non-negotiable: Quantities only. Zero price, cost, valuation, tax, or vendor data anywhere.
-- Append-only principles: never update or delete t_stock_movements.

-- ============================================================================
-- 1. TABLES DEFINITIONS
-- ============================================================================

-- 1.1 Section Requisitions Header Table (t_requests)
CREATE TABLE IF NOT EXISTS public.t_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  section_id text NOT NULL CHECK (section_id IN ('KITCHEN', 'BAR', 'CHEESE')),
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  is_urgent boolean NOT NULL DEFAULT false,
  urgent_reason text NULL,
  status text NOT NULL CHECK (
    status IN (
      'QUEUED',
      'PICKING',
      'AWAITING_RUNNER',
      'PARTIAL_ACCEPTED',
      'PARTIAL_DECLINED',
      'CANCELLED_BY_REQUESTER',
      'URGENT_PENDING',
      'CONFIRMED'
    )
  ) DEFAULT 'QUEUED',
  runner_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  runner_confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_urgent_reason CHECK (
    (is_urgent = false) OR (urgent_reason IS NOT NULL AND length(trim(urgent_reason)) > 0)
  )
);

-- 1.2 Section Requisition Line Items Table (t_request_items)
CREATE TABLE IF NOT EXISTS public.t_request_items (
  request_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.t_requests(request_id) ON DELETE CASCADE,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  requested_qty numeric(12,3) NOT NULL CHECK (requested_qty > 0),
  issued_qty numeric(12,3) NULL CHECK (issued_qty >= 0),
  uom text NOT NULL,
  variance_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. INDEXES FOR PERFORMANCE & REPORTING
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_requests_store_section ON public.t_requests(store_id, section_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.t_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON public.t_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON public.t_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_runner ON public.t_requests(runner_user_id);

CREATE INDEX IF NOT EXISTS idx_request_items_request_id ON public.t_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_request_items_item_code ON public.t_request_items(item_code);

-- ============================================================================
-- 3. FLOW C-1 STATE MACHINE & IMMUTABILITY TRIGGERS
-- ============================================================================

-- 3.1 Updated_at synchronization trigger
CREATE OR REPLACE FUNCTION public.tg_requests_sync_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_requests_sync_updated_at ON public.t_requests;
CREATE TRIGGER trg_requests_sync_updated_at
  BEFORE UPDATE ON public.t_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_requests_sync_updated_at();

-- 3.2 Header Lock Trigger: Requesters can edit/cancel ONLY while status is 'QUEUED'
CREATE OR REPLACE FUNCTION public.tg_enforce_request_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cancellation lock: cannot cancel once status has advanced past QUEUED
  IF OLD.status != 'QUEUED' AND NEW.status = 'CANCELLED_BY_REQUESTER' THEN
    RAISE EXCEPTION 'Cannot cancel request: request is in status %, only QUEUED requests can be cancelled.', OLD.status;
  END IF;

  -- Structural mutation lock: once picking has begun, requisition metadata is immutable
  IF OLD.status != 'QUEUED' THEN
    IF NEW.store_id != OLD.store_id OR
       NEW.section_id != OLD.section_id OR
       NEW.requester_user_id != OLD.requester_user_id OR
       NEW.is_urgent != OLD.is_urgent OR
       (NEW.urgent_reason IS DISTINCT FROM OLD.urgent_reason) THEN
      RAISE EXCEPTION 'Cannot modify request fields once picking has commenced (status: %).', OLD.status;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_request_lock ON public.t_requests;
CREATE TRIGGER trg_enforce_request_lock
  BEFORE UPDATE ON public.t_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_request_lock();

-- 3.3 Line Items Lock Trigger: Requested items/quantities locked once picking starts
CREATE OR REPLACE FUNCTION public.tg_enforce_request_item_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.t_requests WHERE request_id = OLD.request_id;
    IF v_status IS NOT NULL AND v_status != 'QUEUED' THEN
      RAISE EXCEPTION 'Cannot delete item: request is in status %, modifications locked once picking has commenced.', v_status;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM public.t_requests WHERE request_id = NEW.request_id;
    IF v_status IS NOT NULL AND v_status != 'QUEUED' THEN
      RAISE EXCEPTION 'Cannot add item: request is in status %, modifications locked once picking has commenced.', v_status;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status FROM public.t_requests WHERE request_id = OLD.request_id;
    IF v_status IS NOT NULL AND v_status != 'QUEUED' THEN
      -- Requesters cannot modify requested_qty, item_code, or uom once picking has started
      IF NEW.item_code != OLD.item_code OR
         NEW.requested_qty != OLD.requested_qty OR
         NEW.uom != OLD.uom OR
         NEW.request_id != OLD.request_id THEN
        RAISE EXCEPTION 'Cannot edit requested item or quantity once picking has commenced (status: %).', v_status;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_request_item_lock ON public.t_request_items;
CREATE TRIGGER trg_enforce_request_item_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.t_request_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_request_item_lock();

-- ============================================================================
-- 4. ISSUE WINDOW LOGIC FUNCTIONS
-- ============================================================================

-- 4.1 Parse and test time against a 'HH24:MI-HH24:MI' window string
CREATE OR REPLACE FUNCTION public.is_time_in_window(
  p_time time,
  p_window text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_start time;
  v_end time;
BEGIN
  IF p_window IS NULL OR position('-' in p_window) = 0 THEN
    RETURN false;
  END IF;

  BEGIN
    v_start := trim(split_part(p_window, '-', 1))::time;
    v_end := trim(split_part(p_window, '-', 2))::time;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF v_start <= v_end THEN
    RETURN p_time >= v_start AND p_time <= v_end;
  ELSE
    -- Window spans midnight (e.g. 23:00-02:00)
    RETURN p_time >= v_start OR p_time <= v_end;
  END IF;
END;
$$;

-- 4.2 Check whether issue window is active via store custody or store config
CREATE OR REPLACE FUNCTION public.is_store_issue_window_open(
  p_store_id text,
  p_check_time timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_override text;
  v_last_custody_event text;
  v_morning_win text;
  v_afternoon_win text;
  v_local_time time;
BEGIN
  -- 1. Test/session override support (deterministic testing & developer harness)
  v_override := nullif(current_setting('app.test_inside_window', true), '');
  IF v_override IS NOT NULL THEN
    RETURN v_override::boolean;
  END IF;

  -- 2. Store custody active state check:
  -- If custodian recorded WINDOW_UNLOCK most recently for this store, window is currently open
  IF to_regclass('public.t_custody_logs') IS NOT NULL THEN
    SELECT event_type INTO v_last_custody_event
    FROM public.t_custody_logs
    WHERE store_id = p_store_id
      AND event_type IN ('WINDOW_UNLOCK', 'WINDOW_LOCK')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_custody_event = 'WINDOW_UNLOCK' THEN
      RETURN true;
    END IF;
  END IF;

  -- 3. Store operational configuration check in m_go_live_assignments
  IF to_regclass('public.m_go_live_assignments') IS NOT NULL THEN
    SELECT morning_issue_window, afternoon_issue_window
    INTO v_morning_win, v_afternoon_win
    FROM public.m_go_live_assignments
    WHERE store_id = p_store_id;

    -- Evaluate time in store local timezone (Asia/Kolkata for Pizza 4P's India)
    v_local_time := (p_check_time AT TIME ZONE 'Asia/Kolkata')::time;

    IF public.is_time_in_window(v_local_time, v_morning_win) OR
       public.is_time_in_window(v_local_time, v_afternoon_win) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- ============================================================================
-- 5. STORED PROCEDURES (SECURITY DEFINER RPCS)
-- ============================================================================

-- 5.1 create_section_request: Flow C-1 Section Stock Request creation
CREATE OR REPLACE FUNCTION public.create_section_request(
  p_store_id text,
  p_section_id text,
  p_items jsonb,
  p_urgent_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_is_window_open boolean;
  v_is_urgent boolean := false;
  v_urgent_reason text := NULL;
  v_request_id uuid;
  v_item jsonb;
  v_item_code text;
  v_requested_qty numeric(12,3);
  v_uom text;
  v_base_uom text;
BEGIN
  -- 1. Authorization: Only section requesters or administrators
  IF NOT (
    has_role('KITCHEN_REQ') OR
    has_role('BAR_REQ') OR
    has_role('CHEESE_REQ') OR
    has_role('ADMIN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only section requesters or administrators can create section requests.';
  END IF;

  -- 2. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != p_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested store is %.', current_store_id(), p_store_id;
  END IF;

  -- 3. Resolve caller UUID
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

  -- 4. Store verification
  IF NOT EXISTS (
    SELECT 1 FROM public.m_stores WHERE store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Store % does not exist.', p_store_id;
  END IF;

  -- 5. Section verification
  IF p_section_id NOT IN ('KITCHEN', 'BAR', 'CHEESE') THEN
    RAISE EXCEPTION 'Invalid section_id: %. Must be KITCHEN, BAR, or CHEESE.', p_section_id;
  END IF;

  -- 6. Role vs Section alignment (frontline requesters restricted to their assigned section)
  IF has_role('KITCHEN_REQ') AND NOT (has_role('ADMIN') OR has_role('SYSTEM_ADMIN')) AND p_section_id != 'KITCHEN' THEN
    RAISE EXCEPTION 'Role KITCHEN_REQ is only permitted to request for KITCHEN section.';
  END IF;
  IF has_role('BAR_REQ') AND NOT (has_role('ADMIN') OR has_role('SYSTEM_ADMIN')) AND p_section_id != 'BAR' THEN
    RAISE EXCEPTION 'Role BAR_REQ is only permitted to request for BAR section.';
  END IF;
  IF has_role('CHEESE_REQ') AND NOT (has_role('ADMIN') OR has_role('SYSTEM_ADMIN')) AND p_section_id != 'CHEESE' THEN
    RAISE EXCEPTION 'Role CHEESE_REQ is only permitted to request for CHEESE section.';
  END IF;

  -- 7. Validate items payload
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Request must contain at least one item.';
  END IF;

  -- 8. Window logic check
  v_is_window_open := public.is_store_issue_window_open(p_store_id);

  IF NOT v_is_window_open THEN
    -- Outside window: urgent reason is mandatory, flagged is_urgent = true, accepted (never blocked)
    IF p_urgent_reason IS NULL OR length(trim(p_urgent_reason)) = 0 THEN
      RAISE EXCEPTION 'Request is outside the active issue window. An urgent reason is required.';
    END IF;
    v_is_urgent := true;
    v_urgent_reason := trim(p_urgent_reason);
  ELSE
    -- Inside window: standard request; if reason provided, keep urgent flag
    IF p_urgent_reason IS NOT NULL AND length(trim(p_urgent_reason)) > 0 THEN
      v_is_urgent := true;
      v_urgent_reason := trim(p_urgent_reason);
    ELSE
      v_is_urgent := false;
      v_urgent_reason := NULL;
    END IF;
  END IF;

  -- 9. Insert request header
  INSERT INTO public.t_requests (
    request_id,
    store_id,
    section_id,
    requester_user_id,
    is_urgent,
    urgent_reason,
    status,
    runner_user_id,
    runner_confirmed_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_store_id,
    p_section_id,
    v_caller_id,
    v_is_urgent,
    v_urgent_reason,
    'QUEUED',
    NULL,
    NULL,
    now(),
    now()
  )
  RETURNING request_id INTO v_request_id;

  -- 10. Validate and insert line items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_code := v_item ->> 'item_code';
    IF v_item_code IS NULL OR trim(v_item_code) = '' THEN
      RAISE EXCEPTION 'Item code is required for all line items.';
    END IF;

    -- Look up item and base UOM in m_items
    SELECT base_uom INTO v_base_uom
    FROM public.m_items
    WHERE item_code = v_item_code;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % does not exist in item master.', v_item_code;
    END IF;

    -- Validate quantity
    BEGIN
      v_requested_qty := (v_item ->> 'requested_qty')::numeric(12,3);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid requested_qty for item %.', v_item_code;
    END;

    IF v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'Requested quantity for item % must be greater than zero.', v_item_code;
    END IF;

    -- Resolve UOM
    v_uom := coalesce(nullif(trim(v_item ->> 'uom'), ''), v_base_uom);

    -- Insert line item
    INSERT INTO public.t_request_items (
      request_item_id,
      request_id,
      item_code,
      requested_qty,
      issued_qty,
      uom,
      variance_reason,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_request_id,
      v_item_code,
      v_requested_qty,
      NULL,
      v_uom,
      NULL,
      now()
    );
  END LOOP;

  RETURN v_request_id;
END;
$$;

-- 5.2 update_section_request: Flow C-1 Step C8/C9 Quantity Amendment
CREATE OR REPLACE FUNCTION public.update_section_request(
  p_request_id uuid,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req public.t_requests%ROWTYPE;
  v_caller_id uuid;
  v_raw_id text;
  v_item jsonb;
  v_item_code text;
  v_requested_qty numeric(12,3);
  v_uom text;
  v_base_uom text;
BEGIN
  -- 1. Fetch request
  SELECT * INTO v_req
  FROM public.t_requests
  WHERE request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found.', p_request_id;
  END IF;

  -- 2. Resolve caller UUID
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

  -- 3. Authorization check: Original requester or Administrator
  IF NOT (
    v_caller_id = v_req.requester_user_id OR
    has_role('ADMIN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only the original requester or administrator can update this request.';
  END IF;

  -- 4. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_req.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch.';
  END IF;

  -- 5. Flow C-1 Status Lock: Editable only while QUEUED
  IF v_req.status != 'QUEUED' THEN
    RAISE EXCEPTION 'Cannot edit request: request is in status %, modifications locked once picking has commenced.', v_req.status;
  END IF;

  -- 6. Validate items payload
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Request must contain at least one item.';
  END IF;

  -- 7. Apply updates or additions
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_requested_qty := (v_item ->> 'requested_qty')::numeric(12,3);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid requested_qty in update payload.';
    END;

    IF v_requested_qty IS NULL OR v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'Requested quantity must be greater than zero.';
    END IF;

    IF (v_item ->> 'request_item_id') IS NOT NULL THEN
      UPDATE public.t_request_items
      SET requested_qty = v_requested_qty
      WHERE request_item_id = (v_item ->> 'request_item_id')::uuid
        AND request_id = p_request_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Request item % not found in request %.', v_item ->> 'request_item_id', p_request_id;
      END IF;
    ELSIF (v_item ->> 'item_code') IS NOT NULL THEN
      v_item_code := v_item ->> 'item_code';

      SELECT base_uom INTO v_base_uom FROM public.m_items WHERE item_code = v_item_code;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % does not exist in item master.', v_item_code;
      END IF;

      UPDATE public.t_request_items
      SET requested_qty = v_requested_qty
      WHERE request_id = p_request_id
        AND item_code = v_item_code;

      IF NOT FOUND THEN
        v_uom := coalesce(nullif(trim(v_item ->> 'uom'), ''), v_base_uom);
        INSERT INTO public.t_request_items (
          request_item_id,
          request_id,
          item_code,
          requested_qty,
          issued_qty,
          uom,
          variance_reason,
          created_at
        ) VALUES (
          gen_random_uuid(),
          p_request_id,
          v_item_code,
          v_requested_qty,
          NULL,
          v_uom,
          NULL,
          now()
        );
      END IF;
    ELSE
      RAISE EXCEPTION 'Each item in payload must specify request_item_id or item_code.';
    END IF;
  END LOOP;

  -- 8. Update request updated_at timestamp
  UPDATE public.t_requests
  SET updated_at = now()
  WHERE request_id = p_request_id;
END;
$$;

-- 5.3 cancel_section_request: Flow C-1 Step C10 Requisition Cancellation
CREATE OR REPLACE FUNCTION public.cancel_section_request(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req public.t_requests%ROWTYPE;
  v_caller_id uuid;
  v_raw_id text;
BEGIN
  -- 1. Fetch request
  SELECT * INTO v_req
  FROM public.t_requests
  WHERE request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found.', p_request_id;
  END IF;

  -- 2. Resolve caller UUID
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

  -- 3. Authorization check: Original requester or Administrator
  IF NOT (
    v_caller_id = v_req.requester_user_id OR
    has_role('ADMIN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only the original requester or administrator can cancel this request.';
  END IF;

  -- 4. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_req.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch.';
  END IF;

  -- 5. Flow C-1 Status Lock: Cancellable only while QUEUED
  IF v_req.status != 'QUEUED' THEN
    RAISE EXCEPTION 'Cannot cancel request: request is in status %, cancellation locked once picking has commenced.', v_req.status;
  END IF;

  -- 6. Mark status CANCELLED_BY_REQUESTER
  UPDATE public.t_requests
  SET status = 'CANCELLED_BY_REQUESTER',
      updated_at = now()
  WHERE request_id = p_request_id;
END;
$$;

-- 5.4 begin_request_picking: Keeper transition from QUEUED to PICKING (Flow C-1 -> Flow C-2)
CREATE OR REPLACE FUNCTION public.begin_request_picking(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req public.t_requests%ROWTYPE;
BEGIN
  -- 1. Authorization: Keeper (ADMIN), Custodian (CUSTODIAN), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('CUSTODIAN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Warehouse Keeper or Custodian can begin picking.';
  END IF;

  -- 2. Fetch request
  SELECT * INTO v_req
  FROM public.t_requests
  WHERE request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found.', p_request_id;
  END IF;

  -- 3. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_req.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch.';
  END IF;

  -- 4. Status check
  IF v_req.status != 'QUEUED' THEN
    RAISE EXCEPTION 'Cannot begin picking: request is in status %, expected QUEUED.', v_req.status;
  END IF;

  -- 5. Advance status to PICKING
  UPDATE public.t_requests
  SET status = 'PICKING',
      updated_at = now()
  WHERE request_id = p_request_id;
END;
$$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.t_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_request_items ENABLE ROW LEVEL SECURITY;

-- 6.1 t_requests RLS Policies

-- SELECT: Requesters, Keepers, Runners, FC/Approvers, and Viewers within store scope
DROP POLICY IF EXISTS t_requests_select ON public.t_requests;
CREATE POLICY t_requests_select ON public.t_requests
  FOR SELECT
  TO authenticated
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('VIEWER')
    OR has_role('APPROVER')
  );

-- INSERT: Section requesters and Keepers within store scope
DROP POLICY IF EXISTS t_requests_insert ON public.t_requests;
CREATE POLICY t_requests_insert ON public.t_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      has_role('KITCHEN_REQ') OR
      has_role('BAR_REQ') OR
      has_role('CHEESE_REQ') OR
      has_role('ADMIN') OR
      has_role('SYSTEM_ADMIN')
    )
    AND (
      current_store_id() IS NULL
      OR store_id = current_store_id()
      OR has_role('SYSTEM_ADMIN')
    )
  );

-- UPDATE: Requesters (only while QUEUED), Keepers (pick queue management), Runners (confirmation)
DROP POLICY IF EXISTS t_requests_update ON public.t_requests;
CREATE POLICY t_requests_update ON public.t_requests
  FOR UPDATE
  TO authenticated
  USING (
    (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    AND (
      -- Requester updating their own request while QUEUED
      (
        (requester_user_id = auth.uid() OR requester_user_id::text = current_setting('app.current_user_id', true))
        AND status = 'QUEUED'
      )
      -- Keepers managing pick queue and staging
      OR has_role('ADMIN')
      OR has_role('CUSTODIAN')
      -- Runners confirming door handover
      OR has_role('RUNNER')
      -- Global administrator
      OR has_role('SYSTEM_ADMIN')
    )
  )
  WITH CHECK (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
  );

-- DELETE: Prohibited for regular staff; requests are cancelled via CANCELLED_BY_REQUESTER
DROP POLICY IF EXISTS t_requests_delete ON public.t_requests;
CREATE POLICY t_requests_delete ON public.t_requests
  FOR DELETE
  TO authenticated
  USING (
    has_role('SYSTEM_ADMIN')
  );

-- 6.2 t_request_items RLS Policies

-- SELECT: Same visibility as parent requisition
DROP POLICY IF EXISTS t_request_items_select ON public.t_request_items;
CREATE POLICY t_request_items_select ON public.t_request_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.t_requests r
      WHERE r.request_id = t_request_items.request_id
        AND (
          current_store_id() IS NULL
          OR r.store_id = current_store_id()
          OR has_role('SYSTEM_ADMIN')
          OR has_role('VIEWER')
          OR has_role('APPROVER')
        )
    )
  );

-- INSERT: Allowed when parent request is QUEUED and caller is authorized requester or admin
DROP POLICY IF EXISTS t_request_items_insert ON public.t_request_items;
CREATE POLICY t_request_items_insert ON public.t_request_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.t_requests r
      WHERE r.request_id = t_request_items.request_id
        AND (current_store_id() IS NULL OR r.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
        AND r.status = 'QUEUED'
        AND (
          has_role('KITCHEN_REQ') OR
          has_role('BAR_REQ') OR
          has_role('CHEESE_REQ') OR
          has_role('ADMIN') OR
          has_role('SYSTEM_ADMIN')
        )
    )
  );

-- UPDATE: Requester while QUEUED, or Keepers while PICKING/AWAITING_RUNNER
DROP POLICY IF EXISTS t_request_items_update ON public.t_request_items;
CREATE POLICY t_request_items_update ON public.t_request_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.t_requests r
      WHERE r.request_id = t_request_items.request_id
        AND (current_store_id() IS NULL OR r.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
        AND (
          (r.status = 'QUEUED' AND (r.requester_user_id = auth.uid() OR r.requester_user_id::text = current_setting('app.current_user_id', true)))
          OR has_role('ADMIN')
          OR has_role('CUSTODIAN')
          OR has_role('SYSTEM_ADMIN')
        )
    )
  );

-- DELETE: Requester while QUEUED, or Administrator
DROP POLICY IF EXISTS t_request_items_delete ON public.t_request_items;
CREATE POLICY t_request_items_delete ON public.t_request_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.t_requests r
      WHERE r.request_id = t_request_items.request_id
        AND (current_store_id() IS NULL OR r.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
        AND (
          (r.status = 'QUEUED' AND (r.requester_user_id = auth.uid() OR r.requester_user_id::text = current_setting('app.current_user_id', true)))
          OR has_role('ADMIN')
          OR has_role('SYSTEM_ADMIN')
        )
    )
  );

-- ============================================================================
-- 7. PERMISSIONS & GRANTS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON public.t_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.t_request_items TO authenticated;
GRANT ALL ON public.t_requests TO service_role;
GRANT ALL ON public.t_request_items TO service_role;

GRANT EXECUTE ON FUNCTION public.is_time_in_window(time, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.is_store_issue_window_open(text, timestamptz) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.create_section_request(text, text, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_section_request(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_section_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_request_picking(uuid) TO authenticated, service_role;
