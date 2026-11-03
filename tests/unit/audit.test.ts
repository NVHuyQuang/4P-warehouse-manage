/**
 * tests/unit/audit.test.ts
 * Unit Tests for S4 Audit Logging & Structured Logger.
 *
 * Verifications:
 * 1. Redaction & Sanitization: Secrets (passwords, tokens, bearer tokens) sanitized to '[REDACTED]'.
 * 2. Structured JSON Logger: Formatting, levels (INFO, WARN, ERROR, SECURITY), and single-line format.
 * 3. Audit Logging: Payload building and graceful DB fallback without application flow disruption.
 *
 * Invariant Rule:
 * Quantities only. Zero commercial or confidential data terms anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  logger,
  sanitizeLogData,
  formatLogEntry,
  serializeLogEntry,
  type LogEntry,
} from '@/lib/logger';
import {
  recordSecurityLog,
  buildSecurityLogPayload,
  SecurityEventType,
  STANDARD_SECURITY_EVENT_TYPES,
  isStandardSecurityEventType,
  type SecurityLogOptions,
} from '@/lib/audit';

describe('S4 Audit Logging & Structured Logger Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Redaction & Sanitization (sanitizeLogData)', () => {
    it('redacts sensitive keys matching password, token, secret, authorization, cookie, jwt, credit_card', () => {
      const rawData = {
        password: 'plain-text-password-123',
        token: 'auth-token-xyz',
        secret: 'client-super-secret',
        authorization: 'Basic dXNlcjpwYXNz',
        cookie: 'session_id=abcdef123456',
        jwt: 'header.payload.signature',
        credit_card: '4111222233334444',
      };

      const sanitized = sanitizeLogData(rawData);

      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.secret).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.cookie).toBe('[REDACTED]');
      expect(sanitized.jwt).toBe('[REDACTED]');
      expect(sanitized.credit_card).toBe('[REDACTED]');
    });

    it('redacts case variations and composite keys (e.g., userPassword, api_key, creditCard, bearerToken)', () => {
      const compositeData = {
        userPassword: 'mySecretPassword!',
        temporary_password_hash: 'hash-xyz',
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        clientSecret: 'shhh',
        apiKey: 'key-789',
        api_key: 'key-abc',
        creditCard: '5500000000000004',
        credit_card_number: '5500000000000004',
        bearerToken: 'bearer-val',
        ssn: '000-12-3456',
        cvv: '999',
        pin: '1234',
        private_key: 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASC...',
      };

      const sanitized = sanitizeLogData(compositeData);

      expect(sanitized.userPassword).toBe('[REDACTED]');
      expect(sanitized.temporary_password_hash).toBe('[REDACTED]');
      expect(sanitized.accessToken).toBe('[REDACTED]');
      expect(sanitized.refreshToken).toBe('[REDACTED]');
      expect(sanitized.clientSecret).toBe('[REDACTED]');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
      expect(sanitized.creditCard).toBe('[REDACTED]');
      expect(sanitized.credit_card_number).toBe('[REDACTED]');
      expect(sanitized.bearerToken).toBe('[REDACTED]');
      expect(sanitized.ssn).toBe('[REDACTED]');
      expect(sanitized.cvv).toBe('[REDACTED]');
      expect(sanitized.pin).toBe('[REDACTED]');
      expect(sanitized.private_key).toBe('[REDACTED]');
    });

    it('redacts standalone Bearer tokens to [REDACTED]', () => {
      const bearerHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature';
      const sanitized = sanitizeLogData(bearerHeader);
      expect(sanitized).toBe('[REDACTED]');
    });

    it('redacts inline Bearer tokens inside longer strings', () => {
      const message = 'Dispatch failed for session: Bearer secret-auth-session-key-456 at storeroom door';
      const sanitized = sanitizeLogData(message);
      expect(sanitized).toBe('Dispatch failed for session: Bearer [REDACTED] at storeroom door');
    });

    it('redacts embedded JWT strings inside text messages', () => {
      const jwtString =
        'Handshake JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIn0.signature789 validated';
      const sanitized = sanitizeLogData(jwtString);
      expect(sanitized).toBe('Handshake JWT: [REDACTED] validated');
    });

    it('recursively sanitizes nested objects and arrays of records', () => {
      const nested = {
        store_id: 'IND-DEL-01',
        warehouse_id: 'WH-DEL01-COLD',
        session: {
          device: 'iPad Pro Frontline',
          credentials: {
            password: 'super-password',
            jwt: 'token-xyz',
          },
        },
        items: [
          { item_code: 'ITM-CHZ-001', quantity: 10, batch_token: 'secret-batch-flag' },
          { item_code: 'ITM-DRY-002', quantity: 25, access_token: 'key-abc' },
        ],
      };

      const sanitized = sanitizeLogData(nested);

      expect(sanitized.store_id).toBe('IND-DEL-01');
      expect(sanitized.warehouse_id).toBe('WH-DEL01-COLD');
      expect(sanitized.session.device).toBe('iPad Pro Frontline');
      expect(sanitized.session.credentials.password).toBe('[REDACTED]');
      expect(sanitized.session.credentials.jwt).toBe('[REDACTED]');
      expect(sanitized.items[0].item_code).toBe('ITM-CHZ-001');
      expect(sanitized.items[0].quantity).toBe(10);
      expect(sanitized.items[0].batch_token).toBe('[REDACTED]');
      expect(sanitized.items[1].item_code).toBe('ITM-DRY-002');
      expect(sanitized.items[1].quantity).toBe(25);
      expect(sanitized.items[1].access_token).toBe('[REDACTED]');
    });

    it('preserves non-sensitive operational inventory fields intact', () => {
      const operationalPayload = {
        store_id: 'IND-DEL-01',
        warehouse_id: 'WH-DEL01-DRY',
        item_code: 'ITM-FLR-001',
        quantity: 50,
        uom: 'kg',
        batch_number: 'LOT-2026-DEL-01',
        request_id: 'req-001',
      };

      const sanitized = sanitizeLogData(operationalPayload);
      expect(sanitized).toEqual(operationalPayload);
    });

    it('handles null, undefined, and primitive types gracefully without error', () => {
      expect(sanitizeLogData(null)).toBeNull();
      expect(sanitizeLogData(undefined)).toBeUndefined();
      expect(sanitizeLogData(42)).toBe(42);
      expect(sanitizeLogData(true)).toBe(true);
      expect(sanitizeLogData('safe string message')).toBe('safe string message');
    });

    it('handles circular references safely by marking them [CIRCULAR]', () => {
      const cyclic: Record<string, unknown> = {
        store_id: 'IND-DEL-01',
        password: 'password-123',
      };
      cyclic.self = cyclic;

      const sanitized = sanitizeLogData(cyclic);
      expect(sanitized.store_id).toBe('IND-DEL-01');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.self).toBe('[CIRCULAR]');
    });

    it('sanitizes Error objects while preserving name and stack shape', () => {
      const error = new Error('Authentication failed with Bearer secret-token-999');
      (error as unknown as Record<string, unknown>).secretKey = 'sensitive-debug-key';

      const sanitized = sanitizeLogData(error);
      expect(sanitized.name).toBe('Error');
      expect(sanitized.message).toContain('Bearer [REDACTED]');
      expect((sanitized as unknown as Record<string, unknown>).secretKey).toBe('[REDACTED]');
    });
  });

  describe('2. Structured JSON Logger (logger)', () => {
    it('serializes cleanly into a valid single-line JSON string', () => {
      const entry: LogEntry = {
        timestamp: '2026-11-03T08:00:00.000Z',
        level: 'INFO',
        message: 'Shift handover signed',
        meta: {
          store_id: 'IND-DEL-01',
          quantity_verified: 120,
          token: 'leak-token',
        },
      };

      const serialized = serializeLogEntry(entry);

      // Verify single-line format
      expect(serialized).not.toContain('\n');
      expect(serialized).not.toContain('\r');

      // Verify parseable JSON
      const parsed = JSON.parse(serialized);
      expect(parsed.timestamp).toBe('2026-11-03T08:00:00.000Z');
      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('Shift handover signed');
      expect(parsed.meta.store_id).toBe('IND-DEL-01');
      expect(parsed.meta.quantity_verified).toBe(120);
      expect(parsed.meta.token).toBe('[REDACTED]');
    });

    it('logger.info outputs structured JSON with INFO level and sanitized meta', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = logger.info('Picking completed for section request', {
        request_id: 'req-002',
        quantity: 15,
        password: 'myPassword',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(result);
      expect(logged.level).toBe('INFO');
      expect(logged.message).toBe('Picking completed for section request');
      expect(logged.meta.request_id).toBe('req-002');
      expect(logged.meta.quantity).toBe(15);
      expect(logged.meta.password).toBe('[REDACTED]');
      expect(logged.timestamp).toBeDefined();
    });

    it('logger.warn outputs structured JSON with WARN level and sanitized meta', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = logger.warn('Discrepancy flagged during daily count', {
        store_id: 'IND-DEL-01',
        discrepancy_quantity: -2,
        authorization: 'Bearer auth-leak',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(result);
      expect(logged.level).toBe('WARN');
      expect(logged.message).toBe('Discrepancy flagged during daily count');
      expect(logged.meta.store_id).toBe('IND-DEL-01');
      expect(logged.meta.discrepancy_quantity).toBe(-2);
      expect(logged.meta.authorization).toBe('[REDACTED]');
    });

    it('logger.error outputs structured JSON with ERROR level, sanitized error, and meta', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const sampleError = new Error('Database write rejected: token expired');
      const result = logger.error('Operation failed at storeroom door', sampleError, {
        action: 'CONFIRM_RECEIPT',
        access_token: 'secret-runner-token',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(result);
      expect(logged.level).toBe('ERROR');
      expect(logged.message).toBe('Operation failed at storeroom door');
      expect(logged.error.name).toBe('Error');
      expect(logged.error.message).toContain('Database write rejected');
      expect(logged.meta.action).toBe('CONFIRM_RECEIPT');
      expect(logged.meta.access_token).toBe('[REDACTED]');
    });

    it('logger.security outputs structured JSON with SECURITY level and event name', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = logger.security(SecurityEventType.LOGIN_SUCCESS, {
        user_id: 'usr-admin-01',
        ip: '10.0.0.12',
        session_token: 'session-token-raw',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(result);
      expect(logged.level).toBe('SECURITY');
      expect(logged.event).toBe('LOGIN_SUCCESS');
      expect(logged.message).toBe('LOGIN_SUCCESS');
      expect(logged.meta.user_id).toBe('usr-admin-01');
      expect(logged.meta.ip).toBe('10.0.0.12');
      expect(logged.meta.session_token).toBe('[REDACTED]');
    });

    it('formatLogEntry builds standard log entry objects', () => {
      const entry = formatLogEntry({
        level: 'INFO',
        message: 'System benchmark check completed',
        meta: { checked_count: 50 },
      });

      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('System benchmark check completed');
      expect(entry.meta).toEqual({ checked_count: 50 });
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('3. Audit Payload Building (buildSecurityLogPayload)', () => {
    it('builds payload for all 8 standard security event types', () => {
      for (const eventType of STANDARD_SECURITY_EVENT_TYPES) {
        expect(isStandardSecurityEventType(eventType)).toBe(true);

        const payload = buildSecurityLogPayload('usr-100', eventType, {
          ip: '192.168.1.100',
          deviceInfo: 'Handheld Scanner Android',
          metadata: { note: 'Routine verification' },
        });

        expect(payload.user_id).toBe('usr-100');
        expect(payload.event_type).toBe(eventType);
        expect(payload.ip_address).toBe('192.168.1.100');
        expect(payload.device_info).toBe('Handheld Scanner Android');
        expect(payload.metadata).toEqual({ note: 'Routine verification' });
      }
    });

    it('handles null userId for unauthenticated or non-existent user attempts', () => {
      const payload = buildSecurityLogPayload(null, SecurityEventType.LOGIN_FAILED, {
        ip: '203.0.113.195',
        deviceInfo: 'Chrome on macOS',
        metadata: { attemptedEmail: 'unknown@pizza4ps.com' },
      });

      expect(payload.user_id).toBeNull();
      expect(payload.event_type).toBe('LOGIN_FAILED');
      expect(payload.ip_address).toBe('203.0.113.195');
      expect(payload.device_info).toBe('Chrome on macOS');
      expect(payload.metadata?.attemptedEmail).toBe('unknown@pizza4ps.com');
    });

    it('sanitizes credentials inside metadata during payload building', () => {
      const payload = buildSecurityLogPayload('usr-keeper-01', SecurityEventType.PASSWORD_RESET, {
        ip: '127.0.0.1',
        metadata: {
          reset_token: 'cleartext-reset-token-777',
          new_password: 'cleartext-password-999',
          cookie: 'session_tracker_cookie',
          authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
          status: 'SUCCESS',
        },
      });

      expect(payload.metadata?.reset_token).toBe('[REDACTED]');
      expect(payload.metadata?.new_password).toBe('[REDACTED]');
      expect(payload.metadata?.cookie).toBe('[REDACTED]');
      expect(payload.metadata?.authorization).toBe('[REDACTED]');
      expect(payload.metadata?.status).toBe('SUCCESS');
    });

    it('sanitizes sensitive strings inside deviceInfo', () => {
      const payload = buildSecurityLogPayload('usr-keeper-01', SecurityEventType.INVITATION_SENT, {
        deviceInfo: 'App Dispatch with Bearer secret-invite-token-abc',
      });

      expect(payload.device_info).toBe('App Dispatch with Bearer [REDACTED]');
    });

    it('sets default nulls when optional fields are omitted', () => {
      const payload = buildSecurityLogPayload('usr-001', SecurityEventType.KEEPALIVE_PING);

      expect(payload.user_id).toBe('usr-001');
      expect(payload.event_type).toBe('KEEPALIVE_PING');
      expect(payload.ip_address).toBeNull();
      expect(payload.device_info).toBeNull();
      expect(payload.metadata).toBeUndefined();
    });
  });

  describe('4. recordSecurityLog Execution & Graceful DB Fallback', () => {
    it('successfully writes audit log to t_security_logs when database client succeeds', async () => {
      const mockInsert = vi.fn().mockResolvedValue({
        data: [{ log_id: 'sec-001', event_type: 'LOGIN_SUCCESS' }],
        error: null,
      });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      };

      const result = await recordSecurityLog(
        'usr-test-01',
        SecurityEventType.LOGIN_SUCCESS,
        { ip: '10.0.1.5', deviceInfo: 'Desktop Firefox' },
        mockClient as never
      );

      expect(result.success).toBe(true);
      expect(result.fallback).toBe(false);
      expect(mockClient.from).toHaveBeenCalledWith('t_security_logs');
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: 'usr-test-01',
        event_type: 'LOGIN_SUCCESS',
        ip_address: '10.0.1.5',
        device_info: 'Desktop Firefox',
      });
    });

    it('falls back gracefully to structured security logger when database insert returns an error', async () => {
      const secSpy = vi.spyOn(logger, 'security');
      const warnSpy = vi.spyOn(logger, 'warn');

      const mockInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection timeout' },
      });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      };

      const options: SecurityLogOptions = {
        ip: '10.0.1.5',
        deviceInfo: 'Terminal Scanner',
        metadata: { token: 'secret-token-leak' },
      };

      const result = await recordSecurityLog(
        'usr-test-02',
        SecurityEventType.ACCOUNT_LOCKED,
        options,
        mockClient as never
      );

      // Verify the application flow was NOT disrupted (no throw)
      expect(result.success).toBe(false);
      expect(result.fallback).toBe(true);
      expect(result.error).toBe('Database connection timeout');

      // Verify logger.warn was called to note the DB failure
      expect(warnSpy).toHaveBeenCalled();

      // Verify logger.security was invoked as fallback with redacted metadata
      expect(secSpy).toHaveBeenCalledWith(
        'ACCOUNT_LOCKED',
        expect.objectContaining({
          userId: 'usr-test-02',
          ip: '10.0.1.5',
          deviceInfo: 'Terminal Scanner',
          metadata: { token: '[REDACTED]' },
          fallbackReason: 'db_error',
        })
      );
    });

    it('falls back gracefully when database client throws an unexpected network exception', async () => {
      const secSpy = vi.spyOn(logger, 'security');
      const warnSpy = vi.spyOn(logger, 'warn');

      const mockClient = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('Network socket disconnected');
        }),
      };

      const result = await recordSecurityLog(
        'usr-test-03',
        SecurityEventType.FAILED_ACTION,
        { deviceInfo: 'Mobile POS' },
        mockClient as never
      );

      // Verify application flow is never disrupted
      expect(result.success).toBe(false);
      expect(result.fallback).toBe(true);
      expect(result.error).toBe('Network socket disconnected');

      // Verify logger.warn recorded the exception
      expect(warnSpy).toHaveBeenCalled();

      // Verify logger.security was invoked as fallback
      expect(secSpy).toHaveBeenCalledWith(
        'FAILED_ACTION',
        expect.objectContaining({
          userId: 'usr-test-03',
          deviceInfo: 'Mobile POS',
          fallbackReason: 'exception',
          exceptionMessage: 'Network socket disconnected',
        })
      );
    });

    it('packs metadata into device_info when device_info is not provided', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ data: [], error: null });
      const mockClient = {
        from: vi.fn().mockReturnValue({ insert: mockInsert }),
      };

      const options: SecurityLogOptions = {
        ip: '10.0.0.50',
        metadata: { action: 'ROLE_ASSIGNED', target_role: 'KITCHEN_REQ' },
      };

      const result = await recordSecurityLog(
        'usr-admin-01',
        SecurityEventType.ROLE_ASSIGNED,
        options,
        mockClient as never
      );

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: 'usr-admin-01',
        event_type: 'ROLE_ASSIGNED',
        ip_address: '10.0.0.50',
        device_info: JSON.stringify({ action: 'ROLE_ASSIGNED', target_role: 'KITCHEN_REQ' }),
      });
    });
  });
});
