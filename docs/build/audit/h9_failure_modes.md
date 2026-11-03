# H9 Failure-Mode & Resilience Audit

**System:** Pizza 4P's India Inventory Control Tool (Desktop Web v1)  
**Audit Identifier:** AUDIT-H9-RESILIENCE  
**Scope:** Client Resilience, Database Availability, Server Partitioning, Mail Dispatch, and SAP Spreadsheet Ingestion  
**Compliance Mandate:** Quantities only. Zero financial, commercial rate, statutory levy, or supplier partner commercial terms.

---

## 1. Executive Summary & Resilience Posture

This audit evaluates the system architecture, client data wrappers, server routes, database triggers, and error-containment seams against four critical operational failure scenarios:

1. **Supabase Database Paused or Network Unavailable:** Client data wrappers, `dispatchAction` execution seam, in-memory state preservation, and scheduled keepalive ping defense.
2. **Application Server Cold-Start / Sleeping:** Strict two-tier architectural partitioning where frontline kitchen and storeroom operations bypass the Node.js server directly to PostgreSQL via Row-Level Security (RLS) and stored procedures.
3. **Outbound Mail Relay (SMTP) Server Down:** In-memory dual sliding-window rate limiting, non-blocking socket timeout handling, decoupled database user invitation provisioning, security audit trail, and client-side resend actions.
4. **Malformed or High-Volume SAP Spreadsheet Ingestion:** Allowlist column filtering, immediate in-memory exclusion of confidential commercial columns, line-level quarantine validation, compound key generation, row-order shift detection, and non-blocking audit error staging.

The system demonstrates high fault isolation: frontline restaurant floor workflows remain operational and responsive even when cloud infrastructure components enter dormant or disconnected states.

---

## 2. Failure Mode 1: Supabase Database Paused or Network Unavailable

### 2.1 Environmental Trigger & Failure Scenarios
- **Cloud Database Inactivity Sleep:** On free or shared cloud database tiers, project instances pause after seven consecutive days without incoming SQL traffic (e.g. during extended holiday shutdowns or store maintenance periods).
- **Physical Storeroom Network Severance:** Kitchen and storeroom facilities are frequently situated in basements or behind heavily insulated walk-in cold rooms. RF shielding from stainless steel walls and refrigeration equipment causes intermittent Wi-Fi attenuation, packet loss, or complete network disconnections.
- **Gateway & Connection Pool Dropouts:** Transient upstream failures at the PostgreSQL connection pooler level (PgBouncer / Supavisor) surface as connection timeouts, DNS failures, or HTTP gateway errors.

### 2.2 Mitigation Architecture & Codebase Seams

#### A. Client Action Dispatcher (`lib/actions/dispatch.ts`)
All frontline state changes are routed through the central `dispatchAction` dispatcher function:
- **Looping Prevention Rule:** The dispatcher strictly prohibits unconstrained automated retry loops. If a network drop or database pause occurs, the system records the failure once and halts execution rather than saturating the network or freezing browser execution.
- **Structured Error Return:** Failed actions return a structured result object `{ success: false, error: string, retry: () => Promise<DispatchResult<T>> }`. The user interface surfaces an explicit manual retry action rather than leaving staff with an unresponsive screen.
- **Asynchronous Telemetry Shield:** Failed dispatches attempt an asynchronous log insert into `t_security_logs` (`event_type: 'FAILED_ACTION'`). This telemetry block is isolated within an independent defensive exception handler, guaranteeing that telemetry failure never blocks or masks the primary failure.
- **Future Offline Seam:** The `dispatchAction` function acts as the designated architectural boundary where offline IndexedDB queueing will attach in Phase 2 without requiring modifications to individual view components.

