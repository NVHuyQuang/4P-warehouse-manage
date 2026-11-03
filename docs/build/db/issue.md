# Database Domain: Stock Issue & Confirmation (Flow C-2) — Domain D6

## 1. Domain Overview
The **Stock Issue & Confirmation** domain governs physical ingredient retrieval, storeroom pick staging, kitchen runner door inspection, and digital receipt handoff for Pizza 4P's India Inventory Control Tool. It implements:
- **Flow C-2 (Stock Issue & Confirmation Lifecycle):** Coordinates warehouse keepers picking items from storeroom shelves following FIFO rules, divert expired lots, immediately deduct stock upon staging as a pending reservation, and record runner door confirmation, partial acceptance, or full decline.
- **Two-Stage Offset Mechanism (Doc §4.1 & Decision Q7):** Eliminates double-counting and prevents unlogged stock release without modifying historical ledger rows.

### Invariants & Non-Negotiable Boundaries
- **Physical Quantities Only:** All tables, RPCs, views, and policies operate strictly with physical quantities (`numeric(12,3)`). Zero price, cost, valuation, tax, or commercial/vendor data exist anywhere in this domain.
- **Append-Only Stock Ledger Integrity:** Stock movements are never updated or deleted. Physical reservations, door handovers, and returns to shelf are executed purely by appending signed movement rows to `t_stock_movements`.
- **Zero Double-Counting (Two-Stage Issue Lifecycle):**
  - Staging appends `ISSUE_PENDING` (signed negative `−Q_staged`), reducing book stock immediately to prevent double-picking.
  - Runner door confirmation symmetrically clears the reservation by appending `ISSUE_PENDING_OFFSET` (`+Q_staged`) and books actual confirmed consumption via `ISSUE_CONFIRMED` (`−Q_accepted`).
  - Runner door decline appends `ISSUE_REVERSAL` (`+Q_staged`), restoring available stock to the shelf.
- **Segregation of Duties:** The kitchen runner confirming or declining goods at the storeroom door **cannot** be the warehouse keeper who staged the issue. Only a `SYSTEM_ADMIN` can override this restriction for administrative testing.
- **Shelf-Life Radar Hard-Lock:** Candidate lots with `expiry_date <= CURRENT_DATE` are hard-locked and rejected with SQL exception `Candidate lot is expired and locked`.

---

## 2. Relational Schema Interactions

Domain D6 orchestrates state transitions and ledger records across existing tables and views established in Domains D1–D5:

```
                +------------------------------------+
                |            t_requests              |
                |  (status: QUEUED -> PICKING ->     |
                |   AWAITING_RUNNER -> CONFIRMED /   |
                |   PARTIAL_ACCEPTED / DECLINED)     |
                +------------------------------------+
                                  | 1
                                  |
                                  | has many (N)
                                  v
                +------------------------------------+
                |         t_request_items            |
                |  (requested_qty, issued_qty,       |
                |   variance_reason)                 |
                +------------------------------------+
                                  |
                                  | triggers append-only
                                  | entries upon stage/confirm
                                  v
                +------------------------------------+
                |        t_stock_movements           |
                |  (ISSUE_PENDING,                   |
                |   ISSUE_PENDING_OFFSET,            |
                |   ISSUE_CONFIRMED, ISSUE_REVERSAL) |
                +------------------------------------+
                                  |
                                  | aggregated by
                                  v
                +------------------------------------+
                |          v_stock_current           |
                |  (Derived Current Book Stock)      |
                +------------------------------------+
```

### 2.1 Table Columns Managed by Flow C-2
- **`t_requests`:**
  - `status`: Transitions from `'PICKING'` (or `'QUEUED'`) to `'AWAITING_RUNNER'` during staging, and reaches terminal status `'CONFIRMED'`, `'PARTIAL_ACCEPTED'`, or `'PARTIAL_DECLINED'`.
  - `runner_user_id`: Captures authenticated kitchen runner UUID (`auth.users.id`) accepting or declining at the door.
  - `runner_confirmed_at`: Records timestamp of door handoff completion.
  - `updated_at`: Synchronized automatically on each transition.
