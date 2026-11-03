-- Migration 0060: Issue & Confirmation Domain (Flow C-2)
-- Pizza 4P's India Inventory Control Tool
-- Flow C-2: Stock Issue and Confirmation Lifecycle
-- Non-negotiable: Quantities only. Zero price, cost, valuation, tax, or vendor data anywhere.
-- Append-only principles: never update or delete t_stock_movements. All stock deductions and offsets are append-only.

-- ============================================================================
-- 1. STORED PROCEDURE: stage_issue
-- ============================================================================
-- Warehouse Keeper / Custodian picks and stages stock for a section request.
-- Validates that candidate lots are unexpired and active.
-- Advances request status from 'PICKING' (or 'QUEUED') to 'AWAITING_RUNNER'.
-- Updates t_request_items.issued_qty = staged_qty.
-- Appends ISSUE_PENDING with signed negative quantity (-staged_qty) to t_stock_movements.

CREATE OR REPLACE FUNCTION public.stage_issue(
  p_request_id uuid,
  p_staged_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req public.t_requests%ROWTYPE;
  v_raw_id text;
  v_caller_uuid uuid;
  v_movement_user_id text;
  v_elem jsonb;
  v_item_id uuid;
  v_staged_qty numeric;
  v_batch_number text;
  v_expiry_date date;
  v_warehouse_id text;
  v_req_item public.t_request_items%ROWTYPE;
  v_lookup_expiry date;
BEGIN
  -- 1. Authorization: Only Warehouse Keeper (ADMIN), Custodian (CUSTODIAN), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('CUSTODIAN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Warehouse Keeper or Custodian can stage stock.';
  END IF;

  -- 2. Fetch and lock request
  SELECT * INTO v_req
  FROM public.t_requests
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found.', p_request_id;
  END IF;

  -- 3. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_req.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested store is %.', current_store_id(), v_req.store_id;
  END IF;

  -- 4. Status check: Can advance from QUEUED or PICKING to AWAITING_RUNNER
  IF v_req.status NOT IN ('PICKING', 'QUEUED') THEN
    RAISE EXCEPTION 'Cannot stage issue: request % is in status %, expected PICKING or QUEUED.', p_request_id, v_req.status;
  END IF;

  -- 5. Resolve caller user context
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );

  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_uuid := v_raw_id::uuid;
    ELSE
      v_caller_uuid := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_uuid := auth.uid();
  END;

  -- Resolve movement user_id referencing public.m_users(user_id)
  SELECT user_id INTO v_movement_user_id
  FROM public.m_users
  WHERE user_id = v_raw_id
     OR user_id = coalesce(v_caller_uuid::text, '')
  LIMIT 1;

  IF v_movement_user_id IS NULL AND v_caller_uuid IS NOT NULL THEN
    SELECT u.user_id INTO v_movement_user_id
    FROM public.m_users u
    JOIN auth.users a ON a.email = u.email
    WHERE a.id = v_caller_uuid
    LIMIT 1;
  END IF;

  IF v_movement_user_id IS NULL THEN
    v_movement_user_id := coalesce(v_raw_id, v_caller_uuid::text);
  END IF;

  IF v_movement_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 6. Validate payload structure
  IF p_staged_items IS NULL OR jsonb_typeof(p_staged_items) != 'array' OR jsonb_array_length(p_staged_items) = 0 THEN
    RAISE EXCEPTION 'Staged items payload must be a non-empty array.';
  END IF;

  -- 7. Process each staged item
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_staged_items)
  LOOP
    v_item_id := (v_elem ->> 'request_item_id')::uuid;
    v_staged_qty := (v_elem ->> 'staged_qty')::numeric;
    v_batch_number := nullif(trim(v_elem ->> 'batch_number'), '');
    v_warehouse_id := nullif(trim(v_elem ->> 'warehouse_id'), '');
    
    v_expiry_date := NULL;
    IF v_elem ? 'expiry_date' AND v_elem ->> 'expiry_date' IS NOT NULL AND trim(v_elem ->> 'expiry_date') != '' THEN
      BEGIN
        v_expiry_date := (v_elem ->> 'expiry_date')::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid expiry_date format: %', v_elem ->> 'expiry_date';
      END;
    END IF;

    -- Validations
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Missing request_item_id in staged item.';
    END IF;

    IF v_staged_qty IS NULL OR v_staged_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid staged_qty: %. Must be greater than 0.', v_staged_qty;
    END IF;

    -- Fetch request item
    SELECT * INTO v_req_item
    FROM public.t_request_items
    WHERE request_item_id = v_item_id AND request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Request item % not found in request %.', v_item_id, p_request_id;
    END IF;

    -- Lot validity & Expiry Radar hard lock
    -- Rule: If candidate lot is expired (expiry_date <= CURRENT_DATE), reject immediately
    IF v_expiry_date IS NOT NULL AND v_expiry_date <= CURRENT_DATE THEN
      RAISE EXCEPTION 'Candidate lot is expired and locked';
    END IF;

    IF v_expiry_date IS NULL AND v_batch_number IS NOT NULL THEN
      SELECT expiry_date INTO v_lookup_expiry
      FROM public.t_stock_movements
      WHERE item_code = v_req_item.item_code
        AND batch_number = v_batch_number
        AND expiry_date IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_lookup_expiry IS NOT NULL THEN
        v_expiry_date := v_lookup_expiry;
        IF v_expiry_date <= CURRENT_DATE THEN
          RAISE EXCEPTION 'Candidate lot is expired and locked';
        END IF;
      END IF;
    END IF;

    -- Resolve warehouse_id if not provided
    IF v_warehouse_id IS NULL THEN
      v_warehouse_id := current_warehouse_id();
      IF v_warehouse_id IS NULL THEN
        SELECT w.warehouse_id INTO v_warehouse_id
        FROM public.m_items i
        JOIN public.m_warehouses w ON w.store_id = v_req.store_id
        WHERE i.item_code = v_req_item.item_code
          AND (
            (i.category_group IN ('CHEESE', 'MEAT') AND w.storage_type = 'COLD_ROOM')
            OR (i.category_group NOT IN ('CHEESE', 'MEAT') AND w.storage_type = 'DRY_STORE')
          )
          AND w.is_active = true
        LIMIT 1;
      END IF;

      IF v_warehouse_id IS NULL THEN
        SELECT warehouse_id INTO v_warehouse_id
        FROM public.m_warehouses
        WHERE store_id = v_req.store_id AND is_active = true
        LIMIT 1;
      END IF;
    END IF;

    IF v_warehouse_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.m_warehouses
      WHERE warehouse_id = v_warehouse_id AND store_id = v_req.store_id
    ) THEN
      RAISE EXCEPTION 'Warehouse % does not belong to store % or does not exist.', v_warehouse_id, v_req.store_id;
    END IF;

    -- Update line item issued quantity
    UPDATE public.t_request_items
    SET issued_qty = v_staged_qty
    WHERE request_item_id = v_item_id;

    -- Append ISSUE_PENDING with signed negative quantity (-staged_qty) to append-only ledger
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
      gen_random_uuid(),
      v_req.store_id,
      v_warehouse_id,
      v_req_item.item_code,
      'ISSUE_PENDING',
      -abs(v_staged_qty),
      v_req_item.uom,
      v_batch_number,
      v_expiry_date,
      p_request_id::text,
      v_movement_user_id,
      now()
    );
  END LOOP;

  -- 8. Advance request lifecycle state to AWAITING_RUNNER
  UPDATE public.t_requests
  SET status = 'AWAITING_RUNNER',
      updated_at = now()
  WHERE request_id = p_request_id;
