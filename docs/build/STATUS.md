# PROJECT STATUS REPORT — Pizza 4P's India Inventory Control Tool

**Version:** 1.0.0-RC (Release Candidate)  
**Date:** November 2026  
**Lead:** Orchestrator & Engineering Team  
**Scope:** Back-of-House Storeroom Physical Inventory Control System (Quantities Only)

---

## 1. Executive Summary & Verification Evidence

The system has been completely built across all 4 phases (Phase 0 Foundation, Phase 1 Database, Phase 2 Application, Phase 3 Hardening & Audit).

### Quantitative Verification Gates
1. **Price Leak Guard (`scripts/guard-price-leak.js`):**
   ```text
   ==> Running Price Leak Guard...
   ✅ Price Leak Guard passed: 0 forbidden words detected.
   ```
2. **TypeScript Strict Typecheck (`tsc --noEmit`):**
   `0 errors` — Clean compilation across all routes, contracts, and components.
3. **Automated Unit & Contract Test Suite (`npm test` via Vitest):**
   ```text
   ✓ tests/unit/sap_parser.test.ts (5 tests)
   ✓ tests/contracts/matrix.test.ts (216 tests)
   ✓ tests/contracts/oracle.test.ts (14 tests)
   ✓ tests/unit/audit.test.ts (25 tests)
   ✓ tests/unit/ledger.test.ts (7 tests)
   ✓ tests/unit/cron.test.ts (22 tests)
   ✓ tests/unit/invitations.test.ts (20 tests)
   Test Files  7 passed (7)
        Tests  309 passed (309)
   ```
4. **Next.js Production Build (`npm run build`):**
   `Compiled successfully in 2.9s` — Generated all 27 static and dynamic App Router routes without error.
5. **Database pgTAP Test Suites:**
   13 domain test suites + 4 adversarial attack suites (127 security assertions) covering RLS, immutability, and segregation of duties.

---

## 2. What Is Built per Operational Flow

| Flow | Operational Description | Schema & RPCs | Application Route | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **Flow 0** | Users, Roles, Lifecycle & Access Control | `0020_identity_permissions.sql`<br>`create_user_invitation`<br>`record_login_success` | `/login`<br>`/activate`<br>`/users` | `tests/unit/invitations.test.ts`<br>`0020_identity.sql`<br>`04_privilege_escalation.sql` |
| **Flow A-1** | Physical Receiving & QC Check | `0010_master_stores_warehouses.sql`<br>`0030_items_expiry_config.sql` | `/stores`<br>`/radar` | `0010_master.sql`<br>`0030_items.sql` |
| **Flow A-2** | SAP Ingestion, Staging & Inbound | `0120_sap_staging.sql`<br>`commit_grpo_import_batch`<br>`approve_grpo_correction` | `/import`<br>`/api/grpo/parse`<br>`/api/grpo/commit` | `tests/unit/sap_parser.test.ts`<br>`0120_sap.sql` |
| **Flow B** | Keep — Custodian & Issue Windows | `0070_custody_handover.sql`<br>`record_custody_event` | `/custody`<br>`/overview` | `0070_custody.sql`<br>`docs/build/db/custody.md` |
| **Flow C-1** | Section Stock Requisition & Urgent Flag | `0050_requests.sql`<br>`create_section_request`<br>`begin_request_picking` | `/request`<br>`/requests` | `0050_requests.sql`<br>`docs/build/db/requests.md` |
| **Flow C-2** | Two-Stage Issue & Runner Confirmation | `0060_issue_confirmation.sql`<br>`stage_issue`<br>`confirm_issue`<br>`decline_issue` | `/requests`<br>`/confirm`<br>`/issues` | `0060_issue.sql`<br>`tests/contracts/oracle.test.ts`<br>`tests/unit/ledger.test.ts` |
| **Flow D** | Daily Benchmark Closing Balance | `0080_daily_balance.sql`<br>`submit_daily_balance`<br>`sign_off_daily_balance` | `/balance`<br>`/api/cron/escalate-variances` | `0080_balance.sql`<br>`tests/unit/cron.test.ts` |
| **Flow E** | Custodian Shift Handover & Key Custody | `0070_custody_handover.sql`<br>`transfer_shift_custody` | `/custody` | `0070_custody.sql`<br>`docs/build/db/custody.md` |
| **Flow F** | Periodic Count & FC Adjustment | `0090_stock_count_reconcile.sql`<br>`initiate_stock_count`<br>`approve_stock_adjustment` | `/count` | `0090_count.sql`<br>`02_segregation_of_duties.sql` |
| **Flow G** | Waste, Returns & Store Transfers | `0100_transfers.sql`<br>`0110_waste_returns.sql`<br>`dispatch_store_transfer`<br>`log_waste_or_return` | `/transfers`<br>`/waste` | `0100_transfers.sql`<br>`0110_waste.sql` |
| **Flow H** | Store / Warehouse Proposal & Go-Live | `0130_approvals_inbox.sql`<br>`propose_store_or_warehouse`<br>`v_approval_inbox` | `/stores`<br>`/approvals` | `0130_approvals.sql`<br>`docs/build/db/approvals.md` |

