# H1 Security Review: Architecture, Stored Procedures, API Endpoints & Access Control

**Review Target:** Pizza 4P's Physical Inventory Control System  
**Audit Scope:** PostgreSQL RPC Stored Procedures, Next.js Server Route Handlers (`app/api/*`), Query Safety / PostgREST Injection, Token Lifecycle & Rate Limiting, and Environment Secret Management.  
**Operational Rule Enforcement:** Strict physical inventory quantities only. Zero commercial figures, monetary units, or external supplier references.

---

## 1. Executive Summary & Audit Scorecard

This comprehensive security review evaluates the database security posture, server-side route handlers, query execution pipelines, token validation mechanics, and secret management across the codebase.

The system demonstrates strong architectural defenses in core areas:
- 100% of the 42 `SECURITY DEFINER` stored procedures define an explicit `search_path` configuration, neutralizing default schema search hijacking.
- Comprehensive immutable audit logging triggers protect ledger tables (`t_stock_movements`, `t_security_logs`, `t_daily_balances`, `t_transfers_intransit`).
- Zero hardcoded production secrets or private keys are present in repository tracking.
- Strong passwordless user onboarding models with cryptographically secure random token generation (256-bit entropy).

However, critical and high-severity security vulnerabilities were identified across server route handlers, client-side token activation logic, database execution grants to anonymous roles, and PostgREST filter interpolation.

### Vulnerability Summary Matrix

| ID | Title | Severity | Impacted File & Line | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Unauthenticated Public Access & Role Escalation via Service Key | **CRITICAL** | `app/api/invitations/route.ts:43-110` | Confirmed Defect |
| **SEC-02** | Origin Header Injection & Global Environment Poisoning | **CRITICAL** | `app/api/invitations/route.ts:122-133` | Confirmed Defect |
| **SEC-03** | Complete Token Validation Bypass in Account Activation | **CRITICAL** | `lib/data/users.ts:976,999` | Confirmed Defect |
| **SEC-04** | Anonymous Execution Privilege on SAP Batch Commit & Corrections | **HIGH** | `supabase/migrations/0120_sap_staging.sql:844-846` | Confirmed Defect |
| **SEC-05** | Denial of Service & User Enumeration via Anonymous Login RPCs | **HIGH** | `supabase/migrations/0020_identity_permissions.sql:491-596,811-814` | Confirmed Defect |
| **SEC-06** | Ephemeral In-Memory Rate Limiting & Client IP Forgery | **HIGH** | `app/api/invitations/route.ts:45-48`, `lib/email/invitations.ts:27-52` | Confirmed Defect |
| **SEC-07** | Unauthenticated SAP Import Commit with Caller ID Spoofing | **HIGH** | `app/api/grpo/commit/route.ts:7-38` | Confirmed Defect |
| **SEC-08** | Incomplete `search_path` Pinning Across 24 Stored Procedures | **MEDIUM** | `supabase/migrations/0020_identity_permissions.sql:328`, `0080_daily_balance.sql:277`, `0100_transfers.sql:88` | Confirmed Defect |
| **SEC-09** | Session Setting Overrides (`app.current_role`) in Authorization Logic | **MEDIUM** | `supabase/migrations/0001_extensions_roles_helpers.sql:291-296`, `0020_identity_permissions.sql:259-264` | Architectural Risk |
| **SEC-10** | Unsanitized PostgREST Filter Interpolation in `.or()` Queries | **MEDIUM** | `lib/data/transfers.ts:670`, `lib/data/approvals.ts:356` | Confirmed Defect |
| **SEC-11** | Unauthenticated Unbounded File Upload & Synchronous Parsing DoS | **MEDIUM** | `app/api/grpo/parse/route.ts:6-44` | Confirmed Defect |
| **SEC-12** | Missing `NEXT_PUBLIC_APP_URL` in `.env.example` Template | **LOW** | `.env.example:1-15` | Configuration Defect |
| **SEC-13** | Non-Constant-Time Bearer Token Verification in Background Worker Auth | **LOW** | `lib/cron/auth.ts:27` | Hardening Gap |

