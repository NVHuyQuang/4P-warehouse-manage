# CONTRACTS & SPECIFICATIONS — Pizza 4P's India Inventory Control Tool

## 1. Domain Enums

### 1.1 Roles (`UserRole`)
```typescript
export const UserRole = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',         // Global admin: user provisioning, security, system ops
  ADMIN: 'ADMIN',                       // Warehouse Keeper / Storekeeper: receiving, picking, benchmark count
  RM: 'RM',                             // Restaurant Manager: daily balance review, minor waste approval
  KITCHEN_REQ: 'KITCHEN_REQ',           // Kitchen Section Requester: create/amend kitchen requests
  BAR_REQ: 'BAR_REQ',                   // Bar Section Requester: create/amend bar requests
  CHEESE_REQ: 'CHEESE_REQ',             // Cheese Section Requester: create/amend cheese requests
  RUNNER: 'RUNNER',                     // Kitchen Runner: door inspection and digital receipt confirmation
  CUSTODIAN: 'CUSTODIAN',               // Named Room Custodian: room security, shift custody, benchmark count
  SCM: 'SCM',                           // Supply Chain Lead: dock receiving issue escalation, price variance in SAP
  ACCOUNTANT: 'ACCOUNTANT',             // Store Accountant: cycle/month-end count, reconciliation vouchers
  APPROVER: 'APPROVER',                 // Financial Controller: store/wh approvals, major waste, count adjustments
  VIEWER: 'VIEWER',                     // Internal Audit / Executive: read-only access to ledger & audit trail
} as const;
```

### 1.2 Store Sections (`SectionId`)
```typescript
export const SectionId = {
  KITCHEN: 'KITCHEN',
  BAR: 'BAR',
  CHEESE: 'CHEESE',
  ALL: 'ALL',
} as const;
```

### 1.3 Warehouse Storage Types (`StorageType`)
```typescript
export const StorageType = {
  COLD_ROOM: 'COLD_ROOM',
  DRY_STORE: 'DRY_STORE',
} as const;
```

### 1.4 Warehouse Operating Status (`WarehouseStatus`)
```typescript
export const WarehouseStatus = {
  ACTIVE: 'ACTIVE',
  FROZEN_FOR_COUNT: 'FROZEN_FOR_COUNT',
  INACTIVE: 'INACTIVE',
} as const;
```

### 1.5 Unit of Measure (`UomCode`)
```typescript
export const UomCode = {
  KG: 'kg',
  PIECE: 'pcs',
} as const;
```

---

## 2. Stock Ledger Movement Types & Signs

Table: `t_stock_movements`. The ledger is strictly append-only.

| Movement Type | Sign in Ledger | Meaning & Trigger |
| :--- | :---: | :--- |
| `GRPO_IMPORT` | `+` (positive) | Inbound receipt from vendor committed from SAP GRPO export (Flow A-2). |
| `ISSUE_PENDING` | `−` (negative) | Warehouse Keeper picks & stages goods for kitchen request. Book stock decreases immediately (Flow C-2). |
| `ISSUE_PENDING_OFFSET` | `+` (positive) | Clearing the pending reservation upon runner door inspection (Flow C-2). |
| `ISSUE_CONFIRMED` | `−` (negative) | Confirmed physical issue handed over to kitchen runner (Flow C-2). |
| `ISSUE_REVERSAL` | `+` (positive) | Runner declined goods at the door; items returned physically to the shelf (Flow C-2). |
| `WASTE_DISPOSAL` | `−` (negative) | Approved disposal of damaged, spoiled, or expired goods (Flow G). |
| `SUPPLIER_RETURN` | `−` (negative) | Goods returned to supplier from warehouse (Flow G). |
| `TRANSFER_OUT_INTRANSIT`| `−` (negative) | Stock dispatched to another restaurant store (Flow G). |
| `TRANSFER_IN_RECEIVED` | `+` (positive) | Stock received and verified from another restaurant store (Flow G). |
| `COUNT_ADJUSTMENT` | `+` or `−` | Post-cutoff inventory adjustment voucher approved by Financial Controller (Flow F). |

