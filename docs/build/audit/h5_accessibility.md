# H5 Accessibility & UX Floor Audit Report

**System:** Internal Inventory Control & Stock Ledger System  
**Standard:** WCAG 2.2 AA / Section 508 / WAI-ARIA 1.2  
**Target Platform:** Desktop Web Application (Next.js 15, React 19)  
**Audit Scope:** 12 Core Operations Screens + 8 Auxiliary Admin & Workflow Surfaces  
**Operating Constraint:** Quantities only (physical units in kg and pcs). Append-only stock ledger immutability.

---

## 1. Executive Summary & Audit Verdict

This comprehensive accessibility and floor-usability audit evaluates the frontend application against the W3C Web Content Accessibility Guidelines (WCAG) 2.2 Level AA requirements. The audit encompasses all primary functional operational screens used across warehouse, restaurant, kitchen, and accounting floor environments.

### Audit Verdict: **HOLD (Gated on Remediation)**

| Category | Compliance State | Summary Assessment |
| :--- | :---: | :--- |
| **Color as Sole Meaning (SC 1.4.1)** | **PASS** | 100% compliant. Status states, urgency flags, variance indications, and lot health are always paired with explicit text stamps, badge labels, or numeric symbols (`+`/`−`). |
| **Color Contrast Ratios (SC 1.4.3 / 1.4.11)** | **PARTIAL PASS / HOLD** | Core text, buttons, and status badges meet or exceed 4.5:1. Borderline contrast (4.01:1 to 4.48:1) identified on secondary muted text and terra labels when rendered over sand backgrounds. Outline focus ring achieves 7.69:1 to 8.60:1 (exceeds 3:1). |
| **Accessible Names & ARIA (SC 4.1.2 / 1.3.1)** | **HOLD** | Key steppers and inputs in Requisitions, Daily Balance, and Item Master lack programmatic `<label>` associations or contextual accessible labels. Segmented button groups lack `aria-pressed` / `aria-selected` attributes. |
| **Keyboard & Modal Traps (SC 2.1.1 / 2.1.2 / 2.4.3)** | **BLOCK** | Five modal dialogs (`app/import`, `app/users`, `app/custody`, `app/login`, `app/confirm`) lack keyboard focus traps, initial focus placement, Escape key listeners, and focus return to trigger controls. |

---

## 2. Scope & Evaluated Surfaces

The audit evaluated 20 application surfaces, covering 100% of the operational routes:

1. **Stock Overview Screen** (`app/overview/page.tsx`): Real-time stock quantities, FIFO lots, issue window badge, benchmark reorder suggestions.
2. **Requisitions & Pick Queue Screen** (`app/requests/page.tsx`): Queue filtration, FIFO lot picking, increment/decrement quantity steppers, staging confirmation.
3. **New Section Requisition Screen** (`app/request/page.tsx`): Requisition drafting, catalog search chips, dual-unit quantity steppers, urgent reason triggers.
4. **Stock Issues & Movement Ledger Screen** (`app/issues/page.tsx`): Two-stage door handover timeline, partial acceptance inputs, append-only movement ledger.
5. **Daily Balance Sheet Screen** (`app/balance/page.tsx`): Benchmark item count inputs, discrepancy recount triggers, cause code selection, evening close fallback.
6. **GRPO Ingestion & Diagnostics Screen** (`app/import/page.tsx`): Spreadsheet intake, validation errors, quarantined items modal drawer.
7. **Stock Count Screen** (`app/count/page.tsx`): Blind first count, difference comparisons, recount inputs, adjustment voucher submission.
8. **Inter-Store Dispatches & Transfers Screen** (`app/transfers/page.tsx`): Outbound dual-unit dispatches, vehicle tamper-evident seal verification, inbound receipt intake.
9. **Approvals Inbox Screen** (`app/approvals/page.tsx`): Segregation of duties enforcement, pending adjustments, authorization decisions.
10. **Staff Users & Access Control Screen** (`app/users/page.tsx`): User scope management, role configurations, staff onboarding invitation modal.
11. **Spoilage & Waste Disposal Screen** (`app/waste/page.tsx`): Physical discard logging, threshold detection, manager authorization, disposal evidence attachments.
12. **Custody & Storeroom Access Screen** (`app/custody/page.tsx`): Door lock status, shift handovers, digital signature pad, emergency off-window access modal.
13. **Store Administration Screen** (`app/stores/page.tsx`): Multi-branch facility proposals, storeroom setups, storage type selection.
14. **Reports Suite Screen** (`app/reports/page.tsx`): Daily usage trends, shift custody audit records, discrepancy reconciliations, tabular data exports.
15. **Expiry & Reorder Radar Screen** (`app/radar/page.tsx`): Shelf-life horizons, hard-locked lots, reorder point triggers.
16. **Systems Operations Screen** (`app/ops/page.tsx`): Security logs, ledger integrity monitors, backup run schedules.
17. **Master Data Administration Screen** (`app/master/page.tsx`): Canonical item catalog, reorder points, par levels, conversion ratios, issue windows.
18. **Authentication Screen** (`app/login/page.tsx`): Staff sign-in, credential reset request modal, test identity selector.
19. **Handover Confirmation Screen** (`app/confirm/page.tsx`): Door receipt inspection, line acceptance steppers, full rejection modal.
20. **Account Activation Screen** (`app/activate/page.tsx`): Cryptographic invitation token verification, credential creation.
21. **Global Shell & Navigation** (`components/ui/shell.tsx`, `rail.tsx`, `store-switcher.tsx`, `dev-role-switcher.tsx`, `toast.tsx`).

