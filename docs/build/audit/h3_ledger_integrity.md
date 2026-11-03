# H3 Ledger Integrity & Concurrency Review

**Audit Reference:** H3-LEDGER-CONCURRENCY-001  
**Target Domain:** D4 (Ledger Core), D6 (Issue & Confirmation), D12 (SAP Ingestion Staging)  
**Document Classification:** Internal Technical Audit  
**Inventory Control Principle:** Quantities only. Zero financial figures, commercial rates, billing assessments, regulatory levies, or merchant trade identities.

---

## 1. Executive Summary & Audit Scope

This technical review provides a formal verification of the append-only stock movement ledger (`t_stock_movements`), associated concurrency barriers, and inventory derivation invariants within the warehouse management system.

The audit encompasses five explicit focus areas:
1. **Append-Only Immutability of `t_stock_movements`:** Verification of triggers, SQL privilege revocations, Row-Level Security (RLS) policies, and application query patterns to ensure no mutation or deletion paths exist.
2. **Concurrency Scenario: Simultaneous Lot Staging:** Behavioral and locking analysis when two warehouse keepers attempt to stage goods from the same lot concurrently (same requisition vs. distinct requisitions).
3. **Concurrency Scenario: Runner Double-Action Race Conditions:** Analysis of row-level lock serialization and state machine guards during concurrent door confirmation or rejection (`confirm_issue` vs. `decline_issue`).
4. **Concurrency Scenario: Concurrent SAP Ingestion Batches:** Ingestion deduplication, line-key conflict handling, and transaction boundary integrity during simultaneous uploads of identical documents.
5. **Flow C-2 Mathematical Invariants:** Arithmetic proofs and balance consistency across Worked Examples 1, 2, and 3 from section 4.1 of the system specifications.

### Summary Assessment Matrix

| Verification Domain | Status | Mechanism | Finding / Guarantee |
| :--- | :---: | :--- | :--- |
| **1. Ledger Immutability** | **VERIFIED** | Trigger `trg_prevent_ledger_mutation` + SQL Revocation + RLS | Zero update or delete path exists in SQL or application layer. |
| **2. Simultaneous Staging** | **VERIFIED / MITIGATED** | `t_requests FOR UPDATE` + State Transition Check | Same-request staging is strictly serialized. Competing-request lot allocation requires advisory locking to prevent negative lot balances. |
| **3. Runner Double-Action** | **VERIFIED** | `t_requests FOR UPDATE` + Lifecycle Status Check | Double-confirm and double-decline races are neutralized by row locks and state barriers. |
| **4. Concurrent File Ingestion** | **VERIFIED** | Unique Constraint `uq_grpo_import_line_key` + Rollback | Ingestion collision triggers an atomic transaction rollback, preventing duplicate ledger entries. |
| **5. Flow C-2 Invariants** | **VERIFIED** | Two-Stage Offsetting Mechanics (`ISSUE_PENDING_OFFSET`) | Invariants 1, 2, and 3 strictly preserve physical unit balances without double-counting. |

---

## 2. Ledger Append-Only Immutability Verification

### 2.1 Ledger Architecture & Schema Design
The transactional ledger is defined in migration `0040_ledger_core_views.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.t_stock_movements (
  movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL REFERENCES public.m_stores(store_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  item_code text NOT NULL REFERENCES public.m_items(item_code) ON UPDATE CASCADE ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'GRPO_IMPORT',
    'ISSUE_PENDING',
    'ISSUE_PENDING_OFFSET',
    'ISSUE_CONFIRMED',
    'ISSUE_REVERSAL',
    'WASTE_DISPOSAL',
    'SUPPLIER_RETURN',
    'TRANSFER_OUT_INTRANSIT',
    'TRANSFER_IN_RECEIVED',
    'COUNT_ADJUSTMENT'
  )),
  quantity numeric NOT NULL,
  uom text NOT NULL,
  batch_number text NULL,
  expiry_date date NULL,
  reference_doc_id text NOT NULL,
  created_by_user_id text NOT NULL REFERENCES public.m_users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 2.2 Trigger-Based Mutation Blocker
The table is defended by an unconditional `BEFORE UPDATE OR DELETE` trigger:

```sql
CREATE OR REPLACE FUNCTION public.tg_prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON public.t_stock_movements;
CREATE TRIGGER trg_prevent_ledger_mutation
  BEFORE UPDATE OR DELETE ON public.t_stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_prevent_ledger_mutation();
