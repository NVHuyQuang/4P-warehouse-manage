<!-- Non-negotiable: Quantities only. Zero financial or commercial data. -->
# Domain D14: Adversarial RLS & Attack Test Suite

## 1. Domain Overview & Purpose
Domain D14 provides the adversarial verification harness and attack test matrix for the Pizza 4P's India Inventory Control Tool. While functional test suites (Domains D1 through D13) verify nominal workflows under cooperative conditions, Domain D14 models hostile threat actors, rogue staff, insider privilege escalation, cross-store eavesdropping, and direct database tampering attempts.

Every test in this domain is implemented as a transactional, automated pgTAP specification executing against PostgreSQL with Row-Level Security (RLS), database triggers, table constraints, and Security Definer routines.

### Invariants & Non-Negotiable Boundaries
- **Quantities Only:** The inventory control system strictly tracks physical units, batch numbers, expiration dates, item codes, and unit counts (`kg` and `pcs`). Zero financial figures, commercial data, monetary rates, or purchase amounts exist in any table, view, or test payload.
- **Append-Only Immutability:** Historical stock transactions in `t_stock_movements` and audit records in `t_security_logs` can never be updated, deleted, or truncated under any circumstances.
- **Strict Segregation of Duties (SoD):** No single user can initiate and approve their own material adjustments, transfers, waste declarations, handovers, or infrastructure proposals.
- **Cross-Store Multi-Tenant Isolation:** Store staff assigned to one store (e.g., `IND-DEL-01`) cannot observe, query, or insert data into another store (e.g., `IND-DEL-02`), preventing data leakage across restaurant locations.
- **Role Least-Privilege:** Operations outside a user's explicit role (such as a requester picking stock or a manager approving major waste above threshold) are rejected at the database engine level.

---

## 2. Threat Model & Actor Personas

The adversarial test suite evaluates the database engine against the following threat actors and hostile personas:

| Threat Persona | Role Context | Capabilities & Vectors Evaluated | Primary Objectives |
| :--- | :--- | :--- | :--- |
| **Rogue Warehouse Keeper** | `ADMIN` | Staging stock, dock receiving, stock counts | Attempt direct ledger tampering, confirm own staging without runner, approve own count vouchers, elevate permissions. |
| **Rogue Kitchen Requester** | `KITCHEN_REQ` / `BAR_REQ` | Requisition creation, status polling | Attempt to alter quantities or cancel requests after picking has started, trigger picking directly, access other store orders. |
| **Rogue Kitchen Runner** | `RUNNER` | Door handover inspection & digital signature | Attempt to self-confirm stock issues without independent warehouse handover, create user accounts, alter requisitions. |
| **Store Accountant** | `ACCOUNTANT` | Inventory count participation, variance vouchers | Attempt to approve own reconciliation vouchers without independent Financial Controller authorization. |
| **Restaurant Manager** | `RM` | Daily balance sign-off, minor waste review | Attempt to approve major waste (> 5 kg) exceeding authority limit, approve count vouchers, invite system administrators. |
| **Cross-Store Snooper** | Any store role | Authenticated session in Store 1 | Attempt cross-store reconnaissance (SELECT) and cross-store injection (INSERT) into Store 2 balances, requests, and custody logs. |
| **Privilege Escalation Attacker** | Non-SysAdmin | SQL injection / direct REST table mutation | Attempt to call `create_user_invitation` or insert directly into `m_user_permissions` to obtain administrative control. |

---

## 3. Adversarial Attack Matrix

The following matrix documents each attack vector, the targeted component, the security mechanism defending the system, and the corresponding pgTAP test:

