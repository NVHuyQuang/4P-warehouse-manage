# RUNBOOK — Pizza 4P's India Inventory Control Tool

This operational runbook provides step-by-step instructions for local development setup, testing, database migrations, configuration, scheduled maintenance, and backup/restore procedures.

---

## 1. System Requirements & Environment

- **Node.js:** v18.17+ or v20+ (Node v22+ supported)
- **Package Manager:** `npm` (npm v9+)
- **Database:** PostgreSQL v15+ via Supabase CLI (or remote Supabase project)
- **Docker:** Required for local Supabase emulator (`supabase start`)

### Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL`: Local (`http://127.0.0.1:54321`) or remote Supabase API URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Client public anonymous key for browser RLS calls.
- `SUPABASE_SERVICE_ROLE_KEY`: Admin key used strictly in server route handlers and migrations.
- `CRON_SECRET`: Shared secret header required for `/api/cron/*` endpoints (`Authorization: Bearer <CRON_SECRET>`).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: SMTP outbound credentials (defaults to in-memory dev-catcher if unset in non-production).

---

## 2. Installation & Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Verify Codebase & Non-Negotiable Guards:**
   ```bash
   # Run Price Leak Guard (prohibits any commercial valuation terms)
   node scripts/guard-price-leak.js

   # Run TypeScript strict typecheck
   npm run typecheck

   # Run ESLint
   npm run lint

   # Run Vitest test suites (contracts, oracle, unit tests)
   npm test
   ```

3. **Start Next.js Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your desktop browser.

---

## 3. Database Management & Migrations

All SQL schema definitions live in `supabase/migrations/` ordered deterministically from `0001` to `0130`:

- `0001_extensions_roles_helpers.sql`: Extensions, role types, helper functions.
- `0010_master_stores_warehouses.sql`: Store and warehouse master data.
- `0020_identity_permissions.sql`: Users, permissions, security logs, 2nd approval.
- `0030_items_expiry_config.sql`: Item catalog, expiry rules, UoM conversions.
- `0040_ledger_core_views.sql`: Append-only `t_stock_movements`, current stock views.
- `0050_requests.sql`: Flow C-1 Section requisitions and issue window enforcement.
- `0060_issue_confirmation.sql`: Flow C-2 Two-stage stock issue and confirmation RPCs.
- `0070_custody_handover.sql`: Flow B/E Storeroom lock/unlock custody and shift handover.
- `0080_daily_balance.sql`: Flow D Daily benchmark closing balance reconciliation.
- `0090_stock_count_reconcile.sql`: Flow F Periodic cycle count and FC adjustments.
- `0100_transfers.sql`: Flow G Inter-store dual-unit transfers and transit variances.
- `0110_waste_returns.sql`: Flow G Waste disposal and supplier returns.
- `0120_sap_staging.sql`: Flow A-2 SAP GRPO file ingestion staging and compound line keys.
- `0130_approvals_inbox.sql`: Unified `v_approval_inbox` across 6 operational domains.

### Reset & Run Migrations (Local Supabase):
```bash
bash scripts/db-reset.sh
```

### Run pgTAP Database Unit Tests:
```bash
supabase test db
```

---

## 4. Maintenance & Background Cron Jobs

All cron routes live under `/api/cron/*` and require the HTTP header:
`Authorization: Bearer <CRON_SECRET>`

### 4.1 Keep-Alive Ping (`/api/cron/keepalive`)
- **Purpose:** Prevents Supabase free-tier project from pausing after 7 days of inactivity.
- **Frequency:** Every 4 to 6 hours.
- **Action:** Executes lightweight query and records `KEEPALIVE_PING` to `t_security_logs`.

### 4.2 Daily Backup Snapshot (`/api/cron/backup`)
- **Purpose:** Exports immutable metadata manifest and critical ledger transaction summaries to Supabase storage bucket `backups`.
- **Frequency:** Daily at 02:00 AM UTC.
- **Action:** Generates JSON manifest with row counts and integrity hashes.

### 4.3 Morning Variance Escalation (`/api/cron/escalate-variances`)
- **Purpose:** Gathers unresolved and unexplained evening storeroom closing variances.
- **Frequency:** Daily at 08:00 AM local store time.
- **Action:** Dispatches summary notification digest to Financial Controller (FC).

---

## 5. Non-Negotiable Operational Rules

1. **Quantities Only:** Zero financial cost, purchase price, or commercial valuation is stored or rendered.
2. **Append-Only Ledger:** Historical rows in `t_stock_movements` are immutable. Stock is dynamically derived.
3. **Segregation of Duties:** Counters cannot approve adjustments; Dispatchers cannot receive shipments; Loggers cannot approve waste claims.
4. **Frontline Direct Path:** Kitchen and storeroom transactions go direct browser to database via RLS and PostgreSQL RPCs.
