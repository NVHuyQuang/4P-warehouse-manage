import { supabase } from '@/lib/supabase/client';

export type ApprovalItemType =
  | 'USER_INVITATION'
  | 'STOCK_COUNT'
  | 'TRANSFER_VARIANCE'
  | 'WASTE_CLAIM'
  | 'SAP_IMPORT_CORRECTION'
  | 'STORE_WAREHOUSE_PROPOSAL';

export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export type ApprovalCategoryKey =
  | 'all'
  | 'open'
  | 'waste'
  | 'transfers'
  | 'counts'
  | 'sap'
  | 'proposals'
  | 'users';

export interface ApprovalInboxItem {
  item_type: ApprovalItemType;
  item_id: string;
  store_id: string | null;
  summary: string;
  requested_by_user_id: string | null;
  requested_at: string;
  target_role: string;
  status: string;
  // UI and Domain presentation fields
  reference_id: string;
  title: string;
  item_code?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  uom?: string | null;
  storeroom?: string | null;
  logged_by_role: string;
  logged_by_name?: string;
  notes?: string;
  size_category: 'minor' | 'major';
  current_stock?: number;
  decision_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decided_at?: string | null;
  decided_by_role?: string | null;
  target_module?: 'count' | 'transfers' | 'overview' | 'issues';
}

const KNOWN_ITEMS: Record<string, { name: string; uom: string; book: number }> = {
  'RM-MOZ-01': { name: 'Mozzarella block', uom: 'kg', book: 42.5 },
  'RM-BUR-01': { name: 'Burrata', uom: 'pcs', book: 18.0 },
  'RM-SAL-01': { name: 'Salmon fillet', uom: 'kg', book: 5.4 },
  'RM-CHK-01': { name: 'Chicken breast', uom: 'kg', book: 26.0 },
  'RM-BAS-01': { name: 'Fresh basil', uom: 'kg', book: 4.8 },
  'RM-GOR-01': { name: 'Gorgonzola', uom: 'kg', book: 3.6 },
  'RM-DOU-01': { name: 'Pizza dough balls', uom: 'pcs', book: 120.0 },
  'RM-RIC-01': { name: 'Ricotta', uom: 'kg', book: 8.0 },
  'RM-PAR-01': { name: 'Parmesan', uom: 'kg', book: 15.0 },
};