---

## 2. PostgreSQL RPC Security & Search Path Pinning

### 2.1 Complete Inventory of `SECURITY DEFINER` Stored Procedures
Every stored procedure operating under `SECURITY DEFINER` executes with the privileges of the function creator (typically database superuser/admin). If `search_path` is omitted or improperly configured, unprivileged users can create malicious objects in public or temporary schemas that are executed by the privileged procedure.

Across the 14 migrations, exactly 42 functions declare `SECURITY DEFINER`. Every one of the 42 functions declares an explicit `SET search_path`:

```
Total Stored Procedures Audited: 42
- Fully Pinned (SET search_path = public, auth, pg_temp): 18 functions
- Partially Pinned (SET search_path = public, pg_temp):   18 functions
- Partially Pinned (SET search_path = public, auth):       6 functions
- Unpinned (No search_path specified):                     0 functions
```

#### Detailed Breakdown by Domain Migration:

1. **`0001_extensions_roles_helpers.sql`** (All use `SET search_path = public, pg_temp`):
   - `current_scope()` (line 185)
   - `has_role(required_role text)` (line 273)
   - `current_store_id()` (line 351)
   - `current_warehouse_id()` (line 376)
2. **`0020_identity_permissions.sql`** (All use `SET search_path = public, pg_temp`):
   - `current_scope()` (line 156)
   - `has_role(required_role text)` (line 240)
   - `create_user_invitation(text, user_role, text, integer)` (line 319)
   - `approve_approver_invitation(text, text)` (line 401)
   - `second_approve_invitation(text, text)` (line 476)
   - `record_failed_login(text, integer, integer)` (line 491)
   - `record_login_success(text)` (line 557)
   - `unlock_user_account(text)` (line 599)
   - `is_account_locked(text)` (line 640)
3. **`0040_ledger_core_views.sql`** (All use `SET search_path = public, pg_temp`):
   - `get_suggested_reorder(text, text, text)` (line 158)
   - `calculate_adu(text, text, text, int)` (line 209)
4. **`0050_requests.sql`** (All use `SET search_path = public, auth, pg_temp`):
   - `is_store_issue_window_open(text, timestamptz)` (line 199)
   - `create_section_request(text, text, jsonb, text)` (line 262)
   - `update_section_request(uuid, jsonb)` (line 457)
   - `cancel_section_request(uuid)` (line 599)
   - `begin_request_picking(uuid)` (line 669)
5. **`0060_issue_confirmation.sql`** (All use `SET search_path = public, auth, pg_temp`):
   - `stage_issue(uuid, jsonb)` (line 16)
   - `confirm_issue(uuid, jsonb, jsonb)` (line 261)
   - `decline_issue(uuid, text)` (line 579)
6. **`0070_custody_handover.sql`** (All use `SET search_path = public, pg_temp`):
   - `record_custody_event(text, text, text, text)` (line 147)
   - `transfer_shift_custody(text, text, uuid, text, text)` (line 241)
7. **`0080_daily_balance.sql`** (All use `SET search_path = public, auth`):
   - `submit_daily_balance(text, text, jsonb, boolean)` (line 268)
   - `sign_off_daily_balance(uuid, text)` (line 488)
8. **`0090_stock_count_reconcile.sql`** (All use `SET search_path = public, auth, pg_temp`):
   - `initiate_stock_count(text, text, text)` (line 278)
   - `submit_first_count(uuid, jsonb)` (line 426)
   - `submit_recount(uuid, jsonb)` (line 594)
   - `approve_stock_adjustment(uuid, text)` (line 727)
9. **`0100_transfers.sql`** (All use `SET search_path = public, auth`):
   - `dispatch_store_transfer(text, text, text, text, text, numeric, numeric, text)` (line 75)
   - `receive_store_transfer(uuid, numeric, numeric)` (line 277)
   - `approve_transfer_variance(uuid, text)` (line 434)
   - `reject_transfer_variance(uuid, text)` (line 548)