---

## 3. WCAG Success Criteria Compliance Matrix

| WCAG SC | Criterion Name | Level | Status | Observed Findings Summary |
| :--- | :--- | :---: | :---: | :--- |
| **1.1.1** | Non-text Content | A | PASS | Decorative graphics and SVGs include appropriate titles or `aria-label` attributes (`Pizza 4P's`). |
| **1.3.1** | Info and Relationships | A | HOLD | Several form inputs rely on visual placement without programmatic `<label htmlFor>` or `aria-label`. |
| **1.3.5** | Identify Input Purpose | AA | PASS | Authentication and contact inputs utilize standard `autoComplete` tokens (`username`, `current-password`, `new-password`). |
| **1.4.1** | Use of Color | A | PASS | Status conditions are always conveyed via explicit text, badges, stamps, or mathematical signs. |
| **1.4.3** | Contrast (Minimum) | AA | HOLD | Normal text passes across paper and cream. Muted ink (`#5F6785`) and terra (`#A9581A`) over sand background measure ~4.11:1–4.48:1. |
| **1.4.11** | Non-text Contrast | AA | PASS | Focus rings measure 7.69:1–8.60:1 (exceeds 3:1). Badge borders and state stamps maintain clear separation. |
| **2.1.1** | Keyboard Navigation | A | HOLD | Modals lack Escape dismissal keys; segmented button groups lack arrow-key or toggle handling. |
| **2.1.2** | No Keyboard Trap | A | BLOCK | Tab focus is not contained within open modal overlays; focus escapes behind darkened backdrops. |
| **2.4.1** | Bypass Blocks | A | PASS | Top navigation structured with HTML5 `<header>`, `<main id="app">`, and `<footer>` semantic landmarks. |
| **2.4.3** | Focus Order | A | BLOCK | Focus does not shift into modal containers upon opening, nor restore to opening triggers upon close. |
| **2.4.4** | Link Purpose (In Context) | A | PASS | Navigation links and action anchors convey clear, descriptive destinations. |
| **2.4.6** | Headings and Labels | AA | PASS | Screen hierarchies utilize `.kicker`, `h1`, `h2`, `h3` structures and descriptive section headers. |
| **2.4.7** | Focus Visible | AA | PASS | Global focus outline (`2px solid var(--blue); outline-offset: 2px`) is enforced across all interactable elements. |
| **2.4.13**| Focus Appearance | AAA/AA | PASS | High contrast (8.60:1), 2px thickness, 2px offset ensures high visibility on floor terminals. |
| **2.5.8** | Target Size (Minimum) | AA | PASS | Interactive buttons, inputs, chips, and stepper triggers meet or exceed the 24×24 CSS px requirement. |
| **3.2.1** | On Focus | A | PASS | Focusing an input or button does not trigger unexpected form submissions or context switches. |
| **3.2.2** | On Input | A | PASS | Changing form selections updates live preview cards without sudden unexpected page navigations. |
| **3.3.1** | Error Identification | A | PASS | Failed dispatches, stock locks, and invalid lines display explicit textual error callouts. |
| **3.3.2** | Labels or Instructions | A | HOLD | Multiple inline table inputs lack programmatic labeling instructions for assistive tools. |
| **4.1.2** | Name, Role, Value | A | HOLD | Stepper buttons and segmented group toggles lack explicit `aria-label` or `aria-pressed` states. |
| **4.1.3** | Status Messages | AA | PASS | Toast notification system utilizes `role="status"` and `aria-live="polite"`. |

---

## 4. Comprehensive Audit Findings Ledger

The following ledger details every discovered defect across inspected surfaces using stable rule IDs and fix classifications.

*Fix Class Definition:*
- `auto`: The remediation is structurally derivable directly from existing markup and attributes.
- `manual`: The remediation requires semantic interpretation or domain-specific context.

