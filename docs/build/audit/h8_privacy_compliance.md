# H8 Privacy & Compliance Audit (DPDP / PDPD / GDPR)

**Audit Reference:** H8-PRIVACY-COMPLIANCE-001  
**Target Domains:** Flow 0 (Identity, Permissions & Auth), S1 (Invitations Dispatch), S4 (Audit Logging & Structured Logger)  
**Document Classification:** Internal Technical Audit & Regulatory Compliance Review  
**Inventory Control Principle:** Quantities only. Physical inventory counts and operational movements exclusively. Zero commercial metrics, monetary figures, regulatory levies, or external supplier billing records.

---

## 1. Executive Summary & Audit Scope

This compliance review audits the data privacy and security posture of the warehouse management system, focusing on staff personal data processing, synthetic test personas, credential isolation, and diagnostic log sanitization.

The audit assesses the application against four mandatory objectives:
1. **Statutory Privacy Framework Compliance:** Review of staff personal data handling under the India Digital Personal Data Protection Act, 2023 (DPDP), the Vietnam Personal Data Protection Decree (Decree 13/2023/ND-CP - PDPD), and the European Union General Data Protection Regulation (Regulation EU 2016/679 - GDPR).
2. **Synthetic Seed Persona Verification:** Verification that all seed, fixture, and demonstration accounts use synthetic role titles and are strictly constrained to the `@example.test` domain, containing zero real Personally Identifiable Information (PII).
3. **Application Credential & Credential Isolation Verification:** Verification that `public.m_users` stores zero password hashes, encryption salts, or plaintext credentials, with all authentication delegated to isolated auth infrastructure.
4. **Diagnostic Logger Redaction & Secret Sanitization:** Verification that the structured JSON logger and security dispatcher scrub all tokens, bearer credentials, authorization headers, passwords, and sensitive keys prior to logging or storage.

### Summary Assessment Matrix

| Verification Domain | Regulatory / Technical Standard | Audit Status | Primary Mechanism | Compliance Finding |
| :--- | :--- | :---: | :--- | :--- |
| **1. Statutory Privacy Frameworks** | India DPDP (2023), Vietnam PDPD (Decree 13), GDPR (EU 2016/679) | **COMPLIANT** | Data Minimization, Scoped RLS, Deactivation Lifecycle | Strictly operational staff data; zero extraneous PII; cross-border transfers flagged for Technology leadership review. |
| **2. Synthetic Seed Personas** | RFC 2606 Reserved TLDs, Privacy by Design | **VERIFIED** | 12 Role-Titled Test Accounts on `@example.test` | Zero real human names, personal emails, or telephone numbers across all fixtures and seed scripts. |
| **3. Credential Storage Isolation** | ISO/IEC 27001 A.9.4.3, OWASP ASVS V2 | **VERIFIED** | Supabase Auth (`auth.users`) / Zero Credential Columns in `public.m_users` | `public.m_users` contains no credential hashes or salts. Verified by database schema and pgTAP test assertions. |
| **4. Diagnostic Logger Redaction** | OWASP Top 10 A09:2021 (Security Logging Failures), DPDP Sec. 8 | **VERIFIED** | Recursive Sanitizer (`sanitizeLogData`) + Regex Scrubbers | Automated redaction of passwords, bearer tokens, JWT strings, cookies, and secrets with single-line JSON serialization. |

---

## 2. Statutory Privacy Frameworks Compliance Analysis (DPDP, PDPD, GDPR)

The inventory tool operates in restaurant storerooms and centralized distribution locations in New Delhi, India (`IND-DEL-01`, `IND-DEL-02`), within an organizational structure rooted in Vietnam and international operational standards.

### 2.1 Scope of Personnel Personal Data Captured
Under all three regulatory frameworks, an identified or identifiable natural person constitutes a Data Principal (India DPDP) or Data Subject (Vietnam PDPD / EU GDPR). The application processes the following staff data elements:
- **Account Identity:** Staff user identifier (`user_id`), official corporate email address (`email`), and display designation (`full_name`).
- **Operational Scope & Permissions:** Role assignment (`role`), assigned store code (`store_id`), storeroom code (`warehouse_id`), and kitchen section (`section_id`).
- **Security & Session Telemetry:** Consecutive unsuccessful authentication counters (`failed_login_count`), temporary lockout timestamp (`lockout_until`), client IP address (`ip_address`), and user agent summary (`device_info`) within append-only `t_security_logs`.
- **Physical Custody & Accountability:** Digital signatures on storeroom custody transfers (`t_shift_custody_logs`), movement authorship (`created_by_user_id` on `t_stock_movements`), and physical count adjustments.