10. **`0110_waste_returns.sql`** (All use `SET search_path = public, auth, pg_temp`):
    - `log_waste_or_return(text, text, text, numeric, text, text, text, text)` (line 210)
    - `approve_waste_or_return(uuid, text)` (line 370)
11. **`0120_sap_staging.sql`** (All use `SET search_path = public, auth, pg_temp`):
    - `commit_grpo_import_batch(uuid, jsonb)` (line 318)
    - `approve_grpo_correction(uuid, text)` (line 627)
    - `reject_grpo_correction(uuid, text)` (line 775)
12. **`0130_approvals_inbox.sql`** (All use `SET search_path = public, auth, pg_temp`):
    - `propose_store_or_warehouse(text, text, text, text, uuid, uuid)` (line 285)
    - `decide_store_warehouse_proposal(uuid, text, text)` (line 436)

---

### 2.2 Finding SEC-08: Incomplete Search Path Pinning & Temporary Schema Shadowing
- **Severity:** Medium
- **Citations:**
  - `0001_extensions_roles_helpers.sql:190,278,356,381`
  - `0020_identity_permissions.sql:161,245,328,408,483,499,561,603,645`
  - `0040_ledger_core_views.sql:167,219`
  - `0070_custody_handover.sql:156,251`
  - `0080_daily_balance.sql:277,495`
  - `0100_transfers.sql:88,285,441,555`

#### Technical Analysis:
Two distinct inconsistencies exist across the migrations:
1. **Omission of `auth` schema:** In migrations `0001`, `0020`, `0040`, and `0070`, functions define `SET search_path = public, pg_temp`. These functions frequently invoke `auth.uid()` or `auth.jwt()`. While schema-prefixed calls resolve, unqualified lookups to authentication helpers or views fail if not qualified.
2. **Omission of `pg_temp` (CVE-2007-6600 pattern):** In migrations `0080` and `0100`, functions specify `SET search_path = public, auth`. In PostgreSQL, if `pg_temp` is not explicitly listed in `search_path`, PostgreSQL places the temporary table schema `pg_temp` *first* in search precedence. An authenticated user able to create temporary tables or functions can define objects shadowing core tables, which the `SECURITY DEFINER` function executes.

#### Recommended Remediation:
Standardize all 42 stored procedures to uniform pinning:
```sql
ALTER FUNCTION public.<function_name>(...) SET search_path = public, auth, pg_temp;
```

---

### 2.3 Finding SEC-04: Anonymous Role Execution Grants on SAP Batch Procedures
- **Severity:** High
- **Citations:** `supabase/migrations/0120_sap_staging.sql:844-847`

#### Technical Analysis:
Lines 844-847 grant explicit execution permissions to the unauthenticated `anon` role:
```sql
GRANT EXECUTE ON FUNCTION public.commit_grpo_import_batch(uuid, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.approve_grpo_correction(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.reject_grpo_correction(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.tg_prevent_grpo_staging_error_mutation() TO authenticated, anon;
```
Exposing internal staging batch commitments and stock correction approvals to unauthenticated API callers violates the principle of least privilege. Even though internal role checks (`has_role('ADMIN')`) exist inside the PL/pgSQL body, public API exposure expands the attack surface for automated fuzzing, denial-of-service, and potential bypass via session parameter manipulation.

#### Recommended Remediation:
Revoke execute grants from `anon` across all SAP staging procedures:
```sql
REVOKE EXECUTE ON FUNCTION public.commit_grpo_import_batch(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_grpo_correction(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_grpo_correction(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_prevent_grpo_staging_error_mutation() FROM anon;
```

---

### 2.4 Finding SEC-05: Account Lockout Manipulation & Denial of Service via Anonymous RPCs
- **Severity:** High
- **Citations:** `supabase/migrations/0020_identity_permissions.sql:491-596, 811-814`

#### Technical Analysis:
Lines 811-814 expose `record_failed_login` and `record_login_success` to `anon`:
```sql
GRANT EXECUTE ON FUNCTION record_failed_login(text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION record_login_success(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_account_locked(text) TO authenticated, anon;
```