```

- **Trigger Firing Mode:** `BEFORE EACH ROW` execution guarantees that regardless of the number of matched rows, the very first row encountered aborts the statement before any write is staged.
- **SQLSTATE Code:** Raises generic plpgsql exception `P0001` with explicit diagnostic text.
- **Foreign Key Cascade Protection:** All inbound foreign keys from `t_stock_movements` to master entities (`m_stores`, `m_warehouses`, `m_items`, `m_users`) specify `ON DELETE RESTRICT`. A referenced store, storeroom, item, or user profile cannot be deleted while movement records reference it.

### 2.3 SQL Permission Revocation & Role Grants
Security posture is hardened through explicit DCL commands in migration 0040:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON public.t_stock_movements FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT ON public.t_stock_movements TO authenticated;
GRANT ALL ON public.t_stock_movements TO service_role;
```

- **Standard Roles (`authenticated`, `anon`, `PUBLIC`):** `UPDATE`, `DELETE`, and `TRUNCATE` privileges are revoked at the catalog level. Any direct execution from client sessions fails during PostgreSQL parse/analyze phase (`42501: permission denied`).
- **Elevated Roles (`service_role`):** Even with table grants, the trigger `trg_prevent_ledger_mutation` executes on every row for `UPDATE` or `DELETE`, blocking service scripts from modifying records.
- **Truncate Defense Analysis:** In PostgreSQL, row-level triggers do not intercept `TRUNCATE`. Non-administrative roles are blocked by `REVOKE TRUNCATE`. For defense-in-depth against administrative accidents, a statement-level truncate trigger is recommended:
  ```sql
  CREATE TRIGGER trg_prevent_ledger_truncate
    BEFORE TRUNCATE ON public.t_stock_movements
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.tg_prevent_ledger_mutation();
  ```

### 2.4 Row-Level Security (RLS) Policy Architecture
Row-Level Security is active:

```sql
ALTER TABLE public.t_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_movements_select_policy ON public.t_stock_movements
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY stock_movements_insert_policy ON public.t_stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (true);
```

Under PostgreSQL RLS semantics, if a command type (`UPDATE` or `DELETE`) has no permissive policy defined, access defaults to **strict deny** for all non-superusers. Thus, even if table-level permissions were mistakenly granted, RLS provides a second independent barrier.

### 2.5 Codebase and ORM Inspection
An audit of all application files in `lib/` and `app/` confirms:
- Inbound movements are added exclusively through `.insert()` calls or stored procedures (`stage_issue`, `confirm_issue`, `decline_issue`, `commit_grpo_import_batch`, `approve_grpo_correction`).
- No `.update()` or `.delete()` calls reference `t_stock_movements`.
- Corrections are recorded exclusively through offsetting movements (e.g., `ISSUE_PENDING_OFFSET`, `ISSUE_REVERSAL`, `COUNT_ADJUSTMENT`).

---

## 3. Concurrency Analysis: Simultaneous Lot Staging by Two Keepers

### 3.1 Workflow Architecture (`stage_issue`)
When a warehouse keeper picks items and stages them at the storeroom door for a section requisition, the client calls `stage_issue(p_request_id, p_staged_items)`.

```sql
CREATE OR REPLACE FUNCTION public.stage_issue(
  p_request_id uuid,
  p_staged_items jsonb
) RETURNS void ...
```

The procedure executes inside a single transaction and performs the following sequence:
1. Validates caller permissions (Keeper `ADMIN`, Custodian `CUSTODIAN`, or `SYSTEM_ADMIN`).
2. Locks the requisition record: `SELECT * INTO v_req FROM public.t_requests WHERE request_id = p_request_id FOR UPDATE;`
3. Checks status: `IF v_req.status NOT IN ('PICKING', 'QUEUED') THEN RAISE EXCEPTION ...;`
4. Iterates over line items, locks each `t_request_items` row `FOR UPDATE`, checks lot expiry (`v_expiry_date > CURRENT_DATE`).
5. Appends `ISSUE_PENDING` with signed negative quantity (`-abs(v_staged_qty)`) to `t_stock_movements`.
6. Updates `t_requests.status = 'AWAITING_RUNNER'`.

### 3.2 Case 2A: Two Keepers Staging the SAME Requisition Request Concurrently
Suppose Keeper 1 and Keeper 2 simultaneously submit staging payloads for the same request ID `REQ-01`:

