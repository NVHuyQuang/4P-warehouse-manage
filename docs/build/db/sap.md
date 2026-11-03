# Database Domain: SAP GRPO Ingestion Staging (D12)

## 1. Domain Overview
The SAP GRPO Ingestion Staging domain implements **Flow A-2 (SAP GRPO Entry, File Export & Import)** for the Pizza 4P's India Inventory Control Tool. It bridges external ERP Goods Receipt PO exports into the frontline physical movement ledger without establishing an automated, direct SAP API coupling.

### Invariants & Non-Negotiable Boundaries
- **Physical Quantities Only:** Physical count and weight units (`kg`, `pcs`), batch codes, expiration dates, and document keys are persisted. All financial, pricing, valuation, and commercial supplier figures are stripped in memory before database staging.
- **Decision CR-02 (File Hash Non-Uniqueness):** `t_grpo_imports.file_hash` has an index for fast duplicate detection and audit inspection, but **no `UNIQUE` constraint**. Deduplication is strictly enforced at the line level via the compound document line key, permitting corrected file re-uploads.
- **Append-Only Movement Ledger:** Stock movements in `t_stock_movements` are strictly immutable (`tg_prevent_ledger_mutation`). Inbound GRPO lines append positive receipts (`GRPO_IMPORT`). Corrected quantities never mutate existing ledger records; instead, a second independent approval posts an offsetting negative reversal followed by the corrected receipt.
- **Independent Second Approval:** Discrepancies in item codes or quantities upon file re-upload trigger `NEEDS_2ND_APPROVAL`. Only Supply Chain Lead (`SCM`), Financial Controller (`APPROVER`), or System Admin (`SYSTEM_ADMIN`) can authorize the reversal and re-post.

---

## 2. Relational Schema & Tables

