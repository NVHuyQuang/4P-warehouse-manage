# Domain D3: Item Master & Expiry Configuration

## 1. Domain Overview
Domain D3 establishes the foundational material master data and inventory control parameters for the Pizza 4P's India Inventory Control Tool. It defines physical catalog items, lot-level expiry tracking rules, replenishment reorder rules, and unit-of-measure conversions.

### Invariants & Non-Negotiable Boundaries
- **Quantities Only:** The system exclusively tracks physical units, batch codes, lots, and movement quantities. Zero financial figures, valuation models, or transactional commercial metadata are persisted or processed in this domain.
- **Strict Role-Based Access Control:** All authenticated personnel across stores and sections have read-only visibility into items and operational rules. Write and modification privileges are strictly quarantined to storekeepers (`ADMIN`), financial controllers (`APPROVER`), and global system operators (`SYSTEM_ADMIN`).

---

## 2. Table Schemas

### 2.1 `m_items` (Item Master)
Stores the master catalog of raw ingredients, packaging, and supplies.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `item_code` | `TEXT` | `PRIMARY KEY` | Unique SKU identifier (e.g., `ITM-CHZ-001`) |
| `item_name` | `TEXT` | `NOT NULL` | Human-readable product description |
| `category_group` | `TEXT` | `NOT NULL` | Functional group (e.g., `CHEESE`, `DRY_GOODS`, `MEAT`, `VEGETABLE`, `BEVERAGE`) |
| `base_uom` | `TEXT` | `NOT NULL, CHECK (lower(base_uom) IN ('kg', 'pcs'))` | Primary inventory counting unit |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | Active listing status for requisition and picking |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Modification timestamp (auto-updated by trigger) |

### 2.2 `m_expiry_tracking_config` (Expiry Tracking Configuration)
Configures which material categories demand lot-based shelf-life tracking and defines alert horizons.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `config_id` | `TEXT` | `PRIMARY KEY` | Unique configuration key (e.g., `cfg-exp-chz`) |
| `category_group` | `TEXT` | `NOT NULL UNIQUE` | Category group identifier |
| `requires_lot_expiry_tracking` | `BOOLEAN` | `NOT NULL DEFAULT false` | Whether batch/expiry registration is required at inbound |
| `expiry_warning_days` | `INTEGER` | `NOT NULL DEFAULT 0, CHECK (expiry_warning_days >= 0)` | Advance warning days before expiry lock triggers |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Modification timestamp (auto-updated by trigger) |

### 2.3 `m_reorder_rules` (User-Defined Replenishment Rules)
Defines inventory threshold targets per store, warehouse, and item to guide purchase order suggestions without manual recalculation.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `rule_id` | `TEXT` | `PRIMARY KEY` | Unique rule identifier |
| `store_id` | `TEXT` | `NOT NULL` | Target store code (e.g., `IND-DEL-01`) |
| `warehouse_id` | `TEXT` | `NOT NULL` | Target storeroom/warehouse (e.g., `WH-DEL01-COLD`) |
| `item_code` | `TEXT` | `NOT NULL, FK -> m_items(item_code) ON DELETE CASCADE` | Associated item code |
| `par_level` | `NUMERIC(12,3)` | `NOT NULL, CHECK (par_level >= 0)` | Maximum target inventory level |
| `reorder_point` | `NUMERIC(12,3)` | `NOT NULL, CHECK (reorder_point >= 0)` | Stock trigger level for reordering |
| `min_order_qty` | `NUMERIC(12,3)` | `NOT NULL, CHECK (min_order_qty >= 0)` | Minimum order lot quantity |
| `adu_window_days` | `INTEGER` | `NOT NULL DEFAULT 7, CHECK (adu_window_days > 0)` | Lookback sample period in days for ADU computation |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Modification timestamp |

*Note: Enforces a compound unique constraint `(store_id, warehouse_id, item_code)`.*