1. **Arbitrary Account Lockout (Denial of Service):**  
   In `record_failed_login`:
   ```sql
   CREATE OR REPLACE FUNCTION record_failed_login(
     p_email text,
     p_max_attempts integer DEFAULT 5,
     p_lockout_duration_minutes integer DEFAULT 30
   )
   ```
   An unauthenticated caller can invoke this RPC via Supabase PostgREST with `p_max_attempts: 1` and `p_lockout_duration_minutes: 525600`. A single request instantly locks out any targeted user or administrator for an entire year.

2. **Lockout Counter Reset & Tampering:**  
   In `record_login_success(p_email text)`:
   The procedure resets `failed_login_count = 0` and `lockout_until = NULL` without verifying credentials or passwords. A brute-force attacker can call `record_login_success` after every 4 failed password attempts to evade lockout completely, while polluting the append-only `t_security_logs` with falsified `'LOGIN_SUCCESS'` records.

3. **User Enumeration:**  
   `record_login_success` throws `'User not found for email: %'` if the address does not exist, enabling trivial enumeration of valid employee email addresses.

#### Recommended Remediation:
1. Revoke `anon` execution from `record_failed_login` and `record_login_success`.
2. Restrict invocation strictly to trusted server-side authentication flows using `service_role`.
3. Hardcode maximum retry limits and lockout intervals inside the database procedure rather than accepting caller-supplied arguments.

---

### 2.5 Finding SEC-09: Session Configuration GUC Backdoors (`app.current_role`)
- **Severity:** Medium
- **Citations:**
  - `supabase/migrations/0001_extensions_roles_helpers.sql:291-296`
  - `supabase/migrations/0020_identity_permissions.sql:259-264`
  - `supabase/migrations/0050_requests.sql:217-219`

#### Technical Analysis:
In `has_role(required_role text)`, authorization logic begins with:
```sql
IF nullif(current_setting('app.current_role', true), '') IS NOT NULL THEN
  IF upper(current_setting('app.current_role', true)) = upper(required_role) THEN
    RETURN true;
  END IF;
END IF;
```
Similarly, `0050_requests.sql` line 217 overrides store issue time windows if `app.test_inside_window` is populated.

These GUC settings were introduced to facilitate deterministic testing harness scripts. However, in production environments:
- If connection pooling (e.g., PgBouncer transaction mode) does not discard session state (`DISCARD ALL`), settings can leak between connections.
- If any SQL injection or parameter setting allows executing `SET app.current_role = 'SYSTEM_ADMIN'`, all role checks across the entire application collapse.

#### Recommended Remediation:
Disable session variable overrides in production by conditioning them on a build environment flag or restricting them to non-production database branches.

---

## 3. SQL Injection & Query Safety Audit

### 3.1 Dynamic Query Inspection (`EXECUTE` statements)
A full repository audit for dynamic PL/pgSQL statements identified only four `EXECUTE` invocations across migrations:
- `0001_extensions_roles_helpers.sql:252-257, 333-338`
- `0020_identity_permissions.sql:221-226, 302-307`

Both instances follow secure parameterized query conventions:
```sql
EXECUTE 'SELECT EXISTS (
           SELECT 1 FROM public.m_user_permissions
           WHERE user_id = $1 AND upper(role::text) = upper($2)
         )'
INTO has_perm
USING v_user_id, required_role;
```
No dynamic SQL string concatenation (`format('%s', ...)` or string interpolation) is used inside database stored procedures.

### 3.2 Finding SEC-10: PostgREST Filter Injection via Template Interpolation
- **Severity:** Medium
- **Citations:**
  - `lib/data/transfers.ts:670`
  - `lib/data/approvals.ts:356`

#### Technical Analysis:
In `lib/data/transfers.ts:670`:
```ts
query = query.or(`source_store_id.eq.${storeId},target_store_id.eq.${storeId}`);
```
In `lib/data/approvals.ts:356`:
```ts
query = query.or(`store_id.eq.${storeId},store_id.is.null`);
```

