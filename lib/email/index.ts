/**
 * Email Adapter Module Entry Point
 *
 * Provides factory getEmailAdapter() routing to either:
 * - In-memory dev-catcher (dev, test, or when SMTP_HOST is not configured)
 * - Lightweight SMTP adapter (production with SMTP_HOST configured)
 *
 * Compliance: Physical inventory quantities only. Zero commercial metrics.
 */

import type { EmailAdapter } from './adapter';
import { devCatcherAdapter } from './dev-catcher';
import { SmtpEmailAdapter } from './smtp';

export * from './adapter';
export * from './dev-catcher';
export * from './smtp';

/**
 * Factory returning the appropriate EmailAdapter instance based on environment.
 */
export function getEmailAdapter(): EmailAdapter {
  if (process.env.NODE_ENV !== 'production' || !process.env.SMTP_HOST) {
    return devCatcherAdapter;
  }
  return new SmtpEmailAdapter();
}
