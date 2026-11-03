'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge, BadgeVariant } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';
import {
  getLedgerMovements,
  calculateDerivedStockAfter,
  LedgerMovementRecord,
} from '@/lib/data/ledger';
import { MovementType } from '@/lib/contracts/enums';

interface ActiveIssueItem {
  itemCode: string;
  itemName: string;
  uom: string;
  requestedQty: number;
  stagedQty: number;
  acceptedQty: number;
  declinedQty: number;
  batchNumber: string;
  expiryDate: string;
  warehouseId: string;
  warehouseName: string;
}

interface ActiveIssue {
  requestId: string;
  storeId: string;
  section: string;
  stagedBy: string;
  stagedByRole: string;
  stagedAt: string;
  status: 'AWAITING_RUNNER' | 'CONFIRMED' | 'PARTIAL_ACCEPTED' | 'REVERSED';
  isUrgent: boolean;
  urgentReason?: string;
  items: ActiveIssueItem[];
  resolutionNote?: string;
}

const INITIAL_ACTIVE_ISSUES: ActiveIssue[] = [
  {
    requestId: 'REQ-2026-1103-01',
    storeId: 'IND-DEL-01',
    section: 'Kitchen Section',
    stagedBy: 'Warehouse Keeper (Admin)',
    stagedByRole: 'Warehouse Keeper',
    stagedAt: '10:05 AM',
    status: 'AWAITING_RUNNER',
    isUrgent: true,
    urgentReason: 'Lunch service preparation line replenishment',
    items: [
      {
        itemCode: 'RM-MOZ-01',
        itemName: 'Mozzarella block',
        uom: 'kg',
        requestedQty: 15.0,
        stagedQty: 15.0,
        acceptedQty: 15.0,
        declinedQty: 0,
        batchNumber: 'LOT-2026-MOZ-01',
        expiryDate: '2026-11-20',
        warehouseId: 'WH-DEL01-COLD',
        warehouseName: 'Cold Room',
      },
      {
        itemCode: 'RM-BAS-01',
        itemName: 'Fresh basil',
        uom: 'kg',
        requestedQty: 2.0,
        stagedQty: 2.0,
        acceptedQty: 2.0,
        declinedQty: 0,
        batchNumber: 'LOT-2026-BAS-01',
        expiryDate: '2026-11-06',
        warehouseId: 'WH-DEL01-COLD',
        warehouseName: 'Cold Room',
      },
    ],
  },
  {
    requestId: 'REQ-2026-1103-02',
    storeId: 'IND-DEL-01',
    section: 'Bar Section',
    stagedBy: 'Warehouse Keeper (Admin)',
    stagedByRole: 'Warehouse Keeper',
    stagedAt: '10:25 AM',
    status: 'AWAITING_RUNNER',
    isUrgent: false,
    items: [
      {
        itemCode: 'RM-BUR-01',
        itemName: 'Burrata',
        uom: 'pcs',
        requestedQty: 6.0,
        stagedQty: 6.0,
        acceptedQty: 6.0,
        declinedQty: 0,
        batchNumber: 'LOT-2026-BUR-01',
        expiryDate: '2026-11-12',
        warehouseId: 'WH-DEL01-COLD',
        warehouseName: 'Cold Room',
      },
    ],
  },
];

type MovementBadgeMapping = {
  variant: BadgeVariant;
  label: string;
};

function getMovementBadgeConfig(type: MovementType): MovementBadgeMapping {
  switch (type) {
    case 'GRPO_IMPORT':
      return { variant: 'ok', label: 'Inbound GRPO' };
    case 'ISSUE_PENDING':
      return { variant: 'am', label: 'Issue Pending' };
    case 'ISSUE_PENDING_OFFSET':
      return { variant: 'am', label: 'Pending Offset' };
    case 'ISSUE_CONFIRMED':
      return { variant: 're', label: 'Issue Confirmed' };
    case 'ISSUE_REVERSAL':
      return { variant: 'ok', label: 'Door Reversal' };
    case 'WASTE_DISPOSAL':
      return { variant: 'er', label: 'Waste Disposal' };
    case 'SUPPLIER_RETURN':
      return { variant: 'er', label: 'Return to Source' };
    case 'TRANSFER_OUT_INTRANSIT':
      return { variant: 'mu', label: 'Transfer Out' };
    case 'TRANSFER_IN_RECEIVED':
      return { variant: 'ok', label: 'Transfer In' };
    case 'COUNT_ADJUSTMENT':
      return { variant: 'mu', label: 'Count Adjustment' };
    default:
      return { variant: 'mu', label: type };
  }
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day} ${month} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