| Vector ID | Threat Class | Threat Actor | Target Object | Attack Description & Payload | Defense Layer | Expected Error / Status | Test Suite File |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **ADV-01** | Ledger Tamper | Any / Superuser | `t_stock_movements` | Direct `UPDATE` altering `quantity` | Trigger `trg_prevent_ledger_mutation` | `P0001` Exception | `01_ledger_immutability.sql` |
| **ADV-02** | Ledger Tamper | Any / Superuser | `t_stock_movements` | Direct `UPDATE` altering metadata (`item_code`, `batch`, `expiry`) | Trigger `trg_prevent_ledger_mutation` | `P0001` Exception | `01_ledger_immutability.sql` |
| **ADV-03** | Ledger Tamper | Authenticated | `t_stock_movements` | Direct `UPDATE` via authenticated role | SQL Privilege Revocation | `42501` / `P0001` | `01_ledger_immutability.sql` |
| **ADV-04** | Ledger Tamper | Any / Superuser | `t_stock_movements` | Targeted `DELETE` on single movement ID | Trigger `trg_prevent_ledger_mutation` | `P0001` Exception | `01_ledger_immutability.sql` |
| **ADV-05** | Ledger Tamper | Any / Superuser | `t_stock_movements` | Bulk `DELETE FROM t_stock_movements` | Trigger `trg_prevent_ledger_mutation` | `P0001` Exception | `01_ledger_immutability.sql` |
| **ADV-06** | Ledger Tamper | Authenticated | `t_stock_movements` | Direct `TRUNCATE TABLE t_stock_movements` | Privilege Revocation & Foreign Keys | `42501` / `0A000` | `01_ledger_immutability.sql` |
| **ADV-07** | Ledger Tamper | Authenticated | `t_stock_movements` | Direct `DROP TABLE t_stock_movements` | Table Ownership & Privilege Revocation | `42501` Error | `01_ledger_immutability.sql` |
| **ADV-08** | View Tamper | Authenticated | `v_stock_current` | Direct `UPDATE`, `INSERT`, `DELETE` on derived stock view | Non-updatable `GROUP BY` View Engine | `55000` Error | `01_ledger_immutability.sql` |
| **ADV-09** | View Tamper | Authenticated | `v_stock_lots_fifo` | Direct `UPDATE`, `INSERT`, `DELETE` on FIFO lot view | Non-updatable `GROUP BY` View Engine | `55000` Error | `01_ledger_immutability.sql` |
| **ADV-10** | View Tamper | Authenticated | `v_expiry_radar` | Direct `UPDATE` on expiration radar view | Non-updatable View Engine | `55000` Error | `01_ledger_immutability.sql` |
| **ADV-11** | SoD Bypass | Keeper Counter | `t_stock_adjustments` | Direct `INSERT` with `fc_approval_id = keeper_user_id` | Trigger `trg_enforce_stock_adjustment_sod` | `23514` Exception | `02_segregation_of_duties.sql` |
| **ADV-12** | SoD Bypass | Accountant | `t_stock_adjustments` | Direct `INSERT` with `fc_approval_id = accountant_user_id` | Trigger `trg_enforce_stock_adjustment_sod` | `23514` Exception | `02_segregation_of_duties.sql` |
| **ADV-13** | SoD Bypass | Counter | `approve_stock_adjustment` | Counter calling adjustment RPC as approver | Stored Procedure User Inspection | `23514` Exception | `02_segregation_of_duties.sql` |
| **ADV-14** | SoD Bypass | Dispatcher | `t_transfer_intransit` | Direct `INSERT`/`UPDATE` where `receiver = dispatcher` | Constraint `chk_transfer_distinct_users` | `23514` Check Viol | `02_segregation_of_duties.sql` |
| **ADV-15** | SoD Bypass | Dispatcher | `receive_store_transfer` | Dispatcher calling receipt RPC at target store | Stored Procedure User Inspection | `P0001` Exception | `02_segregation_of_duties.sql` |
| **ADV-16** | SoD Bypass | Dispatcher | `approve_transfer_variance`| Dispatcher calling variance approval RPC | Stored Procedure User Inspection | `P0001` Exception | `02_segregation_of_duties.sql` |
| **ADV-17** | SoD Bypass | Waste Logger | `t_waste_returns_log` | Direct `INSERT`/`UPDATE` where `approver = logged_by` | Constraint `chk_waste_distinct_users` | `23514` Check Viol | `02_segregation_of_duties.sql` |
| **ADV-18** | SoD Bypass | Waste Logger | `approve_waste_or_return` | Waste logger calling approval RPC | Stored Procedure User Inspection | `P0001` Exception | `02_segregation_of_duties.sql` |
| **ADV-19** | SoD Bypass | Staging Keeper | `confirm_issue` | Keeper who staged goods confirming receipt at door | Stored Procedure Historical Movement Check | `P0001` Exception | `02_segregation_of_duties.sql` |
| **ADV-20** | SoD Bypass | Proposer | `decide_store_warehouse_proposal` | Proposer approving own warehouse/store proposal | Stored Procedure Proposer Check | `P0001` Exception | `02_segregation_of_duties.sql` |
| **ADV-21** | Cross-Store | Store 1 Staff | `t_requests` | `SELECT` query targeting Store 2 requests | Row-Level Security (`t_requests_select`) | 0 rows returned | `03_cross_store_isolation.sql` |
| **ADV-22** | Cross-Store | Store 1 Staff | `t_daily_balances` | `SELECT` query targeting Store 2 balances | Row-Level Security (`t_daily_balances_select`) | 0 rows returned | `03_cross_store_isolation.sql` |
| **ADV-23** | Cross-Store | Store 1 Staff | `t_stock_counts` | `SELECT` query targeting Store 2 counts | Row-Level Security (`t_stock_counts_select`) | 0 rows returned | `03_cross_store_isolation.sql` |
| **ADV-24** | Cross-Store | Store 1 Staff | `t_custody_logs` | `SELECT` query targeting Store 2 custody logs | Row-Level Security (`t_custody_logs_select`) | 0 rows returned | `03_cross_store_isolation.sql` |
| **ADV-25** | Cross-Store | Store 1 Staff | `t_requests` | Direct `INSERT` into Store 2 requests | RLS `WITH CHECK` Policy (`t_requests_insert`) | `42501` Error | `03_cross_store_isolation.sql` |
| **ADV-26** | Cross-Store | Store 1 Staff | `t_daily_balances` | Direct `INSERT` into Store 2 balances | RLS `WITH CHECK` Policy | `42501` Error | `03_cross_store_isolation.sql` |
| **ADV-27** | Cross-Store | Store 1 Staff | `t_stock_counts` | Direct `INSERT` into Store 2 stock counts | RLS `WITH CHECK` Policy | `42501` Error | `03_cross_store_isolation.sql` |
| **ADV-28** | Cross-Store | Store 1 Staff | `t_custody_logs` | Direct `INSERT` into Store 2 custody logs | RLS `WITH CHECK` Policy | `42501` Error | `03_cross_store_isolation.sql` |
| **ADV-29** | Cross-Store | Store 1 Staff | `create_section_request` | RPC call specifying foreign store ID | Stored Procedure Scope Check | `P0001` Exception | `03_cross_store_isolation.sql` |
| **ADV-30** | Multi-Tenant | Rogue Staff | `current_store_id()` | Tampering with `app.current_store_id` (empty/null) | Security Definer Fallback to Permissions | Deterministic Fallback | `03_cross_store_isolation.sql` |
| **ADV-31** | Priv Escalation | Keeper / Staff | `create_user_invitation` | Non-SysAdmin inviting new users | Stored Procedure Role Check | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-32** | Priv Escalation | Non-SysAdmin | `m_user_permissions` | Direct `INSERT`/`UPDATE` granting `SYSTEM_ADMIN` | RLS Policy `m_user_permissions_insert` | `42501` Error | `04_privilege_escalation.sql` |
| **ADV-33** | Priv Escalation | Restaurant Mgr | `approve_waste_or_return` | RM approving major waste (> 5 kg) | Stored Procedure Threshold Review | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-34** | Priv Escalation | Non-FC Role | `approve_stock_adjustment` | RM or Keeper approving adjustment voucher | Stored Procedure Role Check | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-35** | Priv Escalation | Requester/Runner | `begin_request_picking` | Requester or Runner beginning picking | Stored Procedure Role Check | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-36** | Priv Escalation | Requester/Runner | `stage_issue` | Requester or Runner staging stock | Stored Procedure Role Check | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-37** | Status Lock | Requester | `cancel_section_request` | Requester cancelling request in `PICKING` status | Stored Procedure Status Check | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-38** | Status Lock | Requester | `update_section_request` | Requester editing items in `PICKING` status | Stored Procedure Status Check | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-39** | Status Lock | Requester | `t_requests` | Direct `UPDATE` setting `status = CANCELLED` | Trigger `trg_enforce_request_lock` | `P0001` Exception | `04_privilege_escalation.sql` |
| **ADV-40** | Status Lock | Requester | `t_request_items` | Direct `UPDATE`, `INSERT`, `DELETE` on items | Trigger `trg_enforce_request_item_lock` | `P0001` Exception | `04_privilege_escalation.sql` |

