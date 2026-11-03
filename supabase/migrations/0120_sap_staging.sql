-- Migration 0120: SAP GRPO Ingestion Staging, Store/Warehouse Mapping, Approvals & Ledger Append
-- Domain D12: SAP Ingestion Staging (Flow A-2)
-- Pizza 4P's India Inventory Control Tool (Quantities Only)
-- Non-negotiable: Quantities only. Zero valuation, cost, tax, or commercial vendor data anywhere.
-- Decision CR-02: DO NOT put a UNIQUE constraint on t_grpo_imports.file_hash (allows corrected file re-uploads).

-- -----------------------------------------------------------------------------
-- 1. STORE & WAREHOUSE MAPPING (m_store_warehouse_mapping)
-- Maps external SAP store and warehouse codes to internal application store_id and warehouse_id
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.m_store_warehouse_mapping (
  mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sap_store_code text NOT NULL,
  sap_wh_code text NOT NULL,
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sap_mapping UNIQUE (sap_store_code, sap_wh_code)
);

CREATE INDEX IF NOT EXISTS idx_store_warehouse_mapping_store_wh
  ON public.m_store_warehouse_mapping(store_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_store_warehouse_mapping_sap
  ON public.m_store_warehouse_mapping(sap_store_code, sap_wh_code);

-- -----------------------------------------------------------------------------
-- 2. FILE UPLOAD AUDIT (t_grpo_imports)
-- Decision CR-02: DO NOT put a UNIQUE constraint on file_hash (allows corrected re-uploads).
-- Line-level deduplication is enforced via compound key (grpo_no + line_key).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_grpo_imports (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  file_name text NOT NULL,
  file_hash text NOT NULL,
  detected_header_row integer NOT NULL DEFAULT 1 CHECK (detected_header_row >= 1),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  imported_rows integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  refreshed_rows integer NOT NULL DEFAULT 0 CHECK (refreshed_rows >= 0),
  needs_approval_rows integer NOT NULL DEFAULT 0 CHECK (needs_approval_rows >= 0),
  quarantined_rows integer NOT NULL DEFAULT 0 CHECK (quarantined_rows >= 0),
  uploaded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Decision CR-02: Index on file_hash for audit search, NO UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_grpo_imports_file_hash
  ON public.t_grpo_imports(file_hash);

CREATE INDEX IF NOT EXISTS idx_grpo_imports_store_id
  ON public.t_grpo_imports(store_id);

CREATE INDEX IF NOT EXISTS idx_grpo_imports_uploaded_by
  ON public.t_grpo_imports(uploaded_by_user_id);

CREATE INDEX IF NOT EXISTS idx_grpo_imports_imported_at
  ON public.t_grpo_imports(imported_at DESC);

-- -----------------------------------------------------------------------------
-- 3. PARSED LINE ITEMS (t_grpo_import_items)
-- Quantities only: Zero valuation, cost, or tax columns.
-- Compound key: (grpo_no, line_key) enforces line-level uniqueness.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_grpo_import_items (
  import_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.t_grpo_imports(import_id) ON DELETE CASCADE,
  grpo_no text NOT NULL,
  line_key text NOT NULL,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  uom text NOT NULL,
  doc_date date NOT NULL,
  batch_number text NULL,
  expiry_date date NULL,
  vendor_code text NULL,
  base_document text NULL,
  status text NOT NULL CHECK (status IN ('IMPORTED', 'REFRESHED', 'NEEDS_2ND_APPROVAL', 'QUARANTINED', 'APPROVED_REVERSAL', 'REJECTED')) DEFAULT 'IMPORTED',
  movement_id uuid NULL REFERENCES public.t_stock_movements(movement_id),
  second_approver_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  second_approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_grpo_import_line_key UNIQUE (grpo_no, line_key)
);

CREATE INDEX IF NOT EXISTS idx_grpo_import_items_import_id
  ON public.t_grpo_import_items(import_id);

CREATE INDEX IF NOT EXISTS idx_grpo_import_items_grpo_line
  ON public.t_grpo_import_items(grpo_no, line_key);

CREATE INDEX IF NOT EXISTS idx_grpo_import_items_item_code
  ON public.t_grpo_import_items(item_code);

CREATE INDEX IF NOT EXISTS idx_grpo_import_items_warehouse_id
  ON public.t_grpo_import_items(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_grpo_import_items_status
  ON public.t_grpo_import_items(status);

CREATE INDEX IF NOT EXISTS idx_grpo_import_items_movement_id
  ON public.t_grpo_import_items(movement_id);

-- -----------------------------------------------------------------------------
-- 4. STAGING ERRORS / QUARANTINE (t_grpo_staging_errors)
-- Append-only log of malformed, invalid, or unmapped lines.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.t_grpo_staging_errors (
  error_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.t_grpo_imports(import_id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_line_data text NOT NULL,
  error_reason text NOT NULL CHECK (error_reason IN ('MISSING_ITEM_CODE', 'INVALID_QTY', 'FORMAT_ERROR', 'UNMAPPED_UOM', 'UNMAPPED_STORE', 'DUPLICATE_KEY_MISMATCH')),
  quarantined_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grpo_staging_errors_import_id
  ON public.t_grpo_staging_errors(import_id);

CREATE INDEX IF NOT EXISTS idx_grpo_staging_errors_reason
  ON public.t_grpo_staging_errors(error_reason);

-- Immutability trigger for staging errors
CREATE OR REPLACE FUNCTION public.tg_prevent_grpo_staging_error_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'GRPO staging errors are append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_grpo_staging_error_mutation ON public.t_grpo_staging_errors;
CREATE TRIGGER trg_prevent_grpo_staging_error_mutation
  BEFORE UPDATE OR DELETE ON public.t_grpo_staging_errors
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_grpo_staging_error_mutation();

-- -----------------------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.m_store_warehouse_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_grpo_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_grpo_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_grpo_staging_errors ENABLE ROW LEVEL SECURITY;

-- 5.1 m_store_warehouse_mapping policies
DROP POLICY IF EXISTS m_store_warehouse_mapping_select ON public.m_store_warehouse_mapping;
CREATE POLICY m_store_warehouse_mapping_select ON public.m_store_warehouse_mapping
  FOR SELECT
  TO authenticated, anon
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('VIEWER')
    OR has_role('SCM')
    OR has_role('APPROVER')
  );

DROP POLICY IF EXISTS m_store_warehouse_mapping_insert ON public.m_store_warehouse_mapping;
CREATE POLICY m_store_warehouse_mapping_insert ON public.m_store_warehouse_mapping
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS m_store_warehouse_mapping_update ON public.m_store_warehouse_mapping;
CREATE POLICY m_store_warehouse_mapping_update ON public.m_store_warehouse_mapping
  FOR UPDATE
  TO authenticated
  USING (
    (has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS m_store_warehouse_mapping_delete ON public.m_store_warehouse_mapping;
CREATE POLICY m_store_warehouse_mapping_delete ON public.m_store_warehouse_mapping
  FOR DELETE
  TO authenticated
  USING (has_role('SYSTEM_ADMIN'));

-- 5.2 t_grpo_imports policies
DROP POLICY IF EXISTS t_grpo_imports_select ON public.t_grpo_imports;
CREATE POLICY t_grpo_imports_select ON public.t_grpo_imports
  FOR SELECT
  TO authenticated, anon
  USING (
    current_store_id() IS NULL
    OR store_id = current_store_id()
    OR has_role('SYSTEM_ADMIN')
    OR has_role('VIEWER')
    OR has_role('SCM')
    OR has_role('APPROVER')
    OR has_role('ADMIN')
  );

DROP POLICY IF EXISTS t_grpo_imports_insert ON public.t_grpo_imports;
CREATE POLICY t_grpo_imports_insert ON public.t_grpo_imports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS t_grpo_imports_update ON public.t_grpo_imports;
CREATE POLICY t_grpo_imports_update ON public.t_grpo_imports
  FOR UPDATE
  TO authenticated
  USING (
    (has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN'))
    AND (current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN'))
  );

DROP POLICY IF EXISTS t_grpo_imports_delete ON public.t_grpo_imports;
CREATE POLICY t_grpo_imports_delete ON public.t_grpo_imports
  FOR DELETE
  TO authenticated
  USING (false);

-- 5.3 t_grpo_import_items policies
DROP POLICY IF EXISTS t_grpo_import_items_select ON public.t_grpo_import_items;
CREATE POLICY t_grpo_import_items_select ON public.t_grpo_import_items
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.t_grpo_imports i
      WHERE i.import_id = t_grpo_import_items.import_id
      AND (
        current_store_id() IS NULL
        OR i.store_id = current_store_id()
        OR has_role('SYSTEM_ADMIN')
        OR has_role('VIEWER')
        OR has_role('SCM')
        OR has_role('APPROVER')
        OR has_role('ADMIN')
      )
    )
  );

DROP POLICY IF EXISTS t_grpo_import_items_insert ON public.t_grpo_import_items;
CREATE POLICY t_grpo_import_items_insert ON public.t_grpo_import_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS t_grpo_import_items_update ON public.t_grpo_import_items;
CREATE POLICY t_grpo_import_items_update ON public.t_grpo_import_items
  FOR UPDATE
  TO authenticated
  USING (
    has_role('SCM') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS t_grpo_import_items_delete ON public.t_grpo_import_items;
CREATE POLICY t_grpo_import_items_delete ON public.t_grpo_import_items
  FOR DELETE
  TO authenticated
  USING (false);

-- 5.4 t_grpo_staging_errors policies
DROP POLICY IF EXISTS t_grpo_staging_errors_select ON public.t_grpo_staging_errors;
CREATE POLICY t_grpo_staging_errors_select ON public.t_grpo_staging_errors
  FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.t_grpo_imports i
      WHERE i.import_id = t_grpo_staging_errors.import_id
      AND (
        current_store_id() IS NULL
        OR i.store_id = current_store_id()
        OR has_role('SYSTEM_ADMIN')
        OR has_role('VIEWER')
        OR has_role('SCM')
        OR has_role('APPROVER')
        OR has_role('ADMIN')
      )
    )
  );

DROP POLICY IF EXISTS t_grpo_staging_errors_insert ON public.t_grpo_staging_errors;
CREATE POLICY t_grpo_staging_errors_insert ON public.t_grpo_staging_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN')
  );

DROP POLICY IF EXISTS t_grpo_staging_errors_update ON public.t_grpo_staging_errors;
CREATE POLICY t_grpo_staging_errors_update ON public.t_grpo_staging_errors
  FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS t_grpo_staging_errors_delete ON public.t_grpo_staging_errors;
CREATE POLICY t_grpo_staging_errors_delete ON public.t_grpo_staging_errors
  FOR DELETE
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- 6. STORED PROCEDURES (RPCs)
-- -----------------------------------------------------------------------------

-- 6.1 commit_grpo_import_batch
-- Ingests post-allowlist JSON lines, classifies per Flow A-2, appends stock movements,
-- and records quarantined lines.
CREATE OR REPLACE FUNCTION public.commit_grpo_import_batch(
  p_import_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_import public.t_grpo_imports%ROWTYPE;
  v_line jsonb;
  v_raw_line_data text;
  v_row_number integer;
  v_grpo_no text;
  v_line_key text;
  v_item_code text;
  v_occurrence integer;
  v_quantity numeric(12,3);
  v_qty_text text;
  v_uom text;
  v_doc_date date;
  v_expiry_date date;
  v_batch_number text;
  v_vendor_code text;
  v_base_document text;
  v_sap_store_code text;
  v_sap_wh_code text;
  v_store_id text;
  v_warehouse_id text;
  v_mapped_store_id text;
  v_mapped_warehouse_id text;
  v_created_by_user_id text;
  v_movement_id uuid;
  v_existing_item public.t_grpo_import_items%ROWTYPE;
  v_total_count integer := 0;
  v_imported_count integer := 0;
  v_refreshed_count integer := 0;
  v_needs_approval_count integer := 0;
  v_quarantined_count integer := 0;
  v_batch_line_keys jsonb := '[]'::jsonb;
BEGIN
  -- 1. Authorization: Only ADMIN (Warehouse Keeper), SCM, or SYSTEM_ADMIN
  IF NOT (has_role('ADMIN') OR has_role('SCM') OR has_role('SYSTEM_ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized: Only Warehouse Keeper (ADMIN), SCM, or SYSTEM_ADMIN can import SAP GRPO batches.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Fetch import batch header
  SELECT * INTO v_import FROM public.t_grpo_imports WHERE import_id = p_import_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import batch % not found.', p_import_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Store scope check
  IF current_store_id() IS NOT NULL AND v_import.store_id != current_store_id() AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Store mismatch: cannot import for store % from store context %.', v_import.store_id, current_store_id()
      USING ERRCODE = 'P0001';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) != 'array' THEN
    RAISE EXCEPTION 'p_lines must be a JSON array.'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Resolve created_by_user_id for append-only movements in public.m_users
  SELECT user_id INTO v_created_by_user_id FROM public.m_users WHERE user_id = v_import.uploaded_by_user_id::text;
  IF v_created_by_user_id IS NULL THEN
    SELECT user_id INTO v_created_by_user_id FROM public.m_users WHERE email = (SELECT email FROM auth.users WHERE id = v_import.uploaded_by_user_id);
  END IF;
  IF v_created_by_user_id IS NULL THEN
    v_created_by_user_id := coalesce(
      nullif(current_setting('app.current_user_id', true), ''),
      v_import.uploaded_by_user_id::text
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.m_users WHERE user_id = v_created_by_user_id) THEN
    INSERT INTO public.m_users (user_id, email, full_name, is_active)
    SELECT
      v_created_by_user_id,
      coalesce(u.email, 'unknown@example.test'),
      coalesce(u.raw_user_meta_data->>'full_name', 'SAP Ingestion User'),
      true
    FROM auth.users u
    WHERE u.id = v_import.uploaded_by_user_id
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 5. Process lines sequentially
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_count := v_total_count + 1;
    v_raw_line_data := v_line::text;
    v_row_number := coalesce((v_line->>'row_number')::integer, v_total_count);
    v_grpo_no := trim(coalesce(v_line->>'grpo_no', v_line->>'grpo_number', ''));
    v_item_code := trim(coalesce(v_line->>'item_code', ''));
    v_occurrence := coalesce((v_line->>'occurrence_order')::integer, 1);
    v_line_key := trim(coalesce(v_line->>'line_key', ''));
    IF v_line_key = '' AND v_grpo_no != '' AND v_item_code != '' THEN
      v_line_key := v_grpo_no || '_' || v_item_code || '_' || v_occurrence::text;
    END IF;

    -- Parse quantity safely
    BEGIN
      v_qty_text := v_line->>'quantity';
      IF v_qty_text IS NULL OR trim(v_qty_text) = '' THEN
        v_quantity := NULL;
      ELSE
        v_quantity := v_qty_text::numeric(12,3);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_quantity := NULL;
    END;

    -- Parse dates safely
    BEGIN
      v_doc_date := (v_line->>'doc_date')::date;
    EXCEPTION WHEN OTHERS THEN
      v_doc_date := NULL;
    END;

    BEGIN
      v_expiry_date := (v_line->>'expiry_date')::date;
    EXCEPTION WHEN OTHERS THEN
      v_expiry_date := NULL;
    END;

    v_uom := lower(trim(coalesce(v_line->>'uom', v_line->>'uom_code', '')));
    v_batch_number := nullif(trim(v_line->>'batch_number'), '');
    v_vendor_code := nullif(trim(v_line->>'vendor_code'), '');
    v_base_document := nullif(trim(coalesce(v_line->>'base_document', v_line->>'po_number')), '');

    -- Extract store / warehouse codes
    v_sap_store_code := nullif(trim(coalesce(v_line->>'sap_store_code', v_line->>'store_code')), '');
    v_sap_wh_code := nullif(trim(coalesce(v_line->>'sap_wh_code', v_line->>'wh_code')), '');
    v_warehouse_id := nullif(trim(coalesce(v_line->>'warehouse_id', '')), '');
    v_store_id := nullif(trim(coalesce(v_line->>'store_id', '')), '');

    -- Validation 1: Format error
    IF v_grpo_no = '' OR v_doc_date IS NULL OR v_line_key = '' THEN
      INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
      VALUES (p_import_id, v_row_number, v_raw_line_data, 'FORMAT_ERROR');
      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;

    -- Validation 2: Missing or unknown Item Code
    IF v_item_code = '' OR NOT EXISTS (SELECT 1 FROM public.m_items WHERE item_code = v_item_code AND is_active = true) THEN
      INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
      VALUES (p_import_id, v_row_number, v_raw_line_data, 'MISSING_ITEM_CODE');
      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;

    -- Validation 3: Invalid quantity (must be > 0)
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
      VALUES (p_import_id, v_row_number, v_raw_line_data, 'INVALID_QTY');
      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;

    -- Validation 4: Unmapped UoM
    IF v_uom = '' OR NOT (
      EXISTS (SELECT 1 FROM public.m_items WHERE item_code = v_item_code AND lower(base_uom) = v_uom)
      OR EXISTS (SELECT 1 FROM public.m_uom_conversions WHERE item_code = v_item_code AND lower(secondary_uom) = v_uom)
      OR v_uom IN ('kg', 'pcs')
    ) THEN
      INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
      VALUES (p_import_id, v_row_number, v_raw_line_data, 'UNMAPPED_UOM');
      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;

    -- Validation 5: Store / Warehouse Resolution & Mapping
    v_mapped_store_id := NULL;
    v_mapped_warehouse_id := NULL;
    IF v_sap_store_code IS NOT NULL AND v_sap_wh_code IS NOT NULL THEN
      SELECT store_id, warehouse_id INTO v_mapped_store_id, v_mapped_warehouse_id
      FROM public.m_store_warehouse_mapping
      WHERE sap_store_code = v_sap_store_code AND sap_wh_code = v_sap_wh_code AND is_active = true
      LIMIT 1;

      IF v_mapped_store_id IS NOT NULL THEN
        v_store_id := v_mapped_store_id;
        v_warehouse_id := v_mapped_warehouse_id;
      END IF;
    END IF;

    IF v_warehouse_id IS NOT NULL AND v_store_id IS NULL THEN
      SELECT store_id INTO v_store_id FROM public.m_warehouses WHERE warehouse_id = v_warehouse_id;
    END IF;

    IF v_store_id IS NULL THEN
      v_store_id := v_import.store_id;
    END IF;

    IF v_warehouse_id IS NULL THEN
      SELECT warehouse_id INTO v_warehouse_id
      FROM public.m_warehouses
      WHERE store_id = v_store_id AND is_active = true
      ORDER BY (storage_type = 'DRY_STORE') DESC, warehouse_id ASC
      LIMIT 1;
    END IF;

    IF v_store_id IS NULL OR v_warehouse_id IS NULL OR
       NOT EXISTS (SELECT 1 FROM public.m_warehouses w WHERE w.warehouse_id = v_warehouse_id AND w.store_id = v_store_id AND w.is_active = true) THEN
      INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
      VALUES (p_import_id, v_row_number, v_raw_line_data, 'UNMAPPED_STORE');
      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;

    -- Validation 6: In-batch duplicate line key mismatch check
    IF v_batch_line_keys ? (v_grpo_no || '::' || v_line_key) THEN
      INSERT INTO public.t_grpo_staging_errors (import_id, row_number, raw_line_data, error_reason)
      VALUES (p_import_id, v_row_number, v_raw_line_data, 'DUPLICATE_KEY_MISMATCH');
      v_quarantined_count := v_quarantined_count + 1;
      CONTINUE;
    END IF;
    v_batch_line_keys := v_batch_line_keys || jsonb_build_array(v_grpo_no || '::' || v_line_key);

    -- Check if line exists in database (Flow A-2 classification)
    SELECT * INTO v_existing_item
    FROM public.t_grpo_import_items
    WHERE grpo_no = v_grpo_no AND line_key = v_line_key;

    IF FOUND THEN
      -- Existing document line re-uploaded
      IF v_existing_item.item_code = v_item_code AND v_existing_item.quantity = v_quantity THEN
        -- Case A: Same item & quantity -> REFRESHED (metadata update, 0 stock movement)
        UPDATE public.t_grpo_import_items
        SET import_id = p_import_id,
            status = 'REFRESHED',
            batch_number = coalesce(v_batch_number, v_existing_item.batch_number),
            expiry_date = coalesce(v_expiry_date, v_existing_item.expiry_date),
            vendor_code = coalesce(v_vendor_code, v_existing_item.vendor_code),
            base_document = coalesce(v_base_document, v_existing_item.base_document)
        WHERE import_item_id = v_existing_item.import_item_id;

        v_refreshed_count := v_refreshed_count + 1;
      ELSE
        -- Case B: Changed item or quantity -> NEEDS_2ND_APPROVAL (0 stock movement until approved)
        UPDATE public.t_grpo_import_items
        SET import_id = p_import_id,
            status = 'NEEDS_2ND_APPROVAL',
            item_code = v_item_code,
            quantity = v_quantity,
            uom = v_uom,
            warehouse_id = v_warehouse_id,
            doc_date = v_doc_date,
            batch_number = v_batch_number,
            expiry_date = v_expiry_date,
            vendor_code = v_vendor_code,
            base_document = v_base_document,
            second_approver_id = NULL,
            second_approved_at = NULL
        WHERE import_item_id = v_existing_item.import_item_id;

        v_needs_approval_count := v_needs_approval_count + 1;
      END IF;
    ELSE
      -- Case C: New line -> IMPORTED (appends GRPO_IMPORT movement to ledger)
      INSERT INTO public.t_stock_movements (
        store_id, warehouse_id, item_code, movement_type, quantity, uom,
        batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
      ) VALUES (
        v_store_id, v_warehouse_id, v_item_code, 'GRPO_IMPORT', v_quantity, v_uom,
        v_batch_number, v_expiry_date, v_grpo_no || '-' || v_line_key, v_created_by_user_id, now()
      ) RETURNING movement_id INTO v_movement_id;

      INSERT INTO public.t_grpo_import_items (
        import_id, grpo_no, line_key, item_code, warehouse_id, quantity, uom,
        doc_date, batch_number, expiry_date, vendor_code, base_document,
        status, movement_id
      ) VALUES (
        p_import_id, v_grpo_no, v_line_key, v_item_code, v_warehouse_id, v_quantity, v_uom,
        v_doc_date, v_batch_number, v_expiry_date, v_vendor_code, v_base_document,
        'IMPORTED', v_movement_id
      );

      v_imported_count := v_imported_count + 1;
    END IF;
  END LOOP;

  -- 6. Update import batch aggregate counts
  UPDATE public.t_grpo_imports
  SET total_rows = total_rows + v_total_count,
      imported_rows = imported_rows + v_imported_count,
      refreshed_rows = refreshed_rows + v_refreshed_count,
      needs_approval_rows = needs_approval_rows + v_needs_approval_count,
      quarantined_rows = quarantined_rows + v_quarantined_count
  WHERE import_id = p_import_id;

  RETURN jsonb_build_object(
    'import_id', p_import_id,
    'total_rows', v_total_count,
    'imported_rows', v_imported_count,
    'refreshed_rows', v_refreshed_count,
    'needs_approval_rows', v_needs_approval_count,
    'quarantined_rows', v_quarantined_count
  );
END;
$$;

-- 6.2 approve_grpo_correction
-- Executes second independent approval (SCM Lead or Financial Controller/APPROVER),
-- posting offsetting reversal of old movement and appending new corrected GRPO_IMPORT movement.
CREATE OR REPLACE FUNCTION public.approve_grpo_correction(
  p_import_item_id uuid,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_item public.t_grpo_import_items%ROWTYPE;
  v_old_movement public.t_stock_movements%ROWTYPE;
  v_approver_uuid uuid;
  v_approver_text_id text;
  v_store_id text;
  v_new_movement_id uuid;
  v_uploader_uuid uuid;
BEGIN
  -- 1. Authorization: Only SCM, APPROVER (Financial Controller), or SYSTEM_ADMIN
  IF NOT (has_role('SCM') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized: Only SCM Lead, Financial Controller (APPROVER), or SYSTEM_ADMIN can approve GRPO corrections.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Fetch the import item
  SELECT * INTO v_item FROM public.t_grpo_import_items WHERE import_item_id = p_import_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import item % not found.', p_import_item_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Verify status
  IF v_item.status != 'NEEDS_2ND_APPROVAL' THEN
    RAISE EXCEPTION 'Item % is in % status, but expected NEEDS_2ND_APPROVAL.', p_import_item_id, v_item.status
      USING ERRCODE = 'P0003';
  END IF;

  -- 4. Resolve approver identity
  BEGIN
    v_approver_uuid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_approver_uuid := NULL;
  END;

  IF v_approver_uuid IS NULL THEN
    BEGIN
      v_approver_uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_approver_uuid := NULL;
    END;
  END IF;

  IF v_approver_uuid IS NULL THEN
    SELECT u.id INTO v_approver_uuid
    FROM auth.users u
    JOIN public.m_users m ON m.email = u.email
    WHERE m.user_id = coalesce(nullif(current_setting('app.current_user_id', true), ''), 'usr-approver-01')
    LIMIT 1;
  END IF;

  -- Segregation of duties: uploader cannot approve their own correction
  SELECT uploaded_by_user_id INTO v_uploader_uuid
  FROM public.t_grpo_imports WHERE import_id = v_item.import_id;

  IF v_approver_uuid IS NOT NULL AND v_uploader_uuid IS NOT NULL AND v_approver_uuid = v_uploader_uuid AND NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Segregation of duties: Uploader cannot self-approve GRPO correction.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve approver text ID for t_stock_movements.created_by_user_id
  v_approver_text_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    v_approver_uuid::text,
    'usr-approver-01'
  );

  IF NOT EXISTS (SELECT 1 FROM public.m_users WHERE user_id = v_approver_text_id) THEN
    INSERT INTO public.m_users (user_id, email, full_name, is_active)
    SELECT
      v_approver_text_id,
      coalesce(u.email, 'approver@example.test'),
      coalesce(u.raw_user_meta_data->>'full_name', 'Approver User'),
      true
    FROM auth.users u
    WHERE u.id = v_approver_uuid
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 5. Post reversal of old movement if old movement exists
  IF v_item.movement_id IS NOT NULL THEN
    SELECT * INTO v_old_movement FROM public.t_stock_movements WHERE movement_id = v_item.movement_id;
    IF FOUND THEN
      INSERT INTO public.t_stock_movements (
        store_id, warehouse_id, item_code, movement_type, quantity, uom,
        batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
      ) VALUES (
        v_old_movement.store_id,
        v_old_movement.warehouse_id,
        v_old_movement.item_code,
        'GRPO_IMPORT',
        -1 * v_old_movement.quantity, -- Offsetting reversal
        v_old_movement.uom,
        v_old_movement.batch_number,
        v_old_movement.expiry_date,
        'REV-' || v_item.grpo_no || '-' || v_item.line_key,
        v_approver_text_id,
        now()
      );
    END IF;
  END IF;

  -- 6. Post new GRPO_IMPORT movement with updated quantity
  SELECT store_id INTO v_store_id FROM public.m_warehouses WHERE warehouse_id = v_item.warehouse_id;

  INSERT INTO public.t_stock_movements (
    store_id, warehouse_id, item_code, movement_type, quantity, uom,
    batch_number, expiry_date, reference_doc_id, created_by_user_id, created_at
  ) VALUES (
    v_store_id,
    v_item.warehouse_id,
    v_item.item_code,
    'GRPO_IMPORT',
    v_item.quantity, -- Corrected positive quantity
    v_item.uom,
    v_item.batch_number,
    v_item.expiry_date,
    v_item.grpo_no || '-' || v_item.line_key,
    v_approver_text_id,
    now()
  ) RETURNING movement_id INTO v_new_movement_id;

  -- 7. Update t_grpo_import_items
  UPDATE public.t_grpo_import_items
  SET status = 'APPROVED_REVERSAL',
      movement_id = v_new_movement_id,
      second_approver_id = v_approver_uuid,
      second_approved_at = now()
  WHERE import_item_id = p_import_item_id;

  -- 8. Update t_grpo_imports counters
  UPDATE public.t_grpo_imports
  SET needs_approval_rows = GREATEST(0, needs_approval_rows - 1),
      imported_rows = imported_rows + 1
  WHERE import_id = v_item.import_id;
END;
$$;

-- 6.3 reject_grpo_correction
-- Rejects a correction proposal without mutating the stock movement ledger.
CREATE OR REPLACE FUNCTION public.reject_grpo_correction(
  p_import_item_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_item public.t_grpo_import_items%ROWTYPE;
  v_approver_uuid uuid;
BEGIN
  IF NOT (has_role('SCM') OR has_role('APPROVER') OR has_role('SYSTEM_ADMIN')) THEN
    RAISE EXCEPTION 'Unauthorized: Only SCM Lead, Financial Controller (APPROVER), or SYSTEM_ADMIN can reject GRPO corrections.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_item FROM public.t_grpo_import_items WHERE import_item_id = p_import_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import item % not found.', p_import_item_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_item.status != 'NEEDS_2ND_APPROVAL' THEN
    RAISE EXCEPTION 'Item % is in % status, but expected NEEDS_2ND_APPROVAL.', p_import_item_id, v_item.status
      USING ERRCODE = 'P0003';
  END IF;

  BEGIN
    v_approver_uuid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_approver_uuid := NULL;
  END;

  UPDATE public.t_grpo_import_items
  SET status = 'REJECTED',
      second_approver_id = v_approver_uuid,
      second_approved_at = now()
  WHERE import_item_id = p_import_item_id;

  UPDATE public.t_grpo_imports
  SET needs_approval_rows = GREATEST(0, needs_approval_rows - 1)
  WHERE import_id = v_item.import_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. DEFAULT STORE & WAREHOUSE MAPPINGS FOR DELHI
-- -----------------------------------------------------------------------------
INSERT INTO public.m_store_warehouse_mapping (sap_store_code, sap_wh_code, store_id, warehouse_id, is_active)
VALUES
  ('DEL01', 'DRY', 'IND-DEL-01', 'WH-DEL01-DRY', true),
  ('DEL01', 'COLD', 'IND-DEL-01', 'WH-DEL01-COLD', true),
  ('IND-DEL-01', 'WH-DEL01-DRY', 'IND-DEL-01', 'WH-DEL01-DRY', true),
  ('IND-DEL-01', 'WH-DEL01-COLD', 'IND-DEL-01', 'WH-DEL01-COLD', true)
ON CONFLICT (sap_store_code, sap_wh_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 8. GRANTS & PERMISSIONS
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.m_store_warehouse_mapping TO authenticated, anon;
GRANT INSERT, UPDATE ON public.m_store_warehouse_mapping TO authenticated;
GRANT SELECT ON public.t_grpo_imports TO authenticated, anon;
GRANT INSERT, UPDATE ON public.t_grpo_imports TO authenticated;
GRANT SELECT ON public.t_grpo_import_items TO authenticated, anon;
GRANT INSERT, UPDATE ON public.t_grpo_import_items TO authenticated;
GRANT SELECT ON public.t_grpo_staging_errors TO authenticated, anon;
GRANT INSERT ON public.t_grpo_staging_errors TO authenticated;

GRANT EXECUTE ON FUNCTION public.commit_grpo_import_batch(uuid, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.approve_grpo_correction(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.reject_grpo_correction(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.tg_prevent_grpo_staging_error_mutation() TO authenticated, anon;
