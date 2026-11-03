import { NextResponse } from 'next/server';
import { verifyCronAuth, getCronSupabaseClient } from '@/lib/cron/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleKeepalive(request: Request): Promise<NextResponse> {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  const supabase = getCronSupabaseClient();

  // 1. Lightweight keepalive query on Supabase to keep project warm and prevent free-tier 7-day inactivity pause
  try {
    await supabase.from('m_stores').select('store_id').limit(1);
  } catch {
    // Keepalive probe continues even during connection warmup
  }

  // 2. Record keepalive event to t_security_logs with event_type 'KEEPALIVE_PING'
  try {
    await supabase.from('t_security_logs').insert({
      event_type: 'KEEPALIVE_PING',
      device_info: 'CRON_KEEPALIVE_WORKER',
      ip_address: '127.0.0.1',
    });
  } catch {
    // Non-blocking audit log record
  }

  return NextResponse.json({
    success: true,
    timestamp,
    status: 'alive',
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleKeepalive(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleKeepalive(request);
}