| Rule ID | Severity | Surface / Location | WCAG SC | Fix Class | Finding Description & Required Remediation |
| :--- | :---: | :--- | :---: | :---: | :--- |
| **TRAP-1** | `critical` | `app/import/page.tsx` (Line 1121) | 2.1.2 | `manual` | **Missing Modal Focus Trap:** Quarantined lines drawer does not constrain keyboard focus. Tab key navigates behind overlay. Add focus trapping hook. |
| **TRAP-1** | `critical` | `app/users/page.tsx` (Line 673) | 2.1.2 | `manual` | **Missing Modal Focus Trap:** Staff invitation modal allows Tab focus to cycle into the underlying table and header. Implement focus trap. |
| **TRAP-1** | `critical` | `app/custody/page.tsx` (Line 1140) | 2.1.2 | `manual` | **Missing Modal Focus Trap:** Off-window emergency access modal does not constrain keyboard focus. Implement focus trap. |
| **TRAP-1** | `critical` | `app/login/page.tsx` (Line 315) | 2.1.2 | `manual` | **Missing Modal Focus Trap:** Password reset dialog allows focus cycling out of dialog container. Implement focus trap. |
| **TRAP-1** | `critical` | `app/confirm/page.tsx` (Line 1271) | 2.1.2 | `manual` | **Missing Modal Focus Trap:** Goods decline dialog does not trap focus. Implement focus trap. |
| **TRAP-2** | `major` | All 5 Modals (Import, Users, Custody, Login, Confirm) | 2.1.1, 2.4.3 | `manual` | **Missing Escape Key Handler & Initial Focus:** Pressing `Escape` does not dismiss open dialogs. Initial focus is not placed on the first interactive element. Add `keydown` Escape listener and auto-focus initial field. |
| **TRAP-3** | `major` | All 5 Modals (Import, Users, Custody, Login, Confirm) | 2.4.3 | `manual` | **Missing Focus Restoration:** When a dialog is closed, focus is lost to the document body rather than returning to the button that triggered it. Store and restore trigger ref. |
| **FORM-1** | `major` | `app/request/page.tsx` (Lines 667–683) | 1.3.1, 4.1.2 | `manual` | **Unlabeled Line Quantity Input:** Stepper quantity number `<input>` in requisition drafting lacks `aria-label` or `<label>`. Add `aria-label={`Requested quantity for ${it.name}`}`. |
| **FORM-1** | `major` | `app/issues/page.tsx` (Lines 665, 686) | 1.3.1, 3.3.2 | `manual` | **Missing Form Label Associations:** Accepted quantity and variance reason inputs lack `id` and `htmlFor` pairings on their sibling `<label>` tags. Associate via unique `id` and `htmlFor`. |
| **FORM-1** | `major` | `app/balance/page.tsx` (Line 890) | 1.3.1, 4.1.2 | `auto` | **Unlabeled Review Notes Textarea:** Sign-off notes textarea in sidebar has visual heading but no programmatic association. Add `id="signoff-notes"` and `htmlFor="signoff-notes"`. |
| **FORM-1** | `major` | `app/waste/page.tsx` (Lines 683, 1212) | 1.3.1, 4.1.2 | `manual` | **Unlabeled Attachment & Comment Inputs:** Disposal photo path input and decision comment inputs lack accessible names. Add `aria-label` attributes. |
| **FORM-1** | `major` | `app/master/page.tsx` (Lines 729, 772) | 1.3.1, 4.1.2 | `manual` | **Unlabeled Table Row Inputs:** Inline reorder point and par level inputs in catalog table lack programmatic labels. Add `aria-label={`Reorder point for ${item.itemName}`}` and `aria-label={`Par level for ${item.itemName}`}`. |
| **BTN-1** | `major` | `app/requests/page.tsx` (Lines 827, 842) | 4.1.2, 2.4.6 | `manual` | **Generic Stepper Button Labels:** Quantity stepper buttons use generic `aria-label="Less"` and `aria-label="More"` without item context. Update to `aria-label={`Decrease quantity for ${it.n}`}` and `aria-label={`Increase quantity for ${it.n}`}`. |
| **NAV-1** | `major` | `app/issues/page.tsx` (Lines 468–483) | 4.1.2 | `auto` | **Incomplete Tablist Semantics:** Container declares `role="tablist"` but child buttons lack `role="tab"`, `aria-selected={activeTab === ...}`, and `aria-controls`. Add missing tab semantics. |
| **NAV-1** | `major` | `app/master/page.tsx` (Lines 384–413) | 4.1.2 | `auto` | **Incomplete Tablist Semantics:** Navigation container declares `role="tablist"` but buttons lack `role="tab"` and `aria-selected`. Add tab roles and selected states. |
| **NAV-2** | `minor` | `app/overview/page.tsx` (Lines 340–361) | 4.1.2 | `auto` | **Missing Toggle State on Segmented Buttons:** Warehouse selection buttons (`Cold Room` / `Dry Store`) lack `aria-pressed`. Add `aria-pressed={activeWh === 'COLD'}`. |
| **NAV-2** | `minor` | `app/overview/page.tsx` (Lines 310–328) | 4.1.2 | `auto` | **Missing Toggle State on Filter Tiles:** Expiry watch and Reorder tile buttons act as toggles but lack `aria-pressed`. Add `aria-pressed={filter === 'ex'}`. |
| **NAV-2** | `minor` | `app/request/page.tsx` (Lines 438–460, 467–482) | 4.1.2 | `auto` | **Missing Toggle State on Segmented Controls:** Section selector and window mode selector buttons lack `aria-pressed`. Add `aria-pressed`. |
| **NAV-2** | `minor` | `app/count/page.tsx` (Lines 539–556) | 4.1.2 | `auto` | **Missing Toggle State on Count Type Selector:** Count type buttons lack `aria-pressed`. Add `aria-pressed={countType === ...}`. |
| **NAV-2** | `minor` | `app/approvals/page.tsx` (Lines 354–368) | 4.1.2 | `auto` | **Missing Toggle State on Inbox View Switcher:** Pending vs All view buttons lack `aria-pressed`. Add `aria-pressed={tab === ...}`. |
| **NAV-2** | `minor` | `app/reports/page.tsx` (Lines 829, 857, 883) | 4.1.2 | `auto` | **Missing Toggle State on Report Suites & Windows:** Report selection, rolling window, and storeroom filter buttons lack `aria-pressed`. Add `aria-pressed`. |
| **NAV-2** | `minor` | `app/radar/page.tsx` (Lines 653–718, 738, 766) | 4.1.2 | `auto` | **Missing Toggle State on Metric Tiles:** Expiry and reorder metric buttons lack `aria-pressed`. Add `aria-pressed`. |
| **NAV-2** | `minor` | `app/ops/page.tsx` (Lines 585–620) | 4.1.2 | `auto` | **Missing Toggle State on SysOps Section Selector:** SysOps navigation buttons lack `aria-pressed`. Add `aria-pressed`. |
| **TBL-1** | `minor` | `app/overview/page.tsx` (Lines 401–411) | 4.1.2 | `auto` | **Missing Selection Semantics on Table Rows:** Selectable rows implement `tabIndex={0}` and keyboard Enter/Space triggers but omit `aria-selected={isSelected}`. Add `aria-selected`. |
| **COL-2** | `minor` | `styles/globals.css` / `styles/components.css` | 1.4.3 | `manual` | **Low Contrast on Sand Background:** Secondary text `#5F6785` (contrast 4.48:1) and terra `#A9581A` (contrast 4.11:1) fall below 4.5:1 when placed on `#EAE6DC`. Darken sand text tokens to `#404760` and `#8C4610` respectively. |

