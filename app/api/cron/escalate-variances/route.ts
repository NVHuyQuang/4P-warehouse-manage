import { NextResponse } from 'next/server';
import { verifyCronAuth, getCronSupabaseClient } from '@/lib/cron/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface EscalatedVarianceItem {
  balanceId: string;
  storeId: string;
  warehouseId: string;
  balanceDate: string;
  custodianUserId: string;
  status: string;
  isUnexplained: boolean;
  totalItemsCount: number;
  varianceItemsCount: number;
  signedOffAt: string | null;
  signoffNotes: string | null;
  createdAt: string;
}

async function handleEscalateVariances(request: Request): Promise<NextResponse> {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getCronSupabaseClient();
  let rawRows: Record<string, unknown>[] = [];

  try {
    // 1. Query unresolved variances from derived escalation view
    const { data: viewData, error: viewError } = await supabase
      .from('v_daily_balance_escalations')
      .select('*')
      .order('balance_date', { ascending: false });

    if (!viewError && Array.isArray(viewData)) {
      rawRows = viewData;
    } else {
      // 2. Fallback to base t_daily_balances where status = 'VARIANCE_FLAGGED' and signed_off_at IS NULL or is_unexplained = true
      const { data: tableData, error: tableError } = await supabase
        .from('t_daily_balances')
        .select('*')
        .eq('status', 'VARIANCE_FLAGGED')
        .or('signed_off_at.is.null,is_unexplained.eq.true')
        .order('balance_date', { ascending: false });

      if (!tableError && Array.isArray(tableData)) {
        rawRows = tableData;
      }
    }
  } catch {
    rawRows = [];
  }

  // 3. Compile morning escalation digest for Controller (FC)
  const items: EscalatedVarianceItem[] = rawRows.map((row) => ({
    balanceId: String(row.balance_id || row.balanceId || ''),
    storeId: String(row.store_id || row.storeId || ''),
    warehouseId: String(row.warehouse_id || row.warehouseId || ''),
    balanceDate: String(row.balance_date || row.balanceDate || ''),
    custodianUserId: String(row.custodian_user_id || row.custodianUserId || ''),
    status: String(row.status || 'VARIANCE_FLAGGED'),
    isUnexplained: Boolean(row.is_unexplained ?? row.isUnexplained),
    totalItemsCount: Number(row.total_items_count ?? row.totalItemsCount ?? 0),
    varianceItemsCount: Number(row.variance_items_count ?? row.varianceItemsCount ?? 0),
    signedOffAt: (row.signed_off_at ?? row.signedOffAt ?? null) as string | null,
    signoffNotes: (row.signoff_notes ?? row.signoffNotes ?? null) as string | null,
    createdAt: String(row.created_at || row.createdAt || ''),
  }));

  return NextResponse.json({
    success: true,
    escalatedCount: items.length,
    items,
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleEscalateVariances(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleEscalateVariances(request);
}
