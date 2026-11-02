# FILE OWNERSHIP MATRIX — Pizza 4P's India Inventory Control Tool

## Rule of Ownership
1. **Single Owner:** Every directory and file is owned by exactly ONE agent per wave.
2. **Strict Isolation:** Agents may read across the workspace, but may write **only** to their owned paths. Writing to unowned files results in immediate PR/branch rejection.
3. **Merge Ordering:** The Lead merges worktree branches sequentially in dependency order and re-runs gates.

---

## Phase 0: Foundation

| Agent ID | Agent Role | Owned Paths / Files | Prohibited Paths |
| :--- | :--- | :--- | :--- |
| **Lead** | Orchestrator | `docs/build/*`, `package.json` (initial setup), `tsconfig.json` | Any feature implementation code |
| **P0-A** | Scaffold & Design System | `styles/*`, `app/layout.tsx`, `app/globals.css`, `components/ui/*` (shell, rail, ticket, chips, badges, toast, store switcher, dev role switcher), `public/pizza4ps-logo.svg` | `supabase/*`, `lib/contracts/*`, `lib/testing/*` |
| **P0-B** | Supabase Foundation | `supabase/config.toml`, `supabase/migrations/0001_foundation.sql`, `scripts/db-reset.sh`, `scripts/guard-price-leak.sh` | `app/*`, `styles/*`, `lib/contracts/*` |
| **P0-C** | Contracts & RBAC | `lib/contracts/*` (zod schemas + TS types), `lib/rbac/matrix.ts`, `tests/contracts/*` | `styles/*`, `supabase/*`, `app/*` |
| **P0-D** | Test & Fixture Harness | `lib/testing/*` (synthetic seed generator, `ledger-oracle.ts`), `tests/fixtures/*`, `playwright.config.ts`, `vitest.config.ts` | `lib/contracts/*`, `styles/*`, `supabase/migrations/*` |

---

## Phase 1: Database (Migrations, RLS, RPC, pgTAP Tests)

| Agent ID | Domain | Migration & RPC Files | Test & Doc Files |
| :--- | :--- | :--- | :--- |
| **D1** | Master: Stores & Warehouses | `supabase/migrations/0010_master_stores_warehouses.sql` | `supabase/tests/0010_master.sql`, `docs/build/db/master.md` |
| **D2** | Identity, Permissions & Auth | `supabase/migrations/0020_identity_permissions.sql` | `supabase/tests/0020_identity.sql`, `docs/build/db/identity.md` |
| **D3** | Item Master & Expiry Config | `supabase/migrations/0030_items_expiry_config.sql` | `supabase/tests/0030_items.sql`, `docs/build/db/items.md` |
| **D4** | **Ledger Core & Current Stock** | `supabase/migrations/0040_ledger_core_views.sql` | `supabase/tests/0040_ledger.sql`, `docs/build/db/ledger.md` |
| **D5** | Requests (Flow C-1) | `supabase/migrations/0050_requests.sql` | `supabase/tests/0050_requests.sql`, `docs/build/db/requests.md` |
| **D6** | Issue & Confirmation (Flow C-2)| `supabase/migrations/0060_issue_confirmation.sql` | `supabase/tests/0060_issue.sql`, `docs/build/db/issue.md` |
| **D7** | Custody & Handover (Flow B, E) | `supabase/migrations/0070_custody_handover.sql` | `supabase/tests/0070_custody.sql`, `docs/build/db/custody.md` |
| **D8** | Daily Balance (Flow D) | `supabase/migrations/0080_daily_balance.sql` | `supabase/tests/0080_balance.sql`, `docs/build/db/balance.md` |
| **D9** | Physical Count & Adjustment (F)| `supabase/migrations/0090_stock_count_reconcile.sql` | `supabase/tests/0090_count.sql`, `docs/build/db/count.md` |
| **D10** | Store Transfers (Flow G) | `supabase/migrations/0100_transfers.sql` | `supabase/tests/0100_transfers.sql`, `docs/build/db/transfers.md` |
| **D11** | Waste & Supplier Returns (Flow G)| `supabase/migrations/0110_waste_returns.sql` | `supabase/tests/0110_waste.sql`, `docs/build/db/waste.md` |
| **D12** | SAP Ingestion Staging (Flow A-2)| `supabase/migrations/0120_sap_staging.sql` | `supabase/tests/0120_sap.sql`, `docs/build/db/sap.md` |
| **D13** | Approvals Inbox & Workflow (H) | `supabase/migrations/0130_approvals_inbox.sql` | `supabase/tests/0130_approvals.sql`, `docs/build/db/approvals.md` |
| **D14** | **Adversarial RLS & Attack Suite** | (Read-only on migrations; writes test suite) | `supabase/tests/adversarial/*`, `docs/build/db/adversarial.md` |