### 2.2 Purpose Limitation & Principle of Data Minimization
- **India DPDP Act (Section 6 & Section 7):** Processing is restricted strictly to necessary employment and inventory accountability operations.
- **Vietnam PDPD (Article 3, Clause 3):** Personal data is collected exclusively within declared operational requirements for restaurant inventory management.
- **GDPR (Article 5(1)(c) - Data Minimization):** Data collected is adequate, relevant, and limited to what is strictly necessary in relation to physical inventory tracking and food safety management.
- **Excluded Data Audit:** The database contains zero records of:
  - National identity identifiers (no Aadhaar, PAN, Passport, CCCD, or national insurance numbers).
  - Personal contact details (no private phone numbers, home addresses, or personal personal email accounts).
  - Sensitive personal categories (no biometric records, health information, political affiliations, religious beliefs, or personal banking data).
  - Financial compensation details (no payroll figures, wage rates, or commercial compensation).

### 2.3 Storage Limitation, Account Deactivation & Ledger Immutability
A critical regulatory intersection arises between the Right to Erasure / Deletion (GDPR Art. 17, DPDP Sec. 12) and statutory recordkeeping obligations for inventory accounting:
1. **Append-Only Immutability Invariant:** Every stock movement record in `t_stock_movements` maintains a foreign key `created_by_user_id REFERENCES m_users(user_id) ON DELETE RESTRICT`. A user row cannot be deleted while physical inventory actions depend upon that author reference.
2. **Deactivation Pattern:** Account departure is executed by setting `is_active = false` and revoking assigned operational permissions (`m_user_permissions`). Deactivated personnel cannot authenticate, request stock, or sign handovers.
3. **Anonymization Capability:** To fulfill formal erasure requests under GDPR or DPDP without compromising ledger arithmetic, the system supports replacing personal display designations in `m_users.full_name` with pseudonymized labels (e.g., `Former Staff usr-kitchen-01`) while leaving immutable movement IDs intact.
4. **Append-Only Security Audit:** `t_security_logs` preserves audit history protected by `tg_prevent_security_log_mutation`, preventing tampering or selective deletion of authentication events.

### 2.4 Access Control & Row-Level Security Scoping
Access to staff personal data is enforced directly inside the PostgreSQL engine:
- **Profile Segregation:** `m_users` is defended by Row-Level Security policy `m_users_select`:
  - A frontline worker can only view their own user profile record (`user_id = current_user_id`).
  - Only authorized administrators possessing the `SYSTEM_ADMIN` role can query the entire staff directory.
  - Frontline kitchen runners, warehouse keepers, and section requesters cannot browse, scrape, or harvest coworker contact information.
- **Administrative Restriction:** Creation, modification, and deactivation of staff profiles are restricted to `SYSTEM_ADMIN` via `m_users_insert`, `m_users_update`, and `m_users_delete` policies.

### 2.5 Cross-Border Data Flow Analysis & Technology Leadership Escalation Policy
- **India DPDP Act (Section 16):** Allows cross-border transfer of personal data to overseas jurisdictions unless specifically blacklisted by the Central Government of India.
- **Vietnam PDPD (Article 25):** Requires an outbound transfer dossier, impact assessment, and submission to the Ministry of Public Security prior to transferring personal data of Vietnamese nationals abroad.
- **GDPR (Chapter V):** Restricts transfers outside the European Economic Area absent an adequacy decision or standard contractual clauses.
- **Operational Escalation Mandate:** The repository architecture maintains local database hosting. However, in accordance with organizational governance:
  > **Policy Rail:** Any architecture initiative involving the federation, mirroring, cloud backup replication, or centralized aggregation of staff personal data across borders (such as syncing Delhi restaurant staff databases to Vietnam headquarters or cloud regions outside India) **must be formally escalated to Technology & Innovation leadership** prior to implementation. Engineering teams must not establish cross-border data replication pipelines autonomously.

### 2.6 Rights of Data Principals & Data Subjects
The application supports statutory rights through operational procedures:
- **Right to Information & Summary:** Staff members can view their own profile, role assignments, and store scope directly within the application interface.
- **Right to Correction / Rectification:** System Administrators can correct inaccurate contact details or operational scopes via standard profile update routines.
- **Right to Grievance Redressal:** Organizations deploying the system must designate a Data Protection Officer (DPO) whose contact details are provided in employment onboarding materials.

---

## 3. Synthetic Seed Data & Persona Verification (@example.test)

