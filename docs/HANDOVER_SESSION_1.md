# SESSION 1 HANDOVER DOCUMENTATION (CLOSE-OUT v1.6)
**Project:** Pizza 4P's India — Back-of-House Inventory Control Tool  
**Session Author:** Design Lead (Hermes Agent) | **Document Owner:** Financial Controller  
**Document Date:** November 2026 | **Handover Target:** Fresh Hermes Session (Stage 2 Start)  

---

## A. PROJECT PURPOSE AND OPERATIONAL SCOPE

1. **Business Objective:** Establish an uncompromised, real-time physical inventory control system for Pizza 4P's India across 5 to 6 operating restaurants. Every movement of goods in and out of central storerooms must pass through the App.
2. **Physical Scope (Central Storage Rooms Only):**
   - Ground-Floor Cold Room (`WH-01`): Chilled perishable ingredients (dairy, meats, seafood, dough, fresh produce).
   - Ground-Floor Dry Store (`WH-02`): Ambient dry storage (flour, canned tomatoes, oils, spices, beverages).
   - **Out of Scope:** Kitchen line stock, cold inserts, prep station holdings, bar speed rails, and recipe yield BOM processing.
   - **Excluded per Owner Decision Q9:** Walk-in Freezers are strictly excluded from core Stage 1 scope (may be proposed via Flow H if an individual store expands).
3. **Scale & Concurrency:** 5 to 6 stores, >30 concurrent users.
4. **Version 1 Data Constraint:**
   - **Quantities ONLY:** Version 1 strictly records and tracks physical quantities (kg and pieces). It stores **NO cost, NO purchase price, and NO financial valuation data**. Financial inventory valuations remain in SAP / ERP.
   - **Absolute Price Concealment:** Staff in Kitchen, Bar, and Cheese sections have zero visibility into purchasing prices at all layers.

---

## B. STAGE STATUS & FORMAL APPROVAL GATE

1. **Overall Status:** **Stage 1 Complete — Awaiting Owner Approval**.
2. **Verification Reality Check:**
   - **Status:** Structurally checked by script (box limits &le;12, reachability from Start, termination to End, YES/NO diamond labels, embedded block equals source `.mmd`, step text IDs verified against charts).
   - **Critical Gate:** **NOT yet approved by the owner.** Stage 2 (UI Mockups) must **NOT** start until the owner explicitly approves the flows.
3. **Flow Breakdown (11 Flows Structurally Verified):**
   - Flow 0: Users, Roles, Access & Lifecycle (`flows/flow_0_access_control.mmd`, 12 boxes).
   - Flow A-1: Physical Receiving & QC (`flows/flow_a1_physical_receiving.mmd`, 11 boxes).
   - Flow A-2: SAP GRPO Entry, File Export & Import (`flows/flow_a2_sap_import.mmd`, 12 boxes).
   - Flow B: Keep — Custodian & Issue Windows (`flows/flow_b_keep.mmd`, 10 boxes).
   - Flow C-1: Section Stock Request (`flows/flow_c1_request.mmd`, 12 boxes).
   - Flow C-2: Stock Issue and Confirmation (`flows/flow_c2_issue_confirm.mmd`, 11 boxes).
   - Flow D: Balance — Daily Close Reconciliation (`flows/flow_d_balance.mmd`, 12 boxes).
   - Flow E: Handover — Custodian Shift Handover (`flows/flow_e_handover.mmd`, 9 boxes).
   - Flow F: Count & Reconciliation (`flows/flow_f_count.mmd`, 12 boxes).
   - Flow G: Other Movements — Waste, Return, Transfer (`flows/flow_g_other_movements.mmd`, 12 boxes).
   - Flow H: Add a New Store or Warehouse (`flows/flow_h_add_store_warehouse.mmd`, 9 boxes).

---

## C. DECISIONS MADE BY THE OWNER (CHRONOLOGICAL AUDIT)

