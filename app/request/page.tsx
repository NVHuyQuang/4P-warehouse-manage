'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  createRequest,
  getMyRequests,
  cancelRequest,
  updateRequest,
  RequisitionRecord,
} from '@/lib/data/requests';

interface CatalogItem {
  code: string;
  name: string;
  uom: 'kg' | 'pcs';
  warehouse: 'COLD' | 'DRY';
  category: string;
}

// 20 Master Catalog Items (Quantities & physical inventory attributes only)
const CATALOG_ITEMS: CatalogItem[] = [
  { code: 'RM-MOZ-01', name: 'Mozzarella block', uom: 'kg', warehouse: 'COLD', category: 'Dairy' },
  { code: 'RM-BAS-01', name: 'Fresh basil', uom: 'kg', warehouse: 'COLD', category: 'Produce' },
  { code: 'RM-BUR-01', name: 'Burrata', uom: 'pcs', warehouse: 'COLD', category: 'Dairy' },
  { code: 'RM-CHK-01', name: 'Chicken breast', uom: 'kg', warehouse: 'COLD', category: 'Meat' },
  { code: 'RM-DOU-01', name: 'Pizza dough ball', uom: 'pcs', warehouse: 'COLD', category: 'Bakery' },
  { code: 'RM-SAL-01', name: 'Salmon fillet', uom: 'kg', warehouse: 'COLD', category: 'Seafood' },
  { code: 'ITM-CHZ-003', name: 'Buffalo Mozzarella 200g', uom: 'pcs', warehouse: 'COLD', category: 'Dairy' },
  { code: 'RM-RIC-01', name: 'House Ricotta', uom: 'kg', warehouse: 'COLD', category: 'Dairy' },
  { code: 'RM-GOR-01', name: 'Gorgonzola Dolce', uom: 'kg', warehouse: 'COLD', category: 'Dairy' },
  { code: 'RM-PAR-01', name: 'Parma ham', uom: 'kg', warehouse: 'COLD', category: 'Meat' },
  { code: 'ITM-MET-002', name: 'Spicy Salami Spianata', uom: 'kg', warehouse: 'COLD', category: 'Meat' },
  { code: 'ITM-MET-003', name: 'Guanciale Affumicato', uom: 'kg', warehouse: 'COLD', category: 'Meat' },
  { code: 'ITM-MET-004', name: 'Cooked Ham Cotto', uom: 'kg', warehouse: 'COLD', category: 'Meat' },
  { code: 'ITM-VEG-002', name: 'Organic Cherry Tomatoes', uom: 'kg', warehouse: 'COLD', category: 'Produce' },
  { code: 'ITM-VEG-003', name: 'Wild Rocket Arugula', uom: 'kg', warehouse: 'COLD', category: 'Produce' },
  { code: 'ITM-VEG-004', name: 'Fresh Button Mushrooms', uom: 'kg', warehouse: 'COLD', category: 'Produce' },
  { code: 'DS-FLO-00', name: 'Flour 00 (Caputo)', uom: 'kg', warehouse: 'DRY', category: 'Dry Store' },
  { code: 'DS-PAS-01', name: 'Tomato passata 2.5kg tin', uom: 'pcs', warehouse: 'DRY', category: 'Dry Store' },
  { code: 'ITM-DRY-003', name: 'Extra Virgin Olive Oil', uom: 'kg', warehouse: 'DRY', category: 'Dry Store' },
  { code: 'ITM-DRY-004', name: 'Fresh Active Yeast', uom: 'kg', warehouse: 'DRY', category: 'Dry Store' },
];

interface DraftLine {
  itemCode: string;
  requestedQty: number;
}