### 2.4 `m_uom_conversions` (Unit of Measure Conversions)
Maintains translation ratios between alternate packaging units and base storage units, as well as shrinkage-prevention requirements.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `conversion_id` | `TEXT` | `PRIMARY KEY` | Unique conversion identifier |
| `item_code` | `TEXT` | `NOT NULL, FK -> m_items(item_code) ON DELETE CASCADE` | Associated item code |
| `base_uom` | `TEXT` | `NOT NULL` | Base inventory unit (`kg` or `pcs`) |
| `secondary_uom` | `TEXT` | `NOT NULL` | Secondary or packaging unit (`pcs`, `kg`, etc.) |
| `conversion_factor` | `NUMERIC(12,4)` | `NOT NULL, CHECK (conversion_factor > 0)` | Multiplier ratio ($1 \text{ secondary unit} = \text{factor} \times \text{base unit}$) |
| `dual_uom_required` | `BOOLEAN` | `NOT NULL DEFAULT false` | Mandatory `true` for items requiring weight and count verification during transfer |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT clock_timestamp()` | Modification timestamp |

*Note: Enforces a compound unique constraint `(item_code, secondary_uom)`.*

---

## 3. Row-Level Security (RLS) & Access Control Matrix

Row-Level Security is explicitly enabled on all four tables with strict segregation:

| Operation | Role | Policy Evaluation | Behavior |
| :--- | :--- | :--- | :--- |
| **SELECT** | `authenticated` | `USING (true)` | Permitted for all authenticated system roles |
| **SELECT** | `anon` | Denied | Blocked (0 rows returned / access denied) |
| **INSERT** | `ADMIN`, `APPROVER`, `SYSTEM_ADMIN` | `WITH CHECK (has_role(...))` | Permitted |
| **INSERT** | Frontline Roles (`RUNNER`, `KITCHEN_REQ`, etc.) | Denied by RLS `WITH CHECK` | Raises SQLSTATE 42501 |
| **UPDATE** | `ADMIN`, `APPROVER`, `SYSTEM_ADMIN` | `USING (...) WITH CHECK (...)` | Permitted |
| **UPDATE** | Frontline Roles (`RUNNER`, `KITCHEN_REQ`, etc.) | Denied by RLS `USING` | 0 rows affected |
| **DELETE** | `ADMIN`, `APPROVER`, `SYSTEM_ADMIN` | `USING (...)` | Permitted |
| **DELETE** | Frontline Roles (`RUNNER`, `KITCHEN_REQ`, etc.) | Denied by RLS `USING` | 0 rows affected |

---

## 4. Seed Data Summary
Seeded deterministically from `lib/testing/synthetic-seed.ts`:
- **20 Master Items:**
  - 5 Cheese items (Cold Room: Mozzarella, Burrata, Buffalo Mozzarella, Ricotta, Gorgonzola)
  - 5 Dry Goods items (Flour Type 00, San Marzano Tomato, Extra Virgin Olive Oil, Yeast, Sea Salt)
  - 4 Meat items (Cold Room: Prosciutto di Parma, Spicy Salami, Guanciale, Cooked Ham)
  - 4 Vegetable items (Cold Room: Fresh Basil, Cherry Tomatoes, Wild Rocket, Button Mushrooms)
  - 2 Beverage items (Dry Store: Sparkling Water 750ml, Draft IPA Keg 20L)
- **5 Expiry Configurations:** Group configurations for Cheese, Dry Goods, Meat, Vegetable, Beverage.
- **4 Dual UoM Conversions:** High-risk portioning items requiring both pieces and kilograms to eliminate cutting shrinkage ambiguity.
- **20 Store Reorder Rules:** Par level and trigger parameters configured for store `IND-DEL-01`.

---

## 5. Verification & Test Suite
The pgTAP automated test suite is located at `supabase/tests/0030_items.sql` and includes 48 test assertions:
1. **Table and Schema Verification:** Tests existence of tables, column definitions, and primary keys.
2. **Constraint Enforcement:** Validates UoM domain constraints, non-negative quantity limits, and uniqueness rules.
3. **Foreign Key Integrity:** Tests cascade deletions from master items to conversion and reorder tables.
4. **Automated Triggers:** Asserts `updated_at` modification upon row updates.
5. **Security Definer RLS Suite:** Verifies allowed reads and denied modifications under `RUNNER`, with full write privileges under `ADMIN` and `APPROVER`.