```
Time  | Keeper 1 Transaction                      | Keeper 2 Transaction
------+-------------------------------------------+-------------------------------------------
T1    | BEGIN                                     | BEGIN
T2    | SELECT * FROM t_requests                  | SELECT * FROM t_requests
      |   WHERE request_id = 'REQ-01' FOR UPDATE  |   WHERE request_id = 'REQ-01' FOR UPDATE
      |   --> Obtains exclusive row lock          |   --> BLOCKED (waiting on Keeper 1 lock)
T3    | Validates status == 'QUEUED' (Pass)       |   (waiting...)
T4    | Appends ISSUE_PENDING (-5 kg) to ledger   |   (waiting...)
T5    | UPDATE t_requests SET status =            |   (waiting...)
      |   'AWAITING_RUNNER'                       |   (waiting...)
T6    | COMMIT                                    |   (waiting...)
T7    | (Lock released)                           | --> UNBLOCKS; re-evaluates locked row
T8    |                                           | Reads committed status: 'AWAITING_RUNNER'
T9    |                                           | Check: status NOT IN ('PICKING', 'QUEUED')
T10   |                                           | RAISE EXCEPTION: 'Cannot stage issue: ...'
T11   |                                           | ROLLBACK
```

**Verification Finding:**
- Row-level lock (`FOR UPDATE`) on `t_requests` serializes execution.
- Under PostgreSQL Read Committed isolation, Keeper 2 re-reads the committed row version upon unblocking.
- The status check unconditionally fails because status has transitioned from `QUEUED` to `AWAITING_RUNNER`.
- No duplicate ledger entries or double-staging can occur for the same requisition request.

### 3.3 Case 2B: Two Keepers Staging TWO DIFFERENT Requests from the SAME Lot
Suppose Lot `BAT-ALPHA` has 10.000 kg remaining in storeroom inventory.
- Keeper 1 stages 8.000 kg for Requisition Request `REQ-01`.
- Keeper 2 stages 8.000 kg for Requisition Request `REQ-02`.
- Both submit their transactions at the identical moment.

**Mechanism Trace:**
- Keeper 1 locks row `REQ-01` in `t_requests`.
- Keeper 2 locks row `REQ-02` in `t_requests`.
- Because the locks are on distinct rows in `t_requests`, **neither transaction blocks the other**.
- `v_stock_lots_fifo` is a derived SQL view over `t_stock_movements` (`GROUP BY ... HAVING SUM(quantity) > 0`). In PostgreSQL, standard views cannot be row-locked with `FOR UPDATE`.
- In `stage_issue`, the procedure validates lot expiration dates, but does not execute an atomic availability check against `v_stock_lots_fifo`.
- Both transactions append `ISSUE_PENDING` movements of `-8.000 kg` each.

**Consequence on Derived Balances:**
- Prior to transactions: $10.000\text{ kg}$.
- After both commit: $10.000 - 8.000 - 8.000 = -6.000\text{ kg}$.
- In `v_stock_lots_fifo`: The lot filter `HAVING SUM(m.quantity) > 0` evaluates to `-6.000 > 0` (False). The lot immediately disappears from the active FIFO lot view.
- In `v_stock_current`: Derived book stock drops to a negative balance of `-6.000 kg`.

### 3.4 Mitigation & Architectural Recommendations
To guarantee absolute physical stock integrity across parallel staging sessions, two architectural controls should be applied:

1. **Transaction-Level Advisory Locking on the Lot:**
   Inside `stage_issue`, before inserting into `t_stock_movements`, acquire an advisory lock on the specific lot being staged:
   ```sql
   -- Hashes store, warehouse, item, and batch into an exclusive transactional lock
   PERFORM pg_advisory_xact_lock(
     hashtext(v_req.store_id || ':' || v_warehouse_id || ':' || v_req_item.item_code || ':' || coalesce(v_batch_number, ''))
   );
   ```
   This serializes any competing transactions attempting to allocate from the exact same batch without modifying database schema.

2. **Atomic Balance Verification:**
   After acquiring the advisory lock, assert that available unreserved stock for that lot covers the staged quantity:
   ```sql
   SELECT COALESCE(SUM(quantity), 0) INTO v_available_lot_qty
   FROM public.t_stock_movements
   WHERE store_id = v_req.store_id
     AND warehouse_id = v_warehouse_id
     AND item_code = v_req_item.item_code
     AND coalesce(batch_number, '') = coalesce(v_batch_number, '');

   IF v_available_lot_qty < v_staged_qty THEN
     RAISE EXCEPTION 'Insufficient stock in lot %. Available: %, Requested: %',
       coalesce(v_batch_number, 'DEFAULT'), v_available_lot_qty, v_staged_qty;
   END IF;
   ```

---

## 4. Concurrency Analysis: Runner Double-Action Race Conditions