| Date | Owner Decision | Architectural & Operational Impact |
| :---: | :--- | :--- |
| **2026-11-01** | **Bypass Node Server for Daily Mobile Actions** | Mobile devices (PWA) communicate directly with the managed database (Supabase/PostgreSQL) via Row-Level Security (RLS) for all high-frequency actions (Request, Issue, Confirm, Count, Balance). The Node application server is reserved strictly for email invites, SAP file parsing, and cron backup jobs. A sleeping server never blocks the kitchen. |
| **2026-11-01** | **Email Activation & No Temporary Passwords (Q1)** | Staff are onboarded via email invitation links. Users set their own private passwords. No temporary passwords are generated or stored. Email is the primary login ID. Every runner has an individual account (rejecting Option C to preserve two-person physical segregation). |
| **2026-11-01** | **Two-Stage Append-Only Issue Ledger (Q7)** | Available book stock is deducted immediately upon Admin picking (`ISSUE_PENDING`). When the runner confirms on mobile, the App appends `ISSUE_PENDING_OFFSET` (+Q) and `ISSUE_CONFIRMED` (-Q). If the runner declines, the App appends `ISSUE_REVERSAL` (+Q) and items return to the shelf. No existing ledger row is ever updated. |
| **2026-11-01** | **Runner & Requester Role Flexibility (Q8)** | The Section Requester (who creates requests) and the Kitchen Runner (who collects and confirms goods at the storeroom door) may be the same person on quiet shifts, provided the signing runner belongs to the requesting section. |
| **2026-11-01** | **Store Switcher Permissions (Q7b)** | Users authorized across multiple locations can switch active store contexts via a top-bar dropdown, strictly governed by `m_user_permissions`. |
| **2026-11-01** | **SAP GRPO Upload Deadline (Q5)** | GRPO file exports from SAP must be uploaded to the App latest within 1 working day of the SAP posting date. Late uploads trigger an operational WARNING badge to Admin and RM, but do not hard-block data ingestion. |
| **2026-11-01** | **Closing Variance Escalation Protocol (D9 & Q2)** | Evening closing variances (Diff is not 0) alert the store-level Finance Lead or Restaurant Manager immediately. If the Finance Lead is unavailable, the Custodian may close the day with status `"unexplained"`. The App escalates persistent unresolved variances to the central Financial Controller the next morning without locking the storeroom door. |
| **2026-11-01** | **Segregation of Duties & User Admin** | User administration is separated from storeroom stock operations; only `System Admin` creates users. Approver accounts require a mandatory second approval. A user who logs an action cannot approve it (RM cannot log waste claims; counter cannot approve count adjustments; dispatch keeper cannot approve transit variances). |
| **2026-11-01** | **Core Storeroom Scope (Q9)** | Walk-in Freezers are excluded from Stage 1 core scope. Core scope covers Ground-Floor Cold Rooms and Dry Stores only. |

---

## D. OPEN QUESTIONS FOR THE OWNER (SECTION 6 LINE CITATIONS)

| # | Open Question Summary | Section 6 Location | Design Lead Recommendation |
| :---: | :--- | :---: | :--- |
| **Q1** | **Staff Without Email Addresses:** How to provision frontline runners who lack email addresses? | **Line 1092** | Issue lightweight company internal email aliases (e.g. `runner.del01@pizza4ps.com`) managed by System Admin. |
| **Q2** | **Daily Variance Alert Routing:** Confirm store-level FL/RM review first, central FC next morning. | **Line 1100** | Confirmed (protects central FC from micro-alerts while guaranteeing morning oversight). Limit: owner to set. |
| **Q3** | **SAP GRPO Line Number Column:** Can SAP administrator add an explicit `LineNum` column to export? | **Line 1107** | Primary: Request SAP Admin to add `LineNum`. Fallback: Compound key = `GRPO No. + Item Code + occurrence order`. |
| **Q4** | **Scope of GRPO Remarks:** Are all GRPO lines inbound supplier receipts, or do some represent store requests? | **Line 1118** | Filter file at ingestion to include only inbound PO receipts; store-to-store transfers must use Flow G. |
| **Q5** | **Executive SCM Escalation for Late SAP Uploads:** Should persistent late uploads alert SCM Lead? | **Line 1123** | Yes, summarize late upload frequency in weekly SCM executive digests. |
| **Q6** | **Evening Issue Protocol when Admin Leaves (Step C26):** RM key handover vs Emergency PIN safe box? | **Line 1129** | Option A (Recommended): Handover evening key to Restaurant Manager on Duty via Flow E. |
| **Q7** | **Multi-Store User Switching Boundaries:** Confirm top-bar switcher scope. | **Line 1136** | Confirmed: Single login with top-bar Store Switcher dropdown restricted to granted scopes. |