- **`t_request_items`:**
  - `issued_qty`: Staged physical quantity prepared by warehouse keeper.
  - `variance_reason`: Reason for discrepancy when `accepted_qty < staged_qty` or when goods are declined.
- **`t_stock_movements` (Append-Only Ledger):**
  - Appends signed physical quantity movements tagged with `reference_doc_id = p_request_id::text`.
  - Stores `batch_number`, `expiry_date`, `warehouse_id`, `uom`, and `created_by_user_id` (`m_users.user_id`).

---

## 3. Two-Stage Issue Lifecycle & State Machine

```
   [QUEUED / PICKING]
           |
           | Keeper calls stage_issue(request_id, staged_items)
           | - Checks lot validity (unexpired: expiry_date > CURRENT_DATE)
           | - Updates t_request_items.issued_qty = staged_qty
           | - Appends ISSUE_PENDING (-staged_qty)
           v
  [AWAITING_RUNNER] (Goods staged at storeroom door)
           |
           +-----------------------------+-----------------------------+
           |                             |                             |
           | Runner accepts full         | Runner accepts partial      | Runner declines all
           | (accepted == staged)        | (accepted < staged)         | (or calls decline_issue)
           v                             v                             v
     [CONFIRMED]                 [PARTIAL_ACCEPTED]            [PARTIAL_DECLINED]
  - Appends:                    - Appends:                    - Appends:
    * ISSUE_PENDING_OFFSET        * ISSUE_PENDING_OFFSET        * ISSUE_REVERSAL
      (+staged_qty)                 (+staged_qty)                 (+staged_qty)
    * ISSUE_CONFIRMED             * ISSUE_CONFIRMED           - Goods returned to shelf
      (-staged_qty)                 (-accepted_qty)           - Request marked declined
  - Stock delta: -staged_qty    - Unaccepted returned         - Stock delta: 0
                                - Stock delta: -accepted_qty
```

### 3.1 Flow C-2 Step-by-Step Execution
1. **FIFO Pick & Stage (`stage_issue`):**
   - Warehouse Keeper retrieves requested items following FIFO order.
   - Evaluates candidate lot: if `expiry_date <= CURRENT_DATE`, hard locks lot with error `Candidate lot is expired and locked`.
   - Records staged quantity in `t_request_items.issued_qty`.
   - Appends `ISSUE_PENDING` with signed negative quantity (`-staged_qty`) to `t_stock_movements`. Available book stock drops immediately to prevent double-allocation.
   - Advances requisition status to `AWAITING_RUNNER`.
2. **Door Inspection & Handoff:**
   - Kitchen Runner meets keeper at storeroom door.
   - Inspects physical goods against staged quantities and packaging integrity.
3. **Receipt Resolution (`confirm_issue` or `decline_issue`):**
   - **Full Confirmation:** Runner accepts all staged items. Appends `ISSUE_PENDING_OFFSET` (`+staged_qty`) to clear reservation, and `ISSUE_CONFIRMED` (`-staged_qty`) to record consumption. Requisition becomes `CONFIRMED`.
   - **Partial Acceptance:** Runner accepts partial quantity (e.g., 3 kg of 5 kg staged). The remaining unaccepted 2 kg is returned to shelf. Appends `ISSUE_PENDING_OFFSET` (`+5 kg`) and `ISSUE_CONFIRMED` (`-3 kg`). Line item records variance explanation. Requisition becomes `PARTIAL_ACCEPTED`.
   - **Full Decline:** Runner rejects items at door (e.g. damaged seal). Items return to shelf. Appends `ISSUE_REVERSAL` (`+staged_qty`). Requisition becomes `PARTIAL_DECLINED`.

---

## 4. Two-Stage Append-Only Ledger Math & Worked Examples

### 4.1 Current Book Stock Derivation Formula (Doc §4.1)
Current inventory balances are calculated dynamically from `t_stock_movements` without mutable counters:

$$\text{Current Book Stock} = \sum \text{signed quantity for all rows matching (store\_id, warehouse\_id, item\_code)}$$