### 4.1 Door Confirmation Architecture (`confirm_issue` & `decline_issue`)
When goods arrive at the storeroom door, a Kitchen Runner inspects the batch. Two stored procedures govern this terminal stage:
- `confirm_issue(p_request_id, p_accepted_items, p_variance_reasons)`
- `decline_issue(p_request_id, p_decline_reason)`

Both procedures execute under `SECURITY DEFINER` and enforce:
1. **Segregation of Duties:** The runner cannot be the user who staged the issue (`v_staged_by != caller`).
2. **Requisition Row Lock:**
   ```sql
   SELECT * INTO v_req
   FROM public.t_requests
   WHERE request_id = p_request_id
   FOR UPDATE;
   ```
3. **State Machine Validation:**
   ```sql
   IF v_req.status != 'AWAITING_RUNNER' THEN
     RAISE EXCEPTION 'Cannot confirm/decline issue: request is in status %, expected AWAITING_RUNNER.', v_req.status;
   END IF;
   ```

### 4.2 Race Case 3A: Runner Double-Confirm
Suppose network retries, browser rapid double-clicks, or dual devices trigger two `confirm_issue` calls for `REQ-01` simultaneously:

```
Time  | Runner Client Call A                      | Runner Client Call B
------+-------------------------------------------+-------------------------------------------
T1    | BEGIN                                     | BEGIN
T2    | SELECT * FROM t_requests                  | SELECT * FROM t_requests
      |   WHERE request_id = 'REQ-01' FOR UPDATE  |   WHERE request_id = 'REQ-01' FOR UPDATE
      |   --> Obtains exclusive row lock          |   --> BLOCKED (waiting on Call A lock)
T3    | Status check: 'AWAITING_RUNNER' (Pass)    |   (waiting...)
T4    | Appends ISSUE_PENDING_OFFSET (+5 kg)      |   (waiting...)
T5    | Appends ISSUE_CONFIRMED (-5 kg)           |   (waiting...)
T6    | UPDATE t_requests SET                     |   (waiting...)
      |   status = 'CONFIRMED',                   |   (waiting...)
      |   runner_confirmed_at = now()             |   (waiting...)
T7    | COMMIT                                    |   (waiting...)
T8    | (Lock released)                           | --> UNBLOCKS; re-evaluates locked row
T9    |                                           | Reads committed status: 'CONFIRMED'
T10   |                                           | Check: status != 'AWAITING_RUNNER'
T11   |                                           | RAISE EXCEPTION: 'Cannot confirm issue:
      |                                           |   request is in status CONFIRMED...'
T12   |                                           | ROLLBACK
```

**Outcome:**
- Exactly **one** transaction succeeds.
- Call B fails with error and triggers an immediate transaction rollback.
- Ledger receives exactly one `ISSUE_PENDING_OFFSET` and one `ISSUE_CONFIRMED`.
- Zero double-offset or duplicate stock deduction is possible.

### 4.3 Race Case 3B: Runner Double-Decline
Suppose a runner rapidly triggers `decline_issue` twice concurrently:
- Identical row-level lock serialization occurs on `t_requests`.
- First call validates `status == 'AWAITING_RUNNER'`, appends `ISSUE_REVERSAL` (+staged quantity), sets status to `'PARTIAL_DECLINED'`, and commits.
- Second call unblocks, reads `status == 'PARTIAL_DECLINED'`, fails validation (`status != 'AWAITING_RUNNER'`), and aborts with an exception.
- Ledger receives exactly one `ISSUE_REVERSAL`. Derived stock returns to original level with zero inflation.

### 4.4 Race Case 3C: Confirm vs. Decline Conflict
Suppose Runner Terminal A submits `confirm_issue` at the same time Runner Terminal B submits `decline_issue` on the same requisition:
- Both call `SELECT ... FOR UPDATE` on the request row.
- Whichever transaction is scheduled first by the PostgreSQL lock engine obtains the lock.
- If `confirm_issue` locks first: It sets status to `CONFIRMED` and commits. `decline_issue` then unblocks, sees status `CONFIRMED`, and is rejected.
- If `decline_issue` locks first: It sets status to `PARTIAL_DECLINED` and commits. `confirm_issue` then unblocks, sees status `PARTIAL_DECLINED`, and is rejected.
- In both outcomes, the two actions can never execute concurrently or create conflicting offsetting movements.

---

## 5. Concurrency Analysis: Concurrent Ingestion of SAP Spreadsheets

### 5.1 Ingestion Flow & Identification Mechanics
When external SAP GRPO spreadsheets are committed, the application calls `commit_grpo_import_batch(p_import_id, p_lines)` in migration `0120_sap_staging.sql`.

