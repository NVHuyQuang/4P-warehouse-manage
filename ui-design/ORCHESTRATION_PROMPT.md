# ORCHESTRATION PROMPT — Build the Inventory Control Tool (Next.js), end to end

Paste everything below the line into a fresh Claude Code session opened in `D:\workspace\help\Duong\warehouse management tools\warehouse management tools`. Use the strongest model for the lead session. Subagents may run on a cheaper model where the brief says "mechanical".

---

## ROLE

You are the **Lead Engineer / Orchestrator** for Pizza 4P's India "Inventory Control Tool". You do not write most of the code. You plan, freeze contracts, spawn subagents in parallel waves (**at most 50 running at once; use as many as the dependency graph honestly allows, never more than can be verified**), merge their work in dependency order, run the gates, and report. You are accountable for the final system working, not for agents having finished.

## SOURCES OF TRUTH (read in this order before planning)

1. `docs/HANDOVER_SESSION_1.md` — decisions, SAP facts, risks, working rules.
2. `docs/INVENTORY-TOOL-FLOW.md` (v1.6) — roles (§1), master data (§2), flows 0/A-1/A-2/B/C-1/C-2/D/E/F/G/H (§3), derivation formulas (§4), 24-table data model (§5), open questions (§6), safeguards (§8). Flow charts: `docs/flows/*.mmd` are authoritative over prose.
3. `ui-design/desktop/index.html` — the approved desktop prototype (10 screens, 8 roles). **Visual and behavioural spec.** Screenshots in `ui-design/desktop/shots/`. Style reference app: `D:\workspace\4P-knowledge-hub` (read-only; never open any `.env*` file there or anywhere).
4. `ui-design/spec.md`, `ui-design/directions.md`, `ui-design/direction-approved.md`.

If sources conflict: flows `.mmd` > doc §5 data model > doc prose > prototype copy. Record every conflict you resolve in `docs/build/DECISIONS.md` with the reason.

## NON-NEGOTIABLE RULES (violating any is a failed build)

1. **Quantities only.** No price, cost, valuation, tax, or vendor-name column, field, API property, log line, or seed value anywhere. SAP import drops `Price, Total Tax, Net Tax Amount, Row Total, Gross Total, Vendor Name, Vendor Address` **on the server before staging**. A CI check greps schema, types, fixtures and responses for these words and fails the build.
2. **Append-only ledger.** `t_stock_movements` has no UPDATE/DELETE path: privileges revoked, trigger raising on update/delete, no ORM method that updates it. Stock is always *derived* (view/function), never stored or edited. Corrections are new offsetting rows.
3. **Two-stage issue** exactly as doc §4.1: `ISSUE_PENDING` (−Q) → confirm: `ISSUE_PENDING_OFFSET` (+Q) and `ISSUE_CONFIRMED` (−accepted) → decline/partial: reversal for the rest. Worked examples 1–3 in §4.1 are mandatory test cases.
4. **Role + Scope enforced in the database (RLS + RPC), not only in the UI.** Frontline actions (request, stage/issue, confirm, count, balance) go **browser → Supabase (RLS)**, never through a Next.js server route, so a sleeping app server cannot block the kitchen. Next.js server code is limited to: user invitation email + password reset, SAP GRPO file parsing/validation/staging, cron jobs (backup export, keep-alive, escalation digests). Do not "simplify" this split.
5. **Segregation of duties in the DB:** whoever logs cannot approve the same record (waste, count adjustment, transfer variance); only `SYSTEM_ADMIN` creates users; `APPROVER` accounts need a second independent approval before activation. Enforced by constraints/RPC checks and covered by tests.
6. **Never auto-retry forever.** Failed action → log once to `t_security_logs`/error table → manual retry. Route all frontline writes through one client dispatcher module (`lib/actions/dispatch.ts`) so the phone phase can later add the IndexedDB offline queue without touching screens.
7. Values marked **[Owner to set]** (windows, thresholds, par, lockout, expiry days, ADU window N, backup frequency) live in config/master tables with clearly labelled sample seeds — never hard-coded constants.
8. **Privacy:** staff accounts are personal data (India DPDP Act; also respect Vietnam PDPD and GDPR where relevant). No real names/emails/phone numbers anywhere: seed users are role-titled synthetic accounts on `@example.test`. Passwords only via Supabase Auth (no app-level password hashes; resolve doc §J.3 by omitting `password_hash`/`failed_login_count` from public `m_users`). Remove `UNIQUE` from `t_grpo_imports.file_hash` (doc §J.4). Surface a DPDP/retention note in `docs/build/COMPLIANCE.md`; do not invent legal conclusions.
9. **Honesty rule from the owner:** no agent or lead may say "fixed/done" without quoting real command output (test run, grep, SQL result, screenshot path). "Looks fine" is not evidence.
10. Do not read, print or commit secrets. `.env.example` only. Never touch `D:\workspace\4P-knowledge-hub`.

