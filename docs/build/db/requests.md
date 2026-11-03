# Database Domain: Requests (Flow C-1 Section Stock Request) — Domain D5

## 1. Domain Overview
The **Requests** domain governs digital stock requisitions submitted by frontline restaurant sections (Kitchen, Bar, Cheese) for ingredients and materials stored in store storerooms (Cold Room, Dry Store). It implements:
- **Flow C-1 (Section Stock Request):** Enables authorized section requesters to submit requisitions, enforces operational issue window rules, permits amendment or cancellation while queued, and locks requisitions once warehouse picking starts.
- **Flow C-2 (Stock Issue & Confirmation Handoff):** Provides the transactional foundation for warehouse keepers to retrieve items, stage quantities, and hand off physical stock to kitchen runners.

### Invariants & Non-Negotiable Boundaries
- **Physical Quantities Only:** All tables, RPCs, views, and policies handle strictly physical counts and decimal quantities (`numeric(12,3)`). Zero price, cost, valuation, tax, or vendor data exist anywhere in this domain.
- **Append-Only Stock Ledger Integrity:** Stock movements are never updated or deleted. Requisition line items record demand (`requested_qty`) and fulfillment (`issued_qty`); physical inventory decrements are appended to `t_stock_movements` in Flow C-2.
- **Window Discipline Without Operational Deadlock:** Requisitions submitted outside configured storeroom issue windows require a mandatory operational justification (`urgent_reason`) and are flagged `is_urgent = true`. Urgent requests are **accepted, never blocked**.
- **Edit/Cancel Hard Lock (Flow C-1):** Requesters can edit item quantities or cancel a requisition **only** while its status is `QUEUED`. Once a keeper initiates picking (`PICKING`), amendments and cancellations are permanently hard-locked at both the RPC and database trigger levels.

---

## 2. Relational Schema & Tables

### 2.1 `t_requests` (Requisition Header)
Captures the header-level metadata, urgency status, workflow state, and audit timestamps for a section stock request.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `request_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique requisition identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Restaurant store code (e.g., `IND-DEL-01`). |
| `section_id` | `text` | `NOT NULL CHECK (section_id IN ('KITCHEN', 'BAR', 'CHEESE'))` | Originating store section. |
| `requester_user_id` | `uuid` | `NOT NULL REFERENCES auth.users(id)` | Authenticated user who created the request. |
| `is_urgent` | `boolean` | `NOT NULL DEFAULT false` | Flag indicating urgent/off-window submission. |
| `urgent_reason` | `text` | `NULL` | Operational justification (mandatory when `is_urgent = true`). |
| `status` | `text` | `NOT NULL CHECK (status IN (...)) DEFAULT 'QUEUED'` | Current requisition lifecycle state. |
| `runner_user_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Kitchen runner confirming door collection. |
| `runner_confirmed_at` | `timestamptz` | `NULL` | Timestamp of runner door receipt confirmation. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Requisition submission timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Last state transition or modification timestamp. |

#### Constraints & Table Checks
- **`chk_urgent_reason`:** Enforces justification when urgency is active:
  ```sql
  CHECK ((is_urgent = false) OR (urgent_reason IS NOT NULL AND length(trim(urgent_reason)) > 0))
  ```
- **`status` CHECK constraint:** Restricts values to valid lifecycle states:
  `'QUEUED'`, `'PICKING'`, `'AWAITING_RUNNER'`, `'PARTIAL_ACCEPTED'`, `'PARTIAL_DECLINED'`, `'CANCELLED_BY_REQUESTER'`, `'URGENT_PENDING'`, `'CONFIRMED'`.

#### Indexes
- `idx_requests_store_section` on `(store_id, section_id)`
- `idx_requests_status` on `(status)`
- `idx_requests_requester` on `(requester_user_id)`
- `idx_requests_created_at` on `(created_at DESC)`
- `idx_requests_runner` on `(runner_user_id)`

---

### 2.2 `t_request_items` (Requisition Line Items)
Records individual material codes, requested quantities, staged issue quantities, and variance justifications.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `request_item_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique line item identifier. |
| `request_id` | `uuid` | `NOT NULL REFERENCES t_requests(request_id) ON DELETE CASCADE` | Parent requisition reference. |
| `item_code` | `text` | `NOT NULL REFERENCES m_items(item_code)` | Material item code (e.g., `ITM-CHZ-001`). |
| `requested_qty` | `numeric(12,3)` | `NOT NULL CHECK (requested_qty > 0)` | Quantity requested by section. |
| `issued_qty` | `numeric(12,3)` | `NULL CHECK (issued_qty >= 0)` | Quantity staged/issued by keeper. |
| `uom` | `text` | `NOT NULL` | Unit of measure (`kg` or `pcs`). |
| `variance_reason` | `text` | `NULL` | Explanation if issued quantity differs from requested. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Line item creation timestamp. |

#### Indexes
- `idx_request_items_request_id` on `(request_id)`
- `idx_request_items_item_code` on `(item_code)`

---

## 3. State Machine & Flow C-1 Lifecycle

### 3.1 Lifecycle State Transitions
```
               [Inside Window]           [Outside Window + Reason]
                      \                         /
                       v                       v
                    +-----------------------------+
                    |           QUEUED            | <----+ (Requester amends qty)
                    +-----------------------------+      |
                       /                       \         |
      (Requester      /                         \ (Keeper begins
       cancels)      v                           v picking)