### 3.1 Catalog of Test Personas
An exhaustive inspection was conducted across all fixture and seeding modules (`lib/testing/synthetic-seed.ts`, `lib/data/users.ts`, `scripts/seed-demo-data.ts`, `app/login/page.tsx`, and `supabase/tests/0020_identity.sql`).

All 12 primary and extended seed accounts use synthetic role-based titles and the reserved `.test` domain:

| User ID | Full Name (Designation) | Synthetic Email | Assigned Role | Operating Scope |
| :--- | :--- | :--- | :--- | :--- |
| `usr-sysadmin-01` | System Admin | `sysadmin@example.test` | `SYSTEM_ADMIN` | Global (Store creation, user invites, unlocking) |
| `usr-admin-01` | Warehouse Keeper Admin | `admin@example.test` | `ADMIN` | `IND-DEL-01` / `WH-DEL01-DRY` (Picking, counting, waste log) |
| `usr-rm-01` | Restaurant Manager Delhi | `rm@example.test` | `RM` | `IND-DEL-01` (Daily balance sign-off, minor waste review) |
| `usr-kitchen-01` | Kitchen Section Requester | `kitchen@example.test` | `KITCHEN_REQ` | `IND-DEL-01` / Kitchen Section (Requisitions) |
| `usr-bar-01` | Bar Section Requester | `bar@example.test` | `BAR_REQ` | `IND-DEL-01` / Bar Section (Requisitions) |
| `usr-cheese-01` | Cheese Section Requester | `cheese@example.test` | `CHEESE_REQ` | `IND-DEL-01` / Cheese Section (Requisitions) |
| `usr-runner-01` | Kitchen Runner | `runner@example.test` | `RUNNER` | `IND-DEL-01` / Kitchen Section (Door confirmation) |
| `usr-custodian-01` | Cold Room Custodian | `custodian@example.test` | `CUSTODIAN` | `IND-DEL-01` / `WH-DEL01-COLD` (Cold room custody & handover) |
| `usr-accountant-01` | Store Accountant | `accountant@example.test` | `ACCOUNTANT` | `IND-DEL-01` (Stock counts, adjustment submissions) |
| `usr-approver-01` | Financial Controller Approver | `approver@example.test` | `APPROVER` | `IND-DEL-01`, `IND-DEL-02`, `IND-BLR-01` (Multi-store approvals) |
| `usr-scm-01` | Supply Chain Lead | `scm@example.test` | `SCM` | Global (Late ingestion oversight, reorder monitoring) |
| `usr-viewer-01` | Internal Auditor Viewer | `viewer@example.test` | `VIEWER` | Global (Read-only ledger & security log inspection) |

Additional secondary fixture accounts in `lib/data/users.ts`:
- `usr-approver-secondary` | Secondary Approver Candidate | `finance-lead-2@example.test` | `APPROVER` | Global (Pending second approval)

### 3.2 Verification of Non-Leakage & RFC 2606 Compliance
1. **RFC 2606 Domain Isolation:** Every test account domain utilizes `.test` (specifically `@example.test`). Under RFC 2606 Section 2, `.test` is an Internet standard reserved top-level domain guaranteed never to resolve through public Domain Name System (DNS) servers. Even if an automated test or development script inadvertently transmits emails to the network, no message can leak to external third parties.
2. **Absence of Real Personal Names:** Zero actual individual names exist in seed files. Full names represent functional operational roles (e.g., "Kitchen Section Requester", "Cold Room Custodian").
3. **Zero Phone Numbers or Contact Data:** The fixtures contain no telephone numbers, personal messaging handles, or residential coordinates.
4. **Automated Test Validation:** Database verification test `supabase/tests/0020_identity.sql` verifies:
   ```sql
   SELECT is(
     (SELECT count(*)::integer FROM m_users WHERE email LIKE '%@example.test'),
     12,
     'All 10 core + 2 extended seed users exist in m_users'
   );
   ```

---

## 4. Application Credentials & Password Security (public.m_users)

### 4.1 Schema Inspection of `public.m_users`
The user profile schema is established in `supabase/migrations/0020_identity_permissions.sql`:

```sql
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
```

### 4.2 Credential Isolation Guarantees
- **Absence of Password Columns:** `public.m_users` contains no columns named `password`, `password_hash`, `passwd`, `encrypted_password`, or `secret_hash`.
- **Database Automated Test Assertion:** The pgTAP test suite in `supabase/tests/0020_identity.sql` executes:
  ```sql
  SELECT hasnt_column('m_users', 'password_hash', 'm_users must NOT contain password_hash');
  ```
