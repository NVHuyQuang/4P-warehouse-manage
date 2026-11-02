-- Migration 0030: Items, Expiry Tracking Config, Reorder Rules, UoM Conversions
-- Domain D3: Item Master & Expiry Configuration
-- Invariants: Physical quantities only. Zero financial or valuation data.

-- 1. ITEM MASTER (m_items)
CREATE TABLE IF NOT EXISTS public.m_items (
  item_code TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  category_group TEXT NOT NULL,
  base_uom TEXT NOT NULL CHECK (lower(base_uom) IN ('kg', 'pcs')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 2. EXPIRY TRACKING CONFIGURATION (m_expiry_tracking_config)
CREATE TABLE IF NOT EXISTS public.m_expiry_tracking_config (
  config_id TEXT PRIMARY KEY,
  category_group TEXT NOT NULL UNIQUE,
  requires_lot_expiry_tracking BOOLEAN NOT NULL DEFAULT false,
  expiry_warning_days INTEGER NOT NULL DEFAULT 0 CHECK (expiry_warning_days >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 3. REORDER RULES (m_reorder_rules)
CREATE TABLE IF NOT EXISTS public.m_reorder_rules (
  rule_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  item_code TEXT NOT NULL REFERENCES public.m_items(item_code) ON DELETE CASCADE,
  par_level NUMERIC(12, 3) NOT NULL CHECK (par_level >= 0),
  reorder_point NUMERIC(12, 3) NOT NULL CHECK (reorder_point >= 0),
  min_order_qty NUMERIC(12, 3) NOT NULL CHECK (min_order_qty >= 0),
  adu_window_days INTEGER NOT NULL DEFAULT 7 CHECK (adu_window_days > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_reorder_rules_store_wh_item UNIQUE (store_id, warehouse_id, item_code)
);

-- Conditional foreign keys for m_reorder_rules (applied when store/warehouse tables exist)
DO $$
BEGIN
  IF to_regclass('public.m_stores') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_reorder_rules_store'
    ) THEN
      ALTER TABLE public.m_reorder_rules
        ADD CONSTRAINT fk_reorder_rules_store
        FOREIGN KEY (store_id) REFERENCES public.m_stores(store_id) ON DELETE RESTRICT;
    END IF;
  END IF;

  IF to_regclass('public.m_warehouses') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_reorder_rules_warehouse'
    ) THEN
      ALTER TABLE public.m_reorder_rules
        ADD CONSTRAINT fk_reorder_rules_warehouse
        FOREIGN KEY (warehouse_id) REFERENCES public.m_warehouses(warehouse_id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

-- 4. UOM CONVERSIONS (m_uom_conversions)
CREATE TABLE IF NOT EXISTS public.m_uom_conversions (
  conversion_id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL REFERENCES public.m_items(item_code) ON DELETE CASCADE,
  base_uom TEXT NOT NULL,
  secondary_uom TEXT NOT NULL,
  conversion_factor NUMERIC(12, 4) NOT NULL CHECK (conversion_factor > 0),
  dual_uom_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_uom_conversions_item_secondary UNIQUE (item_code, secondary_uom)
);

-- 5. INDEXES
CREATE INDEX IF NOT EXISTS idx_items_category ON public.m_items (category_group);
CREATE INDEX IF NOT EXISTS idx_items_is_active ON public.m_items (is_active);
CREATE INDEX IF NOT EXISTS idx_reorder_rules_store_wh ON public.m_reorder_rules (store_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_reorder_rules_item ON public.m_reorder_rules (item_code);
CREATE INDEX IF NOT EXISTS idx_uom_conversions_item ON public.m_uom_conversions (item_code);

-- 6. UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_items_updated_at ON public.m_items;
CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON public.m_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_expiry_config_updated_at ON public.m_expiry_tracking_config;
CREATE TRIGGER trg_expiry_config_updated_at
  BEFORE UPDATE ON public.m_expiry_tracking_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_reorder_rules_updated_at ON public.m_reorder_rules;
CREATE TRIGGER trg_reorder_rules_updated_at
  BEFORE UPDATE ON public.m_reorder_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_uom_conversions_updated_at ON public.m_uom_conversions;
CREATE TRIGGER trg_uom_conversions_updated_at
  BEFORE UPDATE ON public.m_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 7. ROW-LEVEL SECURITY (RLS)
ALTER TABLE public.m_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m_expiry_tracking_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m_reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m_uom_conversions ENABLE ROW LEVEL SECURITY;

-- Grants to authenticated and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_expiry_tracking_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_reorder_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_uom_conversions TO authenticated;

GRANT ALL ON public.m_items TO service_role;
GRANT ALL ON public.m_expiry_tracking_config TO service_role;
GRANT ALL ON public.m_reorder_rules TO service_role;
GRANT ALL ON public.m_uom_conversions TO service_role;

-- 7.1 m_items RLS Policies
DROP POLICY IF EXISTS m_items_read ON public.m_items;
CREATE POLICY m_items_read ON public.m_items
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS m_items_insert ON public.m_items;
CREATE POLICY m_items_insert ON public.m_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_items_update ON public.m_items;
CREATE POLICY m_items_update ON public.m_items
  FOR UPDATE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_items_delete ON public.m_items;
CREATE POLICY m_items_delete ON public.m_items
  FOR DELETE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

-- 7.2 m_expiry_tracking_config RLS Policies
DROP POLICY IF EXISTS m_expiry_config_read ON public.m_expiry_tracking_config;
CREATE POLICY m_expiry_config_read ON public.m_expiry_tracking_config
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS m_expiry_config_insert ON public.m_expiry_tracking_config;
CREATE POLICY m_expiry_config_insert ON public.m_expiry_tracking_config
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_expiry_config_update ON public.m_expiry_tracking_config;
CREATE POLICY m_expiry_config_update ON public.m_expiry_tracking_config
  FOR UPDATE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_expiry_config_delete ON public.m_expiry_tracking_config;
CREATE POLICY m_expiry_config_delete ON public.m_expiry_tracking_config
  FOR DELETE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

-- 7.3 m_reorder_rules RLS Policies
DROP POLICY IF EXISTS m_reorder_rules_read ON public.m_reorder_rules;
CREATE POLICY m_reorder_rules_read ON public.m_reorder_rules
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS m_reorder_rules_insert ON public.m_reorder_rules;
CREATE POLICY m_reorder_rules_insert ON public.m_reorder_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_reorder_rules_update ON public.m_reorder_rules;
CREATE POLICY m_reorder_rules_update ON public.m_reorder_rules
  FOR UPDATE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_reorder_rules_delete ON public.m_reorder_rules;
CREATE POLICY m_reorder_rules_delete ON public.m_reorder_rules
  FOR DELETE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

-- 7.4 m_uom_conversions RLS Policies
DROP POLICY IF EXISTS m_uom_conversions_read ON public.m_uom_conversions;
CREATE POLICY m_uom_conversions_read ON public.m_uom_conversions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS m_uom_conversions_insert ON public.m_uom_conversions;
CREATE POLICY m_uom_conversions_insert ON public.m_uom_conversions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_uom_conversions_update ON public.m_uom_conversions;
CREATE POLICY m_uom_conversions_update ON public.m_uom_conversions
  FOR UPDATE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  )
  WITH CHECK (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS m_uom_conversions_delete ON public.m_uom_conversions;
CREATE POLICY m_uom_conversions_delete ON public.m_uom_conversions
  FOR DELETE TO authenticated
  USING (
    public.has_role('ADMIN') OR public.has_role('APPROVER') OR public.has_role('SYSTEM_ADMIN')
  );

-- 8. SEED DATA (from lib/testing/synthetic-seed.ts)

-- 8.1 20 Sample Items
INSERT INTO public.m_items (item_code, item_name, category_group, base_uom, is_active) VALUES
  ('ITM-CHZ-001', 'Mozzarella Fior di Latte', 'CHEESE', 'kg', true),
  ('ITM-CHZ-002', 'Fresh Burrata 150g', 'CHEESE', 'pcs', true),
  ('ITM-CHZ-003', 'Buffalo Mozzarella 200g', 'CHEESE', 'pcs', true),
  ('ITM-CHZ-004', 'House Ricotta', 'CHEESE', 'kg', true),
  ('ITM-CHZ-005', 'Gorgonzola Dolce', 'CHEESE', 'kg', true),
  ('ITM-DRY-001', 'Caputo Type 00 Pizza Flour', 'DRY_GOODS', 'kg', true),
  ('ITM-DRY-002', 'San Marzano Tomato Pelati', 'DRY_GOODS', 'kg', true),
  ('ITM-DRY-003', 'Extra Virgin Olive Oil', 'DRY_GOODS', 'kg', true),
  ('ITM-DRY-004', 'Fresh Active Yeast', 'DRY_GOODS', 'kg', true),
  ('ITM-DRY-005', 'Sea Salt Coarse', 'DRY_GOODS', 'kg', true),
  ('ITM-MET-001', 'Prosciutto di Parma', 'MEAT', 'kg', true),
  ('ITM-MET-002', 'Spicy Salami Spianata', 'MEAT', 'kg', true),
  ('ITM-MET-003', 'Guanciale Affumicato', 'MEAT', 'kg', true),
  ('ITM-MET-004', 'Cooked Ham Cotto', 'MEAT', 'kg', true),
  ('ITM-VEG-001', 'Fresh Sweet Basil', 'VEGETABLE', 'kg', true),
  ('ITM-VEG-002', 'Organic Cherry Tomatoes', 'VEGETABLE', 'kg', true),
  ('ITM-VEG-003', 'Wild Rocket Arugula', 'VEGETABLE', 'kg', true),
  ('ITM-VEG-004', 'Fresh Button Mushrooms', 'VEGETABLE', 'kg', true),
  ('ITM-BEV-001', 'San Pellegrino Sparkling Water 750ml', 'BEVERAGE', 'pcs', true),
  ('ITM-BEV-002', 'House Brew IPA Draft Keg 20L', 'BEVERAGE', 'pcs', true)
ON CONFLICT (item_code) DO NOTHING;

-- 8.2 Expiry Tracking Configurations
INSERT INTO public.m_expiry_tracking_config (config_id, category_group, requires_lot_expiry_tracking, expiry_warning_days) VALUES
  ('cfg-exp-chz', 'CHEESE', true, 3),
  ('cfg-exp-dry', 'DRY_GOODS', false, 14),
  ('cfg-exp-met', 'MEAT', true, 5),
  ('cfg-exp-veg', 'VEGETABLE', true, 2),
  ('cfg-exp-bev', 'BEVERAGE', false, 30)
ON CONFLICT (config_id) DO NOTHING;

-- 8.3 UoM Conversions
INSERT INTO public.m_uom_conversions (conversion_id, item_code, base_uom, secondary_uom, conversion_factor, dual_uom_required) VALUES
  ('uom-conv-chz-001', 'ITM-CHZ-001', 'kg', 'pcs', 1.0000, true),
  ('uom-conv-chz-002', 'ITM-CHZ-002', 'pcs', 'kg', 0.1500, true),
  ('uom-conv-chz-003', 'ITM-CHZ-003', 'pcs', 'kg', 0.2000, true),
  ('uom-conv-met-001', 'ITM-MET-001', 'kg', 'pcs', 7.0000, true)
ON CONFLICT (item_code, secondary_uom) DO NOTHING;

-- 8.4 Reorder Rules for Seed Items (Store IND-DEL-01)
INSERT INTO public.m_reorder_rules (rule_id, store_id, warehouse_id, item_code, par_level, reorder_point, min_order_qty, adu_window_days) VALUES
  ('rr-del01-itm-chz-001', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-001', 150.000, 50.000, 30.000, 7),
  ('rr-del01-itm-chz-002', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-002', 80.000, 20.000, 20.000, 7),
  ('rr-del01-itm-chz-003', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-003', 60.000, 15.000, 15.000, 7),
  ('rr-del01-itm-chz-004', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-004', 40.000, 10.000, 10.000, 7),
  ('rr-del01-itm-chz-005', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-CHZ-005', 25.000, 8.000, 5.000, 7),
  ('rr-del01-itm-dry-001', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-001', 500.000, 150.000, 100.000, 7),
  ('rr-del01-itm-dry-002', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-002', 200.000, 60.000, 40.000, 7),
  ('rr-del01-itm-dry-003', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-003', 100.000, 30.000, 20.000, 7),
  ('rr-del01-itm-dry-004', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-004', 20.000, 5.000, 5.000, 7),
  ('rr-del01-itm-dry-005', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-DRY-005', 50.000, 15.000, 10.000, 7),
  ('rr-del01-itm-met-001', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-001', 50.000, 15.000, 10.000, 7),
  ('rr-del01-itm-met-002', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-002', 30.000, 10.000, 5.000, 7),
  ('rr-del01-itm-met-003', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-003', 25.000, 8.000, 5.000, 7),
  ('rr-del01-itm-met-004', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-MET-004', 40.000, 12.000, 10.000, 7),
  ('rr-del01-itm-veg-001', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-VEG-001', 15.000, 5.000, 5.000, 7),
  ('rr-del01-itm-veg-002', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-VEG-002', 35.000, 10.000, 10.000, 7),
  ('rr-del01-itm-veg-003', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-VEG-003', 20.000, 6.000, 5.000, 7),
  ('rr-del01-itm-veg-004', 'IND-DEL-01', 'WH-DEL01-COLD', 'ITM-VEG-004', 25.000, 8.000, 5.000, 7),
  ('rr-del01-itm-bev-001', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-BEV-001', 120.000, 36.000, 24.000, 7),
  ('rr-del01-itm-bev-002', 'IND-DEL-01', 'WH-DEL01-DRY', 'ITM-BEV-002', 10.000, 3.000, 2.000, 7)
ON CONFLICT (store_id, warehouse_id, item_code) DO NOTHING;
