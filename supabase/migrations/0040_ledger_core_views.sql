-- Migration 0040: Ledger Core, Immutability Triggers, Views & Functions
-- Domain D4: Stock Ledger Core & Current Stock
-- Non-negotiable: Quantities only. Zero financial or valuation data.

-- 1. APPEND-ONLY STOCK MOVEMENTS TABLE (t_stock_movements)
CREATE TABLE IF NOT EXISTS public.t_stock_movements (
  movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'GRPO_IMPORT',
    'ISSUE_PENDING',
    'ISSUE_PENDING_OFFSET',
    'ISSUE_CONFIRMED',
    'ISSUE_REVERSAL',
    'WASTE_DISPOSAL',
    'SUPPLIER_RETURN',
    'TRANSFER_OUT_INTRANSIT',
    'TRANSFER_IN_RECEIVED',
    'COUNT_ADJUSTMENT'
  )),
  quantity numeric NOT NULL,
  uom text NOT NULL,
  batch_number text NULL,
  expiry_date date NULL,
  reference_doc_id text NOT NULL,
  created_by_user_id text NOT NULL REFERENCES public.m_users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for high-throughput querying and aggregation
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_wh_item
  ON public.t_stock_movements (store_id, warehouse_id, item_code);

CREATE INDEX IF NOT EXISTS idx_stock_movements_lots
  ON public.t_stock_movements (item_code, batch_number, expiry_date);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at
  ON public.t_stock_movements (created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_ref_doc
  ON public.t_stock_movements (reference_doc_id);

-- 2. IMMUTABILITY TRIGGER FUNCTION & ENFORCEMENT
CREATE OR REPLACE FUNCTION public.tg_prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON public.t_stock_movements;
CREATE TRIGGER trg_prevent_ledger_mutation
  BEFORE UPDATE OR DELETE ON public.t_stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_ledger_mutation();

-- Revoke mutation permissions
REVOKE UPDATE, DELETE, TRUNCATE ON public.t_stock_movements FROM PUBLIC, authenticated, anon;

-- 3. DERIVED CURRENT STOCK VIEW (v_stock_current)
-- Group by store_id, warehouse_id, item_code, calculating derived book_stock
CREATE OR REPLACE VIEW public.v_stock_current
WITH (security_invoker = true)
AS
SELECT 
  store_id,
  warehouse_id,
  item_code,
  SUM(CASE 
    WHEN movement_type = 'GRPO_IMPORT' THEN quantity
    WHEN movement_type = 'ISSUE_PENDING' THEN quantity            -- negative
    WHEN movement_type = 'ISSUE_PENDING_OFFSET' THEN quantity     -- positive
    WHEN movement_type = 'ISSUE_CONFIRMED' THEN quantity          -- negative
    WHEN movement_type = 'ISSUE_REVERSAL' THEN quantity           -- positive
    WHEN movement_type = 'WASTE_DISPOSAL' THEN quantity           -- negative
    WHEN movement_type = 'SUPPLIER_RETURN' THEN quantity          -- negative
    WHEN movement_type = 'TRANSFER_OUT_INTRANSIT' THEN quantity   -- negative
    WHEN movement_type = 'TRANSFER_IN_RECEIVED' THEN quantity     -- positive
    WHEN movement_type = 'COUNT_ADJUSTMENT' THEN quantity         -- signed (+/-)
    ELSE 0 END) AS book_stock
FROM public.t_stock_movements
GROUP BY store_id, warehouse_id, item_code;

-- 4. PER-LOT FIFO VIEW (v_stock_lots_fifo)
-- Calculate remaining quantity per lot, ordered by expiry_date ASC, created_at ASC
CREATE OR REPLACE VIEW public.v_stock_lots_fifo
WITH (security_invoker = true)
AS
SELECT
  m.store_id,
  m.warehouse_id,
  m.item_code,
  m.batch_number,
  m.expiry_date,
  MAX(m.uom) AS uom,
  SUM(m.quantity) AS quantity,
  CASE
    WHEN m.expiry_date IS NOT NULL THEN (m.expiry_date - CURRENT_DATE)::integer
    ELSE NULL
  END AS days_to_expiry,
  CASE
    WHEN m.expiry_date IS NULL OR COALESCE(c.requires_lot_expiry_tracking, false) = false THEN 'FIFO_OK'
    WHEN (m.expiry_date - CURRENT_DATE) <= 0 THEN 'EXPIRED_LOCK'
    WHEN (m.expiry_date - CURRENT_DATE) <= COALESCE(c.expiry_warning_days, 0) THEN 'EXPIRY_AMBER'
    ELSE 'FIFO_OK'
  END AS expiry_status,
  MIN(m.created_at) AS created_at
FROM public.t_stock_movements m
LEFT JOIN public.m_items i ON i.item_code = m.item_code
LEFT JOIN public.m_expiry_tracking_config c ON c.category_group = i.category_group
GROUP BY
  m.store_id,
  m.warehouse_id,
  m.item_code,
  m.batch_number,
  m.expiry_date,
  c.requires_lot_expiry_tracking,
  c.expiry_warning_days
HAVING SUM(m.quantity) > 0
ORDER BY
  m.expiry_date ASC NULLS LAST,
  MIN(m.created_at) ASC;

-- 5. EXPIRY RADAR VIEW (v_expiry_radar)
-- Compute days_to_expiry and status ('EXPIRED_LOCK' when <= 0, 'EXPIRY_AMBER' when <= warning_days, 'FIFO_OK' otherwise)
CREATE OR REPLACE VIEW public.v_expiry_radar
WITH (security_invoker = true)
AS
SELECT
  f.store_id,
  f.warehouse_id,
  f.item_code,
  i.item_name,
  i.category_group,
  f.batch_number,
  f.expiry_date,
  f.uom,
  f.quantity,
  COALESCE(c.requires_lot_expiry_tracking, false) AS requires_lot_expiry_tracking,
  c.expiry_warning_days,
  f.days_to_expiry,
  f.expiry_status AS status,
  f.expiry_status,
  f.created_at
FROM public.v_stock_lots_fifo f
JOIN public.m_items i ON i.item_code = f.item_code
LEFT JOIN public.m_expiry_tracking_config c ON c.category_group = i.category_group
ORDER BY
  f.expiry_date ASC NULLS LAST,
  f.created_at ASC;

-- 6. REORDER & ADU FUNCTIONS
-- 6.1 get_suggested_reorder: calculates suggested reorder quantity based on par level and reorder point
CREATE OR REPLACE FUNCTION public.get_suggested_reorder(
  p_store_id text,
  p_warehouse_id text,
  p_item_code text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_stock numeric;
  v_par_level numeric;
  v_reorder_point numeric;
BEGIN
  -- Fetch reorder rules
  SELECT par_level, reorder_point
  INTO v_par_level, v_reorder_point
  FROM public.m_reorder_rules
  WHERE store_id = p_store_id
    AND warehouse_id = p_warehouse_id
    AND item_code = p_item_code;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Fetch current book stock
  SELECT COALESCE(book_stock, 0)
  INTO v_current_stock
  FROM public.v_stock_current
  WHERE store_id = p_store_id
    AND warehouse_id = p_warehouse_id
    AND item_code = p_item_code;

  IF v_current_stock IS NULL THEN
    v_current_stock := 0;
  END IF;

  -- Trigger condition: Current Book Stock <= Reorder Point
  -- Suggested Qty = max(0, Par Level - Current Book Stock - Open PO Qty)
  IF v_current_stock <= v_reorder_point THEN
    RETURN GREATEST(0, v_par_level - v_current_stock);
  ELSE
    RETURN 0;
  END IF;
END;
$$;

-- 6.2 calculate_adu: Average Daily Usage over rolling N days
CREATE OR REPLACE FUNCTION public.calculate_adu(
  p_store_id text,
  p_warehouse_id text,
  p_item_code text,
  p_days int DEFAULT 7
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days int := p_days;
  v_total_consumption numeric;
BEGIN
  IF v_days IS NULL OR v_days <= 0 THEN
    SELECT adu_window_days INTO v_days
    FROM public.m_reorder_rules
    WHERE store_id = p_store_id
      AND warehouse_id = p_warehouse_id
      AND item_code = p_item_code;

    IF v_days IS NULL OR v_days <= 0 THEN
      v_days := 7;
    END IF;
  END IF;

  SELECT COALESCE(SUM(ABS(quantity)), 0)
  INTO v_total_consumption
  FROM public.t_stock_movements
  WHERE store_id = p_store_id
    AND warehouse_id = p_warehouse_id
    AND item_code = p_item_code
    AND movement_type IN ('ISSUE_CONFIRMED', 'WASTE_DISPOSAL')
    AND created_at >= (now() - (v_days || ' days')::interval);

  RETURN ROUND(v_total_consumption / v_days, 4);
END;
$$;

-- 7. ROW-LEVEL SECURITY & PERMISSIONS
ALTER TABLE public.t_stock_movements ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT ON public.t_stock_movements TO authenticated;
GRANT ALL ON public.t_stock_movements TO service_role;

GRANT SELECT ON public.v_stock_current TO authenticated, anon, service_role;
GRANT SELECT ON public.v_stock_lots_fifo TO authenticated, anon, service_role;
GRANT SELECT ON public.v_expiry_radar TO authenticated, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_suggested_reorder(text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_adu(text, text, text, int) TO authenticated, anon, service_role;

-- Policies: authenticated users can read movements and insert (append-only)
DROP POLICY IF EXISTS stock_movements_select_policy ON public.t_stock_movements;
CREATE POLICY stock_movements_select_policy ON public.t_stock_movements
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS stock_movements_insert_policy ON public.t_stock_movements;
CREATE POLICY stock_movements_insert_policy ON public.t_stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 8. SAMPLE SEED MOVEMENTS REPRODUCING PROTOTYPE LEDGER STATE (Doc §4.1)

-- 8.1 Worked Example 1: Issue 5 kg, Runner Declines 5 kg (Net = 100 kg)
-- Initial shelf stock = 100 kg
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-EX1-001', CURRENT_DATE + 60, 'GRPO-EX1-INIT', 'usr-admin-01', now() - interval '3 hours'
);

-- Admin picks & issues 5 kg (ISSUE_PENDING: -5)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 'ISSUE_PENDING', -5.000, 'kg', 'BAT-EX1-001', CURRENT_DATE + 60, 'REQ-EX1-STAGE', 'usr-admin-01', now() - interval '2 hours'
);

-- Runner declines at door (ISSUE_REVERSAL: +5)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 'ISSUE_REVERSAL', 5.000, 'kg', 'BAT-EX1-001', CURRENT_DATE + 60, 'REQ-EX1-DECLINE', 'usr-admin-01', now() - interval '1 hour'
);

-- 8.2 Worked Example 2: Issue 5 kg, Runner Confirms 5 kg (Net = 95 kg)
-- Initial shelf stock = 100 kg
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-002', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-EX2-001', CURRENT_DATE + 60, 'GRPO-EX2-INIT', 'usr-admin-01', now() - interval '3 hours'
);

