'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  initiateStockCount,
  submitFirstCount,
  submitRecount,
  approveStockAdjustment,
  createStockAdjustmentVoucher,
  CountType,
} from '@/lib/data/count';

interface CountItemRow {
  bin: string;
  location: string;
  itemCode: string;
  name: string;
  uom: 'kg' | 'pcs';
  bookQty: number;
  firstCountQty: number | null;
  recountQty: number | null;
}

type CountStage = 'count' | 'recount' | 'voucher' | 'fc' | 'closed';

interface CertificateInfo {
  id: string;
  archivedAt: string;
  kind: 'balanced' | 'voucher';
  firstCounter: string;
  recounter?: string;
  approver?: string;
}

const INITIAL_ROWS: CountItemRow[] = [
  {
    bin: 'CR-A1-R1',
    location: 'Shelf A1, right',
    itemCode: 'RM-MOZ-01',
    name: 'Mozzarella block',
    uom: 'kg',
    bookQty: 42.5,
    firstCountQty: 42.5,
    recountQty: null,
  },
  {
    bin: 'CR-A1-L1',
    location: 'Shelf A1, left',
    itemCode: 'RM-BUR-01',
    name: 'Burrata',
    uom: 'pcs',
    bookQty: 18,
    firstCountQty: 18,
    recountQty: null,
  },
  {
    bin: 'CR-A2-R1',
    location: 'Rack A2, right',
    itemCode: 'RM-SAL-01',
    name: 'Salmon fillet',
    uom: 'kg',
    bookQty: 9.4,
    firstCountQty: 9.4,
    recountQty: null,
  },
  {
    bin: 'CR-A2-L1',
    location: 'Rack A2, left',
    itemCode: 'RM-CHK-01',
    name: 'Chicken breast',
    uom: 'kg',
    bookQty: 26.0,
    firstCountQty: 26.0,
    recountQty: null,
  },
  {
    bin: 'CR-B1-R1',
    location: 'Rack B1, right',
    itemCode: 'RM-BAS-01',
    name: 'Fresh basil',
    uom: 'kg',
    bookQty: 3.2,
    firstCountQty: 3.2,
    recountQty: null,
  },
  {
    bin: 'CR-B1-L1',
    location: 'Rack B1, left',
    itemCode: 'RM-GOR-01',
    name: 'Gorgonzola',
    uom: 'kg',
    bookQty: 4.0,
    firstCountQty: 3.6, // Discrepancy: -0.4 kg
    recountQty: null,
  },
  {
    bin: 'CR-C1-R1',
    location: 'Floor C1, right',
    itemCode: 'RM-DOU-01',
    name: 'Pizza dough ball',
    uom: 'pcs',
    bookQty: 140,
    firstCountQty: 138, // Discrepancy: -2 pcs
    recountQty: null,
  },
];