$$\begin{aligned}
\text{Book Stock} = & +\sum \text{GRPO\_IMPORT} \\
& -\sum \text{ISSUE\_PENDING} \\
& +\sum \text{ISSUE\_PENDING\_OFFSET} \\
& -\sum \text{ISSUE\_CONFIRMED} \\
& +\sum \text{ISSUE\_REVERSAL} \\
& -\sum \text{WASTE\_DISPOSAL} \\
& -\sum \text{SUPPLIER\_RETURN} \\
& -\sum \text{TRANSFER\_OUT\_INTRANSIT} \\
& +\sum \text{TRANSFER\_IN\_RECEIVED} \\
& \pm\sum \text{COUNT\_ADJUSTMENT}
\end{aligned}$$

### 4.2 Worked Examples (Initial Shelf Stock = 100 kg)

#### Worked Example 1: Issue 5 kg, Runner Declines 5 kg
1. **Initial Stock:** 100.000 kg received via `GRPO_IMPORT`. Derived stock = `100 kg`.
2. **Admin Stages 5 kg:** App appends `ISSUE_PENDING` with quantity `-5.000`.
   $$\text{Derived Stock} = 100 - 5 = 95.000\text{ kg}$$
3. **Runner Declines at Door:** Goods physically returned to shelf. App appends `ISSUE_REVERSAL` with quantity `+5.000`.
   $$\text{Derived Stock} = 95 + 5 = 100.000\text{ kg}$$
4. **Net Ledger Impact:** Net delta = $0\text{ kg}$. Historical rows untouched.

#### Worked Example 2: Issue 5 kg, Runner Confirms 5 kg
1. **Initial Stock:** 100.000 kg received via `GRPO_IMPORT`. Derived stock = `100 kg`.
2. **Admin Stages 5 kg:** App appends `ISSUE_PENDING` with quantity `-5.000`.
   $$\text{Derived Stock} = 100 - 5 = 95.000\text{ kg}$$
3. **Runner Confirms Full 5 kg:** App appends `ISSUE_PENDING_OFFSET` with `+5.000` (clearing pending status) and `ISSUE_CONFIRMED` with `-5.000`.
   $$\text{Derived Stock} = 95 + 5 - 5 = 95.000\text{ kg}$$
4. **Net Ledger Impact:** Exactly $-5.000\text{ kg}$ deducted from shelf stock. Zero double-counting.

#### Worked Example 3: Issue 5 kg, Runner Confirms 3 kg and Declines 2 kg
1. **Initial Stock:** 100.000 kg received via `GRPO_IMPORT`. Derived stock = `100 kg`.
2. **Admin Stages 5 kg:** App appends `ISSUE_PENDING` with quantity `-5.000`.
   $$\text{Derived Stock} = 100 - 5 = 95.000\text{ kg}$$
3. **Runner Confirms 3 kg, Declines 2 kg:** 2 kg returned physically to shelf; 3 kg delivered to kitchen. App appends `ISSUE_PENDING_OFFSET` with `+5.000` (clearing 5 kg pending) and `ISSUE_CONFIRMED` with `-3.000`.
   $$\text{Derived Stock} = 95 + 5 - 3 = 97.000\text{ kg}$$
4. **Net Ledger Impact:** Exactly $-3.000\text{ kg}$ deducted from storeroom stock (97 kg on shelf, 3 kg delivered). Zero double-counting.

### 4.3 Ledger Timeline Comparison Matrix

| Step / Event | Movement Type | Example 1 (Decline) | Example 2 (Confirm) | Example 3 (Partial 3/5) |
| :--- | :--- | :---: | :---: | :---: |
| Step 0: Inbound Receipt | `GRPO_IMPORT` | `+100 kg` (bal: 100) | `+100 kg` (bal: 100) | `+100 kg` (bal: 100) |
| Step 1: Keeper Pick & Stage | `ISSUE_PENDING` | `−5 kg` (bal: 95) | `−5 kg` (bal: 95) | `−5 kg` (bal: 95) |
| Step 2a: Clear Reservation | `ISSUE_PENDING_OFFSET` | *N/A* | `+5 kg` (bal: 100) | `+5 kg` (bal: 100) |
| Step 2b: Confirmed Receipt | `ISSUE_CONFIRMED` | *N/A* | `−5 kg` (bal: 95) | `−3 kg` (bal: 97) |
| Step 2c: Door Reversal | `ISSUE_REVERSAL` | `+5 kg` (bal: 100) | *N/A* | *N/A* |
| **Final Book Stock** | | **100.000 kg** | **95.000 kg** | **97.000 kg** |
| **Net Transaction Delta** | | **0.000 kg** | **−5.000 kg** | **−3.000 kg** |
| **Final Requisition Status** | | `PARTIAL_DECLINED` | `CONFIRMED` | `PARTIAL_ACCEPTED` |