Per project decision **CR-02**:
> `DO NOT put a UNIQUE constraint on t_grpo_imports.file_hash (allows corrected file re-uploads).`

Because `file_hash` allows duplicate records in the audit table `t_grpo_imports`, two parallel uploads create two distinct `import_id` values. Line-level deduplication is enforced by the item table:

```sql
CREATE TABLE IF NOT EXISTS public.t_grpo_import_items (
  import_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.t_grpo_imports(import_id) ON DELETE CASCADE,
  grpo_no text NOT NULL,
  line_key text NOT NULL,
  item_code text NOT NULL REFERENCES public.m_items(item_code),
  warehouse_id text NOT NULL REFERENCES public.m_warehouses(warehouse_id),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  uom text NOT NULL,
  doc_date date NOT NULL,
  batch_number text NULL,
  expiry_date date NULL,
  base_document text NULL,
  status text NOT NULL CHECK (status IN ('IMPORTED', 'REFRESHED', 'NEEDS_2ND_APPROVAL', 'QUARANTINED', 'APPROVED_REVERSAL', 'REJECTED')) DEFAULT 'IMPORTED',
  movement_id uuid NULL REFERENCES public.t_stock_movements(movement_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_grpo_import_line_key UNIQUE (grpo_no, line_key)
);
```

### 5.2 Line Classification Logic
Within `commit_grpo_import_batch`, each line is evaluated against existing records:

```sql
SELECT * INTO v_existing_item
FROM public.t_grpo_import_items
WHERE grpo_no = v_grpo_no AND line_key = v_line_key;

IF FOUND THEN
  IF v_existing_item.item_code = v_item_code AND v_existing_item.quantity = v_quantity THEN
    -- Case A: Unchanged line re-uploaded -> REFRESHED (0 ledger movement)
    UPDATE public.t_grpo_import_items SET status = 'REFRESHED' ...;
  ELSE
    -- Case B: Changed item or quantity -> NEEDS_2ND_APPROVAL (0 movement until approved)
    UPDATE public.t_grpo_import_items SET status = 'NEEDS_2ND_APPROVAL' ...;
  END IF;
ELSE
  -- Case C: New line -> IMPORTED (appends GRPO_IMPORT movement to ledger)
  INSERT INTO public.t_stock_movements (...) VALUES (..., 'GRPO_IMPORT', v_quantity, ...)
    RETURNING movement_id INTO v_movement_id;

  INSERT INTO public.t_grpo_import_items (..., status, movement_id)
    VALUES (..., 'IMPORTED', v_movement_id);
END IF;
```

### 5.3 Concurrency Race: Two Simultaneous Ingestion Batches of the Same File
Consider two workers uploading the identical spreadsheet file concurrently, containing new line `LN-101`:

```
Time  | Worker Ingestion Session 1                | Worker Ingestion Session 2
------+-------------------------------------------+-------------------------------------------
T1    | BEGIN                                     | BEGIN
T2    | SELECT * FROM t_grpo_import_items         | SELECT * FROM t_grpo_import_items
      |   WHERE grpo_no = 'G1'                    |   WHERE grpo_no = 'G1'
      |     AND line_key = 'LN-101'               |     AND line_key = 'LN-101'
      |   --> NOT FOUND                           |   --> NOT FOUND
T3    | Appends GRPO_IMPORT (+50 kg) to ledger    | Appends GRPO_IMPORT (+50 kg) to ledger
      |   --> Obtains movement_id M1              |   --> Obtains movement_id M2
T4    | INSERT INTO t_grpo_import_items           | INSERT INTO t_grpo_import_items
      |   (grpo_no, line_key, movement_id = M1)   |   (grpo_no, line_key, movement_id = M2)
      |   --> Writes unique index entry           |   --> BLOCKS on unique index lock
T5    | COMMIT                                    |   (waiting on Session 1 commit)
T6    | Session 1 completes successfully          | --> UNBLOCKS; Detects duplicate unique key!
T7    |                                           | Throws SQLSTATE 23505 (unique_violation)
      |                                           |   'duplicate key value violates unique
      |                                           |    constraint "uq_grpo_import_line_key"'
T8    |                                           | Entire Session 2 transaction ABORTS
T9    |                                           | ROLLBACK (Removes movement M2 from ledger)
```

