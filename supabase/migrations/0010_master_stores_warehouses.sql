-- Migration 0010: Master Stores, Warehouses, and Go-Live Assignments
-- Pizza 4P's India Inventory Control Tool (Quantities Only)

-- 1. MASTER STORES TABLE
CREATE TABLE IF NOT EXISTS public.m_stores (
  store_id text PRIMARY KEY,
  store_name text NOT NULL,
  city text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. MASTER WAREHOUSES TABLE
CREATE TABLE IF NOT EXISTS public.m_warehouses (
  warehouse_id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_name text NOT NULL,
  floor_level text DEFAULT 'GROUND',
  storage_type storage_type NOT NULL DEFAULT 'COLD_ROOM',
  status warehouse_status NOT NULL DEFAULT 'ACTIVE',
  is_active boolean NOT NULL DEFAULT true,
  approval_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index foreign keys for performance
CREATE INDEX IF NOT EXISTS idx_m_warehouses_store_id ON public.m_warehouses(store_id);

-- 3. GO-LIVE ASSIGNMENT CHECKLIST TABLE
CREATE TABLE IF NOT EXISTS public.m_go_live_assignments (
  store_id text PRIMARY KEY REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE CASCADE,
  cold_room_custodian_id text NULL,
  cold_room_backup_id text NULL,
  dry_store_custodian_id text NULL,
  dry_store_backup_id text NULL,
  kitchen_runner_id text NULL,
  evening_key_holder_id text NULL,
  morning_receiving_window text NULL,
  afternoon_receiving_window text NULL,
  morning_issue_window text NULL,
  afternoon_issue_window text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. TRIGGERS FOR TIMESTAMPS AND STATUS/IS_ACTIVE SYNCHRONIZATION

CREATE OR REPLACE FUNCTION public.tg_master_sync_status_is_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'm_stores' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS NULL AND NEW.is_active IS NOT NULL THEN
        NEW.status := CASE WHEN NEW.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END;
      ELSIF NEW.status IS NOT NULL THEN
        NEW.is_active := (NEW.status = 'ACTIVE');
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.is_active := (NEW.status = 'ACTIVE');
      ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        NEW.status := CASE WHEN NEW.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'm_warehouses' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS NULL AND NEW.is_active IS NOT NULL THEN
        NEW.status := CASE WHEN NEW.is_active THEN 'ACTIVE'::warehouse_status ELSE 'INACTIVE'::warehouse_status END;
      ELSIF NEW.status IS NOT NULL THEN
        NEW.is_active := (NEW.status != 'INACTIVE');
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.is_active := (NEW.status != 'INACTIVE');
      ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        NEW.status := CASE WHEN NEW.is_active THEN 'ACTIVE'::warehouse_status ELSE 'INACTIVE'::warehouse_status END;
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m_stores_sync_status ON public.m_stores;
CREATE TRIGGER trg_m_stores_sync_status
  BEFORE INSERT OR UPDATE ON public.m_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_master_sync_status_is_active();

DROP TRIGGER IF EXISTS trg_m_warehouses_sync_status ON public.m_warehouses;
CREATE TRIGGER trg_m_warehouses_sync_status
  BEFORE INSERT OR UPDATE ON public.m_warehouses
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_master_sync_status_is_active();

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_m_go_live_assignments_updated_at ON public.m_go_live_assignments;
CREATE TRIGGER trg_m_go_live_assignments_updated_at
  BEFORE UPDATE ON public.m_go_live_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. STORE SWITCHER VIEW
CREATE OR REPLACE VIEW public.v_store_switcher
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  s.store_name,
  s.city,
  s.status,
  s.is_active
FROM public.m_stores s
WHERE s.status = 'ACTIVE' AND s.is_active = true;

-- 6. ROW-LEVEL SECURITY (RLS) POLICIES

ALTER TABLE public.m_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m_go_live_assignments ENABLE ROW LEVEL SECURITY;

-- 6.1 Policies for m_stores: Read for authenticated; write for APPROVER/SYSTEM_ADMIN
CREATE POLICY m_stores_select_policy ON public.m_stores
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY m_stores_insert_policy ON public.m_stores
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

CREATE POLICY m_stores_update_policy ON public.m_stores
  FOR UPDATE
  TO authenticated
  USING (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
  WITH CHECK (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

CREATE POLICY m_stores_delete_policy ON public.m_stores
  FOR DELETE
  TO authenticated
  USING (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

-- 6.2 Policies for m_warehouses: Read for authenticated; write for APPROVER/SYSTEM_ADMIN
CREATE POLICY m_warehouses_select_policy ON public.m_warehouses
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY m_warehouses_insert_policy ON public.m_warehouses
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

CREATE POLICY m_warehouses_update_policy ON public.m_warehouses
  FOR UPDATE
  TO authenticated
  USING (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
  WITH CHECK (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

CREATE POLICY m_warehouses_delete_policy ON public.m_warehouses
  FOR DELETE
  TO authenticated
  USING (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

-- 6.3 Policies for m_go_live_assignments: Read for authenticated; write for APPROVER/SYSTEM_ADMIN
CREATE POLICY m_go_live_assignments_select_policy ON public.m_go_live_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY m_go_live_assignments_insert_policy ON public.m_go_live_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

CREATE POLICY m_go_live_assignments_update_policy ON public.m_go_live_assignments
  FOR UPDATE
  TO authenticated
  USING (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'))
  WITH CHECK (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

CREATE POLICY m_go_live_assignments_delete_policy ON public.m_go_live_assignments
  FOR DELETE
  TO authenticated
  USING (has_role('APPROVER') OR has_role('SYSTEM_ADMIN'));

-- 7. TABLE PERMISSIONS & GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_stores TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_warehouses TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m_go_live_assignments TO authenticated, service_role;
GRANT SELECT ON public.v_store_switcher TO authenticated, anon, service_role;

-- 8. SAMPLE SEEDS FOR IND-DEL-01, IND-DEL-02, WH-DEL01-COLD, WH-DEL01-DRY
INSERT INTO public.m_stores (store_id, store_name, city, status, is_active)
VALUES
  ('IND-DEL-01', 'Delhi Store 1', 'Delhi', 'ACTIVE', true),
  ('IND-DEL-02', 'Delhi Store 2', 'Delhi', 'ACTIVE', true)
ON CONFLICT (store_id) DO UPDATE SET
  store_name = EXCLUDED.store_name,
  city = EXCLUDED.city,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active;

INSERT INTO public.m_warehouses (warehouse_id, store_id, warehouse_name, floor_level, storage_type, status, is_active)
VALUES
  ('WH-DEL01-COLD', 'IND-DEL-01', 'Delhi Store 1 Cold Room', 'GROUND', 'COLD_ROOM', 'ACTIVE', true),
  ('WH-DEL01-DRY', 'IND-DEL-01', 'Delhi Store 1 Dry Store', 'GROUND', 'DRY_STORE', 'ACTIVE', true)
ON CONFLICT (warehouse_id) DO UPDATE SET
  store_id = EXCLUDED.store_id,
  warehouse_name = EXCLUDED.warehouse_name,
  floor_level = EXCLUDED.floor_level,
  storage_type = EXCLUDED.storage_type,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active;

INSERT INTO public.m_go_live_assignments (
  store_id,
  cold_room_custodian_id,
  cold_room_backup_id,
  dry_store_custodian_id,
  dry_store_backup_id,
  kitchen_runner_id,
  evening_key_holder_id,
  morning_receiving_window,
  afternoon_receiving_window,
  morning_issue_window,
  afternoon_issue_window
)
VALUES
  (
    'IND-DEL-01',
    'USR-CUST-DEL01',
    'USR-BACKUP-DEL01',
    'USR-DRY-DEL01',
    'USR-DRYBACK-DEL01',
    'USR-RUN-DEL01',
    'USR-EVE-DEL01',
    '07:00-09:00',
    '14:00-16:00',
    '06:00-08:30',
    '14:30-16:00'
  ),
  (
    'IND-DEL-02',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '07:00-09:00',
    '14:00-16:00',
    '06:00-08:30',
    '14:30-16:00'
  )
ON CONFLICT (store_id) DO UPDATE SET
  morning_receiving_window = EXCLUDED.morning_receiving_window,
  afternoon_receiving_window = EXCLUDED.afternoon_receiving_window,
  morning_issue_window = EXCLUDED.morning_issue_window,
  afternoon_issue_window = EXCLUDED.afternoon_issue_window;
