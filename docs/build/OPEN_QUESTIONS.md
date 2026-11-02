# OPEN QUESTIONS FOR THE OWNER & DUAL-TRACK ARCHITECTURE

This document formalizes the 7 operational questions identified in `docs/INVENTORY-TOOL-FLOW.md` (§6) and `docs/HANDOVER_SESSION_1.md`.
For each question, the v1 build implements a **dual-track architecture**: it operates immediately on the validated assumption while ensuring zero schema breakage if the alternative option is selected.

---

### Q1. Provisioning Staff Without Company Email Addresses (Flow 0)
- **Operational Context:** Login IDs are email addresses; activation links are emailed. Frontline kitchen runners may lack corporate email accounts.
- **V1 Design Assumption:** Assume corporate lightweight internal email aliases (e.g. `runner.del01@pizza4ps.com`) managed by System Admin (Option A).
- **Dual-Track Accommodation:** The `m_users.email` and `m_user_invitations.email` tables accept any RFC-compliant email string. If Option B (personal emails) is authorized, zero schema or database migration is required.

---

### Q2. Daily Closing Variance Escalation Timing (Flow D)
- **Operational Context:** When an evening benchmark count has an unexplained discrepancy ($Diff \ne 0$), an alert must be routed.
- **V1 Design Assumption:** Alert store-level Restaurant Manager (RM) or Store Finance Lead immediately on the evening close; escalate to central Financial Controller (FC) next morning if still unresolved at morning issue window opening.
- **Dual-Track Accommodation:** Escalation routing is parameter-driven via `m_reorder_rules.variance_escalation_threshold` and cron scheduled rules (`app/api/cron/escalate-variances`). Thresholds and recipient roles are DB config rows, not hard-coded.

---

### Q3. SAP GRPO Line Key & Lack of LineNum Column (Flow A-2)
- **Operational Context:** The SAP 27-column `.xlsx` export has no line-number column. 121 rows in sample data share the same `GRPO No. + Item Code`.
- **V1 Design Assumption:** Fallback compound key: `key = GRPO No. + Item Code + occurrence order inside document`. The import UI flags an operational warning if document row order shifts.
- **Dual-Track Accommodation:** The parser (`lib/sap/parser.ts`) checks if a `LineNum` or `#` column exists with unique numbers. If present, it binds directly to `LineNum`; otherwise, it smoothly falls back to the compound occurrence key.

---

### Q4. Scope of SAP GRPO Lines (Inbound Receipts vs Internal Transfers) (Flow A-2)
- **Operational Context:** SAP export `Remarks` column contains mixed transaction types (`Based On Purchase Order`, `Stock Request from Store`).
- **V1 Design Assumption:** Ingestion filters allow only inbound purchase orders (`Base Document` matching Purchase Order pattern); internal store-to-store transfers are handled exclusively via Flow G.
- **Dual-Track Accommodation:** Ingestion filter rule is an isolated allowlist predicate (`lib/sap/filter.ts`) easily configurable without touching the ledger ingestion RPC.

---

### Q5. Mandatory Deadline for SAP GRPO Upload & Late Escalations (Flow A-2)
- **Operational Context:** Admin must export from SAP and upload to the App within 1 working day of SAP posting date.
- **V1 Design Assumption:** Late upload shows an operational **WARNING** badge to Admin/RM in the UI, but does not hard-block data ingestion. Summary digest sent weekly to SCM Lead.
- **Dual-Track Accommodation:** The deadline duration is stored in `m_store_warehouse_mapping.upload_grace_period_hours` (default 24h). A strict blocking policy can be toggled by a single boolean flag `block_on_overdue_upload` if requested.

---

### Q6. Evening Issue Protocol when Admin has Left (Flow C-2 Step C26)
- **Operational Context:** Kitchen operations continue after the Warehouse Keeper's shift ends.
- **V1 Design Assumption:** Option A: Key custody handed over to Restaurant Manager on Duty (RM) via Flow E Shift Handover. Kitchen submits urgent request in App; RM stages goods and runner signs.
- **Dual-Track Accommodation:** Step C26 UI explicitly labels the evening dispatch as `"Evening Custody Issue (RM on duty)"`, logging the shift holder ID. If Option B (Emergency PIN safe) is chosen, the UI replaces the RM picker select with an emergency PIN input dialog.

---

### Q7. Multi-Store User Switching Boundaries (Flow 0)
- **Operational Context:** Area chefs, multi-unit managers, and executive auditors oversee multiple restaurant stores.
- **V1 Design Assumption:** Single login account with a top-bar Store Switcher dropdown. Dropdown options are strictly restricted to the user's granted store IDs from `m_user_permissions`.
- **Dual-Track Accommodation:** Store context is tracked in client session state and validated against `m_user_permissions` on every database query via RLS `store_id IN (SELECT store_id FROM m_user_permissions WHERE user_id = auth.uid())`.