---

## 4. Test Suite Architecture & Implementation

The adversarial suite comprises four self-contained, transactional pgTAP test files located in `supabase/tests/adversarial/`.

### 4.1 Suite 1: Ledger Immutability (`01_ledger_immutability.sql`)
- **Total Assertions:** 33 tests.
- **Coverage:**
  1. Validates table existence, schema triggers, and active RLS on `t_stock_movements`.
  2. Executes targeted `UPDATE` attacks across all columns: quantity, item code, store, warehouse, movement type, batch number, expiry date, reference document, and user ID.
  3. Executes targeted `DELETE` attacks on individual movements and bulk table deletions.
  4. Tests `TRUNCATE` and `DROP TABLE` attacks under both `authenticated` and administrative roles.
  5. Attacks derived stock views (`v_stock_current`, `v_stock_lots_fifo`, `v_expiry_radar`) with direct `INSERT`, `UPDATE`, and `DELETE` commands, proving views cannot be mutated.
  6. Demonstrates that legitimate append-only transactions increment derived balances accurately without mutating historical records.

### 4.2 Suite 2: Segregation of Duties (`02_segregation_of_duties.sql`)
- **Total Assertions:** 25 tests.
- **Coverage:**
  1. Validates the five core separation-of-duties invariants established in the system specification.
  2. Proves counters (both warehouse keeper and store accountant) are prohibited from approving count adjustment vouchers via both database triggers and RPC parameters.
  3. Proves inter-store transfer dispatchers cannot receive their own shipments at destination or approve transit variances.
  4. Proves waste loggers cannot authorize their own waste disposal claims.
  5. Proves storeroom keepers who picked and staged goods cannot confirm door handover receipts as the kitchen runner.
  6. Proves staff proposing new stores or warehouses cannot approve their own submissions.