### 2.1 `m_store_warehouse_mapping`
Maps external SAP store and warehouse codes to internal application store identifiers (`store_id`) and storerooms (`warehouse_id`).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `mapping_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique mapping identifier. |
| `sap_store_code` | `text` | `NOT NULL` | Store code exported from SAP (e.g., `DEL01`, `IND-DEL-01`). |
| `sap_wh_code` | `text` | `NOT NULL` | Warehouse / Storeroom code in SAP (e.g., `DRY`, `COLD`). |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Internal store identifier (e.g., `IND-DEL-01`). |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Internal warehouse identifier (e.g., `WH-DEL01-DRY`). |
| `is_active` | `boolean` | `NOT NULL DEFAULT true` | Active routing flag. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Mapping registration timestamp. |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Mapping last update timestamp. |

- **Constraints:**
  - `uq_sap_mapping`: `UNIQUE (sap_store_code, sap_wh_code)`
- **Indexes:**
  - `idx_store_warehouse_mapping_store_wh` on `(store_id, warehouse_id)`
  - `idx_store_warehouse_mapping_sap` on `(sap_store_code, sap_wh_code)`

---

### 2.2 `t_grpo_imports`
Audit log recording every file ingestion attempt and aggregate outcome counters.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `import_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique import batch identifier. |
| `store_id` | `text` | `NOT NULL REFERENCES m_stores(store_id)` | Target store branch. |
| `file_name` | `text` | `NOT NULL` | Uploaded spreadsheet filename. |
| `file_hash` | `text` | `NOT NULL` | SHA-256 digest of uploaded file content (Decision CR-02: non-unique). |
| `detected_header_row` | `integer` | `NOT NULL DEFAULT 1 CHECK (>= 1)` | Row index where valid SAP headers were detected. |
| `total_rows` | `integer` | `NOT NULL DEFAULT 0 CHECK (>= 0)` | Total data rows evaluated in the batch. |
| `imported_rows` | `integer` | `NOT NULL DEFAULT 0 CHECK (>= 0)` | Count of successfully ingested new lines. |
| `refreshed_rows` | `integer` | `NOT NULL DEFAULT 0 CHECK (>= 0)` | Count of re-uploaded lines with metadata refresh (0 stock change). |
| `needs_approval_rows`| `integer` | `NOT NULL DEFAULT 0 CHECK (>= 0)` | Count of lines with quantity/item changes awaiting 2nd approval. |
| `quarantined_rows` | `integer` | `NOT NULL DEFAULT 0 CHECK (>= 0)` | Count of malformed or invalid lines isolated to staging errors. |
| `uploaded_by_user_id`| `uuid` | `NOT NULL REFERENCES auth.users(id)` | User who executed the upload (Warehouse Keeper / Admin). |
| `imported_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Import timestamp. |

- **Decision CR-02 Compliance:** `file_hash` is indexed for audit lookups but explicitly omits a `UNIQUE` constraint, allowing corrected SAP export files to be re-uploaded.
- **Indexes:**
  - `idx_grpo_imports_file_hash` on `(file_hash)`
  - `idx_grpo_imports_store_id` on `(store_id)`
  - `idx_grpo_imports_uploaded_by` on `(uploaded_by_user_id)`
  - `idx_grpo_imports_imported_at` on `(imported_at DESC)`

---

### 2.3 `t_grpo_import_items`
Parsed, allowlist-filtered document line items.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `import_item_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique line item record identifier. |
| `import_id` | `uuid` | `NOT NULL REFERENCES t_grpo_imports(import_id) ON DELETE CASCADE` | Parent import batch identifier. |
| `grpo_no` | `text` | `NOT NULL` | SAP GRPO Document Number. |
| `line_key` | `text` | `NOT NULL` | Derived line key (`grpo_no + '_' + item_code + '_' + occurrence`). |
| `item_code` | `text` | `NOT NULL REFERENCES m_items(item_code)` | Target item identifier. |
| `warehouse_id` | `text` | `NOT NULL REFERENCES m_warehouses(warehouse_id)` | Destination storeroom. |
| `quantity` | `numeric(12,3)` | `NOT NULL CHECK (quantity > 0)` | Received physical quantity. |
| `uom` | `text` | `NOT NULL` | Normalized unit of measure (`kg`, `pcs`). |
| `doc_date` | `date` | `NOT NULL` | SAP document posting date. |
| `batch_number` | `text` | `NULL` | Lot / Batch identifier from vendor delivery. |
| `expiry_date` | `date` | `NULL` | Batch expiration date. |
| `vendor_code` | `text` | `NULL` | External vendor identifier (reference code only). |
| `base_document` | `text` | `NULL` | Related Purchase Order reference (e.g., `PO-9001`). |
| `status` | `text` | `NOT NULL CHECK (status IN ('IMPORTED', 'REFRESHED', 'NEEDS_2ND_APPROVAL', 'QUARANTINED', 'APPROVED_REVERSAL', 'REJECTED')) DEFAULT 'IMPORTED'` | Flow A-2 processing status. |
| `movement_id` | `uuid` | `NULL REFERENCES t_stock_movements(movement_id)` | Linked append-only movement in the stock ledger. |
| `second_approver_id` | `uuid` | `NULL REFERENCES auth.users(id)` | Authorized approver for quantity corrections. |
| `second_approved_at` | `timestamptz` | `NULL` | Timestamp of second approval. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Ingestion timestamp. |

- **Constraints:**
  - `uq_grpo_import_line_key`: `UNIQUE (grpo_no, line_key)`
- **Indexes:**
  - `idx_grpo_import_items_import_id` on `(import_id)`
  - `idx_grpo_import_items_grpo_line` on `(grpo_no, line_key)`
  - `idx_grpo_import_items_item_code` on `(item_code)`
  - `idx_grpo_import_items_warehouse_id` on `(warehouse_id)`
  - `idx_grpo_import_items_status` on `(status)`
  - `idx_grpo_import_items_movement_id` on `(movement_id)`

---