PostgREST parses comma-separated clauses inside `.or()` filters as distinct boolean branches. If `storeId` originates from an unvalidated request query parameter containing commas, parentheses, or operators (e.g., `IND-DEL-01,source_store_id.neq.NULL`), the generated PostgREST request structure is altered. This can cause store-level isolation boundaries to be bypassed in client queries.

#### Recommended Remediation:
Validate `storeId` against an alphanumeric identifier pattern prior to query construction:
```ts
if (!/^[A-Z0-9_-]+$/i.test(storeId)) {
  throw new Error('Invalid store identifier format');
}
```

---

## 4. Next.js Server Route Handlers (`app/api/*`)

Six server route handlers exist in the application:
1. `app/api/invitations/route.ts`
2. `app/api/grpo/commit/route.ts`
3. `app/api/grpo/parse/route.ts`
4. `app/api/cron/keepalive/route.ts`
5. `app/api/cron/backup/route.ts`
6. `app/api/cron/escalate-variances/route.ts`

### 4.1 Finding SEC-01: Unauthenticated Public Access & Role Escalation via Service Key
- **Severity:** Critical
- **Citations:** `app/api/invitations/route.ts:29-41, 43-110`

#### Technical Analysis:
1. **Missing Authentication:** `POST /api/invitations` accepts requests without checking for an active session, bearer token, or authorization header.
2. **Privilege Escalation:** If `SUPABASE_SERVICE_ROLE_KEY` is present in the environment (standard for production deployments), the route instantiates a Supabase administrative client:
   ```ts
   const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
   if (serviceRoleKey) {
     return createClient(supabaseUrl, serviceRoleKey, { ... });
   }
   ```
   When the handler invokes `create_user_invitation`, the database request executes under the `service_role` superuser context.
3. **Impact:** Any unauthenticated actor on the public internet can submit:
   ```json
   {
     "email": "attacker@external.test",
     "role": "SYSTEM_ADMIN",
     "storeId": "IND-DEL-01"
   }
   ```
   This generates a legitimate invitation for full `SYSTEM_ADMIN` privileges.

#### Recommended Remediation:
Extract and verify caller session credentials before processing:
```ts
const authHeader = request.headers.get('authorization');
const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}
```

---

### 4.2 Finding SEC-02: Origin Header Injection & Global Environment Poisoning
- **Severity:** Critical
- **Citations:** `app/api/invitations/route.ts:121-133`

#### Technical Analysis:
In `app/api/invitations/route.ts`:
```ts
let origin = 'http://localhost:3000';
try {
  const parsedUrl = new URL(request.url);
  origin = request.headers.get('origin') || parsedUrl.origin || process.env.NEXT_PUBLIC_APP_URL || origin;
} catch {
  origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || origin;
}

if (!process.env.NEXT_PUBLIC_APP_URL) {
  process.env.NEXT_PUBLIC_APP_URL = origin;
}
```

#### Exploit Mechanism:
1. An attacker sends a POST request with an arbitrary header: `Origin: https://malicious-phishing-site.example`.
2. The route reads `request.headers.get('origin')` and treats it as the trusted application origin.
3. If `NEXT_PUBLIC_APP_URL` was not declared in the environment at boot (which is missing in `.env.example`), the code mutates `process.env.NEXT_PUBLIC_APP_URL` across the shared Node.js runtime process.
4. When email dispatch formats the activation link (`${origin}/activate?token=${activationToken}`), the generated link directs the recipient to the attacker-controlled server.
5. The invited employee clicks the link, transmitting their cryptographically valid 256-bit activation token directly to the attacker.

#### Recommended Remediation:
1. Never permit client headers (`Origin`, `Host`, `X-Forwarded-Host`) to determine link destinations in transactional emails.
2. Require a strictly validated server environment variable (`APP_URL`) and fail if missing.
3. Remove runtime mutation of `process.env`.

---