- **Authentication Infrastructure Isolation:** All authentication credentials reside exclusively within the isolated `auth.users` table managed by Supabase Auth. Passwords undergo salted key derivation algorithms (Argon2 / bcrypt) within a separate database schema that is completely hidden from application client queries and standard PostgreSQL roles.
- **Contract Schema Verification:** The Zod contract schema in `lib/contracts/users.ts` defines:
  ```typescript
  export const userSchema = z.object({
    user_id: z.string().min(1),
    email: z.string().email(),
    full_name: z.string().min(1),
    failed_login_count: z.number().int().min(0).default(0),
    lockout_until: z.string().nullable().optional(),
    is_active: z.boolean().default(true),
    created_at: z.string().min(1),
  });
  ```
  The application data models expose no password representation to frontend components.

### 4.3 Onboarding & Account Activation Flow
1. **Admin Invitation Generation:** An administrator initiates an onboarding request via `create_user_invitation(p_email, p_role, p_store_id)`.
2. **Single-Use Activation Token:** A cryptographically random token is generated and stored in `m_user_invitations.activation_token` with an expiration window (default 48 hours).
3. **Password Setting Isolation:** The user receives an activation link (`/activate?token=...`). The password entered by the user is submitted directly to the authentication provider API (`supabase.auth.updateUser({ password })`). At no stage does the plaintext password or its hash transit through `m_users` or application endpoints.

### 4.4 Brute-Force & Credential Stuffing Defenses
To defend against automated dictionary attacks and credential stuffing:
- `m_users.failed_login_count` increments upon unsuccessful authentication attempts.
- When failed attempts reach the defined threshold (5 attempts), `m_users.lockout_until` locks the account for 30 minutes.
- All failed and successful logins are logged to `t_security_logs` (`LOGIN_FAILED`, `LOGIN_SUCCESS`, `ACCOUNT_LOCKED`).

---

## 5. Diagnostic Logger Redaction & Secret Sanitization (lib/logger & lib/audit)

### 5.1 Redaction Engine Architecture (`lib/logger/index.ts`)
The application includes a structured JSON logger designed for cloud telemetry streaming (CloudWatch / stdout) with zero leakage of credentials, tokens, or PII.

```typescript
const SENSITIVE_KEY_REGEX =
  /(password|token|secret|authorization|cookie|jwt|credit_?card|api_?key|bearer|ssn|cvv|pin|private_?key)/i;

const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi;

const JWT_REGEX = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g;
```

### 5.2 Sanitization Mechanisms (`sanitizeLogData`)
1. **Regex Key Scrubbing:** Any object property whose key matches `SENSITIVE_KEY_REGEX` (including case variations and snake/camel variations such as `userPassword`, `accessToken`, `temporary_password_hash`, `clientSecret`, `api_key`) has its payload replaced with `'[REDACTED]'`.
2. **Standalone & Inline Bearer Scrubber:**
   - Standalone authorization strings matching `/^Bearer\s+\S+$/i` are converted to `'[REDACTED]'`.
   - Inline occurrences of Bearer tokens within descriptive error messages are scrubbed via `data.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]')`.
3. **JWT Token Scrubber:** Embedded JSON Web Tokens matching the three-segment base64 pattern `/eyJ.../` are scrubbed via `data.replace(JWT_REGEX, '[REDACTED]')`.
4. **Recursive Object & Array Traversal:** Structured telemetry maps and lists are recursively traversed to sanitize nested payloads.
5. **Circular Reference Protection:** A `WeakSet` tracks visited object references during traversal, replacing cycles with `'[CIRCULAR]'` to prevent memory exhaustion or stack overflow crashes.
6. **Error Object Sanitization:** When an `Error` instance is logged, its `message`, `stack`, and attached custom properties are passed through the sanitizer, redacting embedded tokens or connection strings before output.
7. **Single-Line Serialization:** `serializeLogEntry(entry)` applies `sanitizeLogData` and emits clean, single-line JSON, avoiding newline injection attacks.

### 5.3 Audit Dispatcher Integration (`lib/audit/index.ts`)
The audit logging dispatcher `recordSecurityLog` constructs payloads via `buildSecurityLogPayload`:
- Cleanses `metadata` through `sanitizeLogData` prior to persistence.
- Cleanses `device_info` through `sanitizeLogData`.
- Stores audit events in append-only table `t_security_logs`.
- If database connectivity is interrupted, it falls back gracefully to `logger.security(...)` without disrupting frontline restaurant operations.

