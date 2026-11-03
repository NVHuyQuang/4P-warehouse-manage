'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge, BadgeVariant } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  getApprovalInbox,
  approveInboxItem,
  ApprovalInboxItem,
  ApprovalCategoryKey,
  ApprovalDecision,
} from '@/lib/data/approvals';

type ViewMode = 'cards' | 'table';

interface SodCheckResult {
  canApprove: boolean;
  canReject: boolean;
  reason?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  STOCK_COUNT: 'Count adjustment',
  WASTE_CLAIM: 'Waste / return',
  TRANSFER_VARIANCE: 'Transfer variance',
  STORE_WAREHOUSE_PROPOSAL: 'New store / warehouse',
  USER_INVITATION: 'Approver account',
  SAP_IMPORT_CORRECTION: 'SAP correction',
};

function formatSignedQty(qty?: number | null, uom?: string | null): string {
  if (qty == null) return '—';
  const unit = uom ? ` ${uom}` : '';
  const decimals = uom === 'kg' ? 1 : 0;
  if (qty === 0) return `0${unit}`;
  const sign = qty > 0 ? '+' : '';
  return `${sign}${qty.toFixed(decimals)}${unit}`;
}

export default function ApprovalsPage() {
  const { role, roleConfig, store, showToast } = useShell();

  const [inboxItems, setInboxItems] = useState<ApprovalInboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ApprovalCategoryKey>('open');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load approvals inbox on role / store change
  const loadInbox = useCallback(async () => {
    setIsLoading(true);
    try {
      const targetRole = role === 'rm' ? 'RM' : 'FC';
      const items = await getApprovalInbox(store, targetRole);
      setInboxItems(items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Error loading inbox: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [role, store, showToast]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  // Determine items visible to current role
  const roleVisibleItems = useMemo(() => {
    if (role === 'rm') {
      // RM sees only waste claims for their store
      return inboxItems.filter((it) => it.item_type === 'WASTE_CLAIM');
    }
    // FC and others see all items
    return inboxItems;
  }, [inboxItems, role]);

  // Filter items based on active category chip
  const filteredItems = useMemo(() => {
    return roleVisibleItems.filter((item) => {
      if (activeCategory === 'open') {
        return item.decision_status === 'PENDING';
      }
      if (activeCategory === 'all') {
        return true;
      }
      if (activeCategory === 'waste') {
        return item.item_type === 'WASTE_CLAIM';
      }
      if (activeCategory === 'transfers') {
        return item.item_type === 'TRANSFER_VARIANCE';
      }
      if (activeCategory === 'counts') {
        return item.item_type === 'STOCK_COUNT';
      }
      if (activeCategory === 'sap') {
        return item.item_type === 'SAP_IMPORT_CORRECTION';
      }
      if (activeCategory === 'proposals') {
        return item.item_type === 'STORE_WAREHOUSE_PROPOSAL';
      }
      if (activeCategory === 'users') {
        return item.item_type === 'USER_INVITATION';
      }
      return true;
    });
  }, [roleVisibleItems, activeCategory]);

  // Maintain active item selection
  const selectedItem = useMemo(() => {
    if (selectedId) {
      const found = roleVisibleItems.find(
        (it) => it.item_id === selectedId || it.reference_id === selectedId
      );
      if (found) return found;
    }
    return filteredItems[0] || roleVisibleItems[0] || null;
  }, [selectedId, roleVisibleItems, filteredItems]);

  // Auto-sync selection if none selected
  useEffect(() => {
    if (!selectedId && filteredItems.length > 0) {
      setSelectedId(filteredItems[0].item_id);
    }
  }, [selectedId, filteredItems]);

  // Segregation of Duties & role authority check
  const checkSod = useCallback(
    (item: ApprovalInboxItem): SodCheckResult => {
      if (item.decision_status !== 'PENDING') {
        return {
          canApprove: false,
          canReject: false,
          reason: `Item has already been ${item.decision_status.toLowerCase()} by ${item.decided_by_role || 'approver'}.`,
        };
      }

      // Restaurant Manager rules:
      if (role === 'rm') {
        if (item.item_type !== 'WASTE_CLAIM') {
          return {
            canApprove: false,
            canReject: false,
            reason: 'Outside Restaurant Manager scope. Financial Controller approves.',
          };
        }
        if (item.logged_by_role === 'Restaurant Manager') {
          return {
            canApprove: false,
            canReject: true,
            reason: 'Segregation of duties: Restaurant Manager cannot approve own claims.',
          };
        }
        if (item.size_category === 'major' || (item.quantity && Math.abs(item.quantity) > 5.0)) {
          return {
            canApprove: false,
            canReject: true,
            reason: 'Above sample minor threshold (5.0 kg). Financial Controller approves.',
          };
        }
        return { canApprove: true, canReject: true };
      }

      // Financial Controller rules:
      if (role === 'fc') {
        if (item.logged_by_role === 'Financial Controller') {
          return {
            canApprove: false,
            canReject: true,
            reason: 'Segregation of duties: logged by your role, you cannot approve it.',
          };
        }
        return { canApprove: true, canReject: true };
      }

      // System Admin rules:
      if (role === 'admin') {
        return { canApprove: true, canReject: true };
      }

      // Other frontline roles:
      return {
        canApprove: false,
        canReject: false,
        reason: 'Your role cannot approve inbox items. Financial Controller or Restaurant Manager required.',
      };
    },
    [role]
  );

  // Execution seam for approve and reject actions via dispatchAction
  const handleDecision = async (decision: ApprovalDecision, targetItem?: ApprovalInboxItem) => {
    const itemToProcess = targetItem || selectedItem;
    if (!itemToProcess) return;

    const sod = checkSod(itemToProcess);
    if (decision === 'APPROVED' && !sod.canApprove) {
      showToast(sod.reason || 'Approval blocked by segregation of duties.');
      return;
    }
    if (decision === 'REJECTED' && !sod.canReject) {
      showToast(sod.reason || 'Rejection blocked by permissions.');
      return;
    }

    const actionName = decision === 'APPROVED' ? 'APPROVE_INBOX_ITEM' : 'REJECT_INBOX_ITEM';

    setIsSubmitting(true);
    await dispatchAction({
      actionName,
      storeId: itemToProcess.store_id || store,
      payload: {
        itemType: itemToProcess.item_type,
        itemId: itemToProcess.item_id,
        decision,
        comment,
      },
      execute: async () => {
        await approveInboxItem(
          itemToProcess.item_type,
          itemToProcess.item_id,
          decision,
          comment || undefined
        );
      },
      onSuccess: () => {
        const pastTense = decision === 'APPROVED' ? 'approved' : 'rejected';
        const impact =
          decision === 'APPROVED'
            ? itemToProcess.quantity
              ? 'ledger row appended'
              : 'recorded'
            : 'No stock change.';
        showToast(`${itemToProcess.reference_id} ${pastTense}. ${impact}`);
        setComment('');
        loadInbox();
      },
      onError: (err) => {
        showToast(`Action failed: ${err.message}`);
      },
    });
    setIsSubmitting(false);
  };

  // Helper for item badge styling
  const getItemBadgeVariant = (type: string): BadgeVariant => {
    switch (type) {
      case 'STOCK_COUNT':
        return 'ok';
      case 'WASTE_CLAIM':
        return 'am';
      case 'TRANSFER_VARIANCE':
        return 'ur';
      case 'STORE_WAREHOUSE_PROPOSAL':
        return 're';
      case 'USER_INVITATION':
        return 'mu';
      case 'SAP_IMPORT_CORRECTION':
        return 'am';
      default:
        return 'mu';
    }
  };

  const getStatusBadge = (item: ApprovalInboxItem) => {
    if (item.decision_status === 'APPROVED') {
      return <Badge variant="ok">Approved</Badge>;
    }
    if (item.decision_status === 'REJECTED') {
      return <Badge variant="er">Rejected</Badge>;
    }
    return <Badge variant="mu">Open</Badge>;
  };

  // Calculate chip counts
  const openCount = useMemo(
    () => roleVisibleItems.filter((i) => i.decision_status === 'PENDING').length,
    [roleVisibleItems]
  );
  const wasteCount = useMemo(
    () => roleVisibleItems.filter((i) => i.item_type === 'WASTE_CLAIM').length,
    [roleVisibleItems]
  );
  const trfCount = useMemo(
    () => roleVisibleItems.filter((i) => i.item_type === 'TRANSFER_VARIANCE').length,
    [roleVisibleItems]
  );
  const cntCount = useMemo(
    () => roleVisibleItems.filter((i) => i.item_type === 'STOCK_COUNT').length,
    [roleVisibleItems]
  );
  const sapCount = useMemo(
    () => roleVisibleItems.filter((i) => i.item_type === 'SAP_IMPORT_CORRECTION').length,
    [roleVisibleItems]
  );
  const propCount = useMemo(
    () => roleVisibleItems.filter((i) => i.item_type === 'STORE_WAREHOUSE_PROPOSAL').length,
    [roleVisibleItems]
  );
  const userCount = useMemo(
    () => roleVisibleItems.filter((i) => i.item_type === 'USER_INVITATION').length,
    [roleVisibleItems]
  );

  const selectedSod = selectedItem ? checkSod(selectedItem) : null;

  // Derived stock calculation for the ledger preview
  const ledgerPreview = useMemo(() => {
    if (!selectedItem || selectedItem.quantity == null || selectedItem.current_stock == null) {
      return null;
    }
    const movementLabel =
      selectedItem.item_type === 'STOCK_COUNT'
        ? 'COUNT_ADJUSTMENT'
        : selectedItem.item_type === 'TRANSFER_VARIANCE'
          ? 'TRANSFER_VARIANCE'
          : selectedItem.item_type === 'SAP_IMPORT_CORRECTION'
            ? 'GRPO_IMPORT'
            : 'WASTE_DISPOSAL';

    const beforeStock = selectedItem.current_stock;
    const change = selectedItem.quantity;
    const afterStock = Math.round((beforeStock + change) * 100) / 100;
    const unit = selectedItem.uom || 'kg';

    return {
      movementLabel,
      beforeStock: `${beforeStock.toFixed(unit === 'kg' ? 1 : 0)} ${unit}`,
      afterStock: `${afterStock.toFixed(unit === 'kg' ? 1 : 0)} ${unit}`,
    };
  }, [selectedItem]);

  return (
    <>
      {/* Header section matching prototype specification */}
      <div className="head">
        <div>
          <span className="kicker">Approvals inbox &middot; {roleConfig.l}</span>
          <h1 className="h1">
            Waiting <em>for you.</em>
          </h1>
          <p className="meta" style={{ margin: '6px 0 0' }}>
            Count adjustments, waste and return claims, transfer variances, new stores and approver
            accounts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Inbox view mode">
            <button
              type="button"
              className={viewMode === 'cards' ? 'on' : ''}
              onClick={() => setViewMode('cards')}
            >
              Cards
            </button>
            <button
              type="button"
              className={viewMode === 'table' ? 'on' : ''}
              onClick={() => setViewMode('table')}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Role permission notification banner for non-approvers */}
      {role !== 'fc' && role !== 'rm' && role !== 'admin' && (
        <div className="note am" style={{ marginBottom: '18px' }}>
          <b>View-only mode.</b> Approvals inbox actions are restricted to Restaurant Manager (RM)
          and Financial Controller (FC). Switch role via the View as bar above to test operational
          authorization.
        </div>
      )}

      {/* Category filter chips */}
      <Chips style={{ marginBottom: '18px' }}>
        <Chip
          label="Open"
          count={openCount}
          active={activeCategory === 'open'}
          onClick={() => setActiveCategory('open')}
        />
        <Chip
          label="All"
          count={roleVisibleItems.length}
          active={activeCategory === 'all'}
          onClick={() => setActiveCategory('all')}
        />
        {role === 'rm' ? (
          <Chip
            label="Waste Claims"
            count={wasteCount}
            active={activeCategory === 'waste'}
            onClick={() => setActiveCategory('waste')}
          />
        ) : (
          <>
            <Chip
              label="Stock Counts"
              count={cntCount}
              active={activeCategory === 'counts'}
              onClick={() => setActiveCategory('counts')}
            />
            <Chip
              label="Waste Claims"
              count={wasteCount}
              active={activeCategory === 'waste'}
              onClick={() => setActiveCategory('waste')}
            />
            <Chip
              label="Transfers"
              count={trfCount}
              active={activeCategory === 'transfers'}
              onClick={() => setActiveCategory('transfers')}
            />
            <Chip
              label="SAP Corrections"
              count={sapCount}
              active={activeCategory === 'sap'}
              onClick={() => setActiveCategory('sap')}
            />
            <Chip
              label="Store Proposals"
              count={propCount}
              active={activeCategory === 'proposals'}
              onClick={() => setActiveCategory('proposals')}
            />
            <Chip
              label="User Invites"
              count={userCount}
              active={activeCategory === 'users'}
              onClick={() => setActiveCategory('users')}
            />
          </>
        )}
      </Chips>

      {/* Main layout: 3-column Card Inspector vs Full-width Table View */}
      {viewMode === 'cards' ? (
        <div className="cols c-ap">
          {/* Left Column: Vertical Inbox Card Stack */}
          <aside>
            <div className="list">
              {filteredItems.length === 0 ? (
                <div className="note" style={{ background: 'var(--paper)' }}>
                  Inbox is empty for this filter.
                </div>
              ) : (
                filteredItems.map((item) => {
                  const sod = checkSod(item);
                  const isSelected = selectedItem?.item_id === item.item_id;

                  return (
                    <button
                      key={item.item_id}
                      type="button"
                      className={`item ${isSelected ? 'sel' : ''}`}
                      onClick={() => setSelectedId(item.item_id)}
                    >
                      <div className="top">
                        <span className="id">{item.reference_id}</span>
                        {getStatusBadge(item)}
                        <span className="gloss" style={{ marginLeft: 'auto' }}>
                          {CATEGORY_LABELS[item.item_type] || item.item_type}
                        </span>
                      </div>
                      <div style={{ marginTop: '4px' }}>
                        <b>{item.title}</b>
                        {item.item_name && item.quantity != null ? (
                          <>
                            {' · '}
                            {item.item_name} {formatSignedQty(item.quantity, item.uom)}
                          </>
                        ) : null}
                      </div>
                      <div className="meta" style={{ marginTop: '4px' }}>
                        logged by {item.logged_by_role}
                        {item.decision_status === 'PENDING' && !sod.canApprove ? (
                          <>
                            {' · '}
                            <span style={{ color: 'var(--err)', fontWeight: 600 }}>
                              not approvable by you
                            </span>
                          </>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Center Column: Detailed Ticket Inspector View */}
          <div>
            {selectedItem ? (
              <Ticket
                no={`${selectedItem.reference_id} · ${(
                  CATEGORY_LABELS[selectedItem.item_type] || selectedItem.item_type
                ).toUpperCase()}`}
                right={
                  selectedItem.decision_status === 'PENDING'
                    ? 'AWAITING DECISION'
                    : selectedItem.decision_status
                }
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: '26px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '.02em',
                    }}
                  >
                    {selectedItem.title}
                  </span>
                  <Badge variant={selectedItem.size_category === 'minor' ? 'mu' : 'ur'}>
                    {selectedItem.size_category === 'minor' ? 'Minor (sample)' : 'Major'}
                  </Badge>
                </div>

                {/* Metadata table matching ticket design */}
                <table className="tick" style={{ marginTop: '14px' }}>
                  <tbody>
                    <tr>
                      <td>Item</td>
                      <td>
                        {selectedItem.item_name
                          ? `${selectedItem.item_name} · ${selectedItem.item_code}`
                          : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Quantity</td>
                      <td
                        className={
                          selectedItem.quantity && selectedItem.quantity < 0 ? 'neg' : ''
                        }
                      >
                        {formatSignedQty(selectedItem.quantity, selectedItem.uom)}
                      </td>
                    </tr>
                    <tr>
                      <td>Reference</td>
                      <td>{selectedItem.reference_id}</td>
                    </tr>
                    <tr>
                      <td>Storeroom</td>
                      <td>{selectedItem.storeroom || '—'}</td>
                    </tr>
                    <tr>
                      <td>Logged by</td>
                      <td>{selectedItem.logged_by_role}</td>
                    </tr>
                    <tr>
                      <td>Store</td>
                      <td>{selectedItem.store_id || store}</td>
                    </tr>
                    <tr>
                      <td>Submitted</td>
                      <td>{new Date(selectedItem.requested_at).toLocaleDateString()}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Description and notes */}
                <p style={{ margin: '14px 0 0', lineHeight: 1.6 }}>{selectedItem.notes}</p>

                {/* Quick link to originating module if applicable */}
                {selectedItem.target_module && (
                  <p style={{ margin: '12px 0 0' }}>
                    <Link
                      href={`/${selectedItem.target_module}`}
                      className="btn ghost sm"
                      style={{ display: 'inline-block' }}
                    >
                      Open in{' '}
                      {selectedItem.target_module === 'count'
                        ? 'Count'
                        : selectedItem.target_module === 'transfers'
                          ? 'Transfers'
                          : 'Overview'}
                    </Link>
                  </p>
                )}

                <div
                  style={{
                    borderTop: '1px dashed var(--rule)',
                    margin: '18px 0',
                  }}
                />

                {/* Decision Panel & Segregation of Duties Banner */}
                {selectedItem.decision_status === 'APPROVED' ? (
                  <div className="note ok">
                    <b>Approved by {selectedItem.decided_by_role || roleConfig.l}.</b>{' '}
                    {selectedItem.quantity ? 'Ledger row appended.' : 'Recorded.'}
                  </div>
                ) : selectedItem.decision_status === 'REJECTED' ? (
                  <div className="note er">
                    <b>Rejected by {selectedItem.decided_by_role || roleConfig.l}.</b> No ledger
                    row. Rejection reason is stored with the decision.
                  </div>
                ) : selectedSod && !selectedSod.canApprove ? (
                  <div>
                    {/* Segregation of Duties Notice Banner */}
                    <div className="note er">
                      <b>Cannot approve.</b> {selectedSod.reason}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'center',
                        marginTop: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button type="button" className="btn" disabled>
                        Approve
                      </button>
                      {selectedSod.canReject ? (
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={isSubmitting}
                          onClick={() => handleDecision('REJECTED')}
                        >
                          Reject
                        </button>
                      ) : (
                        <button type="button" className="btn ghost" disabled>
                          Reject
                        </button>
                      )}
                      <span className="meta">Action restricted by segregation of duties.</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="fld">
                      <label
                        className="lbl"
                        htmlFor="approval-comment"
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: '12px',
                          letterSpacing: '.06em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Operational comment (optional)
                      </label>
                      <input
                        id="approval-comment"
                        className="in"
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Reason, investigation notes, or reference sign-off"
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'center',
                        marginTop: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        className="btn"
                        disabled={isSubmitting}
                        onClick={() => handleDecision('APPROVED')}
                      >
                        {isSubmitting ? 'Recording...' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={isSubmitting}
                        onClick={() => handleDecision('REJECTED')}
                      >
                        {isSubmitting ? 'Recording...' : 'Reject'}
                      </button>
                      <span className="meta">Decision is recorded with your role and time.</span>
                    </div>
                  </div>
                )}
              </Ticket>
            ) : (
              <div className="note">No item selected.</div>
            )}
          </div>

          {/* Right Column: Ledger Preview & Policy Cards */}
          <aside className="stack">
            {/* Top Card: Append-Only Ledger Impact Preview */}
            <div className="stub w">
              <span className="lbl">
                {selectedItem?.decision_status === 'APPROVED'
                  ? 'Ledger row appended'
                  : 'Ledger row if approved'}
              </span>
              {ledgerPreview ? (
                <div>
                  <div className="ledrow">
                    <span className="t">{ledgerPreview.movementLabel}</span>
                    <span>
                      {selectedItem?.item_name} &middot; {selectedItem?.reference_id}
                    </span>
                    <span
                      className={
                        selectedItem?.quantity && selectedItem.quantity < 0 ? 'neg' : 'pos'
                      }
                    >
                      {formatSignedQty(selectedItem?.quantity, selectedItem?.uom)}
                    </span>
                  </div>
                  <div className="meta" style={{ marginTop: '6px' }}>
                    derived stock {ledgerPreview.beforeStock} &rarr;{' '}
                    <b>{ledgerPreview.afterStock}</b>
                  </div>
                  <p className="gloss" style={{ margin: '8px 0 0' }}>
                    Append-only. Nothing is edited in place.
                  </p>
                </div>
              ) : (
                <p className="gloss" style={{ margin: '0' }}>
                  {selectedItem?.item_type === 'STORE_WAREHOUSE_PROPOSAL'
                    ? 'No stock row. Creates the store and warehouse master records (status ACTIVE) with this approval id.'
                    : 'No stock row. Activates the account and issues the activation link.'}
                </p>
              )}
            </div>

            {/* Bottom Card: Segregation of Duties Policy */}
            <div className="stub">
              <span className="lbl">Segregation of duties</span>
              <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>
                Whoever logs a claim, count voucher or variance cannot approve it. Count staff
                never approve book adjustments. Dispatch keepers never approve transit variances.
              </p>
            </div>

            {/* Role scope guidance */}
            {role === 'rm' && (
              <div className="note">
                Restaurant Manager sees only waste claims, and approves minor ones below the
                threshold (5.0 kg).
              </div>
            )}
          </aside>
        </div>
      ) : (
        /* Full-width Table View for batch or tabular inspection */
        <div className="stub w" style={{ padding: '18px 24px' }}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Reference</th>
                <th>Store / Room</th>
                <th>Summary Description</th>
                <th style={{ textAlign: 'right' }}>Quantity</th>
                <th>Submitter</th>
                <th>Submitted</th>
                <th>State</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '24px' }}>
                    No approval items found for this filter.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const sod = checkSod(item);

                  return (
                    <tr
                      key={item.item_id}
                      className="row"
                      onClick={() => {
                        setSelectedId(item.item_id);
                        setViewMode('cards');
                      }}
                    >
                      <td>
                        <Badge variant={getItemBadgeVariant(item.item_type)}>
                          {CATEGORY_LABELS[item.item_type] || item.item_type}
                        </Badge>
                      </td>
                      <td className="m" style={{ color: 'var(--navy)', fontWeight: 600 }}>
                        {item.reference_id}
                      </td>
                      <td className="m">
                        {item.store_id || 'Global'}
                        {item.storeroom ? ` · ${item.storeroom}` : ''}
                      </td>
                      <td>
                        <b>{item.title}</b>
                        {item.item_name ? ` · ${item.item_name}` : ''}
                        <div className="meta">{item.notes}</div>
                      </td>
                      <td
                        className={`num ${
                          item.quantity && item.quantity < 0 ? 'neg' : ''
                        }`}
                      >
                        {formatSignedQty(item.quantity, item.uom)}
                      </td>
                      <td className="m">{item.logged_by_role}</td>
                      <td className="m">
                        {new Date(item.requested_at).toLocaleDateString()}
                      </td>
                      <td>{getStatusBadge(item)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {item.decision_status === 'PENDING' ? (
                          <div
                            style={{
                              display: 'inline-flex',
                              gap: '6px',
                              justifyContent: 'flex-end',
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn sm"
                              disabled={!sod.canApprove || isSubmitting}
                              onClick={() => handleDecision('APPROVED', item)}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={!sod.canReject || isSubmitting}
                              onClick={() => handleDecision('REJECTED', item)}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="meta">{item.decision_status}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
