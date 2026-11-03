import { z } from 'zod';
import { userRoleSchema } from '@/lib/contracts/enums';

// Payload Validation Schema
export const inviteRequestSchema = z
  .object({
    email: z.string().email(),
    role: userRoleSchema,
    storeId: z.string().min(1).optional(),
    store_id: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.storeId || data.store_id), {
    message: 'storeId or store_id is required',
    path: ['storeId'],
  });

export type InviteRequestBody = z.infer<typeof inviteRequestSchema>;

// Rate Limiter Configuration: 5 requests per 10 minutes per IP / email
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REQUESTS_PER_WINDOW = 5;

interface RateLimitTracker {
  timestamps: number[];
}

const ipRateLimits = new Map<string, RateLimitTracker>();
const emailRateLimits = new Map<string, RateLimitTracker>();

/**
 * Resets the in-memory rate limit store (useful for testing).
 */
export function resetRateLimits(): void {
  ipRateLimits.clear();
  emailRateLimits.clear();
}

export function checkRateLimit(
  key: string,
  store: Map<string, RateLimitTracker>,
  now: number
): boolean {
  const tracker = store.get(key) || { timestamps: [] };
  tracker.timestamps = tracker.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (tracker.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    store.set(key, tracker);
    return true; // Rate limited
  }
  tracker.timestamps.push(now);
  store.set(key, tracker);
  return false;
}

export { ipRateLimits, emailRateLimits };