---

## E. REAL SAP EXPORT FACTS & INGESTION RULES

1. **File Format & Sample Context:**
   - Format: Real export is `.xlsx` format (CSV format is an [ASSUMPTION]).
   - Header row is strictly **Row 1**.
   - Exactly **27 Columns**; date format is `dd.mm.yyyy`.
   - Scale: The 2,835 lines / 669 documents figure represents **ONE specific sample month (October 2026) spanning two store codes**, not a standardized per-entity monthly average.
2. **Column Allowlist (Confidentiality Enforcement):**
   - **INGEST & STORE:** `GRPO No.`, derived `line key`, `Doc Date`, `Item Code`, `Quantity`, `UoM Code`, `Store Code`, `Vendor Code` (reference only), `Base Document`.
   - **DROP AT INGESTION (Confidential):** `Price`, `Total Tax`, `Net Tax Amount`, `Row Total`, `Gross Total`, `Vendor Name`, `Vendor Address`. (Version 1 stores physical quantities only).
3. **Compound Line-Key Strategy (Addressing Lack of LineNum):**
   - The export has **no line-number column**. In the sample data, 121 rows share the same `GRPO No. + Item Code`.
   - Primary: Request SAP admin to add `LineNum`.
   - Fallback (ASSUMPTION): Compound key = `GRPO No. + Item Code + occurrence order inside document`. Warning displayed if row order shifts between uploads.
4. **Status O/C Re-upload Rule:**
   - Invoicing in SAP updates `Status` (Open/Closed), `Target Type`, and `Open Quantity` for existing documents.
   - Re-uploading an existing document with only these changes is **not a corrected revision**: reference fields refresh with zero stock change.
   - Only a changed `Quantity` or `Item Code` constitutes a correction, requiring second-person approval (SCM Lead or Finance Lead) before appending an offsetting reversal.
5. **UoM & Store Mapping:**
   - 70+ distinct UoM codes exist (~65% `Kg_1000gr`, remainder in packs, bottles, tins). Unmapped UoMs quarantine to `t_grpo_staging_errors`.
   - `Store Code` maps to warehouse via `m_store_warehouse_mapping`. Unmapped store codes quarantine to staging.

---

## F. KNOWN RISKS & GO-LIVE PLATFORM CHECKLIST

1. **Free-Tier Database Pausing:**
   - Supabase free-tier database projects automatically pause after approximately 1 week of low query activity.
   - *Checklist Action:* Operations must configure an external cron keep-alive ping or upgrade to a paid tier before restaurant go-live.
2. **Automated Scheduled Backups:**
   - Free-tier databases do not provide automated backup snapshots.
   - *Checklist Action:* A daily scheduled export job must dump all primary relational tables to company-owned cloud storage.
3. **Application Server Cold Starts:**
   - Free Node hosting tiers sleep when idle (wake time not published, owner to measure).
   - *Mitigation:* Daily mobile actions connect directly to the database via RLS, bypassing Node entirely.
4. **Email Delivery Quotas & Custom SMTP:**
   - Invitation links and password resets rely on transactional email. Free email tiers have strict daily caps (e.g. 100 emails/day).
   - *Checklist Action:* Technology & Innovation team must configure an enterprise SMTP relay (e.g. Google Workspace / SendGrid) before launch.
5. **Data Protection & Privacy:**
   - Staff login IDs are individual corporate emails. Accounts constitute personal data under India DPDP Act. Passwords must be hashed using bcrypt/argon2. V1 stores zero supplier cost data.

---

## G. WORKING RULES & LESSONS FOR NEXT SESSION