const ROOT_CAUSES = [
  'Select root cause',
  'Trimming or prep loss',
  'Spillage or breakage',
  'Unrecorded kitchen issue',
  'Mis-picked unit (kg vs pcs)',
  'Receiving dock intake variance',
  'Unknown discrepancy, escalate',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatQty(uom: 'kg' | 'pcs', qty: number): string {
  if (uom === 'kg') {
    return `${qty.toFixed(1)} kg`;
  }
  return `${Math.round(qty)} pcs`;
}

function formatDiff(uom: 'kg' | 'pcs', diff: number): string {
  if (diff === 0) return '0';
  const sign = diff > 0 ? '+' : '−';
  const val = uom === 'kg' ? Math.abs(diff).toFixed(1) : Math.abs(Math.round(diff));
  return `${sign}${val} ${uom}`;
}

export default function StockCountPage() {
  const { role, setRole, store, showToast } = useShell();

  const [countId, setCountId] = useState<string>('cnt-init-1030');
  const [warehouseId] = useState<string>('WH-DEL01-COLD');
  const [countType, setCountType] = useState<CountType>('WEEKLY_CYCLE');
  const [stage, setStage] = useState<CountStage>('count');
  const [rows, setRows] = useState<CountItemRow[]>(INITIAL_ROWS);
  const [firstCountBy, setFirstCountBy] = useState<string | null>(null);
  const [recountBy, setRecountBy] = useState<string | null>(null);

  // Editable input buffers
  const [firstInputs, setFirstInputs] = useState<Record<string, string>>({
    'RM-MOZ-01': '42.5',
    'RM-BUR-01': '18',
    'RM-SAL-01': '9.4',
    'RM-CHK-01': '26.0',
    'RM-BAS-01': '3.2',
    'RM-GOR-01': '3.6',
    'RM-DOU-01': '138',
  });
  const [recountInputs, setRecountInputs] = useState<Record<string, string>>({
    'RM-GOR-01': '3.6',
    'RM-DOU-01': '140', // Recount resolves dough balls
  });

  // Voucher details
  const [voucherSeq, setVoucherSeq] = useState<number>(10);
  const [selectedCause, setSelectedCause] = useState<string>(ROOT_CAUSES[1]);
  const [voucherNote, setVoucherNote] = useState<string>(
    'Book 4.0 kg, physical count 3.6 kg confirmed on recount. Trimming loss in cold preparation.'
  );
  const [voucherAdjustmentId, setVoucherAdjustmentId] = useState<string>('ADJ-0010');
  const [certificate, setCertificate] = useState<CertificateInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Role permissions
  const canPerformFirstCount = ['keeper', 'cust', 'acct', 'admin'].includes(role);
  const canPerformRecount = ['acct', 'rm', 'admin'].includes(role) && role !== firstCountBy;
  const canSubmitVoucher = role === 'acct' || role === 'admin';
  const isCounter = role === firstCountBy || role === recountBy;
  const canApproveAdjustment = (role === 'fc' || role === 'admin') && !isCounter;

  // Active warehouse freeze condition: active during any non-closed count
  const isWarehouseFrozen = stage !== 'closed';

  // Discrepancy calculations
  const analyzedRows = useMemo(() => {
    return rows.map((r) => {
      const firstVal = r.firstCountQty;
      const firstDiff = firstVal != null ? round2(firstVal - r.bookQty) : null;
      const recVal = r.recountQty;
      const finalDiff =
        recVal != null
          ? round2(recVal - r.bookQty)
          : firstDiff != null
          ? firstDiff
          : 0;

      let statusKey: 'balanced' | 'needs_recount' | 'resolved' | 'differs' = 'balanced';
      if (firstDiff !== null && firstDiff !== 0) {
        if (recVal === null) {
          statusKey = 'needs_recount';
        } else if (round2(recVal - r.bookQty) === 0) {
          statusKey = 'resolved';
        } else {
          statusKey = 'differs';
        }
      }

      return {
        ...r,
        firstDiff,
        finalDiff,
        statusKey,
      };
    });
  }, [rows]);

  const flaggedDiscrepancies = useMemo(() => {
    return analyzedRows.filter((r) => r.firstDiff !== null && r.firstDiff !== 0);
  }, [analyzedRows]);

  const unresolvedDiscrepancies = useMemo(() => {
    return analyzedRows.filter((r) => r.statusKey === 'differs');
  }, [analyzedRows]);

  // Handle count type toggle
  const handleTypeChange = (newType: CountType) => {
    if (stage !== 'count') return;
    setCountType(newType);
  };

  // Phase 1: Submit First Count
  const handleSubmitFirstCount = async () => {
    if (!canPerformFirstCount || isSubmitting) return;

    setIsSubmitting(true);
    const updatedRows = rows.map((r) => {
      const raw = firstInputs[r.itemCode];
      const val = raw !== undefined && raw !== '' ? parseFloat(raw) : r.bookQty;
      return {
        ...r,
        firstCountQty: val,
      };
    });

    const payload = updatedRows.map((r) => ({
      itemCode: r.itemCode,
      countedQty: r.firstCountQty ?? r.bookQty,
    }));

    const result = await dispatchAction<void>({
      actionName: 'submit_first_count',
      storeId: store,
      payload: { countId, counts: payload },
      execute: async () => {
        await submitFirstCount(countId, payload);
      },
      onSuccess: () => {
        setRows(updatedRows);
        setFirstCountBy(role);

        // Discrepancy comparison
        const hasDiff = updatedRows.some(
          (r) => round2((r.firstCountQty ?? 0) - r.bookQty) !== 0
        );

        if (!hasDiff) {
          // Perfectly balanced: Complete immediately, lift freeze, issue certificate
          const cert: CertificateInfo = {
            id: `CERT-${countType === 'MONTH_END_FULL' ? 'ME' : 'WC'}-1102`,
            archivedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            kind: 'balanced',
            firstCounter: role,
          };
          setCertificate(cert);
          setStage('closed');
          showToast('Count balanced. Storeroom freeze lifted. Certificate archived.');
        } else {
          // Discrepancy detected: Transition to Phase 2 (RECOUNT)
          setStage('recount');
          showToast('Discrepancies detected. Storeroom remains frozen. Recount required.');
        }
      },
      onError: (err) => {
        showToast(`First count submission error: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Phase 2: Submit Recount
  const handleSubmitRecount = async () => {
    if (!canPerformRecount || isSubmitting) return;

    setIsSubmitting(true);
    const updatedRows = rows.map((r) => {
      const raw = recountInputs[r.itemCode];
      if (raw !== undefined && raw !== '') {
        return {
          ...r,
          recountQty: parseFloat(raw),
        };
      }
      return r;
    });

    const recountPayload = updatedRows
      .filter((r) => r.recountQty != null)
      .map((r) => ({
        itemCode: r.itemCode,
        recountQty: r.recountQty!,
      }));

    const result = await dispatchAction<void>({
      actionName: 'submit_recount',
      storeId: store,
      payload: { countId, counts: recountPayload },
      execute: async () => {
        await submitRecount(countId, recountPayload);
      },
      onSuccess: () => {
        setRows(updatedRows);
        setRecountBy(role);

        // Check if recount resolved all discrepancies
        const stillDiffers = updatedRows.some((r) => {
          if (r.recountQty != null) {
            return round2(r.recountQty - r.bookQty) !== 0;
          }
          if (r.firstCountQty != null) {
            return round2(r.firstCountQty - r.bookQty) !== 0;
          }
          return false;
        });

        if (!stillDiffers) {
          // Recount resolved everything
          const cert: CertificateInfo = {
            id: `CERT-${countType === 'MONTH_END_FULL' ? 'ME' : 'WC'}-1102`,
            archivedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            kind: 'balanced',
            firstCounter: firstCountBy || 'keeper',
            recounter: role,
          };
          setCertificate(cert);
          setStage('closed');
          showToast('Recount resolved all discrepancies. Certificate archived.');
        } else {
          // Discrepancies confirmed: Transition to Phase 3 (Voucher Drafting)
          setStage('voucher');
          showToast('Discrepancy confirmed by recount. Adjustment voucher required.');
        }
      },
      onError: (err) => {
        showToast(`Recount submission error: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Phase 3a: Submit Adjustment Voucher (Store Accountant)
  const handleSubmitVoucher = async () => {
    if (!canSubmitVoucher || isSubmitting) return;

    setIsSubmitting(true);
    const unres = analyzedRows.filter((r) => r.statusKey === 'differs');

    const result = await dispatchAction<void>({
      actionName: 'submit_adjustment_voucher',
      storeId: store,
      payload: {
        countId,
        cause: selectedCause,
        note: voucherNote,
        items: unres.map((r) => ({
          itemCode: r.itemCode,
          adjustmentQty: round2((r.recountQty ?? r.firstCountQty ?? r.bookQty) - r.bookQty),
        })),
      },
      execute: async () => {
        for (const item of unres) {
          const adjQty = round2((item.recountQty ?? item.firstCountQty ?? item.bookQty) - item.bookQty);
          await createStockAdjustmentVoucher({
            countId,
            warehouseId,
            itemCode: item.itemCode,
            adjustmentQty: adjQty,
            rootCauseReason: selectedCause,
          });
        }
      },
      onSuccess: () => {
        setStage('fc');
        showToast('Adjustment voucher submitted to Financial Controller.');
      },
      onError: (err) => {
        showToast(`Voucher submission error: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Phase 3b: Approve Stock Adjustment (Financial Controller only)
  const handleApproveAdjustment = async () => {
    if (!canApproveAdjustment || isSubmitting) return;

    setIsSubmitting(true);
    const result = await dispatchAction<void>({
      actionName: 'approve_stock_adjustment',
      storeId: store,
      payload: { adjustmentId: voucherAdjustmentId, notes: voucherNote },
      execute: async () => {
        await approveStockAdjustment(voucherAdjustmentId, voucherNote);
      },
      onSuccess: () => {
        const cert: CertificateInfo = {
          id: `CERT-${countType === 'MONTH_END_FULL' ? 'ME' : 'WC'}-1102`,
          archivedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          kind: 'voucher',
          firstCounter: firstCountBy || 'keeper',
          recounter: recountBy || 'acct',
          approver: 'Financial Controller',
        };
        setCertificate(cert);
        setStage('closed');
        showToast('Adjustment authorized. COUNT_ADJUSTMENT ledger movements posted. Freeze lifted.');
      },
      onError: (err) => {
        showToast(`Adjustment approval error: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Reset / Start New Count
  const handleStartNewCount = async () => {
    const newSeq = voucherSeq + 1;
    setVoucherSeq(newSeq);
    setVoucherAdjustmentId(`ADJ-00${newSeq}`);
    setStage('count');
    setFirstCountBy(null);
    setRecountBy(null);
    setCertificate(null);
    setRows(INITIAL_ROWS);
    setFirstInputs({
      'RM-MOZ-01': '42.5',
      'RM-BUR-01': '18',
      'RM-SAL-01': '9.4',
      'RM-CHK-01': '26.0',
      'RM-BAS-01': '3.2',
      'RM-GOR-01': '3.6',
      'RM-DOU-01': '138',
    });
    setRecountInputs({
      'RM-GOR-01': '3.6',
      'RM-DOU-01': '140',
    });

    await dispatchAction<string>({
      actionName: 'initiate_stock_count',
      storeId: store,
      payload: { storeId: store, warehouseId, countType },
      execute: async () => {
        return await initiateStockCount(store, warehouseId, countType);
      },
      onSuccess: (newId) => {
        setCountId(newId);
        showToast('New stock count initiated. Storeroom frozen.');
      },
    });
  };

  // Helper label formatting
  const getRoleDisplay = (rKey: string | null) => {
    if (!rKey) return '—';
    const labels: Record<string, string> = {
      keeper: 'Warehouse Keeper',
      cust: 'Custodian',
      acct: 'Store Accountant',
      fc: 'Financial Controller',
      rm: 'Restaurant Manager',
      admin: 'System Admin',
      viewer: 'Viewer',
    };
    return labels[rKey] || rKey;
  };

  // Timeline step calculation
  const timelineIndex = useMemo(() => {
    switch (stage) {
      case 'count':
        return 0;
      case 'recount':
        return 2;
      case 'voucher':
        return 3;
      case 'fc':
        return 4;
      case 'closed':
        return 5;
      default:
        return 0;
    }
  }, [stage]);

  const steps = [
    { title: 'Count', sub: 'bins in order' },
    { title: 'Compare', sub: 'physical vs book' },
    { title: 'Recount', sub: 'second person' },
    { title: 'Voucher', sub: 'root cause' },
    { title: 'FC approval', sub: 'Financial Controller' },
    { title: 'Certificate', sub: 'archived' },
  ];

  return (
    <>
      {/* Header */}
      <div className="head">
        <div>
          <div className="kicker">
            Flow F &middot; Physical Inventory &middot; {store}
          </div>
          <h1 className="h1">
            Stock <em>count.</em>
          </h1>
          <div className="sub">
            Blind first count, system discrepancy comparison, second-person recount, root-cause voucher, and Financial Controller authorization before certificate archiving.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          {/* Count Type Selector */}
          <div className="seg" role="group" aria-label="Count type">
            <button
              type="button"
              className={countType === 'WEEKLY_CYCLE' ? 'on' : ''}
              onClick={() => handleTypeChange('WEEKLY_CYCLE')}
              disabled={stage !== 'count'}
            >
              WEEKLY_CYCLE
            </button>
            <button
              type="button"
              className={countType === 'MONTH_END_FULL' ? 'on' : ''}
              onClick={() => handleTypeChange('MONTH_END_FULL')}
              disabled={stage !== 'count'}
            >
              MONTH_END_FULL
            </button>
          </div>

          {/* Primary Action Button Bar */}
          <div>
            {stage === 'count' && (
              canPerformFirstCount ? (
                <button
                  type="button"
                  className="btn"
                  onClick={handleSubmitFirstCount}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit first count'}
                </button>
              ) : (
                <div className="note" style={{ maxWidth: 380 }}>
                  Counting is conducted by Warehouse Keeper, Custodian, or Store Accountant.
                </div>
              )
            )}

            {stage === 'recount' && (
              canPerformRecount ? (
                <button
                  type="button"
                  className="btn"
                  onClick={handleSubmitRecount}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Verifying...' : 'Submit recount'}
                </button>
              ) : (
                <div className="note am" style={{ maxWidth: 440 }}>
                  <b>Second person required.</b> The first count was submitted by{' '}
                  {getRoleDisplay(firstCountBy)}. A different counter (Store Accountant) must recount.
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setRole('acct')}
                    >
                      Switch to Store Accountant
                    </button>
                  </div>
                </div>
              )
            )}

            {stage === 'voucher' && (
              canSubmitVoucher ? (
                <button
                  type="button"
                  className="btn"
                  onClick={handleSubmitVoucher}
                  disabled={isSubmitting || !selectedCause || selectedCause === ROOT_CAUSES[0]}
                >
                  Submit adjustment voucher
                </button>
              ) : (
                <div className="note am" style={{ maxWidth: 420 }}>
                  <b>Root cause by Store Accountant.</b> Counters recount physical stock but do not submit vouchers.
                </div>
              )
            )}

            {stage === 'fc' && (
              canApproveAdjustment ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleApproveAdjustment}
                    disabled={isSubmitting}
                  >
                    Approve Stock Adjustment
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      showToast('Adjustment rejected by Financial Controller. Physical re-investigation requested.');
                      setStage('recount');
                    }}
                    disabled={isSubmitting}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <div className="note er" style={{ maxWidth: 460 }}>
                  <b>Segregation of duties:</b> Physical counters ({getRoleDisplay(role)}) cannot approve adjustment vouchers. Only the Financial Controller can authorize stock adjustments.
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setRole('fc')}
                    >
                      Switch to Financial Controller
                    </button>
                  </div>
                </div>
              )
            )}

            {stage === 'closed' && (
              <button
                type="button"
                className="btn"
                onClick={handleStartNewCount}
              >
                Start new count
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Warehouse Freeze Banner (Non-negotiable requirement) */}
      {isWarehouseFrozen && (
        <div className="note er" style={{ marginBottom: 16 }}>
          <b>System freeze.</b> {countType === 'MONTH_END_FULL' ? 'Month-end full count' : 'Weekly cycle count'} in progress. Requisitions and receiving dock put-aways are locked until the certificate is archived. Storeroom status: <b>WAREHOUSE FROZEN FOR COUNT</b>.
        </div>
      )}

      {/* Main Grid: Left Flow / Right Details */}
      <div className="cols c-bal">
        <div className="stack">
          <Ticket
            no={`COUNT SHEET \u00b7 ${warehouseId}`}
            right={countType === 'MONTH_END_FULL' ? 'month-end full inventory' : 'weekly cycle count'}
          >
            {/* 6-Step Visual Timeline */}
            <div className="tl" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
              {steps.map((st, i) => {
                let statusClass = '';
                if (i < timelineIndex) statusClass = 'done';
                else if (i === timelineIndex) statusClass = 'cur';

                const isVoucherSkipped =
                  stage === 'closed' && certificate?.kind === 'balanced';

                return (
                  <div key={st.title} className={statusClass}>
                    <div className="dot" />
                    <div className="tt" style={{ fontSize: '15px' }}>
                      {st.title}
                    </div>
                    <div className="ts">
                      {isVoucherSkipped && (i === 3 || i === 4)
                        ? 'not needed'
                        : st.sub}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inventory Count & Reconciliation Table */}
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Bin location</th>
                  <th>Item description</th>
                  <th className="num">Book quantity</th>
                  <th className="num">First count</th>
                  <th className="num">Diff</th>
                  <th className="num">Recount</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {analyzedRows.map((r, idx) => {
                  const isBlind = stage === 'count';
                  const needsRecountInput =
                    stage === 'recount' && r.statusKey === 'needs_recount' && canPerformRecount;

                  return (
                    <tr key={r.itemCode}>
                      <td className="m">{idx + 1}</td>
                      <td className="m" style={{ color: 'var(--navy)' }}>
                        <b>{r.bin}</b>
                        <div style={{ fontWeight: 400 }}>{r.location}</div>
                      </td>
                      <td>
                        <b>{r.name}</b>
                        <div className="meta">
                          {r.itemCode} &middot; {r.uom}
                        </div>
                      </td>

                      {/* Book Quantity: Strictly hidden during blind 1st count */}
                      <td className="num">
                        {isBlind ? (
                          <span className="gloss">hidden</span>
                        ) : (
                          formatQty(r.uom, r.bookQty)
                        )}
                      </td>

                      {/* First Count */}
                      <td className="num">
                        {stage === 'count' && canPerformFirstCount ? (
                          <input
                            id={`fc-${r.itemCode}`}
                            aria-label={`First count ${r.name}`}
                            className="in num"
                            style={{ width: '96px', margin: 0, display: 'inline-block' }}
                            type="number"
                            step={r.uom === 'kg' ? 0.1 : 1}
                            value={firstInputs[r.itemCode] ?? ''}
                            onChange={(e) =>
                              setFirstInputs((prev) => ({
                                ...prev,
                                [r.itemCode]: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          formatQty(r.uom, r.firstCountQty ?? r.bookQty)
                        )}
                      </td>

                      {/* Difference */}
                      <td
                        className={`num ${
                          !isBlind && r.firstDiff !== null
                            ? r.firstDiff < 0
                              ? 'neg'
                              : r.firstDiff > 0
                              ? 'pos'
                              : ''
                            : ''
                        }`}
                      >
                        <b>{isBlind ? '—' : formatDiff(r.uom, r.firstDiff ?? 0)}</b>
                      </td>

                      {/* Recount */}
                      <td className="num">
                        {isBlind || r.firstDiff === 0 ? (
                          '—'
                        ) : needsRecountInput ? (
                          <input
                            id={`rc-${r.itemCode}`}
                            aria-label={`Recount ${r.name}`}
                            className="in num"
                            style={{ width: '96px', margin: 0, display: 'inline-block' }}
                            type="number"
                            step={r.uom === 'kg' ? 0.1 : 1}
                            value={recountInputs[r.itemCode] ?? ''}
                            onChange={(e) =>
                              setRecountInputs((prev) => ({
                                ...prev,
                                [r.itemCode]: e.target.value,
                              }))
                            }
                            placeholder={r.uom}
                          />
                        ) : r.recountQty != null ? (
                          formatQty(r.uom, r.recountQty)
                        ) : (
                          <span className="ro">waiting</span>
                        )}
                      </td>

                      {/* State Badge */}
                      <td>
                        {isBlind && <Badge variant="mu">Not compared</Badge>}
                        {!isBlind && r.statusKey === 'balanced' && (
                          <Badge variant="ok">Balanced</Badge>
                        )}
                        {!isBlind && r.statusKey === 'needs_recount' && (
                          <Badge variant="er">Needs recount</Badge>
                        )}
                        {!isBlind && r.statusKey === 'resolved' && (
                          <Badge variant="ok">Resolved by recount</Badge>
                        )}
                        {!isBlind && r.statusKey === 'differs' && (
                          <Badge variant="am">Still differs</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="gloss" style={{ margin: '12px 0 0' }}>
              Bins are surveyed in spatial order. Expected book quantity is hidden during the blind first count to prevent confirmation bias.
            </p>

            {/* Phase 3: Adjustment Voucher Details */}
            {(stage === 'voucher' || stage === 'fc' || (stage === 'closed' && certificate?.kind === 'voucher')) && (
              <>
                <div className="dash" />
                <span className="lbl">
                  Adjustment voucher {voucherAdjustmentId} &middot;{' '}
                  {stage === 'fc'
                    ? 'submitted to FC'
                    : stage === 'closed'
                    ? 'authorized and posted'
                    : 'draft reconciliation'}
                </span>

                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Discrepancy item</th>
                      <th className="num">Book quantity</th>
                      <th className="num">Recount quantity</th>
                      <th className="num">Physical adjustment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unresolvedDiscrepancies.map((item) => {
                      const adj = round2(
                        (item.recountQty ?? item.firstCountQty ?? item.bookQty) - item.bookQty
                      );
                      return (
                        <tr key={item.itemCode}>
                          <td>
                            <b>{item.name}</b>
                            <div className="meta">{item.itemCode}</div>
                          </td>
                          <td className="num">{formatQty(item.uom, item.bookQty)}</td>
                          <td className="num">{formatQty(item.uom, item.recountQty ?? item.firstCountQty ?? 0)}</td>
                          <td className="num neg">
                            <b>{formatDiff(item.uom, adj)}</b>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                  <div>
                    <label className="lbl" htmlFor="root-cause-select">
                      Root cause reason (Store Accountant)
                    </label>
                    <select
                      id="root-cause-select"
                      className="in"
                      style={{ width: '270px' }}
                      value={selectedCause}
                      onChange={(e) => setSelectedCause(e.target.value)}
                      disabled={stage !== 'voucher' || !canSubmitVoucher}
                    >
                      {ROOT_CAUSES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <label className="lbl" htmlFor="voucher-note-input">
                      Investigation note
                    </label>
                    <input
                      id="voucher-note-input"
                      className="in"
                      value={voucherNote}
                      onChange={(e) => setVoucherNote(e.target.value)}
                      disabled={stage !== 'voucher' || !canSubmitVoucher}
                      placeholder="Detail who verified, scale calibration, physical condition"
                    />
                  </div>
                </div>
              </>
            )}
          </Ticket>
        </div>

        {/* Right Summary Aside */}
        <aside className="stack">
          {/* Sheet Metadata Stub */}
          <div className="stub w">
            <span className="lbl">Count Session</span>
            <table className="tick">
              <tbody>
                <tr>
                  <td>Type</td>
                  <td>{countType}</td>
                </tr>
                <tr>
                  <td>Storeroom</td>
                  <td>{warehouseId}</td>
                </tr>
                <tr>
                  <td>Freeze state</td>
                  <td>
                    {isWarehouseFrozen ? (
                      <span style={{ color: 'var(--err)', fontWeight: 600 }}>
                        FROZEN_FOR_COUNT
                      </span>
                    ) : (
                      <span style={{ color: 'var(--forest)', fontWeight: 600 }}>
                        ACTIVE
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>First count</td>
                  <td>{getRoleDisplay(firstCountBy)}</td>
                </tr>
                <tr>
                  <td>Recount</td>
                  <td>{getRoleDisplay(recountBy)}</td>
                </tr>
                <tr>
                  <td>Line items</td>
                  <td>
                    {rows.length} &middot; {flaggedDiscrepancies.length} flagged
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Ledger Movement Impact Stub */}
          <div className="stub w">
            <span className="lbl">
              {stage === 'closed' && certificate?.kind === 'voucher'
                ? 'Ledger movements appended'
                : 'Ledger movements on authorization'}
            </span>

            {unresolvedDiscrepancies.length > 0 && stage !== 'count' && stage !== 'recount' ? (
              unresolvedDiscrepancies.map((r) => {
                const adj = round2((r.recountQty ?? r.firstCountQty ?? r.bookQty) - r.bookQty);
                return (
                  <div key={r.itemCode} style={{ marginBottom: 10 }}>
                    <div className="ledrow">
                      <span className="t">COUNT_ADJUSTMENT</span>
                      <span>{r.name}</span>
                      <span className="neg">{formatDiff(r.uom, adj)}</span>
                    </div>
                    <div className="meta" style={{ margin: '-2px 0 6px' }}>
                      stock {formatQty(r.uom, r.bookQty)} &rarr;{' '}
                      <b>{formatQty(r.uom, r.recountQty ?? r.firstCountQty ?? 0)}</b>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="gloss" style={{ margin: 0 }}>
                {stage === 'closed'
                  ? 'No adjustment needed. All items balanced against ledger.'
                  : 'Appended only upon Financial Controller authorization, one immutable row per confirmed variance.'}
              </p>
            )}
            <p className="gloss" style={{ margin: '8px 0 0' }}>
              Append-only. Physical quantities only. No financial values stored.
            </p>
          </div>

          {/* Archived Certificate Box */}
          {stage === 'closed' && certificate && (
            <div className="note ok">
              <b>Certificate {certificate.id} archived at {certificate.archivedAt}.</b>
              <div>Storeroom freeze released back to ACTIVE.</div>
              <div style={{ marginTop: 6, fontSize: '13px' }}>
                Counters: {getRoleDisplay(certificate.firstCounter)}
                {certificate.recounter ? ` and ${getRoleDisplay(certificate.recounter)}` : ''}.
                {certificate.kind === 'voucher'
                  ? ' Authorized by Financial Controller.'
                  : ' Balanced without adjustments.'}
              </div>
            </div>
          )}

          {/* Segregation of Duties Governance */}
          <div className="stub">
            <span className="lbl">Segregation of duties</span>
            <p style={{ margin: 0, fontSize: '13.5px' }}>
              Physical counters (Warehouse Keeper and Store Accountant) cannot authorize adjustment vouchers. Recounts require an independent second individual. Only the Financial Controller approves post-cutoff adjustments.
            </p>
          </div>

          {/* Role Status Note */}
          <div className="stub w">
            <span className="lbl">Active perspective</span>
            <p style={{ margin: 0, fontSize: '13.5px' }}>
              Viewing as <b>{getRoleDisplay(role)}</b>.
              {role === 'viewer' && ' Read-only audit access.'}
              {role === 'keeper' && ' Responsible for physical storeroom and blind first count.'}
              {role === 'acct' && ' Responsible for independent recount and root cause documentation.'}
              {role === 'fc' && ' Executive authority to authorize post-cutoff adjustments.'}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
