# Database Domain: Waste & Supplier Returns (D11)

## 1. Domain Overview
The Waste & Supplier Returns domain governs non-standard physical inventory outflows for Pizza 4P's India Inventory Control Tool. It implements the operational logging and multi-level authorization workflows of **Flow G (Other Movements: Waste, Return, Transfer)**:
- **Waste Disposal Logging & Authorization:** Enables frontline storekeepers and kitchen custodians to document spoiled, damaged, or expired stock with photographic evidence and reason classification. Authorizations follow a tiered governance model based on store-configurable quantity thresholds.
- **Supplier Returns:** Governs goods rejected at receiving or recalled to vendors. Requires cross-referencing inbound SAP purchase order (PO) or Good Receipt PO (GRPO) documents, capturing digital carrier driver signatures, and independent Financial Controller sign-off.
- **Append-Only Stock Ledger Integration:** Approved claims append negative movements (`WASTE_DISPOSAL` or `SUPPLIER_RETURN` with `-quantity`) to `t_stock_movements`. Ledger records are never edited or deleted.

### Invariants & Non-Negotiable Boundaries
- **Quantities Only:** Zero price, cost, valuation, tax, commercial vendor terms, or accounting ledger codes exist in any table, procedure, or policy in this domain.
- **Segregation of Duties:** The user who logs a waste or return claim cannot authorize or reject their own claim (`logged_by_user_id != approver_user_id`).
- **Append-Only Immutability:** Once logged, waste records cannot be deleted. Once approved or rejected, records are terminal and immutable. `t_stock_movements` is strictly append-only.
- **Tiered Approval Thresholds:** Minor waste (below or equal to threshold) may be authorized locally by the Restaurant Manager (RM) or Financial Controller (APPROVER). Major waste and supplier returns strictly mandate Financial Controller (`APPROVER`) sign-off.

---

## 2. Relational Schema & Tables

### 2.1 `t_waste_threshold_config`
Configures the minor vs. major waste quantity threshold per restaurant store.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `config_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique configuration record identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Restaurant store code (e.g., `IND-DEL-01`). |
| `minor_threshold_qty` | `numeric(12,3)` | `NOT NULL DEFAULT 5.000 CHECK (minor_threshold_qty > 0)` | Maximum quantity eligible for RM approval. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Configuration creation timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Last update timestamp. |

- **Constraints:**
  - `uq_waste_config_store`: `UNIQUE (store_id)` guarantees one threshold configuration per store.
  - `CHECK (minor_threshold_qty > 0)`: Threshold quantity must be strictly positive.
- **Indexes:**
  - `idx_waste_config_store` on `store_id`.

### 2.2 `t_waste_returns_log`
Append-only log of waste disposal claims and supplier returns pending or authorized under Flow G.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `log_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique claim log identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Store code where outflow occurred. |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Storeroom identifier (Cold Room or Dry Store). |
| `movement_id` | `uuid` | `NULL REFERENCES t_stock_movements(movement_id)` | Linked immutable ledger entry (populated on approval). |
| `movement_type` | `text` | `NOT NULL CHECK (movement_type IN ('WASTE_DISPOSAL', 'SUPPLIER_RETURN'))` | Classification of outflow. |
| `item_code` | `text` | `NOT NULL REFERENCES m_items(item_code)` | Material item code. |
| `quantity` | `numeric(12,3)` | `NOT NULL CHECK (quantity > 0)` | Positive physical quantity logged for outflow. |
| `uom` | `text` | `NOT NULL` | Unit of measure (`kg` or `pcs`). |
| `po_number` | `text` | `NULL` | Inbound SAP Purchase Order reference doc. |
| `grpo_doc_no` | `text` | `NULL` | Inbound SAP Good Receipt PO reference doc. |
| `photo_url` | `text` | `NULL` | URI to visual evidence of damaged or spoiled goods. |
| `reason_code` | `text` | `NOT NULL` | Operational code (e.g., `SPOILAGE`, `EXPIRY`, `DEFECT`). |
| `reason_text` | `text` | `NOT NULL` | Detailed frontline operational justification. |
| `logged_by_user_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Authenticated staff user who initiated the claim. |
| `approver_user_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Independent manager who approved or rejected the claim. |
| `approver_decision` | `text` | `NOT NULL CHECK (approver_decision IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING'` | Current status of claim. |
| `approver_comment` | `text` | `NULL` | Notes, inspection remarks, or rejection grounds. |
| `driver_signature_blob` | `text` | `NULL` | Signature confirmation from carrier or driver. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Timestamp when claim was submitted. |
| `authorized_at` | `timestamptz` | `NULL` | Timestamp when decision was executed. |

