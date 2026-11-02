# Domain D4: Stock Ledger Core & Current Stock

## 1. Domain Overview
Domain D4 implements the append-only stock movement ledger and derived inventory views for the Pizza 4P's India Inventory Control Tool. It guarantees complete auditability, zero data mutation, and real-time inventory calculation directly from physical transaction history.

### Invariants & Non-Negotiable Boundaries
- **Quantities Only:** The ledger strictly persists physical units, batch identifiers, expiry dates, and signed movement quantities. Zero financial figures, commercial valuation, tax data, or vendor identifiers are permitted anywhere in this domain.
- **Append-Only Immutability:** No row in `t_stock_movements` can ever be modified or removed. Immutability is enforced concurrently through SQL privilege revocation, database triggers, and Row-Level Security policies.
- **Derived Current Stock:** Current inventory balances are never stored as mutable columns; they are computed dynamically via `v_stock_current` by aggregating signed movement deltas.
- **Two-Stage Issue Offset Principle:** Staged goods are reserved immediately (`ISSUE_PENDING`), and upon door confirmation by the kitchen runner, offset symmetrically (`ISSUE_PENDING_OFFSET` and `ISSUE_CONFIRMED` or `ISSUE_REVERSAL`) to prevent double-counting.

---

## 2. Table Schemas

### 2.1 `t_stock_movements` (Immutable Stock Ledger)
The transactional backbone recording all physical inventory movements across stores and storerooms.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `movement_id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique immutable movement identifier |
| `store_id` | `TEXT` | `NOT NULL, FK -> m_stores(store_id)` | Restaurant store code (e.g., `IND-DEL-01`) |
| `warehouse_id` | `TEXT` | `NOT NULL, FK -> m_warehouses(warehouse_id)` | Storeroom/room code (e.g., `WH-DEL01-COLD`) |
| `item_code` | `TEXT` | `NOT NULL, FK -> m_items(item_code)` | Material item code (e.g., `ITM-CHZ-001`) |
| `movement_type` | `TEXT` | `NOT NULL, CHECK (movement_type IN (...))` | Transaction movement classification (see below) |
| `quantity` | `NUMERIC` | `NOT NULL` | Signed transaction quantity |
| `uom` | `TEXT` | `NOT NULL` | Unit of measure (`kg` or `pcs`) |
| `batch_number` | `TEXT` | `NULL` | Manufacturer or internal batch identifier |
| `expiry_date` | `DATE` | `NULL` | Lot expiration date |
| `reference_doc_id` | `TEXT` | `NOT NULL` | Originating document key (GRPO, Request, Transfer, Count) |
| `created_by_user_id`| `TEXT` | `NOT NULL, FK -> m_users(user_id)` | User who recorded or triggered the movement |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Immutable creation timestamp |

### 2.2 Movement Types & Sign Conventions

| Movement Type | Sign | Operational Trigger |
| :--- | :---: | :--- |
| `GRPO_IMPORT` | `+` (positive) | Inbound receipt from vendor committed from SAP export (Flow A-2) |
| `ISSUE_PENDING` | `−` (negative) | Storekeeper picks and stages goods for kitchen request (Flow C-2) |
| `ISSUE_PENDING_OFFSET` | `+` (positive) | Reversing pending reservation upon runner door inspection (Flow C-2) |
| `ISSUE_CONFIRMED` | `−` (negative) | Confirmed physical issue handed over to kitchen runner (Flow C-2) |
| `ISSUE_REVERSAL` | `+` (positive) | Runner declined goods at door; returned to shelf (Flow C-2) |
| `WASTE_DISPOSAL` | `−` (negative) | Approved disposal of damaged, spoiled, or expired stock (Flow G) |
| `SUPPLIER_RETURN` | `−` (negative) | Rejected or returned stock dispatched to supplier (Flow G) |
| `TRANSFER_OUT_INTRANSIT`| `−` (negative) | Inter-store transfer dispatched to another location (Flow G) |
| `TRANSFER_IN_RECEIVED` | `+` (positive) | Inter-store transfer received and verified (Flow G) |
| `COUNT_ADJUSTMENT` | `+` or `−` | Post-cutoff inventory reconciliation voucher approved by FC (Flow F) |

---

## 3. Immutability & Security Architecture

1. **Trigger Enforcement:** The trigger `trg_prevent_ledger_mutation` executes `BEFORE UPDATE OR DELETE` on `t_stock_movements` and unconditionally executes `tg_prevent_ledger_mutation()`, raising SQLSTATE `P0001`: `"Stock movements are append-only and cannot be updated or deleted."`
2. **SQL Privilege Revocation:** Explicitly revokes `UPDATE`, `DELETE`, and `TRUNCATE` from `PUBLIC`, `authenticated`, and `anon`.
3. **Row-Level Security Policies:** Only `SELECT` and `INSERT` policies are granted to `authenticated`. No mutating policy exists.

---

## 4. Views

### 4.1 `v_stock_current` (Derived Inventory Balances)
Groups `t_stock_movements` by `store_id`, `warehouse_id`, and `item_code` to calculate real-time book stock:
```sql
SELECT 
  store_id, warehouse_id, item_code,
  SUM(CASE 
    WHEN movement_type = 'GRPO_IMPORT' THEN quantity
    WHEN movement_type = 'ISSUE_PENDING' THEN quantity
    WHEN movement_type = 'ISSUE_PENDING_OFFSET' THEN quantity
    WHEN movement_type = 'ISSUE_CONFIRMED' THEN quantity
    WHEN movement_type = 'ISSUE_REVERSAL' THEN quantity
    WHEN movement_type = 'WASTE_DISPOSAL' THEN quantity
    WHEN movement_type = 'SUPPLIER_RETURN' THEN quantity
    WHEN movement_type = 'TRANSFER_OUT_INTRANSIT' THEN quantity
    WHEN movement_type = 'TRANSFER_IN_RECEIVED' THEN quantity
    WHEN movement_type = 'COUNT_ADJUSTMENT' THEN quantity
    ELSE 0 END) AS book_stock
