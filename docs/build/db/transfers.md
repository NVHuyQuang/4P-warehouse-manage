# Database Domain: Store Transfers & In-Transit Custody (D10)

## 1. Domain Overview
The Store Transfers domain governs physical inventory transfers between restaurant branches for the Pizza 4P's India Inventory Control Tool. It implements:
- **Flow G (Inter-Store Transfers):** Tracks stock dispatch from a source store, vehicle transit under tamper-evident seals, receipt verification at a target store, and managerial resolution of transit discrepancies.
- **Append-Only Ledger Integration:** Every stock movement is an immutable record in `t_stock_movements`. Dispatch appends `TRANSFER_OUT_INTRANSIT` (`-Q`) at the sending warehouse, immediately deducting dispatch stock from available book stock. Confirmation at the destination warehouse appends `TRANSFER_IN_RECEIVED` (`+Q`), making the physical inventory available at the destination.
- **Dual-Unit Rule:** Cheese and meat items require both weight (`dispatch_qty_kg`) and piece counts (`dispatch_qty_pcs`) to eliminate cutting shrinkage ambiguity during transit.
- **Segregation of Duties:** The dispatcher cannot act as the receiver, and the dispatcher cannot approve transit variances. Variances escalate directly to the Financial Controller (`APPROVER`).
- **Physical Quantities Invariant:** Strictly physical quantities and unit counts only. Non-commercial operational tracking across all tables, procedures, and policies.

---

## 2. Relational Schema & Tables