### 2.4 `t_grpo_staging_errors`
Append-only quarantine repository for malformed, unmapped, or invalid lines.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `error_id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique quarantine record identifier. |
| `import_id` | `uuid` | `NOT NULL REFERENCES t_grpo_imports(import_id) ON DELETE CASCADE` | Associated import batch. |
| `row_number` | `integer` | `NOT NULL` | Spreadsheet row index of failing line. |
| `raw_line_data` | `text` | `NOT NULL` | Sanitized raw line payload as JSON/text. |
| `error_reason` | `text` | `NOT NULL CHECK (error_reason IN ('MISSING_ITEM_CODE', 'INVALID_QTY', 'FORMAT_ERROR', 'UNMAPPED_UOM', 'UNMAPPED_STORE', 'DUPLICATE_KEY_MISMATCH'))` | Cause of rejection. |
| `quarantined_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Isolation timestamp. |

- **Immutability:** Protected by trigger `tg_prevent_grpo_staging_error_mutation` against `UPDATE` or `DELETE`.
- **Indexes:**
  - `idx_grpo_staging_errors_import_id` on `(import_id)`
  - `idx_grpo_staging_errors_reason` on `(error_reason)`

---

## 3. SAP Line Key & Compound Key Strategy

### The SAP Export Limitation
Standard SAP Business One GRPO table exports lack an explicit row-index (`LineNum`) column. When a single receipt document contains multiple deliveries of the same item (e.g., two distinct lots of San Marzano Tomatoes on one GRPO), naive keying on `GRPO No. + Item Code` causes collision errors.

### Compound Key Resolution
To guarantee deterministic deduplication, the system synthesizes a compound line key:
$$\text{Line Key} = \text{GRPO No.} + \text{'_'} + \text{Item Code} + \text{'_'} + \text{occurrence order inside document}$$

- **Uniqueness Guarantee:** Enforced in PostgreSQL via `CONSTRAINT uq_grpo_import_line_key UNIQUE (grpo_no, line_key)`.
- **Re-upload Handling:** If row order shifts between SAP exports, the ingestion pipeline flags potential key shifts for review while safeguarding ledger integrity.

---

## 4. Allowlist & Ingestion Isolation

Per Architectural Decision **D-04 (Zero-Price Drop at Ingestion Boundary)**:
- Raw SAP exports provide 27 standard columns.
- The Node.js ingestion stream (`app/api/grpo/parse`) inspects Row 1 headers against known column names.
- All 7 commercial and confidential columns are dropped in memory before database staging:
  1. `Price`
  2. `Total Tax`
  3. `Net Tax Amount`
  4. `Row Total`
  5. `Gross Total`
  6. `Vendor Name`
  7. `Vendor Address`
- The resulting payload contains strictly operational fields: `grpo_no`, `item_code`, `quantity`, `uom`, `doc_date`, `batch_number`, `expiry_date`, `vendor_code` (ID code only), `store_code`, `wh_code`, and `base_document`.

---

## 5. Re-Upload Classification & Correction Workflow (Flow A-2)

When an export file is processed via `commit_grpo_import_batch`, every line is categorized into one of five states:

```
[Raw SAP Line]
      |
      v
(Valid Store, Item, UoM, Qty?)
   /                   \
 (No)                  (Yes)
  |                      |
[QUARANTINED]       (Line Key Exists in DB?)
                         /                \
                       (No)               (Yes)
                        |                   |
                   [IMPORTED]        (Qty or Item Changed?)
                   (+Q Movement)            /          \
                                          (No)         (Yes)
                                           |             |
                                      [REFRESHED]   [NEEDS_2ND_APPROVAL]
                                      (0 Movement)   (0 Movement until approved)
                                                         |
                                                 [2nd Approval: SCM/FC]
                                                         |
                                                 [APPROVED_REVERSAL]
                                                 (-Old Q, +New Q Movements)
```