1. **Owner's Audit Lesson (Mandatory Operating Directive):**
   - In previous rounds, reports prematurely claimed items were "Fixed" when files on disk still contained stale text or partial edits.
   - **Standing Rule:** No item may be reported as "Fixed" without verifying and quoting real command outputs (`grep`, `sha256sum`, `os.stat`) across **all 4 required surfaces**:
     * (1) The `.mmd/.svg/.png` in `flows/`.
     * (2) The embedded Mermaid block in `INVENTORY-TOOL-FLOW.md`.
     * (3) The step text, decision points, controls, and exceptions in `INVENTORY-TOOL-FLOW.md`.
     * (4) `flows/flows.html`.
2. **Single Source of Truth:**
   - The authoritative source for all process flows is strictly `flows/*.mmd`.
   - Any flow change must be made in `flows/<flow>.mmd` first, then synchronized across `INVENTORY-TOOL-FLOW.md` and `flows/flows.html` using `python scripts/sync_flows.py`.
3. **Automated Verification Enforcement:**
   - Every modification must be validated by running `python scripts/verify_flows.py`.
   - The script enforces: box limits &le;12, reachability from Start, termination to End, exact YES/NO labels, embedded block equals source, step text mentions every node ID, every diamond lists both Yes and No targets, and zero LaTeX corruption.
4. **Tone & Language:** Reply to the Financial Controller in Vietnamese, concise, direct, answer first, zero fluff. Write technical documentation in English using role titles only.
5. **Strict Stage Gating:** Do not write code or create UI mockups until the Financial Controller explicitly reviews and approves the Stage 1 specification.

---

## H. NEXT STEPS & SESSION 2 START PROMPT

1. **Upcoming Stage:** **Stage 2 — High-Fidelity Phone-First UI Mockups**.
   - Designing mobile screens (390×844 px) for each key step:
     * Login, invite activation, and store switching.
     * Section requisition creation, quick search, and needed time selection.
     * Warehouse Keeper FIFO pick queue, staging, and partial issue logging.
     * Kitchen Runner door handoff inspection and digital confirmation.
     * Daily benchmark count entry and variance review.
     * Periodic inventory count sheet under freeze.
     * Inter-store transfer dispatch and receiving dual-unit entry.
2. **Recommended Prompt for the New Session:**
   ```
   Tôi là Dương, Financial Controller tại Pizza 4P's. Hãy đọc kỹ file HANDOVER_SESSION_1.md trong thư mục dự án để nắm toàn bộ bối cảnh, các quyết định kiến trúc, dữ liệu thực tế SAP và trạng thái Stage 1 v1.6. Xác nhận bằng tiếng Việt dưới 10 dòng rằng bạn đã đọc hiểu, báo cáo những điểm bạn không thể tự quyết định, và hỏi tôi xem 11 quy trình Stage 1 đã được phê duyệt để bắt đầu Stage 2 (UI Mockups) hay chưa. Tuyệt đối không tự ý vẽ mockup khi tôi chưa bấm nút duyệt.
   ```

---

## I. FILE INDEX & REAL SYSTEM METRICS (COMPUTED VIA OS.STAT)