// Initial realistic mock store covering all 6 domains
const mockInboxItems: ApprovalInboxItem[] = [
  {
    item_type: 'STOCK_COUNT',
    item_id: '550e8400-e29b-41d4-a716-446655440007',
    store_id: 'IND-DEL-01',
    summary: 'Stock count recount pending FC adjustment approval for warehouse WH-DEL01-COLD',
    requested_by_user_id: 'u-acct-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    target_role: 'FC',
    status: 'RECOUNT',
    reference_id: 'ADJ-0007',
    title: 'Count adjustment voucher',
    item_code: 'RM-GOR-01',
    item_name: 'Gorgonzola',
    quantity: -0.4,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Store Accountant',
    logged_by_name: 'Store Accountant (acct)',
    notes: 'Book 4.0 kg, counted 3.6 kg after recount.',
    size_category: 'minor',
    current_stock: 3.6,
    decision_status: 'PENDING',
    target_module: 'count',
  },
  {
    item_type: 'STOCK_COUNT',
    item_id: '550e8400-e29b-41d4-a716-446655440008',
    store_id: 'IND-DEL-01',
    summary: 'Stock count recount pending FC adjustment approval for warehouse WH-DEL01-COLD',
    requested_by_user_id: 'u-keeper-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 160).toISOString(),
    target_role: 'FC',
    status: 'RECOUNT',
    reference_id: 'ADJ-0008',
    title: 'Count adjustment voucher',
    item_code: 'RM-BAS-01',
    item_name: 'Fresh basil',
    quantity: -0.2,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Warehouse Keeper',
    logged_by_name: 'Warehouse Keeper (Admin)',
    notes: 'Recounted twice, cause: trimming loss.',
    size_category: 'minor',
    current_stock: 4.8,
    decision_status: 'PENDING',
    target_module: 'count',
  },
  {
    item_type: 'WASTE_CLAIM',
    item_id: '550e8400-e29b-41d4-a716-446655440031',
    store_id: 'IND-DEL-01',
    summary: 'Waste & return claim for item RM-SAL-01 (qty 3.100 kg)',
    requested_by_user_id: 'u-keeper-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
    target_role: 'FC',
    status: 'PENDING',
    reference_id: 'WST-0031',
    title: 'Waste claim, expired lot',
    item_code: 'RM-SAL-01',
    item_name: 'Salmon fillet',
    quantity: -3.1,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Warehouse Keeper',
    logged_by_name: 'Warehouse Keeper (Admin)',
    notes: 'Above sample minor threshold (2.0 kg). Financial Controller approves.',
    size_category: 'major',
    current_stock: 5.4,
    decision_status: 'PENDING',
    target_module: 'transfers',
  },
  {
    item_type: 'WASTE_CLAIM',
    item_id: '550e8400-e29b-41d4-a716-446655440032',
    store_id: 'IND-DEL-01',
    summary: 'Waste & return claim for item RM-BAS-01 (qty 0.600 kg)',
    requested_by_user_id: 'u-keeper-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    target_role: 'RM',
    status: 'PENDING',
    reference_id: 'WST-0032',
    title: 'Waste claim, spoilage',
    item_code: 'RM-BAS-01',
    item_name: 'Fresh basil',
    quantity: -0.6,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Warehouse Keeper',
    logged_by_name: 'Warehouse Keeper (Admin)',
    notes: 'Below sample minor threshold (2.0 kg). Restaurant Manager may approve.',
    size_category: 'minor',
    current_stock: 4.8,
    decision_status: 'PENDING',
    target_module: 'transfers',
  },
  {
    item_type: 'WASTE_CLAIM',
    item_id: '550e8400-e29b-41d4-a716-446655440009',
    store_id: 'IND-DEL-01',
    summary: 'Waste & return claim for item RM-CHK-01 (qty 2.000 kg)',
    requested_by_user_id: 'u-keeper-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 100).toISOString(),
    target_role: 'FC',
    status: 'PENDING',
    reference_id: 'RET-0009',
    title: 'Supplier return claim',
    item_code: 'RM-CHK-01',
    item_name: 'Chicken breast',
    quantity: -2.0,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Warehouse Keeper',
    logged_by_name: 'Warehouse Keeper (Admin)',
    notes: 'GRPO 5104398, failed temperature check. Returned to driver on delivery note.',
    size_category: 'major',
    current_stock: 26.0,
    decision_status: 'PENDING',
    target_module: 'transfers',
  },
  {
    item_type: 'TRANSFER_VARIANCE',
    item_id: '550e8400-e29b-41d4-a716-446655440102',
    store_id: 'IND-DEL-01',
    summary: 'Inter-store transfer variance pending FC approval: item RM-MOZ-01 (variance -0.600)',
    requested_by_user_id: 'u-keeper-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    target_role: 'FC',
    status: 'VARIANCE_PENDING_FC',
    reference_id: 'TRF-0102',
    title: 'Transfer variance',
    item_code: 'RM-MOZ-01',
    item_name: 'Mozzarella block',
    quantity: -0.6,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Warehouse Keeper',
    logged_by_name: 'Warehouse Keeper (Admin)',
    notes: 'Dispatched 12.0 kg / 48 pcs. Received 11.4 kg / 46 pcs. Dispatch keeper cannot approve.',
    size_category: 'major',
    current_stock: 42.5,
    decision_status: 'PENDING',
    target_module: 'transfers',
  },
  {
    item_type: 'STORE_WAREHOUSE_PROPOSAL',
    item_id: '550e8400-e29b-41d4-a716-446655440003',
    store_id: 'IND-BLR-01',
    summary: 'Store/warehouse proposal: NEW_STORE - Pizza 4Ps Bengaluru Indiranagar',
    requested_by_user_id: 'u-rm-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    target_role: 'FC',
    status: 'PENDING',
    reference_id: 'STR-0003',
    title: 'New store proposal',
    item_code: null,
    item_name: null,
    quantity: null,
    uom: null,
    storeroom: 'Cold Room + Dry Store',
    logged_by_role: 'Restaurant Manager',
    logged_by_name: 'Restaurant Manager (RM)',
    notes: 'Requested by Restaurant Manager. Go-live checklist 9 of 11 complete.',
    size_category: 'major',
    decision_status: 'PENDING',
  },
  {
    item_type: 'USER_INVITATION',
    item_id: '550e8400-e29b-41d4-a716-446655440052',
    store_id: 'IND-DEL-01',
    summary: 'Approver invitation second approval for controller.secondary@pizza4ps.com',
    requested_by_user_id: 'u-fc-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    target_role: 'FC',
    status: 'PENDING_SECOND_APPROVAL',
    reference_id: 'USR-0052',
    title: 'Approver account, second approval',
    item_code: null,
    item_name: null,
    quantity: null,
    uom: null,
    storeroom: null,
    logged_by_role: 'Financial Controller',
    logged_by_name: 'Financial Controller (fc)',
    notes: 'Requested for your own role. An independent executive must approve.',
    size_category: 'major',
    decision_status: 'PENDING',
  },
  {
    item_type: 'SAP_IMPORT_CORRECTION',
    item_id: '550e8400-e29b-41d4-a716-446655440041',
    store_id: 'IND-DEL-01',
    summary: 'SAP GRPO import line correction requiring 2nd approval for item RM-MOZ-01 (qty 12.000)',
    requested_by_user_id: 'u-keeper-01',
    requested_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    target_role: 'FC',
    status: 'NEEDS_2ND_APPROVAL',
    reference_id: 'IMP-0041',
    title: 'SAP GRPO import line correction',
    item_code: 'RM-MOZ-01',
    item_name: 'Mozzarella block',
    quantity: 12.0,
    uom: 'kg',
    storeroom: 'Cold Room (WH-01)',
    logged_by_role: 'Warehouse Keeper',
    logged_by_name: 'Warehouse Keeper (Admin)',
    notes: 'GRPO_20261028.xlsx · Line #2: Quantity adjustment requiring secondary authorization.',
    size_category: 'major',
    current_stock: 42.5,
    decision_status: 'PENDING',
  },
];