+-------------------------+            +-----------------------------+
| CANCELLED_BY_REQUESTER  | (Terminal) |           PICKING           | [EDIT & CANCEL LOCKED]
+-------------------------+            +-----------------------------+
                                                      |
                                                      v (Keeper stages items)
                                       +-----------------------------+
                                       |       AWAITING_RUNNER       |
                                       +-----------------------------+
                                         /           |             \
                     (Runner accepts    /            |              \ (Runner declines
                      full quantity)   /             | (Partial)     \ all items)
                                      v              v                v
                              +---------------+ +------------------+ +------------------+
                              |   CONFIRMED   | | PARTIAL_ACCEPTED | | PARTIAL_DECLINED |
                              +---------------+ +------------------+ +------------------+
                                 (Terminal)          (Terminal)           (Terminal)
```

### 3.2 Flow C-1 Hard Lock Enforcement
Under Decision **CR-06** and Flow C-1 step `C8/C9`:
- **Allowed in `QUEUED`:** Requesters may edit quantities via `update_section_request` or cancel the requisition via `cancel_section_request`.
- **Locked in `PICKING` and beyond:** The moment a keeper calls `begin_request_picking`, the status transitions to `PICKING`. Any subsequent call to `update_section_request` or `cancel_section_request` immediately fails with an exception.
- **Defense in Depth (Table Triggers):**
  1. `tg_enforce_request_lock` on `t_requests`: Intercepts direct SQL updates attempting to transition to `CANCELLED_BY_REQUESTER` or alter store/section/urgency fields when status is not `QUEUED`.
  2. `tg_enforce_request_item_lock` on `t_request_items`: Intercepts direct SQL updates or deletes on items when parent request status is not `QUEUED`. Changes to `requested_qty`, `item_code`, or `uom` are rejected.

---

## 4. Issue Window Logic

### 4.1 Dual-Source Evaluation Architecture
The system evaluates whether an issue window is currently open via `public.is_store_issue_window_open(store_id, check_time)`:
1. **Developer / Test Override:** Checks `app.test_inside_window` session variable (`'true'` / `'false'`) to guarantee deterministic automated test runs.
2. **Store Custody State (`t_custody_logs`):** Checks the most recent custody event for the store. If the latest event is `WINDOW_UNLOCK`, the storeroom is physically open and active.
3. **Store Operational Configuration (`m_go_live_assignments`):** Compares the local time in India (`Asia/Kolkata`) against configured windows:
   - `morning_issue_window` (e.g., `'06:00-08:30'`)
   - `afternoon_issue_window` (e.g., `'14:30-16:00'`)

### 4.2 Standard vs. Urgent Submission Rules
- **Inside Window:**
  - Requester creates requisition without `urgent_reason`.
  - Requisition is flagged `is_urgent = false`, `urgent_reason = NULL`.
  - App queues standard request into storeroom picking list.
- **Outside Window:**
  - If submitted without `urgent_reason`: Requisition is rejected with SQL exception `Request is outside the active issue window. An urgent reason is required.`.
  - If submitted with `urgent_reason`: Flagged `is_urgent = true`, `urgent_reason` persisted.
  - Requisition is queued and **never blocked**, ensuring emergency kitchen operations continue uninterrupted.

---

## 5. Stored Procedures (Security Definer RPCs)

All RPCs execute under `SECURITY DEFINER SET search_path = public, auth, pg_temp` to ensure controlled elevation while strictly enforcing multi-tenant isolation and role segregation.

### 5.1 `create_section_request`
Submits a new section stock request with validated line items and evaluates window rules.

- **Signature:**
  ```sql
  public.create_section_request(
    p_store_id text,
    p_section_id text,
    p_items jsonb,
    p_urgent_reason text DEFAULT NULL
  ) RETURNS uuid
  ```
- **Authorization & Guards:**
  - **Role Check:** Caller must have `KITCHEN_REQ`, `BAR_REQ`, `CHEESE_REQ`, `ADMIN`, or `SYSTEM_ADMIN`. Non-requester roles (such as `VIEWER`, `RUNNER`, `ACCOUNTANT`) are rejected.
  - **Section Alignment:** Frontline requesters are constrained to their section (`KITCHEN_REQ` can only request for `KITCHEN`, `BAR_REQ` for `BAR`, `CHEESE_REQ` for `CHEESE`). `ADMIN` and `SYSTEM_ADMIN` may create for any section.
  - **Store Scope Check:** If `current_store_id()` is set, it must match `p_store_id`.
  - **Payload Validation:** `p_items` must be a non-empty JSON array. Each element requires valid `item_code` in `m_items` and `requested_qty > 0`. `uom` defaults to `m_items.base_uom` if omitted.
  - **Window Evaluation:** Applies `is_store_issue_window_open()`. Demands non-empty `p_urgent_reason` if outside window.

### 5.2 `update_section_request`
Amends line item quantities for an existing request (Flow C-1 Step C8/C9).

- **Signature:**
  ```sql
  public.update_section_request(
    p_request_id uuid,
    p_items jsonb
  ) RETURNS void
  ```
- **Authorization & Guards:**
  - **Ownership Check:** Caller must be the original `requester_user_id` or an administrator (`ADMIN`, `SYSTEM_ADMIN`).
  - **Status Guard:** Requisition must be in `QUEUED` status. Throws exception if status is `PICKING` or beyond.
  - **Payload Support:** Supports updating by `request_item_id` (matching TypeScript contract `updateRequestItemInputSchema`) or by `item_code`. Validates `requested_qty > 0`.

### 5.3 `cancel_section_request`
Cancels a requisition prior to picking (Flow C-1 Step C10).

- **Signature:**
  ```sql
  public.cancel_section_request(
    p_request_id uuid
  ) RETURNS void
  ```
- **Authorization & Guards:**
  - **Ownership Check:** Caller must be the original `requester_user_id` or an administrator (`ADMIN`, `SYSTEM_ADMIN`).
  - **Status Guard:** Requisition must be in `QUEUED` status. Throws exception if status is `PICKING` or beyond.
  - **State Transition:** Updates `status` to `CANCELLED_BY_REQUESTER` and `updated_at` to `now()`.

### 5.4 `begin_request_picking`
Transitions a queued request to picking status (Keeper handoff to Flow C-2).

- **Signature:**
  ```sql
  public.begin_request_picking(
    p_request_id uuid
  ) RETURNS void
  ```
- **Authorization & Guards:**
  - **Role Check:** Caller must have `ADMIN`, `CUSTODIAN`, or `SYSTEM_ADMIN`. Requesters, runners, and viewers cannot initiate picking.
  - **Status Guard:** Requisition must currently be in `QUEUED` status.
  - **State Transition:** Sets status to `PICKING`, locking all subsequent requester amendments.

---

## 6. Row Level Security (RLS) Policy Matrix

| Table | Operation | Target Role | Using / With Check Policy Expression |
| :--- | :--- | :--- | :--- |
| `t_requests` | `SELECT` | `authenticated` | `current_store_id() IS NULL OR store_id = current_store_id() OR has_role('SYSTEM_ADMIN') OR has_role('VIEWER') OR has_role('APPROVER')` |
| `t_requests` | `INSERT` | Requesters, Admin | Store scope match AND caller has role `KITCHEN_REQ`, `BAR_REQ`, `CHEESE_REQ`, `ADMIN`, or `SYSTEM_ADMIN` |
| `t_requests` | `UPDATE` | Requester (QUEUED only), Keepers, Runners, Admin | Store scope match AND (`(requester_user_id = auth.uid() AND status = 'QUEUED')` OR `has_role('ADMIN')` OR `has_role('CUSTODIAN')` OR `has_role('RUNNER')` OR `has_role('SYSTEM_ADMIN')`) |
| `t_requests` | `DELETE` | Admin | `has_role('SYSTEM_ADMIN')` (general users cannot delete; must cancel) |
| `t_request_items` | `SELECT` | `authenticated` | `EXISTS (SELECT 1 FROM t_requests r WHERE r.request_id = t_request_items.request_id AND (...store scope...))` |
| `t_request_items` | `INSERT` | Requesters, Admin | Parent request in store scope AND parent request `status = 'QUEUED'` AND authorized requester role |
| `t_request_items` | `UPDATE` | Requester, Keepers, Admin | Parent request in store scope AND (`(r.status = 'QUEUED' AND r.requester_user_id = auth.uid())` OR `has_role('ADMIN')` OR `has_role('CUSTODIAN')` OR `has_role('SYSTEM_ADMIN')`) |
| `t_request_items` | `DELETE` | Requester, Admin | Parent request in store scope AND parent request `status = 'QUEUED'` AND (`r.requester_user_id = auth.uid()` OR `has_role('ADMIN')` OR `has_role('SYSTEM_ADMIN')`) |

---

## 7. Audit & Segregation Verification

| Security & Workflow Principle | Implementation Mechanism |
| :--- | :--- |
| **Cross-Store Data Isolation** | Enforced by RLS on `store_id` matching `current_store_id()`. Users in `IND-DEL-02` cannot read or modify `IND-DEL-01` requests. |
| **Cross-Requester Isolation** | Requesters cannot edit or cancel requisitions submitted by another staff member, verified at both RLS and RPC layers. |
| **Section Segregation** | Frontline section requesters (`KITCHEN_REQ`, `BAR_REQ`, `CHEESE_REQ`) cannot submit requisitions for unauthorized sections. |
| **Audit Traceability** | `requester_user_id`, `created_at`, `updated_at`, `runner_user_id`, and `runner_confirmed_at` provide a tamper-evident audit trail without price or vendor contamination. |