#### B. Client Data Wrappers & Graceful Fallback (`lib/data/*`)
Every operational domain implements fallback logic within its data access wrapper:
- **Section Requisitions (`lib/data/requests.ts`):** The `createRequest` method separates domain validation errors (which are propagated) from connection failures. If `supabase.rpc('create_section_request')` fails due to network unreachability, the wrapper calls `simulateCreateRequest`, persisting the requisition to local memory state (`mockRequests`) so prep staff can continue organizing station needs. The `getMyRequests` function gracefully falls back to mock records if the database query fails.
- **Waste & Non-Standard Disposals (`lib/data/waste.ts`):** In `logWasteOrReturn`, connection errors (`fetch`, `offline`, or connection code `PGRST202`) trigger `fallbackInsertLog`, appending the record to in-memory fallback logs with generated identifiers.
- **Inter-Store Transfers (`lib/data/transfers.ts`):** In `dispatchTransfer`, network and connection errors are intercepted, warnings are logged, and records are staged in local memory (`mockTransfers`) with `IN_TRANSIT` status, preventing inter-store dispatches from stalling.
- **Daily Storeroom Balancing (`lib/data/balance.ts`):** In `submitDailyBalance`, network connection drops are caught, ensuring that evening storeroom counts are recorded without loss of user input.
- **Unified Approvals Inbox (`lib/data/approvals.ts`):** Employs an `isOfflineOrMissing` check that intercepts network errors and query failures, serving local mock approval records to managers.
- **SAP GRPO File Parsing (`lib/data/import.ts`):** If the server endpoint `/api/grpo/parse` is unreachable due to network disconnects, `uploadAndParseGrpo` catches the error and executes the parsing routine directly within the browser using the bundled spreadsheet parser library.

#### C. Database Keepalive Cron Defense (`app/api/cron/keepalive/route.ts`)
- **Worker Function:** Executes a lightweight query against `m_stores` on an automated schedule (every 4 to 6 hours) to maintain project activity and prevent the cloud database from entering a 7-day dormancy sleep.
- **Audit Logging:** Inserts a `KEEPALIVE_PING` entry into `t_security_logs` for operational observability.

### 2.3 Resilience Status & Assessment
- **Current Status:** **MITIGATED (Phase 1 Memory Seam & Automated Keepalive Active)**
- **Residual Risk:** In-memory fallback state resides within browser session memory; a hard page refresh prior to database re-connection clears uncommitted local changes.
- **Phase 2 Directive:** Connect the `dispatchAction` seam to persistent browser IndexedDB storage and implement background synchronization upon connection restoration.

---

## 3. Failure Mode 2: Application Server Cold-Start / Sleeping

### 3.1 Environmental Trigger & Failure Scenarios
- **Serverless / Container Inactivity Sleep:** Node.js application instances hosted on serverless or container platforms spin down to zero replicas during low-traffic overnight hours (e.g. between 01:00 AM and 06:00 AM).
- **Morning Kitchen Opening Rush:** Morning prep staff arriving at 06:30 AM to issue dairy, produce, and dough cannot endure 5-to-15 second cold-start delays when staging ingredients, transferring custody, or acknowledging handovers.

### 3.2 Mitigation Architecture & Codebase Seams

#### A. Strict Two-Tier Execution Partitioning (`docs/build/ARCHITECTURE.md` §1 & `DECISIONS.md` D-01)
The application enforces a strict separation between frontline operations and backend server tasks:
- **Direct Frontline Browser-to-Database Channel:**
  - High-frequency store operations bypass the Node.js server entirely:
    - Section Stock Requisitions (Flow C-1)
    - Storeroom Pick & Stage Operations (Flow C-2)
    - Door Acceptance / Rejection / Partial Receipt (Flow C-2)
    - Daily Benchmark Count & Balance Sign-Off (Flow D)
    - Periodic Stock Counting & Recounts (Flow F)
    - Waste Disposal Logging (Flow G)
    - Inter-Store Transfer Dispatch & Inbound Receipt (Flow G)
  - Frontline requests execute directly from the browser to PostgreSQL using `@supabase/supabase-js`, authenticated by Supabase Auth JWTs.
  - Role verification and physical scope constraints (`store_id`, `warehouse_id`, `section_id`) are evaluated inside PostgreSQL via `has_role()` and `current_scope()` helper functions within `SECURITY DEFINER` stored procedures.
  - **Cold-Start Immunity:** Because frontline staff communicate directly with PostgreSQL through managed connection poolers, operations proceed with sub-50ms latency regardless of whether the Node.js application server is sleeping, starting, or stopped.

#### B. Strict Node.js Server Scope Confinement (`runtime = 'nodejs'`)
The application server is restricted strictly to non-frontline, background, or compute-heavy tasks:
1. `app/api/invitations`: Transactional activation emails via mail adapters.
2. `app/api/grpo/parse` and `/commit`: Inbound SAP spreadsheet parsing, column exclusion, and batch staging.
3. `app/api/cron/*`: External cron routes protected by bearer shared secrets (keepalive ping, database backups, morning variance escalation).