---

## Phase 2: Application (UI Routes, Client Data Wrappers, Server Handlers)

### Frontend Feature Agents (F1 to F20)
*Each feature agent owns its `app/<route>`, components under `components/<route>`, client data wrapper under `lib/data/<domain>.ts`, and e2e test under `tests/e2e/<route>.spec.ts`.*

- **F1 Auth & Session:** `app/login/*`, `app/activate/*`, `app/reset-password/*`, `lib/auth/*`, `tests/e2e/auth.spec.ts`
- **F2 Nav & Guards:** `components/navigation/*`, `lib/rbac/guard.ts`, `tests/e2e/navigation.spec.ts`
- **F3 Stock Overview:** `app/overview/*`, `components/overview/*`, `lib/data/overview.ts`, `tests/e2e/overview.spec.ts`
- **F4 New Request:** `app/request/*`, `components/request/*`, `lib/data/requests.ts`, `tests/e2e/request.spec.ts`
- **F5 Pick Queue:** `app/requests/*` (pick queue), `components/requests/*`, `tests/e2e/pick_queue.spec.ts`
- **F6 Issues & Ledger:** `app/issues/*`, `components/issues/*`, `lib/data/ledger.ts`, `tests/e2e/issues.spec.ts`
- **F7 Runner Confirm:** `app/confirm/*`, `components/confirm/*`, `tests/e2e/confirm.spec.ts`
- **F8 Daily Balance:** `app/balance/*`, `components/balance/*`, `lib/data/balance.ts`, `tests/e2e/balance.spec.ts`
- **F9 Periodic Count:** `app/count/*`, `components/count/*`, `lib/data/count.ts`, `tests/e2e/count.spec.ts`
- **F10 Transfers:** `app/transfers/*`, `components/transfers/*`, `lib/data/transfers.ts`, `tests/e2e/transfers.spec.ts`
- **F11 Waste & Returns:** `app/waste/*`, `components/waste/*`, `lib/data/waste.ts`, `tests/e2e/waste.spec.ts`
- **F12 SAP Import UI:** `app/import/*`, `components/import/*`, `lib/data/import.ts`, `tests/e2e/import.spec.ts`
- **F13 Approvals Inbox:** `app/approvals/*`, `components/approvals/*`, `lib/data/approvals.ts`, `tests/e2e/approvals.spec.ts`
- **F14 Users & Access:** `app/users/*`, `components/users/*`, `lib/data/users.ts`, `tests/e2e/users.spec.ts`
- **F15 Stores & Warehouses:** `app/stores/*`, `components/stores/*`, `tests/e2e/stores.spec.ts`
- **F16 Master Data Admin:** `app/master/*`, `components/master/*`, `tests/e2e/master.spec.ts`
- **F17 Custody & Windows:** `app/custody/*`, `components/custody/*`, `tests/e2e/custody.spec.ts`
- **F18 Reorder & Expiry Radar:** `app/radar/*`, `components/radar/*`, `tests/e2e/radar.spec.ts`
- **F19 Viewer / Audit Mode:** `app/reports/*`, `components/reports/*`, `tests/e2e/reports.spec.ts`
- **F20 System Admin Ops:** `app/ops/*`, `components/ops/*`, `tests/e2e/ops.spec.ts`

### Server Routes & Cross-Cutting
- **S1 Mail & Invites:** `app/api/invitations/*`, `lib/email/*`
- **S2 SAP Stream Parser:** `app/api/grpo/*`, `lib/sap/*`, `tests/unit/sap_parser.test.ts`
- **S3 Cron Jobs:** `app/api/cron/*`, `lib/cron/*`
- **S4 Audit Logging:** `lib/audit/*`, `lib/logger/*`
- **X1 Seed & Fixtures:** `scripts/seed-demo-data.ts`, `lib/testing/seed-data.ts`
- **X2 Global UI Hardening:** `components/ui/toasts.tsx`, `app/not-found.tsx`, `app/error.tsx`
- **X3 Runbook & Setup:** `docs/build/RUNBOOK.md`
- **X4 CI Workflow:** `.github/workflows/ci.yml`
- **X5 Visual Baselines:** `tests/visual/*`, `docs/build/shots/*`

---

## Phase 3: Hardening (Read-Only Reviewers + Dedicated Fixers)
- Reviewers **H1 to H12** have zero write access to code files. They produce report files in `docs/build/audit/<hx>.md`.
- Fixers work on isolated, dedicated branches only after review findings are Triaged by Lead.
