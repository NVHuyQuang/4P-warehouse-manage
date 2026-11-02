# UI/UX Spec — Inventory Control Tool (Stage 2, phone-first)

Source of truth: `docs/INVENTORY-TOOL-FLOW.md` (v1.6) + `docs/HANDOVER_SESSION_1.md`. Pizza 4P's India, 5–6 stores, >30 concurrent users.

## What it is
Back-of-house stock ledger PWA. Phone-first (390×844 CSS px), Android/Chrome mostly, used in storerooms (cold room underground, signal drops), with wet/gloved hands, glare, in a hurry. English UI. Quantities only: **kg and pieces. NO price/cost anywhere. Ever.**

## Hard behaviour rules (from the doc, design must make them visible)
- Stock is never edited. Every action *appends* a ledger row. Two-stage issue: Keeper stages → `ISSUE_PENDING` (book stock drops at once) → Runner confirms (`ISSUE_PENDING_OFFSET` +Q, `ISSUE_CONFIRMED` −Q) or declines (`ISSUE_REVERSAL` +Q). Partial accept: confirm 3 of 5 kg, 2 kg reversal.
- Offline: actions queue on the phone; show queued state; **never auto-retry in a loop** — one persistent manual "Retry" button.
- Role + Scope: top-bar **Store Switcher** (only granted stores). Roles seen on screens: Section Requester (Kitchen/Bar/Cheese), Warehouse Keeper (Admin), Kitchen Runner, Custodian.
- Issue Window: requests inside window = standard; outside = must enter a reason, flagged **URGENT** (never blocked). Window times are `[Owner to set]` → use clearly-labelled sample times.
- Requester may edit qty / cancel until Keeper starts picking, then locked.
- FIFO pick; expiry radar only for flagged categories: amber = within warning days, red **EXPIRED LOCK** = cannot be selected.
- Daily balance: Expected = Opening + Received − Issued; Custodian counts benchmark items; Diff ≠ 0 → recount → document cause → alert Finance Lead/RM; Diff = 0 → sign.
- Reorder: book stock ≤ reorder point → suggested qty = max(0, par − stock − open PO). User-defined values.
- Segregation: the person who logs cannot approve. Not needed on these 5 screens, but never show an "approve" button to the wrong role.

## The 5 screens (identical content in all 3 directions — only design differs)
Store in all: `IND-DEL-01` (Delhi store, sample). Warehouses: Cold Room `WH-DEL01-COLD`, Dry Store `WH-DEL01-DRY`. No real people names: use role titles only.

1. **Home / Stock** (Keeper, Cold Room). Store switcher, warehouse switch, window status (open, closes 11:30, sample), offline/sync state, 4 work tiles: Pick queue 4 (1 urgent) · Awaiting runner 1 · Expiry watch 2 · Reorder 3. Stock list with book qty + status: Mozzarella block 42.5 kg, Fresh basil 3.2 kg (reorder), Burrata 18 pcs (expiry amber), Chicken breast 26.0 kg, Pizza dough ball 140 pcs, Salmon fillet 9.4 kg (expiry red).
2. **New request** (Kitchen Requester). Search item, lines with qty steppers + unit (kg/pcs), needed-by time, submit. Show both states: inside window (standard) and outside window (reason field + URGENT badge). List "My requests" with status chips (Queued, Picking-locked, Cancelled) and edit/cancel only where allowed.
3. **Pick queue** (Keeper). One request: Kitchen, 3 lines. Each line: FIFO lot list (lot id, received date, expiry), amber warning lot, red EXPIRED LOCK lot (unselectable), stage qty (full/partial), "Stage & hand to runner" → shows the ledger row it will append (`ISSUE_PENDING −5.0 kg`).
4. **Door confirm** (Runner). Issued vs received per line; Accept all / adjust qty / Decline; partial example (issued 5.0 kg, accepted 3.0 kg → 2.0 kg back to shelf); final confirm button; result panel showing ledger effect (`ISSUE_PENDING_OFFSET +5.0`, `ISSUE_CONFIRMED −3.0`, shelf +2.0).
5. **Daily balance** (Custodian). Benchmark items table: Opening, Received, Issued → Expected (computed), Counted (input), Diff (live). One line with diff ≠ 0 triggers recount/cause UI; others diff 0. Sign-off button disabled until diff handled. Data: Mozzarella opening 50.0 recv 0.0 issued 7.5 expected 42.5; Fresh basil opening 4.0 recv 2.0 issued 2.8 expected 3.2 (counted 3.0 → diff −0.2); Pizza dough opening 200 recv 0 issued 60 expected 140.

Extra states each direction must show somewhere: offline banner with queued count + manual Retry; empty/locked states as needed.

## Honest-content rules
No fake people, no fake prices, no logo wall. Brand logo not fetched (asset download needs approval): use a plain text wordmark "Pizza 4P's" — flagged placeholder. Times/thresholds are samples; label "sample" once, small.

## Deliverable format (all 3 directions)
- One self-contained HTML per direction (inline CSS+JS, no build step, vanilla JS, no React). Google Fonts `<link>` allowed.
- Presentation board = designed poster (title zone, one-line positioning, screen labels) with the 5 phones **all interactive** (tabs/steppers/toggles/sheets work). Phone = minimal plain rounded bezel, 390×844, **no notch / camera island / fake status bar**. Phone width ≥300px on board (use CSS `zoom`/transform only for scaling; keep text legible).
- Board composition must differ per direction (see directions.md).
- Readability floor: body ≥16px, labels ≥12px, tap targets ≥48px, contrast ≥4.5:1, numerals tabular.
- No template decoration: no all-caps eyebrow over every heading, no `A · B · C` dot strings, no `→` on buttons, no 01/02/03 numbering for non-sequences, no purple gradients, no emoji icons, no left-colour-bar rounded cards.
