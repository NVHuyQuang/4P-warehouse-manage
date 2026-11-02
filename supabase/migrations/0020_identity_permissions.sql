-- Migration 0020: Identity, Permissions, Auth & Security Logs
-- Pizza 4P's India Inventory Control Tool
-- Implements Flow 0: Users, Roles, Access & Lifecycle
-- Non-negotiable: Physical quantities and counts only. Zero valuation or commercial data columns.

-- 1. SECURITY EVENT TYPE ENUM
DO $$ BEGIN
  CREATE TYPE security_event_type AS ENUM (
    'INVITATION_SENT',
    'PASSWORD_SET',
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'ACCOUNT_LOCKED',
    'PASSWORD_RESET',
    'DEACTIVATION'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. TEXT/UUID INTEROPERABILITY OPERATORS
-- Ensures safe comparison between auth.uid() (uuid) and application user_id (text)
CREATE OR REPLACE FUNCTION text_equals_uuid(a text, b uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT a = b::text $$;

CREATE OR REPLACE FUNCTION uuid_equals_text(a uuid, b text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT a::text = b $$;

DO $$ BEGIN
  CREATE OPERATOR = (
    LEFTARG = text,
    RIGHTARG = uuid,
    PROCEDURE = text_equals_uuid,
    COMMUTATOR = =
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE OPERATOR = (
    LEFTARG = uuid,
    RIGHTARG = text,
    PROCEDURE = uuid_equals_text,
    COMMUTATOR = =
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. USER MASTER (m_users)
-- Passwords managed strictly by Supabase Auth (auth.users). Zero password_hash in app tables.
CREATE TABLE IF NOT EXISTS m_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  lockout_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 4. USER INVITATIONS (m_user_invitations)
-- Governs onboarding lifecycle (Flow 0). APPROVER invitations require 2nd approval (Rule 1.2.2).
CREATE TABLE IF NOT EXISTS m_user_invitations (
  invitation_id TEXT PRIMARY KEY DEFAULT ('inv-' || extensions.uuid_generate_v4()::text),
  email TEXT NOT NULL,
  role user_role NOT NULL,
  store_id TEXT NOT NULL,
  activation_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  status invitation_status NOT NULL DEFAULT 'PENDING'::invitation_status,
  invited_by_user_id TEXT REFERENCES m_users(user_id),
  second_approved_by TEXT REFERENCES m_users(user_id),
  second_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_approver_second_approval CHECK (
    role != 'APPROVER'::user_role OR
    status != 'PENDING'::invitation_status OR
    second_approved_by IS NOT NULL
  ),
  CONSTRAINT chk_segregation_second_approval CHECK (
    invited_by_user_id IS NULL OR
    second_approved_by IS NULL OR
    invited_by_user_id != second_approved_by
  )
);

-- 5. USER PERMISSIONS & SCOPE (m_user_permissions)
CREATE TABLE IF NOT EXISTS m_user_permissions (
  permission_id TEXT PRIMARY KEY DEFAULT ('perm-' || extensions.uuid_generate_v4()::text),
  user_id TEXT NOT NULL REFERENCES m_users(user_id) ON DELETE CASCADE,
  role user_role NOT NULL,
  store_id TEXT NOT NULL,
  warehouse_id TEXT,
  section_id section_id NOT NULL DEFAULT 'ALL'::section_id,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_user_permission UNIQUE (user_id, role, store_id, section_id)
);

-- 6. SECURITY & ACCESS AUDIT LOG (t_security_logs)
-- Append-only audit trail for authentication, invitations, and lockouts.
CREATE TABLE IF NOT EXISTS t_security_logs (
  log_id TEXT PRIMARY KEY DEFAULT ('sec-' || extensions.uuid_generate_v4()::text),
  user_id TEXT REFERENCES m_users(user_id) ON DELETE SET NULL,
  event_type security_event_type NOT NULL,
  ip_address TEXT,
  device_info TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 7. APPEND-ONLY IMMUTABILITY TRIGGER FOR t_security_logs
CREATE OR REPLACE FUNCTION tg_prevent_security_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Security logs are append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_security_log_mutation ON t_security_logs;
CREATE TRIGGER trg_prevent_security_log_mutation
BEFORE UPDATE OR DELETE ON t_security_logs
FOR EACH ROW
EXECUTE FUNCTION tg_prevent_security_log_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON t_security_logs FROM PUBLIC, authenticated, anon;

-- 8. TRIGGER FOR APPROVER INVITATION LIFECYCLE (Rule 1.2.2)
CREATE OR REPLACE FUNCTION tg_enforce_approver_invitation_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role = 'APPROVER'::user_role THEN
    IF NEW.second_approved_by IS NULL THEN
      NEW.status := 'PENDING_SECOND_APPROVAL'::invitation_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_approver_invitation_status ON m_user_invitations;
CREATE TRIGGER trg_enforce_approver_invitation_status
BEFORE INSERT ON m_user_invitations
FOR EACH ROW
EXECUTE FUNCTION tg_enforce_approver_invitation_status();

-- 9. OVERRIDE / ENHANCE CONTEXT & ROLE HELPERS FOR IDENTITY TABLES
CREATE OR REPLACE FUNCTION current_scope()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  jwt_claims jsonb;
  v_user_id text;
  v_role text;
  v_store_id text;
  v_warehouse_id text;
  v_section_id text;
BEGIN
  BEGIN
    jwt_claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    jwt_claims := NULL;
  END;

  BEGIN
    v_user_id := coalesce(
      nullif(current_setting('app.current_user_id', true), ''),
      auth.uid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    v_user_id := nullif(current_setting('app.current_user_id', true), '');
  END;

  v_role := coalesce(
    nullif(current_setting('app.current_role', true), ''),
    jwt_claims -> 'app_metadata' ->> 'role',
    jwt_claims ->> 'user_role',
    jwt_claims -> 'user_metadata' ->> 'role',
    jwt_claims ->> 'role'
  );

  v_store_id := coalesce(
    nullif(current_setting('app.current_store_id', true), ''),
    nullif(current_setting('request.jwt.claim.store_id', true), ''),
    jwt_claims ->> 'store_id',
    jwt_claims -> 'user_metadata' ->> 'store_id',
    jwt_claims -> 'app_metadata' ->> 'store_id'
  );

  v_warehouse_id := coalesce(
    nullif(current_setting('app.current_warehouse_id', true), ''),
    nullif(current_setting('request.jwt.claim.warehouse_id', true), ''),
    jwt_claims ->> 'warehouse_id',
    jwt_claims -> 'user_metadata' ->> 'warehouse_id',
    jwt_claims -> 'app_metadata' ->> 'warehouse_id'
  );

  v_section_id := coalesce(
    nullif(current_setting('app.current_section_id', true), ''),
    nullif(current_setting('request.jwt.claim.section_id', true), ''),
    jwt_claims ->> 'section_id',
    jwt_claims -> 'user_metadata' ->> 'section_id',
    jwt_claims -> 'app_metadata' ->> 'section_id'
  );

  -- Fallback from m_user_permissions if user_id known
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
  v_user_id text;
  has_perm boolean := false;
BEGIN
  IF required_role IS NULL OR required_role = '' THEN
    RETURN false;
  END IF;

  -- 1. Check session setting override
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

    app_roles := jwt_claims -> 'app_metadata' -> 'roles';
    IF app_roles IS NOT NULL AND jsonb_typeof(app_roles) = 'array' THEN
      IF app_roles ? required_role OR app_roles ? upper(required_role) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  -- 3. Check m_user_permissions table
  BEGIN
    v_user_id := coalesce(
      nullif(current_setting('app.current_user_id', true), ''),
      auth.uid()::text
    );
  EXCEPTION WHEN OTHERS THEN
    v_user_id := nullif(current_setting('app.current_user_id', true), '');
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

-- 10. RPC: CREATE USER INVITATION (Rule 1.2.1)
CREATE OR REPLACE FUNCTION create_user_invitation(
  p_email text,
  p_role user_role,
  p_store_id text,
  p_expires_in_hours integer DEFAULT 48
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id text;
  v_invitation_id text;
  v_token text;
  v_expires_at timestamptz;
  v_status invitation_status;
BEGIN
  -- Rule 1.2.1: Only SYSTEM_ADMIN can invite users
  IF NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.';
  END IF;

  v_caller_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    current_scope()->>'user_id',
    auth.uid()::text
  );
  v_invitation_id := 'inv-' || extensions.uuid_generate_v4()::text;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := clock_timestamp() + (coalesce(p_expires_in_hours, 48) || ' hours')::interval;

  -- Rule 1.2.2: APPROVER requires second approval
  IF p_role = 'APPROVER'::user_role THEN
    v_status := 'PENDING_SECOND_APPROVAL'::invitation_status;
  ELSE
    v_status := 'PENDING'::invitation_status;
  END IF;

  INSERT INTO m_user_invitations (
    invitation_id,
    email,
    role,
    store_id,
    activation_token,
    expires_at,
    status,
    invited_by_user_id
  ) VALUES (
    v_invitation_id,
    lower(trim(p_email)),
    p_role,
    p_store_id,
    v_token,
    v_expires_at,
    v_status,
    v_caller_id
  );

  INSERT INTO t_security_logs (
    user_id,
    event_type,
    device_info
  ) VALUES (
    v_caller_id,
    'INVITATION_SENT'::security_event_type,
    'Invitation created for ' || lower(trim(p_email)) || ' with role ' || p_role::text
  );

  RETURN jsonb_build_object(
    'invitation_id', v_invitation_id,
    'email', lower(trim(p_email)),
    'role', p_role::text,
    'store_id', p_store_id,
    'status', v_status::text,
    'activation_token', v_token,
    'expires_at', v_expires_at
  );
END;
$$;

-- 11. RPC: SECOND APPROVAL FOR APPROVER (Rule 1.2.2)
CREATE OR REPLACE FUNCTION approve_approver_invitation(
  p_invitation_id text,
  p_approver_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv record;
  v_approver text;
BEGIN
  v_approver := coalesce(
    p_approver_user_id,
    nullif(current_setting('app.current_user_id', true), ''),
    current_scope()->>'user_id',
    auth.uid()::text
  );

  -- Caller must hold SYSTEM_ADMIN or APPROVER role
  IF NOT (has_role('SYSTEM_ADMIN') OR has_role('APPROVER')) THEN
    RAISE EXCEPTION 'Unauthorized: Only SYSTEM_ADMIN or APPROVER can grant second approval.';
  END IF;

  SELECT * INTO v_inv
  FROM m_user_invitations
  WHERE invitation_id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found: %', p_invitation_id;
  END IF;

  IF v_inv.role != 'APPROVER'::user_role THEN
    RAISE EXCEPTION 'Invitation % does not require second approval (role is %)', p_invitation_id, v_inv.role;
  END IF;

  IF v_inv.status != 'PENDING_SECOND_APPROVAL'::invitation_status THEN
    RAISE EXCEPTION 'Invitation % is not pending second approval (current status: %)', p_invitation_id, v_inv.status;
  END IF;

  -- Segregation of Duties (Rule 1.2.2 / 1.2.3): Inviter cannot approve own request
  IF v_inv.invited_by_user_id IS NOT NULL AND v_approver IS NOT NULL AND v_inv.invited_by_user_id = v_approver THEN
    RAISE EXCEPTION 'Segregation of duties violation: Creator cannot second-approve the same APPROVER invitation';
  END IF;

  -- Grant second approval -> transition to PENDING
  UPDATE m_user_invitations
  SET status = 'PENDING'::invitation_status,
      second_approved_by = v_approver,
      second_approved_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE invitation_id = p_invitation_id;

  INSERT INTO t_security_logs (
    user_id,
    event_type,
    device_info
  ) VALUES (
    v_approver,
    'INVITATION_SENT'::security_event_type,
    'Second approval granted for invitation ' || p_invitation_id || ' (' || v_inv.email || ')'
  );

  RETURN jsonb_build_object(
    'success', true,
    'invitation_id', p_invitation_id,
    'status', 'PENDING',
    'second_approved_by', v_approver,
    'second_approved_at', clock_timestamp()
  );
END;
$$;

-- Alias helper
CREATE OR REPLACE FUNCTION second_approve_invitation(
  p_invitation_id text,
  p_approver_user_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN approve_approver_invitation(p_invitation_id, p_approver_user_id);
END;
$$;

-- 12. LOCKOUT COUNTER HELPERS (Flow 0 Steps U7, U10, U12, U13)
CREATE OR REPLACE FUNCTION record_failed_login(
  p_email text,
  p_max_attempts integer DEFAULT 5,
  p_lockout_duration_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user record;
  v_new_count integer;
  v_lockout_until timestamptz := NULL;
  v_is_locked boolean := false;
BEGIN
  SELECT * INTO v_user
  FROM m_users
  WHERE lower(email) = lower(trim(p_email));

  IF NOT FOUND THEN
    INSERT INTO t_security_logs (user_id, event_type, device_info)
    VALUES (NULL, 'LOGIN_FAILED'::security_event_type, 'Login failure for non-existent email: ' || p_email);

    RETURN jsonb_build_object(
      'user_exists', false,
      'locked', false
    );
  END IF;

  v_new_count := v_user.failed_login_count + 1;

  IF v_new_count >= p_max_attempts THEN
    v_lockout_until := clock_timestamp() + (p_lockout_duration_minutes || ' minutes')::interval;
    v_is_locked := true;

    UPDATE m_users
    SET failed_login_count = v_new_count,
        lockout_until = v_lockout_until,
        updated_at = clock_timestamp()
    WHERE user_id = v_user.user_id;

    INSERT INTO t_security_logs (user_id, event_type, device_info)
    VALUES (v_user.user_id, 'ACCOUNT_LOCKED'::security_event_type,
      'Account locked after ' || v_new_count || ' consecutive failed logins');
  ELSE
    UPDATE m_users
    SET failed_login_count = v_new_count,
        updated_at = clock_timestamp()
    WHERE user_id = v_user.user_id;

    INSERT INTO t_security_logs (user_id, event_type, device_info)
    VALUES (v_user.user_id, 'LOGIN_FAILED'::security_event_type,
      'Failed login attempt ' || v_new_count || ' of ' || p_max_attempts);
  END IF;

  RETURN jsonb_build_object(
    'user_exists', true,
    'user_id', v_user.user_id,
    'failed_login_count', v_new_count,
    'locked', v_is_locked,
    'lockout_until', v_lockout_until
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_login_success(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT * INTO v_user
  FROM m_users
  WHERE lower(email) = lower(trim(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found for email: %', p_email;
  END IF;

  IF v_user.lockout_until IS NOT NULL AND v_user.lockout_until > clock_timestamp() THEN
    RAISE EXCEPTION 'Account is locked until %', v_user.lockout_until;
  END IF;

  IF NOT v_user.is_active THEN
    RAISE EXCEPTION 'Account is deactivated';
  END IF;

  UPDATE m_users
  SET failed_login_count = 0,
      lockout_until = NULL,
      updated_at = clock_timestamp()
  WHERE user_id = v_user.user_id;

  INSERT INTO t_security_logs (user_id, event_type, device_info)
  VALUES (v_user.user_id, 'LOGIN_SUCCESS'::security_event_type, 'Successful login');

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user.user_id,
    'email', v_user.email
  );
END;
$$;

CREATE OR REPLACE FUNCTION unlock_user_account(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id text;
BEGIN
  IF NOT has_role('SYSTEM_ADMIN') THEN
    RAISE EXCEPTION 'Unauthorized: Only SYSTEM_ADMIN can unlock user accounts.';
  END IF;

  v_caller_id := coalesce(
    nullif(current_setting('app.current_user_id', true), ''),
    current_scope()->>'user_id',
    auth.uid()::text
  );

  UPDATE m_users
  SET failed_login_count = 0,
      lockout_until = NULL,
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  INSERT INTO t_security_logs (user_id, event_type, device_info)
  VALUES (p_user_id, 'PASSWORD_RESET'::security_event_type,
    'Lockout reset by SYSTEM_ADMIN ' || coalesce(v_caller_id, ''));

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'unlocked', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_account_locked(p_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lockout timestamptz;
  v_is_active boolean;
BEGIN
  SELECT lockout_until, is_active INTO v_lockout, v_is_active
  FROM m_users
  WHERE lower(email) = lower(trim(p_email));

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT v_is_active THEN
    RETURN true;
  END IF;

  RETURN (v_lockout IS NOT NULL AND v_lockout > clock_timestamp());
END;
$$;

-- 13. ROW LEVEL SECURITY POLICIES
ALTER TABLE m_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE m_user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE m_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE t_security_logs ENABLE ROW LEVEL SECURITY;

-- 13.1 m_users
DROP POLICY IF EXISTS "m_users_select" ON m_users;
CREATE POLICY "m_users_select"
  ON m_users FOR SELECT
  USING (
    has_role('SYSTEM_ADMIN')
    OR user_id = coalesce(nullif(current_setting('app.current_user_id', true), ''), current_scope()->>'user_id', auth.uid()::text)
  );

DROP POLICY IF EXISTS "m_users_insert" ON m_users;
CREATE POLICY "m_users_insert"
  ON m_users FOR INSERT
  WITH CHECK (has_role('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS "m_users_update" ON m_users;
CREATE POLICY "m_users_update"
  ON m_users FOR UPDATE
  USING (has_role('SYSTEM_ADMIN'))
  WITH CHECK (has_role('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS "m_users_delete" ON m_users;
CREATE POLICY "m_users_delete"
  ON m_users FOR DELETE
  USING (has_role('SYSTEM_ADMIN'));

-- 13.2 m_user_invitations
DROP POLICY IF EXISTS "m_user_invitations_select" ON m_user_invitations;
CREATE POLICY "m_user_invitations_select"
  ON m_user_invitations FOR SELECT
  USING (
    has_role('SYSTEM_ADMIN')
    OR (has_role('APPROVER') AND role = 'APPROVER'::user_role)
  );

DROP POLICY IF EXISTS "m_user_invitations_insert" ON m_user_invitations;
CREATE POLICY "m_user_invitations_insert"
  ON m_user_invitations FOR INSERT
  WITH CHECK (has_role('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS "m_user_invitations_update" ON m_user_invitations;
CREATE POLICY "m_user_invitations_update"
  ON m_user_invitations FOR UPDATE
  USING (
    has_role('SYSTEM_ADMIN')
    OR (has_role('APPROVER') AND role = 'APPROVER'::user_role)
  )
  WITH CHECK (
    has_role('SYSTEM_ADMIN')
    OR (has_role('APPROVER') AND role = 'APPROVER'::user_role)
  );

DROP POLICY IF EXISTS "m_user_invitations_delete" ON m_user_invitations;
CREATE POLICY "m_user_invitations_delete"
  ON m_user_invitations FOR DELETE
  USING (has_role('SYSTEM_ADMIN'));

-- 13.3 m_user_permissions
DROP POLICY IF EXISTS "m_user_permissions_select" ON m_user_permissions;
CREATE POLICY "m_user_permissions_select"
  ON m_user_permissions FOR SELECT
  USING (
    has_role('SYSTEM_ADMIN')
    OR user_id = coalesce(nullif(current_setting('app.current_user_id', true), ''), current_scope()->>'user_id', auth.uid()::text)
  );

DROP POLICY IF EXISTS "m_user_permissions_insert" ON m_user_permissions;
CREATE POLICY "m_user_permissions_insert"
  ON m_user_permissions FOR INSERT
  WITH CHECK (has_role('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS "m_user_permissions_update" ON m_user_permissions;
CREATE POLICY "m_user_permissions_update"
  ON m_user_permissions FOR UPDATE
  USING (has_role('SYSTEM_ADMIN'))
  WITH CHECK (has_role('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS "m_user_permissions_delete" ON m_user_permissions;
CREATE POLICY "m_user_permissions_delete"
  ON m_user_permissions FOR DELETE
  USING (has_role('SYSTEM_ADMIN'));

-- 13.4 t_security_logs
DROP POLICY IF EXISTS "t_security_logs_select" ON t_security_logs;
CREATE POLICY "t_security_logs_select"
  ON t_security_logs FOR SELECT
  USING (has_role('SYSTEM_ADMIN') OR has_role('VIEWER'));

DROP POLICY IF EXISTS "t_security_logs_insert" ON t_security_logs;
CREATE POLICY "t_security_logs_insert"
  ON t_security_logs FOR INSERT
  WITH CHECK (true);

-- 14. SEED DATA MATCHING 10 TEST USERS (+2 EXTENDED) IN synthetic-seed.ts
INSERT INTO m_users (user_id, email, full_name, failed_login_count, lockout_until, is_active)
VALUES
  ('usr-sysadmin-01', 'sysadmin@example.test', 'System Admin', 0, NULL, true),
  ('usr-admin-01', 'admin@example.test', 'Warehouse Keeper Admin', 0, NULL, true),
  ('usr-rm-01', 'rm@example.test', 'Restaurant Manager Delhi', 0, NULL, true),
  ('usr-kitchen-01', 'kitchen@example.test', 'Kitchen Section Requester', 0, NULL, true),
  ('usr-bar-01', 'bar@example.test', 'Bar Section Requester', 0, NULL, true),
  ('usr-cheese-01', 'cheese@example.test', 'Cheese Section Requester', 0, NULL, true),
  ('usr-runner-01', 'runner@example.test', 'Kitchen Runner', 0, NULL, true),
  ('usr-custodian-01', 'custodian@example.test', 'Cold Room Custodian', 0, NULL, true),
  ('usr-accountant-01', 'accountant@example.test', 'Store Accountant', 0, NULL, true),
  ('usr-approver-01', 'approver@example.test', 'Financial Controller Approver', 0, NULL, true),
  ('usr-scm-01', 'scm@example.test', 'Supply Chain Lead', 0, NULL, true),
  ('usr-viewer-01', 'viewer@example.test', 'Internal Auditor Viewer', 0, NULL, true)
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  is_active = EXCLUDED.is_active;

INSERT INTO m_user_permissions (permission_id, user_id, role, store_id, warehouse_id, section_id)
VALUES
  ('perm-sysadmin-01', 'usr-sysadmin-01', 'SYSTEM_ADMIN'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
  ('perm-admin-01', 'usr-admin-01', 'ADMIN'::user_role, 'IND-DEL-01', 'WH-DEL01-DRY', 'ALL'::section_id),
  ('perm-rm-01', 'usr-rm-01', 'RM'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
  ('perm-kitchen-01', 'usr-kitchen-01', 'KITCHEN_REQ'::user_role, 'IND-DEL-01', NULL, 'KITCHEN'::section_id),
  ('perm-bar-01', 'usr-bar-01', 'BAR_REQ'::user_role, 'IND-DEL-01', NULL, 'BAR'::section_id),
  ('perm-cheese-01', 'usr-cheese-01', 'CHEESE_REQ'::user_role, 'IND-DEL-01', NULL, 'CHEESE'::section_id),
  ('perm-runner-01', 'usr-runner-01', 'RUNNER'::user_role, 'IND-DEL-01', NULL, 'KITCHEN'::section_id),
  ('perm-custodian-01', 'usr-custodian-01', 'CUSTODIAN'::user_role, 'IND-DEL-01', 'WH-DEL01-COLD', 'ALL'::section_id),
  ('perm-accountant-01', 'usr-accountant-01', 'ACCOUNTANT'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
  ('perm-approver-01', 'usr-approver-01', 'APPROVER'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
  ('perm-scm-01', 'usr-scm-01', 'SCM'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id),
  ('perm-viewer-01', 'usr-viewer-01', 'VIEWER'::user_role, 'IND-DEL-01', NULL, 'ALL'::section_id)
ON CONFLICT (permission_id) DO UPDATE SET
  role = EXCLUDED.role,
  store_id = EXCLUDED.store_id,
  warehouse_id = EXCLUDED.warehouse_id,
  section_id = EXCLUDED.section_id;

-- 15. PERMISSIONS & FUNCTION GRANTS
GRANT SELECT ON m_users, m_user_invitations, m_user_permissions, t_security_logs TO authenticated, anon;
GRANT INSERT ON t_security_logs TO authenticated, anon;
GRANT EXECUTE ON FUNCTION create_user_invitation(text, user_role, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_approver_invitation(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION second_approve_invitation(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION record_failed_login(text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION record_login_success(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION unlock_user_account(text) TO authenticated;
GRANT EXECUTE ON FUNCTION is_account_locked(text) TO authenticated, anon;