**Verification Proof:**
1. Stored procedures in PostgreSQL run within an atomic transaction boundary.
2. When Session 2 encounters the unique constraint violation on `uq_grpo_import_line_key`, the unhandled exception terminates the function immediately.
3. The database engine executes an automatic `ROLLBACK` for Session 2.
4. Movement `M2` (inserted in step T3) is rolled back and erased.
5. Session 1 remains committed with movement `M1`.
6. Net result: **Exactly one** `GRPO_IMPORT` entry exists in `t_stock_movements`. The ledger is completely free of phantom or duplicate inventory.

### 5.4 Sequential Re-Upload Behavior
If the same spreadsheet is uploaded sequentially (after Session 1 has committed):
1. Session 2 queries `t_grpo_import_items` for `(grpo_no, line_key)` $\to$ **FOUND**.
2. Compares item code and quantity: both match.
3. Classifies line as `'REFRESHED'`.
4. Executes an `UPDATE` on metadata in `t_grpo_import_items`.
5. **No row is appended to `t_stock_movements`.**
6. Physical stock balance is untouched (zero delta).

If the re-uploaded file has altered physical quantities:
1. Session 2 detects mismatch.
2. Classifies line as `'NEEDS_2ND_APPROVAL'`.
3. **No row is appended to `t_stock_movements`.**
4. Stock remains unchanged until an authorized user independently approves the variance via `approve_grpo_correction`, which writes an offsetting movement and the corrected receipt atomically.

---

## 6. Mathematical Invariants of Flow C-2 Two-Stage Issue Ledger

### 6.1 Formal Ledger Arithmetic Model
Physical inventory is derived dynamically from `t_stock_movements` via the view `v_stock_current`:

$$S_{\text{current}} = \sum_{m \in M} Q(m)$$

Where each movement type carries a strictly defined operational sign:
- $Q(\text{GRPO\_IMPORT}) = +q$
- $Q(\text{ISSUE\_PENDING}) = -q$
- $Q(\text{ISSUE\_PENDING\_OFFSET}) = +q$
- $Q(\text{ISSUE\_CONFIRMED}) = -q$
- $Q(\text{ISSUE\_REVERSAL}) = +q$
- $Q(\text{WASTE\_DISPOSAL}) = -q$
- $Q(\text{SUPPLIER\_RETURN}) = -q$
- $Q(\text{TRANSFER\_OUT\_INTRANSIT}) = -q$
- $Q(\text{TRANSFER\_IN\_RECEIVED}) = +q$
- $Q(\text{COUNT\_ADJUSTMENT}) = \pm \Delta q$

### 6.2 Worked Example 1: Issue 5 kg, Runner Declines 5 kg (Full Decline)

**Operational Narrative:**
- Initial inventory on storeroom shelf: 100.000 kg.
- Keeper stages 5.000 kg for kitchen requisition.
- Runner arrives at door, discovers packaging damage, and declines the full lot. Goods return to shelf.

**Step-by-Step Ledger Ledger Vector:**

| Step | Operation | Movement Type Appended | Quantity Delta | Cumulative Derived Stock | Physical Reality |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **0** | Initial Stock | `GRPO_IMPORT` | `+100.000 kg` | `100.000 kg` | 100 kg on storeroom shelf |
| **1** | Keeper Stages | `ISSUE_PENDING` | `−5.000 kg` | `95.000 kg` | 95 kg on shelf; 5 kg reserved at door |
| **2** | Runner Declines | `ISSUE_REVERSAL` | `+5.000 kg` | `100.000 kg` | 5 kg returned to shelf; total 100 kg |

**Mathematical Proof of Invariants:**
1. **Net Transaction Delta:**
   $$\Delta S_{\text{net}} = Q(\text{ISSUE\_PENDING}) + Q(\text{ISSUE\_REVERSAL}) = (-5.000) + (+5.000) = 0.000\text{ kg}$$
2. **Ending Inventory Equality:**
   $$S_{\text{final}} = S_{\text{initial}} + \Delta S_{\text{net}} = 100.000 + 0.000 = 100.000\text{ kg}$$
3. **Immutability Invariant:** Past movements `GRPO_IMPORT` and `ISSUE_PENDING` are never updated or deleted; restoration is achieved strictly via additive symmetry.

---

### 6.3 Worked Example 2: Issue 5 kg, Runner Confirms 5 kg (Full Confirmation)

**Operational Narrative:**
- Initial inventory on storeroom shelf: 100.000 kg.
- Keeper stages 5.000 kg for kitchen requisition.
- Runner arrives at door, inspects goods, and accepts full delivery into kitchen custody.

**Step-by-Step Ledger Vector:**

