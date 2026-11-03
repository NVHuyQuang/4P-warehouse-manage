/**
 * Unit Tests: S1 User Invitations Server Route & Email Adapter
 *
 * Verifies:
 * 1. EmailAdapter implementations (DevCatcher & SMTP formatters).
 * 2. POST /api/invitations route handler with Zod validation.
 * 3. In-memory rate limiting per IP and per target email.
 * 4. DB RPC create_user_invitation invocation and email dispatch.
 * 5. Approver second-approval lifecycle (withholding activation email).
 * 6. Privacy & Security: zero passwords transmitted or logged, synthetic @example.test addresses only.
 * 7. Non-negotiable: Physical quantities only. Strictly operational inventory metrics.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getEmailAdapter,
  devCatcherAdapter,
  getSentMails,
  clearSentMails,
  DevCatcherEmailAdapter,
  SmtpEmailAdapter,
  formatMimeMessage,
} from '@/lib/email';
import {
  POST,
  resetRateLimits,
  MAX_REQUESTS_PER_WINDOW,
} from '@/app/api/invitations/route';
import { supabase } from '@/lib/supabase/client';

describe('S1 Email Adapter System', () => {
  beforeEach(() => {
    clearSentMails();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSentMails();
  });

  describe('DevCatcherEmailAdapter', () => {
    it('captures invitation emails in memory with activation token link', async () => {
      const adapter = new DevCatcherEmailAdapter();
      const success = await adapter.sendInvitationEmail(
        'new-staff@example.test',
        'token-secure-xyz-987',
        'ADMIN',
        'IND-DEL-01'
      );

      expect(success).toBe(true);
      const sent = getSentMails();
      expect(sent).toHaveLength(1);

      const mail = sent[0];
      expect(mail.to).toBe('new-staff@example.test');
      expect(mail.type).toBe('invitation');
      expect(mail.text).toContain('/activate?token=token-secure-xyz-987');
      expect(mail.text).toContain('ADMIN');
      expect(mail.text).toContain('IND-DEL-01');
      expect(mail.metadata?.activationToken).toBe('token-secure-xyz-987');
      expect(mail.metadata?.role).toBe('ADMIN');
      expect(mail.metadata?.storeId).toBe('IND-DEL-01');

      // Privacy: must not contain passwords
      expect(mail.text).not.toContain('password123');
      expect(mail.metadata).not.toHaveProperty('password');
    });

    it('captures password reset emails with reset token link', async () => {
      const adapter = new DevCatcherEmailAdapter();
      const success = await adapter.sendPasswordResetEmail(
        'existing-user@example.test',
        'reset-token-abc-456'
      );

      expect(success).toBe(true);
      const sent = getSentMails();
      expect(sent).toHaveLength(1);

      const mail = sent[0];
      expect(mail.to).toBe('existing-user@example.test');
      expect(mail.type).toBe('password_reset');
      expect(mail.text).toContain('/reset-password?token=reset-token-abc-456');
      expect(mail.metadata?.resetToken).toBe('reset-token-abc-456');

      // Privacy: token link only, never a password
      expect(mail.text).not.toContain('new_password');
      expect(mail.metadata).not.toHaveProperty('password');
    });

    it('captures physical quantity variance alert emails', async () => {
      const adapter = new DevCatcherEmailAdapter();
      const success = await adapter.sendVarianceAlertEmail(
        'approver@example.test',
        'IND-DEL-01',
        '2026-11-03',
        'Item ITM-FLOUR-01 physical quantity discrepancy: -5.0 kg difference between recorded and counted balance.'
      );

      expect(success).toBe(true);
      const sent = getSentMails();
      expect(sent).toHaveLength(1);

      const mail = sent[0];
      expect(mail.to).toBe('approver@example.test');
      expect(mail.type).toBe('variance_alert');
      expect(mail.text).toContain('IND-DEL-01');
      expect(mail.text).toContain('2026-11-03');
      expect(mail.text).toContain('-5.0 kg');
    });

    it('clears sent emails with clearSentMails', async () => {
      const adapter = new DevCatcherEmailAdapter();
      await adapter.sendInvitationEmail('user1@example.test', 'tok-1', 'ADMIN', 'IND-DEL-01');
      await adapter.sendInvitationEmail('user2@example.test', 'tok-2', 'RM', 'IND-DEL-01');
      expect(getSentMails()).toHaveLength(2);

      clearSentMails();
      expect(getSentMails()).toHaveLength(0);
    });
  });

  describe('getEmailAdapter Factory', () => {
    it('returns DevCatcher when NODE_ENV is not production', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSmtp = process.env.SMTP_HOST;
      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
        delete process.env.SMTP_HOST;
        const adapter = getEmailAdapter();
        expect(adapter).toBe(devCatcherAdapter);
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
        if (originalSmtp) process.env.SMTP_HOST = originalSmtp;
      }
    });

    it('returns SmtpEmailAdapter when in production with SMTP_HOST configured', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSmtp = process.env.SMTP_HOST;
      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        process.env.SMTP_HOST = 'smtp.example.test';
        const adapter = getEmailAdapter();
        expect(adapter).toBeInstanceOf(SmtpEmailAdapter);
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
        if (originalSmtp) {
          process.env.SMTP_HOST = originalSmtp;
        } else {
          delete process.env.SMTP_HOST;
        }
      }
    });
  });

  describe('SmtpEmailAdapter & formatMimeMessage', () => {
    it('formats plain text standard MIME message correctly', () => {
      const mime = formatMimeMessage({
        from: 'no-reply@example.test',
        to: 'staff@example.test',
        subject: 'Test Subject',
        text: 'Hello, this is a plain text body.',
      });

      expect(mime).toContain('From: no-reply@example.test');
      expect(mime).toContain('To: staff@example.test');
      expect(mime).toContain('Subject: Test Subject');
      expect(mime).toContain('MIME-Version: 1.0');
      expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
      expect(mime).toContain('Hello, this is a plain text body.');
    });

    it('formats multipart MIME message when html is provided', () => {
      const mime = formatMimeMessage({
        from: 'no-reply@example.test',
        to: 'staff@example.test',
        subject: 'Multipart Subject',
        text: 'Text version',
        html: '<p>HTML version</p>',
      });

      expect(mime).toContain('Content-Type: multipart/alternative;');
      expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
      expect(mime).toContain('Text version');
      expect(mime).toContain('Content-Type: text/html; charset=utf-8');
      expect(mime).toContain('<p>HTML version</p>');
    });

    it('dispatches emails via SmtpEmailAdapter with custom transport hook', async () => {
      let dispatchedMime = '';
      const customSender = async (
        _config: unknown,
        _env: unknown,
        mime: string
      ): Promise<boolean> => {
        dispatchedMime = mime;
        return true;
      };

      const adapter = new SmtpEmailAdapter(
        { host: 'smtp.example.test', port: 587, from: 'no-reply@example.test' },
        customSender
      );

      const result = await adapter.sendInvitationEmail(
        'recipient@example.test',
        'token-smtp-123',
        'ADMIN',
        'IND-DEL-01'
      );

      expect(result).toBe(true);
      expect(dispatchedMime).toContain('To: recipient@example.test');
      expect(dispatchedMime).toContain('/activate?token=token-smtp-123');
    });
  });
});

describe('S1 POST /api/invitations Server Route', () => {
  beforeEach(() => {
    clearSentMails();
    resetRateLimits();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSentMails();
    resetRateLimits();
  });

  it('rejects invalid JSON with 400', async () => {
    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: 'invalid-json{',
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Malformed JSON payload');
  });

  it('rejects invalid email with 400', async () => {
    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'invalid-email-address',
        role: 'ADMIN',
        storeId: 'IND-DEL-01',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation failed');
  });

  it('rejects missing role with 400', async () => {
    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff@example.test',
        storeId: 'IND-DEL-01',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('rejects missing storeId / store_id with 400', async () => {
    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff@example.test',
        role: 'ADMIN',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('successfully creates invitation, sends activation email via dev-catcher, and logs to security log', async () => {
    // Mock Supabase RPC
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        invitation_id: 'inv-test-999',
        email: 'staff-invite-01@example.test',
        role: 'ADMIN',
        store_id: 'IND-DEL-01',
        status: 'PENDING',
        activation_token: 'token-active-secure-12345',
        expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never);

    // Mock Supabase from('t_security_logs').insert
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const fromSpy = vi.spyOn(supabase, 'from').mockReturnValue({
      insert: insertMock,
    } as never);

    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff-invite-01@example.test',
        role: 'ADMIN',
        storeId: 'IND-DEL-01',
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.195',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      success: true,
      invitationId: 'inv-test-999',
      status: 'PENDING',
    });

    // Verify RPC invocation
    expect(rpcSpy).toHaveBeenCalledWith('create_user_invitation', {
      p_email: 'staff-invite-01@example.test',
      p_role: 'ADMIN',
      p_store_id: 'IND-DEL-01',
    });

    // Verify activation email dispatched through dev-catcher
    const sent = getSentMails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('staff-invite-01@example.test');
    expect(sent[0].type).toBe('invitation');
    expect(sent[0].text).toContain('/activate?token=token-active-secure-12345');

    // Verify security log insertion attempted
    expect(fromSpy).toHaveBeenCalledWith('t_security_logs');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'INVITATION_SENT',
        ip_address: '203.0.113.195',
      })
    );
  });

  it('accepts snake_case store_id in payload', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        invitation_id: 'inv-test-snake',
        email: 'runner-01@example.test',
        role: 'RUNNER',
        store_id: 'IND-DEL-01',
        status: 'PENDING',
        activation_token: 'token-snake-456',
      },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never);

    vi.spyOn(supabase, 'from').mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never);

    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'runner-01@example.test',
        role: 'RUNNER',
        store_id: 'IND-DEL-01',
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.12',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.invitationId).toBe('inv-test-snake');
  });

  it('withholds activation email for APPROVER invitations until second approval', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        invitation_id: 'inv-fc-approver-777',
        email: 'fc-candidate@example.test',
        role: 'APPROVER',
        store_id: 'IND-DEL-01',
        status: 'PENDING_SECOND_APPROVAL',
        activation_token: 'token-withheld-999',
      },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never);

    vi.spyOn(supabase, 'from').mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never);

    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'fc-candidate@example.test',
        role: 'APPROVER',
        storeId: 'IND-DEL-01',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.invitationId).toBe('inv-fc-approver-777');
    expect(json.status).toBe('PENDING_SECOND_APPROVAL');

    // Rule 1.2.2: activation token email must be withheld pending second approval
    const sent = getSentMails();
    expect(sent).toHaveLength(0);
  });

  it('handles database RPC error by returning 400 with error message', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'Unauthorized: Only SYSTEM_ADMIN can invite users' },
      count: null,
      status: 400,
      statusText: 'Bad Request',
    } as never);

    const req = new Request('http://localhost:3000/api/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: 'unauth-invite@example.test',
        role: 'ADMIN',
        storeId: 'IND-DEL-01',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Unauthorized');
  });

  describe('Rate Limiting Behavior', () => {
    beforeEach(() => {
      resetRateLimits();
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          invitation_id: 'inv-rate-limit-test',
          email: 'rate-limit@example.test',
          role: 'ADMIN',
          store_id: 'IND-DEL-01',
          status: 'PENDING',
          activation_token: 'token-rate-limit',
        },
        error: null,
        count: null,
        status: 200,
        statusText: 'OK',
      } as never);

      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as never);
    });

    it('allows up to 5 requests per IP within 10 minutes and rejects 6th with 429', async () => {
      const clientIp = '198.51.100.88';

      for (let i = 1; i <= MAX_REQUESTS_PER_WINDOW; i++) {
        const req = new Request('http://localhost:3000/api/invitations', {
          method: 'POST',
          body: JSON.stringify({
            email: `staff-member-${i}@example.test`,
            role: 'ADMIN',
            storeId: 'IND-DEL-01',
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': clientIp,
          },
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
      }

      // 6th request from same IP must be rejected with 429
      const blockedReq = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: 'staff-member-6@example.test',
          role: 'ADMIN',
          storeId: 'IND-DEL-01',
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': clientIp,
        },
      });

      const blockedRes = await POST(blockedReq);
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers.get('Retry-After')).toBe('600');
      const json = await blockedRes.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Rate limit exceeded');
    });

    it('enforces rate limit per target email even across different IPs', async () => {
      const targetEmail = 'targeted-recipient@example.test';

      for (let i = 1; i <= MAX_REQUESTS_PER_WINDOW; i++) {
        const req = new Request('http://localhost:3000/api/invitations', {
          method: 'POST',
          body: JSON.stringify({
            email: targetEmail,
            role: 'ADMIN',
            storeId: 'IND-DEL-01',
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `192.0.2.${i}`,
          },
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
      }

      // 6th request for same email from fresh IP
      const blockedReq = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: targetEmail,
          role: 'ADMIN',
          storeId: 'IND-DEL-01',
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '192.0.2.99',
        },
      });

      const blockedRes = await POST(blockedReq);
      expect(blockedRes.status).toBe(429);
      const json = await blockedRes.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Rate limit exceeded');
    });
  });

  describe('Privacy & DPDP Compliance Verification', () => {
    it('verifies all dispatched emails use @example.test domains and contain zero password credentials', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          invitation_id: 'inv-privacy-test',
          email: 'dpdp-audit@example.test',
          role: 'KITCHEN_REQ',
          store_id: 'IND-DEL-01',
          status: 'PENDING',
          activation_token: 'activation-token-safe-random',
        },
        error: null,
        count: null,
        status: 200,
        statusText: 'OK',
      } as never);

      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as never);

      const req = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: 'dpdp-audit@example.test',
          role: 'KITCHEN_REQ',
          storeId: 'IND-DEL-01',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      await POST(req);

      const sent = getSentMails();
      expect(sent.length).toBeGreaterThan(0);

      for (const mail of sent) {
        expect(mail.to).toMatch(/@example\.test$/);
        // Ensure no actual password string appears
        expect(mail.text).not.toMatch(/password:\s*\S+/i);
        expect(mail.text).not.toMatch(/your password is/i);
        // Ensure activation link contains token parameter
        expect(mail.text).toContain('token=');
      }
    });
  });
});