| File Path | File Size | Last Modified Timestamp |
| :--- | :---: | :--- |
| `HANDOVER_SESSION_1.md` | 28,161 bytes | `2026-11-02 15:20:48` |
| `INVENTORY-TOOL-FLOW.md` | 94,350 bytes | `2026-11-02 15:17:21` |
| `INVENTORY-TOOL-FLOW_v1.1.md` | 57,869 bytes | `2026-11-01 14:33:14` |
| `INVENTORY-TOOL-FLOW_v1.2.md` | 66,512 bytes | `2026-11-01 15:30:00` |
| `INVENTORY-TOOL-FLOW_v1.3.md` | 74,395 bytes | `2026-11-01 15:58:50` |
| `INVENTORY-TOOL-FLOW_v1.4.md` | 76,621 bytes | `2026-11-01 16:14:45` |
| `Receiving to kitchen.pdf` | 475,756 bytes | `2026-11-01 01:25:13` |
| `flows/_old/flow_a_receive.mmd` | 1,679 bytes | `2026-11-01 14:39:20` |
| `flows/_old/flow_a_receive.png` | 243,096 bytes | `2026-11-01 14:46:14` |
| `flows/_old/flow_a_receive.svg` | 221,964 bytes | `2026-11-01 14:46:11` |
| `flows/_old/flow_access_control.mmd` | 1,621 bytes | `2026-11-01 13:34:41` |
| `flows/_old/flow_access_control.png` | 210,312 bytes | `2026-11-01 13:34:48` |
| `flows/_old/flow_access_control.svg` | 221,312 bytes | `2026-11-01 13:34:44` |
| `flows/_old/flow_c_request_issue.mmd` | 2,319 bytes | `2026-11-01 13:35:45` |
| `flows/_old/flow_c_request_issue.png` | 253,754 bytes | `2026-11-01 13:35:51` |
| `flows/_old/flow_c_request_issue.svg` | 235,595 bytes | `2026-11-01 13:35:47` |
| `flows/_old/flow_h_add_warehouse.mmd` | 1,346 bytes | `2026-11-01 12:50:40` |
| `flows/_old/flow_h_add_warehouse.png` | 162,344 bytes | `2026-11-01 12:51:06` |
| `flows/_old/flow_h_add_warehouse.svg` | 217,389 bytes | `2026-11-01 12:50:42` |
| `flows/_old/v1.3/flow_0_access_control.mmd` | 1,710 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_0_access_control.png` | 232,914 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_0_access_control.svg` | 223,630 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_a1_physical_receiving.mmd` | 1,741 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_a1_physical_receiving.png` | 253,076 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_a1_physical_receiving.svg` | 227,615 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_a2_sap_import.mmd` | 1,454 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_a2_sap_import.png` | 181,355 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_a2_sap_import.svg` | 216,203 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_b_keep.mmd` | 1,563 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_b_keep.png` | 218,251 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_b_keep.svg` | 224,043 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_c1_request.mmd` | 1,553 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_c1_request.png` | 221,773 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_c1_request.svg` | 223,605 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_c2_issue_confirm.mmd` | 1,991 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_c2_issue_confirm.png` | 296,899 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_c2_issue_confirm.svg` | 233,038 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_d_balance.mmd` | 1,710 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_d_balance.png` | 232,524 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_d_balance.svg` | 224,458 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_e_handover.mmd` | 1,530 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_e_handover.png` | 203,234 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_e_handover.svg` | 217,451 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_f_count.mmd` | 1,827 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_f_count.png` | 242,493 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_f_count.svg` | 225,969 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_g_other_movements.mmd` | 1,916 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_g_other_movements.png` | 281,219 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_g_other_movements.svg` | 231,029 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_h_add_store_warehouse.mmd` | 1,409 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/flow_h_add_store_warehouse.png` | 178,363 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/flow_h_add_store_warehouse.svg` | 217,718 bytes | `2026-11-01 15:58:58` |
| `flows/_old/v1.3/screenshot_desktop.png` | 151,896 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/screenshot_desktop_v12.png` | 153,734 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/screenshot_desktop_v13.png` | 183,588 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/screenshot_mobile.png` | 50,223 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/screenshot_mobile_v12.png` | 120,839 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.3/screenshot_mobile_v13.png` | 168,512 bytes | `2026-11-01 15:58:59` |
| `flows/_old/v1.4/flow_0_access_control.mmd` | 1,769 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_0_access_control.png` | 264,073 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_0_access_control.svg` | 228,266 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_a1_physical_receiving.mmd` | 1,741 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_a1_physical_receiving.png` | 253,076 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_a1_physical_receiving.svg` | 227,615 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_a2_sap_import.mmd` | 1,819 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_a2_sap_import.png` | 263,555 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_a2_sap_import.svg` | 224,743 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_b_keep.mmd` | 1,563 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_b_keep.png` | 218,251 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_b_keep.svg` | 224,043 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_c1_request.mmd` | 1,858 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_c1_request.png` | 287,587 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_c1_request.svg` | 230,834 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_c2_issue_confirm.mmd` | 1,931 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_c2_issue_confirm.png` | 279,951 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_c2_issue_confirm.svg` | 233,376 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_d_balance.mmd` | 1,829 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_d_balance.png` | 259,984 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_d_balance.svg` | 225,089 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_e_handover.mmd` | 1,522 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_e_handover.png` | 201,578 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_e_handover.svg` | 217,443 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_f_count.mmd` | 1,827 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_f_count.png` | 242,493 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_f_count.svg` | 225,969 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_g_other_movements.mmd` | 1,914 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_g_other_movements.png` | 259,514 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_g_other_movements.svg` | 230,892 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_h_add_store_warehouse.mmd` | 1,409 bytes | `2026-11-01 16:14:45` |
| `flows/_old/v1.4/flow_h_add_store_warehouse.png` | 178,363 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/flow_h_add_store_warehouse.svg` | 217,718 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_desktop.png` | 151,896 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_desktop_v12.png` | 153,734 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_desktop_v13.png` | 183,588 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_desktop_v14.png` | 182,002 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_mobile.png` | 50,223 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_mobile_v12.png` | 120,839 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_mobile_v13.png` | 168,512 bytes | `2026-11-01 16:14:46` |
| `flows/_old/v1.4/screenshot_mobile_v14.png` | 147,419 bytes | `2026-11-01 16:14:46` |
| `flows/flow_0_access_control.mmd` | 1,889 bytes | `2026-11-01 16:16:50` |
| `flows/flow_0_access_control.png` | 300,779 bytes | `2026-11-01 16:19:58` |
| `flows/flow_0_access_control.svg` | 233,440 bytes | `2026-11-01 16:19:56` |
| `flows/flow_a1_physical_receiving.mmd` | 1,741 bytes | `2026-11-01 16:16:16` |
| `flows/flow_a1_physical_receiving.png` | 253,076 bytes | `2026-11-01 16:20:03` |
| `flows/flow_a1_physical_receiving.svg` | 227,615 bytes | `2026-11-01 16:20:01` |
| `flows/flow_a2_sap_import.mmd` | 1,901 bytes | `2026-11-01 16:16:16` |
| `flows/flow_a2_sap_import.png` | 287,343 bytes | `2026-11-01 16:20:07` |
| `flows/flow_a2_sap_import.svg` | 225,466 bytes | `2026-11-01 16:20:05` |
| `flows/flow_b_keep.mmd` | 1,563 bytes | `2026-11-01 16:16:16` |
| `flows/flow_b_keep.png` | 218,251 bytes | `2026-11-01 16:20:11` |
| `flows/flow_b_keep.svg` | 224,043 bytes | `2026-11-01 16:20:09` |
| `flows/flow_c1_request.mmd` | 1,858 bytes | `2026-11-01 16:16:16` |
| `flows/flow_c1_request.png` | 287,587 bytes | `2026-11-01 16:20:16` |
| `flows/flow_c1_request.svg` | 230,834 bytes | `2026-11-01 16:20:13` |
| `flows/flow_c2_issue_confirm.mmd` | 2,082 bytes | `2026-11-01 16:29:57` |
| `flows/flow_c2_issue_confirm.png` | 305,067 bytes | `2026-11-01 16:20:20` |
| `flows/flow_c2_issue_confirm.svg` | 237,033 bytes | `2026-11-01 16:20:18` |
| `flows/flow_d_balance.mmd` | 1,829 bytes | `2026-11-01 16:16:16` |
| `flows/flow_d_balance.png` | 259,984 bytes | `2026-11-01 16:20:24` |
| `flows/flow_d_balance.svg` | 225,089 bytes | `2026-11-01 16:20:22` |
| `flows/flow_e_handover.mmd` | 1,522 bytes | `2026-11-01 16:16:16` |
| `flows/flow_e_handover.png` | 201,578 bytes | `2026-11-01 16:20:28` |
| `flows/flow_e_handover.svg` | 217,443 bytes | `2026-11-01 16:20:26` |
| `flows/flow_f_count.mmd` | 1,827 bytes | `2026-11-01 16:16:16` |
| `flows/flow_f_count.png` | 242,493 bytes | `2026-11-01 16:20:33` |
| `flows/flow_f_count.svg` | 225,969 bytes | `2026-11-01 16:20:30` |
| `flows/flow_g_other_movements.mmd` | 1,921 bytes | `2026-11-01 16:19:54` |
| `flows/flow_g_other_movements.png` | 287,490 bytes | `2026-11-01 16:20:37` |
| `flows/flow_g_other_movements.svg` | 233,583 bytes | `2026-11-01 16:20:35` |
| `flows/flow_h_add_store_warehouse.mmd` | 1,409 bytes | `2026-11-01 16:16:16` |
| `flows/flow_h_add_store_warehouse.png` | 178,363 bytes | `2026-11-01 16:20:41` |
| `flows/flow_h_add_store_warehouse.svg` | 217,718 bytes | `2026-11-01 16:20:39` |
| `flows/flows.html` | 117,973 bytes | `2026-11-02 15:46:21` |
| `flows/screenshot_desktop.png` | 151,896 bytes | `2026-11-01 13:45:23` |
| `flows/screenshot_desktop_v12.png` | 153,734 bytes | `2026-11-01 14:47:59` |
| `flows/screenshot_desktop_v13.png` | 183,588 bytes | `2026-11-01 15:41:48` |
| `flows/screenshot_desktop_v14.png` | 182,002 bytes | `2026-11-01 16:04:09` |
| `flows/screenshot_desktop_v15.png` | 182,002 bytes | `2026-11-01 16:33:44` |
| `flows/screenshot_desktop_v16.png` | 184,135 bytes | `2026-11-02 15:51:14` |
| `flows/screenshot_mobile.png` | 50,223 bytes | `2026-11-01 13:46:07` |
| `flows/screenshot_mobile_v12.png` | 120,839 bytes | `2026-11-01 14:47:58` |
| `flows/screenshot_mobile_v13.png` | 168,512 bytes | `2026-11-01 15:41:48` |
| `flows/screenshot_mobile_v14.png` | 147,419 bytes | `2026-11-01 16:04:08` |
| `flows/screenshot_mobile_v15.png` | 147,419 bytes | `2026-11-01 16:33:44` |
| `flows/screenshot_mobile_v16.png` | 148,683 bytes | `2026-11-02 15:51:14` |
| `scripts/sync_flows.py` | 2,489 bytes | `2026-11-01 16:18:10` |
| `scripts/trace_paths.py` | 4,580 bytes | `2026-11-02 15:15:47` |
| `scripts/verify_flows.py` | 15,249 bytes | `2026-11-02 15:50:54` |

---

## J. KNOWN OPEN ITEMS & TECHNICAL CAVEATS

1. **Step Text Quality & Alignment:** Fully resolved in Round 6; every single process box and decision diamond from all 11 charts is documented in `INVENTORY-TOOL-FLOW.md` and `flows.html` with exact matching IDs and transition targets (`verify_flows.py` passes 100%).
2. **flows.html Regeneration:** Fully synchronized; A-2 tab reflects SAP document line keys; Flow G tab contains zero "Debit Note" references; audit table covers Rounds 3, 4, 5 and 6. Status column rendered as responsive card visible immediately at 390px without horizontal scrolling.
3. **Supabase Auth vs Data Model Columns:** The data model table `m_users` currently retains `password_hash` and `failed_login_count` columns. In a production Supabase setup, passwords and auth tokens are managed in Supabase's internal `auth.users` schema. The Stage 3 engineering team must decide whether to remove these redundant columns from public `m_users` to avoid storing application-level password hashes.
4. **File Hash vs Line Key in Upload Audit:** In `t_grpo_imports`, the column `file_hash` was originally marked `UNIQUE`. Flow A-2 now deduplicates rows based on the SAP document line key (`GRPO No. + Item Code + occurrence order`), allowing corrected re-exports of the same file. The Stage 3 team should remove the `UNIQUE` constraint on `file_hash` so it acts purely as an audit trace.
5. **Staff Without Email (Q1):** Remains open for owner sign-off.
6. **Executive SCM Escalation for Late SAP Uploads (Q5):** Remains open for owner sign-off.