END;
$$;


-- ============================================================================
-- 2. STORED PROCEDURE: confirm_issue
-- ============================================================================
-- Kitchen Runner inspects and accepts goods at the storeroom door.
-- Enforces segregation of duties: Runner cannot be the keeper who staged the issue (unless admin override).
-- Full acceptance (accepted_qty == staged_qty):
--   - Appends ISSUE_PENDING_OFFSET with +staged_qty to t_stock_movements.
--   - Appends ISSUE_CONFIRMED with -staged_qty to t_stock_movements.
--   - Sets t_requests.status = 'CONFIRMED', runner_user_id = caller, runner_confirmed_at = now().
-- Partial acceptance (accepted_qty < staged_qty):
--   - Declines remaining qty (staged_qty - accepted_qty), physically returned to shelf.
--   - Appends ISSUE_PENDING_OFFSET with +staged_qty to t_stock_movements.
--   - Appends ISSUE_CONFIRMED with -accepted_qty to t_stock_movements.
--   - Sets t_requests.status = 'PARTIAL_ACCEPTED', runner_user_id = caller, runner_confirmed_at = now().

CREATE OR REPLACE FUNCTION public.confirm_issue(
  p_request_id uuid,
  p_accepted_items jsonb,
  p_variance_reasons jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req public.t_requests%ROWTYPE;
  v_raw_id text;
  v_caller_uuid uuid;
  v_movement_user_id text;
  v_runner_uuid uuid;
  v_staged_by text;
  v_elem jsonb;
  v_item_id uuid;
  v_accepted_qty numeric;
  v_variance_reason text;
  v_req_item public.t_request_items%ROWTYPE;
  v_staged_qty numeric;
  v_wh_id text;
  v_batch_number text;
  v_expiry_date date;
  v_uom text;
  v_has_partial boolean := false;
  v_total_accepted numeric := 0;
  v_total_staged numeric := 0;
  v_unmatched_count integer;
BEGIN
  -- 1. Fetch and lock request
  SELECT * INTO v_req
  FROM public.t_requests
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found.', p_request_id;
  END IF;

  -- 2. State machine check: must be in AWAITING_RUNNER status
  IF v_req.status != 'AWAITING_RUNNER' THEN
    RAISE EXCEPTION 'Cannot confirm issue: request is in status %, expected AWAITING_RUNNER.', v_req.status;
  END IF;

  -- 3. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_req.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, request store is %.', current_store_id(), v_req.store_id;
  END IF;

  -- 4. Resolve caller user context
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );

  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_uuid := v_raw_id::uuid;
    ELSE
      v_caller_uuid := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_uuid := auth.uid();
  END;

  SELECT user_id INTO v_movement_user_id
  FROM public.m_users
  WHERE user_id = v_raw_id
     OR user_id = coalesce(v_caller_uuid::text, '')
  LIMIT 1;

  IF v_movement_user_id IS NULL AND v_caller_uuid IS NOT NULL THEN
    SELECT u.user_id INTO v_movement_user_id
    FROM public.m_users u
    JOIN auth.users a ON a.email = u.email
    WHERE a.id = v_caller_uuid
    LIMIT 1;
  END IF;

  IF v_movement_user_id IS NULL THEN
    v_movement_user_id := coalesce(v_raw_id, v_caller_uuid::text);
  END IF;

  IF v_movement_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 5. Segregation of duties enforcement
  -- Runner cannot be the keeper who staged the issue (unless admin override)
  SELECT created_by_user_id INTO v_staged_by
  FROM public.t_stock_movements
  WHERE reference_doc_id = p_request_id::text
    AND movement_type = 'ISSUE_PENDING'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_staged_by IS NOT NULL AND NOT has_role('SYSTEM_ADMIN') THEN
    IF v_staged_by = v_movement_user_id
       OR v_staged_by = v_raw_id
       OR (v_caller_uuid IS NOT NULL AND v_staged_by = v_caller_uuid::text)
    THEN
      RAISE EXCEPTION 'Segregation of duties violation: Staging keeper cannot confirm their own issue.';
    END IF;
  END IF;

  -- 6. Role Check: Runner or System Admin
  IF NOT (
    has_role('RUNNER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Kitchen Runner can confirm issue.';
  END IF;

  -- 7. Validate payload structure
  IF p_accepted_items IS NULL OR jsonb_typeof(p_accepted_items) != 'array' OR jsonb_array_length(p_accepted_items) = 0 THEN
    RAISE EXCEPTION 'Accepted items payload must be a non-empty array.';
  END IF;

  -- Verify all items in payload belong to this request
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_accepted_items)
  LOOP
    v_item_id := (v_elem ->> 'request_item_id')::uuid;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Missing request_item_id in accepted item.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.t_request_items
      WHERE request_item_id = v_item_id AND request_id = p_request_id
    ) THEN
      RAISE EXCEPTION 'Request item % does not belong to request %.', v_item_id, p_request_id;
    END IF;
  END LOOP;

  -- 8. Process each staged item in the request
  FOR v_req_item IN
    SELECT * FROM public.t_request_items
    WHERE request_id = p_request_id AND coalesce(issued_qty, 0) > 0
  LOOP
    v_staged_qty := v_req_item.issued_qty;
    v_total_staged := v_total_staged + v_staged_qty;
    v_accepted_qty := NULL;

    -- Match accepted_qty from payload
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_accepted_items)
    LOOP
      IF (v_elem ->> 'request_item_id')::uuid = v_req_item.request_item_id THEN
        v_accepted_qty := (v_elem ->> 'accepted_qty')::numeric;
        EXIT;
      END IF;
    END LOOP;

    -- If not specified in payload, accepted_qty defaults to 0 (runner declined this line)
    IF v_accepted_qty IS NULL THEN
      v_accepted_qty := 0;
    END IF;

    IF v_accepted_qty < 0 THEN
      RAISE EXCEPTION 'Accepted quantity (%) cannot be negative for item %.', v_accepted_qty, v_req_item.request_item_id;
    END IF;

    IF v_accepted_qty > v_staged_qty THEN
      RAISE EXCEPTION 'Accepted quantity (%) cannot exceed staged quantity (%) for item %.', v_accepted_qty, v_staged_qty, v_req_item.request_item_id;
    END IF;

    IF v_accepted_qty < v_staged_qty THEN
      v_has_partial := true;
    END IF;

    v_total_accepted := v_total_accepted + v_accepted_qty;

    -- Retrieve staging metadata from ISSUE_PENDING movement
    SELECT warehouse_id, batch_number, expiry_date, uom
    INTO v_wh_id, v_batch_number, v_expiry_date, v_uom
    FROM public.t_stock_movements
    WHERE reference_doc_id = p_request_id::text
      AND item_code = v_req_item.item_code
      AND movement_type = 'ISSUE_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_wh_id IS NULL THEN
      SELECT warehouse_id INTO v_wh_id FROM public.m_warehouses WHERE store_id = v_req.store_id LIMIT 1;
    END IF;
    IF v_uom IS NULL THEN
      v_uom := v_req_item.uom;
    END IF;

    -- Append append-only movements:
    -- 1. ISSUE_PENDING_OFFSET with +staged_qty (clears the staged reservation)
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
      gen_random_uuid(),
      v_req.store_id,
      v_wh_id,
      v_req_item.item_code,
      'ISSUE_PENDING_OFFSET',
      abs(v_staged_qty),
      v_uom,
      v_batch_number,
      v_expiry_date,
      p_request_id::text,
      v_movement_user_id,
      now()
    );

    -- 2. ISSUE_CONFIRMED with -accepted_qty (books confirmed reduction if > 0)
    IF v_accepted_qty > 0 THEN
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
        gen_random_uuid(),
        v_req.store_id,
        v_wh_id,
        v_req_item.item_code,
        'ISSUE_CONFIRMED',
        -abs(v_accepted_qty),
        v_uom,
        v_batch_number,
        v_expiry_date,
        p_request_id::text,
        v_movement_user_id,
        now()
      );
    END IF;

    -- Handle variance reason
    v_variance_reason := NULL;
    IF p_variance_reasons IS NOT NULL THEN
      IF jsonb_typeof(p_variance_reasons) = 'object' THEN
        v_variance_reason := p_variance_reasons ->> v_req_item.request_item_id::text;
      ELSIF jsonb_typeof(p_variance_reasons) = 'array' THEN
        SELECT vr ->> 'variance_reason' INTO v_variance_reason
        FROM jsonb_array_elements(p_variance_reasons) vr
        WHERE (vr ->> 'request_item_id')::uuid = v_req_item.request_item_id
        LIMIT 1;
      ELSIF jsonb_typeof(p_variance_reasons) = 'string' THEN
        v_variance_reason := p_variance_reasons #>> '{}';
      END IF;
    END IF;

    IF v_variance_reason IS NOT NULL AND length(trim(v_variance_reason)) > 0 THEN
      UPDATE public.t_request_items
      SET variance_reason = trim(v_variance_reason)
      WHERE request_item_id = v_req_item.request_item_id;
    END IF;
  END LOOP;

  -- 9. Resolve runner foreign key for auth.users
  v_runner_uuid := NULL;
  IF v_caller_uuid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_caller_uuid) THEN
      v_runner_uuid := v_caller_uuid;
    END IF;
  END IF;

  -- 10. Advance request status to CONFIRMED, PARTIAL_ACCEPTED, or PARTIAL_DECLINED
  IF v_total_accepted = 0 THEN
    UPDATE public.t_requests
    SET status = 'PARTIAL_DECLINED',
        runner_user_id = v_runner_uuid,
        runner_confirmed_at = now(),
        updated_at = now()
    WHERE request_id = p_request_id;
  ELSIF v_has_partial THEN
    UPDATE public.t_requests
    SET status = 'PARTIAL_ACCEPTED',
        runner_user_id = v_runner_uuid,
        runner_confirmed_at = now(),
        updated_at = now()
    WHERE request_id = p_request_id;
  ELSE
    UPDATE public.t_requests
    SET status = 'CONFIRMED',
        runner_user_id = v_runner_uuid,
        runner_confirmed_at = now(),
        updated_at = now()
    WHERE request_id = p_request_id;
  END IF;