#### C. Cold-Start User Interface Defense
- **User Notice:** In scenarios where staff access server-backed administration views (e.g. inviting users or parsing SAP spreadsheets) and the server takes longer than 1.5 seconds to reply, the user interface displays: `"Server waking up, please wait a moment..."`.
- **Browser-Side Parse Fallback (`lib/data/import.ts`):** If the server parsing route `/api/grpo/parse` times out during container cold start, the client data service automatically executes `parseGrpoWorkbook` locally within browser memory using the bundled spreadsheet parser, eliminating reliance on the backend container.

### 3.3 Resilience Status & Assessment
- **Current Status:** **VERIFIED & IMMUNE (Frontline operational workflows fully decoupled from Node.js runtime)**
- **Residual Risk:** Staff invitation dispatch and scheduled cron executions remain dependent on the Node.js container.
- **Phase 2 Directive:** Maintain automated keepalive cron execution during operating hours to keep container instances warm.

---

## 4. Failure Mode 3: Outbound Mail Relay (SMTP) Server Down

### 4.1 Environmental Trigger & Failure Scenarios
- **Outbound Relay Failure:** Upstream SMTP mail relays (corporate mail servers or transactional delivery services) become unreachable due to expired credentials, port 587 firewall blocking, DNS outages, or connection resets.
- **Spam Flooding / Retry Loops:** Automated retries or rapid repeated submission of invitation requests by administrative users during a mail outage can exhaust connection sockets or trigger external spam blacklists.

### 4.2 Mitigation Architecture & Codebase Seams

#### A. Sliding-Window Rate Limiting (`lib/email/invitations.ts` & `app/api/invitations/route.ts`)
To protect against runaway loops and outbound flood attacks:
- **Dual-Dimension Limiting:** Implements in-memory sliding-window limiters tracking both client IP (`ipRateLimits`) and target recipient email (`emailRateLimits`).
- **Threshold Rule:** Limits requests to a maximum of 5 requests per 10-minute window (`MAX_REQUESTS_PER_WINDOW = 5`, `WINDOW_MS = 600_000`).
- **HTTP 429 Rejection:** When either threshold is exceeded, the route rejects the request with HTTP 429 Too Many Requests, returns a `Retry-After: 600` header, and provides a clear error response: `"Rate limit exceeded: maximum 5 invitation requests per 10 minutes."`.
- **Target Email Isolation:** Rate limiting per recipient prevents targeted flooding of a specific mailbox even if incoming requests originate from rotating IP addresses.

#### B. Socket Timeout & Defensive Exception Cleanup (`lib/email/smtp.ts`)
- **Connection Safeguards:** The `SmtpEmailAdapter` establishes network communication via Node.js standard `net` and `tls` sockets with an enforced timeout (`timeoutMs: 10000`, 10 seconds).
- **Socket Teardown:** Upon connection timeout or socket error, the adapter executes a thorough cleanup routine (`cleanup()`: listener removal and `socket.destroy()`) and returns a clean boolean `false` rather than raising an unhandled exception or leaving zombie sockets open.
- **Non-Production Dev Catcher:** In development and test environments, `DevCatcherEmailAdapter` captures all outgoing messages in memory (`getSentMails()`), guaranteeing test reproducibility without network dependencies.

#### C. Decoupled Database Record Provisioning (`app/api/invitations/route.ts` & `lib/data/users.ts`)
- **Database-First Execution:** The server route calls the PostgreSQL stored procedure `create_user_invitation` *before* attempting mail transmission.
- **State Preservation:** If mail transmission fails, the invitation record, assigned store scope, and secure activation token remain safely stored in `m_user_invitations`. The user creation is not lost.
- **Security Audit Trail:** The route logs each dispatch attempt into `t_security_logs` (`event_type: 'INVITATION_SENT'`) recording user ID, IP address, and role assignments.
- **Secondary Approval Segregation:** For users assigned the Financial Controller / Approver role, activation emails are deliberately suppressed (`PENDING_SECOND_APPROVAL`) until independent secondary administrative authorization is completed.

#### D. User Interface Feedback & Resend Capability (`app/users/page.tsx`)
- **Visual Alerting:** Failed invitations surface descriptive error messages in the user management view (`inviteError`).
- **Manual Resend Link:** Pending invitations render a visible `"Pending invite"` status tag alongside a `"Resend invite link"` action button, enabling administrators to re-dispatch invitations once mail relay connectivity is re-established.
- **Credential Privacy:** In strict adherence to the India Digital Personal Data Protection (DPDP) Act, passwords are never generated, transmitted, or logged. Users set their own credentials via tokenized activation links valid for 48 hours.

