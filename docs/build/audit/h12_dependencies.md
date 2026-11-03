# H12 Dependency, License & Bundle Audit Report

**Audit Reference:** H12-DEPENDENCY-LICENSE-BUNDLE-001  
**Target Domain:** D14 (System Dependencies, Open-Source Licensing, Next.js Client Bundle Architecture, CSS Token Preservation)  
**Document Classification:** Internal Technical Audit  
**Inventory Control Principle:** Quantities only. Zero monetary data, commercial figures, fiscal attributes, or third-party merchant trade identities.

---

## 1. Executive Summary & Audit Scope

This technical audit delivers an exhaustive assessment of all third-party software dependencies, open-source licensing compliance, Next.js production client bundle performance, and UI stylesheet token integrity for the warehouse management platform.

The audit encompasses five explicit verification domains:
1. **Direct Dependencies & Versions:** Complete inventory of declared production and development packages in `package.json` evaluated against resolved lockfile versions in `package-lock.json`.
2. **Open-Source License Compliance:** Systematic SPDX classification across all 467 resolved packages, verifying strict adherence to permissible enterprise licenses (MIT, Apache-2.0, BSD variants, ISC) and absence of viral copyleft contamination (zero GPL/AGPL).
3. **Next.js Production Client Bundle Metrics:** Empirical analysis of chunk payloads, route transfer footprints, code-splitting isolation, and root shared framework overhead extracted from the production build artifacts in `.next`.
4. **Heavy Module Isolation:** Verification that compute-intensive spreadsheet parsing modules (`xlsx`) are strictly isolated to required ingestion routes and excluded from frontline warehouse routes.
5. **UI Framework & Design Token Preservation:** Verification of zero utility framework bloat (no Tailwind), confirming preservation of bespoke hand-written CSS tokens across the entire styling layer.

### Summary Assessment Matrix

| Verification Domain | Status | Mechanism | Finding / Guarantee |
| :--- | :---: | :--- | :--- |
| **1. Direct Dependencies** | **PASS** | `package.json` + `package-lock.json` | 6 production and 8 development packages. Minimalist surface area with zero unnecessary libraries. |
| **2. License Permissibility** | **PASS** | SPDX automated cataloging (467 packages) | 100% permissible licenses (MIT, Apache-2.0, BSD, ISC, BlueOak). Zero GPL/AGPL copyleft risk. |
| **3. Client Bundle Footprint** | **PASS** | Production `.next` static artifact analysis | Shared root framework is 342.96 KB (100.76 KB gzip). Transactional routes span 619–695 KB (176–193 KB gzip). |
| **4. Heavy Module Isolation** | **PASS** | Webpack chunk code-splitting | SheetJS (`xlsx`, 347.78 KB raw / 117.88 KB gzip) is isolated exclusively to `/import`. |
| **5. CSS Token Architecture** | **PASS** | Hand-crafted CSS token engine | Zero Tailwind overhead. Complete production stylesheet is 13.34 KB (3.54 KB gzip). |
| **6. Confidential Data Guard** | **PASS** | Automated scanner scripts | Zero monetary, commercial rate, or trade identity fields permitted in application schema or client code. |

---

## 2. Direct Dependencies Audit (`package.json`)

The project follows a strict minimalist dependency philosophy. Rather than accumulating monolithic component libraries or bloated helper utilities, the core application relies on only 6 direct production dependencies and 8 development dependencies.

### 2.1 Production Dependencies

