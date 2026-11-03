import { NextResponse } from 'next/server';
import { verifyCronAuth, getCronSupabaseClient } from '@/lib/cron/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface BackupManifest {
  manifestId: string;
  snapshotDate: string;
  generatedAt: string;
  bucket: string;
  storagePath: string;
  staged: boolean;
  uploaded: boolean;
  summary: {
    ledgerMovementCount: number;
    dailyBalanceCount: number;
    dailyBalanceItemCount: number;
    stockCountCount: number;
    storeCount: number;
    itemCount: number;
    latestMovementTimestamp: string | null;
    latestBalanceDate: string | null;
  };
}

async function handleBackup(request: Request): Promise<NextResponse> {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const snapshotDate = timestamp.slice(0, 10);
  const supabase = getCronSupabaseClient();

  let ledgerMovementCount = 0;
  let dailyBalanceCount = 0;
  let dailyBalanceItemCount = 0;
  let stockCountCount = 0;
  let storeCount = 0;
  let itemCount = 0;
  let latestMovementTimestamp: string | null = null;
  let latestBalanceDate: string | null = null;

  try {
    const [
      movementsRes,
      balancesRes,
      balanceItemsRes,
      stockCountsRes,
      storesRes,
      itemsRes,
      latestMvtRes,
      latestBalRes,
    ] = await Promise.allSettled([
      supabase.from('t_stock_movements').select('*', { count: 'exact', head: true }),
      supabase.from('t_daily_balances').select('*', { count: 'exact', head: true }),
      supabase.from('t_daily_balance_items').select('*', { count: 'exact', head: true }),
      supabase.from('t_stock_counts').select('*', { count: 'exact', head: true }),
      supabase.from('m_stores').select('*', { count: 'exact', head: true }),
      supabase.from('m_items').select('*', { count: 'exact', head: true }),
      supabase.from('t_stock_movements').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('t_daily_balances').select('balance_date').order('balance_date', { ascending: false }).limit(1),
    ]);

    if (movementsRes.status === 'fulfilled' && movementsRes.value.count !== null && movementsRes.value.count !== undefined) {
      ledgerMovementCount = movementsRes.value.count;
    }
    if (balancesRes.status === 'fulfilled' && balancesRes.value.count !== null && balancesRes.value.count !== undefined) {
      dailyBalanceCount = balancesRes.value.count;
    }
    if (balanceItemsRes.status === 'fulfilled' && balanceItemsRes.value.count !== null && balanceItemsRes.value.count !== undefined) {
      dailyBalanceItemCount = balanceItemsRes.value.count;
    }
    if (stockCountsRes.status === 'fulfilled' && stockCountsRes.value.count !== null && stockCountsRes.value.count !== undefined) {
      stockCountCount = stockCountsRes.value.count;
    }
    if (storesRes.status === 'fulfilled' && storesRes.value.count !== null && storesRes.value.count !== undefined) {
      storeCount = storesRes.value.count;
    }
    if (itemsRes.status === 'fulfilled' && itemsRes.value.count !== null && itemsRes.value.count !== undefined) {
      itemCount = itemsRes.value.count;
    }

    if (latestMvtRes.status === 'fulfilled' && latestMvtRes.value.data && latestMvtRes.value.data.length > 0) {
      latestMovementTimestamp = latestMvtRes.value.data[0].created_at ?? null;
    }
    if (latestBalRes.status === 'fulfilled' && latestBalRes.value.data && latestBalRes.value.data.length > 0) {
      latestBalanceDate = latestBalRes.value.data[0].balance_date ?? null;
    }
  } catch {
    // Non-blocking fallback for local or offline execution
  }

  const summary = {
    ledgerMovementCount,
    dailyBalanceCount,
    dailyBalanceItemCount,
    stockCountCount,
    storeCount,
    itemCount,
    latestMovementTimestamp,
    latestBalanceDate,
  };

  const storagePath = `daily-snapshots/${snapshotDate}/metadata-snapshot.json`;
  const bucket = 'backups';
  let uploaded = false;
  let staged = true;

  const snapshotContent = {
    metadata: {
      type: 'INVENTORY_METADATA_SNAPSHOT',
      snapshotDate,
      generatedAt: timestamp,
      unitSystem: 'QUANTITIES_ONLY',
    },
    summary,
  };

  try {
    const fileBuffer = Buffer.from(JSON.stringify(snapshotContent, null, 2), 'utf-8');
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, fileBuffer, {
        contentType: 'application/json',
        upsert: true,
      });

    if (!uploadErr && uploadData) {
      uploaded = true;
      staged = false;
    }
  } catch {
    staged = true;
  }

  const backupManifest: BackupManifest = {
    manifestId: `manifest-${snapshotDate}`,
    snapshotDate,
    generatedAt: timestamp,
    bucket,
    storagePath,
    staged,
    uploaded,
    summary,
  };

  return NextResponse.json({
    success: true,
    timestamp,
    backupManifest,
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleBackup(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleBackup(request);
}
