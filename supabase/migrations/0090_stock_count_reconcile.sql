-- Migration 0090: Physical Stock Count & Reconciliation
-- Pizza 4P's India Inventory Control Tool (Quantities Only)
-- Flow F: Periodic Stock Count (Weekly Cycle & Month-End Full), Recount, and FC Reconciliation
-- Non-negotiable: Quantities only. Zero financial or commercial data.
-- Append-only: Stock adjustments append COUNT_ADJUSTMENT rows to t_stock_movements; never mutate ledger.

-- 1. PHYSICAL STOCK COUNTS HEADER TABLE (Flow F)
CREATE TABLE IF NOT EXISTS public.t_stock_counts (
  count_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  count_type text NOT NULL CHECK (count_type IN ('WEEKLY_CYCLE', 'MONTH_END_FULL')),
  freeze_status text NOT NULL CHECK (freeze_status IN ('FROZEN', 'UNFROZEN')) DEFAULT 'FROZEN',
  keeper_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  accountant_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'RECOUNT', 'COMPLETED')) DEFAULT 'IN_PROGRESS',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

-- 2. STOCK COUNT LINE ITEMS TABLE (Flow F Blind Count & Comparison)
CREATE TABLE IF NOT EXISTS public.t_stock_count_items (
  count_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.t_stock_counts(count_id) ON DELETE CASCADE,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  book_qty numeric(12,3) NOT NULL,
  first_count_qty numeric(12,3) NULL,
  recount_qty numeric(12,3) NULL,
  final_counted_qty numeric(12,3) NULL,
  difference_qty numeric(12,3) NULL,
  uom text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_count_item UNIQUE (count_id, item_code)
);

