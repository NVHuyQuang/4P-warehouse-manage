# Database Domain: Custody & Shift Handover (D7)

## 1. Domain Overview
The Custody & Shift Handover domain governs physical storeroom key possession, scheduled access logging, emergency entries, and mutual shift transfers for Pizza 4P's India Inventory Control Tool. It implements:
- **Flow B (Keep: Custodian & Issue Windows):** Enforces storeroom lock/unlock discipline aligned with admin-configured operational windows, logging every scheduled and urgent access event.
- **Flow E (Handover: Custodian Shift Handover):** Captures physical storeroom handover between shift custodians with dual-party verification and digital signature confirmation, maintaining an unbroken human custody chain without mutating permanent master data assignments.

All schemas and functions strictly adhere to **quantities only**: zero price, cost, valuation, tax, or vendor data exist in any table, procedure, or policy.

---

## 2. Relational Schema & Tables

### 2.1 `t_custody_logs`
Append-only log of physical storeroom access events (Flow B).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `log_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique log entry identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Store branch identifier. |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Storeroom identifier (Cold Room or Dry Store). |
| `event_type` | `text` | `NOT NULL CHECK (event_type IN ('WINDOW_UNLOCK', 'WINDOW_LOCK', 'URGENT_ACCESS'))` | Nature of room access event. |
| `custodian_user_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Authenticated custodian opening or securing the room. |
| `urgent_reason` | `text` | `NULL` | Operational justification (mandatory when `event_type = 'URGENT_ACCESS'`). |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Event timestamp. |

- **Constraints:**
  - `chk_custody_urgent_reason`: Validates that `event_type != 'URGENT_ACCESS'` or `(urgent_reason IS NOT NULL AND length(trim(urgent_reason)) > 0)`.
- **Indexes:**
  - `idx_custody_logs_store_wh` on `(store_id, warehouse_id)`
  - `idx_custody_logs_created_at` on `created_at DESC`
  - `idx_custody_logs_custodian` on `custodian_user_id`

### 2.2 `t_shift_custody_logs`
Append-only audit trail of shift key handovers between custodians (Flow E).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `shift_log_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique shift handover log identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Store branch identifier. |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Storeroom identifier. |
| `outgoing_custodian_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Current custodian handing over physical key. |
| `incoming_holder_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Next custodian accepting key and physical inventory responsibility. |
| `shift_type` | `text` | `NOT NULL CHECK (shift_type IN ('DAY_TO_EVENING', 'EVENING_TO_MORNING'))` | Scheduled shift transition interval. |
| `signature_blob` | `text` | `NOT NULL` | Encoded signature or biometric confirmation data. |
| `transferred_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Timestamp when key possession was accepted. |

- **Constraints:**
  - `chk_shift_custody_distinct_holders`: Enforces segregation of duties: `CHECK (outgoing_custodian_id != incoming_holder_id)`.
  - `chk_shift_signature_not_empty`: Validates that `length(trim(signature_blob)) > 0`.
- **Indexes:**
  - `idx_shift_custody_logs_store_wh` on `(store_id, warehouse_id)`
  - `idx_shift_custody_logs_transferred_at` on `transferred_at DESC`
  - `idx_shift_custody_logs_outgoing` on `outgoing_custodian_id`
  - `idx_shift_custody_logs_incoming` on `incoming_holder_id`

---

## 3. Append-Only Immutability Guarantees

Both `t_custody_logs` and `t_shift_custody_logs` are legal audit logs of room physical access. Once appended, no row may be modified or deleted.

- **Trigger Function:** `tg_prevent_custody_mutation()` intercepts all `BEFORE UPDATE OR DELETE` attempts and raises exception `P0001: Custody logs are append-only and cannot be updated or deleted.`
- **Table Triggers:**
  - `trg_prevent_custody_logs_mutation` on `t_custody_logs`
  - `trg_prevent_shift_custody_mutation` on `t_shift_custody_logs`
- **SQL Privilege Revocation:** `REVOKE UPDATE, DELETE ON public.t_custody_logs, public.t_shift_custody_logs FROM PUBLIC, authenticated;`

---

## 4. Stored Procedures (RPCs)

### 4.1 `record_custody_event`
Records storeroom window unlocks, window locks, and off-window urgent extractions.