---

## 5. Stored Procedures (Security Definer RPCs)

All three procedures execute under `SECURITY DEFINER SET search_path = public, auth, pg_temp` to guarantee atomic transactional boundaries, role validation, and multi-tenant store isolation.

### 5.1 `stage_issue`
Stages picked materials from storeroom inventory for an active requisition.

- **Signature:**
  ```sql
  public.stage_issue(
    p_request_id uuid,
    p_staged_items jsonb
  ) RETURNS void
  ```
- **Payload (`p_staged_items`):** Array of objects:
  ```json
  [
    {
      "request_item_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "staged_qty": 5.000,
      "batch_number": "BAT-202611-01",
      "expiry_date": "2026-12-15",
      "warehouse_id": "WH-DEL01-DRY"
    }
  ]
  ```
- **Guards & Validations:**
  1. **Role Check:** Caller must possess `ADMIN`, `CUSTODIAN`, or `SYSTEM_ADMIN`. Section requesters, runners, and viewers are rejected.
  2. **Status Check:** Request must be in `PICKING` or `QUEUED` status. Cannot stage on `AWAITING_RUNNER` or terminal states.
  3. **Store Scope Check:** Requisition store must match `current_store_id()`.
  4. **Quantity Check:** Each item `staged_qty` must be $> 0$.
  5. **Expiry Radar Hard Lock:** If `expiry_date <= CURRENT_DATE` (or looked up batch is expired), throws `Candidate lot is expired and locked`.
  6. **Ledger Append:** Appends `ISSUE_PENDING` with signed negative quantity (`-staged_qty`). Updates line item `issued_qty = staged_qty`.
  7. **State Transition:** Updates `t_requests.status = 'AWAITING_RUNNER'`.

### 5.2 `confirm_issue`
Confirms physical goods receipt at the storeroom door.

- **Signature:**
  ```sql
  public.confirm_issue(
    p_request_id uuid,
    p_accepted_items jsonb,
    p_variance_reasons jsonb DEFAULT NULL
  ) RETURNS void
  ```
- **Payload (`p_accepted_items`):** Array of objects:
  ```json
  [
    {
      "request_item_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "accepted_qty": 3.000
    }
  ]
  ```
- **Variance Reasons (`p_variance_reasons`):** JSON object mapping `request_item_id` to text reason:
  ```json
  {
    "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d": "Partial accept: 2kg torn packaging returned to shelf"
  }
  ```
- **Guards & Validations:**
  1. **Role Check:** Caller must possess `RUNNER` or `SYSTEM_ADMIN`.
  2. **Segregation of Duties:** Verifies that caller was **not** the keeper who staged the issue (`v_staged_by != caller`). Throws `Segregation of duties violation: Staging keeper cannot confirm their own issue.`. Overridable only by `SYSTEM_ADMIN`.
  3. **Status Check:** Request must currently be in `AWAITING_RUNNER` status.
  4. **Store Scope Check:** Requisition store must match runner store scope.
  5. **Quantity Check:** Validates $0 \le accepted\_qty \le staged\_qty$.
  6. **Ledger Appends:**
     - Appends `ISSUE_PENDING_OFFSET` with `+staged_qty` to clear reservation.
     - Appends `ISSUE_CONFIRMED` with `-accepted_qty` (if $accepted\_qty > 0$).
  7. **State Transition:**
     - If all items fully accepted: `status = 'CONFIRMED'`.
     - If partial acceptance: `status = 'PARTIAL_ACCEPTED'`.
     - If total accepted is 0: `status = 'PARTIAL_DECLINED'`.
     - Records `runner_user_id = auth.uid()` and `runner_confirmed_at = now()`.

