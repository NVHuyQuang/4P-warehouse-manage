import { z } from 'zod';
import { transferStatusSchema } from './enums';

/**
 * Inter-Store Transfer State (t_transfer_intransit)
 * Flow G Inter-Store Transfer State.
 * Quantities only — weight (kg) and piece count (pcs) dual units.
 */
export const transferSchema = z.object({
  transfer_id: z.string().min(1),
  source_store_id: z.string().min(1),
  target_store_id: z.string().min(1),
  item_code: z.string().min(1),
  dispatch_qty_kg: z.number().min(0),
  dispatch_qty_pcs: z.number().min(0),
  vehicle_seal_no: z.string().min(1),
  dispatcher_user_id: z.string().min(1),
  dispatched_at: z.string().min(1),
  receive_qty_kg: z.number().min(0).nullable().optional(),
  receive_qty_pcs: z.number().min(0).nullable().optional(),
  receiver_user_id: z.string().nullable().optional(),
  received_at: z.string().nullable().optional(),
  variance_qty: z.number().nullable().optional(),
  fc_approval_id: z.string().nullable().optional(),
  status: transferStatusSchema,
});

export type Transfer = z.infer<typeof transferSchema>;

/**
 * Transfer Dispatch Creation Payload (Flow G Dispatch)
 * Dual-unit requirement: Both weight (kg) and piece count (pcs) must be recorded.
 */
export const createTransferSchema = z
  .object({
    source_store_id: z.string().min(1),
    target_store_id: z.string().min(1),
    item_code: z.string().min(1),
    dispatch_qty_kg: z.number().positive(),
    dispatch_qty_pcs: z.number().positive(),
    vehicle_seal_no: z.string().min(1),
    dispatcher_user_id: z.string().min(1),
  })
  .refine((data) => data.source_store_id !== data.target_store_id, {
    message: 'target_store_id must differ from source_store_id',
    path: ['target_store_id'],
  });

export type CreateTransfer = z.infer<typeof createTransferSchema>;

/**
 * Transfer Receipt Payload (Flow G Receive & Verify)
 */
export const receiveTransferSchema = z.object({
  transfer_id: z.string().min(1),
  receiver_user_id: z.string().min(1),
  receive_qty_kg: z.number().min(0),
  receive_qty_pcs: z.number().min(0),
});

export type ReceiveTransfer = z.infer<typeof receiveTransferSchema>;

/**
 * Transfer Variance Approval Payload (FC Decision)
 */
export const approveTransferVarianceSchema = z.object({
  transfer_id: z.string().min(1),
  fc_approval_id: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  fc_comment: z.string().nullable().optional(),
});

export type ApproveTransferVariance = z.infer<typeof approveTransferVarianceSchema>;
