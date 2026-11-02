# Database Domain: Identity, Permissions & Auth (D2)

## 1. Domain Overview
The Identity, Permissions, and Access Control domain implements **Flow 0** (Users, Roles, Access & Lifecycle) and governs security for the Pizza 4P's India Inventory Control Tool.

It establishes:
- Staff identity master records (`m_users`) with credentials strictly decoupled (delegated to Supabase Auth `auth.users`; zero password hashes in application tables).
- Scoped permissions (`m_user_permissions`) implementing the core access paradigm: **Permission = Role + Scope (`store_id`, `warehouse_id`, `section_id`)**.
- Controlled onboarding invitations (`m_user_invitations`) enforcing mandatory second independent approval for executive authorizers (`APPROVER` role).
- Immutable security audit logging (`t_security_logs`) recording authentication events, lockouts, and administrative actions.
- Account lockout defense against credential stuffing and brute-force attempts.

All identity schemas strictly enforce **quantities and operational data only**: zero valuation, commercial rate, tax, or external vendor billing fields exist in these schemas.

---

## 2. Relational Schema & Tables

### 2.1 `m_users`
Application-tier profile record for staff members. Authenticated login is handled via Supabase Auth (`auth.users`).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `user_id` | `text` | `PRIMARY KEY` | Stable user identifier (e.g., `usr-sysadmin-01`, `usr-kitchen-01`). Matches JWT `sub` / session identity. |
| `email` | `text` | `NOT NULL UNIQUE` | Official email address; primary login identity. Case-insensitively matched. |
| `full_name` | `text` | `NOT NULL` | Full display name of the staff member. |
| `failed_login_count` | `integer` | `NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0)` | Consecutive failed authentication attempts. |
| `lockout_until` | `timestamptz` | `NULL` | Lockout expiration timestamp. Set when failed attempts reach threshold. |
| `is_active` | `boolean` | `NOT NULL DEFAULT true` | Active account status flag. Revoked upon resignation or staff departure. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT clock_timestamp()` | Profile creation timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT clock_timestamp()` | Profile update timestamp. |

- **Security Invariant:** No password or hash column is stored in `m_users`. Passwords reside exclusively in Supabase Auth (`auth.users`).

### 2.2 `m_user_invitations`
Tracks the invitation lifecycle for new staff onboarding (Flow 0 Steps U3, U4).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `invitation_id` | `text` | `PRIMARY KEY DEFAULT ('inv-' \|\| uuid_generate_v4())` | Unique invitation reference. |
| `email` | `text` | `NOT NULL` | Destination email for onboarding token. |
| `role` | `user_role` | `NOT NULL` | Role to be provisioned upon activation. |
| `store_id` | `text` | `NOT NULL` | Store scope assigned to the user. |
| `activation_token` | `text` | `NOT NULL UNIQUE` | Cryptographically random single-use token. |
| `expires_at` | `timestamptz` | `NOT NULL` | Expiry deadline (default: 48 hours). |
| `status` | `invitation_status` | `NOT NULL DEFAULT 'PENDING'` | Lifecycle state: `PENDING_SECOND_APPROVAL`, `PENDING`, `ACTIVATED`, `EXPIRED`. |
| `invited_by_user_id`| `text` | `REFERENCES m_users(user_id)` | System Administrator who initiated invitation. |
| `second_approved_by`| `text` | `REFERENCES m_users(user_id)` | Executive who provided mandatory second approval for `APPROVER` role. |
| `second_approved_at`| `timestamptz`| `NULL` | Timestamp when second approval was granted. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT clock_timestamp()` | Invitation dispatch timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT clock_timestamp()` | Status update timestamp. |

- **Table Constraints:**
  - `chk_approver_second_approval`: Enforces that `role = 'APPROVER'` cannot transition to `PENDING` unless `second_approved_by` is not null.
  - `chk_segregation_second_approval`: Enforces segregation of duties (`invited_by_user_id != second_approved_by`).