### 2.1 `t_transfer_intransit`
Tracks the lifecycle of inter-store transfers from dispatch through delivery and final sign-off.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `transfer_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique transfer transaction identifier. |
| `source_store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Sending store branch identifier. |
| `source_warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Sending warehouse / storeroom. |
| `target_store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Receiving store branch identifier. |
| `target_warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Receiving warehouse / storeroom. |
| `item_code` | `text` | `NOT NULL REFERENCES m_items(item_code)` | Inventory item transferred. |
| `dispatch_qty_kg` | `numeric(12,3)` | `NOT NULL CHECK (dispatch_qty_kg > 0)` | Dispatched weight in kilograms. |
| `dispatch_qty_pcs` | `numeric(12,3)` | `NULL CHECK (dispatch_qty_pcs IS NULL OR dispatch_qty_pcs > 0)` | Dispatched piece count (mandatory for cheese/meat). |
| `vehicle_seal_no` | `text` | `NOT NULL CHECK (length(trim(vehicle_seal_no)) > 0)` | Tamper-evident vehicle container seal identifier. |
| `dispatcher_user_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Dispatching keeper / sender user identifier. |
| `dispatched_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Dispatch timestamp. |
| `receive_qty_kg` | `numeric(12,3)` | `NULL CHECK (receive_qty_kg IS NULL OR receive_qty_kg >= 0)` | Physically counted weight at destination. |
| `receive_qty_pcs` | `numeric(12,3)` | `NULL CHECK (receive_qty_pcs IS NULL OR receive_qty_pcs >= 0)` | Physically counted pieces at destination. |
| `receiver_user_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Receiving keeper user identifier. |
| `received_at` | `timestamptz` | `NULL` | Timestamp of destination receipt. |
| `variance_qty` | `numeric(12,3)` | `NULL` | Difference (`receive_qty_kg - dispatch_qty_kg`). |
| `fc_approval_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Financial Controller approver user identifier. |
| `status` | `text` | `NOT NULL CHECK (...) DEFAULT 'IN_TRANSIT'` | Current transfer lifecycle status. |
| `out_movement_id` | `uuid` | `NULL REFERENCES t_stock_movements(movement_id)` | Foreign key to outbound ledger movement. |
| `in_movement_id` | `uuid` | `NULL REFERENCES t_stock_movements(movement_id)` | Foreign key to inbound ledger movement. |
| `notes` | `text` | `NULL` | Justification or audit remarks on variances. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Timestamp of last modification. |

#### Database Constraints:
1. `chk_transfer_different_stores`:
   `CHECK (source_store_id != target_store_id)`
   Enforces that transfers must cross store boundaries. Internal inter-room moves within a single store use local requisition flows.
2. `chk_transfer_distinct_users`:
   `CHECK (receiver_user_id IS NULL OR dispatcher_user_id != receiver_user_id)`
   Enforces segregation of duties: the user who dispatched the shipment cannot confirm receipt.
3. `chk_transfer_distinct_fc`:
   `CHECK (fc_approval_id IS NULL OR dispatcher_user_id != fc_approval_id)`
   Enforces segregation of duties: the user who dispatched the shipment cannot approve transit variances.

#### Indexes:
- `idx_transfers_source_store_wh` on `(source_store_id, source_warehouse_id)`
- `idx_transfers_target_store_wh` on `(target_store_id, target_warehouse_id)`
- `idx_transfers_item` on `(item_code)`
- `idx_transfers_status` on `(status)`
- `idx_transfers_dispatcher` on `(dispatcher_user_id)`
- `idx_transfers_receiver` on `(receiver_user_id)`
- `idx_transfers_fc_approval` on `(fc_approval_id)`
- `idx_transfers_dispatched_at` on `(dispatched_at DESC)`
- `idx_transfers_out_movement` on `(out_movement_id)`
- `idx_transfers_in_movement` on `(in_movement_id)`

---

## 3. Dual-Unit Rule (Cheese & Meat)
In artisan pizza operations, fresh whole cheese wheels and cured meats lose moisture and undergo slicing. When transferring these items between outlets:
1. **Ambiguity Prevention:** Recording only weight allows unmonitored shrinkage (e.g. cutting portions off a whole wheel without detection). Recording only pieces hides weight discrepancy.
2. **Mandatory Enforcement:** Any item categorized under `category_group IN ('CHEESE', 'MEAT')` or flagged with `dual_uom_required = true` in `m_uom_conversions` strictly requires both `dispatch_qty_kg` and `dispatch_qty_pcs` (`> 0`) upon dispatch.
3. **Receipt Validation:** If a transfer was dispatched with piece counts, the receiving keeper must record both `receive_qty_kg` and `receive_qty_pcs` (`>= 0`).
4. **General Goods:** Non-meat, non-cheese dry goods (flour, oil, salt) require `dispatch_qty_kg` only, with `dispatch_qty_pcs` optional.

---

## 4. Transit State Machine (Flow G)

```
[IN_TRANSIT] (Dispatch: TRANSFER_OUT_INTRANSIT [-Q] booked at source)
    |
    |---> Counted quantities match dispatched quantities
    |        `---> [RECEIVED_MATCH] (Terminal: TRANSFER_IN_RECEIVED [+Q] booked at target)
    |
    `---> Discrepancy detected (receive_qty_kg != dispatch_qty_kg or pcs mismatch)
             `---> [VARIANCE_PENDING_FC] (No target stock booked; stock held in transit)
                      |
                      |---> FC approves variance
                      |        `---> [RECEIVED_VARIANCE_APPROVED] (Terminal: TRANSFER_IN_RECEIVED [+receive_qty_kg])
                      |
                      `---> FC rejects variance
                               `---> [REJECTED] (Terminal: Stock remains unbooked, shrinkage investigated)
