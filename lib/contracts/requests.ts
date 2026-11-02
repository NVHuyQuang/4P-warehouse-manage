import { z } from 'zod';
import { sectionIdSchema, requestStatusSchema } from './enums';

/**
 * Requisition Line Item (t_request_items)
 * Quantities only — physical inventory request items.
 */
export const requestItemSchema = z.object({
  request_item_id: z.string().min(1),
  request_id: z.string().min(1),
  item_code: z.string().min(1),
  requested_qty: z.number().positive(),
  issued_qty: z.number().min(0),
  uom: z.string().min(1),
  variance_reason: z.string().nullable().optional(),
});

export type RequestItem = z.infer<typeof requestItemSchema>;

/**
 * Requisition Header (t_requests)
 */
export const requestSchema = z.object({
  request_id: z.string().min(1),
  store_id: z.string().min(1),
  section_id: sectionIdSchema,
  requester_user_id: z.string().min(1),
  is_urgent: z.boolean(),
  urgent_reason: z.string().nullable().optional(),
  status: requestStatusSchema,
  runner_user_id: z.string().nullable().optional(),
  runner_confirmed_at: z.string().nullable().optional(),
  created_at: z.string().min(1),
  updated_at: z.string().nullable().optional(),
});

export type Request = z.infer<typeof requestSchema>;

export const requestWithItemsSchema = requestSchema.extend({
  items: z.array(requestItemSchema),
});

export type RequestWithItems = z.infer<typeof requestWithItemsSchema>;

/**
 * Requisition Creation Payload
 */
export const createRequestItemInputSchema = z.object({
  item_code: z.string().min(1),
  requested_qty: z.number().positive(),
  uom: z.string().min(1),
});

export type CreateRequestItemInput = z.infer<typeof createRequestItemInputSchema>;

export const createRequestSchema = z
  .object({
    store_id: z.string().min(1),
    section_id: sectionIdSchema,
    requester_user_id: z.string().min(1),
    is_urgent: z.boolean().default(false),
    urgent_reason: z.string().nullable().optional(),
    items: z.array(createRequestItemInputSchema).min(1),
  })
  .refine(
    (data) => {
      if (data.is_urgent) {
        return typeof data.urgent_reason === 'string' && data.urgent_reason.trim().length > 0;
      }
      return true;
    },
    {
      message: 'urgent_reason is required when is_urgent is true',
      path: ['urgent_reason'],
    }
  );

export type CreateRequest = z.infer<typeof createRequestSchema>;

/**
 * Requisition Amendment Payload (Flow C-1 Step C8/C9)
 */
export const updateRequestItemInputSchema = z.object({
  request_item_id: z.string().min(1),
  requested_qty: z.number().positive(),
});

export type UpdateRequestItemInput = z.infer<typeof updateRequestItemInputSchema>;

export const updateRequestSchema = z.object({
  request_id: z.string().min(1),
  requester_user_id: z.string().min(1),
  items: z.array(updateRequestItemInputSchema).min(1),
});

export type UpdateRequest = z.infer<typeof updateRequestSchema>;

/**
 * Requisition Cancellation Payload (Flow C-1 Step C10)
 */
export const cancelRequestSchema = z.object({
  request_id: z.string().min(1),
  requester_user_id: z.string().min(1),
  cancellation_reason: z.string().nullable().optional(),
});

export type CancelRequest = z.infer<typeof cancelRequestSchema>;