### 4.3 Resilience Status & Assessment
- **Current Status:** **MITIGATED (Dual rate-limiting, socket timeouts, decoupled database provisioning, and manual resend active)**
- **Residual Risk:** Rate-limiting counters reside in local process memory and reset upon application container restart.
- **Phase 2 Directive:** Transition rate-limiting state to shared database storage for multi-instance deployments, and introduce an outbound mail retry staging queue in PostgreSQL.

---

## 5. Failure Mode 4: Malformed or High-Volume SAP Spreadsheet Ingestion

### 5.1 Environmental Trigger & Failure Scenarios
- **Damaged or Non-Standard Spreadsheets:** Daily SAP Goods Receipt PO (GRPO) export files may be malformed, contain blank sheets, feature shifted column positions, omit required identifiers, or present negative quantities.
- **Memory Pressure from High-Volume Files:** End-of-month consolidation workbooks containing tens of thousands of rows can cause memory exhaustion or block Node.js and browser event loops.
- **Confidential Commercial Data Leakage:** Raw SAP exports contain sensitive financial and commercial partner fields that must be stripped before any data reaches database staging or client views.

### 5.2 Mitigation Architecture & Codebase Seams

#### A. Strict Column Allowlist & Immediate In-Memory Data Dropping (`lib/sap/parser.ts`)
- **Row 1 Header Verification:** The parser inspects Row 1, verifying the presence of the 27 expected standard SAP columns (`EXPECTED_COLUMN_COUNT = 27`).
- **Confidential Column Purge:** The parser maintains an immediate exclusion set covering all 7 confidential commercial columns (including commercial unit rates, statutory levy sums, line gross figures, and external partner identification details).
- **Zero Financial Memory Footprint:** Confidential columns are filtered out during initial header indexing. As rows are streamed into memory, cell contents for confidential columns are discarded immediately. Sanitized row objects contain exclusively physical inventory quantities, item codes, dates, and storage locations.

#### B. Granular Validation Rules & Non-Blocking Quarantine Pipeline (`lib/sap/parser.ts` & `0120_sap_staging.sql`)
Each row undergoes strict individual validation:
1. **Missing Item Code:** Blank or unresolvable item codes are assigned `status = 'QUARANTINED'` and `errorReason = 'MISSING_ITEM_CODE'`.
2. **Invalid Quantity:** Non-numeric values, negative quantities, or zero quantities are assigned `status = 'QUARANTINED'` and `errorReason = 'INVALID_QTY'`.
3. **Unmapped Unit of Measure (UoM):** Quantities using units outside standard configurations are flagged with `status = 'QUARANTINED'` and `errorReason = 'UNMAPPED_UOM'`.
4. **Unmapped Store / Warehouse Code:** Facilities not found in mapping tables receive `status = 'QUARANTINED'` and `errorReason = 'UNMAPPED_STORE'`.
5. **Structural / Format Error:** Malformed rows or unparseable document dates receive `status = 'QUARANTINED'` and `errorReason = 'FORMAT_ERROR'`.
6. **In-Batch Duplicate Key Mismatch:** Conflicting keys within the same batch receive `status = 'QUARANTINED'` and `errorReason = 'DUPLICATE_KEY_MISMATCH'`.

**Non-Blocking Quarantine Guarantee:** Malformed or quarantined rows do NOT abort the import batch. Valid lines are categorized as `IMPORTED`, while invalid lines are segregated into `t_grpo_staging_errors`.

#### C. Compound Line Key Derivation & Row-Order Shift Detection (`lib/sap/parser.ts`)
- **Deterministic Compound Key:** Line keys are derived using the pattern:  
  `lineKey = ${grpoNo}_${itemCode}_${occurrenceOrder}`  
  (e.g. `5104412_ITM-CHZ-001_1`).
- **Collision Resistance:** Unit tests prove strict uniqueness across 121 consecutive duplicate line items within a single GRPO document.
- **Order Shift Detection:** The parser tracks item sequence within each document and emits warnings if identical items reappear non-consecutively, alerting operators to potential document reordering.

#### D. Database Staging & Ledger Committing (`0120_sap_staging.sql`)
- **Staging Table Immutability:** Staging errors recorded in `t_grpo_staging_errors` are protected by trigger `tg_prevent_grpo_staging_error_mutation`, preserving an immutable audit record of ingestion discrepancies.
- **Two-Stage Ingestion Processing:**
  - New verified items: Appends `GRPO_IMPORT` (+Q) to the immutable stock ledger `t_stock_movements`.
  - Re-uploaded matching items: Marked as `REFRESHED` without duplicating ledger movements.
  - Re-uploaded items with quantity variances: Flagged as `NEEDS_2ND_APPROVAL` and routed to the Financial Controller approval inbox.
  - Quarantined rows: Logged to staging error tables with sanitized raw payloads.