- **Constraints:**
  - `chk_waste_distinct_users`: Enforces segregation of duties:
    ```sql
    CHECK (approver_user_id IS NULL OR logged_by_user_id != approver_user_id)
    ```
  - `chk_supplier_return_requirements`: Enforces mandatory reference document and carrier signature for supplier returns:
    ```sql
    CHECK (
      movement_type != 'SUPPLIER_RETURN' OR (
        (po_number IS NOT NULL OR grpo_doc_no IS NOT NULL) AND
        (driver_signature_blob IS NOT NULL AND length(trim(driver_signature_blob)) > 0)
      )
    )
    ```
- **Indexes:**
  - `idx_waste_returns_store_wh` on `(store_id, warehouse_id)`
  - `idx_waste_returns_decision` on `(approver_decision)`
  - `idx_waste_returns_item` on `(item_code)`
  - `idx_waste_returns_created` on `(created_at DESC)`
  - `idx_waste_returns_logged_by` on `(logged_by_user_id)`
  - `idx_waste_returns_movement_id` on `(movement_id)`

---

## 3. Approval Thresholds & Governance Hierarchy (Flow G)

Flow G defines clear role-based authorization gates for non-standard inventory deductions:

```
[ Frontline Staff / Keeper ]
           │
           │ logs claim via log_waste_or_return()
           ▼
[ Status: PENDING ]
           │
     ┌─────┴────────────────────────┐
     ▼                              ▼
WASTE_DISPOSAL               SUPPLIER_RETURN
     │                              │
     ├─ Q <= minor_threshold        └─ Requires PO/GRPO & Driver Sig
     │   └─ RM or FC Approves           └─ FC (APPROVER) Strictly Required
     │
     └─ Q > minor_threshold
         └─ FC (APPROVER) Strictly Required
```

### 3.1 Threshold Rules
1. **Minor Waste Disposal (`quantity <= minor_threshold_qty`):**
   - Can be approved or rejected by either the Restaurant Manager (`RM`) or the Financial Controller (`APPROVER`).
   - Default threshold is `5.000` (e.g., kg or pcs) if no store-specific threshold record exists in `t_waste_threshold_config`.
2. **Major Waste Disposal (`quantity > minor_threshold_qty`):**
   - Strictly requires the Financial Controller (`APPROVER`) or `SYSTEM_ADMIN`.
   - If an RM attempts to approve major waste, the RPC rejects the action with error `P0001: RM cannot approve major waste`.
3. **Supplier Return (`movement_type = 'SUPPLIER_RETURN'`):**
   - Mandates matched inbound document reference (`po_number` or `grpo_doc_no`) and driver digital signature (`driver_signature_blob`).
   - Strictly requires the Financial Controller (`APPROVER`) or `SYSTEM_ADMIN`. The RM role cannot authorize supplier returns.
4. **Segregation of Duties:**
   - Frontline staff or managers who log a claim cannot authorize or reject that same claim.
   - Enforced by both database table check constraint and procedural verification in `approve_waste_or_return`.

---

## 4. Append-Only Immutability Guarantees