## TARGET STACK (decided; do not re-litigate)

- **Next.js (latest stable, App Router), TypeScript strict**, React Server Components where they help, client components for interactive tables/forms.
- **Supabase**: Postgres + Auth + RLS + Storage (photo evidence, backups bucket). Local dev with Supabase CLI (docker) so everything is testable offline. SQL migrations are the single source of truth (`supabase/migrations/*.sql`) — no second migration system.
- Business rules as **Postgres functions (RPC)** with `SECURITY DEFINER` + explicit role/scope checks + `search_path` pinned; the client calls RPCs for every ledger-writing action.
- Styling: **hand-written CSS with the prototype's tokens** (`:root` palette, ticket paper, mono labels, serif display) in `styles/`. No Tailwind, no component-library look. Reuse the prototype's markup patterns.
- Validation: `zod` schemas shared between forms, RPC argument builders and server routes (`lib/contracts/`).
- Tests: `vitest` (unit/contract), SQL tests via `supabase test db` (pgTAP) for RLS and ledger invariants, `playwright` e2e. Lint: eslint + `tsc --noEmit`.
- SAP file parsing: `exceljs` or `xlsx` in a Next.js route handler/server action (`runtime = 'nodejs'`), `.xlsx` header row 1, 27 columns, date `dd.mm.yyyy`.
- Cron: Next.js route handlers triggered by an external scheduler with a shared-secret header (documented), or Supabase scheduled functions; pick one in `DECISIONS.md`.
- English UI v1. Desktop web first. Mobile/PWA/offline queue is **out of scope now** — keep the dispatcher seam, responsive CSS is not required.

## NON-GOALS (say no to these)

Prices/valuation, POS, recipe/BOM yields, kitchen line stock, walk-in freezers (Q9), real SAP API integration (file import only), multi-language, native apps, analytics beyond the doc's formulas, any feature not in the flows or prototype.

## OWNER-OPEN QUESTIONS (design for both answers; do not decide silently)

Q1 staff without email (assume company alias emails), Q2 variance escalation timing, Q3 SAP `LineNum` column (implement compound-key fallback `GRPO No. + Item Code + occurrence order` + row-order-shift warning), Q4 GRPO scope filter, Q5 SCM late-upload digest, Q6 evening issue when Admin left (render C26 as a clearly pending, owner-defined step, not invented behaviour), Q7 store switcher scope. List each with your assumption in `docs/build/OPEN_QUESTIONS.md`.

---

## PHASE PLAN

Concurrency cap: 50. Real parallelism is bounded by dependencies, so waves are sized by what can truly run without touching the same files. Never start a wave before its gate passes. Never let two agents own the same file.

### Phase 0 — Foundation (you + 4 agents, ~parallel)

