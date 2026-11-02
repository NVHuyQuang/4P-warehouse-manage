# SUBAGENT BRIEF TEMPLATE — Pizza 4P's Inventory Control Tool

## 1. Goal
[State the exact goal in one sentence: specify the exact flow (0 to H), screen, and database table(s) or API route(s) involved.]

## 2. File Ownership Boundaries
- **Owned Files (YOU MAY CREATE / EDIT):**
  - `[List exact file paths or single directory owned]`
- **Prohibited Files (YOU MUST NEVER TOUCH OR EDIT):**
  - Any file outside your assigned list above.
  - Specifically: `docs/build/*`, `package.json` (unless authorized), `lib/contracts/*` (read-only for features), other agents' migration or component files.

## 3. Mandatory Inputs to Read First
- `docs/build/ARCHITECTURE.md` (§[Section number])
- `docs/build/CONTRACTS.md` (§[Section number])
- `docs/INVENTORY-TOOL-FLOW.md` (§[Exact section number & line citations])
- `ui-design/desktop/index.html` (lines [start]-[end] for UI agents)
- Flow diagram: `docs/flows/flow_[flow_id].mmd`

## 4. Acceptance Criteria (Observable Checks)
- [Criterion 1: Concrete observable behavior]
- [Criterion 2: Invariant enforced or UI state handled]
- [Criterion 3: Error / empty / unauthorized state handled]
- [Criterion 4: Unit / pgTAP / e2e test passing with zero warnings]

## 5. Required Proof Commands to Run & Quote
Execute the following commands in your branch and paste the verbatim outputs:
```bash
[Command 1, e.g., npm test -- tests/... or supabase test db]
[Command 2, e.g., npx tsc --noEmit]
[Command 3, e.g., git diff --stat]
```

## 6. Non-Negotiable Engineering Rules
1. **Quantities Only:** Zero price, cost, valuation, tax, or vendor-name column, field, API property, log line, or seed value anywhere. Any occurrence fails the build.
2. **Append-Only Ledger:** `t_stock_movements` has no UPDATE/DELETE path. Trigger raises exception on update/delete. Stock is derived dynamically via `v_stock_current`.
3. **Two-Stage Issue Lifecycle:** `ISSUE_PENDING` (-Q) -> `ISSUE_PENDING_OFFSET` (+Q) and `ISSUE_CONFIRMED` (-Q) -> Reversal if declined (`ISSUE_REVERSAL` +Q).
4. **Direct Browser-to-Database Path:** Frontline daily actions go browser -> Supabase (RLS + RPC). The Node application server is never in the critical path of storeroom picking.
5. **Segregation of Duties in Database:** Counter != Approver; Logger != Approver; Only `SYSTEM_ADMIN` provisions users; `APPROVER` role requires 2nd independent approval.
6. **No Infinite Auto-Retry:** Failed action logs once to `t_security_logs` -> displays manual retry button.
7. **No Hard-coded Constants for [Owner to set]:** Windows, thresholds, par levels, warning days reside in configuration tables with clearly labelled sample seeds.
8. **Privacy Compliance:** Staff accounts are personal data (India DPDP Act). Seed users are role-titled synthetic accounts on `@example.test`. Passwords managed only via Supabase Auth.
9. **Honesty Rule:** Never report "done" or "fixed" without quoting real command outputs (test output, diff stat, SQL query result).
10. **Zero Secrets in Code:** Use `.env.example` only. Never touch `D:\workspace\4P-knowledge-hub`.

## 7. Subagent Completion Report Format (≤150 words)
- **Files Modified / Created:** [List paths]
- **Proof Commands Run & Verbatim Status:** [Paste test/lint results]
- **Invariants Verified:** [List verified constraints]
- **Deviations / Blockers / Open Questions:** [None, or concise list]
*(Do not paste raw code or lengthy narrative in your final report).*