### Mathematical Invariants
1. `Current Book Stock = Sum(signed quantity for all rows matching store_id, warehouse_id, item_code)`.
2. For any two-stage issue transaction:
   - Full acceptance of $Q$: net ledger delta = $-Q + Q - Q = -Q$.
   - Full decline of $Q$: net ledger delta = $-Q + Q = 0$.
   - Partial acceptance of $Q_{acc}$ out of $Q_{staged}$ (with $Q_{decl} = Q_{staged} - Q_{acc}$ returned to shelf):
     appended rows = `ISSUE_PENDING_OFFSET` ($+Q_{staged}$) and `ISSUE_CONFIRMED` ($-Q_{acc}$). Net ledger delta = $-Q_{staged} + Q_{staged} - Q_{acc} = -Q_{acc}$.

---

## 3. State Machines

### 3.1 Section Stock Request (`t_requests.status`)
```
[QUEUED] 
   |---> (Requester edits qty or cancels) ---> [CANCELLED_BY_REQUESTER] (Terminal)
   |---> (Admin clicks "Begin Picking") ---> [PICKING] (Edit/cancel locked for requester)
            |
            |---> (Admin stages stock) ---> [AWAITING_RUNNER]
                     |
                     |---> Runner accepts full ---> [CONFIRMED] (Terminal)
                     |---> Runner accepts part ---> [PARTIAL_ACCEPTED] (Terminal)
                     |---> Runner declines all ---> [PARTIAL_DECLINED] (Terminal)
```
- Request window logic:
  - If request submitted within `[morning_issue_window]` or `[afternoon_issue_window]`: flagged `is_urgent = false`.
  - If request submitted outside window: user must provide `urgent_reason` text; flagged `is_urgent = true` (badge `URGENT`). Request is accepted, never blocked.

### 3.2 Inter-Store Transfer (`t_transfer_intransit.status`)
```
[IN_TRANSIT] 
   |---> Receiver verifies & quantities match ---> [RECEIVED_MATCH] (Terminal)
   |---> Discrepancy detected (receive != dispatch) ---> [VARIANCE_PENDING_FC]
            |---> FC approves variance ---> [RECEIVED_VARIANCE_APPROVED] (Terminal)
            |---> FC rejects variance ---> [REJECTED] (Terminal)
```
- Dual-Unit Requirement: Both weight (kg) and piece count (pcs) must be recorded for cheese/meat transfers to eliminate cutting shrinkage ambiguity.

### 3.3 Periodic Stock Count (`t_stock_counts.status` & `m_warehouses.status`)
```
[Warehouse ACTIVE] ---> Admin initiates count ---> [Warehouse FROZEN_FOR_COUNT]
                                                    |
                                             [IN_PROGRESS] (Blind 1st count)
                                                    |
                                    (Count vs Book comparison)
                                   /                          \
                     (Diff == 0)  /                            \ (Diff != 0)
                                 v                              v
                     [COMPLETED]                             [RECOUNT] (2nd person recount)
                                                                |
                                             (Voucher submitted to FC)
                                                                |
                                             FC approves: appends COUNT_ADJUSTMENT
                                             Warehouse returns to [ACTIVE]
```

### 3.4 Daily Balance Reconciliation (`t_daily_balances.status`)
- Calculated closing expected stock:
  `expected_qty = opening_qty + received_qty - issued_qty`
- Variance:
  `variance_qty = counted_qty - expected_qty`
- Status transition:
  - If all benchmark items have `variance_qty == 0`: status = `BALANCED`. Custodian and Finance Lead sign off.
  - If any item has `variance_qty != 0`: status = `VARIANCE_FLAGGED`. Custodian enters cause code/notes. If Finance Lead unavailable at evening close, Custodian signs with status `"unexplained"`.
  - The App schedules an automated morning escalation digest to central FC for all persistent variances.

### 3.5 SAP GRPO Line Item Classification (`t_grpo_import_items.status`)
- Header validation: Row 1 must match 27 known columns.
- Confidential columns dropped before persistence: `Price`, `Total Tax`, `Net Tax Amount`, `Row Total`, `Gross Total`, `Vendor Name`, `Vendor Address`.
- Line Key derivation: `GRPO No. + Item Code + occurrence order inside document`.
- Line Classification:
  - `IMPORTED`: New line matching active store and valid item code.
  - `REFRESHED`: Existing document re-uploaded where only `Status` (O/C), `Target Type`, or `Open Quantity` changed. Reference metadata refreshed with 0 stock movement.
  - `NEEDS_2ND_APPROVAL`: Existing document re-uploaded with changed `Quantity` or `Item Code`. Requires second independent approval (SCM Lead or Finance Lead) before posting reversal.
  - `QUARANTINED`: Invalid item code, unmapped UoM, unmapped store code, or negative/malformed quantity. Written to `t_grpo_staging_errors`.