You (lead) first write and freeze, in `docs/build/`:
- `ARCHITECTURE.md` (layers, request paths, who may call what),
- `CONTRACTS.md` (enum values, role×action matrix as data, movement_type list and signs, status machines for requests/issues/counts/transfers/imports/approvals),
- `FILE_OWNERSHIP.md` (every directory → exactly one owning agent per wave),
- `AGENT_BRIEF_TEMPLATE.md`.
Then spawn in parallel (git worktree each, branch `p0/<name>`):
- **P0-A scaffold + design system:** Next.js app, tsconfig strict, eslint, vitest/playwright config, `styles/` tokens + primitives ported from the prototype (rail, ticket, chips, tables, buttons, drawer, toast bottom-right), app shell with role-aware nav + store switcher + "View as" dev-only switcher (disabled in production build), logo from `ui-design/desktop/pizza4ps-logo.svg`.
- **P0-B supabase foundation:** `supabase init`, local config, migration `0001_extensions_roles_helpers.sql` (helper functions `current_scope()`, `has_role()`, immutable-ledger helper), CI-friendly `scripts/db-reset`, price-word guard script.
- **P0-C contracts:** `lib/contracts/*.ts` zod + TS types generated from `CONTRACTS.md`; `lib/rbac/matrix.ts` encoding doc §1.3 exactly; unit tests that the matrix equals the doc table.
- **P0-D test + fixture harness:** synthetic seed generator (role-titled users, 2 stores, cold/dry rooms, 20 items, lots), Playwright auth helpers per role, a `lib/testing/ledger-oracle.ts` that re-derives stock from rows independently (used by every later test).

**Gate 0:** `npm run lint && npm run typecheck && npm test` green; `supabase db reset` green; app boots and shows the shell for every role; matrix test equals doc. Quote outputs.

### Phase 1 — Database (up to 14 agents in parallel; each owns its own migration file(s) + its own SQL test file)

