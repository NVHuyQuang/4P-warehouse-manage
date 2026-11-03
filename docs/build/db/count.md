# Domain D9: Physical Stock Count & Reconciliation

## 1. Domain Overview
Domain D9 implements physical inventory count execution, blind count verification, discrepancy recount governance, and Financial Controller (FC) reconciliation write-offs for the Pizza 4P's India Inventory Control Tool. It models **Flow F (Count & Reconciliation)** across both weekly cycle counts and month-end full cutoff counts.

### Invariants & Non-Negotiable Boundaries
- **Physical Quantities Only:** All count headers, line items, vouchers, and posted ledger movements persist physical quantities only. Zero price, unit cost, valuation, margin, tax, or vendor attributes are permitted anywhere in tables, stored procedures, views, or policies.
- **Append-Only Immutability:** Inventory discrepancies are reconciled strictly by appending `COUNT_ADJUSTMENT` rows (+ or − delta) to `t_stock_movements`. Neither `t_stock_movements` nor approved `t_stock_adjustments` records may ever be updated or deleted.
- **Physical Storeroom Freeze:** During active counts, the target warehouse status transitions to `FROZEN_FOR_COUNT`, halting dock put-aways and kitchen requisitions until the count is balanced or authorized by the Financial Controller.
- **Segregation of Duties (SoD):** A physical counter (Warehouse Keeper or Store Accountant) cannot approve an adjustment voucher for their own count (`fc_approval_id != keeper_user_id` and `fc_approval_id != accountant_user_id`). Only an independent Financial Controller (`APPROVER`) or `SYSTEM_ADMIN` can authorize stock adjustments.

---

## 2. Relational Schema & Tables

### 2.1 `t_stock_counts` (Count Session Header)
Tracks count sessions, storeroom operational freeze status, counting participants, and workflow lifecycle.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `count_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique count session identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Restaurant branch code (e.g., `IND-DEL-01`). |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Storeroom identifier (e.g., `WH-DEL01-DRY`). |
| `count_type` | `text` | `NOT NULL CHECK (count_type IN ('WEEKLY_CYCLE', 'MONTH_END_FULL'))` | Scope of count (partial cycle vs full cutoff). |
| `freeze_status` | `text` | `NOT NULL CHECK (freeze_status IN ('FROZEN', 'UNFROZEN')) DEFAULT 'FROZEN'` | Storeroom operational freeze state. |
| `keeper_user_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Storekeeper who conducts blind first count. |
| `accountant_user_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Second counter (Accountant) conducting recount. |
| `status` | `text` | `NOT NULL CHECK (status IN ('IN_PROGRESS', 'RECOUNT', 'COMPLETED')) DEFAULT 'IN_PROGRESS'` | Current state machine lifecycle position. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Session initiation timestamp. |
| `completed_at` | `timestamptz` | `NULL` | Timestamp when count balanced or adjustments approved. |

- **Indexes:**
  - `idx_stock_counts_store_wh` on `(store_id, warehouse_id)`
  - `idx_stock_counts_status` on `(status)`
  - `idx_stock_counts_created_at` on `created_at DESC`
  - `idx_stock_counts_keeper` on `(keeper_user_id)`
  - `idx_stock_counts_accountant` on `(accountant_user_id)`

---

### 2.2 `t_stock_count_items` (Count Line Items & Blind Comparison)
Maintains expected book quantities and physical counts per item.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `count_item_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique line item record identifier. |
| `count_id` | `uuid` | `NOT NULL REFERENCES t_stock_counts(count_id) ON DELETE CASCADE` | Parent count session reference. |
| `item_code` | `text` | `NOT NULL REFERENCES m_items(item_code)` | Material SKU identifier. |
| `book_qty` | `numeric(12,3)` | `NOT NULL` | Snapshotted expected ledger stock at initiation. |
| `first_count_qty` | `numeric(12,3)` | `NULL` | First physical count submitted blindly by Keeper. |
| `recount_qty` | `numeric(12,3)` | `NULL` | Second physical count submitted by Accountant. |
| `final_counted_qty` | `numeric(12,3)` | `NULL` | Accepted physical count (`first_count_qty` or `recount_qty`). |
| `difference_qty` | `numeric(12,3)` | `NULL` | Variance delta: `final_counted_qty - book_qty`. |
| `uom` | `text` | `NOT NULL` | Unit of measure (`kg` or `pcs`). |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Item inclusion timestamp. |

- **Constraints:**
  - `uq_count_item`: `UNIQUE (count_id, item_code)`
- **Indexes:**
  - `idx_stock_count_items_count_id` on `(count_id)`
  - `idx_stock_count_items_item` on `(item_code)`

---