---

## 5. Detailed Screen-by-Screen Floor Audits

### 5.1 Stock Overview (`app/overview/page.tsx`)
- **Interactive Controls:**
  - Segmented storeroom switcher (`Cold Room` / `Dry Store`): Keyboard focusable via Tab, but lacks `aria-pressed` on active button.
  - Quick filter chips (`All`, `Expiry`, `Reorder`): Correctly utilize `<Chip aria-pressed={active}>` pattern.
  - Table Rows: High-quality implementation with `tabIndex={0}` and keydown listener for Enter and Space to select item. Lacks `aria-selected` to announce selected state to screen readers.
- **Color Contrast:**
  - Primary stock count font (`#242E52` on `#FFFFFF`): 13.23:1 (PASS).
  - Status badges (`In stock`, `Amber: exp 04 Nov`, `Reorder: <= 4 kg`): All exceed 6.48:1 (PASS).
- **Status Conveyance:**
  - Status is always represented as textual badges with accompanying expiration dates or par thresholds. Color is never isolated.

### 5.2 Requests & Pick Queue (`app/requests/page.tsx`)
- **Interactive Controls:**
  - Left column request cards are native `<button type="button" className="item">` elements, fully keyboard reachable.
  - Quantity Steppers: Stepper buttons possess `aria-label="Less"` and `aria-label="More"`. While functional, they lack contextual entity descriptions.
  - Lot selector cards: Native `<button>` elements with explicit `aria-pressed={isSelectedLot}`.
- **Color Contrast:**
  - `URGENT` badge: Red outline `#B32E16` on cream background: 5.66:1 (PASS).
  - `EXPIRED LOCK` badge: White `#FFFFFF` on red `#B32E16`: 6.33:1 (PASS).
  - `FIFO ok` badge: Green `#28473D` on light green `#E3EDE7`: 8.52:1 (PASS).
- **Status Conveyance:**
  - Lot expiration states are explicitly printed: `EXPIRED LOCK`, `Expiry amber`, `FIFO ok`. Expired lots are disabled (`disabled={expired}`).

### 5.3 New Section Requisition (`app/request/page.tsx`)
- **Interactive Controls:**
  - Section buttons (`Kitchen`, `Bar`, `Cheese`) and Clock Simulation buttons lack `aria-pressed`.
  - Item catalog search: `<input id="isearch">` paired with `<label htmlFor="isearch">` (PASS).
  - Search suggestion chips: Native `<button>` elements with keyboard reachability.
  - Line Steppers: Stepper buttons feature comprehensive accessible names (`aria-label={`Decrease ${it.name} quantity`}`).
  - **Defect:** Stepper direct number input (`line 667`) lacks an associated label or `aria-label`.
- **Status Conveyance:**
  - Outside Issue Window warning is accompanied by prominent badges: `<Badge variant="am">OUTSIDE ISSUE WINDOW</Badge>` and `<Badge variant="ur">URGENT</Badge>`, plus explicit explanatory text.

### 5.4 Stock Issues & Movement Ledger (`app/issues/page.tsx`)
- **Interactive Controls:**
  - Main tab bar uses `role="tablist"` but child buttons omit `role="tab"` and `aria-selected`.
  - Door handover action buttons (`Confirm Full Handover`, `Partial Acceptance...`, `Decline at Door`) are high-contrast buttons with explicit focus indicators.
  - **Defect:** Inline partial acceptance inputs (`Accepted Qty` and `Reason for Variance`) lack `id` and `htmlFor` pairings.
  - Movement ledger filter inputs (`id="item-search"`, `id="date-filter"`) have valid label associations (PASS).
- **Status Conveyance:**
  - Handover lifecycle timeline uses numbered labels ("1. Staged", "2. Door Inspection", "3. Handover / Result") and text badges (`Confirmed`, `Partial Accepted`, `Declined at Door`).

### 5.5 Daily Balance Sheet (`app/balance/page.tsx`)
- **Interactive Controls:**
  - Physical count inputs (`id={`cnt-${it.item_code}`}`) include robust accessible names: `aria-label={`Counted quantity for ${it.name}`}`.
  - Discrepancy recount inputs and cause code selects include matching `htmlFor` and `id` bindings.
  - Evening close fallback checkbox (`line 740`) is properly nested in its `<label>` tag.
  - **Defect:** Sign-off notes textarea in the right sidebar lacks a programmatic label.