1. **`IMPORTED` (New Line):**
   - Ingests new line item record.
   - Appends positive `GRPO_IMPORT` record to `t_stock_movements`.
   - Links `movement_id` to `t_grpo_import_items`.
   - Updates `v_stock_current` book stock.

2. **`REFRESHED` (Metadata Update):**
   - Document line already exists in `t_grpo_import_items` with identical item code and quantity.
   - Updates reference fields (such as `base_document` reflecting SAP document closure from Open `'O'` to Closed `'C'`, or revised vendor remarks).
   - Posts **0 stock movements**. Book stock remains unchanged.

3. **`NEEDS_2ND_APPROVAL` (Quantity / Item Discrepancy):**
   - Document line already exists in `t_grpo_import_items` but quantity or item code differs from initial import.
   - Updates `status = 'NEEDS_2ND_APPROVAL'` and stores proposed corrected values.
   - Retains link to existing `movement_id`.
   - Posts **0 stock movements** until independent review.

4. **`APPROVED_REVERSAL` (Second Approval Executed):**
   - Authorized by Supply Chain Lead (`SCM`) or Financial Controller (`APPROVER`).
   - Verifies segregation of duties: original uploader cannot self-approve.
   - Reads original movement via `movement_id` and appends an offsetting negative reversal (`-old_quantity`) with `reference_doc_id = 'REV-' || grpo_no || '-' || line_key`.
   - Appends a new positive receipt (`+new_quantity`) with `reference_doc_id = grpo_no || '-' || line_key`.
   - Updates `t_grpo_import_items.status = 'APPROVED_REVERSAL'`, updates `movement_id` to new movement, and records `second_approver_id` and `second_approved_at`.

5. **`QUARANTINED` (Validation Failure):**
   - Line contains missing/unknown item code, quantity $\le 0$, unmapped store/warehouse code, or unmapped UoM.
   - Appends audit row to `t_grpo_staging_errors`.
   - Posts **0 stock movements**.

---

## 6. Stored Procedures (RPCs)

### 6.1 `commit_grpo_import_batch`
Ingests a batch of parsed JSON lines, performs validation, classifies line items per Flow A-2, appends necessary ledger movements, and updates batch summary counters.

- **Signature:**
  ```sql
  public.commit_grpo_import_batch(
    p_import_id uuid,
    p_lines jsonb
  ) RETURNS jsonb
  ```
- **Security:** `SECURITY DEFINER SET search_path = public, auth, pg_temp`
- **Role Authorization:** Caller must have role `ADMIN` (Warehouse Keeper), `SCM`, or `SYSTEM_ADMIN`.
- **Store Scope:** If `current_store_id()` is set, it must match `t_grpo_imports.store_id` (unless `SYSTEM_ADMIN`).
- **Return JSON Format:**
  ```json
  {
    "import_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "total_rows": 25,
    "imported_rows": 20,
    "refreshed_rows": 3,
    "needs_approval_rows": 1,
    "quarantined_rows": 1
  }
  ```

### 6.2 `approve_grpo_correction`
Executes second independent approval on a corrected GRPO line, posting ledger reversal and replacement movements.

- **Signature:**
  ```sql
  public.approve_grpo_correction(
    p_import_item_id uuid,
    p_notes text DEFAULT NULL
  ) RETURNS void
  ```
- **Security:** `SECURITY DEFINER SET search_path = public, auth, pg_temp`
- **Role Authorization:** Caller must have role `SCM`, `APPROVER` (Financial Controller), or `SYSTEM_ADMIN`.
- **Segregation of Duties:** Uploader UUID in `t_grpo_imports` cannot match approver UUID (unless `SYSTEM_ADMIN`).
- **State Validation:** Requires `status = 'NEEDS_2ND_APPROVAL'`.

### 6.3 `reject_grpo_correction`
Rejects a proposed quantity or item correction without altering the stock ledger.

- **Signature:**
  ```sql
  public.reject_grpo_correction(
    p_import_item_id uuid,
    p_reason text DEFAULT NULL
  ) RETURNS void
  ```
