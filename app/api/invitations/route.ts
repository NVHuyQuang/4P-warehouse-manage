/**
 * Server Route: User Invitations & Activation Dispatch
 *
 * Implements S1 specification:
 * - Node.js runtime enforcement
 * - Zod payload schema validation
 * - In-memory rate limiting per IP & email (max 5 requests per 10 minutes)
 * - Invokes Supabase RPC create_user_invitation
 * - Dispatches transactional activation link email
 * - Records audit entry in t_security_logs
 *
 * Compliance: Physical inventory quantities only. Zero sensitive commercial metrics.
 * Privacy: India DPDP Act compliant. Zero passwords stored, logged, or emailed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmailAdapter } from '@/lib/email';
import { supabase } from '@/lib/supabase/client';
import { createClient } from '@supabase/supabase-js';
import {
  inviteRequestSchema,
  checkRateLimit,
  ipRateLimits,
  emailRateLimits,
} from '@/lib/email/invitations';

export const runtime = 'nodejs';

function getSupabaseClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  if (serviceRoleKey) {
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabase;
}

export async function POST(request: Request | NextRequest) {
  try {
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Malformed JSON payload' },
        { status: 400 }
      );
    }

    const validation = inviteRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { email, role } = validation.data;
    const storeId = (validation.data.storeId || validation.data.store_id)!;
    const normalizedEmail = email.toLowerCase().trim();

    // Check rate limit per IP and per target email
    const now = Date.now();
    const isIpLimited = checkRateLimit(clientIp, ipRateLimits, now);
    const isEmailLimited = checkRateLimit(normalizedEmail, emailRateLimits, now);

    if (isIpLimited || isEmailLimited) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded: maximum 5 invitation requests per 10 minutes.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': '600',
          },
        }
      );
    }

    const client = getSupabaseClient();

    // Call PostgreSQL RPC create_user_invitation
    const { data: rpcData, error: rpcError } = await client.rpc('create_user_invitation', {
      p_email: normalizedEmail,
      p_role: role,
      p_store_id: storeId,
    });

    if (rpcError) {
      return NextResponse.json(
        { success: false, error: rpcError.message },
        { status: 400 }
      );
    }

    const invitation =
      typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;

    const invitationId =
      invitation?.invitation_id || invitation?.invitationId || 'inv-unknown';
    const status = invitation?.status || 'PENDING';
    const activationToken =
      invitation?.activation_token || invitation?.activationToken;

    // Resolve application origin for activation link
    let origin = 'http://localhost:3000';
    try {
      const parsedUrl = new URL(request.url);
      origin = request.headers.get('origin') || parsedUrl.origin || process.env.NEXT_PUBLIC_APP_URL || origin;
    } catch {
      origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || origin;
    }

    // Pass origin down to environment if not configured
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      process.env.NEXT_PUBLIC_APP_URL = origin;
    }

    // Dispatch activation email when token is available and not pending 2nd approval
    if (activationToken && status !== 'PENDING_SECOND_APPROVAL') {
      const emailAdapter = getEmailAdapter();
      await emailAdapter.sendInvitationEmail(
        normalizedEmail,
        activationToken,
        role,
        storeId
      );
    }

    // Log event to t_security_logs ('INVITATION_SENT')
    try {
      let callerId: string | null = null;
      if (client.auth?.getSession) {
        const { data: sessionData } = await client.auth.getSession();
        callerId = sessionData?.session?.user?.id || null;
      }

      await client.from('t_security_logs').insert({
        user_id: callerId,
        event_type: 'INVITATION_SENT',
        ip_address: clientIp,
        device_info: `Invitation sent to ${normalizedEmail} with role ${role} for store ${storeId}`,
      });
    } catch {
      // Diagnostic log failure must never break caller response
    }

    return NextResponse.json(
      {
        success: true,
        invitationId,
        status,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