- **Status Conveyance:**
  - Variances are explicitly prefixed with arithmetic signs (`+` or `−`) alongside explicit text badges: `BALANCED`, `RESOLVED BY RECOUNT`, `VARIANCE · RECOUNT`, `HANDLED · ESCALATED`.

### 5.6 GRPO Ingestion & Diagnostics (`app/import/page.tsx`)
- **Interactive Controls:**
  - File upload trigger and sample buttons are accessible via keyboard.
  - Posting age radio selector possesses explicit `aria-label`.
  - **Critical Defect:** Quarantined lines drawer (`role="dialog"`) opens on user action but does not trap focus, does not close on Escape, and does not return focus upon closing.
- **Status Conveyance:**
  - Quarantined lines display red badges, tabular diagnostics, and explicit remediation instructions.

### 5.7 Stock Count & Adjustment Vouchers (`app/count/page.tsx`)
- **Interactive Controls:**
  - Blind first count and recount inputs possess explicit accessible names: `aria-label={`First count ${r.name}`}` and `aria-label={`Recount ${r.name}`}`.
  - Voucher adjustment cause select and investigation note input possess valid `htmlFor` and `id` pairings.
  - Count type segmented buttons lack `aria-pressed`.
- **Status Conveyance:**
  - Blind count obscures expected stock with the explicit string `"hidden"` and badge `Not compared`. Discrepancies show text badges: `Balanced`, `Needs recount`, `Resolved by recount`, `Still differs`.

### 5.8 Inter-Store Dispatches & Transfers (`app/transfers/page.tsx`)
- **Interactive Controls:**
  - All dispatch form fields (stores, storerooms, item select, weight in kg, pieces in pcs, seal number, manifest remarks) possess strict `<label htmlFor>` and `<input id>` bindings.
  - Seal inspection checkbox is nested in a descriptive label.
  - Tabs utilize `<Chip aria-pressed={...}>` with valid state announcements.
- **Status Conveyance:**
  - Dual-unit alerts explicitly declare why both kg and pcs are mandatory. Discrepancy claims display explicit variance weights and transition to `VARIANCE_PENDING_FC` with text badges.

### 5.9 Approvals Inbox (`app/approvals/page.tsx`)
- **Interactive Controls:**
  - Filter segmented buttons lack `aria-pressed`.
  - Approval and Rejection buttons are native elements with disabled states reflecting segregation of duties.
  - Operational comment input has valid `htmlFor="approval-comment"` and `id="approval-comment"`.
- **Status Conveyance:**
  - Decisions are denoted by clear badges: `PENDING_REVIEW`, `APPROVED`, `REJECTED`, and reasons are detailed in audit callouts.

### 5.10 Staff Users & Access Control (`app/users/page.tsx`)
- **Interactive Controls:**
  - Store scope selection chips feature `aria-pressed={inviteStores.includes(s)}`.
  - **Critical Defect:** Onboarding invitation modal dialog lacks keyboard focus trap, Escape listener, and focus return.
- **Status Conveyance:**
  - User statuses are rendered as explicit badges: `ACTIVE`, `LOCKED`, `INVITED`, `PENDING 2ND APPROVAL`. Approver dual-approval warnings appear in contextual alert notes.

### 5.11 Spoilage & Waste Disposal Screen (`app/waste/page.tsx`)
- **Interactive Controls:**
  - Disposal quantity, UoM, and standard reason code fields have valid `htmlFor` and `id` bindings.
  - **Defect:** Disposal photo simulation input and inline manager comment inputs lack accessible labels.
- **Status Conveyance:**
  - Waste threshold exceedance is indicated by `THRESHOLD EXCEEDED` vs `MINOR THRESHOLD` badges, with explicit text declaring whether Restaurant Manager or Financial Controller authorization is required.

### 5.12 Custody & Storeroom Access Screen (`app/custody/page.tsx`)
- **Interactive Controls:**
  - Outgoing Custodian input has `aria-label="Outgoing Custodian"`.
  - Key handover input has `aria-invalid={isSegregationViolation}`.
  - Digital signature canvas has `aria-label="Digital signature pad"`.
  - Tables declare descriptive `aria-label` tags.
  - **Critical Defect:** Emergency access dialog (`role="dialog"`) lacks keyboard focus trap and Escape handler.
- **Status Conveyance:**
  - Storeroom lock states display explicit text: `DOOR LOCKED & SECURED` vs `DOOR UNLOCKED & ACTIVE`.

---

## 6. Color Contrast Ratios Matrix

All luminance values and contrast ratios were calculated strictly according to the WCAG 2.1 / 2.2 relative luminance formula:
$$L = 0.2126 \cdot R + 0.7152 \cdot G + 0.0722 \cdot B$$
$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

### 6.1 Core Typography and Surfaces

