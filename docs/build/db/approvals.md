# Database Domain: Approvals Inbox & Store Proposals (D13)

## 1. Domain Overview
The Approvals Inbox & Store Proposals domain governs formal authorization workflows and physical infrastructure expansions for the Pizza 4P's India Inventory Control Tool. It implements:
- **Flow H (Add Store / Warehouse):** Structured multi-stage lifecycle for proposing and activating new restaurant stores (`NEW_STORE`) and storerooms (`NEW_WAREHOUSE`) with nominated primary and backup custodians, culminating in independent sign-off by the central Financial Controller (`FC` / `APPROVER`).
- **Global Approvals Inbox (`v_approval_inbox`):** Unified, real-time relational aggregation view serving Flow H and consolidating pending authorization obligations across six operational domains: approver account invitations, stock recount adjustments, transfer discrepancies, waste claims, SAP import corrections, and store/warehouse proposals.

All schemas, views, and functions strictly enforce **quantities only**: zero commercial prices, valuations, costs, tax figures, or vendor financial details exist anywhere in this domain. Furthermore, append-only principles are preserved: `t_stock_movements` is never updated or deleted.

---

## 2. Relational Schema & Tables

### 2.1 `t_store_warehouse_approvals`
Audit table recording all store and warehouse expansion proposals from initial nomination through final Financial Controller determination.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `approval_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique proposal identifier. |
| `proposal_type` | `text` | `NOT NULL CHECK (proposal_type IN ('NEW_STORE', 'NEW_WAREHOUSE'))` | Scope of the physical expansion request. |
| `proposed_name` | `text` | `NOT NULL` | Proposed venue or room label (e.g., `Pizza 4Ps Bengaluru Indiranagar` or `Delhi Main Freezer Room`). |
| `store_id` | `text` | `NULL REFERENCES m_stores(store_id)` | Parent store code for warehouse proposals, or optional target code for new stores. |
| `storage_type` | `text` | `NULL CHECK (storage_type IS NULL OR storage_type IN ('COLD_ROOM', 'DRY_STORE', 'FREEZER'))` | Storeroom environmental category. |
| `nominated_custodian_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | User nominated as primary key holder / room custodian. |
| `nominated_backup_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | User nominated as secondary / backup custodian. |
| `fc_decision` | `text` | `NOT NULL DEFAULT 'PENDING' CHECK (fc_decision IN ('PENDING', 'APPROVED', 'REJECTED'))` | Determination state by Financial Controller. |
| `fc_comment` | `text` | `NULL` | Operational notes or rejection justification from the Financial Controller. |
| `requested_by_user_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Authenticated user (RM or Storekeeper) who submitted the proposal. |
| `requested_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Proposal submission timestamp. |
| `decided_by_user_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Financial Controller who approved or rejected the proposal. |
| `decided_at` | `timestamptz` | `NULL` | Timestamp of final approval or rejection. |

#### Constraints & Data Integrity:
- `chk_proposal_distinct_custodians`: Validates that `nominated_custodian_id != nominated_backup_id`. A single user cannot hold both primary and backup custody of a room.
- `chk_proposal_proposed_name_not_empty`: Enforces `length(trim(proposed_name)) > 0`.
- Foreign keys link directly to `auth.users(id)` for all human actors (`nominated_custodian_id`, `nominated_backup_id`, `requested_by_user_id`, `decided_by_user_id`).

#### Indexes:
- `idx_store_wh_approvals_decision` on `(fc_decision)` for high-throughput inbox filtering.
- `idx_store_wh_approvals_store_id` on `(store_id)` for store-scoped queries.
- `idx_store_wh_approvals_requested_by` on `(requested_by_user_id)` for proposer history.
- `idx_store_wh_approvals_requested_at` on `(requested_at DESC)` for chronological review.

---

## 3. Proposal Lifecycle & State Machine

```
   [ Restaurant Manager / Storekeeper ]
                   │
                   ▼
       propose_store_or_warehouse()
                   │
                   ▼
           fc_decision = 'PENDING'  ◄───────────────────────────┐
                   │                                            │
                   ├─────────────────────────────┐              │
                   ▼                             ▼              │
       [ FC rejects proposal ]       [ FC approves proposal ]  │
                   │                             │              │
                   ▼                             ▼              │
        fc_decision = 'REJECTED'      fc_decision = 'APPROVED' │
        (Audit preserved;              │                        │
         no master rows created)       ├─► INSERT INTO m_stores │
                                       │   & m_go_live_assign   │
                                       │   (if NEW_STORE)       │
                                       │                        │
                                       └─► INSERT INTO          │
                                           m_warehouses         │
                                           (if NEW_WAREHOUSE)   │
                                                                │
                   ▲                                            │
                   └─────── Terminal state (Immutability) ──────┘
```

### 3.1 Terminal Decision Immutability
Once an approval record transitions to `APPROVED` or `REJECTED`:
- Trigger `tg_enforce_proposal_lifecycle` intercepts all subsequent `UPDATE` operations and raises exception `P0001: Cannot modify proposal % because it has already been finalized with decision %.`
- `DELETE` operations are strictly blocked by trigger and database privilege revocations.