### 2.3 `m_user_permissions`
Relates staff members to roles and geographical / operational scopes.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `permission_id` | `text` | `PRIMARY KEY DEFAULT ('perm-' \|\| uuid_generate_v4())` | Unique permission assignment reference. |
| `user_id` | `text` | `NOT NULL REFERENCES m_users(user_id) ON DELETE CASCADE` | Assigned staff user. |
| `role` | `user_role` | `NOT NULL` | Prescribed operational role (12 roles defined in `0001`). |
| `store_id` | `text` | `NOT NULL` | Operating store code (e.g. `IND-DEL-01`). |
| `warehouse_id` | `text` | `NULL` | Optional warehouse storeroom scope (`WH-DEL01-COLD`, `WH-DEL01-DRY`). |
| `section_id` | `section_id` | `NOT NULL DEFAULT 'ALL'` | Store section scope (`KITCHEN`, `BAR`, `CHEESE`, `ALL`). |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT clock_timestamp()` | Assignment timestamp. |

- **Unique Constraint:** `uq_user_permission` on `(user_id, role, store_id, section_id)`.

### 2.4 `t_security_logs`
Immutable, append-only security and access audit trail (Flow 0 Step U13, Step U11).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `log_id` | `text` | `PRIMARY KEY DEFAULT ('sec-' \|\| uuid_generate_v4())` | Audit log record ID. |
| `user_id` | `text` | `REFERENCES m_users(user_id) ON DELETE SET NULL` | Subject user identifier (or NULL for failed unknown email logins). |
| `event_type` | `security_event_type` | `NOT NULL` | Audit event: `INVITATION_SENT`, `PASSWORD_SET`, `LOGIN_SUCCESS`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `PASSWORD_RESET`, `DEACTIVATION`. |
| `ip_address` | `text` | `NULL` | Caller IP address. |
| `device_info` | `text` | `NULL` | Client user agent or structured narrative description. |
| `timestamp` | `timestamptz` | `NOT NULL DEFAULT clock_timestamp()` | Immutably generated audit timestamp. |

- **Immutability Enforcement:** Trigger `trg_prevent_security_log_mutation` rejects any `UPDATE` or `DELETE` with: `'Security logs are append-only and cannot be updated or deleted.'`

---

## 3. Stored Procedures & Business Logic

### 3.1 `create_user_invitation` (Rule 1.2.1 & Rule 1.2.2)
- **Signature:** `create_user_invitation(p_email text, p_role user_role, p_store_id text, p_expires_in_hours integer DEFAULT 48) RETURNS jsonb`
- **Security:** `SECURITY DEFINER`, `search_path = public, pg_temp`.
- **Role Verification:** Strictly checks `has_role('SYSTEM_ADMIN')`. Any other role is aborted with: `'Unauthorized: Only SYSTEM_ADMIN can invite users and create accounts.'`
- **Rule 1.2.2 Execution:**
  - If `p_role == 'APPROVER'`: Sets initial status to `'PENDING_SECOND_APPROVAL'`. Activation token email is withheld pending second sign-off.
  - If `p_role != 'APPROVER'`: Sets initial status to `'PENDING'`.
- **Audit Logging:** Inserts `INVITATION_SENT` audit record into `t_security_logs`.

### 3.2 `approve_approver_invitation` (Rule 1.2.2 & 1.2.3)
- **Signature:** `approve_approver_invitation(p_invitation_id text, p_approver_user_id text DEFAULT NULL) RETURNS jsonb`
- **Alias:** `second_approve_invitation(text, text)`
- **Security:** `SECURITY DEFINER`, `search_path = public, pg_temp`.
- **Authorization:** Requires caller to have `SYSTEM_ADMIN` or `APPROVER` role.
- **Segregation of Duties Check:** Verified against `m_user_invitations.invited_by_user_id`:
  - `CHECK (invited_by_user_id != approver_id)`
  - Raises: `'Segregation of duties violation: Creator cannot second-approve the same APPROVER invitation'`.
- **Transition:** Sets `status = 'PENDING'`, `second_approved_by = approver_id`, and `second_approved_at = clock_timestamp()`.
- **Audit:** Records `INVITATION_SENT` log with approver identity.

### 3.3 Lockout Counter Helpers (Flow 0 Steps U10, U12, U13, U7)
1. **`record_failed_login(p_email, p_max_attempts DEFAULT 5, p_lockout_duration_minutes DEFAULT 30)`:**
   - Increments `m_users.failed_login_count`.
   - If count >= `p_max_attempts`: Sets `lockout_until = clock_timestamp() + duration` and logs `ACCOUNT_LOCKED`.
   - Else: Logs `LOGIN_FAILED`.
2. **`record_login_success(p_email)`:**
   - Validates that account is not locked (`lockout_until > now()`) and is active.
   - Resets `failed_login_count = 0` and `lockout_until = NULL`.
   - Logs `LOGIN_SUCCESS`.
3. **`unlock_user_account(p_user_id)`:**
   - Strictly requires `SYSTEM_ADMIN` role (`has_role('SYSTEM_ADMIN')`).
   - Resets lockout and counter to 0. Logs administrative reset to `t_security_logs`.
4. **`is_account_locked(p_email)`:**
   - STABLE helper returning boolean flag indicating whether the account is currently locked or inactive.

---

## 4. Row-Level Security (RLS) Policy Design

All four tables enforce Row-Level Security:

1. **`m_users`:**
   - `SELECT`: `has_role('SYSTEM_ADMIN')` OR `user_id = current_scope()->>'user_id'` (staff can inspect their own profile; admins can inspect all).
   - `INSERT / UPDATE / DELETE`: Strictly restricted to `has_role('SYSTEM_ADMIN')`.
2. **`m_user_invitations`:**
   - `SELECT`: `has_role('SYSTEM_ADMIN')` OR (`has_role('APPROVER') AND role = 'APPROVER'`).
   - `INSERT / DELETE`: Strictly restricted to `has_role('SYSTEM_ADMIN')`.
   - `UPDATE`: Restricted to `SYSTEM_ADMIN` and `APPROVER` (for second approval).
3. **`m_user_permissions`:**
   - `SELECT`: `has_role('SYSTEM_ADMIN')` OR `user_id = current_scope()->>'user_id'`.
   - `INSERT / UPDATE / DELETE`: Strictly restricted to `has_role('SYSTEM_ADMIN')`.
4. **`t_security_logs`:**
   - `SELECT`: `has_role('SYSTEM_ADMIN')` OR `has_role('VIEWER')` (Internal Auditor read access).
   - `INSERT`: `WITH CHECK (true)` (all authenticated and system actions can append).
   - `UPDATE / DELETE`: Forbidden. No policy exists and explicit REVOKE + trigger blocks mutations.

---

## 5. Seed Data Reference

Seeded deterministically from `lib/testing/synthetic-seed.ts`:

| User ID | Email | Role | Store ID | Warehouse Scope | Section Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `usr-sysadmin-01` | `sysadmin@example.test` | `SYSTEM_ADMIN` | `IND-DEL-01` | NULL | `ALL` |
| `usr-admin-01` | `admin@example.test` | `ADMIN` | `IND-DEL-01` | `WH-DEL01-DRY` | `ALL` |
| `usr-rm-01` | `rm@example.test` | `RM` | `IND-DEL-01` | NULL | `ALL` |
| `usr-kitchen-01` | `kitchen@example.test` | `KITCHEN_REQ` | `IND-DEL-01` | NULL | `KITCHEN` |
| `usr-bar-01` | `bar@example.test` | `BAR_REQ` | `IND-DEL-01` | NULL | `BAR` |
| `usr-cheese-01` | `cheese@example.test` | `CHEESE_REQ` | `IND-DEL-01` | NULL | `CHEESE` |
| `usr-runner-01` | `runner@example.test` | `RUNNER` | `IND-DEL-01` | NULL | `KITCHEN` |
| `usr-custodian-01` | `custodian@example.test` | `CUSTODIAN` | `IND-DEL-01` | `WH-DEL01-COLD`| `ALL` |
| `usr-accountant-01`| `accountant@example.test`| `ACCOUNTANT` | `IND-DEL-01` | NULL | `ALL` |
| `usr-approver-01` | `approver@example.test` | `APPROVER` | `IND-DEL-01` | NULL | `ALL` |
| `usr-scm-01` | `scm@example.test` | `SCM` | `IND-DEL-01` | NULL | `ALL` |
| `usr-viewer-01` | `viewer@example.test` | `VIEWER` | `IND-DEL-01` | NULL | `ALL` |

---

## 6. Verification & Test Suite
Verified via pgTAP test suite at `supabase/tests/0020_identity.sql`:
- **44 assertions** executed against local Supabase PostgreSQL.
- Coverage includes table/column existence, password_hash absence, RLS enablement and frontline isolation, seed user roles, append-only trigger enforcement, Rule 1.2.1 invite authorization, Rule 1.2.2 dual-approval lifecycle & segregation of duties, and account lockout threshold handling.