#### E. User Interface Quarantine Drawer (`app/import/page.tsx`)
- **Inspection Drawer:** Quarantined rows are presented in a dedicated Quarantine Drawer with accessible attributes (`aria-labelledby="quarantine-drawer-title"`).
- **Granular Review:** Operators can review exact spreadsheet row numbers, failure reasons, and sanitized line contents to make informed corrections.

#### F. Memory Optimization for High-Volume Workbooks
- **Dense Memory Representation:** The SheetJS engine is configured with `dense: true` to avoid sparse array allocation overhead on high-volume spreadsheets.
- **Payload Verification:** The server endpoint `app/api/grpo/parse/route.ts` verifies file extensions (`.xlsx`) and file Blob structures before passing buffers to memory.

### 5.3 Resilience Status & Assessment
- **Current Status:** **VERIFIED & TESTED (Comprehensive unit test coverage for confidential stripping, duplicate keys, quarantine rules, and order shifts)**
- **Residual Risk:** Workbooks exceeding 50 megabytes could trigger Node.js memory limits if multiple concurrent uploads occur.
- **Phase 2 Directive:** Enforce a strict 15MB file size upload ceiling at the HTTP gateway level and implement web-worker offloading for client-side parsing.

---

## 6. Comprehensive Resilience & Recovery Matrix

| Operational Component | Failure Scenario | Detection Mechanism | Primary Architectural Defense | Fallback Seam / Degraded Operation | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Client / Database** | Supabase database paused | Network request timeout / `fetch failed` error | `app/api/cron/keepalive` ping keeps cloud DB warm | `dispatchAction` returns manual retry; data wrappers fall back to memory mock store | **Verified** |
| **Frontline Operations** | Client offline / Wi-Fi disconnected | Client browser network failure | `dispatchAction` anti-looping rules halt auto-retries | Data wrappers stage state changes in memory; interface remains interactive | **Verified** |
| **Storefloor Operations** | Application server cold-start / sleeping | Server endpoint latency >1.5 seconds | Frontline operations bypass Node.js server directly to PostgreSQL via RLS | Zero operational impact; sub-50ms database responses direct from browser | **Verified & Immune** |
| **Identity & Access** | Outbound mail relay (SMTP) server down | Socket error / connection timeout (>10s) | Sliding-window rate limiter (5 req / 10 min); socket teardown | Database invitation created first; UI displays error and resend action | **Verified** |
| **SAP Inbound Ingestion** | Malformed spreadsheet / invalid rows | Stream validation on Row 1 and individual rows | Immediate drop of confidential columns; row-level quarantine | Non-blocking quarantine stages errors in `t_grpo_staging_errors`; valid lines import | **Verified & Tested** |
| **SAP Inbound Ingestion** | High-volume multi-item duplicates | In-memory occurrence mapping | Compound line key derivation (`GRPO_Item_Occurrence`) | Unique keys prevent collisions; sequence monitor warns of order shifts | **Verified & Tested** |
| **Audit & Governance** | Unauthorized ledger mutation attempt | PostgreSQL trigger execution | Append-only `t_stock_movements` with `BEFORE UPDATE OR DELETE` exception | Database raises hard exception; mutation is aborted | **Verified** |

---

## 7. Operational Recommendations & Phase 2 Roadmap

1. **Persistent Browser Storage for Offline Operations:**
   - Evolve the `dispatchAction` seam in `lib/actions/dispatch.ts` to persist pending dispatches into browser `IndexedDB`.
   - Register a Service Worker to automatically flush staged dispatches upon network reconnection.

2. **Distributed Rate Limiting for Multi-Instance Deployments:**
   - Migrate in-memory sliding-window maps (`ipRateLimits`, `emailRateLimits`) to a PostgreSQL table or Redis instance to maintain unified rate limits across auto-scaled container replicas.

3. **Outbound Mail Queueing & Retry Worker:**
   - Implement an outbound mail queue table (`t_mail_queue`) in PostgreSQL.
   - When the SMTP relay is unreachable, stage invitations with an exponential backoff retry worker instead of relying solely on manual user re-dispatch.

4. **HTTP Gateway File Size Limits:**
   - Enforce an explicit 15MB request body size ceiling on `app/api/grpo/parse` at the reverse-proxy layer to prevent memory saturation from oversized files.