-- Admin picks & issues 5 kg (ISSUE_PENDING: -5)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-002', 'ISSUE_PENDING', -5.000, 'kg', 'BAT-EX2-001', CURRENT_DATE + 60, 'REQ-EX2-STAGE', 'usr-admin-01', now() - interval '2 hours'
);

-- Runner confirms: offset +5, confirmed -5
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES 
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-002', 'ISSUE_PENDING_OFFSET', 5.000, 'kg', 'BAT-EX2-001', CURRENT_DATE + 60, 'REQ-EX2-CONFIRM', 'usr-admin-01', now() - interval '1 hour'),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-002', 'ISSUE_CONFIRMED', -5.000, 'kg', 'BAT-EX2-001', CURRENT_DATE + 60, 'REQ-EX2-CONFIRM', 'usr-admin-01', now() - interval '1 hour');

-- 8.3 Worked Example 3: Issue 5 kg, Runner Confirms 3 kg and Declines 2 kg (Net = 97 kg)
-- Initial shelf stock = 100 kg
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-003', 'GRPO_IMPORT', 100.000, 'kg', 'BAT-EX3-001', CURRENT_DATE + 60, 'GRPO-EX3-INIT', 'usr-admin-01', now() - interval '3 hours'
);

-- Admin picks & issues 5 kg (ISSUE_PENDING: -5)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES (
  'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-003', 'ISSUE_PENDING', -5.000, 'kg', 'BAT-EX3-001', CURRENT_DATE + 60, 'REQ-EX3-STAGE', 'usr-admin-01', now() - interval '2 hours'
);

