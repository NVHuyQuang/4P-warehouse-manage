-- Migration 0080: Daily Benchmark Balance, Reconciliation & Flow D Sign-Off
-- Pizza 4P's India Inventory Control Tool (Quantities Only)
-- Flow D: Daily Closing Balance & Top Benchmark Count
-- Non-negotiable: Quantities only. Zero financial, valuation, or commercial data.

-- 1. DAILY BALANCES HEADER TABLE (Flow D)
CREATE TABLE IF NOT EXISTS public.t_daily_balances (
  balance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  balance_date date NOT NULL DEFAULT current_date,
  custodian_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('BALANCED', 'VARIANCE_FLAGGED')),
  is_unexplained boolean NOT NULL DEFAULT false,
  finance_lead_signoff_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signoff_notes text NULL,
  signed_off_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_balance_store_wh_date UNIQUE (store_id, warehouse_id, balance_date)
);

-- 2. DAILY BALANCE LINE ITEMS TABLE (Benchmark Stock Counts & Variances)
CREATE TABLE IF NOT EXISTS public.t_daily_balance_items (
  balance_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES public.t_daily_balances(balance_id) ON DELETE CASCADE,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  opening_qty numeric(12,3) NOT NULL,
  received_qty numeric(12,3) NOT NULL DEFAULT 0,
  issued_qty numeric(12,3) NOT NULL DEFAULT 0,
  expected_qty numeric(12,3) NOT NULL,
  counted_qty numeric(12,3) NOT NULL,
  variance_qty numeric(12,3) NOT NULL,
  variance_reason text NULL,
  responsible_person text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_balance_item UNIQUE (balance_id, item_code),
  CONSTRAINT chk_expected_qty CHECK (expected_qty = opening_qty + received_qty - issued_qty),
  CONSTRAINT chk_variance_qty CHECK (variance_qty = counted_qty - expected_qty)
);