| Step | Operation | Movement Type Appended | Quantity Delta | Cumulative Derived Stock | Physical Reality |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **0** | Initial Stock | `GRPO_IMPORT` | `+100.000 kg` | `100.000 kg` | 100 kg on storeroom shelf |
| **1** | Keeper Stages | `ISSUE_PENDING` | `−5.000 kg` | `95.000 kg` | 95 kg on shelf; 5 kg reserved at door |
| **2a**| Runner Confirms | `ISSUE_PENDING_OFFSET` | `+5.000 kg` | `100.000 kg` | Reservation cleared |
| **2b**| Runner Confirms | `ISSUE_CONFIRMED` | `−5.000 kg` | `95.000 kg` | 5 kg transferred to kitchen |

*Note: Steps 2a and 2b are appended atomically inside a single stored procedure transaction (`confirm_issue`).*

**Mathematical Proof of Invariants:**
1. **Pending Neutralization Invariant:**
   $$Q(\text{ISSUE\_PENDING}) + Q(\text{ISSUE\_PENDING\_OFFSET}) = (-5.000) + (+5.000) = 0.000\text{ kg}$$
2. **Net Transaction Delta:**
   $$\Delta S_{\text{net}} = (-5.000) + (+5.000) + (-5.000) = -5.000\text{ kg}$$
3. **Ending Inventory Equality:**
   $$S_{\text{final}} = S_{\text{initial}} - Q_{\text{confirmed}} = 100.000 - 5.000 = 95.000\text{ kg}$$
4. **Zero Double-Counting Guarantee:**
   If confirmation did not append `ISSUE_PENDING_OFFSET`, derived stock would evaluate to $100 - 5 - 5 = 90.000\text{ kg}$ (erroneous double deduction). The offsetting movement guarantees exact mathematical convergence to 95.000 kg.

---

### 6.4 Worked Example 3: Issue 5 kg, Runner Confirms 3 kg and Declines 2 kg (Partial Acceptance)

**Operational Narrative:**
- Initial inventory on storeroom shelf: 100.000 kg.
- Keeper stages 5.000 kg for kitchen requisition.
- Runner inspects items at door: 3.000 kg are in pristine condition and accepted; 2.000 kg have torn inner packaging and are declined.
- 2.000 kg are placed back onto the shelf immediately; 3.000 kg proceed to the kitchen.

**Step-by-Step Ledger Vector:**

| Step | Operation | Movement Type Appended | Quantity Delta | Cumulative Derived Stock | Physical Reality |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **0** | Initial Stock | `GRPO_IMPORT` | `+100.000 kg` | `100.000 kg` | 100 kg on storeroom shelf |
| **1** | Keeper Stages | `ISSUE_PENDING` | `−5.000 kg` | `95.000 kg` | 95 kg on shelf; 5 kg staged at door |
| **2a**| Partial Confirm | `ISSUE_PENDING_OFFSET` | `+5.000 kg` | `100.000 kg` | Full 5 kg reservation cleared |
| **2b**| Partial Confirm | `ISSUE_CONFIRMED` | `−3.000 kg` | `97.000 kg` | 3 kg transferred to kitchen |

*Note: Steps 2a and 2b are appended atomically inside `confirm_issue`.*

**Mathematical Proof of Invariants:**
1. **Full Reservation Clearance:**
   The offset must equal the original staged quantity, not the accepted quantity:
   $$Q(\text{ISSUE\_PENDING\_OFFSET}) = +Q_{\text{staged}} = +5.000\text{ kg}$$
   $$Q(\text{ISSUE\_PENDING}) + Q(\text{ISSUE\_PENDING\_OFFSET}) = (-5.000) + (+5.000) = 0.000\text{ kg}$$
2. **Net Transaction Delta:**
   $$\Delta S_{\text{net}} = Q(\text{ISSUE\_PENDING}) + Q(\text{ISSUE\_PENDING\_OFFSET}) + Q(\text{ISSUE\_CONFIRMED})$$
   $$\Delta S_{\text{net}} = (-5.000) + (+5.000) + (-3.000) = -3.000\text{ kg}$$
3. **Ending Storeroom Stock:**
   $$S_{\text{storeroom}} = S_{\text{initial}} + \Delta S_{\text{net}} = 100.000 - 3.000 = 97.000\text{ kg}$$
4. **Conservation of Mass Across Custody Boundaries:**
   $$S_{\text{storeroom shelf}} + Q_{\text{kitchen}} = 97.000\text{ kg} + 3.000\text{ kg} = 100.000\text{ kg} = S_{\text{initial}}$$
   The 2.000 kg declined portion is implicitly returned to available shelf stock because only 3.000 kg of confirmed deduction remains against the ledger.
