import { z } from 'zod';
import { grpoItemStatusSchema } from './enums';

/**
 * SAP GRPO File Upload Audit (t_grpo_imports)
 * Records file-level ingestion metadata.
 */
export const grpoImportSchema = z.object({
  import_id: z.string().min(1),
  store_id: z.string().min(1),
  file_name: z.string().min(1),
  file_hash: z.string().min(1),
  detected_header_row: z.number().int().positive(),
  total_rows: z.number().int().min(0),
  imported_rows: z.number().int().min(0),
  error_count: z.number().int().min(0),
  uploaded_by_user_id: z.string().min(1),
  imported_at: z.string().min(1),
});

export type GrpoImport = z.infer<typeof grpoImportSchema>;

/**
 * SAP GRPO Parsed Line Item (t_grpo_import_items)
 * Quantities only — all confidential financial columns dropped prior to persistence.
 */
export const grpoImportItemSchema = z.object({
  import_item_id: z.string().min(1),
  import_id: z.string().min(1),
  po_number: z.string().min(1),
  item_code: z.string().min(1),
  counted_qty: z.number().positive(),
  batch_number: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  status: grpoItemStatusSchema,
});

export type GrpoImportItem = z.infer<typeof grpoImportItemSchema>;

/**
 * SAP GRPO Quarantined Staging Errors (t_grpo_staging_errors)
 */
export const grpoStagingErrorSchema = z.object({
  error_id: z.string().min(1),
  import_id: z.string().min(1),
  row_number: z.number().int().positive(),
  raw_line_data: z.string(),
  error_reason: z.string().min(1),
  quarantined_at: z.string().min(1),
});

export type GrpoStagingError = z.infer<typeof grpoStagingErrorSchema>;

/**
 * Clean Ingested Line Schema (Post-drop allowlist)
 * Line key is derived: GRPO No. + Item Code + occurrence order
 */
export const grpoParsedLineSchema = z.object({
  line_key: z.string().min(1),
  grpo_number: z.string().min(1),
  po_number: z.string().nullable().optional(),
  doc_date: z.string().min(1),
  item_code: z.string().min(1),
  item_name: z.string().min(1),
  quantity: z.number(),
  store_code: z.string().min(1),
  store_name: z.string().nullable().optional(),
  uom_code: z.string().min(1),
  target_type: z.string().nullable().optional(),
  open_quantity: z.number().nullable().optional(),
  base_document: z.string().nullable().optional(),
  status: grpoItemStatusSchema.optional(),
});

export type GrpoParsedLine = z.infer<typeof grpoParsedLineSchema>;