### 3.6 User Invitations & Approver Lifecycle (`m_user_invitations.status`)
```
[System Admin creates invitation]
               |
    (Is role == APPROVER?)
     /                  \
   (No)                 (Yes)
    |                     |
    |          [PENDING_SECOND_APPROVAL] (Independent exec/GM must approve)
    |                     |
    +----------+----------+
               |
               v
           [PENDING] (Activation token dispatched via email link)
               |
               |---> User clicks link & sets private password ---> [ACTIVATED]
               |---> Token expires (default 48h) ---> [EXPIRED]
```

---

## 4. Role-by-Action Matrix (Doc §1.3 Ground Truth)

| Operational Action | Sys Admin | Admin (Keeper) | RM | Section Req | Runner | Custodian | SCM | Accountant | Approver (FC) | Viewer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Invite Users & Reset Password** | **YES** | No | No | No | No | No | No | No | No | No |
| **Configure Store Issue Windows** | No | **YES** | No | No | No | No | No | No | **YES** | No |
| **Define Expiry Tracking Groups** | No | **YES** | No | No | No | No | No | No | **YES** | No |
| **Import SAP GRPO Export File** | No | **YES** | No | No | No | No | No | No | No | No |
| **Create Section Stock Request** | No | No | No | **YES** | No | No | No | No | No | No |
| **Amend / Cancel Pending Request**| No | No | No | **YES** | No | No | No | No | No | No |
| **Pick & Stage Stock from Storeroom** | No | **YES** | No | No | No | **YES** | No | No | No | No |
| **Confirm Receipt at Storeroom Door** | No | No | No | No | **YES\*** | No | No | No | No | No |
| **Perform Daily Benchmark Count** | No | **YES** | No | No | No | **YES** | No | No | No | No |
| **Sign Shift Handover (Key/Log)** | No | **YES** | **YES**| No | No | **YES** | No | No | No | No |
| **Conduct Periodic Stock Count** | No | **YES** | No | No | No | **YES** | No | **YES** | No | No |
| **Submit Post-Cutoff Adjustment** | No | No | No | No | No | No | No | **YES** | No | No |
| **Approve Stock Adjustment Voucher** | No | No | No | No | No | No | No | No | **YES** | No |
| **Log Waste Disposal Movement** | No | **YES** | No | **YES** | No | **YES** | No | No | No | No |
| **Approve Waste Disposal Claim** | No | No | **YES**| No | No | No | No | No | **YES** | No |
| **Dispatch / Receive Store Transfer**| No | **YES** | No | No | No | **YES** | No | No | No | No |
| **Approve Transfer Discrepancy** | No | No | No | No | No | No | No | No | **YES** | No |
| **Request New Store or Warehouse** | No | **YES** | **YES**| No | No | No | No | No | No | No |
| **Approve New Store or Warehouse** | No | No | No | No | No | No | No | No | **YES** | No |

*\*Per Decision Q8, Section Requester and Kitchen Runner may be the same individual on quiet shifts, provided the runner profile is associated with the requesting section.*

---

## 5. Calculation Formulas

### 5.1 Average Daily Usage (ADU)
$$\text{ADU} = \frac{\sum_{t=D-N}^{D-1} (\text{ISSUE\_CONFIRMED}_t + \text{WASTE\_DISPOSAL}_t)}{N}$$
Where $N$ is configured in `m_reorder_rules.adu_window_days` (default sample: 7 days).

### 5.2 Suggested Reorder Quantity
$$\text{Suggested Qty} = \max\left(0, \text{Par Level} - \text{Current Book Stock} - \text{Open PO Qty}\right)$$
Trigger condition: $\text{Current Book Stock} \le \text{Reorder Point}$.

### 5.3 Expiry Radar Status
$$\text{Days To Expiry} = \text{Batch Expiry Date} - \text{Current Date}$$
- If $\text{Days To Expiry} \le 0$: Flag `EXPIRED_LOCK` (hard block; cannot be selected for picking).
- If $0 < \text{Days To Expiry} \le \text{warning\_days}$: Flag `EXPIRY_AMBER` (amber badge, prioritized in FIFO pick list).
- Otherwise: Flag `FIFO_OK`.
Evaluated only for categories where `requires_lot_expiry_tracking == true` in `m_expiry_tracking_config`.