### 4.3 Finding SEC-07: Unauthenticated SAP Import Commit with Caller ID Spoofing
- **Severity:** High
- **Citations:** `app/api/grpo/commit/route.ts:7-38`

#### Technical Analysis:
In `app/api/grpo/commit/route.ts`:
```ts
const body = await request.json();
const { importId, lines, storeId, fileName, fileHash, userId } = body;
...
uploaded_by_user_id: userId || '00000000-0000-0000-0000-000000000001',
```
The handler contains zero authentication or session verification. Furthermore, it blindly accepts `userId` from the unauthenticated JSON request payload and commits it to the database audit record as `uploaded_by_user_id`. Combined with Finding SEC-04 (`commit_grpo_import_batch` granted to `anon`), an unauthenticated client can trigger ledger-altering batch imports attributed to any legitimate user.

#### Recommended Remediation:
1. Enforce authenticated session verification on `POST /api/grpo/commit`.
2. Derive `userId` strictly from verified server session context (`user.id`), never from request payload fields.

---

### 4.4 Finding SEC-11: Unauthenticated Unbounded File Upload & Synchronous Parsing DoS
- **Severity:** Medium
- **Citations:** `app/api/grpo/parse/route.ts:6-44`

#### Technical Analysis:
1. `POST /api/grpo/parse` accepts multipart form-data without authentication.
2. There is no file size ceiling (`MAX_FILE_SIZE`).
3. Uploaded files are converted into an in-memory buffer (`Buffer.from(await file.arrayBuffer())`) and parsed synchronously using `xlsx` (SheetJS) on the main Node.js event loop thread.
4. An attacker submitting a large or heavily nested spreadsheet can saturate CPU and memory, blocking all concurrent request processing across the Next.js server instance.

#### Recommended Remediation:
1. Add caller authentication.
2. Impose a strict file size ceiling (e.g., 5 MB).
3. Offload workbook parsing to background worker pools or isolate processing with timeouts.

---

### 4.5 Background Cron Handlers (`/api/cron/*`) & Timing Attack Assessment
The three cron endpoints (`keepalive`, `backup`, `escalate-variances`) enforce authentication via `verifyCronAuth(request)`.
In `lib/cron/auth.ts:27`:
```ts
const providedToken = parts[1];
return providedToken === cronSecret;
```
Using standard equality `===` leaks timing differences based on matching prefix length. While network jitter mitigates exploitability over remote HTTP connections, high-assurance security standards require constant-time comparison:
```ts
import crypto from 'node:crypto';

export function verifyCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  ...
  const a = Buffer.from(providedToken);
  const b = Buffer.from(cronSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

---

## 5. Rate-Limiting & Token Lifecycle Validation

### 5.1 Finding SEC-06: In-Memory Rate Limiting Ephemerality & IP Forgery
- **Severity:** High
- **Citations:**
  - `app/api/invitations/route.ts:45-48`
  - `lib/email/invitations.ts:27-52`

#### Technical Analysis:
1. **IP Forgery:**  
   `app/api/invitations/route.ts:46` extracts the client IP:
   ```ts
   const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || ...;
   ```
   An attacker can spoof the client-provided `X-Forwarded-For` header with randomized IP values on every request, completely evading IP-based rate limits.
2. **Ephemeral Multi-Instance State:**  
   The rate limiter maintains tracking in local Node memory (`new Map<string, RateLimitTracker>()`). In multi-container, auto-scaling, or serverless deployments (Vercel, AWS ECS), each container or execution environment has an independent memory pool. Requests routed across distinct containers bypass the window threshold.
3. **Unbounded Memory Retention:**  
   Expired keys are never removed from `ipRateLimits` or `emailRateLimits`. High-volume traffic will steadily consume heap space.

#### Recommended Remediation:
1. Derive client IP only from trusted reverse-proxy headers (e.g., Cloudflare `CF-Connecting-IP` or verified proxy hops).
2. Utilize centralized persistence (Redis / Upstash KV) for distributed sliding-window rate limiting.

---

### 5.2 Finding SEC-03: Complete Token Validation Bypass in Account Activation
- **Severity:** Critical
- **Citations:** `lib/data/users.ts:976,999`

#### Technical Analysis:
The account activation routine `activateUserWithToken` exhibits critical structural flaws:

```ts
// lib/data/users.ts:976-999
const user = usersState.find((u) => u.token === token || u.status === 'pending');
if (user) {
  user.status = 'active';
  ...
  return { success: true, user_id: user.id, email: user.email };
}

