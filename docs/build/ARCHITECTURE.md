# ARCHITECTURE — Pizza 4P's India Inventory Control Tool (Desktop Web v1)

## 1. System Overview & Partitioning Boundary

The application implements a strict two-tier execution split designed to prevent cloud cold starts or app server latency from disrupting restaurant kitchen operations.

```
+-------------------------------------------------------------------------------+
|                       Browser Client (Next.js Desktop Web)                    |
|   - Hand-written CSS (tokens from ui-design/desktop/index.html)               |
|   - Role-aware Navigation & Store Switcher                                    |
|   - Client Dispatcher Seam (lib/actions/dispatch.ts)                          |
+-----------------------+-------------------------------+-----------------------+
                        |                               |
          [Direct Browser-to-Database]            [Server Actions / Routes]
          High-frequency frontline writes         Heavy, background, or mail ops
          (Request, Stage, Confirm, Count,       (SAP GRPO xlsx parse, mail invite,
           Balance, Waste, Transfer)              cron DB backup, keep-alive ping)
                        |                               |
                        v                               v
+-----------------------------------------------+ +-----------------------------+
|              Supabase / PostgreSQL            | |       Next.js Node Server   |
|   - Supabase Auth (auth.users)                | |   (runtime = 'nodejs')      |
|   - Row-Level Security (Role + Scope)         | |   - app/api/grpo/parse      |
|   - Stored Procedures (RPC, SECURITY DEFINER) | |   - app/api/invitations     |
|   - Append-Only Ledger (t_stock_movements)    | |   - app/api/cron/*          |
|   - Derived Views (v_stock_current, FIFO)     | |   - Structured audit logger |
+-----------------------------------------------+ +-----------------------------+
```

### 1.1 Frontline Direct Path (Browser -> Supabase)
- **High-frequency operations:**
  - Section Stock Request (Flow C-1)
  - Pick & Stage Stock (Flow C-2)
  - Door Confirm / Decline / Partial Accept (Flow C-2)
  - Daily Benchmark Count & Balance Sign-off (Flow D)
  - Periodic Stock Count & Recount (Flow F)
  - Waste Disposal & Supplier Return Logging (Flow G)
  - Store Transfer Dispatch & Receipt (Flow G)
- **Mechanism:** Client invokes Supabase PostgreSQL RPC functions (`supabase.rpc(...)`) or direct queries filtered by Row-Level Security (RLS).
- **Authentication:** Supabase Auth JWT. Every request passes user JWT containing `sub` (user_id).
- **Enforcement:** Role and Scope (`store_id`, `warehouse_id`, `section_id`) are evaluated inside PostgreSQL via `current_scope()` and `has_role()` helper functions.
- **Resilience:** The kitchen never waits for Node.js cold starts.

### 1.2 Node Server Path (`runtime = 'nodejs'`)
- **Restricted strictly to:**
  1. `app/api/invitations`: Dispatching activation links and password resets via SMTP adapter (with rate-limiting and audit log to `t_security_logs`).
  2. `app/api/grpo/parse`: Streaming `.xlsx` upload, detecting header on Row 1, verifying 27 columns, **dropping all 7 price/tax/vendor-name columns on the server before staging**, generating compound keys (`GRPO No. + Item Code + occurrence`), staging errors to `t_grpo_staging_errors`.
  3. `app/api/cron/*`: External cron-triggered endpoints protected by a bearer shared secret:
     - Daily database dump to cloud storage bucket
     - Keep-alive ping (preventing free-tier DB pause)
     - Morning unresolved closing variance escalation digest
     - Weekly late SAP upload summary digest
- **Cold-Start Defense:** If a user triggers a server endpoint and it takes >1.5s, the UI displays: `"Server waking up, please wait a moment..."`.

---

## 2. Database Architectural Guarantees

### 2.1 Append-Only Immutable Stock Ledger
- Table: `t_stock_movements`.
- **Absolute Immutability:**
  - `REVOKE UPDATE, DELETE ON t_stock_movements FROM PUBLIC, authenticated, service_role;`
  - PostgreSQL `BEFORE UPDATE OR DELETE` trigger `tg_prevent_movement_mutation` raises exception: `Stock movements are append-only and cannot be updated or deleted`.
  - No ORM method or RPC exposes mutation or deletion of this table.
- **Derived Inventory View:**
  - Current stock is never stored as an editable column.
  - View `v_stock_current` computes:
    ```sql
    Sum(CASE 
      WHEN movement_type = 'GRPO_IMPORT' THEN quantity
      WHEN movement_type = 'ISSUE_PENDING' THEN quantity            -- negative
      WHEN movement_type = 'ISSUE_PENDING_OFFSET' THEN quantity     -- positive
      WHEN movement_type = 'ISSUE_CONFIRMED' THEN quantity          -- negative
      WHEN movement_type = 'ISSUE_REVERSAL' THEN quantity           -- positive
      WHEN movement_type = 'WASTE_DISPOSAL' THEN quantity           -- negative
      WHEN movement_type = 'SUPPLIER_RETURN' THEN quantity          -- negative
      WHEN movement_type = 'TRANSFER_OUT_INTRANSIT' THEN quantity   -- negative
      WHEN movement_type = 'TRANSFER_IN_RECEIVED' THEN quantity     -- positive
      WHEN movement_type = 'COUNT_ADJUSTMENT' THEN quantity         -- signed (+/-)
      ELSE 0 END) AS book_stock
    FROM t_stock_movements
    GROUP BY store_id, warehouse_id, item_code;
    ```
