import { z } from 'zod';
import { dailyBalanceStatusSchema } from './enums';

/**
 * Daily Benchmark Balance Line Item (t_daily_balance_items)
 * Quantities only — benchmark stock comparison.
 */
export const dailyBalanceItemSchema = z.object({
  balance_item_id: z.string().min(1),
  balance_id: z.string().min(1),
  item_code: z.string().min(1),
  opening_qty: z.number(),
  received_qty: z.number(),
  issued_qty: z.number(),
  expected_qty: z.number(), // opening_qty + received_qty - issued_qty
  counted_qty: z.number(),
  variance_qty: z.number(), // counted_qty - expected_qty
  variance_reason: z.string().nullable().optional(),
  responsible_person: z.string().nullable().optional(),
});

export type DailyBalanceItem = z.infer<typeof dailyBalanceItemSchema>;

/**
 * Daily Benchmark Balance Header (t_daily_balances)
 */
export const dailyBalanceSchema = z.object({
  balance_id: z.string().min(1),
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'balance_date must be YYYY-MM-DD'),
  custodian_user_id: z.string().min(1),
  status: dailyBalanceStatusSchema,
  finance_lead_signoff_id: z.string().nullable().optional(),
  created_at: z.string().min(1),
  signed_at: z.string().nullable().optional(),
});

export type DailyBalance = z.infer<typeof dailyBalanceSchema>;

export const dailyBalanceWithItemsSchema = dailyBalanceSchema.extend({
  items: z.array(dailyBalanceItemSchema),
});

export type DailyBalanceWithItems = z.infer<typeof dailyBalanceWithItemsSchema>;

/**
 * Daily Balance Submission Payload
 */
export const createDailyBalanceItemInputSchema = z.object({
  item_code: z.string().min(1),
  opening_qty: z.number(),
  received_qty: z.number(),
  issued_qty: z.number(),
  counted_qty: z.number(),
  variance_reason: z.string().nullable().optional(),
  responsible_person: z.string().nullable().optional(),
});

export type CreateDailyBalanceItemInput = z.infer<typeof createDailyBalanceItemInputSchema>;

export const createDailyBalanceSchema = z.object({
  store_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'balance_date must be YYYY-MM-DD'),
  custodian_user_id: z.string().min(1),
  items: z.array(createDailyBalanceItemInputSchema).min(1),
});

export type CreateDailyBalance = z.infer<typeof createDailyBalanceSchema>;

/**
 * Daily Balance Sign-off Payload (Finance Lead / Custodian sign-off)
 */
export const signDailyBalanceSchema = z.object({
  balance_id: z.string().min(1),
  signoff_user_id: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export type SignDailyBalance = z.infer<typeof signDailyBalanceSchema>;