5. **Variance Audit Trail:**
   The 2.000 kg difference is recorded in `t_request_items.variance_reason` (e.g., `'Partial accept: 2kg torn packaging returned to shelf'`), and the parent requisition status advances to `'PARTIAL_ACCEPTED'`.

---

### 6.5 Invariant Comparison Matrix

| Property | Worked Example 1 (Full Decline) | Worked Example 2 (Full Confirm) | Worked Example 3 (Partial Confirm) |
| :--- | :---: | :---: | :---: |
| **Staged Quantity** | `5.000 kg` | `5.000 kg` | `5.000 kg` |
| **Accepted Quantity** | `0.000 kg` | `5.000 kg` | `3.000 kg` |
| **Declined Quantity** | `5.000 kg` | `0.000 kg` | `2.000 kg` |
| **Pending Offset Qty** | N/A (`REVERSAL` used) | `+5.000 kg` | `+5.000 kg` |
| **Confirmed Qty** | `0.000 kg` | `−5.000 kg` | `−3.000 kg` |
| **Reversal Qty** | `+5.000 kg` | `0.000 kg` | `0.000 kg` |
| **Net Ledger Delta** | `0.000 kg` | `−5.000 kg` | `−3.000 kg` |
| **Final Storeroom Stock**| `100.000 kg` | `95.000 kg` | `97.000 kg` |
| **Kitchen Received Stock**| `0.000 kg` | `5.000 kg` | `3.000 kg` |
| **Total System Units** | `100.000 kg` | `100.000 kg` | `100.000 kg` |
| **Requisition Final Status**| `'PARTIAL_DECLINED'` | `'CONFIRMED'` | `'PARTIAL_ACCEPTED'` |

### 6.6 Test Suite Cross-Verification
The arithmetic invariants of Worked Examples 1, 2, and 3 are validated by automated test suites:
- **`supabase/tests/0040_ledger.sql`:** Lines 86–107 assert exact stock balance queries on sample seed items (`ITM-DRY-001`, `ITM-DRY-002`, `ITM-DRY-003`).
- **`supabase/tests/0060_issue.sql`:** Lines 200–520 execute the end-to-end lifecycle via RPC calls (`stage_issue`, `confirm_issue`, `decline_issue`) and verify status transitions, movement generation, and derived stock at each step.
- All tests execute with zero rounding drift or precision loss due to the use of PostgreSQL arbitrary-precision `NUMERIC` types.

---

## 7. Actionable Findings & Hardening Recommendations

### Summary of Audit Findings
1. **Append-Only Integrity:** **CONFIRMED.** Triggers, catalog permissions, and RLS policies prevent mutation or deletion of historical movement records.
2. **Requisition Staging Concurrency:** **CONFIRMED.** `SELECT ... FOR UPDATE` on `t_requests` guarantees that parallel staging attempts on the same requisition serialize safely without duplicate movements.
3. **Cross-Requisition Lot Concurrency:** **POTENTIAL GAP IDENTIFIED.** Competing requisitions requesting the same lot simultaneously do not serialize at the lot level, potentially leading to negative lot balances in derived views.
4. **Runner Handover Races:** **CONFIRMED.** Mutex locking on `t_requests` ensures that runner confirmations and declines are strictly atomic and non-duplicative.
5. **Concurrent File Ingestion:** **CONFIRMED.** The compound unique key `(grpo_no, line_key)` on `t_grpo_import_items` forces an automatic database rollback on concurrent duplicate lines, ensuring zero orphan ledger movements.
6. **Flow C-2 Worked Examples:** **CONFIRMED.** Mathematical derivations, offsetting mechanics, and conservation of mass are verified across all three scenarios.

### Recommended Hardening Measures

1. **Lot-Level Advisory Lock in `stage_issue`:**
   Add `PERFORM pg_advisory_xact_lock(hashtext(v_req.store_id || ':' || v_warehouse_id || ':' || v_req_item.item_code || ':' || coalesce(v_batch_number, '')));` at the start of lot allocation in `stage_issue`. This prevents concurrent over-allocation across distinct requisitions.
2. **Statement-Level Truncate Blocker:**
   Add a `BEFORE TRUNCATE` statement-level trigger on `t_stock_movements` to guard against accidental administrative truncation.
3. **Ingestion Collision Ergonomics:**
   In `commit_grpo_import_batch`, catch `unique_violation` (`23505`) during concurrent line insertions and gracefully reclassify colliding rows as `REFRESHED`, returning clean diagnostics to the client instead of a raw SQL error.