### 5.3 `decline_issue`
Rejects all goods at storeroom door and returns physical stock to shelf.

- **Signature:**
  ```sql
  public.decline_issue(
    p_request_id uuid,
    p_decline_reason text
  ) RETURNS void
  ```
- **Guards & Validations:**
  1. **Role Check:** Caller must possess `RUNNER` or `SYSTEM_ADMIN`.
  2. **Segregation of Duties:** Staging keeper cannot decline their own issue.
  3. **Reason Check:** `p_decline_reason` must not be null or blank.
  4. **Status Check:** Requisition must be in `AWAITING_RUNNER` status.
  5. **Ledger Appends:** Appends `ISSUE_REVERSAL` with `+staged_qty` for every staged item.
  6. **Line Item Updates:** Sets `variance_reason = p_decline_reason`.
  7. **State Transition:** Updates `t_requests.status = 'PARTIAL_DECLINED'`, `runner_user_id = auth.uid()`, and `runner_confirmed_at = now()`.

---

## 6. Row-Level Security (RLS) Policy Matrix

| Table | Operation | Target Role | Policy Definition / Access Expression |
| :--- | :--- | :--- | :--- |
| `t_requests` | `SELECT` | `authenticated` | `current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN') OR has_role('VIEWER')` |
| `t_requests` | `UPDATE` | Keeper, Runner, Requester, Admin | Store scope match AND (`(requester_user_id = auth.uid() AND status = 'QUEUED')` OR `has_role('ADMIN')` OR `has_role('CUSTODIAN')` OR `has_role('RUNNER')` OR `has_role('SYSTEM_ADMIN')`) |
| `t_request_items` | `SELECT` | `authenticated` | Parent requisition in caller's store scope |
| `t_request_items` | `UPDATE` | Keeper, Runner, Admin | Parent requisition in store scope AND (`has_role('ADMIN')` OR `has_role('CUSTODIAN')` OR `(has_role('RUNNER') AND r.status = 'AWAITING_RUNNER')` OR `has_role('SYSTEM_ADMIN')`) |
| `t_stock_movements` | `SELECT` | `authenticated` | Store scope match or global admin/viewer |
| `t_stock_movements` | `INSERT` | `authenticated` | Append-only (inserts controlled via RPC / RLS) |
| `t_stock_movements` | `UPDATE` | *NONE* | **PROHIBITED** by trigger `tg_prevent_ledger_mutation()` |
| `t_stock_movements` | `DELETE` | *NONE* | **PROHIBITED** by trigger `tg_prevent_ledger_mutation()` |

---

## 7. Verification & Audit Trail
The implementation is verified by the automated pgTAP test suite in `supabase/tests/0060_issue.sql` covering 53 tests:
1. **RPC Signatures:** Confirms existence and argument shapes for `stage_issue`, `confirm_issue`, and `decline_issue`.
2. **Worked Example 1 (Decline):** Verifies initial 100 kg -> staged 5 kg (bal: 95) -> declined (bal: 100) -> net delta = 0.
3. **Worked Example 2 (Confirm):** Verifies initial 100 kg -> staged 5 kg (bal: 95) -> confirmed (bal: 95) -> net delta = -5 kg.
4. **Worked Example 3 (Partial):** Verifies initial 100 kg -> staged 5 kg (bal: 95) -> confirm 3 kg (bal: 97) -> net delta = -3 kg.
5. **Expired Lot Rule:** Proves rejection when `expiry_date <= CURRENT_DATE` with message `Candidate lot is expired and locked`.
6. **Segregation of Duties:** Proves rejection when staging keeper attempts self-confirmation or self-decline, and verifies `SYSTEM_ADMIN` override.
7. **Access Control & Scoping:** Proves cross-store rejection and unauthorized role rejection.
8. **Immutability:** Proves direct `UPDATE` and `DELETE` on `t_stock_movements` are rejected with `Stock movements are append-only and cannot be updated or deleted.`.