- **Two-Stage Issue Mechanics (Doc §4.1):**
  1. *Admin picks & stages:* appends `ISSUE_PENDING` (`-Q`). Available book stock drops immediately.
  2. *Runner confirms at door:*
     - Full acceptance: appends `ISSUE_PENDING_OFFSET` (`+Q`) and `ISSUE_CONFIRMED` (`-Q`).
     - Rejection: appends `ISSUE_REVERSAL` (`+Q`).
     - Partial acceptance (e.g. 3 of 5 kg): appends `ISSUE_PENDING_OFFSET` (`+5`), `ISSUE_CONFIRMED` (`-3`). Net effect: `-3 kg` deducted from storeroom, 2 kg remains on shelf.

### 2.2 Security Definer RPCs
- Every mutating business transaction is wrapped in a PostgreSQL function defined with:
  - `SECURITY DEFINER`
  - `SET search_path = public, pg_temp`
  - Explicit authorization check: verifies caller's role, store scope, and warehouse scope.
  - Transaction atomicity: failure at any step aborts the entire transaction.

### 2.3 Segregation of Duties Enforced in DB
- Counter cannot approve count adjustment:
  `CHECK (counter_user_id != approver_user_id)` inside `t_stock_adjustments` RPC.
- Logger cannot approve waste disposal:
  `CHECK (logged_by_user_id != approver_user_id)` inside `t_waste_returns_log` RPC.
- Transfer dispatcher cannot approve transit variance:
  `CHECK (dispatcher_user_id != fc_approval_id)` inside `t_transfer_intransit` RPC.
- Only `SYSTEM_ADMIN` role can execute user invitation / creation RPC.
- Accounts with `APPROVER` role require independent second approval before activation token is issued.

---

## 3. Client Architecture & Dispatcher Seam

### 3.1 Client Dispatcher (`lib/actions/dispatch.ts`)
- All frontline mutations pass through `dispatchAction(actionName, payload)`.
- **Anti-Looping Rule:**
  - If an action fails (network drop or constraint error), it logs once to `t_security_logs` (or local error log).
  - It **never auto-retries in an infinite loop**.
  - Returns `{ success: false, error: message, canRetry: true }`.
  - The UI renders a prominent manual **Retry** button.
- **Seam for Future PWA / Mobile:**
  - In Phase 2, `dispatch.ts` invokes Supabase RPC directly.
  - In the future mobile phase, `dispatch.ts` will seamlessly intercept offline requests into `IndexedDB` without changing any page component.

### 3.2 Design System & Styling
- Hand-written CSS located in `styles/` ported directly from `ui-design/desktop/index.html`.
- Global CSS tokens in `:root`:
  - Colors: `--navy: #242E52`, `--blue: #02499D`, `--cream: #F4F2EF`, `--sand: #EAE6DC`, `--rule: #DDD6C5`, `--paper: #FFFFFF`, `--terra: #A9581A`, `--forest: #28473D`, `--err: #B32E16`, `--amber: #7A4B00`, `--amber-bg: #FBEFD0`.
  - Typography: `--mono: "IBM Plex Mono"`, `--disp: "Archivo Narrow"`, `--body: "Be Vietnam Pro"`, `--serif: "Noto Serif Display"`.
- UI Components:
  - Ticket paper: `.tk`, `.perf`, `.tk-head`
  - Top rail: `.rail`, `.logo`, store switcher `.sw`, user badge `.who`
  - Badges and stamps: `.b.ok`, `.b.am`, `.b.er`, `.b.ur`, `.stamp`
  - Interactive elements: `.btn`, `.chip`, `.step` (quantity steppers)
  - Tables: dense, monospace figures, tabular numbers (`font-variant-numeric: tabular-nums`)
- Accessibility: Focus rings (`:focus-visible`), WCAG AA contrast (≥4.5:1), screen-reader labels, keyboard operability (`tabindex`, enter/space triggers).

---

## 4. Confidentiality & Zero-Price Enforcement

- **Strict Exclusion:** The words `Price`, `Total Tax`, `Net Tax Amount`, `Row Total`, `Gross Total`, `Vendor Name`, `Vendor Address` are banned from:
  - Database schema and column names
  - RPC signatures and return shapes
  - TypeScript types and Zod contracts
  - Client state and API response payloads
  - Seed fixtures and log statements
- **Verification Guard:** `scripts/guard-price-leak.sh` (and Node counterpart) scans the codebase and fails CI if any forbidden word appears outside of SAP raw parser allowlist drop definitions.