function isOfflineOrMissing(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('fetch') ||
    msg.includes('offline') ||
    msg.includes('PGRST') ||
    msg.includes('NetworkError') ||
    msg.includes('Failed to fetch')
  );
}

function enrichDbRecord(rec: Record<string, unknown>): ApprovalInboxItem {
  const itemType = String(rec.item_type || 'WASTE_CLAIM') as ApprovalItemType;
  const itemId = String(rec.item_id);
  const summary = String(rec.summary || '');
  const storeId = rec.store_id ? String(rec.store_id) : null;
  const targetRole = String(rec.target_role || 'FC');
  const status = String(rec.status || 'PENDING');
  const requestedBy = rec.requested_by_user_id ? String(rec.requested_by_user_id) : null;
  const requestedAt = rec.requested_at ? String(rec.requested_at) : new Date().toISOString();

  // Extract reference ID or item code from summary if possible
  let itemCode: string | null = null;
  for (const code of Object.keys(KNOWN_ITEMS)) {
    if (summary.includes(code)) {
      itemCode = code;
      break;
    }
  }

  // Derive reference ID
  let referenceId = itemId.slice(0, 8).toUpperCase();
  if (itemType === 'STOCK_COUNT') referenceId = `ADJ-${itemId.slice(0, 4).toUpperCase()}`;
  else if (itemType === 'WASTE_CLAIM') referenceId = `WST-${itemId.slice(0, 4).toUpperCase()}`;
  else if (itemType === 'TRANSFER_VARIANCE') referenceId = `TRF-${itemId.slice(0, 4).toUpperCase()}`;
  else if (itemType === 'STORE_WAREHOUSE_PROPOSAL') referenceId = `STR-${itemId.slice(0, 4).toUpperCase()}`;
  else if (itemType === 'USER_INVITATION') referenceId = `USR-${itemId.slice(0, 4).toUpperCase()}`;
  else if (itemType === 'SAP_IMPORT_CORRECTION') referenceId = `IMP-${itemId.slice(0, 4).toUpperCase()}`;

  const itemMeta = itemCode ? KNOWN_ITEMS[itemCode] : null;

  return {
    item_type: itemType,
    item_id: itemId,
    store_id: storeId,
    summary,
    requested_by_user_id: requestedBy,
    requested_at: requestedAt,
    target_role: targetRole,
    status,
    reference_id: referenceId,
    title: summary.split(':')[0] || itemType,
    item_code: itemCode,
    item_name: itemMeta ? itemMeta.name : null,
    quantity: null,
    uom: itemMeta ? itemMeta.uom : null,
    storeroom: storeId ? 'Cold Room (WH-01)' : null,
    logged_by_role: 'Operations Staff',
    notes: summary,
    size_category: 'major',
    current_stock: itemMeta ? itemMeta.book : undefined,
    decision_status: 'PENDING',
  };
}

/**
 * Queries the unified v_approval_inbox view across all 6 operational domains.
 * Applies multi-store and role-based filtering, falling back gracefully to prototype data.
 */