-- 3. INDEXES FOR PERFORMANCE, AUDIT & CRON ESCALATION
CREATE INDEX IF NOT EXISTS idx_daily_balances_store_wh_date
  ON public.t_daily_balances(store_id, warehouse_id, balance_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_balances_status
  ON public.t_daily_balances(status);

CREATE INDEX IF NOT EXISTS idx_daily_balances_custodian
  ON public.t_daily_balances(custodian_user_id);

CREATE INDEX IF NOT EXISTS idx_daily_balances_signoff
  ON public.t_daily_balances(finance_lead_signoff_id);

-- Partial index for morning cron escalation digest query
CREATE INDEX IF NOT EXISTS idx_daily_balances_escalation
  ON public.t_daily_balances(balance_date, status, is_unexplained)
  WHERE status = 'VARIANCE_FLAGGED' AND (finance_lead_signoff_id IS NULL OR is_unexplained = true);

CREATE INDEX IF NOT EXISTS idx_daily_balance_items_balance
  ON public.t_daily_balance_items(balance_id);

CREATE INDEX IF NOT EXISTS idx_daily_balance_items_item
  ON public.t_daily_balance_items(item_code);

-- 4. APPEND-ONLY IMMUTABILITY TRIGGERS
-- 4.1 Balance line items: strictly append-only (no update or delete)
CREATE OR REPLACE FUNCTION public.tg_prevent_daily_balance_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Daily balance items are append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_daily_balance_items_mutation ON public.t_daily_balance_items;
CREATE TRIGGER trg_prevent_daily_balance_items_mutation
  BEFORE UPDATE OR DELETE ON public.t_daily_balance_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_daily_balance_item_mutation();

-- 4.2 Balance header: delete forbidden; update only permitted once for sign-off transition
CREATE OR REPLACE FUNCTION public.tg_prevent_daily_balance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Daily balances cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.signed_off_at IS NOT NULL THEN
      RAISE EXCEPTION 'Daily balance is already signed off and locked from further modification.';
    END IF;

    IF NEW.balance_id != OLD.balance_id OR
       NEW.store_id != OLD.store_id OR
       NEW.warehouse_id != OLD.warehouse_id OR
       NEW.balance_date != OLD.balance_date OR
       NEW.custodian_user_id != OLD.custodian_user_id OR
       NEW.status != OLD.status OR
       NEW.is_unexplained != OLD.is_unexplained OR
       NEW.created_at != OLD.created_at THEN
      RAISE EXCEPTION 'Core daily balance attributes cannot be modified.';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_daily_balance_mutation ON public.t_daily_balances;
CREATE TRIGGER trg_prevent_daily_balance_mutation
  BEFORE UPDATE OR DELETE ON public.t_daily_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_daily_balance_mutation();

-- 5. DERIVED ESCALATION VIEW FOR CRON DIGEST
CREATE OR REPLACE VIEW public.v_daily_balance_escalations
WITH (security_invoker = true)
AS
SELECT
  b.balance_id,
  b.store_id,
  b.warehouse_id,
  b.balance_date,
  b.custodian_user_id,
  b.status,
  b.is_unexplained,
  b.finance_lead_signoff_id,
  b.signoff_notes,
  b.signed_off_at,
  b.created_at,
  COUNT(i.balance_item_id) AS total_items_count,
  COUNT(CASE WHEN i.variance_qty != 0 THEN 1 END) AS variance_items_count
FROM public.t_daily_balances b
LEFT JOIN public.t_daily_balance_items i ON i.balance_id = b.balance_id
WHERE b.status = 'VARIANCE_FLAGGED'
  AND (b.finance_lead_signoff_id IS NULL OR b.is_unexplained = true)
GROUP BY
  b.balance_id,
  b.store_id,
  b.warehouse_id,
  b.balance_date,
  b.custodian_user_id,
  b.status,
  b.is_unexplained,
  b.finance_lead_signoff_id,
  b.signoff_notes,
  b.signed_off_at,
  b.created_at;

-- 6. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.t_daily_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_daily_balance_items ENABLE ROW LEVEL SECURITY;

-- 6.1 t_daily_balances Policies
-- Read: Custodians/Keepers/FL/RM within assigned store; Approver & Viewers across all stores
DROP POLICY IF EXISTS t_daily_balances_select ON public.t_daily_balances;
CREATE POLICY t_daily_balances_select ON public.t_daily_balances
  FOR SELECT
  TO authenticated
  USING (
    (
      (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT'))
      AND (current_store_id() IS NULL OR store_id = current_store_id())
    )
    OR has_role('APPROVER')
    OR has_role('VIEWER')
    OR has_role('SYSTEM_ADMIN')
  );

-- Insert: Custodians/Keepers for their assigned store
DROP POLICY IF EXISTS t_daily_balances_insert ON public.t_daily_balances;
CREATE POLICY t_daily_balances_insert ON public.t_daily_balances
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

-- Update: FL / RM for their store to sign off
DROP POLICY IF EXISTS t_daily_balances_update ON public.t_daily_balances;
CREATE POLICY t_daily_balances_update ON public.t_daily_balances
  FOR UPDATE
  TO authenticated
  USING (
    (
      (has_role('RM') OR has_role('ACCOUNTANT'))
      AND (current_store_id() IS NULL OR store_id = current_store_id())
    )
    OR has_role('APPROVER')
    OR has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    (
      (has_role('RM') OR has_role('ACCOUNTANT'))
      AND (current_store_id() IS NULL OR store_id = current_store_id())
    )
    OR has_role('APPROVER')
    OR has_role('SYSTEM_ADMIN')
  );

-- Delete: Forbidden for all roles
DROP POLICY IF EXISTS t_daily_balances_delete ON public.t_daily_balances;
CREATE POLICY t_daily_balances_delete ON public.t_daily_balances
  FOR DELETE
  TO authenticated
  USING (false);

-- 6.2 t_daily_balance_items Policies
-- Read: Inherits store access of parent balance
DROP POLICY IF EXISTS t_daily_balance_items_select ON public.t_daily_balance_items;
CREATE POLICY t_daily_balance_items_select ON public.t_daily_balance_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.t_daily_balances b
      WHERE b.balance_id = t_daily_balance_items.balance_id
      AND (
        (
          (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT'))
          AND (current_store_id() IS NULL OR b.store_id = current_store_id())
        )
        OR has_role('APPROVER')
        OR has_role('VIEWER')
        OR has_role('SYSTEM_ADMIN')
      )
    )
  );

-- Insert: Custodians/Keepers for their assigned store
DROP POLICY IF EXISTS t_daily_balance_items_insert ON public.t_daily_balance_items;
CREATE POLICY t_daily_balance_items_insert ON public.t_daily_balance_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('SYSTEM_ADMIN'))
    AND EXISTS (
      SELECT 1 FROM public.t_daily_balances b
      WHERE b.balance_id = t_daily_balance_items.balance_id
      AND (current_store_id() IS NULL OR b.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    )
  );

-- Update: Forbidden (Append-only line items)
DROP POLICY IF EXISTS t_daily_balance_items_update ON public.t_daily_balance_items;
CREATE POLICY t_daily_balance_items_update ON public.t_daily_balance_items
  FOR UPDATE
  TO authenticated
  USING (false);

-- Delete: Forbidden
DROP POLICY IF EXISTS t_daily_balance_items_delete ON public.t_daily_balance_items;
CREATE POLICY t_daily_balance_items_delete ON public.t_daily_balance_items
  FOR DELETE
  TO authenticated
  USING (false);

-- 7. SECURITY DEFINER STORED PROCEDURES (RPCs)