1. **Audit Log Protection:**
   - Trigger `trg_prevent_waste_returns_mutation` executes `BEFORE UPDATE OR DELETE` on `t_waste_returns_log`:
     - Intercepts all `DELETE` attempts and raises SQLSTATE `P0001`: `"Waste and supplier return logs are append-only and cannot be deleted."`
     - Intercepts `UPDATE` attempts on finalized claims (`OLD.approver_decision != 'PENDING'`) and raises `P0001`: `"Finalized waste or return records cannot be modified."`
     - Validates that initial logged fields (`log_id`, `store_id`, `warehouse_id`, `movement_type`, `item_code`, `quantity`, `uom`, `logged_by_user_id`, `created_at`) cannot be tampered with during the transition from `PENDING` to `APPROVED` or `REJECTED`.
   - Direct SQL privilege revocation: `REVOKE DELETE ON public.t_waste_returns_log FROM PUBLIC, authenticated, anon;`
2. **Ledger Immutability:**
   - Approvals insert directly into `t_stock_movements` with negative physical quantity (`-abs(quantity)`).
   - `t_stock_movements` is protected by `trg_prevent_ledger_mutation` (never updated, deleted, or truncated).

---

## 5. Stored Procedures (RPCs)

### 5.1 `log_waste_or_return`
Submits a new waste disposal or supplier return claim for approval.

- **Signature:**
  ```sql
  public.log_waste_or_return(
    p_store_id text,
    p_warehouse_id text,
    p_movement_type text,
    p_item_code text,
    p_quantity numeric,
    p_uom text,
    p_reason_code text,
    p_reason_text text,
    p_photo_url text DEFAULT NULL,
    p_po_number text DEFAULT NULL,
    p_grpo_doc_no text DEFAULT NULL,
    p_driver_signature text DEFAULT NULL
  ) RETURNS uuid
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, auth, pg_temp`.
- **Authorization & Validation:**
  1. Resolves caller UUID via `app.current_user_id`, `request.jwt.claim.sub`, or `auth.uid()`.
  2. Blocks read-only `VIEWER` users from logging claims.
  3. Enforces store scope alignment (`current_store_id() = p_store_id` unless `SYSTEM_ADMIN` or `APPROVER`).
  4. Validates that `p_movement_type` is either `'WASTE_DISPOSAL'` or `'SUPPLIER_RETURN'`.
  5. Enforces strictly positive quantity (`p_quantity > 0`).
  6. Validates existence of `p_store_id`, `p_warehouse_id` in store, and `p_item_code`.
  7. For `'SUPPLIER_RETURN'`, validates presence of `p_driver_signature` and at least one reference document (`p_po_number` or `p_grpo_doc_no`).
  8. Appends row to `t_waste_returns_log` with status `PENDING` and returns `log_id`.

### 5.2 `approve_waste_or_return`
Authorizes or rejects a pending waste or supplier return claim, updating claim state and appending physical stock movements upon approval.

