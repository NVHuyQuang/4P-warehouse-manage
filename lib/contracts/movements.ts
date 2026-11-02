import { z } from 'zod';
import {
  movementTypeSchema,
  wasteMovementTypeSchema,
  wasteApproverDecisionSchema,
  expiryRadarStatusSchema,
} from './enums';

/**
 * Immutable Append-Only Ledger Row (t_stock_movements)
 * Quantities only — inventory movements.
 */
export const stockMovementSchema = z.object({
  movement_id: z.string().min(1),
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  item_code: z.string().min(1),
  movement_type: movementTypeSchema,
  quantity: z.number(), // signed decimal: positive for inbound/offsets, negative for issues/disposals
  uom: z.string().min(1),
  batch_number: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  reference_doc_id: z.string().min(1),
  created_by_user_id: z.string().min(1),
  created_at: z.string().min(1),
});

export type StockMovement = z.infer<typeof stockMovementSchema>;

export const createStockMovementSchema = z.object({
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  item_code: z.string().min(1),
  movement_type: movementTypeSchema,
  quantity: z.number(),
  uom: z.string().min(1),
  batch_number: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  reference_doc_id: z.string().min(1),
  created_by_user_id: z.string().min(1),
});

export type CreateStockMovement = z.infer<typeof createStockMovementSchema>;

/**
 * Derived Current Stock View (v_stock_current)
 */
export const currentStockSchema = z.object({
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  item_code: z.string().min(1),
  book_stock: z.number(),
});

export type CurrentStock = z.infer<typeof currentStockSchema>;

/**
 * Per-Lot FIFO & Expiry View
 */
export const lotStockSchema = z.object({
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  item_code: z.string().min(1),
  batch_number: z.string().nullable(),
  expiry_date: z.string().nullable(),
  quantity: z.number(),
  days_to_expiry: z.number().nullable().optional(),
  expiry_status: expiryRadarStatusSchema.optional(),
});

export type LotStock = z.infer<typeof lotStockSchema>;

/**
 * Stage Issue (Flow C-2) Payload
 */
export const stageIssueItemSchema = z.object({
  item_code: z.string().min(1),
  quantity: z.number().positive(),
  batch_number: z.string().nullable().optional(),
  uom: z.string().min(1),
});

export type StageIssueItem = z.infer<typeof stageIssueItemSchema>;

export const stageIssuePayloadSchema = z.object({
  request_id: z.string().min(1),
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  items: z.array(stageIssueItemSchema).min(1),
});

export type StageIssuePayload = z.infer<typeof stageIssuePayloadSchema>;

/**
 * Runner Confirm / Decline / Partial (Flow C-2) Payload
 */
export const confirmIssueItemSchema = z.object({
  item_code: z.string().min(1),
  accepted_qty: z.number().min(0),
  declined_qty: z.number().min(0),
  batch_number: z.string().nullable().optional(),
  uom: z.string().min(1),
  declined_reason: z.string().nullable().optional(),
});

export type ConfirmIssueItem = z.infer<typeof confirmIssueItemSchema>;

export const confirmIssuePayloadSchema = z.object({
  request_id: z.string().min(1),
  runner_user_id: z.string().min(1),
  items: z.array(confirmIssueItemSchema).min(1),
});

export type ConfirmIssuePayload = z.infer<typeof confirmIssuePayloadSchema>;

/**
 * Waste & Supplier Return Authorization Audit (t_waste_returns_log)
 * Quantities only.
 */
export const wasteReturnLogSchema = z.object({
  log_id: z.string().min(1),
  store_id: z.string().min(1),
  movement_id: z.string().min(1),
  movement_type: wasteMovementTypeSchema,
  item_code: z.string().min(1),
  quantity: z.number().positive(),
  uom: z.string().min(1),
  po_number: z.string().nullable().optional(),
  grpo_doc_no: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  reason_code: z.string().min(1),
  reason_text: z.string().min(1),
  logged_by_user_id: z.string().min(1),
  approver_user_id: z.string().min(1),
  approver_decision: wasteApproverDecisionSchema,
  approver_comment: z.string().nullable().optional(),
  driver_signature_blob: z.string().nullable().optional(),
  authorized_at: z.string().min(1),
});

export type WasteReturnLog = z.infer<typeof wasteReturnLogSchema>;

export const createWasteReturnLogSchema = z.object({
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  movement_type: wasteMovementTypeSchema,
  item_code: z.string().min(1),
  quantity: z.number().positive(),
  uom: z.string().min(1),
  po_number: z.string().nullable().optional(),
  grpo_doc_no: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  reason_code: z.string().min(1),
  reason_text: z.string().min(1),
  logged_by_user_id: z.string().min(1),
  driver_signature_blob: z.string().nullable().optional(),
});

export type CreateWasteReturnLog = z.infer<typeof createWasteReturnLogSchema>;