```

### State Definitions:
- `IN_TRANSIT`: Shipment is packed, sealed, and dispatched. Physical goods have left the source storeroom (`-Q` recorded in ledger). Not yet received at target.
- `RECEIVED_MATCH`: Destination keeper verified the vehicle seal and confirmed exact match in both weight and piece units. Inbound ledger entry (`+Q`) is appended immediately at target storeroom.
- `VARIANCE_PENDING_FC`: Destination keeper counted a discrepancy. Variance is calculated (`receive_qty_kg - dispatch_qty_kg`) and flagged for Financial Controller review. Inbound stock is NOT booked until approval.
- `RECEIVED_VARIANCE_APPROVED`: Financial Controller reviewed transit notes, verified seal logs, and approved the discrepancy. Target warehouse books the actual counted quantity received (`+receive_qty_kg`), and the remaining difference represents approved transit shrinkage.
- `REJECTED`: Financial Controller rejected the transfer variance (e.g. broken seal or unauthorized route). No stock is booked into receiving store book balance until formal dispute resolution.

---

## 5. Stored Procedures (RPCs)

### 5.1 `dispatch_store_transfer`
Dispatches an inter-store transfer, decrements source book stock via `TRANSFER_OUT_INTRANSIT`, and records in-transit state.

- **Signature:**
  ```sql
  public.dispatch_store_transfer(
    p_source_store_id text,
    p_source_warehouse_id text,
    p_target_store_id text,
    p_target_warehouse_id text,
    p_item_code text,
    p_qty_kg numeric,
    p_qty_pcs numeric DEFAULT NULL,
    p_seal_no text DEFAULT NULL
  ) RETURNS uuid
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, auth`.
- **Authorization & Guards:**
  1. **Role Check:** Caller must possess role `ADMIN` (Keeper), `RM` (Restaurant Manager), or `SYSTEM_ADMIN`.
  2. **Store Scope Check:** Caller's store scope must match `p_source_store_id` (unless `SYSTEM_ADMIN`).
  3. **Caller Context:** Resolves authenticated user UUID from session settings or JWT claims.
  4. **Inter-Store Validation:** Enforces `p_source_store_id != p_target_store_id`.
  5. **Master Data Verification:** Validates existence of source/target stores and storerooms, and verifies item is active in `m_items`.
  6. **Vehicle Seal:** Validates non-empty `p_seal_no`.
  7. **Dual-Unit Rule:** Rejects cheese or meat items if `p_qty_pcs` is NULL or `<= 0`.
  8. **Ledger Execution:** Inserts `TRANSFER_OUT_INTRANSIT` with `-p_qty_kg` into `t_stock_movements`.
  9. **Record Creation:** Appends record into `t_transfer_intransit` with status `'IN_TRANSIT'` and returns `transfer_id`.

### 5.2 `receive_store_transfer`
Receives an incoming transfer at the target outlet, comparing counted physical quantities against dispatch records.

- **Signature:**
  ```sql
  public.receive_store_transfer(
    p_transfer_id uuid,
    p_receive_qty_kg numeric,
    p_receive_qty_pcs numeric DEFAULT NULL
  ) RETURNS void
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, auth`.
- **Authorization & Guards:**
  1. **Role Check:** Caller must possess role `ADMIN`, `RM`, or `SYSTEM_ADMIN`.
  2. **Status Check:** Transfer must be in status `'IN_TRANSIT'`.
  3. **Segregation of Duties:** Explicitly enforces `v_caller_id != dispatcher_user_id`. The dispatcher cannot receive their own shipment.
  4. **Store Scope Check:** Caller's store scope must match `target_store_id`.
  5. **Dual-Unit Check:** If transfer has `dispatch_qty_pcs`, receiver must provide non-negative `p_receive_qty_pcs`.
  6. **Branching Logic:**
     - **Match:** If weight and pieces match dispatched quantities, status transitions to `'RECEIVED_MATCH'`, `variance_qty` is set to 0, and `TRANSFER_IN_RECEIVED` (`+p_receive_qty_kg`) is appended to `t_stock_movements` at target warehouse.
     - **Discrepancy:** If quantities differ, `variance_qty` is calculated (`p_receive_qty_kg - dispatch_qty_kg`), status transitions to `'VARIANCE_PENDING_FC'`, and no ledger entry is appended until FC approves.

### 5.3 `approve_transfer_variance`
Allows the Financial Controller to review and approve transit discrepancies, releasing the received stock into the destination ledger.

- **Signature:**
  ```sql
  public.approve_transfer_variance(
    p_transfer_id uuid,
    p_notes text DEFAULT NULL
  ) RETURNS void
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, auth`.
- **Authorization & Guards:**
  1. **Role Check:** Caller must possess role `APPROVER` (Financial Controller) or `SYSTEM_ADMIN`.
  2. **Status Check:** Transfer must be in status `'VARIANCE_PENDING_FC'`.
  3. **Segregation of Duties:** Explicitly enforces `v_caller_id != dispatcher_user_id`.
  4. **Ledger Execution:** Appends `TRANSFER_IN_RECEIVED` with `+receive_qty_kg` to `t_stock_movements` at target warehouse.
  5. **Record Update:** Sets `status = 'RECEIVED_VARIANCE_APPROVED'`, records `fc_approval_id`, and saves audit notes.

### 5.4 `reject_transfer_variance`
Allows the Financial Controller to reject an abnormal discrepancy, closing the transfer without adding disputed quantities to inventory.

- **Signature:**
  ```sql
  public.reject_transfer_variance(
    p_transfer_id uuid,
    p_notes text DEFAULT NULL
  ) RETURNS void
  ```
- **Execution Mode:** `SECURITY DEFINER`, `SET search_path = public, auth`.
- **Authorization & Guards:**
  1. **Role Check:** Caller must possess role `APPROVER` or `SYSTEM_ADMIN`.
  2. **Status Check:** Transfer must be in status `'VARIANCE_PENDING_FC'`.
  3. **Segregation of Duties:** Caller cannot be the dispatcher.
  4. **Record Update:** Sets `status = 'REJECTED'`, records `fc_approval_id`, and saves audit notes.

---

## 6. Row-Level Security (RLS) Policies

Row-Level Security is enabled on `t_transfer_intransit`:

| Policy Name | Action | Target Roles | Condition / Scope |
| :--- | :--- | :--- | :--- |
| `t_transfer_intransit_select` | `SELECT` | `authenticated` | Global viewers (`SYSTEM_ADMIN`, `APPROVER`, `VIEWER`), or store-scoped users matching `source_store_id` or `target_store_id`. |
| `t_transfer_intransit_insert` | `INSERT` | `ADMIN`, `RM`, `SYSTEM_ADMIN` | Store scope matching `source_store_id`, with `source_store_id != target_store_id`. |
| `t_transfer_intransit_update` | `UPDATE` | `ADMIN`, `RM`, `APPROVER`, `SYSTEM_ADMIN` | Destination keeper matching `target_store_id`, or Financial Controller approving variances. |
| `t_transfer_intransit_delete` | `DELETE` | None | Denied (`USING (false)`). Deletion is strictly prohibited. |

---

## 7. Append-Only Immutability Guarantees
1. **Transfer Records:** Deletion of transfer records is blocked at both the RLS level (`USING (false)`) and trigger level via `tg_prevent_transfer_deletion()`.
2. **Stock Movements:** Ledger writes (`TRANSFER_OUT_INTRANSIT` and `TRANSFER_IN_RECEIVED`) are append-only. Modification and deletion of rows in `t_stock_movements` are unconditionally blocked by `tg_prevent_ledger_mutation()`.

---

## 8. Verification & Test Suite
The pgTAP test suite in `supabase/tests/0100_transfers.sql` validates 84 assertions:
- **Schema & Types:** Table existence, primary key, 23 column names and data types, and 10 foreign keys.
- **RPC Availability:** Verifies existence of all four transfer management RPCs.
- **Constraints:** Tests rejection of identical stores, identical dispatcher/receiver, identical dispatcher/FC, negative quantities, and invalid statuses.
- **Immutability:** Verifies triggers block `DELETE` on `t_transfer_intransit` and `UPDATE`/`DELETE` on `t_stock_movements`.
- **Dual-Unit Rule:** Validates that cheese and meat transfers reject missing piece counts, while dry goods succeed without piece counts.
- **Lifecycle Scenarios:**
  - **Scenario 1:** Dispatch cheese transfer, verifying `IN_TRANSIT` status and negative ledger movement.
  - **Scenario 2:** Segregation of duties, blocking self-receipt by the dispatcher.
  - **Scenario 3:** Perfect match receipt, transitioning to `RECEIVED_MATCH` with positive inbound ledger entry.
  - **Scenario 4:** Discrepancy flow into `VARIANCE_PENDING_FC`, blocking non-FC approvals, and verifying inbound stock release upon FC approval.
  - **Scenario 5:** Discrepancy rejection into `REJECTED` by the Financial Controller.
- **Authorization & Scope:** Verifies rejection of out-of-scope store dispatches, unauthorized roles (`RUNNER`), and non-existent storerooms.