### 2.3 `t_stock_adjustments` (FC Adjustment Vouchers)
Holds authorized write-off or surplus adjustment requests submitted for Financial Controller sign-off.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `adjustment_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique adjustment voucher identifier. |
| `count_id` | `uuid` | `NOT NULL REFERENCES t_stock_counts(count_id)` | Parent count session reference. |
| `item_code` | `text` | `NOT NULL REFERENCES m_items(item_code)` | Material SKU identifier. |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Target storeroom where variance occurred. |
| `adjustment_qty` | `numeric(12,3)` | `NOT NULL` | Signed reconciliation delta (+ surplus / − shrinkage). |
| `root_cause_reason` | `text` | `NOT NULL` | Mandatory root-cause explanation for variance. |
| `fc_approval_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Financial Controller who approves adjustment. |
| `movement_id` | `uuid` | `NULL REFERENCES t_stock_movements(movement_id)` | Immutable ledger movement link upon approval. |
| `approved_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Timestamp when adjustment was authorized. |

- **Constraints:**
  - `chk_stock_adjustment_reason`: `length(trim(root_cause_reason)) > 0`
  - `chk_stock_adjustment_qty_nonzero`: `adjustment_qty != 0`
- **Indexes:**
  - `idx_stock_adjustments_count` on `(count_id)`
  - `idx_stock_adjustments_wh_item` on `(warehouse_id, item_code)`
  - `idx_stock_adjustments_fc` on `(fc_approval_id)`
  - `idx_stock_adjustments_movement` on `(movement_id)`

---

## 3. Freeze Lifecycle & Operating States

```
                +------------------------------------------------+
                |             Warehouse status = ACTIVE          |
                +------------------------------------------------+
                                        |
                 initiate_stock_count() |
                                        v
                +------------------------------------------------+
                |        Warehouse status = FROZEN_FOR_COUNT     |
                |        t_stock_counts.freeze_status = FROZEN   |
                |        t_stock_counts.status = IN_PROGRESS     |
                +------------------------------------------------+
                                        |
                 submit_first_count()   |
                                        v
                         [Diff == 0 for all items?]
                                /                 \
                       YES    /                     \   NO (Discrepancy detected)
                            v                         v
        +--------------------------------+   +--------------------------------+
        |   Count status = COMPLETED     |   |   Count status = RECOUNT       |
        |   freeze_status = UNFROZEN     |   |   freeze_status = FROZEN       |
        |   Warehouse status = ACTIVE    |   |   Warehouse = FROZEN_FOR_COUNT |
        +--------------------------------+   +--------------------------------+
                                                              |
                                           submit_recount()   |
                                                              v
                                              [Recount resolves diff?]
                                                     /          \
                                            YES    /              \   NO (Confirmed diff)
                                                 v                  v
                             +-----------------------+   +-----------------------+
                             | Count = COMPLETED     |   | Count = RECOUNT       |
                             | Warehouse = ACTIVE    |   | Warehouse = FROZEN    |
                             +-----------------------+   +-----------------------+
                                                                     |
                                             approve_stock_adjustment()
                                             (FC signs voucher)     |
                                                                     v
                                                     +-------------------------------+
                                                     | Appends COUNT_ADJUSTMENT      |
                                                     | Count status = COMPLETED      |
                                                     | freeze_status = UNFROZEN      |
                                                     | Warehouse status = ACTIVE     |
                                                     +-------------------------------+
```

### Freeze Mechanisms
1. **Initiation Freeze:** Calling `initiate_stock_count` immediately sets `m_warehouses.status = 'FROZEN_FOR_COUNT'::warehouse_status`. While frozen, warehouse inventory is locked against requisition picking and vendor receiving.
2. **First Count Evaluation:**
   - **Balanced Path:** If physical quantities match expected book quantities for all items (`difference_qty == 0`), the count is signed as balanced. `m_warehouses.status` automatically reverts to `'ACTIVE'`, and `t_stock_counts.status` transitions to `'COMPLETED'`.
   - **Discrepancy Path:** If any item has `difference_qty != 0`, the storeroom remains frozen, and the count transitions to `'RECOUNT'`.
3. **Recount Phase:** A second independent counter (Store Accountant) counts the discrepancy lines.
   - If recount resolves the discrepancy (`recount_qty == book_qty`), count completes and the room unfreezes.
   - If recount confirms the discrepancy, the storeroom remains frozen until the Financial Controller reviews the root cause reason and approves an adjustment voucher.
4. **Post-Approval Release:** When `approve_stock_adjustment` executes, it appends a `COUNT_ADJUSTMENT` movement to `t_stock_movements`, links the `movement_id`, unfreezes the warehouse back to `'ACTIVE'`, and marks the count `'COMPLETED'`.

---

## 4. Immutability & Segregation of Duties

### 4.1 Segregation of Duties Trigger (`tg_enforce_stock_adjustment_sod`)
A database-level `BEFORE INSERT OR UPDATE` trigger on `t_stock_adjustments` strictly prohibits self-approval:
```sql
CREATE OR REPLACE FUNCTION public.tg_enforce_stock_adjustment_sod()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_keeper_id uuid;
  v_accountant_id uuid;
