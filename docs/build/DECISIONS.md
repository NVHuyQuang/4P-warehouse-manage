# ARCHITECTURAL DECISIONS & CONFLICT RESOLUTION LOG

This log records all conflict resolutions between sources of truth (`flows/*.mmd` > doc §5 data model > doc prose > prototype copy) and foundational architectural choices.

---

## 1. Conflict Resolutions

| # | Conflict Observed | Source Precedence | Resolution & Rationale |
| :---: | :--- | :--- | :--- |
| **CR-01** | `m_users` password storage: Doc §5 lists `password_hash` and `failed_login_count` in public table, whereas Supabase handles credentials in `auth.users`. | Handover §J.3 & Compliance Principle | **Resolved:** Omit `password_hash` from `public.m_users`. Delegate password hashing and session tokens to Supabase Auth. Public table retains `user_id`, `email`, `full_name`, `failed_login_count`, `lockout_until`, `is_active`. Protects against credential leaks. |
| **CR-02** | `t_grpo_imports.file_hash` unique constraint: Doc §5 lists `file_hash` as `UNIQUE`, which blocks re-uploading corrected files. | Flow A-2 `.mmd` & Handover §J.4 | **Resolved:** Remove `UNIQUE` constraint on `file_hash`. Deduplication is enforced at the line level via the compound key (`GRPO No. + Item Code + occurrence`). `file_hash` remains an indexed audit field. |
| **CR-03** | Inbound Movement Type naming: Prototype JS seed uses `GRPO_RECEIPT`, while Doc §5 and §4.1 use `GRPO_IMPORT`. | Doc §5 / §4.1 (`.mmd`) > Prototype | **Resolved:** Standardized to `GRPO_IMPORT` across SQL migrations, TypeScript types, and UI views. |
| **CR-04** | Desktop Web vs Phone PWA: Initial brief requested phone-first; owner explicitly overturned this in Round 2. | Owner Direction Approved (`ui-design/direction-approved.md`) | **Resolved:** Desktop web app (1440px target, responsive down to 1024px) built first with approved desktop design system. Client dispatcher retains seam for future mobile IndexedDB phase. |
| **CR-05** | Storeroom Physical Scope: Mention of walk-in freezers in generic notes. | Owner Decision Q9 & Handover §A.2 | **Resolved:** Walk-in Freezers strictly excluded from Stage 1. Scope covers Ground-Floor Cold Room (`WH-01`) and Dry Store (`WH-02`) only. |
| **CR-06** | Request cancellation timing: Doc prose mentions cancellation, while Flow C-1 `.mmd` explicitly restricts it. | Flow C-1 `.mmd` (`C8/C9`) > Prose | **Resolved:** Requesters may edit quantities or cancel a requisition **only** while its status is `QUEUED`. Once Keeper initiates picking (`PICKING`), edit and cancel actions are hard-locked for requester. |

---

## 2. Platform & Technology Decisions

### D-01: Frontline Direct Browser-to-Database Path
- **Decision:** Frontline transactions (requests, picking, confirmation, daily balance, physical counts, waste, transfers) execute directly from the browser to Supabase via Row-Level Security (RLS) and PostgreSQL RPC functions.
- **Rationale:** Protects kitchen and warehouse staff from cold-start latency or downtime on Node.js hosting instances.

### D-02: Server-Side Restrictions (`runtime = 'nodejs'`)
- **Decision:** Next.js route handlers are strictly confined to:
  1. Transactional invitation and password reset emails (`app/api/invitations`).
  2. SAP GRPO spreadsheet ingestion, column allowlist filtering, and error staging (`app/api/grpo/parse`).
  3. Scheduled maintenance cron jobs (`app/api/cron/*`).
- **Rationale:** Minimizes server footprint and isolates compute-intensive tasks without contaminating the transactional ledger.

### D-03: Cron Trigger Mechanism
- **Decision:** Scheduled jobs (daily DB export, keep-alive ping, morning variance escalation) are implemented as Next.js route handlers protected by an authorization header (`Authorization: Bearer <CRON_SECRET>`), triggered via external HTTP cron or Supabase Scheduled Functions.
- **Rationale:** Standardized, cloud-agnostic, and easily testable via automated integration scripts.

### D-04: Zero-Price Drop at Ingestion Boundary
- **Decision:** All 7 price, valuation, tax, and supplier address columns (`Price`, `Total Tax`, `Net Tax Amount`, `Row Total`, `Gross Total`, `Vendor Name`, `Vendor Address`) are purged in memory on the server inside the SAP parser stream before any database row or staging record is created.
- **Rationale:** Ensures complete physical zero-price isolation across all database tables, API responses, and client browser states.