---

## 3. Non-Negotiable Rules Audit

1. **Quantities Only:** Confirmed 0 occurrences of financial valuation, cost, purchase price, or vendor identities.
2. **Append-Only Ledger:** `t_stock_movements` is protected by `trg_prevent_ledger_mutation` trigger and DCL privilege revocation (`REVOKE UPDATE, DELETE, TRUNCATE`).
3. **Two-Stage Issue Mechanics:**
   - Worked Example 1 (Decline): Net delta = 0 kg.
   - Worked Example 2 (Full Confirm): Net delta = −5 kg.
   - Worked Example 3 (Partial Accept): Net delta = −3 kg.
   Proven by property tests in `tests/contracts/oracle.test.ts` and `tests/unit/ledger.test.ts`.
4. **Frontline Direct Path:** Frontline mobile and browser actions communicate directly with Supabase via RLS and PostgreSQL RPCs; a sleeping Node server cannot block the kitchen.
5. **Segregation of Duties:** Enforced in schema:
   - Counter $\ne$ Approver (`trg_enforce_stock_adjustment_sod`)
   - Dispatcher $\ne$ Receiver (`chk_transfer_distinct_users`)
   - Logger $\ne$ Approver (`chk_waste_distinct_users`)
   - Staging Keeper $\ne$ Runner Door Signer (`confirm_issue`)
   - Proposer $\ne$ Approver (`t_store_warehouse_approvals`)

---

## 4. Intentionally Out of Scope (Non-Goals)

- Purchase prices, inventory valuations, taxes, and vendor names (retained in SAP).
- POS integration and kitchen line prep stock (central storeroom control only).
- Recipe BOM processing and kitchen dish yields.
- Walk-in Freezers (excluded per Owner Decision Q9; can be proposed via Flow H).
- Mobile PWA / native offline IndexedDB queue (designed as the next follow-on phase; dispatcher seam preserved).

---

## 5. Owner Open Questions & Applied Assumptions

- **Q1 (Staff Without Corporate Email):** Lightweight company aliases (`runner.del01@example.test`) provisioned by System Admin.
- **Q2 (Variance Escalation Timing):** Evening close variances alert Restaurant Manager on Duty immediately; unresolved variances escalate to central Financial Controller next morning at 08:00 AM.
- **Q3 (SAP Line Number Column):** Implemented fallback compound key: `GRPO No. + Item Code + occurrence order inside document` with row-shift detection warning.
- **Q4 (GRPO Scope Filter):** Filtered at ingestion to inbound supplier purchase receipts only; store transfers use Flow G.
- **Q5 (SCM Late-Upload Digest):** Late uploads (> 1 working day) show operational warning badges without blocking ingestion.
- **Q6 (Evening Issue Protocol):** Handover evening key to Restaurant Manager on Duty via Flow E shift handover.
- **Q7 (Store Switcher Scope):** Single login with top-bar Store Switcher dropdown restricted to granted scopes in `m_user_permissions`.
- **Q8 (Runner & Requester Flexibility):** Section requester and runner can be the same person on quiet shifts, provided the runner profile matches the section. Staging keeper cannot confirm at the door.
- **Q9 (Core Storeroom Scope):** Ground-Floor Cold Rooms and Dry Stores only. Walk-in Freezers excluded from core v1.

---

## 6. Known Risks & Go-Live Checklist

1. **Free-Tier Inactivity Pause:** Supabase free-tier pauses databases after 7 days of inactivity. Configure scheduled cron hitting `/api/cron/keepalive` every 4–6 hours with `CRON_SECRET`.
2. **Scheduled Backups:** Configure external scheduler to trigger `/api/cron/backup` daily at 02:00 AM UTC.
3. **Outbound Mailer (SMTP):** In production, supply valid credentials in `.env.local` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). In development, the system uses the built-in in-memory dev-catcher.
4. **SAP Export Stability:** If SAP row order shifts between re-uploads of unposted GRPOs, the system logs a warning and quarantines key collisions. Request SAP administrator to add an explicit `LineNum` column in future SAP updates.

---

## 7. Commands to Run Everything

```bash
# 1. Install dependencies
npm install

# 2. Run Price Leak Guard
node scripts/guard-price-leak.js

# 3. Run Strict Typecheck
npm run typecheck

# 4. Run ESLint
npm run lint

# 5. Run Vitest Unit Tests
npm test

# 6. Run Production Build
npm run build

# 7. Start Production Server
npm start
```

---

## 8. Next Step Recommendation

The desktop web application, database layer, server routes, and hardening audits are 100% complete and passing all gates.  
The **Mobile / PWA phase (offline IndexedDB write queueing)** is ready to be initiated as the next dedicated project, building on top of the established `lib/actions/dispatch.ts` seam.