export default function IssuesLedgerPage() {
  const { role, roleConfig, store, showToast } = useShell();

  const [activeTab, setActiveTab] = useState<'active' | 'ledger'>('active');
  const [activeIssues, setActiveIssues] = useState<ActiveIssue[]>(INITIAL_ACTIVE_ISSUES);
  const [ledgerMovements, setLedgerMovements] = useState<LedgerMovementRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters for Movement Ledger Tab
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [selectedExample, setSelectedExample] = useState<1 | 2 | 3>(1);

  // Partial accept editor state for active issue
  const [editingPartialRequestId, setEditingPartialRequestId] = useState<string | null>(null);
  const [partialInputs, setPartialInputs] = useState<Record<string, { accepted: number; reason: string }>>({});

  const storeTitle = STORE_NAMES[store] || store;

  // Load ledger movements on mount or store change
  useEffect(() => {
    let mounted = true;
    async function fetchMovements() {
      setLoading(true);
      try {
        const data = await getLedgerMovements(store);
        if (mounted) {
          setLedgerMovements(data);
        }
      } catch {
        if (mounted) {
          setLedgerMovements([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    fetchMovements();
    return () => {
      mounted = false;
    };
  }, [store]);

  // Handle Full Confirm of an Active Issue (Flow C-2 Worked Example 2)
  const handleConfirmFull = (issue: ActiveIssue) => {
    const newMovements: LedgerMovementRecord[] = [];
    const timestamp = new Date().toISOString();

    for (const item of issue.items) {
      // Step 2a: Clear pending reservation (ISSUE_PENDING_OFFSET +stagedQty)
      newMovements.push({
        movement_id: `mvt-${Date.now()}-off-${item.itemCode}`,
        store_id: store,
        warehouse_id: item.warehouseId,
        item_code: item.itemCode,
        item_name: item.itemName,
        movement_type: 'ISSUE_PENDING_OFFSET',
        quantity: item.stagedQty,
        uom: item.uom,
        batch_number: item.batchNumber,
        expiry_date: item.expiryDate,
        reference_doc_id: issue.requestId,
        created_by_user_id: 'usr-runner-01',
        actor_name: 'Kitchen Runner',
        created_at: timestamp,
      });

      // Step 2b: Confirm physical delivery to section (ISSUE_CONFIRMED -stagedQty)
      newMovements.push({
        movement_id: `mvt-${Date.now()}-cnf-${item.itemCode}`,
        store_id: store,
        warehouse_id: item.warehouseId,
        item_code: item.itemCode,
        item_name: item.itemName,
        movement_type: 'ISSUE_CONFIRMED',
        quantity: -item.stagedQty,
        uom: item.uom,
        batch_number: item.batchNumber,
        expiry_date: item.expiryDate,
        reference_doc_id: issue.requestId,
        created_by_user_id: 'usr-runner-01',
        actor_name: 'Kitchen Runner',
        created_at: timestamp,
      });
    }

    // Update active issue status
    setActiveIssues((prev) =>
      prev.map((iss) =>
        iss.requestId === issue.requestId
          ? {
              ...iss,
              status: 'CONFIRMED',
              resolutionNote: 'Full handover confirmed at storeroom door. Physical goods received by runner.',
            }
          : iss
      )
    );

    // Append to ledger movements and recalculate running derived stock
    setLedgerMovements((prev) => {
      const merged = [...prev, ...newMovements];
      return calculateDerivedStockAfter(merged).reverse();
    });

    showToast(`Issue ${issue.requestId} confirmed: Full quantity handed over at storeroom door.`);
  };

  // Handle Full Decline of an Active Issue (Flow C-2 Worked Example 1)
  const handleDeclineFull = (issue: ActiveIssue) => {
    const newMovements: LedgerMovementRecord[] = [];
    const timestamp = new Date().toISOString();

    for (const item of issue.items) {
      // Step 2: Return goods to shelf (ISSUE_REVERSAL +stagedQty)
      newMovements.push({
        movement_id: `mvt-${Date.now()}-rev-${item.itemCode}`,
        store_id: store,
        warehouse_id: item.warehouseId,
        item_code: item.itemCode,
        item_name: item.itemName,
        movement_type: 'ISSUE_REVERSAL',
        quantity: item.stagedQty,
        uom: item.uom,
        batch_number: item.batchNumber,
        expiry_date: item.expiryDate,
        reference_doc_id: issue.requestId,
        created_by_user_id: 'usr-runner-01',
        actor_name: 'Kitchen Runner',
        created_at: timestamp,
      });
    }

    setActiveIssues((prev) =>
      prev.map((iss) =>
        iss.requestId === issue.requestId
          ? {
              ...iss,
              status: 'REVERSED',
              resolutionNote: 'Goods declined at door by runner. Physical stock returned to shelf.',
            }
          : iss
      )
    );

    setLedgerMovements((prev) => {
      const merged = [...prev, ...newMovements];
      return calculateDerivedStockAfter(merged).reverse();
    });

    showToast(`Issue ${issue.requestId} declined: Goods returned to shelf. ISSUE_REVERSAL appended.`);
  };

  // Open partial acceptance editor
  const handleStartPartial = (issue: ActiveIssue) => {
    const initialInputs: Record<string, { accepted: number; reason: string }> = {};
    for (const item of issue.items) {
      initialInputs[item.itemCode] = {
        accepted: Math.max(0, item.stagedQty - 1),
        reason: 'Partial receipt: remaining quantity returned to shelf due to bin container limitation',
      };
    }
    setPartialInputs(initialInputs);
    setEditingPartialRequestId(issue.requestId);
  };

  // Submit Partial Accept (Flow C-2 Worked Example 3)
  const handleSubmitPartial = (issue: ActiveIssue) => {
    const newMovements: LedgerMovementRecord[] = [];
    const timestamp = new Date().toISOString();

    for (const item of issue.items) {
      const input = partialInputs[item.itemCode] || { accepted: item.stagedQty, reason: '' };
      const acceptedQty = Math.max(0, Math.min(item.stagedQty, input.accepted));

      // Step 2a: Offset the entire staged reservation (ISSUE_PENDING_OFFSET +stagedQty)
      newMovements.push({
        movement_id: `mvt-${Date.now()}-off-${item.itemCode}`,
        store_id: store,
        warehouse_id: item.warehouseId,
        item_code: item.itemCode,
        item_name: item.itemName,
        movement_type: 'ISSUE_PENDING_OFFSET',
        quantity: item.stagedQty,
        uom: item.uom,
        batch_number: item.batchNumber,
        expiry_date: item.expiryDate,
        reference_doc_id: issue.requestId,
        created_by_user_id: 'usr-runner-01',
        actor_name: 'Kitchen Runner',
        created_at: timestamp,
      });

      // Step 2b: Confirm the accepted quantity delivered to section (ISSUE_CONFIRMED -acceptedQty)
      if (acceptedQty > 0) {
        newMovements.push({
          movement_id: `mvt-${Date.now()}-cnf-${item.itemCode}`,
          store_id: store,
          warehouse_id: item.warehouseId,
          item_code: item.itemCode,
          item_name: item.itemName,
          movement_type: 'ISSUE_CONFIRMED',
          quantity: -acceptedQty,
          uom: item.uom,
          batch_number: item.batchNumber,
          expiry_date: item.expiryDate,
          reference_doc_id: issue.requestId,
          created_by_user_id: 'usr-runner-01',
          actor_name: 'Kitchen Runner',
          created_at: timestamp,
        });
      }
    }

    setActiveIssues((prev) =>
      prev.map((iss) =>
        iss.requestId === issue.requestId
          ? {
              ...iss,
              status: 'PARTIAL_ACCEPTED',
              resolutionNote: 'Partial acceptance verified. Staged balance cleared, accepted stock confirmed.',
            }
          : iss
      )
    );

    setLedgerMovements((prev) => {
      const merged = [...prev, ...newMovements];
      return calculateDerivedStockAfter(merged).reverse();
    });

    setEditingPartialRequestId(null);
    showToast(`Issue ${issue.requestId} partial handover confirmed at storeroom door.`);
  };

  // Reset active issues to demonstration defaults
  const handleResetActiveIssues = () => {
    setActiveIssues(INITIAL_ACTIVE_ISSUES);
    showToast('Active issues reset to initial staged demonstration state.');
  };

  // Filtered movements for Tab 2
  const filteredMovements = useMemo(() => {
    return ledgerMovements.filter((m) => {
      // Movement type filter
      if (typeFilter !== 'ALL') {
        if (typeFilter === 'GRPO' && m.movement_type !== 'GRPO_IMPORT') return false;
        if (typeFilter === 'PENDING' && m.movement_type !== 'ISSUE_PENDING') return false;
        if (typeFilter === 'OFFSET' && m.movement_type !== 'ISSUE_PENDING_OFFSET') return false;
        if (typeFilter === 'CONFIRMED' && m.movement_type !== 'ISSUE_CONFIRMED') return false;
        if (typeFilter === 'REVERSAL' && m.movement_type !== 'ISSUE_REVERSAL') return false;
        if (typeFilter === 'WASTE' && m.movement_type !== 'WASTE_DISPOSAL' && m.movement_type !== 'SUPPLIER_RETURN') return false;
        if (typeFilter === 'TRANSFERS' && m.movement_type !== 'TRANSFER_OUT_INTRANSIT' && m.movement_type !== 'TRANSFER_IN_RECEIVED') return false;
        if (typeFilter === 'COUNT' && m.movement_type !== 'COUNT_ADJUSTMENT') return false;
      }

      // Search item code or name or doc
      if (itemSearch.trim().length > 0) {
        const query = itemSearch.toLowerCase();
        const matchesCode = m.item_code.toLowerCase().includes(query);
        const matchesName = m.item_name.toLowerCase().includes(query);
        const matchesDoc = m.reference_doc_id.toLowerCase().includes(query);
        const matchesBatch = m.batch_number ? m.batch_number.toLowerCase().includes(query) : false;
        if (!matchesCode && !matchesName && !matchesDoc && !matchesBatch) return false;
      }

      // Date filter
      if (dateFilter !== 'ALL') {
        const mDate = new Date(m.created_at);
        const now = new Date('2026-11-03T23:59:59.999Z');
        const diffMs = now.getTime() - mDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (dateFilter === 'TODAY' && diffDays > 1) return false;
        if (dateFilter === '3DAYS' && diffDays > 3) return false;
        if (dateFilter === '7DAYS' && diffDays > 7) return false;
      }

      return true;
    });
  }, [ledgerMovements, typeFilter, itemSearch, dateFilter]);

  const awaitingCount = activeIssues.filter((i) => i.status === 'AWAITING_RUNNER').length;

  return (
    <>
      {store !== 'IND-DEL-01' && (
        <div className="note am" style={{ marginBottom: 16 }}>
          Prototype displays demonstration movements and active issues for {store}.
        </div>
      )}

      {/* Screen Header */}
      <div className="head">
        <div>
          <div className="kicker">
            Store {store} &middot; {storeTitle}
          </div>
          <h1 className="h1">
            Stock Issues <em>&amp; Movement Ledger</em>
          </h1>
          <p className="sub">
            Flow C-2 Two-Stage Issue Handover. Physical movements are strictly append-only. Stock is dynamically derived. Historical records are immutable.
          </p>
        </div>

        {/* Top Tab Switcher */}
        <div className="seg" role="tablist" aria-label="Issues and ledger navigation">
          <button
            type="button"
            className={activeTab === 'active' ? 'on' : ''}
            onClick={() => setActiveTab('active')}
          >
            Active Issues {awaitingCount > 0 && `(${awaitingCount})`}
          </button>
          <button
            type="button"
            className={activeTab === 'ledger' ? 'on' : ''}
            onClick={() => setActiveTab('ledger')}
          >
            Append-Only Movement Ledger ({ledgerMovements.length})
          </button>
        </div>
      </div>

      {/* TAB 1: ACTIVE ISSUES */}
      {activeTab === 'active' && (
        <div className="stack">
          {/* Two-Stage Issue Protocol Timeline */}
          <div className="win" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span className="lbl">Flow C-2 &middot; Two-Stage Issue Handover Lifecycle</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge variant="ok">Segregation of Duties Enforced</Badge>
                <Badge variant="mu">Append-Only Immutability</Badge>
              </div>
            </div>

            <div className="tl">
              <div className="done">
                <div className="dot" />
                <div className="tt">1. Staged</div>
                <div className="ts">Keeper picks from queue (FIFO). App appends ISSUE_PENDING (−qty).</div>
              </div>
              <div className="cur">
                <div className="dot" />
                <div className="tt">2. Door Inspection</div>
                <div className="ts">Runner inspects goods and batch labels at storeroom door.</div>
              </div>
              <div>
                <div className="dot" />
                <div className="tt">3. Handover / Result</div>
                <div className="ts">Runner confirms (offset + confirmed issue) or declines (reversal to shelf).</div>
              </div>
            </div>
          </div>

          <div className="cols c-is">
            {/* Left Column: Active Issues Awaiting Runner Confirmation */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 className="h3">
                  Awaiting Runner Confirmation{' '}
                  <span className="meta" style={{ fontWeight: 400, textTransform: 'none' }}>
                    ({awaitingCount} pending)
                  </span>
                </h3>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={handleResetActiveIssues}
                  title="Reset demonstration items to initial awaiting state"
                >
                  Reset Demo Issues
                </button>
              </div>

              {activeIssues.length === 0 ? (
                <div className="note ok">
                  All active issues have been confirmed or reversed. Pick queue is clear.
                </div>
              ) : (
                <div className="stack">
                  {activeIssues.map((issue) => {
                    const isPending = issue.status === 'AWAITING_RUNNER';
                    const isEditingThisPartial = editingPartialRequestId === issue.requestId;

                    return (
                      <Ticket
                        key={issue.requestId}
                        no={issue.requestId}
                        right={
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {issue.isUrgent && <Badge variant="ur">Urgent</Badge>}
                            {issue.status === 'AWAITING_RUNNER' && <Badge variant="am">Awaiting Runner</Badge>}
                            {issue.status === 'CONFIRMED' && <Badge variant="ok">Confirmed</Badge>}
                            {issue.status === 'PARTIAL_ACCEPTED' && <Badge variant="re">Partial Accepted</Badge>}
                            {issue.status === 'REVERSED' && <Badge variant="er">Declined at Door</Badge>}
                            <span className="meta">{issue.section}</span>
                          </div>
                        }
                      >
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                            <span className="meta">
                              Staged by <b>{issue.stagedBy}</b> at {issue.stagedAt}
                            </span>
                            <span className="meta">Handover point: Storeroom Door</span>
                          </div>
                          {issue.urgentReason && (
                            <div className="note am" style={{ marginTop: 8, padding: '4px 10px', fontSize: 13 }}>
                              <b>Urgent requisition rationale:</b> {issue.urgentReason}
                            </div>
                          )}
                          {issue.resolutionNote && (
                            <div
                              className={`note ${
                                issue.status === 'CONFIRMED'
                                  ? 'ok'
                                  : issue.status === 'REVERSED'
                                  ? 'er'
                                  : 'am'
                              }`}
                              style={{ marginTop: 8, padding: '6px 10px', fontSize: 13 }}
                            >
                              <b>Handover Result:</b> {issue.resolutionNote}
                            </div>
                          )}
                        </div>

                        {/* Staged Line Items Table */}
                        <table className="dense" style={{ marginBottom: 14 }}>
                          <thead>
                            <tr>
                              <th>Item Code &amp; Name</th>
                              <th>Location</th>
                              <th>Batch / Expiry</th>
                              <th className="num">Staged Qty</th>
                              <th className="num">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issue.items.map((it) => (
                              <tr key={it.itemCode}>
                                <td>
                                  <div>
                                    <b>{it.itemCode}</b>
                                  </div>
                                  <div className="meta">{it.itemName}</div>
                                </td>
                                <td className="m">{it.warehouseName}</td>
                                <td className="m">
                                  <div>{it.batchNumber}</div>
                                  <span className="meta">Exp: {it.expiryDate}</span>
                                </td>
                                <td className="num">
                                  <b>{it.stagedQty.toFixed(3)}</b>{' '}
                                  <span className="meta">{it.uom}</span>
                                </td>
                                <td className="num">
                                  {issue.status === 'AWAITING_RUNNER' ? (
                                    <Badge variant="am">Staged (−{it.stagedQty.toFixed(1)})</Badge>
                                  ) : issue.status === 'CONFIRMED' ? (
                                    <Badge variant="ok">Received ({it.stagedQty.toFixed(1)})</Badge>
                                  ) : issue.status === 'REVERSED' ? (
                                    <Badge variant="er">Returned to shelf</Badge>
                                  ) : (
                                    <Badge variant="re">Partial</Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Inline Partial Handover Form */}
                        {isEditingThisPartial && (
                          <div
                            style={{
                              background: '#F9F6F0',
                              border: '1px dashed var(--rule)',
                              borderRadius: 4,
                              padding: 12,
                              marginBottom: 14,
                            }}
                          >
                            <span className="lbl">Runner Door Inspection &middot; Adjust Accepted Quantities</span>
                            <p className="meta" style={{ marginTop: 4, marginBottom: 10 }}>
                              Specify accepted quantity handed over to runner. The staged reservation is cleared and physical stock accepted is confirmed. Remaining stock is physically returned to storeroom shelf.
                            </p>

                            {issue.items.map((it) => {
                              const currentVal = partialInputs[it.itemCode]?.accepted ?? it.stagedQty;
                              const currentReason = partialInputs[it.itemCode]?.reason ?? '';

                              return (
                                <div key={it.itemCode} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px dotted var(--rule)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <b>{it.itemName} ({it.itemCode})</b>
                                    <span className="meta">Staged: {it.stagedQty} {it.uom}</span>
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 10, marginTop: 6, alignItems: 'center' }}>
                                    <div>
                                      <label className="lbl" style={{ fontSize: 11 }}>Accepted Qty ({it.uom})</label>
                                      <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max={it.stagedQty}
                                        value={currentVal}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          setPartialInputs((prev) => ({
                                            ...prev,
                                            [it.itemCode]: {
                                              ...prev[it.itemCode],
                                              accepted: val,
                                            },
                                          }));
                                        }}
                                        className="in"
                                      />
                                    </div>
                                    <div>
                                      <label className="lbl" style={{ fontSize: 11 }}>Reason for Variance</label>
                                      <input
                                        type="text"
                                        placeholder="Reason (e.g. 2 kg returned to shelf due to packaging defect)"
                                        value={currentReason}
                                        onChange={(e) => {
                                          const r = e.target.value;
                                          setPartialInputs((prev) => ({
                                            ...prev,
                                            [it.itemCode]: {
                                              ...prev[it.itemCode],
                                              reason: r,
                                            },
                                          }));
                                        }}
                                        className="in"
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}

                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                              <button
                                type="button"
                                className="btn ghost sm"
                                onClick={() => setEditingPartialRequestId(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn sm"
                                onClick={() => handleSubmitPartial(issue)}
                              >
                                Confirm Partial Handover
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Door Action Buttons */}
                        {isPending && !isEditingThisPartial && (
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => handleConfirmFull(issue)}
                              title="Full delivery accepted at door"
                            >
                              Confirm Full Handover
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => handleStartPartial(issue)}
                              title="Runner accepts partial quantity at door"
                            >
                              Partial Acceptance...
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              style={{ color: 'var(--err)', borderColor: '#E8B8AD' }}
                              onClick={() => handleDeclineFull(issue)}
                              title="Runner declines goods; returns items to shelf"
                            >
                              Decline at Door
                            </button>
                            <span className="meta" style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
                              Runner digital signature recorded upon button action.
                            </span>
                          </div>
                        )}
                      </Ticket>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Worked Examples Reference Card */}
            <div>
              <div style={{ marginBottom: 12 }}>
                <h3 className="h3">Worked Examples Reference</h3>
                <span className="meta">Flow C-2 Append-Only State Transitions</span>
              </div>

              <Ticket
                no="DOC-§4.1-EXAMPLES"
                right={<Badge variant="ok">Baseline: 100 kg Shelf Stock</Badge>}
              >
                <div style={{ marginBottom: 12 }}>
                  <p className="meta" style={{ margin: '0 0 10px' }}>
                    Reference specifications for append-only two-stage issue transactions. Initial stock received via <code>GRPO_IMPORT</code> = 100 kg.
                  </p>

                  <div className="seg" style={{ width: '100%', display: 'flex', marginBottom: 12 }}>
                    <button
                      type="button"
                      className={selectedExample === 1 ? 'on' : ''}
                      style={{ flex: 1, padding: '6px 4px', fontSize: 11 }}
                      onClick={() => setSelectedExample(1)}
                    >
                      Ex 1: Full Decline
                    </button>
                    <button
                      type="button"
                      className={selectedExample === 2 ? 'on' : ''}
                      style={{ flex: 1, padding: '6px 4px', fontSize: 11 }}
                      onClick={() => setSelectedExample(2)}
                    >
                      Ex 2: Full Confirm
                    </button>
                    <button
                      type="button"
                      className={selectedExample === 3 ? 'on' : ''}
                      style={{ flex: 1, padding: '6px 4px', fontSize: 11 }}
                      onClick={() => setSelectedExample(3)}
                    >
                      Ex 3: Partial (3/5)
                    </button>
                  </div>
                </div>

                {/* Example 1 Detail */}
                {selectedExample === 1 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <b>Worked Example 1: Issue 5 kg, Runner Declines 5 kg</b>
                      <Badge variant="er">Net Delta = 0 kg</Badge>
                    </div>
                    <p className="meta" style={{ margin: '0 0 10px' }}>
                      Runner inspects goods at door and declines (e.g. damaged packaging). Goods return physically to shelf.
                    </p>

                    <div style={{ background: '#FAF7F0', border: '1px solid var(--rule)', borderRadius: 4, padding: 10, marginBottom: 10 }}>
                      <div className="ledrow">
                        <span className="t"><Badge variant="ok">GRPO_IMPORT</Badge></span>
                        <span>Inbound receipt baseline</span>
                        <span className="num pos">+100.000 kg</span>
                      </div>
                      <div className="ledrow">
                        <span className="t"><Badge variant="am">ISSUE_PENDING</Badge></span>
                        <span>Admin stages 5 kg for pick</span>
                        <span className="num neg">−5.000 kg</span>
                      </div>
                      <div className="ledrow" style={{ borderBottom: 0 }}>
                        <span className="t"><Badge variant="ok">ISSUE_REVERSAL</Badge></span>
                        <span>Runner declines; goods return to shelf</span>
                        <span className="num pos">+5.000 kg</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }} className="meta">
                      <div>Derived Stock: <b>100.000 kg</b></div>
                      <div>Requisition: <b>PARTIAL_DECLINED</b></div>
                      <div>Ledger Records: <b>3 rows</b></div>
                      <div>Historical Rows: <b>Immutable</b></div>
                    </div>
                  </div>
                )}

                {/* Example 2 Detail */}
                {selectedExample === 2 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <b>Worked Example 2: Issue 5 kg, Runner Confirms 5 kg</b>
                      <Badge variant="ok">Net Delta = −5 kg</Badge>
                    </div>
                    <p className="meta" style={{ margin: '0 0 10px' }}>
                      Runner inspects and accepts full delivery at door. Handover complete. Zero double-counting.
                    </p>

                    <div style={{ background: '#FAF7F0', border: '1px solid var(--rule)', borderRadius: 4, padding: 10, marginBottom: 10 }}>
                      <div className="ledrow">
                        <span className="t"><Badge variant="ok">GRPO_IMPORT</Badge></span>
                        <span>Inbound receipt baseline</span>
                        <span className="num pos">+100.000 kg</span>
                      </div>
                      <div className="ledrow">
                        <span className="t"><Badge variant="am">ISSUE_PENDING</Badge></span>
                        <span>Admin stages 5 kg for pick</span>
                        <span className="num neg">−5.000 kg</span>
                      </div>
                      <div className="ledrow">
                        <span className="t"><Badge variant="am">ISSUE_PENDING_OFFSET</Badge></span>
                        <span>Clearing pending reservation</span>
                        <span className="num pos">+5.000 kg</span>
                      </div>
                      <div className="ledrow" style={{ borderBottom: 0 }}>
                        <span className="t"><Badge variant="re">ISSUE_CONFIRMED</Badge></span>
                        <span>Confirmed issue handed to runner</span>
                        <span className="num neg">−5.000 kg</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }} className="meta">
                      <div>Derived Stock: <b>95.000 kg</b></div>
                      <div>Requisition: <b>CONFIRMED</b></div>
                      <div>Net Shelf Deduction: <b>Exactly −5.000 kg</b></div>
                      <div>Double-Counting: <b>0.000 kg</b></div>
                    </div>
                  </div>
                )}

                {/* Example 3 Detail */}
                {selectedExample === 3 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <b>Worked Example 3: Confirm 3 kg, Decline 2 kg</b>
                      <Badge variant="re">Net Delta = −3 kg</Badge>
                    </div>
                    <p className="meta" style={{ margin: '0 0 10px' }}>
                      Runner accepts 3 kg; 2 kg returned to shelf. App offsets full reservation and confirms 3 kg.
                    </p>

                    <div style={{ background: '#FAF7F0', border: '1px solid var(--rule)', borderRadius: 4, padding: 10, marginBottom: 10 }}>
                      <div className="ledrow">
                        <span className="t"><Badge variant="ok">GRPO_IMPORT</Badge></span>
                        <span>Inbound receipt baseline</span>
                        <span className="num pos">+100.000 kg</span>
                      </div>
                      <div className="ledrow">
                        <span className="t"><Badge variant="am">ISSUE_PENDING</Badge></span>
                        <span>Admin stages 5 kg for pick</span>
                        <span className="num neg">−5.000 kg</span>
                      </div>
                      <div className="ledrow">
                        <span className="t"><Badge variant="am">ISSUE_PENDING_OFFSET</Badge></span>
                        <span>Clearing full 5 kg pending</span>
                        <span className="num pos">+5.000 kg</span>
                      </div>
                      <div className="ledrow" style={{ borderBottom: 0 }}>
                        <span className="t"><Badge variant="re">ISSUE_CONFIRMED</Badge></span>
                        <span>Confirmed issue for 3 kg accepted</span>
                        <span className="num neg">−3.000 kg</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }} className="meta">
                      <div>Derived Stock: <b>97.000 kg</b></div>
                      <div>Requisition: <b>PARTIAL_ACCEPTED</b></div>
                      <div>Returned to Shelf: <b>2.000 kg</b></div>
                      <div>Delivered to Kitchen: <b>3.000 kg</b></div>
                    </div>
                  </div>
                )}

                {/* Ledger Timeline Comparison Matrix Table */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--rule)' }}>
                  <span className="lbl" style={{ display: 'block', marginBottom: 8 }}>
                    Ledger Timeline Comparison Matrix
                  </span>
                  <table className="dense mat" style={{ fontSize: 11.5 }}>
                    <thead>
                      <tr>
                        <th>Step / Event</th>
                        <th>Type</th>
                        <th>Ex 1 (Decline)</th>
                        <th>Ex 2 (Confirm)</th>
                        <th>Ex 3 (Partial 3/5)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>0. Inbound Receipt</td>
                        <td className="m">GRPO</td>
                        <td className="num pos">+100 kg</td>
                        <td className="num pos">+100 kg</td>
                        <td className="num pos">+100 kg</td>
                      </tr>
                      <tr>
                        <td>1. Keeper Stage</td>
                        <td className="m">PENDING</td>
                        <td className="num neg">−5 kg</td>
                        <td className="num neg">−5 kg</td>
                        <td className="num neg">−5 kg</td>
                      </tr>
                      <tr>
                        <td>2a. Clear Reservation</td>
                        <td className="m">OFFSET</td>
                        <td>—</td>
                        <td className="num pos">+5 kg</td>
                        <td className="num pos">+5 kg</td>
                      </tr>
                      <tr>
                        <td>2b. Confirmed Issue</td>
                        <td className="m">CONFIRMED</td>
                        <td>—</td>
                        <td className="num neg">−5 kg</td>
                        <td className="num neg">−3 kg</td>
                      </tr>
                      <tr>
                        <td>2c. Door Reversal</td>
                        <td className="m">REVERSAL</td>
                        <td className="num pos">+5 kg</td>
                        <td>—</td>
                        <td>—</td>
                      </tr>
                      <tr style={{ fontWeight: 600, borderTop: '1px solid var(--rule)' }}>
                        <td>Final Book Stock</td>
                        <td>Derived</td>
                        <td className="num">100.000 kg</td>
                        <td className="num">95.000 kg</td>
                        <td className="num">97.000 kg</td>
                      </tr>
                      <tr style={{ fontWeight: 600 }}>
                        <td>Net Shelf Delta</td>
                        <td>Physical</td>
                        <td className="num">0.000 kg</td>
                        <td className="num neg">−5.000 kg</td>
                        <td className="num neg">−3.000 kg</td>
                      </tr>
                      <tr>
                        <td>Requisition Status</td>
                        <td>State</td>
                        <td className="m">PARTIAL_DECLINED</td>
                        <td className="m">CONFIRMED</td>
                        <td className="m">PARTIAL_ACCEPTED</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Ticket>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: APPEND-ONLY MOVEMENT LEDGER */}
      {activeTab === 'ledger' && (
        <div className="stack">
          {/* Explanatory Header Banner */}
          <div className="win" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span className="lbl">Audit Guarantee &middot; Append-Only Principle</span>
              <Badge variant="ok">Strict Invariant</Badge>
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--navy)' }}>
              Physical movements are strictly append-only. Stock is dynamically derived. Historical records are immutable.
            </p>
            <p className="meta" style={{ margin: 0 }}>
              All inventory levels are computed dynamically via mathematical aggregation across <code>t_stock_movements</code>. Database triggers prohibit direct <code>UPDATE</code>, <code>DELETE</code>, or <code>TRUNCATE</code> operations.
            </p>
          </div>

          {/* KPI Summary Tiles */}
          <div className="tiles">
            <div className="tile">
              <span className="lbl">Total Movements</span>
              <span className="big">{ledgerMovements.length}</span>
              <span className="s">Historical immutable rows</span>
            </div>
            <div className="tile">
              <span className="lbl">Inbound Deliveries</span>
              <span className="big">
                {ledgerMovements.filter((m) => m.movement_type === 'GRPO_IMPORT' || m.movement_type === 'TRANSFER_IN_RECEIVED').length}
              </span>
              <span className="s">GRPO &amp; Transfer In</span>
            </div>
            <div className="tile">
              <span className="lbl">Issue Handover Rows</span>
              <span className="big">
                {ledgerMovements.filter((m) => m.movement_type.startsWith('ISSUE_')).length}
              </span>
              <span className="s">Pending, Offset, Confirmed, Reversal</span>
            </div>
            <div className="tile">
              <span className="lbl">Waste &amp; Returns</span>
              <span className="big">
                {ledgerMovements.filter((m) => m.movement_type === 'WASTE_DISPOSAL' || m.movement_type === 'SUPPLIER_RETURN').length}
              </span>
              <span className="s">Authorized physical deductions</span>
            </div>
          </div>

          {/* Filters Bar */}
          <div
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 14, marginBottom: 12 }}>
              <div>
                <label className="lbl" htmlFor="item-search">Search Item Code, Name, or Document</label>
                <input
                  id="item-search"
                  type="text"
                  placeholder="Filter by item code, name, batch number, or reference doc (e.g. Mozzarella, REQ-2026)..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  className="in"
                />
              </div>

              <div>
                <label className="lbl" htmlFor="date-filter">Date Range</label>
                <select
                  id="date-filter"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="in"
                >
                  <option value="ALL">All Recorded Dates</option>
                  <option value="TODAY">Today (03 Nov 2026)</option>
                  <option value="3DAYS">Past 3 Days</option>
                  <option value="7DAYS">Past 7 Days</option>
                </select>
              </div>
            </div>

            {/* Movement Type Filter Chips */}
            <div>
              <span className="lbl" style={{ display: 'block', marginBottom: 6 }}>Filter by Movement Type</span>
              <Chips>
                <Chip
                  label="All Types"
                  count={ledgerMovements.length}
                  active={typeFilter === 'ALL'}
                  onClick={() => setTypeFilter('ALL')}
                />
                <Chip
                  label="Inbound GRPO"
                  count={ledgerMovements.filter((m) => m.movement_type === 'GRPO_IMPORT').length}
                  active={typeFilter === 'GRPO'}
                  onClick={() => setTypeFilter('GRPO')}
                />
                <Chip
                  label="Issue Pending"
                  count={ledgerMovements.filter((m) => m.movement_type === 'ISSUE_PENDING').length}
                  active={typeFilter === 'PENDING'}
                  onClick={() => setTypeFilter('PENDING')}
                />
                <Chip
                  label="Pending Offset"
                  count={ledgerMovements.filter((m) => m.movement_type === 'ISSUE_PENDING_OFFSET').length}
                  active={typeFilter === 'OFFSET'}
                  onClick={() => setTypeFilter('OFFSET')}
                />
                <Chip
                  label="Issue Confirmed"
                  count={ledgerMovements.filter((m) => m.movement_type === 'ISSUE_CONFIRMED').length}
                  active={typeFilter === 'CONFIRMED'}
                  onClick={() => setTypeFilter('CONFIRMED')}
                />
                <Chip
                  label="Door Reversal"
                  count={ledgerMovements.filter((m) => m.movement_type === 'ISSUE_REVERSAL').length}
                  active={typeFilter === 'REVERSAL'}
                  onClick={() => setTypeFilter('REVERSAL')}
                />
                <Chip
                  label="Waste / Returns"
                  count={ledgerMovements.filter((m) => m.movement_type === 'WASTE_DISPOSAL' || m.movement_type === 'SUPPLIER_RETURN').length}
                  active={typeFilter === 'WASTE'}
                  onClick={() => setTypeFilter('WASTE')}
                />
                <Chip
                  label="Transfers"
                  count={ledgerMovements.filter((m) => m.movement_type.startsWith('TRANSFER_')).length}
                  active={typeFilter === 'TRANSFERS'}
                  onClick={() => setTypeFilter('TRANSFERS')}
                />
                <Chip
                  label="Count Adjustment"
                  count={ledgerMovements.filter((m) => m.movement_type === 'COUNT_ADJUSTMENT').length}
                  active={typeFilter === 'COUNT'}
                  onClick={() => setTypeFilter('COUNT')}
                />
              </Chips>
            </div>
          </div>

          {/* Movements Audit Table */}
          <div
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              overflowX: 'auto',
            }}
          >
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="lbl">
                Displaying {filteredMovements.length} of {ledgerMovements.length} Movement Records
              </span>
              <span className="meta">
                Records ordered newest first &middot; Running derived balance computed cumulatively
              </span>
            </div>

            {loading ? (
              <div style={{ padding: 24, textAlign: 'center' }} className="meta">
                Loading ledger records...
              </div>
            ) : filteredMovements.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center' }}>
                <p className="meta" style={{ margin: 0 }}>
                  No movement records found matching the active filter criteria.
                </p>
              </div>
            ) : (
              <table className="dense" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Movement ID</th>
                    <th>Timestamp</th>
                    <th>Movement Type</th>
                    <th>Item Code &amp; Name</th>
                    <th className="num">Quantity</th>
                    <th>UoM</th>
                    <th>Lot / Batch</th>
                    <th>Reference Doc</th>
                    <th>Actor</th>
                    <th className="num">Derived Stock After</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((mvt) => {
                    const badgeCfg = getMovementBadgeConfig(mvt.movement_type);
                    const isPositive = mvt.quantity > 0;
                    const isNegative = mvt.quantity < 0;

                    return (
                      <tr key={mvt.movement_id} className="row">
                        <td className="m" title={mvt.movement_id}>
                          {mvt.movement_id.length > 14
                            ? `${mvt.movement_id.slice(0, 10)}...`
                            : mvt.movement_id}
                        </td>
                        <td className="m">{formatDate(mvt.created_at)}</td>
                        <td>
                          <Badge variant={badgeCfg.variant}>{badgeCfg.label}</Badge>
                        </td>
                        <td>
                          <div>
                            <b>{mvt.item_code}</b>
                          </div>
                          <span className="meta">{mvt.item_name}</span>
                        </td>
                        <td
                          className={`num ${isPositive ? 'pos' : isNegative ? 'neg' : ''}`}
                        >
                          <b>
                            {isPositive
                              ? `+${mvt.quantity.toFixed(3)}`
                              : mvt.quantity.toFixed(3)}
                          </b>
                        </td>
                        <td className="m">{mvt.uom}</td>
                        <td className="m">
                          {mvt.batch_number ? (
                            <div>
                              <span>{mvt.batch_number}</span>
                              {mvt.expiry_date && (
                                <span className="meta" style={{ display: 'block', fontSize: 11 }}>
                                  Exp: {mvt.expiry_date}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="meta">—</span>
                          )}
                        </td>
                        <td className="m">
                          <b>{mvt.reference_doc_id}</b>
                        </td>
                        <td className="m">{mvt.actor_name}</td>
                        <td className="num">
                          {mvt.derived_stock_after != null ? (
                            <span>
                              <b>{mvt.derived_stock_after.toFixed(3)}</b>{' '}
                              <span className="meta">{mvt.uom}</span>
                            </span>
                          ) : (
                            <span className="meta">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