-- 3. STOCK ADJUSTMENTS VOUCHER TABLE (Flow F FC Authorized Write-Offs & Adjustments)
CREATE TABLE IF NOT EXISTS public.t_stock_adjustments (
  adjustment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.t_stock_counts(count_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  adjustment_qty numeric(12,3) NOT NULL,
  root_cause_reason text NOT NULL,
  fc_approval_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  movement_id uuid NULL REFERENCES public.t_stock_movements(movement_id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_adjustment_reason CHECK (length(trim(root_cause_reason)) > 0),
  CONSTRAINT chk_stock_adjustment_qty_nonzero CHECK (adjustment_qty != 0)
);

-- 4. PERFORMANCE & AUDIT INDEXES
CREATE INDEX IF NOT EXISTS idx_stock_counts_store_wh ON public.t_stock_counts(store_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON public.t_stock_counts(status);
CREATE INDEX IF NOT EXISTS idx_stock_counts_created_at ON public.t_stock_counts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_counts_keeper ON public.t_stock_counts(keeper_user_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_accountant ON public.t_stock_counts(accountant_user_id);

CREATE INDEX IF NOT EXISTS idx_stock_count_items_count_id ON public.t_stock_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_item ON public.t_stock_count_items(item_code);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_count ON public.t_stock_adjustments(count_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_wh_item ON public.t_stock_adjustments(warehouse_id, item_code);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_fc ON public.t_stock_adjustments(fc_approval_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_movement ON public.t_stock_adjustments(movement_id);

-- 5. SEGREGATION OF DUTIES ENFORCEMENT TRIGGER
-- Rule: Counter cannot approve adjustment voucher (fc_approval_id cannot equal keeper_user_id or accountant_user_id)
CREATE OR REPLACE FUNCTION public.tg_enforce_stock_adjustment_sod()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_keeper_id uuid;
  v_accountant_id uuid;
BEGIN
  SELECT keeper_user_id, accountant_user_id
  INTO v_keeper_id, v_accountant_id
  FROM public.t_stock_counts
  WHERE count_id = NEW.count_id;

  IF NEW.fc_approval_id = v_keeper_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  IF v_accountant_id IS NOT NULL AND NEW.fc_approval_id = v_accountant_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_stock_adjustment_sod ON public.t_stock_adjustments;
CREATE TRIGGER trg_enforce_stock_adjustment_sod
  BEFORE INSERT OR UPDATE ON public.t_stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_stock_adjustment_sod();

-- 6. IMMUTABILITY TRIGGER FOR POSTED STOCK ADJUSTMENTS
-- Once movement_id is assigned (ledger posted), adjustment records cannot be mutated or deleted
CREATE OR REPLACE FUNCTION public.tg_prevent_approved_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'Approved stock adjustments are immutable and cannot be deleted.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'Approved stock adjustments are immutable and cannot be updated.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_approved_adjustment_mutation ON public.t_stock_adjustments;
CREATE TRIGGER trg_prevent_approved_adjustment_mutation
  BEFORE UPDATE OR DELETE ON public.t_stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_approved_adjustment_mutation();

-- 7. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.t_stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_stock_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_stock_adjustments ENABLE ROW LEVEL SECURITY;

-- 7.1 t_stock_counts policies
DROP POLICY IF EXISTS t_stock_counts_select ON public.t_stock_counts;
CREATE POLICY t_stock_counts_select ON public.t_stock_counts
  FOR SELECT
  TO authenticated
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('APPROVER')
    OR has_role('VIEWER')
  );

DROP POLICY IF EXISTS t_stock_counts_insert ON public.t_stock_counts;
CREATE POLICY t_stock_counts_insert ON public.t_stock_counts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS t_stock_counts_update ON public.t_stock_counts;
CREATE POLICY t_stock_counts_update ON public.t_stock_counts
  FOR UPDATE
  TO authenticated
  USING (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  )
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS t_stock_counts_delete ON public.t_stock_counts;
CREATE POLICY t_stock_counts_delete ON public.t_stock_counts
  FOR DELETE
  TO authenticated
  USING (false);

-- 7.2 t_stock_count_items policies
DROP POLICY IF EXISTS t_stock_count_items_select ON public.t_stock_count_items;
CREATE POLICY t_stock_count_items_select ON public.t_stock_count_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.t_stock_counts c
      WHERE c.count_id = t_stock_count_items.count_id
        AND (
          current_store_id() IS NULL
          OR c.store_id = current_store_id()
          OR has_role('SYSTEM_ADMIN')
          OR has_role('APPROVER')
          OR has_role('VIEWER')
        )
    )
  );

DROP POLICY IF EXISTS t_stock_count_items_insert ON public.t_stock_count_items;
CREATE POLICY t_stock_count_items_insert ON public.t_stock_count_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT') OR has_role('SYSTEM_ADMIN'))
    AND EXISTS (
      SELECT 1 FROM public.t_stock_counts c
      WHERE c.count_id = t_stock_count_items.count_id
        AND (current_store_id() IS NULL OR c.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    )
  );

DROP POLICY IF EXISTS t_stock_count_items_update ON public.t_stock_count_items;
CREATE POLICY t_stock_count_items_update ON public.t_stock_count_items
  FOR UPDATE
  TO authenticated
  USING (
    (has_role('ADMIN') OR has_role('CUSTODIAN') OR has_role('RM') OR has_role('ACCOUNTANT') OR has_role('SYSTEM_ADMIN'))
    AND EXISTS (
      SELECT 1 FROM public.t_stock_counts c
      WHERE c.count_id = t_stock_count_items.count_id
        AND (current_store_id() IS NULL OR c.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    )
  );

DROP POLICY IF EXISTS t_stock_count_items_delete ON public.t_stock_count_items;
CREATE POLICY t_stock_count_items_delete ON public.t_stock_count_items
  FOR DELETE
  TO authenticated
  USING (false);

-- 7.3 t_stock_adjustments policies
DROP POLICY IF EXISTS t_stock_adjustments_select ON public.t_stock_adjustments;
CREATE POLICY t_stock_adjustments_select ON public.t_stock_adjustments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.t_stock_counts c
      WHERE c.count_id = t_stock_adjustments.count_id
        AND (
          current_store_id() IS NULL
          OR c.store_id = current_store_id()
          OR has_role('SYSTEM_ADMIN')
          OR has_role('APPROVER')
          OR has_role('VIEWER')
        )
    )
  );

DROP POLICY IF EXISTS t_stock_adjustments_insert ON public.t_stock_adjustments;
CREATE POLICY t_stock_adjustments_insert ON public.t_stock_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ACCOUNTANT') OR has_role('ADMIN') OR has_role('RM') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
    AND EXISTS (
      SELECT 1 FROM public.t_stock_counts c
      WHERE c.count_id = t_stock_adjustments.count_id
        AND (current_store_id() IS NULL OR c.store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
    )
  );

DROP POLICY IF EXISTS t_stock_adjustments_update ON public.t_stock_adjustments;
CREATE POLICY t_stock_adjustments_update ON public.t_stock_adjustments
  FOR UPDATE
  TO authenticated
  USING (
    has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS t_stock_adjustments_delete ON public.t_stock_adjustments;
CREATE POLICY t_stock_adjustments_delete ON public.t_stock_adjustments
  FOR DELETE
  TO authenticated
  USING (false);

-- 8. STORED PROCEDURES (RPCS)

-- 8.1 initiate_stock_count
-- Initiates periodic count, freezes warehouse storeroom, snapshots current book stock
CREATE OR REPLACE FUNCTION public.initiate_stock_count(
  p_store_id text,
  p_warehouse_id text,
  p_count_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_raw_id text;
  v_count_id uuid;
BEGIN
  -- 1. Authorization: Keeper (ADMIN), Custodian (CUSTODIAN), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('CUSTODIAN') OR
    has_role('RM') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper, Custodian, RM, or SYSTEM_ADMIN can initiate a stock count.';
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

  -- 4. Validate Count Type
  IF p_count_type NOT IN ('WEEKLY_CYCLE', 'MONTH_END_FULL') THEN
    RAISE EXCEPTION 'Invalid count_type: %. Must be WEEKLY_CYCLE or MONTH_END_FULL.', p_count_type;
  END IF;

  -- 5. Verify Warehouse exists within Store
  IF NOT EXISTS (
    SELECT 1 FROM public.m_warehouses
    WHERE warehouse_id = p_warehouse_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Warehouse % does not belong to store % or does not exist.', p_warehouse_id, p_store_id;
  END IF;

  -- 6. Check for active count in progress for this warehouse
  IF EXISTS (
    SELECT 1 FROM public.t_stock_counts
    WHERE warehouse_id = p_warehouse_id
      AND status IN ('IN_PROGRESS', 'RECOUNT')
  ) THEN
    RAISE EXCEPTION 'An active stock count is already in progress for warehouse %.', p_warehouse_id;
  END IF;

  -- 7. Freeze warehouse status
  UPDATE public.m_warehouses
  SET status = 'FROZEN_FOR_COUNT'::warehouse_status,
      updated_at = now()
  WHERE warehouse_id = p_warehouse_id;

  -- 8. Insert count header
  v_count_id := gen_random_uuid();
  INSERT INTO public.t_stock_counts (
    count_id,
    store_id,
    warehouse_id,
    count_type,
    freeze_status,
    keeper_user_id,
    accountant_user_id,
    status,
    created_at,
    completed_at
  ) VALUES (
    v_count_id,
    p_store_id,
    p_warehouse_id,
    p_count_type,
    'FROZEN',
    v_caller_id,
    NULL,
    'IN_PROGRESS',
    now(),
    NULL
  );

  -- 9. Snapshot current stock items from v_stock_current into t_stock_count_items
  INSERT INTO public.t_stock_count_items (
    count_item_id,
    count_id,
    item_code,
    book_qty,
    first_count_qty,
    recount_qty,
    final_counted_qty,
    difference_qty,
    uom,
    created_at
  )
  SELECT
    gen_random_uuid(),
    v_count_id,
    i.item_code,
    COALESCE(sc.book_stock, 0)::numeric(12,3),
    NULL,
    NULL,
    NULL,
    NULL,
    i.base_uom,
    now()
  FROM public.m_items i
  LEFT JOIN public.v_stock_current sc
    ON sc.item_code = i.item_code
   AND sc.store_id = p_store_id
   AND sc.warehouse_id = p_warehouse_id
  WHERE i.is_active = true
    AND (
      p_count_type = 'MONTH_END_FULL'
      OR COALESCE(sc.book_stock, 0) != 0
    )
  ON CONFLICT (count_id, item_code) DO NOTHING;

  RETURN v_count_id;
END;
$$;

-- 8.2 submit_first_count
-- Blind first count: keeper submits physical quantities without seeing book stock in UI
-- If difference == 0: completes count, lifts freeze
-- If difference != 0: transitions to RECOUNT
CREATE OR REPLACE FUNCTION public.submit_first_count(
  p_count_id uuid,
  p_counts jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_count record;
  v_elem jsonb;
  v_item_code text;
  v_qty numeric(12,3);
  v_book_qty numeric(12,3);
  v_uom text;
  v_has_diff boolean;
BEGIN
  -- 1. Authorization: Keeper (ADMIN), Custodian (CUSTODIAN), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ADMIN') OR
    has_role('CUSTODIAN') OR
    has_role('RM') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Keeper, Custodian, RM, or SYSTEM_ADMIN can submit first count.';
  END IF;

  -- 2. Validate Count existence and status
  SELECT * INTO v_count
  FROM public.t_stock_counts
  WHERE count_id = p_count_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock count % not found.', p_count_id;
  END IF;

  IF v_count.status != 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Stock count % is not IN_PROGRESS (current status: %).', p_count_id, v_count.status;
  END IF;

  -- 3. Store Scope Verification
  IF current_store_id() IS NOT NULL AND current_store_id() != v_count.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, count store is %.', current_store_id(), v_count.store_id;
  END IF;

  -- 4. Process count quantities
  IF p_counts IS NULL THEN
    RAISE EXCEPTION 'Count data cannot be null.';
  END IF;

  IF jsonb_typeof(p_counts) = 'array' THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_counts)
    LOOP
      v_item_code := v_elem->>'item_code';
      v_qty := (coalesce(v_elem->>'first_count_qty', v_elem->>'counted_qty', v_elem->>'qty'))::numeric(12,3);
      
      IF v_item_code IS NULL THEN
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.t_stock_count_items
        WHERE count_id = p_count_id AND item_code = v_item_code
      ) THEN
        UPDATE public.t_stock_count_items
        SET first_count_qty = v_qty,
            final_counted_qty = v_qty,
            difference_qty = (v_qty - book_qty)
        WHERE count_id = p_count_id AND item_code = v_item_code;
      ELSE
        SELECT COALESCE(sc.book_stock, 0)::numeric(12,3) INTO v_book_qty
        FROM public.v_stock_current sc
        WHERE sc.store_id = v_count.store_id
          AND sc.warehouse_id = v_count.warehouse_id
          AND sc.item_code = v_item_code;

        IF v_book_qty IS NULL THEN
          v_book_qty := 0.000;
        END IF;

        SELECT base_uom INTO v_uom FROM public.m_items WHERE item_code = v_item_code;
        IF v_uom IS NULL THEN
          v_uom := 'kg';
        END IF;

        INSERT INTO public.t_stock_count_items (
          count_item_id, count_id, item_code, book_qty, first_count_qty, recount_qty, final_counted_qty, difference_qty, uom
        ) VALUES (
          gen_random_uuid(), p_count_id, v_item_code, v_book_qty, v_qty, NULL, v_qty, (v_qty - v_book_qty), v_uom
        );
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_counts) = 'object' THEN
    FOR v_item_code, v_elem IN SELECT key, value FROM jsonb_each(p_counts)
    LOOP
      IF jsonb_typeof(v_elem) = 'object' THEN
        v_qty := (coalesce(v_elem->>'first_count_qty', v_elem->>'counted_qty', v_elem->>'qty'))::numeric(12,3);
      ELSE
        v_qty := (v_elem #>> '{}')::numeric(12,3);
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.t_stock_count_items
        WHERE count_id = p_count_id AND item_code = v_item_code
      ) THEN
        UPDATE public.t_stock_count_items
        SET first_count_qty = v_qty,
            final_counted_qty = v_qty,
            difference_qty = (v_qty - book_qty)
        WHERE count_id = p_count_id AND item_code = v_item_code;
      ELSE
        SELECT COALESCE(sc.book_stock, 0)::numeric(12,3) INTO v_book_qty
        FROM public.v_stock_current sc
        WHERE sc.store_id = v_count.store_id
          AND sc.warehouse_id = v_count.warehouse_id
          AND sc.item_code = v_item_code;

        IF v_book_qty IS NULL THEN
          v_book_qty := 0.000;
        END IF;

        SELECT base_uom INTO v_uom FROM public.m_items WHERE item_code = v_item_code;
        IF v_uom IS NULL THEN
          v_uom := 'kg';
        END IF;

        INSERT INTO public.t_stock_count_items (
          count_item_id, count_id, item_code, book_qty, first_count_qty, recount_qty, final_counted_qty, difference_qty, uom
        ) VALUES (
          gen_random_uuid(), p_count_id, v_item_code, v_book_qty, v_qty, NULL, v_qty, (v_qty - v_book_qty), v_uom
        );
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Invalid counts format: must be JSON array or object.';
  END IF;

  -- 5. Evaluate discrepancies
  SELECT bool_or(difference_qty != 0) INTO v_has_diff
  FROM public.t_stock_count_items
  WHERE count_id = p_count_id AND first_count_qty IS NOT NULL;

  IF coalesce(v_has_diff, false) = false THEN
    -- Diff == 0: Count balanced! Complete and lift freeze
    UPDATE public.t_stock_counts
    SET status = 'COMPLETED',
        freeze_status = 'UNFROZEN',
        completed_at = now()
    WHERE count_id = p_count_id;

    UPDATE public.m_warehouses
    SET status = 'ACTIVE'::warehouse_status,
        updated_at = now()
    WHERE warehouse_id = v_count.warehouse_id;
  ELSE
    -- Diff != 0: Discrepancy detected -> transition to RECOUNT
    UPDATE public.t_stock_counts
    SET status = 'RECOUNT'
    WHERE count_id = p_count_id;
  END IF;
END;
$$;

-- 8.3 submit_recount
-- Recount conducted by second person (Accountant)
-- If recount resolves discrepancy (difference == 0), count is completed and freeze lifted
-- If recount confirms discrepancy, count remains in RECOUNT awaiting FC adjustment voucher
CREATE OR REPLACE FUNCTION public.submit_recount(
  p_count_id uuid,
  p_counts jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_count record;
  v_caller_id uuid;
  v_raw_id text;
  v_elem jsonb;
  v_item_code text;
  v_qty numeric(12,3);
  v_has_diff boolean;
BEGIN
  -- 1. Authorization: Accountant (ACCOUNTANT), RM (RM), or SYSTEM_ADMIN
  IF NOT (
    has_role('ACCOUNTANT') OR
    has_role('RM') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Store Accountant, RM, or SYSTEM_ADMIN can submit recount.';
  END IF;

  -- 2. Validate Count existence and status
  SELECT * INTO v_count
  FROM public.t_stock_counts
  WHERE count_id = p_count_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock count % not found.', p_count_id;
  END IF;

  IF v_count.status != 'RECOUNT' THEN
    RAISE EXCEPTION 'Stock count % is not in RECOUNT status (current status: %).', p_count_id, v_count.status;
  END IF;

  -- 3. Resolve caller (accountant) user ID
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

  IF v_caller_id IS NOT NULL THEN
    UPDATE public.t_stock_counts
    SET accountant_user_id = v_caller_id
    WHERE count_id = p_count_id;
  END IF;

  -- 4. Store Scope Verification
  IF current_store_id() IS NOT NULL AND current_store_id() != v_count.store_id AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Store scope mismatch. Active store is %, count store is %.', current_store_id(), v_count.store_id;
  END IF;

  -- 5. Process recount quantities
  IF p_counts IS NULL THEN
    RAISE EXCEPTION 'Recount data cannot be null.';
  END IF;

  IF jsonb_typeof(p_counts) = 'array' THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_counts)
    LOOP
      v_item_code := v_elem->>'item_code';
      v_qty := (coalesce(v_elem->>'recount_qty', v_elem->>'counted_qty', v_elem->>'qty'))::numeric(12,3);

      IF v_item_code IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.t_stock_count_items
      SET recount_qty = v_qty,
          final_counted_qty = v_qty,
          difference_qty = (v_qty - book_qty)
      WHERE count_id = p_count_id AND item_code = v_item_code;
    END LOOP;
  ELSIF jsonb_typeof(p_counts) = 'object' THEN
    FOR v_item_code, v_elem IN SELECT key, value FROM jsonb_each(p_counts)
    LOOP
      IF jsonb_typeof(v_elem) = 'object' THEN
        v_qty := (coalesce(v_elem->>'recount_qty', v_elem->>'counted_qty', v_elem->>'qty'))::numeric(12,3);
      ELSE
        v_qty := (v_elem #>> '{}')::numeric(12,3);
      END IF;

      UPDATE public.t_stock_count_items
      SET recount_qty = v_qty,
          final_counted_qty = v_qty,
          difference_qty = (v_qty - book_qty)
      WHERE count_id = p_count_id AND item_code = v_item_code;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Invalid counts format: must be JSON array or object.';
  END IF;

  -- 6. Evaluate if recount resolved all discrepancies
  SELECT bool_or(difference_qty != 0) INTO v_has_diff
  FROM public.t_stock_count_items
  WHERE count_id = p_count_id;

  IF coalesce(v_has_diff, false) = false THEN
    -- Recount resolved all differences! Balanced sheet signed.
    UPDATE public.t_stock_counts
    SET status = 'COMPLETED',
        freeze_status = 'UNFROZEN',
        completed_at = now()
    WHERE count_id = p_count_id;

    UPDATE public.m_warehouses
    SET status = 'ACTIVE'::warehouse_status,
        updated_at = now()
    WHERE warehouse_id = v_count.warehouse_id;
  ELSE
    -- Discrepancy confirmed by recount. Remains in RECOUNT awaiting FC adjustment approval.
    NULL;
  END IF;
END;
$$;

-- 8.4 approve_stock_adjustment
-- FC approves adjustment voucher; RPC appends COUNT_ADJUSTMENT to t_stock_movements, unfreezes warehouse, completes count
CREATE OR REPLACE FUNCTION public.approve_stock_adjustment(
  p_adjustment_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_adj record;
  v_count record;
  v_caller_id uuid;
  v_raw_id text;
  v_movement_id uuid;
  v_uom text;
  v_m_user_id text;
BEGIN
  -- 1. Authorization: Only Financial Controller (APPROVER) or SYSTEM_ADMIN
  IF NOT (
    has_role('APPROVER') OR
    has_role('SYSTEM_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only Financial Controller (APPROVER) or SYSTEM_ADMIN can approve stock adjustments.';
  END IF;

  -- 2. Resolve Caller User ID (UUID)
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

  -- 3. Lookup adjustment voucher
  SELECT * INTO v_adj
  FROM public.t_stock_adjustments
  WHERE adjustment_id = p_adjustment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock adjustment voucher % not found.', p_adjustment_id;
  END IF;

  -- 4. Check if already approved
  IF v_adj.movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Stock adjustment voucher % has already been approved (movement %)', p_adjustment_id, v_adj.movement_id;
  END IF;

  -- 5. Lookup parent count
  SELECT * INTO v_count
  FROM public.t_stock_counts
  WHERE count_id = v_adj.count_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent stock count % not found.', v_adj.count_id;
  END IF;

  -- 6. Segregation of Duties Enforcement: Counter cannot approve adjustment voucher
  IF v_caller_id = v_count.keeper_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  IF v_count.accountant_user_id IS NOT NULL AND v_caller_id = v_count.accountant_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  IF v_adj.fc_approval_id = v_count.keeper_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  IF v_count.accountant_user_id IS NOT NULL AND v_adj.fc_approval_id = v_count.accountant_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  -- 7. Resolve UOM
  SELECT base_uom INTO v_uom
  FROM public.m_items
  WHERE item_code = v_adj.item_code;

  IF v_uom IS NULL THEN
    SELECT uom INTO v_uom
    FROM public.t_stock_count_items
    WHERE count_id = v_adj.count_id AND item_code = v_adj.item_code;
  END IF;

  IF v_uom IS NULL THEN
    v_uom := 'kg';
  END IF;

  -- 8. Resolve or sync user in m_users for t_stock_movements foreign key
  SELECT user_id INTO v_m_user_id
  FROM public.m_users
  WHERE user_id = v_caller_id::text;

  IF v_m_user_id IS NULL THEN
    SELECT u.user_id INTO v_m_user_id
    FROM public.m_users u
    JOIN auth.users au ON lower(au.email) = lower(u.email)
    WHERE au.id = v_caller_id;
  END IF;

  IF v_m_user_id IS NULL THEN
    INSERT INTO public.m_users (user_id, email, full_name)
    SELECT
      v_caller_id::text,
      coalesce(email, v_caller_id::text || '@internal.test'),
      coalesce(raw_user_meta_data->>'full_name', 'Financial Controller')
    FROM auth.users
    WHERE id = v_caller_id
    ON CONFLICT (user_id) DO NOTHING;

    v_m_user_id := v_caller_id::text;
  END IF;

  -- 9. Append COUNT_ADJUSTMENT movement to immutable stock ledger
  v_movement_id := gen_random_uuid();
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
    v_count.store_id,
    v_adj.warehouse_id,
    v_adj.item_code,
    'COUNT_ADJUSTMENT',
    v_adj.adjustment_qty,
    v_uom,
    NULL,
    NULL,
    p_adjustment_id::text,
    v_m_user_id,
    now()
  );

  -- 10. Update t_stock_adjustments voucher with movement_id and approval timestamp
  UPDATE public.t_stock_adjustments
  SET movement_id = v_movement_id,
      fc_approval_id = v_caller_id,
      approved_at = now()
  WHERE adjustment_id = p_adjustment_id;

  -- 11. Complete count and unfreeze warehouse if all adjustments for this count are approved
  IF NOT EXISTS (
    SELECT 1 FROM public.t_stock_adjustments
    WHERE count_id = v_adj.count_id
      AND movement_id IS NULL
      AND adjustment_id != p_adjustment_id
  ) THEN
    -- Unfreeze warehouse
    UPDATE public.m_warehouses
    SET status = 'ACTIVE'::warehouse_status,
        updated_at = now()
    WHERE warehouse_id = v_adj.warehouse_id;

    -- Mark count completed
    UPDATE public.t_stock_counts
    SET freeze_status = 'UNFROZEN',
        status = 'COMPLETED',
        completed_at = now()
    WHERE count_id = v_adj.count_id;
  END IF;
END;
$$;

-- 9. PERMISSIONS & RPC GRANTS
GRANT SELECT, INSERT, UPDATE ON public.t_stock_counts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.t_stock_count_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.t_stock_adjustments TO authenticated;

GRANT EXECUTE ON FUNCTION public.initiate_stock_count(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_first_count(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_recount(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_stock_adjustment(uuid, text) TO authenticated;