### 3.2 Automated Master Data Side Effects on Approval
When `decide_store_warehouse_proposal(..., 'APPROVED')` is executed:
1. **`NEW_STORE`:**
   - Derives clean store identifier (e.g., `IND-BLR-01` or `IND-<NAME>`).
   - Inserts active store record into `public.m_stores` (`status = 'ACTIVE'`, `is_active = true`).
   - Initializes `public.m_go_live_assignments` linking `cold_room_custodian_id` and `cold_room_backup_id` to the nominated custodians.
   - Synchronizes generated `store_id` back to the proposal record if originally unassigned.
2. **`NEW_WAREHOUSE`:**
   - Validates parent store existence in `public.m_stores`.
   - Generates standardized warehouse code (e.g., `WH-DEL01-FREEZ-1234` or custom `WH-*`).
   - Inserts active room record into `public.m_warehouses` (`status = 'ACTIVE'`, `storage_type = p_storage_type`, `approval_id = p_approval_id`).

---

## 4. Unified Approvals Inbox Architecture (`v_approval_inbox`)

The `v_approval_inbox` view acts as the single pane of glass for all authorization queues across the entire inventory system. It unifies six independent transactional streams into an identical 8-column contract:

### 4.1 Consolidated Streams & Role Routing

| # | Stream Domain | Source Table | Filter Criteria | Target Role | Routing Logic / Description |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **a** | **Identity (D2)** | `m_user_invitations` | `status = 'PENDING_SECOND_APPROVAL'` | `FC` | Approver invitations require a second independent executive sign-off before activation links dispatch. |
| **b** | **Reconciliation (D9)** | `t_stock_counts` | `status = 'RECOUNT'` | `FC` | Physical stock count discrepancies requiring second count verification and adjustment voucher approval. |
| **c** | **Transfers (D10)** | `t_transfer_intransit` | `status = 'VARIANCE_PENDING_FC'` | `FC` | Inter-store transit discrepancies where receiving count does not match dispatch manifest. |
| **d** | **Waste & Returns (D11)** | `t_waste_returns_log` | `approver_decision = 'PENDING'` | `RM` or `FC` | Minor waste claims (`quantity <= 5.000 kg`) route to store `RM`. Major claims (`> 5.000 kg`) escalate to `FC`. |
| **e** | **SAP Ingestion (D12)** | `t_grpo_import_items` | `status = 'NEEDS_2ND_APPROVAL'` | `SCM` | GRPO re-import with quantity or item code modifications requiring Supply Chain Lead sign-off. |
| **f** | **Proposals (D13)** | `t_store_warehouse_approvals`| `fc_decision = 'PENDING'` | `FC` | New restaurant store or storeroom expansion proposals submitted by field managers. |

### 4.2 View Schema

| Column | Type | Description |
| :--- | :--- | :--- |
| `item_type` | `text` | Domain discriminator: `'USER_INVITATION'`, `'STOCK_COUNT'`, `'TRANSFER_VARIANCE'`, `'WASTE_CLAIM'`, `'SAP_IMPORT_CORRECTION'`, `'STORE_WAREHOUSE_PROPOSAL'`. |
| `item_id` | `uuid` | Primary key of the originating entity (RFC-4122 compliant UUID). |
| `store_id` | `text` | Operating restaurant branch associated with the item (or `NULL` if multi-store/global). |
| `summary` | `text` | Concise, human-readable description for dashboard cards and inbox list widgets. |
| `requested_by_user_id`| `uuid` | Originating requester or logging staff member. |
| `requested_at` | `timestamptz` | Submission or event detection timestamp. |
| `target_role` | `text` | Operational role authorized to act on the item (`'FC'`, `'RM'`, or `'SCM'`). |
| `status` | `text` | Current domain status string. |

Dynamic pruning: when an item is resolved (e.g. approved, rejected, recount completed), its status changes in the underlying table, causing it to immediately and automatically drop out of `v_approval_inbox`.

---

## 5. Stored Procedures (RPCs)

All domain RPCs execute with `SECURITY DEFINER` and explicitly enforce `SET search_path = public, auth, pg_temp` to prevent search path hijacking.

### 5.1 `propose_store_or_warehouse`
Creates a formal expansion proposal in `PENDING` status.

- **Signature:**
  ```sql
  public.propose_store_or_warehouse(
    p_proposal_type text,
    p_proposed_name text,
    p_store_id text DEFAULT NULL,
    p_storage_type text DEFAULT NULL,
    p_nominated_custodian_id uuid DEFAULT NULL,
    p_nominated_backup_id uuid DEFAULT NULL
  ) RETURNS uuid
  ```