- **Security:** `SECURITY DEFINER SET search_path = public, auth, pg_temp`
- **Role Authorization:** Caller must have role `SCM`, `APPROVER`, or `SYSTEM_ADMIN`.
- **State Transition:** Updates `status = 'REJECTED'`, decrements `needs_approval_rows`.

---

## 7. Row-Level Security (RLS) & Access Control Matrix

RLS is enabled on all tables:

| Table | Operation | Allowed Roles | Policy Scope |
| :--- | :--- | :--- | :--- |
| `m_store_warehouse_mapping` | `SELECT` | All authenticated, `anon` | Scoped to store or global roles (`SYSTEM_ADMIN`, `SCM`, `APPROVER`, `VIEWER`). |
| `m_store_warehouse_mapping` | `INSERT` / `UPDATE` | `ADMIN`, `SCM`, `SYSTEM_ADMIN` | Scoped to store or `SYSTEM_ADMIN`. |
| `m_store_warehouse_mapping` | `DELETE` | `SYSTEM_ADMIN` | Global administrator only. |
| `t_grpo_imports` | `SELECT` | `ADMIN`, `SCM`, `APPROVER`, `VIEWER`, `SYSTEM_ADMIN` | Scoped to store or global roles. |
| `t_grpo_imports` | `INSERT` / `UPDATE` | `ADMIN`, `SCM`, `SYSTEM_ADMIN` | Scoped to active store. |
| `t_grpo_imports` | `DELETE` | None | Hard-blocked (`USING (false)`). |
| `t_grpo_import_items` | `SELECT` | `ADMIN`, `SCM`, `APPROVER`, `VIEWER`, `SYSTEM_ADMIN` | Evaluated via parent import store scope. |
| `t_grpo_import_items` | `INSERT` | `ADMIN`, `SCM`, `SYSTEM_ADMIN` | Keeper / SCM upload pathway. |
| `t_grpo_import_items` | `UPDATE` | `SCM`, `APPROVER`, `SYSTEM_ADMIN` | Second approval workflow. |
| `t_grpo_import_items` | `DELETE` | None | Hard-blocked (`USING (false)`). |
| `t_grpo_staging_errors` | `SELECT` | `ADMIN`, `SCM`, `APPROVER`, `VIEWER`, `SYSTEM_ADMIN` | Evaluated via parent import store scope. |
| `t_grpo_staging_errors` | `INSERT` | `ADMIN`, `SCM`, `SYSTEM_ADMIN` | Staging pipeline isolation. |
| `t_grpo_staging_errors` | `UPDATE` / `DELETE` | None | Hard-blocked via RLS & trigger. |

---

## 8. Append-Only Ledger Integration

The SAP staging domain respects the core ledger guarantees defined in Domain D4:

1. **Zero Direct Ledger Mutation:**
   - No `UPDATE` or `DELETE` statement is ever executed against `t_stock_movements`.
   - The immutability trigger `tg_prevent_ledger_mutation` remains active at all times.
2. **Reversal via Symmetrical Offset:**
   - A corrected GRPO line of quantity $Q_{\text{old}} \to Q_{\text{new}}$ creates two discrete ledger movements:
     - Reversal movement: $\text{quantity} = -Q_{\text{old}}$, $\text{reference\_doc\_id} = \text{'REV-' + line\_key}$.
     - Corrected movement: $\text{quantity} = +Q_{\text{new}}$, $\text{reference\_doc\_id} = \text{line\_key}$.
3. **Derived Real-Time Balances:**
   - Derived view `v_stock_current` continuously computes book stock:
     $$\text{book\_stock} = \sum (\text{GRPO\_IMPORT}) + \dots$$
   - The algebraic sum of $(+Q_{\text{old}}) + (-Q_{\text{old}}) + (+Q_{\text{new}})$ exactly yields $Q_{\text{new}}$ with an unbroken audit trail.
