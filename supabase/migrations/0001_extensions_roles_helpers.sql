-- Migration 0001: Extensions, Roles, Enums, and Helper Functions
-- Pizza 4P's India Inventory Control Tool

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- 2. ENUMS MATCHING CONTRACTS.md
-- 2.1 User Roles
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'SYSTEM_ADMIN',   -- Global admin: user provisioning, security, system ops
    'ADMIN',          -- Warehouse Keeper / Storekeeper: receiving, picking, benchmark count
    'RM',             -- Restaurant Manager: daily balance review, minor waste approval
    'KITCHEN_REQ',     -- Kitchen Section Requester: create/amend kitchen requests
    'BAR_REQ',         -- Bar Section Requester: create/amend bar requests
    'CHEESE_REQ',      -- Cheese Section Requester: create/amend cheese requests
    'RUNNER',         -- Kitchen Runner: door inspection and digital receipt confirmation
    'CUSTODIAN',      -- Named Room Custodian: room security, shift custody, benchmark count
    'SCM',            -- Supply Chain Lead: dock receiving issue escalation, invoice variance in SAP
    'ACCOUNTANT',     -- Store Accountant: cycle/month-end count, reconciliation vouchers
    'APPROVER',       -- Financial Controller: store/wh approvals, major waste, count adjustments
    'VIEWER'          -- Internal Audit / Executive: read-only access to ledger & audit trail
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2.2 Store Sections
DO $$ BEGIN
  CREATE TYPE section_id AS ENUM (
    'KITCHEN',
    'BAR',
    'CHEESE',
    'ALL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2.3 Storage Types
DO $$ BEGIN
  CREATE TYPE storage_type AS ENUM (
    'COLD_ROOM',
    'DRY_STORE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2.4 Warehouse Operating Status
DO $$ BEGIN
  CREATE TYPE warehouse_status AS ENUM (
    'ACTIVE',
    'FROZEN_FOR_COUNT',
    'INACTIVE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2.5 Unit of Measure
DO $$ BEGIN
  CREATE TYPE uom_code AS ENUM (
    'kg',
    'pcs'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2.6 Stock Movement Types (Append-only Ledger)
DO $$ BEGIN
  CREATE TYPE stock_movement_type AS ENUM (
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
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2.7 Additional Domain Enums from CONTRACTS.md
DO $$ BEGIN
  CREATE TYPE request_status AS ENUM (
    'QUEUED',
    'PICKING',
    'AWAITING_RUNNER',
    'CONFIRMED',
    'PARTIAL_ACCEPTED',
    'PARTIAL_DECLINED',
    'CANCELLED_BY_REQUESTER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transfer_status AS ENUM (
    'IN_TRANSIT',
    'RECEIVED_MATCH',
    'VARIANCE_PENDING_FC',
    'RECEIVED_VARIANCE_APPROVED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE count_status AS ENUM (
    'IN_PROGRESS',
    'RECOUNT',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE daily_balance_status AS ENUM (
    'BALANCED',
    'VARIANCE_FLAGGED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE grpo_line_status AS ENUM (
    'IMPORTED',
    'REFRESHED',
    'NEEDS_2ND_APPROVAL',
    'QUARANTINED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM (
    'PENDING_SECOND_APPROVAL',
    'PENDING',
    'ACTIVATED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. ROLE VALIDATION & HELPERS
CREATE OR REPLACE FUNCTION is_valid_role(role_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT role_text IN (
    'SYSTEM_ADMIN',
    'ADMIN',
    'RM',
    'KITCHEN_REQ',
    'BAR_REQ',
    'CHEESE_REQ',
    'RUNNER',
    'CUSTODIAN',
    'SCM',
    'ACCOUNTANT',
    'APPROVER',
    'VIEWER'
  );
$$;

-- 4. HELPER FUNCTIONS FOR RLS & SECURITY DEFINER ROUTINES

-- 4.1 current_scope()
-- Returns jsonb containing user_id, role, store_id, warehouse_id, section_id
CREATE OR REPLACE FUNCTION current_scope()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  jwt_claims jsonb;
  v_user_id uuid;
  v_role text;
  v_store_id text;
  v_warehouse_id text;
  v_section_id text;
BEGIN
  -- Safely extract JWT claims if auth schema / context is active
  BEGIN
    jwt_claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    jwt_claims := NULL;
  END;

  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- 1. Role resolution (Session config > JWT app_metadata > JWT custom claim > JWT user_metadata > JWT role)
  v_role := coalesce(
    nullif(current_setting('app.current_role', true), ''),
    jwt_claims -> 'app_metadata' ->> 'role',
    jwt_claims ->> 'user_role',
    jwt_claims -> 'user_metadata' ->> 'role',
    jwt_claims ->> 'role'
  );

  -- 2. Store ID resolution (Session config > request header claim > JWT > user_metadata > app_metadata)
  v_store_id := coalesce(
    nullif(current_setting('app.current_store_id', true), ''),
    nullif(current_setting('request.jwt.claim.store_id', true), ''),
    jwt_claims ->> 'store_id',
    jwt_claims -> 'user_metadata' ->> 'store_id',
    jwt_claims -> 'app_metadata' ->> 'store_id'
  );

  -- 3. Warehouse ID resolution
  v_warehouse_id := coalesce(
    nullif(current_setting('app.current_warehouse_id', true), ''),
    nullif(current_setting('request.jwt.claim.warehouse_id', true), ''),
    jwt_claims ->> 'warehouse_id',
    jwt_claims -> 'user_metadata' ->> 'warehouse_id',
    jwt_claims -> 'app_metadata' ->> 'warehouse_id'
  );

  -- 4. Section ID resolution
  v_section_id := coalesce(
    nullif(current_setting('app.current_section_id', true), ''),
    nullif(current_setting('request.jwt.claim.section_id', true), ''),
    jwt_claims ->> 'section_id',
    jwt_claims -> 'user_metadata' ->> 'section_id',
    jwt_claims -> 'app_metadata' ->> 'section_id'
  );

  -- 5. Fallback: Query m_user_permissions if table exists and user_id is known
  IF to_regclass('public.m_user_permissions') IS NOT NULL AND v_user_id IS NOT NULL THEN
    IF v_store_id IS NULL OR v_role IS NULL THEN
      EXECUTE 'SELECT role::text, store_id, warehouse_id, section_id::text
               FROM public.m_user_permissions
               WHERE user_id = $1
               LIMIT 1'
      INTO v_role, v_store_id, v_warehouse_id, v_section_id
      USING v_user_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'role', v_role,
    'store_id', v_store_id,
    'warehouse_id', v_warehouse_id,
    'section_id', v_section_id
  );
END;
$$;

-- 4.2 has_role(text)
-- Verifies whether current caller has the specified role
CREATE OR REPLACE FUNCTION has_role(required_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  jwt_claims jsonb;
  claim_role text;
  app_roles jsonb;
  v_user_id uuid;
  has_perm boolean := false;
BEGIN
  IF required_role IS NULL OR required_role = '' THEN
    RETURN false;
  END IF;

  -- 1. Check session setting override (app.current_role)
  IF nullif(current_setting('app.current_role', true), '') IS NOT NULL THEN
    IF upper(current_setting('app.current_role', true)) = upper(required_role) THEN
      RETURN true;
    END IF;
  END IF;

  -- 2. Check JWT claims
  BEGIN
    jwt_claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    jwt_claims := NULL;
  END;

  IF jwt_claims IS NOT NULL THEN
    claim_role := coalesce(
      jwt_claims -> 'app_metadata' ->> 'role',
      jwt_claims ->> 'user_role',
      jwt_claims -> 'user_metadata' ->> 'role',
      jwt_claims ->> 'role'
    );
    IF claim_role IS NOT NULL AND upper(claim_role) = upper(required_role) THEN
      RETURN true;
    END IF;

    -- Check if roles array exists in app_metadata
    app_roles := jwt_claims -> 'app_metadata' -> 'roles';
    IF app_roles IS NOT NULL AND jsonb_typeof(app_roles) = 'array' THEN
      IF app_roles ? required_role OR app_roles ? upper(required_role) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  -- 3. Check m_user_permissions if table exists
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  IF to_regclass('public.m_user_permissions') IS NOT NULL AND v_user_id IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
               SELECT 1 FROM public.m_user_permissions
               WHERE user_id = $1 AND upper(role::text) = upper($2)
             )'
    INTO has_perm
    USING v_user_id, required_role;

    IF has_perm THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- 4.3 current_store_id()
-- Returns active store identifier
CREATE OR REPLACE FUNCTION current_store_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store text;
BEGIN
  v_store := coalesce(
    nullif(current_setting('app.current_store_id', true), ''),
    nullif(current_setting('request.jwt.claim.store_id', true), '')
  );

  IF v_store IS NOT NULL THEN
    RETURN v_store;
  END IF;

  RETURN current_scope() ->> 'store_id';
END;
$$;

-- 4.4 current_warehouse_id()
-- Returns active warehouse identifier
CREATE OR REPLACE FUNCTION current_warehouse_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_warehouse text;
BEGIN
  v_warehouse := coalesce(
    nullif(current_setting('app.current_warehouse_id', true), ''),
    nullif(current_setting('request.jwt.claim.warehouse_id', true), '')
  );

  IF v_warehouse IS NOT NULL THEN
    RETURN v_warehouse;
  END IF;

  RETURN current_scope() ->> 'warehouse_id';
END;
$$;

-- 5. IMMUTABLE LEDGER TRIGGER FUNCTION
-- Raises exception on any UPDATE or DELETE attempt on append-only ledger tables
CREATE OR REPLACE FUNCTION tg_prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only and cannot be updated or deleted.';
END;
$$;

-- Spec alias for consistency across docs
CREATE OR REPLACE FUNCTION tg_prevent_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only and cannot be updated or deleted.';
END;
$$;

-- 6. PERMISSIONS & GRANTS
GRANT EXECUTE ON FUNCTION is_valid_role(text) TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION current_scope() TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION has_role(text) TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION current_store_id() TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION current_warehouse_id() TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION tg_prevent_ledger_mutation() TO public, authenticated, anon;
GRANT EXECUTE ON FUNCTION tg_prevent_movement_mutation() TO public, authenticated, anon;