BEGIN
  SELECT keeper_user_id, accountant_user_id
  INTO v_keeper_id, v_accountant_id
  FROM public.t_stock_counts
  WHERE count_id = NEW.count_id;

  IF NEW.fc_approval_id = v_keeper_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (keeper) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  IF v_accountant_id IS NOT NULL AND NEW.fc_approval_id = v_accountant_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Counter (accountant) cannot approve adjustment voucher.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
```

### 4.2 Immutability Trigger (`tg_prevent_approved_adjustment_mutation`)
Once an adjustment has been approved and its corresponding ledger movement has posted (`movement_id IS NOT NULL`), the adjustment voucher is locked against any further modification or deletion:
```sql
CREATE OR REPLACE FUNCTION public.tg_prevent_approved_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'Approved stock adjustments are immutable and cannot be deleted.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'Approved stock adjustments are immutable and cannot be updated.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
```

---

## 5. Stored Procedures (RPCs)

All RPCs execute as `SECURITY DEFINER` with `SET search_path = public, auth, pg_temp`.

### 5.1 `initiate_stock_count`
- **Signature:**
  ```sql
  public.initiate_stock_count(
    p_store_id text,
    p_warehouse_id text,
    p_count_type text
  ) RETURNS uuid
  ```
- **Authorized Roles:** `ADMIN` (Storekeeper), `CUSTODIAN`, `RM` (Restaurant Manager), `SYSTEM_ADMIN`.
- **Pre-Conditions:**
  - Caller store scope matches `p_store_id`.
  - Warehouse belongs to store and has no other active count in progress.
  - `p_count_type` is `'WEEKLY_CYCLE'` or `'MONTH_END_FULL'`.
- **Side Effects:**
  - Freezes warehouse storeroom (`m_warehouses.status = 'FROZEN_FOR_COUNT'`).
  - Creates header in `t_stock_counts` with `status = 'IN_PROGRESS'`.
  - Snapshots existing book stock from `v_stock_current` into `t_stock_count_items`.
  - Returns generated `count_id`.

### 5.2 `submit_first_count`
- **Signature:**
  ```sql
  public.submit_first_count(
    p_count_id uuid,
    p_counts jsonb
  ) RETURNS void
  ```
- **Authorized Roles:** `ADMIN` (Storekeeper), `CUSTODIAN`, `RM`, `SYSTEM_ADMIN`.
- **Input Format:** Supports JSON array of objects (`[{"item_code": "ITM-001", "counted_qty": 95.0}]`) or JSON key-value map (`{"ITM-001": 95.0}`).
- **Logic:**
  - Updates `first_count_qty`, `final_counted_qty`, and computes `difference_qty = counted_qty - book_qty`.
  - If all lines evaluate to `difference_qty == 0`: marks count `'COMPLETED'`, lifts freeze (`'UNFROZEN'`), and unfreezes warehouse to `'ACTIVE'`.
  - If any line has `difference_qty != 0`: updates count status to `'RECOUNT'` and keeps room frozen.

### 5.3 `submit_recount`
- **Signature:**
  ```sql
  public.submit_recount(
    p_count_id uuid,
    p_counts jsonb
  ) RETURNS void
  ```
- **Authorized Roles:** `ACCOUNTANT` (Store Accountant), `RM`, `SYSTEM_ADMIN`.
- **Logic:**
  - Records `accountant_user_id` on the count session header.
  - Updates `recount_qty`, `final_counted_qty`, and re-computes `difference_qty`.
  - If recount resolves difference (`difference_qty == 0` for all lines): completes count and unfreezes warehouse.
  - If discrepancy is confirmed: count remains in `'RECOUNT'` awaiting FC adjustment voucher submission.

### 5.4 `approve_stock_adjustment`
- **Signature:**
  ```sql
  public.approve_stock_adjustment(
    p_adjustment_id uuid,
    p_notes text DEFAULT NULL
  ) RETURNS void
  ```
- **Authorized Roles:** `APPROVER` (Financial Controller), `SYSTEM_ADMIN`.
- **Pre-Conditions:**
  - Caller cannot be `keeper_user_id` or `accountant_user_id` of parent count (Segregation of Duties).
  - Adjustment voucher must not be already approved (`movement_id IS NULL`).
- **Side Effects:**
  - Appends an immutable `COUNT_ADJUSTMENT` movement row to `t_stock_movements` with the exact signed adjustment quantity (+ surplus or − write-off).
  - Updates `t_stock_adjustments.movement_id = v_movement_id` and sets `approved_at = now()`.
  - When all adjustments for the count session are approved:
    - Sets `t_stock_counts.status = 'COMPLETED'` and `freeze_status = 'UNFROZEN'`.
    - Unfreezes storeroom: `m_warehouses.status = 'ACTIVE'`.

---

## 6. Row Level Security (RLS) Policies

All 3 tables have RLS strictly enabled:

### 6.1 `t_stock_counts`
- **SELECT:** Authorized authenticated users within their active store scope (`store_id = current_store_id()`), or users holding global roles `SYSTEM_ADMIN`, `APPROVER` (FC), or `VIEWER` (Auditor).
- **INSERT:** Restricted to Keeper (`ADMIN`), `CUSTODIAN`, `RM`, `ACCOUNTANT`, or `SYSTEM_ADMIN` within matching store scope.
- **UPDATE:** Allowed for Keeper, Accountant, RM, Approver, or System Admin within store scope.
- **DELETE:** Hard-blocked (`USING (false)`).

### 6.2 `t_stock_count_items`
- **SELECT:** Inherited from parent `t_stock_counts` access.
- **INSERT / UPDATE:** Authorized for Keeper, Accountant, RM, or System Admin within parent count store scope.
- **DELETE:** Hard-blocked (`USING (false)`).

### 6.3 `t_stock_adjustments`
- **SELECT:** Store scope or global roles (`SYSTEM_ADMIN`, `APPROVER`, `VIEWER`).
- **INSERT:** Permitted for `ACCOUNTANT`, `ADMIN`, `RM`, `APPROVER`, `SYSTEM_ADMIN` within store scope.
- **UPDATE:** Restricted exclusively to Financial Controller (`APPROVER`) and `SYSTEM_ADMIN`.
- **DELETE:** Hard-blocked (`USING (false)`).

---

## 7. Worked Numerical Example (Flow F)

### Scenario: Month-End Full Count with Shrinkage Reconciliation

1. **Initial State:**
   - Item: `ITM-DRY-001` (San Marzano Tomato Cans) in `WH-DEL01-DRY`.
   - Current derived stock in `v_stock_current`: `100.000 kg`.
   - Warehouse status: `'ACTIVE'`.

2. **Step 1: Initiation:**
   - Storekeeper initiates count via `initiate_stock_count('IND-DEL-01', 'WH-DEL01-DRY', 'MONTH_END_FULL')`.
   - `m_warehouses.status` transitions to `'FROZEN_FOR_COUNT'`.
   - `t_stock_counts` created with `status = 'IN_PROGRESS'`, `freeze_status = 'FROZEN'`.
   - `t_stock_count_items` line created: `book_qty = 100.000 kg`.

3. **Step 2: Blind First Count:**
   - Storekeeper enters physical count of `95.000 kg` via `submit_first_count`.
   - Line evaluated: `difference_qty = 95.000 - 100.000 = -5.000 kg`.
   - Discrepancy detected: `t_stock_counts.status` transitions to `'RECOUNT'`.
   - Warehouse remains `'FROZEN_FOR_COUNT'`.

4. **Step 3: Recount by Second Person (Store Accountant):**
   - Store Accountant performs recount and confirms physical stock is `95.000 kg` via `submit_recount`.
   - Recount confirms `-5.000 kg` difference.
   - Accountant drafts adjustment voucher in `t_stock_adjustments`:
     - `adjustment_qty = -5.000 kg`
     - `root_cause_reason = 'Two 2.5kg cans found dented/compromised behind bin shelf'`
     - `fc_approval_id = [FC User UUID]`

5. **Step 4: Financial Controller Review & Approval:**
   - Financial Controller reviews root cause reason and executes `approve_stock_adjustment(adj_id)`.
   - Segregation of duties check confirms FC is neither the keeper nor the accountant.
   - System appends `COUNT_ADJUSTMENT` movement to `t_stock_movements`:
     - `movement_type = 'COUNT_ADJUSTMENT'`
     - `quantity = -5.000 kg`
     - `reference_doc_id = [Adjustment UUID]`
   - `t_stock_adjustments.movement_id` is updated with the generated ledger movement ID.
   - `m_warehouses.status` unfreezes to `'ACTIVE'`.
   - `t_stock_counts.status` transitions to `'COMPLETED'`, `freeze_status = 'UNFROZEN'`.

6. **Final Reconciled State:**
   - Sum in `v_stock_current`: $100.000 - 5.000 = 95.000\text{ kg}$.
   - System book stock perfectly matches physical reality, backed by an unbroken immutable audit trail.