-- Runner accepts 3 kg, declines 2 kg: offset +5, confirmed -3
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES 
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-003', 'ISSUE_PENDING_OFFSET', 5.000, 'kg', 'BAT-EX3-001', CURRENT_DATE + 60, 'REQ-EX3-PARTIAL', 'usr-admin-01', now() - interval '1 hour'),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-003', 'ISSUE_CONFIRMED', -3.000, 'kg', 'BAT-EX3-001', CURRENT_DATE + 60, 'REQ-EX3-PARTIAL', 'usr-admin-01', now() - interval '1 hour');

-- 8.4 Expiry Radar Sample Lots (Mozzarella Fior di Latte: category CHEESE, warning_days = 3)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES
  -- Expired lot: days_to_expiry <= 0 -> EXPIRED_LOCK
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 'GRPO_IMPORT', 10.000, 'kg', 'BAT-CHZ-EXP', CURRENT_DATE - 2, 'GRPO-CHZ-EXP', 'usr-admin-01', now() - interval '4 days'),
  -- Amber warning lot: 0 < days_to_expiry (2) <= 3 -> EXPIRY_AMBER
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 'GRPO_IMPORT', 25.000, 'kg', 'BAT-CHZ-AMB', CURRENT_DATE + 2, 'GRPO-CHZ-AMB', 'usr-admin-01', now() - interval '3 days'),
  -- Safe lot: days_to_expiry (15) > 3 -> FIFO_OK
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 'GRPO_IMPORT', 50.000, 'kg', 'BAT-CHZ-OK', CURRENT_DATE + 15, 'GRPO-CHZ-OK', 'usr-admin-01', now() - interval '2 days');

-- 8.5 Usage Sample Movements for ADU & Reorder Testing
-- Mozzarella has 14 kg confirmed issue and 7 kg waste in the past 7 days (Total 21 kg / 7 days = 3.0000 ADU)
INSERT INTO public.t_stock_movements (
  store_id, warehouse_id, item_code, movement_type, quantity, uom, batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
) VALUES
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 'ISSUE_CONFIRMED', -14.000, 'kg', 'BAT-CHZ-OK', CURRENT_DATE + 15, 'REQ-CHZ-USAGE-01', 'usr-admin-01', now() - interval '1 day'),
  ('IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 'WASTE_DISPOSAL', -7.000, 'kg', 'BAT-CHZ-EXP', CURRENT_DATE - 2, 'WST-CHZ-01', 'usr-admin-01', now() - interval '2 days');