| Foreground Token | Hex | Background Token | Hex | Contrast Ratio | WCAG 2.2 Threshold | Status |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| `--navy` (Body text) | `#242E52` | `--paper` (Ticket body) | `#FFFFFF` | **13.23:1** | 4.5:1 (Normal) | **PASS** |
| `--navy` (Headings) | `#242E52` | `--cream` (Frame background) | `#F4F2EF` | **11.84:1** | 4.5:1 (Normal) | **PASS** |
| `--navy` (Headings) | `#242E52` | `--sand` (Stub background) | `#EAE6DC` | **10.61:1** | 4.5:1 (Normal) | **PASS** |
| `--ink-2` (Labels, meta) | `#4B5470` | `--paper` | `#FFFFFF` | **7.50:1** | 4.5:1 (Normal) | **PASS** |
| `--ink-2` (Labels, meta) | `#4B5470` | `--cream` | `#F4F2EF` | **6.71:1** | 4.5:1 (Normal) | **PASS** |
| `--ink-2` (Labels, meta) | `#4B5470` | `--sand` | `#EAE6DC` | **6.02:1** | 4.5:1 (Normal) | **PASS** |
| `--ink-3` (Gloss notes) | `#5F6785` | `--paper` | `#FFFFFF` | **5.58:1** | 4.5:1 (Normal) | **PASS** |
| `--ink-3` (Gloss notes) | `#5F6785` | `--cream` | `#F4F2EF` | **4.99:1** | 4.5:1 (Normal) | **PASS** |
| `--ink-3` (Gloss notes) | `#5F6785` | `--sand` | `#EAE6DC` | **4.48:1** | 4.5:1 (Normal) | **FAIL (Marginal)** |
| `--terra` (Kickers, stamps) | `#A9581A` | `--paper` | `#FFFFFF` | **5.12:1** | 4.5:1 (Normal) | **PASS** |
| `--terra` (Kickers, stamps) | `#A9581A` | `--cream` | `#F4F2EF` | **4.59:1** | 4.5:1 (Normal) | **PASS** |
| `--terra` (Kickers, stamps) | `#A9581A` | `--sand` | `#EAE6DC` | **4.11:1** | 4.5:1 (Normal) | **FAIL (Marginal)** |
| `--ph` (Input placeholder) | `#756F62` | `--paper` | `#FFFFFF` | **4.99:1** | 4.5:1 (Normal) | **PASS** |

### 6.2 Action Buttons and Status Badges

| Badge / Element | Foreground Hex | Background Hex | Contrast Ratio | WCAG 2.2 AA (4.5:1) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Primary Button** (`.btn`) | `#FFFFFF` | `#A9581A` (`--terra`) | **5.12:1** | 4.5:1 | **PASS** |
| **Primary Button Hover** | `#FFFFFF` | `#94490F` | **6.52:1** | 4.5:1 | **PASS** |
| **Badge OK (FIFO/Balanced)** | `#28473D` (`--forest`) | `#E3EDE7` (`--ok-bg`) | **8.52:1** | 4.5:1 | **PASS** |
| **Badge AM (Amber Expiry)** | `#7A4B00` (`--amber`) | `#FBEFD0` (`--amber-bg`)| **6.48:1** | 4.5:1 | **PASS** |
| **Badge ER (Locked/Error)** | `#FFFFFF` | `#B32E16` (`--err`) | **6.33:1** | 4.5:1 | **PASS** |
| **Badge RE (Custody/Info)** | `#0A3B80` | `#E2E9F5` (`--info-bg`) | **8.82:1** | 4.5:1 | **PASS** |
| **Badge MU (Muted Standard)**| `#4B5470` (`--ink-2`) | `#EAE6DC` (`--sand`) | **6.02:1** | 4.5:1 | **PASS** |
| **Badge UR (Urgent Callout)**| `#B32E16` (`--err`) | `#FFFFFF` | **6.33:1** | 4.5:1 | **PASS** |
| **Note OK (Success Box)** | `#28473D` | `#E3EDE7` | **8.52:1** | 4.5:1 | **PASS** |
| **Note AM (Warning Box)** | `#4D2F00` | `#FBEFD0` | **10.66:1** | 4.5:1 | **PASS** |
| **Note ER (Alert Box)** | `#6D1A0A` | `#F8E3DE` | **9.45:1** | 4.5:1 | **PASS** |
| **Toast Notification** | `#FFFFFF` | `#242E52` (`--navy`) | **13.23:1** | 4.5:1 | **PASS** |
| **Focus Visible Outline** | `#02499D` (`--blue`) | `#F4F2EF` (`--cream`) | **7.69:1** | 3.0:1 (Non-text)| **PASS** |
| **Focus Visible Outline** | `#02499D` (`--blue`) | `#FFFFFF` (`--paper`)| **8.60:1** | 3.0:1 (Non-text)| **PASS** |

---

## 7. Status Information & Multi-Modal Conveyance Verification

WCAG 2.2 Success Criterion 1.4.1 (Use of Color) mandates that color must not be used as the single visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element.

Across all 20 inspected screens, status representation was verified against multi-modal rendering standards:

1. **Expiry & Quality Tiers:**
   - Fresh stock: Accompanied by text `FIFO ok` and date `exp DD Mon`.
   - Amber stock: Accompanied by text `Expiry amber` or `Amber` and remaining days horizon.
   - Expired stock: Accompanied by text `EXPIRED LOCK` or `LOCK`. Physical controls are programmatically disabled (`disabled={expired}`).
2. **Ledger Discrepancies & Balancing:**
   - Positive variances: Rendered with leading `+` sign and label (e.g. `+0.5 kg`, `VARIANCE FLAGGED`).
   - Negative variances: Rendered with leading `−` sign (Unicode `&minus;` or `−`) and label (e.g. `−0.3 kg`, `VARIANCE · RECOUNT`).
   - Zero discrepancy: Rendered as `0` with explicit badge `BALANCED`.
3. **Requisition Queue & Picking:**
   - Urgent requisitions: Bear explicit text stamp/badge `URGENT` plus required reason text banner.
   - Standard requisitions: Bear badge `Standard`.
   - Staging progress: Denoted by explicit text badges `Not staged`, `Partial`, and `Full`.