return { success: true, user_id: 'usr-activated', email: 'activated@example.test' };
```

1. **Universal Token Match:**  
   `u.token === token || u.status === 'pending'` evaluates to `true` for any pending user record regardless of what `token` is supplied. An attacker providing an invalid token like `"abc"` or an empty string automatically activates the first pending user found.
2. **Unconditional Success Fallback:**  
   Line 999 guarantees that even if no user matches, the function returns `{ success: true, ... }`. It is impossible for `activateUserWithToken` to report failure.
3. **Missing Database Verification:**  
   The client routine never queries `m_user_invitations` to check `expires_at`, confirm `status = 'PENDING'`, or prevent token re-use. Single-use token invalidation is absent.

#### Recommended Remediation:
Execute token activation exclusively through a dedicated server-side endpoint or database stored procedure that atomically verifies token match, expiration, and transitions state to `ACTIVATED`.

---

## 6. Environment Configuration & Secrets Management

### 6.1 Audit of `.env.example` vs Source Code
Comparison between `.env.example` and repository variable usage identified:

- **Documented Variables (Configured correctly with placeholders):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CRON_SECRET`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
- **Missing Variable (Finding SEC-12):**
  - `NEXT_PUBLIC_APP_URL` is heavily referenced across `app/api/invitations/route.ts:125-132`, `lib/email/dev-catcher.ts:52,89`, and `lib/email/smtp.ts:259,281`, but is omitted from `.env.example`. This directly enables the Origin header poisoning vulnerability (SEC-02).

### 6.2 Hardcoded Secrets Scan
A complete regex scan across all code, tests, and configuration files confirmed:
- Zero active production API keys, database credentials, or private signing keys exist in git tracking.
- Test suites rely strictly on synthetic mock tokens (`eyJhbG...` dummy strings) and synthetic domains (`@example.test`).
- `.gitignore` properly excludes `.env`, `.env.local`, `.env.*.local`.

---

## 7. Remediation Action Plan

### Priority 1: Immediate Critical Hotfixes
1. **Secure `POST /api/invitations`:**
   - Require verified `SYSTEM_ADMIN` bearer session tokens.
   - Remove `request.headers.get('origin')` fallback; enforce a static server-configured domain.
2. **Remediate Activation Flow in `lib/data/users.ts`:**
   - Eliminate `u.status === 'pending'` fallback and line 999 unconditional success return.
   - Implement server-side verification against `m_user_invitations` (`activation_token = hash(input)`, `expires_at > now()`, `status = 'PENDING'`).
3. **Revoke Dangerous Anonymous Grants:**
   - Execute migration revoking `anon` execute permissions on `commit_grpo_import_batch`, `approve_grpo_correction`, `record_login_success`, and `record_failed_login`.

### Priority 2: High & Medium Hardening
1. **Secure `POST /api/grpo/commit` & `/api/grpo/parse`:**
   - Enforce authentication and role checks (`ADMIN`, `SCM`).
   - Derive uploader identity strictly from verified session claims.
   - Enforce a 5 MB upload ceiling on workbook parsing.
2. **Standardize Database Search Paths:**
   - Update the 24 stored procedures currently missing either `auth` or `pg_temp` to `SET search_path = public, auth, pg_temp`.
3. **Centralize Rate Limiting & Proxy IP Extraction:**
   - Replace in-memory Maps with Redis sliding-window limiters.
   - Disallow direct reliance on raw `X-Forwarded-For` headers.
4. **Sanitize PostgREST Query Filter Construction:**
   - Validate store identifiers with alphanumeric constraints before string interpolation into `.or()` filters.