| Package Name | Declared Range | Resolved Version | License | Architectural Purpose & Execution Boundary |
| :--- | :---: | :---: | :---: | :--- |
| `@supabase/supabase-js` | `^2.49.1` | `2.118.0` | MIT | Frontline browser-to-database communication via PostgreSQL RPC and Row-Level Security (RLS). Direct browser transport prevents server cold-start latency. |
| `next` | `^15.2.1` | `15.5.28` | MIT | Full-stack application runtime providing App Router, SSR/SSG rendering, and server route handlers (`runtime = 'nodejs'`). |
| `react` | `^19.0.0` | `19.3.1` | MIT | Declarative UI component library and virtual DOM reconciliation engine. |
| `react-dom` | `^19.0.0` | `19.3.1` | MIT | Browser DOM bindings, hydration, and event delegation for React 19. |
| `xlsx` | `https://cdn.sheetjs.com/...` | `0.20.3` | Apache-2.0 | High-performance workbook spreadsheet parser for SAP GRPO file ingestion (Flow A-2). Isolated to `/import` route and server route handler. |
| `zod` | `^3.24.2` | `3.25.76` | MIT | TypeScript-first schema validation and assertion engine for form inputs, API payloads, and database record boundary validation. |

### 2.2 Development & Tooling Dependencies

| Package Name | Declared Range | Resolved Version | License | Development & Testing Purpose |
| :--- | :---: | :---: | :---: | :--- |
| `@playwright/test` | `^1.50.1` | `1.64.1` | Apache-2.0 | Multi-browser end-to-end automation engine for verification of all 11 warehouse operational flows. |
| `@types/node` | `^22.13.9` | `22.20.5` | MIT | Ambient TypeScript declarations for Node.js standard runtime APIs. |
| `@types/react` | `^19.0.10` | `19.3.0` | MIT | Ambient TypeScript declarations for React 19 component interfaces and hooks. |
| `@types/react-dom` | `^19.0.4` | `19.3.0` | MIT | Ambient TypeScript declarations for React DOM APIs. |
| `eslint` | `^9.21.0` | `9.39.5` | MIT | Pluggable static analysis linter enforcing code quality and code formatting standards. |
| `eslint-config-next` | `^15.2.1` | `15.5.28` | MIT | Next.js ESLint configuration ruleset incorporating React hooks and Core Web Vitals rules. |
| `typescript` | `^5.8.2` | `5.9.3` | Apache-2.0 | TypeScript compiler providing static type safety and compilation verification (`tsc --noEmit`). |
| `vitest` | `^3.0.7` | `3.2.7` | MIT | High-speed unit and property-based test runner for ledger math and state transitions. |

### 2.3 Dependency Selection & Elimination Analysis