Number migrations by domain so ordering is deterministic. Each agent delivers: tables/constraints/indexes, RLS policies for **every** table, RPC functions for its writes, pgTAP tests covering allowed/denied per role, and a `docs/build/db/<domain>.md` of 1 page.
- D1 master: `m_stores, m_warehouses, m_go_live_assignments` (+ store-switcher view)
- D2 identity: `m_users` (no password cols), `m_user_invitations`, `m_user_permissions`, `t_security_logs`, lockout counters via Supabase Auth hooks/functions, second-approval rule for APPROVER
- D3 item master: `m_items, m_expiry_tracking_config, m_reorder_rules, m_uom_conversions`
- D4 **ledger core:** `t_stock_movements` immutability, `v_stock_current`, per-lot FIFO view, expiry radar view, reorder suggestion function (doc §4.4–4.5), ADU function. Property tests vs `ledger-oracle`.
- D5 requests (C-1): `t_requests, t_request_items`, window logic (inside → standard, outside → reason + URGENT), edit/cancel lock once picking started
- D6 issue (C-2): RPCs `stage_issue`, `confirm_issue`, `decline_issue`, partial accept; blocked/expired lot rules; §4.1 examples 1–3 as pgTAP tests
- D7 keep + handover (B, E): `t_custody_logs, t_shift_custody_logs`, issue-window config
- D8 daily balance (D): `t_daily_balances(+items)`, expected formula, variance flow, escalation fields
- D9 count (F): `t_stock_counts(+items), t_stock_adjustments`, freeze state on warehouse, FC-only approval, counter≠approver
- D10 transfers (G): `t_transfer_intransit`, dual-unit rule, variance → FC
- D11 waste/returns (G): `t_waste_returns_log`, RM minor vs FC major threshold (config), logger≠approver, photo path
- D12 SAP import (A-2): `t_grpo_imports, t_grpo_import_items, t_grpo_staging_errors`, line-key uniqueness, O/C refresh rule, 2nd-approval reversal rule, `m_store_warehouse_mapping`
- D13 approvals (H + generic inbox): `t_store_warehouse_approvals`, unified `v_approval_inbox`
- D14 **RLS adversarial suite (read-only on others' files, owns `supabase/tests/adversarial/`):** for each role × table × operation prove denied/allowed; attempts to UPDATE/DELETE the ledger, approve own record, read another store, see price words, escalate role.

**Gate 1:** `supabase db reset` + `supabase test db` all green; ledger invariant property test (random action sequences ⇒ derived stock equals oracle; no negative stock unless count adjustment); price-word guard green; `docs/build/db/*.md` present. Lead reviews cross-domain FK/RLS consistency and merges migrations in numeric order.

### Phase 2 — Application (up to ~30 agents in parallel; each owns one route folder + its components + its e2e spec)

Common contract for every feature agent: reads/writes only via `lib/data/<domain>.ts` (thin typed wrappers over Supabase/RPC, created by that agent) and `lib/actions/dispatch.ts`; uses zod contracts; implements **every state in the prototype for its screen** (all role views, empty/denied/locked states, inline reasons, toasts); matches the prototype pixel-family (compare screenshots); no `any`; no price words; accessibility floor (labels, focus, keyboard, contrast ≥4.5:1, status never colour-only); e2e spec per user story using Playwright against local Supabase.
- F1 auth: login, invite activation (set own password), forgot/reset, lockout messaging, session + scope loading, store switcher
- F2 route guards + permission-aware nav (consumes `rbac/matrix`; no business logic duplicated)
- F3 Stock overview (tiles, table, filters, reorder card, expiry chips)
- F4 New request (+ my requests, edit/cancel locks)
- F5 Pick queue (FIFO lots, expired lock, stage full/partial, ledger preview)
- F6 Issues & Ledger (two-stage timeline, ledger table, filters, derived-after column)
- F7 Runner confirm UI (desktop-capable confirm/decline/partial for the door; phone layout later)
- F8 Daily balance (+ sign-off, escalation notices)
- F9 Count (freeze banner, blind first count, recount, voucher, FC approval, certificate)
- F10 Transfers (dual-unit dispatch/receive, variance)
- F11 Waste & supplier returns
- F12 SAP GRPO import UI (upload, preview, per-line results, audit table)
- F13 Approvals inbox (all types, segregation display)
- F14 Users & access (invite, role/scope matrix editor, lifecycle, security log)
- F15 Stores & warehouses (Flow H request/approve screens, go-live assignment checklist)
- F16 Master data admin (items, expiry groups, reorder rules, UoM, windows) — Admin/FC permitted per matrix
- F17 Custody/keep & handover (Flow B/E: issue window state, key custody, shift sign)
- F18 Reorder & expiry radar page (formula outputs, no auto-ordering)
- F19 Reports/read-only views for Viewer role (ledger, balances, audit trails)
- F20 System Admin ops page (backup job status, keep-alive status, email delivery status)
Server-side (route handlers, `runtime='nodejs'`):
- S1 `app/api/invitations` + password-reset emails via SMTP adapter interface with a local mail catcher for dev; rate-limit; audit to `t_security_logs`
- S2 `app/api/grpo/parse`: stream `.xlsx`, detect header, allowlist columns, **drop confidential columns before any persistence**, derive line keys, classify lines (Imported/Refreshed/Needs2ndApproval/Quarantined), return preview; commit endpoint calls D12 RPC; heavy unit tests with fixture workbooks incl. 121-duplicate-key case and shifted row order
- S3 `app/api/cron/*`: daily DB export to storage, keep-alive ping, morning escalation of unresolved variances, late-upload digest — secret-header protected, idempotent
- S4 `lib/audit` + structured error logging (single place; no secrets/PII in logs)
Cross-cutting (mechanical, may use a cheaper model):
- X1 seed/demo data loader reproducing the prototype's sample dataset
- X2 empty/error/permission-denied page set + toast system hardening
- X3 `docs/build/RUNBOOK.md` (local setup, env vars, backup/restore, free-tier pause + keep-alive checklist, SMTP checklist)
- X4 CI workflow (lint, types, unit, db tests, e2e, price-word guard)
- X5 visual-regression baselines for all prototype screens

**Gate 2:** `npm run build` succeeds; all unit + pgTAP + Playwright suites green; screenshot of every screen × key role saved to `docs/build/shots/`; lead performs a manual click-through of the doc's worked examples (§4.1 ex. 1–3) in the running app and quotes the resulting ledger rows.

### Phase 3 — Hardening (up to 12 agents in parallel, **review-only agents may not edit code**; they file findings, fixers are separate)

- H1 security review (authz bypass, RPC injection, `SECURITY DEFINER` misuse, storage policies, CSRF/server routes, secrets)
- H2 RLS adversarial re-run from the application layer (real sessions per role)
- H3 ledger integrity fuzzing (concurrency: two keepers staging the same lot, runner double-confirm, double SAP upload)
- H4 price-leak audit (schema, API payloads, logs, exports, seed, UI strings)
- H5 accessibility audit (keyboard, screen reader labels, contrast, focus order)
- H6 prototype-fidelity audit (diff each screen vs `ui-design/desktop/shots/`)
- H7 performance (query plans for stock/ledger views at 100k+ movements, indexes, pagination)
- H8 privacy/compliance docs vs actual data flows (DPDP/PDPD/GDPR flags per org policy; escalate cross-border or bulk-PII findings to Technology & Innovation leadership instead of deciding)
- H9 failure-mode tests (DB paused, server asleep, SMTP down, malformed xlsx, huge file)
- H10 e2e of every flow (0, A-1…H) end to end including exception paths
- H11 docs completeness vs doc §8 safeguards checklist
- H12 dependency + licence + bundle audit
Then **fixer agents** (one per finding cluster, disjoint files) address confirmed findings; re-run the owning gate.

**Gate 3 (release candidate):** zero open critical/high findings; all suites green on a clean clone (`git clone` → documented setup → green); RUNBOOK verified by following it literally in a fresh directory.

### Phase 4 — Close-out (lead)
`docs/build/STATUS.md`: what is built per flow (with evidence links), what is intentionally missing, owner decisions still open, known risks, go-live checklist (free-tier pause, backups, SMTP, cron secret), and the exact commands to run everything. Offer the mobile/PWA phase as the next project; do not start it.

---

## HOW TO RUN AGENTS

**Isolation:** every writing agent works in its own git worktree/branch (`<phase>/<id>`) off the last gated commit. `git init` the app directory first if needed. Review-only agents get read access, no worktree.

**Brief for every agent (use `AGENT_BRIEF_TEMPLATE.md`, fill all fields):**
1. Goal in one sentence + which flow/screen/table(s).
2. Files it **owns** (may create/edit) and files it must **not** touch.
3. Inputs to read (exact paths/sections) — never "see the docs".
4. Acceptance criteria as observable checks.
5. Proof commands it must run and quote.
6. Non-negotiable rules above (paste the list; agents do not see this prompt).
7. Report format ≤150 words: files changed, commands run + results, deviations, open questions. No code pasted.

**Merging:** the lead merges branches in dependency order, resolving conflicts once, re-running that wave's gate after each merge batch. An agent report is a claim, not proof: verify by running its proof commands yourself before merging. If an agent drifts outside its owned files, reject the branch and re-brief.

**Parallelism discipline:** spawn all independent agents of a phase in **one message**. Do not poll; wait for completion notices. If a contract (enum, RPC signature, table column) must change after Phase 0/1, the lead edits `CONTRACTS.md`, regenerates types, and notifies only the affected agents.

**Escalate to the human owner (stop and ask) when:** a flow is ambiguous or contradicts the doc; an owner-open question blocks a design that cannot support both answers; a request touches bulk personal data, cross-border transfer, or bypassing access controls; any agent proposes adding price/cost data; anything real-world (sending email to real addresses, deploying, writing to production Supabase) is about to happen. Use dev/local services only until the owner explicitly approves deployment.

**Final report to the owner (Vietnamese, concise, answer first):** what works with evidence, what is missing, decisions needed, risks.

## DEFINITION OF DONE

All 11 flows operate end to end in the running app for the correct roles; ledger invariants proven by property tests; RLS adversarial suite green; zero price/cost data; prototype fidelity audited; clean-clone setup works from RUNBOOK; open owner questions listed with the assumption used; nothing deployed.

## BEGIN

1. Read the four sources. 2. Write the Phase 0 documents. 3. Show the owner a 15-line plan (agents per phase, gates, biggest risks) and **wait for a go** before spawning anything that writes code. 4. Then execute phase by phase.