- **Signature:**
  ```sql
  public.approve_waste_or_return(
    p_log_id uuid,
    p_decision text,
    p_comment text DEFAULT NULL
  ) RETURNS void
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, auth, pg_temp`.
- **Authorization & Guards:**
  1. Validates that `p_decision` is either `'APPROVED'` or `'REJECTED'`.
  2. Resolves caller UUID; verifies active session.
  3. Acquires row-level exclusive lock on claim (`FOR UPDATE`); verifies `approver_decision = 'PENDING'`.
  4. Enforces segregation of duties: `v_caller_id != v_log.logged_by_user_id`.
  5. Verifies caller store scope against `v_log.store_id` (unless `SYSTEM_ADMIN` or `APPROVER`).
  6. Resolves minor threshold from `t_waste_threshold_config` (defaults to `5.000` if unconfigured).
  7. Role & threshold enforcement:
     - `APPROVER` / `SYSTEM_ADMIN`: Authorized for all waste sizes and supplier returns.
     - `RM`: Authorized **only** for `WASTE_DISPOSAL` where `quantity <= minor_threshold_qty`. Rejects supplier returns or major waste claims.
  8. If `p_decision = 'REJECTED'`:
     - Updates `approver_user_id = v_caller_id`, `approver_decision = 'REJECTED'`, `approver_comment = p_comment`, `authorized_at = now()`.
  9. If `p_decision = 'APPROVED'`:
     - Appends movement to `t_stock_movements`:
       - `movement_type`: `v_log.movement_type` (`WASTE_DISPOSAL` or `SUPPLIER_RETURN`)
       - `quantity`: `-abs(v_log.quantity)` (negative delta)
       - `reference_doc_id`: `v_log.log_id::text`
       - `created_by_user_id`: `v_caller_id::text`
     - Updates `t_waste_returns_log`:
       - `movement_id = v_movement_id`, `approver_decision = 'APPROVED'`, `approver_user_id = v_caller_id`, `approver_comment = p_comment`, `authorized_at = now()`.

---

## 6. Row-Level Security (RLS) Policies

### 6.1 `t_waste_threshold_config`
- **SELECT (`t_waste_threshold_config_select`):** Available to authenticated users matching store scope (`current_store_id() = store_id`), global `SYSTEM_ADMIN`, `APPROVER`, or `VIEWER`.
- **INSERT / UPDATE (`t_waste_threshold_config_insert`, `t_waste_threshold_config_update`):** Restricted to `has_role('APPROVER') OR has_role('SYSTEM_ADMIN')`.
- **DELETE (`t_waste_threshold_config_delete`):** Restricted to `has_role('SYSTEM_ADMIN')`.

### 6.2 `t_waste_returns_log`
- **SELECT (`t_waste_returns_log_select`):** Available to authenticated users in store scope, `SYSTEM_ADMIN`, `APPROVER`, and `VIEWER`.
- **INSERT (`t_waste_returns_log_insert`):** Permitted for store staff roles within store scope; read-only `VIEWER` users are explicitly excluded. Enforces initial fields `approver_decision = 'PENDING'`, `approver_user_id IS NULL`, and `movement_id IS NULL`.
- **UPDATE (`t_waste_returns_log_update`):** Direct SQL updates are disabled (`USING (false)`). All state transitions must be executed through `approve_waste_or_return()`.
- **DELETE (`t_waste_returns_log_delete`):** Disabled (`USING (false)`).

---

## 7. Verification & Automated Test Suite

Comprehensive pgTAP automated tests are implemented in `supabase/tests/0110_waste.sql` covering 54 assertions:
- **Schema & Metadata (Tests 1–21):** Validates table existence, primary key definitions, exact column arrays, numeric/uuid data types, all foreign key relationships to stores, warehouses, items, ledger, and auth users, plus RLS status.
- **Constraints & Immutability (Tests 22–28):** Validates check constraints for positive quantity, valid movement types, approver decisions, logger≠approver segregation, and carrier signature rules for supplier returns. Verifies append-only triggers blocking deletes and edits on finalized rows.
- **RPC Functional Workflows (Tests 29–54):**
  - Logging minor waste, major waste, and supplier returns.
  - Negative tests for missing driver signature, missing reference docs, non-existent warehouses, viewer logging attempts, and cross-store logging.
  - Segregation of duties validation (logger blocked from approving own claim).
  - RM minor waste approval below threshold with negative ledger deduction (`-2.500 kg`).
  - RM major waste approval block above threshold (`12.000 kg > 5.000 kg`).
  - FC major waste approval success with negative ledger deduction (`-12.000 kg`).
  - RM supplier return approval block.
  - FC supplier return approval success with negative ledger deduction (`-8.000 kg`).
  - RM rejection workflow with comment recording and zero ledger mutation.
  - Protection against re-approving finalized claims and cross-store approval attempts.