### 4.3 Suite 3: Cross-Store Multi-Tenant Isolation (`03_cross_store_isolation.sql`)
- **Total Assertions:** 32 tests.
- **Coverage:**
  1. Sets up complete dual-store fixtures for Store 1 (`IND-DEL-01`) and Store 2 (`IND-DEL-02`).
  2. Validates bidirectional `SELECT` isolation: Store 1 staff queries against Store 2 requests, daily balances, stock counts, and custody logs strictly return 0 rows.
  3. Validates cross-store write prevention: Store 1 staff attempting direct `INSERT` into Store 2 tables receives SQLSTATE `42501` (Row-Level Security violation).
  4. Validates RPC store boundary checks (`create_section_request`, `stage_issue`) against foreign store targeting.
  5. Tests store switcher context switching and verifies fallback behavior when session variables are unset or tampered with.

### 4.4 Suite 4: Privilege Escalation Prevention (`04_privilege_escalation.sql`)
- **Total Assertions:** 37 tests.
- **Coverage:**
  1. Tests user invitation and account creation, proving all non-`SYSTEM_ADMIN` roles (Keeper, Requester, Runner, RM, FC) are rejected.
  2. Attacks role assignments in `m_user_permissions` via direct `INSERT`, `UPDATE`, and `DELETE`, proving unauthorized permission modifications fail under RLS.
  3. Tests approval limits on waste claims: proves Restaurant Managers can approve minor waste (<= 5 kg) but are blocked from major waste (> 5 kg), which strictly requires the Financial Controller (`APPROVER`).
  4. Proves non-FC roles cannot approve stock adjustment vouchers.
  5. Tests storeroom operations: proves re-shelving, picking (`begin_request_picking`), and staging (`stage_issue`) cannot be executed by requesters, runners, or managers.
  6. Enforces Flow C-1 request locking: proves once picking starts, requisitions cannot be cancelled or modified via RPC or direct SQL table edits.