export default function SectionRequestPage() {
  const { store, showToast, roleConfig } = useShell();

  // Section scope state (Kitchen / Bar / Cheese)
  const initialSection = useMemo(() => {
    if (roleConfig?.scope?.includes('Bar')) return 'BAR';
    if (roleConfig?.scope?.includes('Cheese')) return 'CHEESE';
    return 'KITCHEN';
  }, [roleConfig]);

  const [section, setSection] = useState<'KITCHEN' | 'BAR' | 'CHEESE'>(initialSection);
  const [windowMode, setWindowMode] = useState<'in' | 'out'>('in');
  const [neededBy, setNeededBy] = useState<string>('11:30');
  const [urgentReason, setUrgentReason] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lines, setLines] = useState<DraftLine[]>([
    { itemCode: 'RM-MOZ-01', requestedQty: 5.0 },
    { itemCode: 'RM-BUR-01', requestedQty: 6 },
    { itemCode: 'RM-SAL-01', requestedQty: 4.0 },
  ]);

  // Request list and status filtering
  const [requests, setRequests] = useState<RequisitionRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'QUEUED' | 'ACTIVE' | 'DONE'>('ALL');
  const [isLoadingRequests, setIsLoadingRequests] = useState<boolean>(true);

  // Edit mode tracking (Flow C-1)
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState<boolean>(false);

  // Load existing requests for active store
  const refreshRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const data = await getMyRequests(store);
      setRequests(data);
    } catch {
      // Handled via fallback
    } finally {
      setIsLoadingRequests(false);
    }
  }, [store]);

  useEffect(() => {
    refreshRequests();
  }, [refreshRequests]);

  // Item catalog resolution helper
  const getItem = useCallback((code: string): CatalogItem => {
    const found = CATALOG_ITEMS.find((it) => it.code === code);
    if (found) return found;
    return {
      code,
      name: code,
      uom: 'kg',
      warehouse: 'COLD',
      category: 'General',
    };
  }, []);

  // Filtered matching items for catalog search
  const matchingItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return CATALOG_ITEMS.filter(
      (it) =>
        !lines.some((l) => l.itemCode === it.code) &&
        (it.name.toLowerCase().includes(q) ||
          it.code.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q))
    ).slice(0, 6);
  }, [searchQuery, lines]);

  // Add item from catalog to draft lines
  const handleAddItem = (item: CatalogItem) => {
    const defaultQty = item.uom === 'kg' ? 1.0 : 1;
    setLines((prev) => [...prev, { itemCode: item.code, requestedQty: defaultQty }]);
    setSearchQuery('');
  };

  // Remove line from draft
  const handleRemoveLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Step quantity with +/- buttons
  const handleStepQty = (index: number, delta: number) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const it = getItem(line.itemCode);
        const nextQty =
          it.uom === 'kg'
            ? Math.max(0.1, Math.round((line.requestedQty + delta) * 10) / 10)
            : Math.max(1, Math.round(line.requestedQty + delta));
        return { ...line, requestedQty: nextQty };
      })
    );
  };

  // Direct manual quantity input
  const handleDirectQtyChange = (index: number, rawVal: string) => {
    const parsed = parseFloat(rawVal);
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        return { ...line, requestedQty: isNaN(parsed) ? 0 : parsed };
      })
    );
  };

  // Validation rules: at least one line, all qty > 0, reason if outside window
  const isReasonValid = windowMode === 'in' || urgentReason.trim().length > 2;
  const areLinesValid = lines.length > 0 && lines.every((l) => l.requestedQty > 0);
  const canSubmit = areLinesValid && isReasonValid;

  // Submit new request or save edit
  const handleSubmit = async () => {
    setAttemptedSubmit(true);

    if (!canSubmit) {
      if (windowMode === 'out' && !urgentReason.trim()) {
        showToast('A reason is required for urgent requests outside the window.');
      } else if (lines.length === 0) {
        showToast('Please add at least one item to the request.');
      } else {
        showToast('Please ensure all item quantities are greater than zero.');
      }
      return;
    }

    setIsSubmitting(true);

    const payloadItems = lines.map((l) => ({
      itemCode: l.itemCode,
      requestedQty: l.requestedQty,
      uom: getItem(l.itemCode).uom,
    }));

    if (editingRequestId) {
      // Update existing QUEUED request (Flow C-1 step C8/C9)
      const targetReqId = editingRequestId;
      const res = await dispatchAction({
        actionName: 'update_section_request',
        storeId: store,
        payload: { requestId: targetReqId, items: payloadItems },
        execute: async () => {
          await updateRequest(targetReqId, payloadItems);
        },
        onSuccess: () => {
          showToast(`${targetReqId} updated successfully`);
          setEditingRequestId(null);
          setLines([]);
          setUrgentReason('');
          setAttemptedSubmit(false);
          refreshRequests();
        },
        onError: (err) => {
          showToast(`Update failed: ${err.message}`);
        },
      });

      if (!res.success && res.error) {
        showToast(`Error: ${res.error}`);
      }
    } else {
      // Create new section request (Flow C-1 step C1-C7)
      const isOutside = windowMode === 'out';
      const reasonText = isOutside ? urgentReason.trim() : undefined;

      const res = await dispatchAction({
        actionName: 'create_section_request',
        storeId: store,
        payload: {
          storeId: store,
          sectionId: section,
          items: payloadItems,
          urgentReason: reasonText,
        },
        execute: async () => {
          return await createRequest(store, section, payloadItems, reasonText);
        },
        onSuccess: (newReqId) => {
          showToast(
            isOutside
              ? `${newReqId} submitted as URGENT, now in the pick queue`
              : `${newReqId} submitted, now in the pick queue`
          );
          setLines([]);
          setUrgentReason('');
          setAttemptedSubmit(false);
          refreshRequests();
        },
        onError: (err) => {
          showToast(`Submission failed: ${err.message}`);
        },
      });

      if (!res.success && res.error) {
        showToast(`Error: ${res.error}`);
      }
    }

    setIsSubmitting(false);
  };

  // Start editing a QUEUED request
  const handleStartEdit = (req: RequisitionRecord) => {
    if (req.status !== 'QUEUED') {
      showToast('Modifications locked: warehouse picking has commenced.');
      return;
    }

    setEditingRequestId(req.request_id);
    setSection(req.section_id as 'KITCHEN' | 'BAR' | 'CHEESE');
    setWindowMode(req.is_urgent ? 'out' : 'in');
    setUrgentReason(req.urgent_reason || '');
    if (req.needed_by) setNeededBy(req.needed_by);

    if (req.items && req.items.length > 0) {
      setLines(
        req.items.map((it: { item_code?: string; itemCode?: string; requested_qty?: number; requestedQty?: number }) => ({
          itemCode: it.item_code || it.itemCode || '',
          requestedQty: Number(it.requested_qty ?? it.requestedQty) || 1,
        }))
      );
    }
    showToast(`Loaded ${req.request_id} for editing`);
  };

  // Cancel edit mode
  const handleCancelEdit = () => {
    setEditingRequestId(null);
    setLines([
      { itemCode: 'RM-MOZ-01', requestedQty: 5.0 },
      { itemCode: 'RM-BUR-01', requestedQty: 6 },
      { itemCode: 'RM-SAL-01', requestedQty: 4.0 },
    ]);
    setUrgentReason('');
    setAttemptedSubmit(false);
    showToast('Editing cancelled');
  };

  // Cancel a requisition prior to picking (Flow C-1 step C10)
  const handleCancelRequest = async (requestId: string) => {
    const res = await dispatchAction({
      actionName: 'cancel_section_request',
      storeId: store,
      payload: { requestId },
      execute: async () => {
        await cancelRequest(requestId);
      },
      onSuccess: () => {
        showToast(`${requestId} cancelled`);
        if (editingRequestId === requestId) {
          handleCancelEdit();
        }
        refreshRequests();
      },
      onError: (err) => {
        showToast(`Cancellation failed: ${err.message}`);
      },
    });

    if (!res.success && res.error) {
      showToast(`Error: ${res.error}`);
    }
  };

  // Filter requests for aside list
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      // Must match active section
      if (r.section_id !== section) return false;

      if (statusFilter === 'QUEUED') return r.status === 'QUEUED';
      if (statusFilter === 'ACTIVE') {
        return r.status === 'PICKING' || r.status === 'AWAITING_RUNNER';
      }
      if (statusFilter === 'DONE') {
        return (
          r.status === 'CONFIRMED' ||
          r.status === 'CANCELLED_BY_REQUESTER' ||
          r.status === 'PARTIAL_ACCEPTED' ||
          r.status === 'PARTIAL_DECLINED'
        );
      }
      return true;
    });
  }, [requests, section, statusFilter]);

  // Status badge display
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'QUEUED':
        return <Badge variant="mu">Queued</Badge>;
      case 'PICKING':
        return <Badge variant="am">Picking · locked</Badge>;
      case 'AWAITING_RUNNER':
        return <Badge variant="re">Awaiting runner · locked</Badge>;
      case 'CONFIRMED':
        return <Badge variant="ok">Confirmed</Badge>;
      case 'CANCELLED_BY_REQUESTER':
        return <Badge variant="mu">Cancelled</Badge>;
      case 'PARTIAL_ACCEPTED':
        return <Badge variant="am">Partial accepted</Badge>;
      case 'PARTIAL_DECLINED':
        return <Badge variant="er">Partial declined</Badge>;
      default:
        return <Badge variant="mu">{status}</Badge>;
    }
  };

  const sampleClock = windowMode === 'in' ? '10:15' : '12:40';

  return (
    <main>
      {/* Page Header */}
      <div className="head">
        <div>
          <div className="kicker">
            Section Requester · {section} · {store}
          </div>
          <h1 className="h1">
            New <em>request.</em>
          </h1>
          <p className="sub">
            Quantities only. Physical stock demand. You may change or cancel until the keeper starts
            picking.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {editingRequestId && (
            <button
              type="button"
              className="btn ghost"
              onClick={handleCancelEdit}
              disabled={isSubmitting}
            >
              Cancel edit
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={!canSubmit || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting
              ? 'Saving...'
              : editingRequestId
              ? 'Save changes'
              : 'Submit request'}
          </button>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="cols c-bal">
        {/* Left Column: Requisition Ticket */}
        <div className="stack">
          <Ticket
            no={
              editingRequestId
                ? `EDITING ${editingRequestId}`
                : `DRAFT REQUEST · ${section}`
            }
            right={`submitting at ${sampleClock} (sample clock)`}
          >
            {/* Header Controls: Section, Issue Window Mode, Needed By */}
            <div
              style={{
                display: 'flex',
                gap: 24,
                flexWrap: 'wrap',
                marginBottom: 16,
                alignItems: 'flex-end',
              }}
            >
              {/* Section Selector */}
              <div>
                <span className="lbl">Section</span>
                <br />
                <div className="seg" style={{ marginTop: 5 }}>
                  <button
                    type="button"
                    className={section === 'KITCHEN' ? 'on' : ''}
                    onClick={() => setSection('KITCHEN')}
                  >
                    Kitchen
                  </button>
                  <button
                    type="button"
                    className={section === 'BAR' ? 'on' : ''}
                    onClick={() => setSection('BAR')}
                  >
                    Bar
                  </button>
                  <button
                    type="button"
                    className={section === 'CHEESE' ? 'on' : ''}
                    onClick={() => setSection('CHEESE')}
                  >
                    Cheese
                  </button>
                </div>
              </div>

              {/* Window Detection & Simulation Toggle */}
              <div>
                <span className="lbl">Issue Window Clock</span>
                <br />
                <div className="seg" style={{ marginTop: 5 }}>
                  <button
                    type="button"
                    className={windowMode === 'in' ? 'on' : ''}
                    onClick={() => setWindowMode('in')}
                  >
                    10:15 inside window
                  </button>
                  <button
                    type="button"
                    className={windowMode === 'out' ? 'on' : ''}
                    onClick={() => setWindowMode('out')}
                  >
                    12:40 outside window
                  </button>
                </div>
              </div>

              {/* Needed-by Dropdown */}
              <div>
                <label className="lbl" htmlFor="needed-time">
                  Needed by
                </label>
                <select
                  id="needed-time"
                  className="in"
                  style={{ width: 120, marginTop: 5 }}
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                >
                  <option value="10:45">10:45</option>
                  <option value="11:00">11:00</option>
                  <option value="11:15">11:15</option>
                  <option value="11:30">11:30</option>
                  <option value="12:00">12:00</option>
                  <option value="15:00">15:00</option>
                  <option value="16:30">16:30</option>
                  <option value="18:00">18:00</option>
                </select>
              </div>
            </div>

            {/* Window Detection Banner */}
            {windowMode === 'out' ? (
              <div className="note er" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <Badge variant="am">OUTSIDE ISSUE WINDOW</Badge>
                  <Badge variant="ur">URGENT</Badge>
                </div>
                <div>
                  <b>Outside the issue window (sample 06:00–11:30, 14:00–17:00).</b> Your request is
                  still accepted but is flagged as urgent. A reason is required.
                </div>
                <label
                  className="lbl"
                  htmlFor="urgent-reason-input"
                  style={{ display: 'block', marginTop: 10 }}
                >
                  Reason for urgent request
                </label>
                <input
                  id="urgent-reason-input"
                  className={`in ${attemptedSubmit && !urgentReason.trim() ? 'err' : ''}`}
                  value={urgentReason}
                  onChange={(e) => setUrgentReason(e.target.value)}
                  placeholder="e.g. Banquet booking added after cut-off, unexpected dinner rush"
                />
                {attemptedSubmit && !urgentReason.trim() && (
                  <span
                    className="meta"
                    style={{ color: 'var(--err)', display: 'block', marginTop: 4 }}
                  >
                    Please provide an urgent reason to submit outside the window.
                  </span>
                )}
              </div>
            ) : (
              <div
                className="note ok"
                style={{
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <Badge variant="ok">Inside Window</Badge>
                <span>
                  <b>Inside the active issue window.</b> Standard requisition, prioritized in FIFO
                  queue.
                </span>
              </div>
            )}

            {/* Item Search & Selector from 20 catalog items */}
            <label className="lbl" htmlFor="isearch">
              Add item from catalog
            </label>
            <input
              id="isearch"
              className="in"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search item name or code, e.g. mozz, basil, burrata, dough, chicken"
              autoComplete="off"
            />

            {/* Search Match Results */}
            {searchQuery.trim().length > 0 && (
              <div className="stub w" style={{ marginTop: 8, padding: '8px 12px' }}>
                {matchingItems.length > 0 ? (
                  <div className="chips">
                    {matchingItems.map((it) => (
                      <button
                        key={it.code}
                        type="button"
                        className="chip"
                        onClick={() => handleAddItem(it)}
                      >
                        {it.name} <span className="n">{it.uom}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="gloss" style={{ margin: 0 }}>
                    No matching item in catalog.
                  </p>
                )}
              </div>
            )}

            {/* Quick Catalog Suggestions if no lines */}
            {searchQuery.trim().length === 0 && lines.length === 0 && (
              <div style={{ marginTop: 10 }}>
                <span className="gloss" style={{ display: 'block', marginBottom: 6 }}>
                  Catalog quick-pick:
                </span>
                <div className="chips">
                  {CATALOG_ITEMS.slice(0, 6).map((it) => (
                    <button
                      key={it.code}
                      type="button"
                      className="chip"
                      onClick={() => handleAddItem(it)}
                    >
                      {it.name} <span className="n">{it.uom}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Draft Lines Section */}
            <div className="dash" />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span className="lbl">Lines ({lines.length})</span>
              {lines.length > 0 && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setLines([])}
                  style={{ padding: '2px 8px', fontSize: 11 }}
                >
                  Clear lines
                </button>
              )}
            </div>

            {/* Render Lines */}
            {lines.length > 0 ? (
              lines.map((line, idx) => {
                const it = getItem(line.itemCode);
                const step = it.uom === 'kg' ? 0.5 : 1;
                return (
                  <div className="line" key={line.itemCode}>
                    <div className="ln">
                      <div style={{ minWidth: 200 }}>
                        <span className="nm">{it.name}</span>
                        <div className="meta">
                          {it.code} · {it.warehouse === 'COLD' ? 'Cold Room' : 'Dry Store'}
                        </div>
                      </div>

                      {/* Stepper with - / input / + */}
                      <span style={{ marginLeft: 'auto' }} className="step">
                        <button
                          type="button"
                          onClick={() => handleStepQty(idx, -step)}
                          aria-label={`Decrease ${it.name} quantity`}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          step={it.uom === 'kg' ? '0.1' : '1'}
                          min="0.1"
                          value={line.requestedQty}
                          onChange={(e) => handleDirectQtyChange(idx, e.target.value)}
                          className="num"
                          style={{
                            width: 60,
                            border: 0,
                            textAlign: 'center',
                            fontWeight: 600,
                            fontSize: 14,
                            fontFamily: 'var(--mono)',
                            background: 'transparent',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleStepQty(idx, step)}
                          aria-label={`Increase ${it.name} quantity`}
                        >
                          +
                        </button>
                      </span>

                      {/* UoM Label */}
                      <span className="meta" style={{ width: 32, textAlign: 'center' }}>
                        {it.uom}
                      </span>

                      {/* Remove Line Action */}
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => handleRemoveLine(idx)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="note" style={{ marginTop: 8 }}>
                No lines yet. Search an item above to add to your requisition.
              </div>
            )}
          </Ticket>
        </div>

        {/* Right Column: "My Requests" Drawer / List (Flow C-1) */}
        <aside className="stack">
          <div className="stub w">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span className="lbl" style={{ margin: 0 }}>
                My requests ({section})
              </span>
              <button
                type="button"
                className="btn ghost sm"
                onClick={refreshRequests}
                disabled={isLoadingRequests}
                style={{ padding: '2px 8px', fontSize: 11 }}
              >
                {isLoadingRequests ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {/* Status Filter Chips */}
            <div className="chips" style={{ marginBottom: 14 }}>
              <Chip
                label="All"
                count={requests.filter((r) => r.section_id === section).length}
                active={statusFilter === 'ALL'}
                onClick={() => setStatusFilter('ALL')}
              />
              <Chip
                label="Queued"
                count={
                  requests.filter((r) => r.section_id === section && r.status === 'QUEUED').length
                }
                active={statusFilter === 'QUEUED'}
                onClick={() => setStatusFilter('QUEUED')}
              />
              <Chip
                label="Active"
                count={
                  requests.filter(
                    (r) =>
                      r.section_id === section &&
                      (r.status === 'PICKING' || r.status === 'AWAITING_RUNNER')
                  ).length
                }
                active={statusFilter === 'ACTIVE'}
                onClick={() => setStatusFilter('ACTIVE')}
              />
            </div>

            {/* Requests List */}
            {filteredRequests.length > 0 ? (
              filteredRequests.map((req) => {
                const isQueued = req.status === 'QUEUED';
                return (
                  <div
                    key={req.request_id}
                    style={{
                      padding: '12px 0',
                      borderBottom: '1px dotted var(--rule)',
                    }}
                  >
                    {/* Request Top Bar: ID, Urgent Badge, Status Badge */}
                    <div
                      className="top"
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <b className="meta" style={{ color: 'var(--navy)', fontSize: 13 }}>
                        {req.request_id}
                      </b>
                      {req.is_urgent && <Badge variant="ur">URGENT</Badge>}
                      <span style={{ marginLeft: 'auto' }}>
                        {renderStatusBadge(req.status)}
                      </span>
                    </div>

                    {/* Line Items Summary */}
                    <div style={{ margin: '6px 0', fontSize: 13.5 }}>
                      {req.items && req.items.length > 0
                        ? req.items
                            .map((it: { item_code?: string; itemCode?: string; requested_qty?: number; requestedQty?: number }) => {
                              const c = it.item_code || it.itemCode || '';
                              const catIt = getItem(c);
                              const q = it.requested_qty ?? it.requestedQty;
                              const formattedQty =
                                catIt.uom === 'kg'
                                  ? Number(q).toFixed(1)
                                  : String(Math.round(Number(q)));
                              return `${catIt.name} ${formattedQty} ${catIt.uom}`;
                            })
                            .join(', ')
                        : 'No lines'}
                    </div>

                    {/* Metadata: needed by, time, urgent reason */}
                    <div className="meta" style={{ fontSize: 11.5 }}>
                      {req.needed_by ? `needed ${req.needed_by} · ` : ''}
                      {req.urgent_reason ? `Urgent: ${req.urgent_reason} · ` : ''}
                      {req.status === 'PICKING' ? 'picking started · ' : ''}
                      {req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>

                    {/* Action Seam: Edit & Cancel available ONLY in QUEUED state */}
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      {isQueued ? (
                        <>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => handleStartEdit(req)}
                            disabled={isSubmitting}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => handleCancelRequest(req.request_id)}
                            disabled={isSubmitting}
                          >
                            Cancel request
                          </button>
                        </>
                      ) : (
                        <span className="gloss" style={{ fontSize: 12 }}>
                          {req.status === 'CANCELLED_BY_REQUESTER'
                            ? 'Cancelled, kept in history.'
                            : req.status === 'CONFIRMED'
                            ? 'Closed, confirmed at the door.'
                            : 'Locked: the keeper has started picking. Edit and cancel are off.'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="note" style={{ marginTop: 8 }}>
                No requests found for this filter.
              </div>
            )}
          </div>

          {/* Descriptive Operational Stubs matching prototype */}
          <div className="stub">
            <span className="lbl">Phone note</span>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Requests made on the phone while offline queue there and send once. This desktop view
              is for office and kitchen-office use.
            </p>
          </div>

          <div className="stub">
            <span className="lbl">Flow C-1 Invariants</span>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Physical quantities only. Requisitions are editable or cancellable only while queued.
              Once warehouse picking starts, line items and quantities are locked.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