### 5.4 Operational Inventory Metrics Preservation
The sanitization engine is specifically calibrated to never alter or suppress operational inventory tracking data:
- Physical quantities, unit of measure markers (`uom`), store identifiers (`store_id`), item catalog codes (`item_code`), lot numbers (`batch_number`), and document reference codes are preserved completely intact.
- Verified in `tests/unit/audit.test.ts`:
  ```typescript
  it('preserves non-sensitive operational inventory fields intact', () => {
    const operationalPayload = {
      store_id: 'IND-DEL-01',
      warehouse_id: 'WH-DEL01-DRY',
      item_code: 'ITM-FLR-001',
      quantity: 50,
      uom: 'kg',
      batch_number: 'LOT-2026-DEL-01',
      request_id: 'req-001',
    };
    const sanitized = sanitizeLogData(operationalPayload);
    expect(sanitized).toEqual(operationalPayload);
  });
  ```

### 5.5 Unit Test Suite Verification Evidence
The logger and audit subsystems are covered by 14 comprehensive unit tests in `tests/unit/audit.test.ts`:
- Redaction of standard credential keys: Pass
- Redaction of composite and varied keys (`apiKey`, `creditCard`, `private_key`): Pass
- Standalone Bearer header scrubbing: Pass
- Inline Bearer token message scrubbing: Pass
- Embedded JWT signature pattern scrubbing: Pass
- Deeply nested object and array sanitization: Pass
- Circular structure protection: Pass
- Error instance message and stack scrubbing: Pass
- Single-line JSON emission: Pass
- Security log fallback resilience: Pass

---

## 6. Audit Findings & Verification Summary

### 6.1 Compliance Findings by Objective

#### Objective 1: DPDP / PDPD / GDPR Staff Personal Data Compliance
- **Finding:** **COMPLIANT**
- **Evidence:**
  - Strict data minimization: only operational identity and scoping parameters are stored. Zero extraneous PII (no phone numbers, personal addresses, national identifiers, or biometric data).
  - Row-Level Security restricts profile inspection to self or `SYSTEM_ADMIN`.
  - Immutability of movement records is maintained via `created_by_user_id ON DELETE RESTRICT` alongside soft-deactivation (`is_active = false`).
  - Clear policy guideline established requiring Technology leadership sign-off prior to any cross-border data replication.

#### Objective 2: Synthetic Seed Personas (@example.test)
- **Finding:** **VERIFIED**
- **Evidence:**
  - 12 seed personas across `synthetic-seed.ts` and `seed-data.ts` use purely functional designations and `@example.test` email addresses.
  - RFC 2606 reserved TLD prevents external transmission or resolution leakage.
  - Zero real individual names, phone numbers, or external addresses detected.

#### Objective 3: Public Schema Credential Isolation (public.m_users)
- **Finding:** **VERIFIED**
- **Evidence:**
  - `public.m_users` contains no password or hash columns.
  - pgTAP test in `supabase/tests/0020_identity.sql` asserts `hasnt_column('m_users', 'password_hash')`.
  - Passwords reside exclusively in isolated Supabase Auth infrastructure (`auth.users`).

#### Objective 4: Diagnostic Logger Secret Redaction
- **Finding:** **VERIFIED**
- **Evidence:**
  - `sanitizeLogData` handles regex key scrubbing, Bearer headers, JWT strings, and recursive objects.
  - Error instances and circular references are sanitized safely.
  - Operational inventory quantities and metrics remain completely unaltered.
  - Unit test suite validates redaction across all operational scenarios.

### 6.2 Hardening & Governance Recommendations
1. **Periodic Staff Anonymization Script:** For departed staff after the statutory audit retention window has lapsed, implement a scheduled administrative procedure to overwrite `full_name` in `m_users` with pseudonymized placeholders (`Former Staff <user_id>`) while leaving the immutable user ID in `t_stock_movements`.
2. **Automated CI PII Scanner:** Add an automated verification script that scans seed fixtures and migrations to ensure no email address outside `@example.test` is introduced in future sprints.
3. **Cross-Border Transfer Governance Gate:** Maintain formal documentation of any future international server migrations or cross-region database replicas with explicit Technology & Innovation leadership sign-off.

---

**Audit Sign-off:**  
*Auditor:* H8 Privacy & Compliance Audit Agent  
*Status:* Approved & Verified  
*Inventory Principle Verified:* Quantities only. Physical stock tracking exclusively. Zero commercial rates, monetary metrics, regulatory levies, or merchant trade identities.