- **Access Control:** Restricted to `RM` (Restaurant Manager), `ADMIN` (Storekeeper), or `SYSTEM_ADMIN`.
- **Validation Guards:**
  1. Verifies caller role via `has_role()`.
  2. Resolves caller UUID via session variables (`app.current_user_id`) or `auth.uid()`.
  3. Validates `p_proposal_type IN ('NEW_STORE', 'NEW_WAREHOUSE')`.
  4. Requires non-empty `p_proposed_name`.
  5. Enforces distinct custodians (`p_nominated_custodian_id != p_nominated_backup_id`) and verifies both exist in `auth.users`.
  6. For `NEW_WAREHOUSE`, enforces valid `p_store_id`, verifies parent store exists in `m_stores`, verifies caller store scope, and validates `p_storage_type IN ('COLD_ROOM', 'DRY_STORE', 'FREEZER')`.

### 5.2 `decide_store_warehouse_proposal`
Adjudicates a pending proposal, enforcing strict segregation of duties and executing automated master data instantiation upon approval.

- **Signature:**
  ```sql
  public.decide_store_warehouse_proposal(
    p_approval_id uuid,
    p_decision text,
    p_comment text DEFAULT NULL
  ) RETURNS void
  ```
- **Access Control:** Restricted to `FC` / `APPROVER` (Financial Controller) or `SYSTEM_ADMIN`.
- **Validation Guards & Segregation of Duties:**
  1. Verifies caller role via `has_role('FC')` or `has_role('APPROVER')`.
  2. Resolves caller UUID.
  3. Validates `p_decision IN ('APPROVED', 'REJECTED')`.
  4. Fetches proposal; verifies it exists and is currently in `PENDING` status.
  5. **Segregation of Duties Check:** Enforces `requested_by_user_id != caller_user_id`. Proposers are strictly prohibited from approving their own proposals.
  6. Updates proposal record (`fc_decision`, `fc_comment`, `decided_by_user_id`, `decided_at`).
  7. If `p_decision = 'APPROVED'`, provisions `m_stores` and `m_go_live_assignments` (for `NEW_STORE`) or `m_warehouses` (for `NEW_WAREHOUSE`).

---

## 6. Row Level Security (RLS) Policies

Row Level Security is enabled on `t_store_warehouse_approvals`.

| Role | SELECT | INSERT | UPDATE | DELETE |
| :--- | :---: | :---: | :---: | :---: |
| `SYSTEM_ADMIN` | All rows | Allowed | Allowed | Denied (false) |
| `APPROVER` / `FC` | All rows | Denied | Allowed (where decider ≠ proposer) | Denied (false) |
| `VIEWER` | All rows | Denied | Denied | Denied (false) |
| `RM` | Own store + unassigned + own proposals | Within store scope | Denied | Denied (false) |
| `ADMIN` (Storekeeper) | Own store + own proposals | Within store scope | Denied | Denied (false) |
| Other Roles (`RUNNER`, Requester) | Denied | Denied | Denied | Denied (false) |

### 6.1 Policy Definitions
- **`t_store_warehouse_approvals_select`:**
  Permits global access to `SYSTEM_ADMIN`, `APPROVER`, `FC`, and `VIEWER`. Restricts `RM` and `ADMIN` to proposals matching `store_id = current_store_id()`, unassigned proposals (`store_id IS NULL`), or proposals created by the caller (`requested_by_user_id = auth.uid()`).
- **`t_store_warehouse_approvals_insert`:**
  Permits `RM`, `ADMIN`, and `SYSTEM_ADMIN` within the caller's store scope.
- **`t_store_warehouse_approvals_update`:**
  Permits `FC`, `APPROVER`, and `SYSTEM_ADMIN`, with mandatory check `requested_by_user_id != auth.uid()`.
- **`t_store_warehouse_approvals_delete`:**
  `USING (false)`. All proposal records are permanent legal audit logs.

---

## 7. Segregation of Duties Defense-in-Depth

The segregation of duties rule ("proposer cannot approve own proposal") is guaranteed at three independent layers:
1. **Database Trigger Layer:** `tg_enforce_proposal_lifecycle` checks `NEW.decided_by_user_id != OLD.requested_by_user_id` on any update setting `fc_decision` to `APPROVED` or `REJECTED`.
2. **Security Definer RPC Layer:** `decide_store_warehouse_proposal` explicitly checks `v_proposal.requested_by_user_id = v_caller_id` before performing the update.
3. **RLS Update Policy Layer:** `t_store_warehouse_approvals_update` policy contains `requested_by_user_id != auth.uid()`.

---

## 8. pgTAP Test Suite (`0130_approvals.sql`)

The test suite provides comprehensive test coverage (54 automated assertions) structured across:
- Table existence, primary keys, exact column structures, and foreign keys.
- Row level security activation.
- Check constraints (distinct custodians, non-empty names, valid enums).
- Immutability trigger blocking direct `DELETE` operations.
- `propose_store_or_warehouse` authorization, input validation, and store scoping.
- Segregation of duties verification (FC self-proposal cannot be self-approved).
- `decide_store_warehouse_proposal` authorization, rejection audit, idempotent finalization, and master record provisioning (`m_stores`, `m_go_live_assignments`, `m_warehouses`).
- `v_approval_inbox` view existence, column structure, cross-domain ingestion (all 6 streams), threshold-based routing (minor waste to RM, major waste to FC), and dynamic pruning upon resolution.
- Multi-store isolation RLS policies for `RM` vs global visibility for `FC`.