END;
$$;


-- ============================================================================
-- 3. STORED PROCEDURE: decline_issue
-- ============================================================================
-- Runner declines all goods at storeroom door.
-- Items are physically returned to storeroom shelf.
-- Enforces segregation of duties: Runner cannot be the staging keeper.
-- Appends ISSUE_REVERSAL with +staged_qty to t_stock_movements.
-- Sets t_requests.status = 'PARTIAL_DECLINED', runner_user_id = caller, runner_confirmed_at = now().

CREATE OR REPLACE FUNCTION public.decline_issue(
  p_request_id uuid,
  p_decline_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req public.t_requests%ROWTYPE;
  v_raw_id text;
  v_caller_uuid uuid;
  v_movement_user_id text;
  v_runner_uuid uuid;
  v_staged_by text;
  v_item public.t_request_items%ROWTYPE;
  v_wh_id text;
  v_batch_number text;
  v_expiry_date date;
  v_uom text;
BEGIN
  -- 1. Fetch and lock request
  SELECT * INTO v_req
  FROM public.t_requests
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found.', p_request_id;
  END IF;

  -- 2. State machine check: must be in AWAITING_RUNNER status
  IF v_req.status != 'AWAITING_RUNNER' THEN
    RAISE EXCEPTION 'Cannot decline issue: request is in status %, expected AWAITING_RUNNER.', v_req.status;
  END IF;

  -- 3. Store scope check
  IF current_store_id() IS NOT NULL AND current_store_id() != v_req.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, request store is %.', current_store_id(), v_req.store_id;
  END IF;

  -- 4. Decline reason validation
  IF p_decline_reason IS NULL OR length(trim(p_decline_reason)) = 0 THEN
    RAISE EXCEPTION 'Decline reason is required.';
  END IF;

  -- 5. Resolve caller user context
  v_raw_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );

  BEGIN
    IF v_raw_id IS NOT NULL THEN
      v_caller_uuid := v_raw_id::uuid;
    ELSE
      v_caller_uuid := auth.uid();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_caller_uuid := auth.uid();
  END;

  SELECT user_id INTO v_movement_user_id
  FROM public.m_users
  WHERE user_id = v_raw_id
     OR user_id = coalesce(v_caller_uuid::text, '')
  LIMIT 1;

  IF v_movement_user_id IS NULL AND v_caller_uuid IS NOT NULL THEN
    SELECT u.user_id INTO v_movement_user_id
    FROM public.m_users u
    JOIN auth.users a ON a.email = u.email
    WHERE a.id = v_caller_uuid
    LIMIT 1;
  END IF;

  IF v_movement_user_id IS NULL THEN
    v_movement_user_id := coalesce(v_raw_id, v_caller_uuid::text);
  END IF;

  IF v_movement_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No active user context found in session.';
  END IF;

  -- 6. Segregation of duties enforcement
  SELECT created_by_user_id INTO v_staged_by
  FROM public.t_stock_movements
  WHERE reference_doc_id = p_request_id::text
    AND movement_type = 'ISSUE_PENDING'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_staged_by IS NOT NULL AND NOT has_role('SYSTEM_ADMIN') THEN
    IF v_staged_by = v_movement_user_id
       OR v_staged_by = v_raw_id
       OR (v_caller_uuid IS NOT NULL AND v_staged_by = v_caller_uuid::text)
    THEN
      RAISE EXCEPTION 'Segregation of duties violation: Staging keeper cannot decline their own issue.';
    END IF;
  END IF;

  -- 7. Role Check: Runner or System Admin
  IF NOT (
    has_role('RUNNER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Kitchen Runner can decline issue.';
  END IF;

  -- 8. Loop over all staged items with issued_qty > 0 and append ISSUE_REVERSAL
  FOR v_item IN
    SELECT * FROM public.t_request_items
    WHERE request_id = p_request_id AND coalesce(issued_qty, 0) > 0
  LOOP
    SELECT warehouse_id, batch_number, expiry_date, uom
    INTO v_wh_id, v_batch_number, v_expiry_date, v_uom
    FROM public.t_stock_movements
    WHERE reference_doc_id = p_request_id::text
      AND item_code = v_item.item_code
      AND movement_type = 'ISSUE_PENDING'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_wh_id IS NULL THEN
      SELECT warehouse_id INTO v_wh_id FROM public.m_warehouses WHERE store_id = v_req.store_id LIMIT 1;
    END IF;
    IF v_uom IS NULL THEN
      v_uom := v_item.uom;
    END IF;

    -- Appends ISSUE_REVERSAL with +staged_qty to restore available shelf stock
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
      gen_random_uuid(),
      v_req.store_id,
      v_wh_id,
      v_item.item_code,
      'ISSUE_REVERSAL',
      abs(v_item.issued_qty),
      v_uom,
      v_batch_number,
      v_expiry_date,
      p_request_id::text,
      v_movement_user_id,
      now()
    );

    -- Record decline explanation in line item variance reason
    UPDATE public.t_request_items
    SET variance_reason = trim(p_decline_reason)
    WHERE request_item_id = v_item.request_item_id;
  END LOOP;

  -- 9. Resolve runner foreign key for auth.users
  v_runner_uuid := NULL;
  IF v_caller_uuid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_caller_uuid) THEN
      v_runner_uuid := v_caller_uuid;
    END IF;
  END IF;

  -- 10. Update request status to PARTIAL_DECLINED
  UPDATE public.t_requests
  SET status = 'PARTIAL_DECLINED',
      runner_user_id = v_runner_uuid,
      runner_confirmed_at = now(),
      updated_at = now()
  WHERE request_id = p_request_id;
END;
$$;


-- ============================================================================
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES FOR ISSUE & CONFIRMATION
-- ============================================================================

-- Ensure RLS is active on t_requests and t_request_items
ALTER TABLE public.t_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_request_items ENABLE ROW LEVEL SECURITY;

-- 4.1 Update policy for t_requests: Keepers staging & Runners confirming door handovers
DROP POLICY IF EXISTS t_requests_update ON public.t_requests;
CREATE POLICY t_requests_update ON public.t_requests
  FOR UPDATE
  TO authenticated
  USING (
    (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    AND (
      -- Requester updating while QUEUED
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

-- 4.2 Update policy for t_request_items: Keepers staging & Runners adding variance reasons
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
          OR (has_role('RUNNER') AND r.status = 'AWAITING_RUNNER')
          OR has_role('SYSTEM_ADMIN')
        )
    )
  );

-- ============================================================================
-- 5. FUNCTION GRANTS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.stage_issue(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_issue(uuid, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_issue(uuid, text) TO authenticated, service_role;