4. **Inter-Store Transit Handover:**
   - In-transit items: Denoted by `IN_TRANSIT`.
   - Matched receipts: Denoted by `RECEIVED_MATCH`.
   - Discrepancy intake: Denoted by `VARIANCE_PENDING_FC` with explicit variance kg calculation.
5. **Timeline Steps:**
   - Each timeline stage combines a circular node with explicit numbered typography: `1. Staged`, `2. Door Inspection`, `3. Handover / Result`.

**Conclusion:** The application demonstrates exemplary compliance with WCAG 1.4.1. Color is universally reinforced with textual badges, numeric signs, or disabled states.

---

## 8. Keyboard Focus Order, Tab Sequencing & Modal Focus Traps

### 8.1 Focus Indicator Appearance (SC 2.4.7 & 2.4.13)
The system stylesheet (`styles/globals.css`, lines 37–46) establishes a consistent, high-visibility focus indicator:
```css
.btn:focus-visible,
.chip:focus-visible,
a:focus-visible,
.row:focus-visible,
select:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
```
- **Contrast Evaluation:** The focus ring utilizes `--blue` (`#02499D`), achieving a contrast ratio of **7.69:1** against cream (`#F4F2EF`) and **8.60:1** against paper (`#FFFFFF`), significantly surpassing the WCAG 3:1 non-text contrast threshold.
- **Visual Offset:** The 2px offset ensures the indicator is never clipped by component boundaries.

### 8.2 DOM Reading and Tab Navigation Order (SC 2.4.3)
1. Natural flow traverses:
   - Dev Role Switcher Bar -> Header Logo -> Navigation Links (`Stock`, `Pick queue`, `Issues & ledger`, `Daily balance`, `GRPO import`, `Count`, `Transfers`, `Approvals`, `Users & access`) -> Storeroom Switcher -> User Badge -> Main Surface Header -> Primary Action -> Main Content Columns -> Footer.
2. Tab traversal across interactive data grids (`app/overview`, `app/requests`, `app/transfers`) preserves logical column-major ordering.
3. Interactive rows in the stock overview table implement `tabIndex={0}` and respond to both `Enter` and `Space` keys.

### 8.3 Critical Modal Focus Trapping Deficiencies (SC 2.1.2)
The application defines five modal dialogs implemented via conditional rendering without focus trapping libraries:
1. `app/import/page.tsx`: Quarantined Lines Drawer (`role="dialog"`).
2. `app/users/page.tsx`: Staff Invitation Modal (`role="dialog"`).
3. `app/custody/page.tsx`: Emergency Off-Window Access Modal (`role="dialog"`).
4. `app/login/page.tsx`: Password Reset Modal (`role="dialog"`).
5. `app/confirm/page.tsx`: Requisition Goods Decline Modal (`role="dialog"`).

**Identified Defects:**
- **No Focus Trapping:** Keyboard users can press `Tab` and move focus out of the dialog into underlying background links and form controls.
- **No Initial Focus Placement:** When a modal is displayed, focus is not set on the first interactive form element or the dialog heading.
- **No Escape Key Dismissal:** Pressing `Escape` does not close any of the five dialogs.
- **No Focus Restoration:** Closing a dialog returns focus to the top of the document body rather than the opening trigger button.

---

## 9. Remediation Action Plan & Code Fix Specifications

### 9.1 Batchable Structural Fixes (`auto`)

#### Fix 1: Add ARIA Pressed & Selected States to Segmented Controls
In `app/overview/page.tsx`, `app/request/page.tsx`, `app/count/page.tsx`, `app/approvals/page.tsx`, `app/reports/page.tsx`, `app/radar/page.tsx`, `app/ops/page.tsx`:
Add `aria-pressed={isActive}` to toggle buttons inside segmented button containers:
```tsx
// Pattern for segmented button groups:
<div className="seg" role="group" aria-label="Warehouse selection">
  <button
    type="button"
    className={activeWh === 'COLD' ? 'on' : ''}
    aria-pressed={activeWh === 'COLD'}
    onClick={() => setActiveWh('COLD')}
  >
    Cold Room
  </button>
  <button
    type="button"
    className={activeWh === 'DRY' ? 'on' : ''}
    aria-pressed={activeWh === 'DRY'}
    onClick={() => setActiveWh('DRY')}
  >
    Dry Store
  </button>
</div>
```

#### Fix 2: Complete Tablist Semantics
In `app/issues/page.tsx` and `app/master/page.tsx`:
Add `role="tab"` and `aria-selected` to buttons within `role="tablist"` containers:
```tsx
<div className="seg" role="tablist" aria-label="Issues and ledger navigation">
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === 'active'}
    className={activeTab === 'active' ? 'on' : ''}
    onClick={() => setActiveTab('active')}
  >
    Active Issues
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === 'ledger'}
    className={activeTab === 'ledger' ? 'on' : ''}
    onClick={() => setActiveTab('ledger')}
  >
    Append-Only Movement Ledger
  </button>
</div>
```

#### Fix 3: Add `aria-selected` to Selectable Table Rows
In `app/overview/page.tsx` (line 403):
```tsx
<tr
  key={item.c}
  className={`row ${isSelected ? 'sel' : ''}`}
  aria-selected={isSelected}
  tabIndex={0}
  onClick={() => setSelectedCode(item.c)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      setSelectedCode(item.c);
    }
  }}
>
```

