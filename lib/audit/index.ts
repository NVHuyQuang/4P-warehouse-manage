/**
 * lib/audit/index.ts
 * Audit Logging & Security Event Dispatcher for Pizza 4P's India Inventory Control Tool.
 *
 * Requirements:
 * - Records audit events to `t_security_logs` table via Supabase client.
 * - Falls back gracefully to structured security logger if DB write fails.
 * - Guarantees non-disruption of frontline user workflows.
 * - Quantities and physical actions only. Zero commercial or confidential data.
 */

import { supabase } from '@/lib/supabase/client';
import { logger, sanitizeLogData } from '@/lib/logger';

/**
 * Standard Security & Audit Event Types (Flow 0 & S4 Specification)
 */
export const SecurityEventType = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  INVITATION_SENT: 'INVITATION_SENT',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  FAILED_ACTION: 'FAILED_ACTION',
  KEEPALIVE_PING: 'KEEPALIVE_PING',
} as const;

export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];

export const AUDIT_EVENT_TYPES = SecurityEventType;

export const STANDARD_SECURITY_EVENT_TYPES = Object.values(SecurityEventType);

export function isStandardSecurityEventType(eventType: string): eventType is SecurityEventType {
  return STANDARD_SECURITY_EVENT_TYPES.includes(eventType as SecurityEventType);
}

export interface SecurityLogOptions {
  ip?: string;
  deviceInfo?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityLogPayload {
  user_id: string | null;
  event_type: string;
  ip_address: string | null;
  device_info: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordSecurityLogResult {
  success: boolean;
  fallback: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Constructs and sanitizes the security log payload prior to storage or streaming.
 */
export function buildSecurityLogPayload(
  userId: string | null,
  eventType: string,
  options?: SecurityLogOptions
): SecurityLogPayload {
  const sanitizedMetadata = options?.metadata
    ? sanitizeLogData(options.metadata)
    : undefined;

  const sanitizedDeviceInfo = options?.deviceInfo
    ? sanitizeLogData(options.deviceInfo)
    : null;

  return {
    user_id: userId,
    event_type: eventType,
    ip_address: options?.ip ?? null,
    device_info: sanitizedDeviceInfo,
    ...(sanitizedMetadata !== undefined ? { metadata: sanitizedMetadata } : {}),
  };
}

/**
 * Records a security audit event to the `t_security_logs` database table.
 * If the database write fails or network is unavailable, it falls back
 * gracefully to the structured security logger without throwing errors
 * or blocking the caller application flow.
 */
export async function recordSecurityLog(
  userId: string | null,
  eventType: string,
  options?: SecurityLogOptions,
  client = supabase
): Promise<RecordSecurityLogResult> {
  const payload = buildSecurityLogPayload(userId, eventType, options);

  try {
    if (!client || typeof client.from !== 'function') {
      throw new Error('Database client unavailable');
    }

    const dbRecord: Record<string, unknown> = {
      user_id: payload.user_id,
      event_type: payload.event_type,
      ip_address: payload.ip_address,
      device_info: payload.device_info,
    };

    if (payload.metadata && !dbRecord.device_info) {
      dbRecord.device_info = JSON.stringify(payload.metadata);
    } else if (payload.metadata && dbRecord.device_info) {
      dbRecord.device_info = `${payload.device_info} | ${JSON.stringify(payload.metadata)}`;
    }

    const response = await client.from('t_security_logs').insert(dbRecord);

    if (response?.error) {
      const errorMsg = response.error.message || String(response.error);
      logger.warn('Failed to insert security log into database, falling back to structured log', {
        dbError: errorMsg,
        eventType,
        userId,
      });

      logger.security(eventType, {
        userId: payload.user_id,
        ip: payload.ip_address,
        deviceInfo: payload.device_info,
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
        fallbackReason: 'db_error',
        dbError: errorMsg,
      });

      return {
        success: false,
        fallback: true,
        error: errorMsg,
      };
    }

    return {
      success: true,
      fallback: false,
      data: response?.data,
    };
  } catch (err: unknown) {
    const errorObj = err instanceof Error ? err : new Error(String(err));

    logger.warn('Exception recording security log, falling back to structured log', {
      exception: errorObj.message,
      eventType,
      userId,
    });

    logger.security(eventType, {
      userId: payload.user_id,
      ip: payload.ip_address,
      deviceInfo: payload.device_info,
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
      fallbackReason: 'exception',
      exceptionMessage: errorObj.message,
    });

    return {
      success: false,
      fallback: true,
      error: errorObj.message,
    };
  }
}