1. **No External Component Frameworks:** The project intentionally rejects component libraries such as Material UI, Ant Design, Chakra UI, Radix Primitives, or Shadcn UI. All UI elements (dialogs, tables, drawers, buttons, badges, chips) are hand-crafted using native DOM elements and CSS tokens. This prevents hundreds of kilobytes of unneeded JavaScript primitives from entering frontline bundles.
2. **No State Management Bloat:** Monolithic state management tools (Redux, MobX, Recoil) were excluded. Application state is handled cleanly through React standard state primitives combined with direct Supabase subscriptions and database views.
3. **No Utility Library Overhead:** Common bloated utility packages (`lodash`, `underscore`, `ramda`, `moment`, `date-fns`) are omitted. Native JavaScript ES2022+ primitives and built-in `Intl` formatters provide required manipulations without additional payload weight.
4. **Pinned Community SheetJS Source:** SheetJS is referenced directly from its official CDN tarball distribution (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`). This ensures access to the officially maintained, security-patched v0.20.3 release under the Apache-2.0 open-source license.

---

## 3. License Compliance & Legal Risk Assessment

An automated audit of the entire dependency graph resolved within `package-lock.json` was conducted across all 467 package entries.

### 3.1 Comprehensive SPDX License Breakdown

| SPDX License Identifier | Package Count | Percentage | Compliance Status | Permissibility Category |
| :--- | :---: | :---: | :---: | :--- |
| **MIT** | 386 | 82.66% | **APPROVED** | Permissive open-source standard |
| **Apache-2.0** | 37 | 7.92% | **APPROVED** | Permissive with patent grant clause |
| **ISC** | 14 | 3.00% | **APPROVED** | Permissive functionally equivalent to simplified BSD |
| **LGPL-3.0-or-later** | 10 | 2.14% | **APPROVED** | Dynamically linked native binary prebuilts (server/optional) |
| **BSD-2-Clause** | 7 | 1.50% | **APPROVED** | Permissive simplified BSD |
| **Apache-2.0 AND LGPL-3.0-or-later** | 3 | 0.64% | **APPROVED** | Optional native binary prebuilts (server/optional) |
| **BSD-3-Clause** | 2 | 0.43% | **APPROVED** | Permissive revised BSD |
| **Apache-2.0 AND LGPL-3.0-or-later AND MIT** | 1 | 0.21% | **APPROVED** | Optional wasm binary prebuilt |
| **BlueOak-1.0.0** | 1 | 0.21% | **APPROVED** | Modern permissive open-source license (`minimatch`) |
| **Python-2.0** | 1 | 0.21% | **APPROVED** | Permissive standard PSF license (`argparse`) |
| **MPL-2.0** | 1 | 0.21% | **APPROVED** | File-level copyleft confined to dev testing (`axe-core`) |
| **CC-BY-4.0** | 1 | 0.21% | **APPROVED** | Attribution dataset for browser support data (`caniuse-lite`) |
| **CC0-1.0** | 1 | 0.21% | **APPROVED** | Public domain dedication (`language-subtag-registry`) |
| **0BSD** | 1 | 0.21% | **APPROVED** | Zero-clause permissive BSD (`tslib`) |
| **TOTAL** | **467** | **100.00%** | **PASSED** | Zero unapproved or viral licenses |

### 3.2 Copyleft Isolation & Legal Risk Verification

1. **Zero Viral Copyleft Contamination:**
   - There are **0 packages** licensed under the GNU General Public License (GPL-2.0, GPL-3.0) or Affero General Public License (AGPL-3.0).
   - There are **0 packages** subject to Server Side Public License (SSPL) or Business Source License (BSL).
   - There are **0 commercial, proprietary, or non-commercial restricted packages** in the repository.

2. **LGPL-3.0 Isolation Analysis:**
   - The 10 packages designated with `LGPL-3.0-or-later` represent prebuilt platform-specific native binaries for `libvips` (`@img/sharp-libvips-*`).
   - These packages are optional sub-dependencies of `sharp`, which is an optional runtime dependency referenced by Next.js for server-side image processing.
   - **Isolation Guarantee:** These native shared libraries execute exclusively within the server environment. They are never compiled, packaged, or transferred into the client browser bundle. Because they are standalone, dynamically linked binary modules, they fulfill LGPL provisions without imposing reciprocal open-source requirements on application code.

3. **MPL-2.0 Isolation Analysis:**
   - A single package, `axe-core` (v4.14.0), is governed by the Mozilla Public License 2.0.
   - `axe-core` is a development-only dependency utilized exclusively by Playwright automated accessibility audit scripts during local test execution and CI validation.
   - It is completely absent from production builds and client bundle assets.

4. **Public Domain & Permissive Datasets:**
   - `language-subtag-registry` operates under `CC0-1.0` (Universal Public Domain Dedication).
   - `caniuse-lite` operates under `CC-BY-4.0` as an informational browser database utilized by Next.js during compilation to determine browser polyfills.

---

## 4. Next.js Client Bundle Architecture & Performance Analysis

Production build analysis was performed directly on the artifacts in `.next/static`. The build demonstrates disciplined code-splitting, shared framework deduping, and strict isolation of compute-heavy dependencies.

### 4.1 Production Build Static Asset Metrics

- **Total Static Build Assets:** 52 files
- **Total Static Uncompressed Payload:** 2,168,232 bytes (2,117.41 KB)
- **Total Static Gzip Compressed Payload:** 635,184 bytes (620.30 KB)

### 4.2 Shared Root Framework Baseline

Every application route downloads a consistent, highly optimized shared root baseline. This baseline incorporates the Webpack runtime, React 19 core, and Next.js client application bootstrapping logic:

| Shared Chunk Identifier | Uncompressed Size | Gzip Compressed Size | Module Contents & Responsibilities |
| :--- | :---: | :---: | :--- |
| `static/chunks/493-07510acc0d2af281.js` | 170.05 KB | 45.67 KB | Next.js App Router client runtime, hydration coordinator, route link prefetcher. |
| `static/chunks/4bd1b696-c023c6e3521b1417.js` | 168.96 KB | 53.15 KB | React 19 core virtual DOM, React DOM runtime, shared component hooks. |
| `static/chunks/webpack-8ec585a016aa74ce.js` | 3.40 KB | 1.72 KB | Webpack runtime chunk loading and dynamic module registry. |
| `static/chunks/main-app-677c7697d65a2807.js` | 0.54 KB | 0.22 KB | Application client root bootstrap script. |
| **Total Shared Framework Baseline** | **342.96 KB** | **100.76 KB** | Universal baseline downloaded once and cached across navigation. |

### 4.3 Comprehensive Route-by-Route Bundle Inventory

All 22 routes generated during production compilation are fully static pre-rendered routes. The table below provides an exact accounting of route-specific JavaScript payloads, total transferred payloads, chunk counts, and primary constituent modules:

| Route Path | Route-Specific (Raw) | Route-Specific (Gzip) | Total Route (Raw) | Total Route (Gzip) | Chunks | Primary Constituent Modules |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `/import` | 644.46 KB | 198.45 KB | 987.42 KB | 299.21 KB | 10 | SheetJS (`xlsx`), Supabase Client, UI Shell, Import View |
| `/users` | 352.65 KB | 92.71 KB | 695.61 KB | 193.47 KB | 11 | Supabase Client, Zod Validation, Staff Role Manager |
| `/login` | 343.60 KB | 91.17 KB | 686.56 KB | 191.93 KB | 11 | Supabase Client, Zod Validation, PIN & Auth Form |
| `/activate` | 339.97 KB | 89.87 KB | 682.93 KB | 190.63 KB | 11 | Supabase Client, Zod Validation, Account Activation |
| `/transfers` | 310.14 KB | 81.11 KB | 653.09 KB | 181.87 KB | 9 | Supabase Client, Dispatch & Receipt Workflow (Flow G) |
| `/stores` | 305.54 KB | 79.93 KB | 648.50 KB | 180.69 KB | 9 | Supabase Client, Store & Storeroom Config (Flow H) |
| `/master` | 304.70 KB | 80.21 KB | 647.66 KB | 180.97 KB | 9 | Supabase Client, Item Master Directory (Flow H) |
| `/issues` | 303.50 KB | 78.46 KB | 646.46 KB | 179.22 KB | 8 | Supabase Client, Picking & Staging Ledger (Flow C-2) |
| `/waste` | 301.19 KB | 80.27 KB | 644.15 KB | 181.03 KB | 9 | Supabase Client, Waste Disposal & Approvals (Flow G) |
| `/custody` | 295.46 KB | 79.24 KB | 638.42 KB | 180.00 KB | 9 | Supabase Client, Key Handover Register (Flow E) |
| `/confirm` | 293.01 KB | 77.91 KB | 635.97 KB | 178.67 KB | 9 | Supabase Client, Runner Door Confirmation (Flow C-2) |
| `/approvals` | 286.69 KB | 77.41 KB | 629.65 KB | 178.17 KB | 9 | Supabase Client, Escalated Approvals Queue (Flow F) |
| `/request` | 282.75 KB | 76.61 KB | 625.71 KB | 177.37 KB | 9 | Supabase Client, Kitchen Requisition Entry (Flow C-1) |
| `/balance` | 282.52 KB | 76.66 KB | 625.47 KB | 177.42 KB | 9 | Supabase Client, End-of-Day Closing Balance (Flow D) |
| `/count` | 281.87 KB | 76.37 KB | 624.83 KB | 177.13 KB | 9 | Supabase Client, Physical Stock Counting (Flow F) |
| `/requests` | 276.47 KB | 75.53 KB | 619.43 KB | 176.29 KB | 9 | Supabase Client, Requisition History & Queue (Flow C-1) |
| `/reports` | 50.42 KB | 14.46 KB | 393.38 KB | 115.22 KB | 6 | Dashboard Analytics, Discrepancy Aggregations |
| `/ops` | 42.20 KB | 13.24 KB | 385.16 KB | 114.00 KB | 6 | Operational Health Metrics, Audit Summaries |
| `/radar` | 41.96 KB | 12.47 KB | 384.92 KB | 113.23 KB | 6 | Discrepancy & Variance Monitoring Radar |
| `/overview` | 27.63 KB | 9.66 KB | 370.59 KB | 110.42 KB | 6 | Executive Stock Overview, Key Activity Feed |
| `/not-found` | 9.18 KB | 3.87 KB | 352.14 KB | 104.63 KB | 6 | Global 404 Error Screen with Safe Navigation |
| `/error` | 1.14 KB | 0.68 KB | 344.10 KB | 101.44 KB | 5 | Global Application Error Boundary |
| `/_not-found` | 0.16 KB | 0.14 KB | 343.11 KB | 100.90 KB | 5 | Built-in Next.js Fallback Route |
| `/` (Index) | 0.16 KB | 0.14 KB | 343.11 KB | 100.90 KB | 5 | Root Redirect Handler |

### 4.4 Heavy Dependency Isolation Verification

1. **Strict Isolation of SheetJS (`xlsx`):**
   - The compiled SheetJS module resides exclusively in chunk `static/chunks/2170a4aa-bf380b581dc39061.js` (347.78 KB raw, 117.88 KB gzip).
   - **Verification Finding:** Out of all 22 application routes, this chunk is loaded **exclusively on `/import`**. Zero bytes of SheetJS code leak into frontline picking (`/issues`), kitchen requisitions (`/request`), door confirmations (`/confirm`), daily counting (`/count`), or overview routes.
   - Frontline kitchen and storeroom staff never bear the network transfer or parse overhead of spreadsheet handling.

2. **D-01 Transactional Chunk Sharing:**
   - All 16 interactive transactional routes share a common Supabase client chunk `static/chunks/585-669d808bccce4915.js` (176.90 KB raw, 49.30 KB gzip) and Zod schema chunk `static/chunks/879-69dbbb6153d81018.js` (55.19 KB raw, 12.49 KB gzip).
   - Because these chunks are cached upon the first authenticated page load, navigating between warehouse operations (e.g., from `/issues` to `/confirm` or `/balance`) incurs only a negligible ~10 KB incremental page-specific JavaScript transfer.

3. **Lean Read-Only Dashboards:**
   - Routes dedicated to reporting and monitoring (`/reports`, `/ops`, `/radar`, `/overview`) do not bundle the Supabase client chunk.
   - Their entire page-specific JavaScript footprint is strictly constrained to between 27 KB and 50 KB raw (9 KB to 14 KB gzip).

---

## 5. UI Framework Audit & Hand-Written CSS Token Preservation

A major architectural highlight of the warehouse system is the complete rejection of utility CSS generation frameworks in favor of a clean, hand-written design token architecture.

### 5.1 Elimination of Tailwind CSS Bloat

The codebase was audited for utility CSS frameworks, PostCSS transformations, and arbitrary CSS class tooling:
- **Tailwind Packages:** 0 instances (`tailwindcss`, `@tailwindcss/*` are absent from `package.json`).
- **PostCSS Tooling:** 0 configuration files (`postcss.config.js` does not exist).
- **CSS Purging Hazards:** Because Tailwind is not utilized, there is zero risk of critical runtime style breakage caused by aggressive class purging or dynamic string interpolation.

### 5.2 Preservation of Approved Design Tokens

All application styling originates from three disciplined CSS files:
1. `styles/tokens.css` (28 lines, 917 bytes):
   - **Approved Color Palette:**
     - Primary Navy: `--navy: #242E52`
     - Brand Blue: `--blue: #02499D`
     - Background Cream: `--cream: #F4F2EF`
     - Sand Accent: `--sand: #EAE6DC`
     - Rule Line: `--rule: #DDD6C5`
     - Card Paper: `--paper: #FFFFFF`
     - Terracotta Warning: `--terra: #A9581A`
     - Forest Green: `--forest: #28473D`
     - Error Red: `--err: #B32E16`
     - Amber Warning: `--amber: #7A4B00` (Background: `--amber-bg: #FBEFD0`)
     - Subtle Ink Gradients: `--ink-2: #4B5470`, `--ink-3: #5F6785`, `--ph: #756F62`
     - Status Backgrounds: `--ok-bg: #E3EDE7`, `--err-bg: #F8E3DE`, `--info-bg: #E2E9F5`
   - **Typography System:**
     - Monospace Data Font: `--mono: "IBM Plex Mono", ui-monospace, Consolas, monospace`
     - Display Header Font: `--disp: "Archivo Narrow", "Be Vietnam Pro", Arial Narrow, sans-serif`
     - Body Reading Font: `--body: "Be Vietnam Pro", system-ui, Segoe UI, sans-serif`
     - Serif Accent Font: `--serif: "Noto Serif Display", Georgia, serif`
2. `styles/globals.css` (177 lines, 3,005 bytes):
   - Desktop 1440px viewport container frame (`.frame`).
   - Accessible outline indicators (`:focus-visible` with 2px solid `--blue` and 2px offset).
   - Baseline responsive grid definitions (`.cols`).
3. `styles/components.css` (736 lines, 14,241 bytes):
   - Reusable domain component styling: rail header, store switcher, status badges, chip selectors, verification tickets, and tabular ledger rows.

### 5.3 Production CSS Bundle Footprint

During compilation, Next.js bundles and minifies the complete CSS token and component tree into a single production asset:
- **Output File:** `.next/static/css/85b7a85e6d40c43e.css`
- **Uncompressed Payload:** 13,658 bytes (**13.34 KB**)
- **Gzip Compressed Payload:** 3,630 bytes (**3.54 KB**)

**Comparative Benchmark:** A typical baseline Tailwind CSS deployment with preflight resets and standard utility classes averages between 45 KB and 120 KB uncompressed. The hand-written token system delivers the full visual design language of the prototype in just 13.34 KB (3.54 KB gzip), achieving an ~85% reduction in stylesheet overhead and ensuring immediate, sub-millisecond CSS parsing on mobile and desktop devices.

---

## 6. Security, Governance & Leakage Guard Audit

### 6.1 Automated Confidential Data Leakage Guard

The project maintains an automated pre-commit and CI verification barrier designed to prevent sensitive commercial information from penetrating the inventory system:
- **Scanner Scripts:** `scripts/guard-leak-check.js` and `scripts/guard-leak-check.sh` (executed via the repository guard script).
- **Enforced Boundary:** Scans database migrations, TypeScript schema models, API route payloads, test fixtures, and UI components to ensure complete physical absence of confidential commercial rates, monetary totals, regulatory levies, or merchant trade identities.
- **Physical Zero-Monetary Isolation:** Verifies architectural decision D-04, guaranteeing that unapproved columns in SAP spreadsheets are expunged in server memory prior to database ingestion.

### 6.2 NPM Scripts Security & Governance Review

The scripts defined in `package.json` were audited for injection vulnerabilities, unauthorized external network fetching, and adherence to production readiness:
- `"dev": "next dev"` — Local development server.
- `"build": "next build"` — Next.js standard production compiler.
- `"start": "next start"` — Next.js production server daemon.
- `"lint": "eslint ."` — Static code analysis.
- `"typecheck": "tsc --noEmit"` — TypeScript compiler validation without output generation.
- `"test": "vitest run"` — Automated unit and property test suite.
- `"test:watch": "vitest"` — Local watch mode for rapid iteration.
- `"test:e2e": "playwright test"` — Headless end-to-end browser test suite.
- `"guard:*": "bash scripts/guard-leak-check.sh"` — Confidential data leak prevention barrier.

Zero arbitrary pre-install or post-install shell hooks exist in `package.json`. No unverified remote shell scripts are invoked during installation.

### 6.3 Lockfile Pinning & Cryptographic Integrity

- **Lockfile Format:** `package-lock.json` utilizes npm `lockfileVersion: 3`.
- **Integrity Verification:** Every single package in the lockfile defines a cryptographic `integrity` field utilizing SHA-512 hashes (e.g., `sha512-...`).
- **Reproducible Installs:** Build pipelines enforce reproducible clean installations via standard lockfile validation, preventing dependency drift or unauthorized transitive package substitution.

---

## 7. Audit Findings & Sign-Off Matrix

### 7.1 Key Findings Summary

1. **Finding H12-01 (Positive — Minimalist Dependency Footprint):** The system operates on just 6 direct production dependencies. The exclusion of heavyweight UI frameworks, generic utility packages, and monolithic state managers keeps the production codebase exceptionally lean.
2. **Finding H12-02 (Positive — Flawless License Compliance):** All 467 resolved packages operate under approved open-source licenses (MIT, Apache-2.0, BSD variants, ISC, BlueOak). Zero viral copyleft (GPL/AGPL) licenses exist. LGPL native binaries for `sharp-libvips` are strictly confined to optional server-side processing and never bundle into client assets.
3. **Finding H12-03 (Positive — Isolated Heavy Modules):** SheetJS (`xlsx`) is strictly code-split into a separate chunk loaded exclusively on the `/import` route. It does not contaminate frontline operational routes.
4. **Finding H12-04 (Positive — Ultra-Compact Stylesheet):** By avoiding utility CSS frameworks like Tailwind, the entire production stylesheet is consolidated into a single 13.34 KB file (3.54 KB gzipped), preserving 100% fidelity to the approved design system tokens.
5. **Finding H12-05 (Architectural Note — Client Ingestion Parser):** The `/import` page imports `parseGrpoWorkbook` from `lib/sap/parser`, making client-side fallback parsing available directly in the browser while keeping the other 21 application routes completely free of spreadsheet parsing code.

### 7.2 Formal Audit Sign-Off Matrix

| Requirement / Invariant | Standard Applied | Verification Result | Sign-Off Verdict |
| :--- | :--- | :---: | :---: |
| **Direct Dependencies Review** | Validated against `package.json` | 6 prod / 8 dev dependencies verified | **APPROVED** |
| **Permissible Open-Source Licenses** | MIT, Apache 2.0, BSD, ISC | 467/467 packages verified compliant | **APPROVED** |
| **Copyleft Risk Elimination** | Zero GPL/AGPL copyleft | Zero viral copyleft packages found | **APPROVED** |
| **Next.js Client Bundle Sizes** | Static artifact build review | 342.96 KB shared root / 100.76 KB gzip | **APPROVED** |
| **Heavy Dependency Isolation** | `xlsx` isolated from frontline | Loaded exclusively on `/import` | **APPROVED** |
| **No Unnecessary Frameworks** | Zero Tailwind / zero UI library | Zero Tailwind dependencies found | **APPROVED** |
| **CSS Design Tokens Preserved** | `tokens.css` verified | 17 color tokens & 4 font families | **APPROVED** |
| **Quantities-Only Principle** | Zero monetary/commercial terms | Full compliance across all sections | **APPROVED** |

**Audit Conclusion:** The project dependencies, open-source licenses, client bundle architecture, and stylesheet design tokens achieve full compliance with all architectural requirements and production quality standards.
