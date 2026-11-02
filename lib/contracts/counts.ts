import { z } from 'zod';
import {
  stockCountStatusSchema,
  countFreezeStatusSchema,
  countTypeSchema,
} from './enums';

/**
 * Stock Count Line Item (t_stock_count_items)
 * Quantities only — count comparison without financial values.
 */
export const stockCountItemSchema = z.object({
  count_item_id: z.string().min(1),
  count_id: z.string().min(1),
  item_code: z.string().min(1),
  book_qty: z.number(),
  first_count_qty: z.number().min(0),
  recount_qty: z.number().min(0).nullable().optional(),
  final_counted_qty: z.number().min(0),
  difference_qty: z.number(),
});

export type StockCountItem = z.infer<typeof stockCountItemSchema>;

/**
 * Stock Count Header (t_stock_counts)
 */
export const stockCountSchema = z.object({
  count_id: z.string().min(1),
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  count_type: countTypeSchema,
  freeze_status: countFreezeStatusSchema,
  keeper_user_id: z.string().min(1),
  accountant_user_id: z.string().min(1),
  status: stockCountStatusSchema,
  created_at: z.string().min(1),
  completed_at: z.string().nullable().optional(),
});

export type StockCount = z.infer<typeof stockCountSchema>;

export const stockCountWithItemsSchema = stockCountSchema.extend({
  items: z.array(stockCountItemSchema),
});

export type StockCountWithItems = z.infer<typeof stockCountWithItemsSchema>;

/**
 * Create Stock Count Payload
 */
export const createStockCountSchema = z
  .object({
    store_id: z.string().min(1),
    warehouse_id: z.string().min(1),
    count_type: countTypeSchema,
    keeper_user_id: z.string().min(1),
    accountant_user_id: z.string().min(1),
  })
  .refine((data) => data.keeper_user_id !== data.accountant_user_id, {
    message: 'keeper_user_id and accountant_user_id must be different individuals',
    path: ['accountant_user_id'],
  });

export type CreateStockCount = z.infer<typeof createStockCountSchema>;

/**
 * Blind 1st Count Submission
 */
export const submitFirstCountItemSchema = z.object({
  item_code: z.string().min(1),
  counted_qty: z.number().min(0),
});

export type SubmitFirstCountItem = z.infer<typeof submitFirstCountItemSchema>;

export const submitFirstCountSchema = z.object({
  count_id: z.string().min(1),
  items: z.array(submitFirstCountItemSchema).min(1),
});

export type SubmitFirstCount = z.infer<typeof submitFirstCountSchema>;

/**
 * 2nd Person Recount Submission
 */
export const submitRecountItemSchema = z.object({
  item_code: z.string().min(1),
  recount_qty: z.number().min(0),
});

export type SubmitRecountItem = z.infer<typeof submitRecountItemSchema>;

export const submitRecountSchema = z.object({
  count_id: z.string().min(1),
  items: z.array(submitRecountItemSchema).min(1),
});

export type SubmitRecount = z.infer<typeof submitRecountSchema>;

/**
 * Stock Adjustment Voucher (t_stock_adjustments)
 * Post-cutoff adjustment approved by Financial Controller.
 * Quantities only — absolutely no financial or ledger write-off amounts.
 */
export const stockAdjustmentSchema = z.object({
  adjustment_id: z.string().min(1),
  count_id: z.string().min(1),
  item_code: z.string().min(1),
  adjustment_qty: z.number(), // signed quantity adjustment
  root_cause_reason: z.string().min(1),
  fc_approval_id: z.string().min(1),
  approved_at: z.string().min(1),
});

export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;

export const createStockAdjustmentSchema = z.object({
  count_id: z.string().min(1),
  item_code: z.string().min(1),
  adjustment_qty: z.number(),
  root_cause_reason: z.string().min(1),
  fc_approval_id: z.string().min(1),
});

export type CreateStockAdjustment = z.infer<typeof createStockAdjustmentSchema>;