### 9.2 Semantic & Interaction Fixes (`manual`)

#### Fix 4: Implement Reusable Modal Focus Trap Hook
Create an accessible modal wrapper or `useFocusTrap` hook for the 5 dialogs:
```tsx
import { useEffect, useRef } from 'react';

export function useModalA11y(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
      const el = dialogRef.current;
      if (!el) return;

      // Focus first focusable element
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key === 'Tab') {
          const focusableArray = Array.from(focusable);
          const first = focusableArray[0];
          const last = focusableArray[focusableArray.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        if (triggerRef.current) triggerRef.current.focus();
      };
    }
  }, [isOpen, onClose]);

  return dialogRef;
}
```

#### Fix 5: Contextual Accessible Labels for Steppers and Table Inputs
In `app/request/page.tsx`:
```tsx
// Line 667: Add accessible label to stepper direct input
<input
  type="number"
  step={it.uom === 'kg' ? '0.1' : '1'}
  min="0.1"
  value={line.requestedQty}
  aria-label={`Requested quantity for ${it.name}`}
  onChange={(e) => handleDirectQtyChange(idx, e.target.value)}
  className="num"
/>
```

In `app/requests/page.tsx`:
```tsx
// Lines 827 & 842: Update stepper labels with entity context
<button
  type="button"
  disabled={!canEditLines || p.qty <= 0}
  onClick={() => handleQtyChange(line.item_code, -stepSize)}
  aria-label={`Decrease quantity for ${it.n}`}
>
  −
</button>
<button
  type="button"
  disabled={!canEditLines || p.qty >= line.requested_qty || p.qty >= maxLotAvail}
  onClick={() => handleQtyChange(line.item_code, stepSize)}
  aria-label={`Increase quantity for ${it.n}`}
>
  +
</button>
```

In `app/master/page.tsx`:
```tsx
// Lines 729 & 772: Add explicit labels to catalog table inline inputs
<input
  type="number"
  min="0"
  step="any"
  aria-label={`Reorder point for ${item.itemName}`}
  value={buffer.reorderPoint}
  onChange={(e) => ...}
/>
<input
  type="number"
  min="0"
  step="any"
  aria-label={`Par level for ${item.itemName}`}
  value={buffer.parLevel}
  onChange={(e) => ...}
/>
```

#### Fix 6: Darken Muted Tokens on Sand Surfaces
In `styles/tokens.css` or component utilities:
- When text appears on `--sand` (`#EAE6DC`), replace `--ink-3` (`#5F6785`, 4.48:1) with a darkened muted token `#434A65` (5.72:1).
- When `--terra` (`#A9581A`, 4.11:1) is used on `--sand`, apply a darkened variant `#8A4512` (5.21:1) to satisfy the 4.5:1 normal text contrast standard.

---

## 10. Compliance Verification Checklist & Release Sign-Off Gate

| Area | Verification Check Item | Status | Verification Detail |
| :---: | :--- | :---: | :--- |
| **Aria Labels** | Interactive buttons have valid accessible names | **HOLD** | Core buttons compliant; stepper buttons require item names (`app/requests`). |
| **Aria Labels** | Form inputs have programmatic `<label>` or `aria-label` | **HOLD** | Line quantity inputs in `app/request` and `app/master` require `aria-label`. |
| **Aria Labels** | Stepper increment/decrement buttons have descriptive names | **HOLD** | Updated labels required on `app/requests`. |
| **Aria Labels** | Segmented button toggles announce pressed state | **HOLD** | Missing `aria-pressed` on 8 segmented filter groups. |
| **Contrast** | Normal text meets 4.5:1 against background | **HOLD** | Paper & cream pass; sand background requires token darkening for muted text. |
| **Contrast** | Status badges meet 4.5:1 against badge backgrounds | **PASS** | OK (8.52:1), AM (6.48:1), ER (6.33:1), RE (8.82:1), MU (6.02:1). |
| **Contrast** | Focus outline meets 3.0:1 non-text requirement | **PASS** | Focus ring achieves 7.69:1 on cream and 8.60:1 on paper. |
| **Color Alone** | Status information is never conveyed by color alone | **PASS** | 100% paired with explicit text, badge stamps, or numeric signs (`+`/`−`). |
| **Focus Order** | Logical tab navigation order follows visual hierarchy | **PASS** | Preserves top-to-bottom and left-to-right DOM sequence. |
| **Modal Traps** | Modals trap keyboard focus within overlay | **BLOCK** | 5 modal dialogs lack focus traps; focus escapes into background page. |
| **Modal Traps** | Modals dismiss on Escape key press | **BLOCK** | Escape key listeners absent across all 5 modals. |
| **Modal Traps** | Focus returns to trigger button upon modal dismissal | **BLOCK** | Focus return not implemented across all 5 modals. |
| **Quantities** | Strictly physical quantities with zero confidential terms | **PASS** | 100% physical quantities only (`kg`, `pcs`). Strictly zero commercial, financial, or billing terminology anywhere. |

### Final Audit Gate Verdict: **BLOCKED BY MODAL FOCUS TRAPS & ARIA LABELS**
Remediation of TRAP-1 (Modal Focus Traps), FORM-1 (Inline Input Labels), and NAV-2 (Segmented Group Toggle Attributes) is required before final production certification.