FROM public.t_stock_movements
GROUP BY store_id, warehouse_id, item_code;
```

### 4.2 `v_stock_lots_fifo` (FIFO Per-Lot Queue)
Aggregates remaining quantity per lot (`store_id`, `warehouse_id`, `item_code`, `batch_number`, `expiry_date`), filtering out depleted lots (`HAVING SUM(quantity) > 0`) and sorting in strict FIFO order:
- `ORDER BY expiry_date ASC NULLS LAST, MIN(created_at) ASC`

### 4.3 `v_expiry_radar` (Shelf-Life Risk Monitor)
Correlates active lots with category rules in `m_expiry_tracking_config` and assigns operational status flags:
- `days_to_expiry = expiry_date - CURRENT_DATE`
- Status logic:
  - `EXPIRED_LOCK`: when `days_to_expiry <= 0` (hard-blocks lot from picking queue).
  - `EXPIRY_AMBER`: when `0 < days_to_expiry <= expiry_warning_days` (amber badge, prioritized for dispatch).
  - `FIFO_OK`: when `days_to_expiry > expiry_warning_days` or `requires_lot_expiry_tracking = false`.

---

## 5. Stored Procedures & Analytical Functions

### 5.1 `get_suggested_reorder(p_store_id text, p_warehouse_id text, p_item_code text) -> numeric`
Evaluates replenishment targets against current derived stock:
- If `book_stock <= reorder_point`: returns `GREATEST(0, par_level - book_stock)`.
- If `book_stock > reorder_point`: returns `0`.
- If no reorder rule exists for item: returns `0`.

### 5.2 `calculate_adu(p_store_id text, p_warehouse_id text, p_item_code text, p_days int default 7) -> numeric`
Computes rolling Average Daily Usage over $N$ days:
$$\text{ADU} = \frac{\sum (\text{ISSUE\_CONFIRMED} + \text{WASTE\_DISPOSAL})}{N}$$
- Only includes actual physical consumption (`ISSUE_CONFIRMED` and `WASTE_DISPOSAL`).
- Defaults to rule lookback window (`adu_window_days`) or 7 days.

---

## 6. Worked Examples (Doc §4.1 Verification)

| Example | Initial GRPO | Staged (`ISSUE_PENDING`) | Runner Action | Resulting Derived Stock |
| :--- | :---: | :---: | :--- | :---: |
| **1: Decline** | `+100 kg` | `-5 kg` | Runner declines: `ISSUE_REVERSAL (+5 kg)` | `100 kg` |
| **2: Full Confirm** | `+100 kg` | `-5 kg` | Runner confirms: `OFFSET (+5 kg)`, `CONFIRMED (-5 kg)` | `95 kg` |
| **3: Partial Confirm** | `+100 kg` | `-5 kg` | Runner accepts 3 kg: `OFFSET (+5 kg)`, `CONFIRMED (-3 kg)` | `97 kg` |

---

## 7. Verification Suite Summary
All behaviors are exercised in `supabase/tests/0040_ledger.sql` with 44 pgTAP assertions:
- Table schema, primary keys, foreign keys, and CHECK constraints.
- Trigger and privilege immutability on UPDATE and DELETE.
- Exact arithmetic validation of Worked Examples 1, 2, and 3.
- Full two-stage issue lifecycle simulation with waste, transfers, and adjustments.
- FIFO sorting and automatic exclusion of depleted lots.
- Expiry radar classification (`EXPIRED_LOCK`, `EXPIRY_AMBER`, `FIFO_OK`).
- Replenishment suggestion and ADU calculations.
- Row-Level Security for authenticated and anonymous users.