- **Signature:**
  ```sql
  public.record_custody_event(
    p_store_id text,
    p_warehouse_id text,
    p_event_type text,
    p_urgent_reason text DEFAULT NULL
  ) RETURNS uuid
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
- **Authorization & Guards:**
  1. **Role Check:** Caller must possess role `ADMIN` (Keeper), `CUSTODIAN`, `RM` (Restaurant Manager), or `SYSTEM_ADMIN`.
  2. **Store Scope Check:** If `current_store_id()` is configured, it must match `p_store_id` (unless `SYSTEM_ADMIN`).
  3. **Caller Context:** Resolves authenticated user UUID via `app.current_user_id`, `request.jwt.claim.sub`, or `auth.uid()`.
  4. **Event Validation:** Rejects values outside `'WINDOW_UNLOCK'`, `'WINDOW_LOCK'`, `'URGENT_ACCESS'`.
  5. **Urgent Reason Rule:** If `p_event_type = 'URGENT_ACCESS'`, `p_urgent_reason` must not be null or blank.
  6. **Warehouse Existence:** Ensures `p_warehouse_id` belongs to `p_store_id`.

### 4.2 `transfer_shift_custody`
Executes digital shift handover of storeroom key custody between custodians.

- **Signature:**
  ```sql
  public.transfer_shift_custody(
    p_store_id text,
    p_warehouse_id text,
    p_incoming_holder_id uuid,
    p_shift_type text,
    p_signature_blob text
  ) RETURNS uuid
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
- **Authorization & Guards:**
  1. **Role Check:** Caller must possess role `ADMIN` (Keeper), `CUSTODIAN`, `RM`, or `SYSTEM_ADMIN`.
  2. **Store Scope Check:** Caller's store scope must match `p_store_id`.
  3. **Segregation of Duties:** Explicitly enforces `v_caller_id != p_incoming_holder_id`. A custodian cannot sign over custody to themselves.
  4. **Shift Type Validation:** Must be `'DAY_TO_EVENING'` or `'EVENING_TO_MORNING'`.
  5. **Signature Validation:** `p_signature_blob` must not be blank.
  6. **Incoming Holder Existence:** Validates that `p_incoming_holder_id` exists in `auth.users`.
  7. **Master Data Invariant:** Per Flow E Step E10, baseline assignments in `m_go_live_assignments` and `m_warehouses` remain untouched. The transfer log is the authoritative record of current shift custody.

---

## 5. Row-Level Security (RLS) Policies

Row-Level Security is enabled on both tables:

| Table | Operation | Allowed Roles | Policy Scope / Condition |
| :--- | :--- | :--- | :--- |
| `t_custody_logs` | `SELECT` | `authenticated` | `current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN') OR has_role('VIEWER') OR has_role('APPROVER')` |
| `t_custody_logs` | `INSERT` | `ADMIN`, `CUSTODIAN`, `RM`, `SYSTEM_ADMIN` | Store scope match: `current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN')` |
| `t_custody_logs` | `UPDATE`, `DELETE`| None | Denied (`USING (false)`) |
| `t_shift_custody_logs` | `SELECT` | `authenticated` | `current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN') OR has_role('VIEWER') OR has_role('APPROVER')` |
| `t_shift_custody_logs` | `INSERT` | `ADMIN`, `CUSTODIAN`, `RM`, `SYSTEM_ADMIN` | Store scope match + segregation check: `outgoing_custodian_id != incoming_holder_id` |
| `t_shift_custody_logs` | `UPDATE`, `DELETE`| None | Denied (`USING (false)`) |

---

## 6. Verification & Test Suite

The test suite in `supabase/tests/0070_custody.sql` validates 47 assertions:
- **Schema & Types:** Table existence, primary keys, exact column structures, and foreign key references to `m_stores`, `m_warehouses`, and `auth.users`.
- **Database Constraints:** Segregation check (same holder rejected), check constraints for `event_type` and `shift_type`, and mandatory urgent reason on `URGENT_ACCESS`.
- **Immutability:** Triggers block `UPDATE` and `DELETE` on all custody logs.
- **RPC Access & Permissions:**
  - Allowed operations by `CUSTODIAN`, `ADMIN`, and `RM`.
  - Blocked execution by unauthorized roles (`RUNNER`, `KITCHEN_REQ`).
  - Strict validation of invalid parameters, empty signatures, missing urgent reasons, and foreign store/warehouse combinations.
- **Segregation of Duties:** Verification that `transfer_shift_custody` refuses self-transfers.
- **Store Scope Isolation:** Verifies that callers scoped to `IND-DEL-01` cannot read logs from `IND-DEL-02`.
