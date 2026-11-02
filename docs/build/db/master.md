# Database Domain: Master Stores & Warehouses (D1)

## 1. Domain Overview
The Master Stores and Warehouses domain forms the structural foundation of the Pizza 4P's India Inventory Control Tool. It models physical operational premises (stores and storerooms), baseline go-live operational schedules (receiving and issue windows), named custodian assignments, and provides the system-wide store switcher view.

All schemas strictly enforce **quantities only**: no commercial pricing, valuation figures, tax amounts, or external entity commercial identities are stored or processed.

---

## 2. Relational Schema & Tables

### 2.1 `m_stores`
Represents physical restaurant branches operating across India (e.g., Delhi, Bengaluru).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `store_id` | `text` | `PRIMARY KEY` | Unique store code (e.g. `IND-DEL-01`, `IND-DEL-02`). |
| `store_name` | `text` | `NOT NULL` | Human-readable name (e.g. `Delhi Store 1`). |
| `city` | `text` | `NOT NULL` | Operating city name. |
| `status` | `text` | `NOT NULL DEFAULT 'ACTIVE'` | Status string (`ACTIVE`, `INACTIVE`). |
| `is_active` | `boolean` | `NOT NULL DEFAULT true` | Active flag maintained in sync with `status`. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row update timestamp. |

- **Triggers**: `trg_m_stores_sync_status` automatically synchronizes `status` and `is_active` across inserts and updates.

### 2.2 `m_warehouses`
Represents specific physical storage locations within a store (Cold Room and Dry Store).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `warehouse_id` | `text` | `PRIMARY KEY` | Unique warehouse code (e.g. `WH-DEL01-COLD`). |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores` | Parent store reference (`ON DELETE RESTRICT`). |
| `warehouse_name`| `text` | `NOT NULL` | Storeroom label (e.g. `Delhi Store 1 Cold Room`). |
| `floor_level` | `text` | `DEFAULT 'GROUND'` | Floor location. |
| `storage_type` | `storage_type` | `NOT NULL DEFAULT 'COLD_ROOM'` | Enum: `COLD_ROOM` or `DRY_STORE`. |
| `status` | `warehouse_status`| `NOT NULL DEFAULT 'ACTIVE'` | Enum: `ACTIVE`, `FROZEN_FOR_COUNT`, `INACTIVE`. |
| `is_active` | `boolean` | `NOT NULL DEFAULT true` | Active operating flag. |
| `approval_id` | `text` | `NULL` | Proposal approval reference. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row update timestamp. |

- **Indexes**: `idx_m_warehouses_store_id` on `store_id`.
- **Triggers**: `trg_m_warehouses_sync_status` synchronizes `is_active` with `status`.

### 2.3 `m_go_live_assignments`
Captures pre-requisite operational parameters and named duty assignments per store before go-live.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `store_id` | `text` | `PRIMARY KEY REFERENCES m_stores` | Store reference (`ON DELETE CASCADE`). |
| `cold_room_custodian_id` | `text` | `NULL` | Primary cold room custodian identifier. |
| `cold_room_backup_id` | `text` | `NULL` | Backup cold room custodian identifier. |
| `dry_store_custodian_id` | `text` | `NULL` | Primary dry store custodian identifier. |
| `dry_store_backup_id` | `text` | `NULL` | Backup dry store custodian identifier. |
| `kitchen_runner_id` | `text` | `NULL` | Designated kitchen runner identifier. |
| `evening_key_holder_id` | `text` | `NULL` | Designated evening key holder identifier. |
| `morning_receiving_window` | `text` | `NULL` | Daily morning delivery dock window (e.g. `07:00-09:00`). |
| `afternoon_receiving_window`| `text` | `NULL` | Daily afternoon delivery dock window (e.g. `14:00-16:00`). |
| `morning_issue_window` | `text` | `NULL` | Scheduled morning requisition window (e.g. `06:00-08:30`). |
| `afternoon_issue_window` | `text` | `NULL` | Scheduled afternoon requisition window (e.g. `14:30-16:00`). |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row creation timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Row update timestamp. |

---

## 3. Views

### 3.1 `v_store_switcher`
Provides active store context for the desktop navigation bar dropdown:
```sql
CREATE OR REPLACE VIEW public.v_store_switcher
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  s.store_name,
  s.city,
  s.status,
  s.is_active
FROM public.m_stores s
WHERE s.status = 'ACTIVE' AND s.is_active = true;
```
By utilizing `WITH (security_invoker = true)`, PostgreSQL enforces calling user permissions and Row-Level Security policies.

---

## 4. Row-Level Security (RLS) Policy Design

All tables have Row-Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`):
1. **Read Operations (SELECT):**
   - Available to any `authenticated` user (`USING (true)`).
   - Anon / unauthenticated access returns 0 rows.
2. **Write Operations (INSERT, UPDATE, DELETE):**
   - Strictly restricted to roles with master governance authority: `APPROVER` (Financial Controller) and `SYSTEM_ADMIN`.
   - Verified via `has_role('APPROVER') OR has_role('SYSTEM_ADMIN')`.
   - Attempted writes by operational frontline roles (`RUNNER`, `ADMIN`, `KITCHEN_REQ`, etc.) are blocked and rejected by PostgreSQL RLS.

---

## 5. Sample Baseline Seeds

- **Stores:**
  - `IND-DEL-01`: Delhi Store 1 (`ACTIVE`)
  - `IND-DEL-02`: Delhi Store 2 (`ACTIVE`)
- **Warehouses:**
  - `WH-DEL01-COLD`: Delhi Store 1 Cold Room (`GROUND`, `COLD_ROOM`, `ACTIVE`)
  - `WH-DEL01-DRY`: Delhi Store 1 Dry Store (`GROUND`, `DRY_STORE`, `ACTIVE`)
- **Go-Live Assignments:**
  - Pre-seeded receiving windows (`07:00-09:00`, `14:00-16:00`) and issue windows (`06:00-08:30`, `14:30-16:00`) for `IND-DEL-01` and `IND-DEL-02`.

---

## 6. Verification & Test Suite

The test suite in `supabase/tests/0010_master.sql` runs via pgTAP and validates:
- Table and view existence.
- Column types and primary/foreign key definitions.
- RLS enabled state on all tables.
- Seed data presence and correctness.
- Status and `is_active` bi-directional trigger synchronization.
- Allowed operations for `APPROVER` and `SYSTEM_ADMIN` roles.
- Denied write operations for operational roles (`RUNNER`, `ADMIN`).
- Denied read/write operations for `anon` role.
- Foreign key constraints (cannot link warehouse to non-existent store, cannot delete store with active warehouses).

Execute tests via:
```bash
npx supabase test db supabase/tests/0010_master.sql
```