---

## 5. Defense-in-Depth Layered Architecture

Security in the inventory database is enforced across five defense layers, ensuring that even if one layer is bypassed or misconfigured, secondary layers prevent unauthorized data mutation:

```
+-------------------------------------------------------------------------------+
|  LAYER 5: Security Definer Stored Procedures & RPCs                            |
|  - Validates session user, role claims, and store scope parameters             |
|  - Enforces domain state machines (e.g. QUEUED -> PICKING -> AWAITING_RUNNER)  |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|  LAYER 4: Row-Level Security (RLS) Policies                                    |
|  - Enforces USING filters for multi-tenant store isolation                     |
|  - Enforces WITH CHECK constraints for authenticated writes                   |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|  LAYER 3: SQL Privilege Grants & Revocations                                   |
|  - Explicit REVOKE UPDATE, DELETE, TRUNCATE on append-only tables             |
|  - Restricts schema modification to database migration roles                   |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|  LAYER 2: PostgreSQL Database Triggers                                         |
|  - tg_prevent_ledger_mutation() unconditionally blocks UPDATE & DELETE        |
|  - tg_enforce_request_lock() prevents cancellation of picking requisitions    |
|  - tg_enforce_stock_adjustment_sod() rejects counter approvals                |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|  LAYER 1: Relational Schema Integrity & Check Constraints                     |
|  - Primary keys, foreign key cascades, NOT NULL constraints                    |
|  - chk_transfer_distinct_users (dispatcher != receiver)                       |
|  - chk_waste_distinct_users (logged_by != approver)                           |
+-------------------------------------------------------------------------------+
```

---

## 6. Verification & Execution Guide

The entire adversarial suite can be run using the standard PostgreSQL pgTAP test runner (`pg_prove`):

```bash
# Run all adversarial test suites
pg_prove -U postgres -d postgres supabase/tests/adversarial/*.sql

# Run specific attack test suites individually
pg_prove -U postgres -d postgres supabase/tests/adversarial/01_ledger_immutability.sql
pg_prove -U postgres -d postgres supabase/tests/adversarial/02_segregation_of_duties.sql
pg_prove -U postgres -d postgres supabase/tests/adversarial/03_cross_store_isolation.sql
pg_prove -U postgres -d postgres supabase/tests/adversarial/04_privilege_escalation.sql
```

### Aggregate Suite Summary
- **Total Test Files:** 4
- **Total Executable Invariants Verified:** 127
  - Ledger Immutability: 33 tests
  - Segregation of Duties: 25 tests
  - Cross-Store Isolation: 32 tests
  - Privilege Escalation: 37 tests
- **Non-Negotiable Compliance:** 100% Quantities only. Zero financial or commercial data.