export async function getApprovalInbox(
  storeId?: string,
  targetRole?: string
): Promise<ApprovalInboxItem[]> {
  try {
    let query = supabase.from('v_approval_inbox').select('*');

    if (storeId && storeId !== 'ALL') {
      query = query.or(`store_id.eq.${storeId},store_id.is.null`);
    }

    if (targetRole) {
      if (targetRole === 'RM') {
        // RM only sees waste claims targeted to RM for their branch
        query = query.eq('target_role', 'RM');
      }
    }

    const { data, error } = await query.order('requested_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return (data as Record<string, unknown>[]).map(enrichDbRecord);
    }
  } catch {
    // Fall back to in-memory store in dev / offline mode
  }

  // Fallback filtering on mock records
  return mockInboxItems.filter((item) => {
    // Role filter
    if (targetRole === 'RM') {
      if (item.target_role !== 'RM' && item.item_type !== 'WASTE_CLAIM') {
        return false;
      }
    }
    // Store filter
    if (storeId && storeId !== 'ALL') {
      if (item.store_id && item.store_id !== storeId) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Executes formal approval or rejection on an inbox item.
 * Routes to the domain-specific security definer RPC while maintaining
 * the append-only ledger and segregation of duties rules.
 */
export async function approveInboxItem(
  itemType: string,
  itemId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string
): Promise<void> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId);

  try {
    if (itemType === 'STORE_WAREHOUSE_PROPOSAL' && isUuid) {
      const { error } = await supabase.rpc('decide_store_warehouse_proposal', {
        p_approval_id: itemId,
        p_decision: decision,
        p_comment: comment || null,
      });
      if (error && !isOfflineOrMissing(error)) {
        throw new Error(error.message);
      }
    } else if (itemType === 'WASTE_CLAIM' && isUuid) {
      const { error } = await supabase.rpc('approve_waste_or_return', {
        p_log_id: itemId,
        p_decision: decision,
        p_comment: comment || null,
      });
      if (error && !isOfflineOrMissing(error)) {
        throw new Error(error.message);
      }
    } else if (itemType === 'TRANSFER_VARIANCE' && isUuid) {
      if (decision === 'APPROVED') {
        const { error } = await supabase.rpc('approve_transfer_variance', {
          p_transfer_id: itemId,
          p_notes: comment || null,
        });
        if (error && !isOfflineOrMissing(error)) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.rpc('reject_transfer_variance', {
          p_transfer_id: itemId,
          p_rejection_reason: comment || 'Rejected by Financial Controller',
        });
        if (error && !isOfflineOrMissing(error)) {
          throw new Error(error.message);
        }
      }
    } else if (itemType === 'SAP_IMPORT_CORRECTION' && isUuid) {
      if (decision === 'APPROVED') {
        const { error } = await supabase.rpc('approve_grpo_correction', {
          p_import_item_id: itemId,
          p_notes: comment || null,
        });
        if (error && !isOfflineOrMissing(error)) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.rpc('reject_grpo_correction', {
          p_import_item_id: itemId,
          p_rejection_reason: comment || 'Rejected by approver',
        });
        if (error && !isOfflineOrMissing(error)) {
          throw new Error(error.message);
        }
      }
    } else if (itemType === 'USER_INVITATION') {
      if (decision === 'APPROVED') {
        const { error } = await supabase.rpc('approve_approver_invitation', {
          p_invitation_id: itemId,
        });
        if (error && !isOfflineOrMissing(error)) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase
          .from('m_user_invitations')
          .update({ status: 'CANCELLED' })
          .eq('invitation_id', itemId);
        if (error && !isOfflineOrMissing(error)) {
          throw new Error(error.message);
        }
      }
    } else if (itemType === 'STOCK_COUNT' && isUuid) {
      if (decision === 'APPROVED') {
        const { data: adj } = await supabase
          .from('t_stock_adjustments')
          .select('adjustment_id')
          .eq('count_id', itemId)
          .maybeSingle();

        if (adj && (adj as { adjustment_id: string }).adjustment_id) {
          const { error } = await supabase.rpc('approve_stock_adjustment', {
            p_adjustment_id: (adj as { adjustment_id: string }).adjustment_id,
            p_notes: comment || null,
          });
          if (error && !isOfflineOrMissing(error)) {
            throw new Error(error.message);
          }
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && !isOfflineOrMissing(err)) {
      throw err;
    }
  }

  // Update in-memory mock store
  const target = mockInboxItems.find((it) => it.item_id === itemId || it.reference_id === itemId);
  if (target) {
    target.decision_status = decision;
    target.decided_at = new Date().toISOString();
    target.decided_by_role = 'Financial Controller';
    target.status = decision;
  }
}