-- 7.1 submit_daily_balance
CREATE OR REPLACE FUNCTION public.submit_daily_balance(
  p_store_id text,
  p_warehouse_id text,
  p_items jsonb,
  p_is_unexplained boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_balance_id uuid;
  v_has_variance boolean := false;
  v_status text;
  v_elem jsonb;
  v_item_code text;
  v_opening_qty numeric(12,3);
  v_received_qty numeric(12,3);
  v_issued_qty numeric(12,3);
  v_expected_qty numeric(12,3);
  v_counted_qty numeric(12,3);
  v_variance_qty numeric(12,3);
  v_variance_reason text;
  v_responsible_person text;
  v_seen_items text[] := ARRAY[]::text[];
BEGIN
  -- 1. Authorization: Only Keeper (ADMIN), Custodian (CUSTODIAN), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('CUSTODIAN') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper or Custodian can submit daily balance.';
  END IF;

  -- 2. Store Scope Verification
  IF current_store_id() IS NOT NULL AND current_store_id() != p_store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, requested store is %.', current_store_id(), p_store_id;
  END IF;

  -- 3. Resolve Caller User ID
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

  -- 4. Verify Warehouse exists within Store
  IF NOT EXISTS (
    SELECT 1 FROM public.m_warehouses
    WHERE warehouse_id = p_warehouse_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Warehouse % does not belong to store % or does not exist.', p_warehouse_id, p_store_id;
  END IF;

  -- 5. Prevent duplicate daily balance submission for same (store, warehouse, date)
  IF EXISTS (
    SELECT 1 FROM public.t_daily_balances
    WHERE store_id = p_store_id AND warehouse_id = p_warehouse_id AND balance_date = current_date
  ) THEN
    RAISE EXCEPTION 'Daily balance for store % and warehouse % on date % already exists.', p_store_id, p_warehouse_id, current_date;
  END IF;

  -- 6. Validate items payload
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daily balance items payload must be a non-empty JSON array.';
  END IF;

  -- 7. Validate each item and calculate expected & variance quantities
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_code := trim(v_elem->>'item_code');
    IF v_item_code IS NULL OR v_item_code = '' THEN
      RAISE EXCEPTION 'Each balance item must specify a valid item_code.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.m_items WHERE item_code = v_item_code) THEN
      RAISE EXCEPTION 'Item code % does not exist in m_items.', v_item_code;
    END IF;

    IF v_item_code = ANY(v_seen_items) THEN
      RAISE EXCEPTION 'Duplicate item_code % in balance items payload.', v_item_code;
    END IF;
    v_seen_items := array_append(v_seen_items, v_item_code);

    IF v_elem->>'opening_qty' IS NULL THEN
      RAISE EXCEPTION 'opening_qty is required for item %.', v_item_code;
    END IF;

    IF v_elem->>'counted_qty' IS NULL THEN
      RAISE EXCEPTION 'counted_qty is required for item %.', v_item_code;
    END IF;

    v_opening_qty  := (v_elem->>'opening_qty')::numeric(12,3);
    v_received_qty := coalesce((v_elem->>'received_qty')::numeric(12,3), 0::numeric(12,3));
    v_issued_qty   := coalesce((v_elem->>'issued_qty')::numeric(12,3), 0::numeric(12,3));
    v_counted_qty  := (v_elem->>'counted_qty')::numeric(12,3);

    -- Quantity non-negativity
    IF v_opening_qty < 0 OR v_received_qty < 0 OR v_issued_qty < 0 OR v_counted_qty < 0 THEN
      RAISE EXCEPTION 'Stock quantities for item % cannot be negative.', v_item_code;
    END IF;

    v_expected_qty := v_opening_qty + v_received_qty - v_issued_qty;
    v_variance_qty := v_counted_qty - v_expected_qty;

    -- Check client consistency if explicitly passed
    IF v_elem ? 'expected_qty' AND (v_elem->>'expected_qty')::numeric(12,3) != v_expected_qty THEN
      RAISE EXCEPTION 'Calculated expected_qty mismatch for item %: computed %, supplied %.',
        v_item_code, v_expected_qty, (v_elem->>'expected_qty')::numeric(12,3);
    END IF;

    IF v_elem ? 'variance_qty' AND (v_elem->>'variance_qty')::numeric(12,3) != v_variance_qty THEN
      RAISE EXCEPTION 'Calculated variance_qty mismatch for item %: computed %, supplied %.',
        v_item_code, v_variance_qty, (v_elem->>'variance_qty')::numeric(12,3);
    END IF;

    IF v_variance_qty != 0 THEN
      v_has_variance := true;
    END IF;
  END LOOP;

  -- 8. Derive Daily Balance Status
  IF v_has_variance THEN
    v_status := 'VARIANCE_FLAGGED';
  ELSE
    v_status := 'BALANCED';
  END IF;

  -- 9. Insert Header Record
  v_balance_id := gen_random_uuid();
  INSERT INTO public.t_daily_balances (
    balance_id,
    store_id,
    warehouse_id,
    balance_date,
    custodian_user_id,
    status,
    is_unexplained,
    finance_lead_signoff_id,
    signoff_notes,
    signed_off_at,
    created_at
  ) VALUES (
    v_balance_id,
    p_store_id,
    p_warehouse_id,
    current_date,
    v_caller_id,
    v_status,
    CASE WHEN v_status = 'VARIANCE_FLAGGED' THEN p_is_unexplained ELSE false END,
    NULL,
    NULL,
    NULL,
    now()
  );

  -- 10. Insert Item Records
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_code          := trim(v_elem->>'item_code');
    v_opening_qty        := (v_elem->>'opening_qty')::numeric(12,3);
    v_received_qty       := coalesce((v_elem->>'received_qty')::numeric(12,3), 0::numeric(12,3));
    v_issued_qty         := coalesce((v_elem->>'issued_qty')::numeric(12,3), 0::numeric(12,3));
    v_counted_qty        := (v_elem->>'counted_qty')::numeric(12,3);
    v_expected_qty       := v_opening_qty + v_received_qty - v_issued_qty;
    v_variance_qty       := v_counted_qty - v_expected_qty;
    v_variance_reason    := nullif(trim(v_elem->>'variance_reason'), '');
    v_responsible_person := nullif(trim(v_elem->>'responsible_person'), '');

    INSERT INTO public.t_daily_balance_items (
      balance_item_id,
      balance_id,
      item_code,
      opening_qty,
      received_qty,
      issued_qty,
      expected_qty,
      counted_qty,
      variance_qty,
      variance_reason,
      responsible_person,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_balance_id,
      v_item_code,
      v_opening_qty,
      v_received_qty,
      v_issued_qty,
      v_expected_qty,
      v_counted_qty,
      v_variance_qty,
      v_variance_reason,
      v_responsible_person,
      now()
    );
  END LOOP;

  RETURN v_balance_id;
END;
$$;

-- 7.2 sign_off_daily_balance
CREATE OR REPLACE FUNCTION public.sign_off_daily_balance(
  p_balance_id uuid,
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
  v_balance record;
BEGIN
  -- 1. Authorization: FL (ACCOUNTANT / APPROVER), RM, or SYSTEM_ADMIN only
  IF NOT (
    has_role('RM') OR
    has_role('ACCOUNTANT') OR
    has_role('APPROVER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Finance Lead or Restaurant Manager can sign off daily balance.';
  END IF;

  -- 2. Resolve caller user ID
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

  -- 3. Fetch balance record
  SELECT * INTO v_balance
  FROM public.t_daily_balances
  WHERE balance_id = p_balance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Daily balance record % does not exist.', p_balance_id;
  END IF;

  -- 4. Store scope verification
  IF current_store_id() IS NOT NULL AND current_store_id() != v_balance.store_id AND NOT has_role('SYSTEM_ADMIN') AND NOT has_role('APPROVER') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, balance store is %.', current_store_id(), v_balance.store_id;
  END IF;

  -- 5. Already signed off check
  IF v_balance.signed_off_at IS NOT NULL OR v_balance.finance_lead_signoff_id IS NOT NULL THEN
    RAISE EXCEPTION 'Daily balance % has already been signed off.', p_balance_id;
  END IF;

  -- 6. Segregation of duties: cannot be same as custodian if variance exists
  IF (v_balance.status = 'VARIANCE_FLAGGED' OR EXISTS (
    SELECT 1 FROM public.t_daily_balance_items
    WHERE balance_id = p_balance_id AND variance_qty != 0
  )) AND v_balance.custodian_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Segregation violation: Sign-off user cannot be the same as custodian when variance exists.';
  END IF;

  -- 7. Update sign-off
  UPDATE public.t_daily_balances
  SET finance_lead_signoff_id = v_caller_id,
      signoff_notes = nullif(trim(p_notes), ''),
      signed_off_at = now()
  WHERE balance_id = p_balance_id;
END;
$$;

-- 8. PERMISSIONS & GRANTS
REVOKE DELETE ON public.t_daily_balances FROM PUBLIC, authenticated;
REVOKE UPDATE, DELETE ON public.t_daily_balance_items FROM PUBLIC, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.t_daily_balances TO authenticated;
GRANT SELECT, INSERT ON public.t_daily_balance_items TO authenticated;
GRANT ALL ON public.t_daily_balances TO service_role;
GRANT ALL ON public.t_daily_balance_items TO service_role;

GRANT SELECT ON public.v_daily_balance_escalations TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.submit_daily_balance(text, text, jsonb, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sign_off_daily_balance(uuid, text) TO authenticated, service_role;
