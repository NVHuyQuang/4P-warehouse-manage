'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  submitDailyBalance,
  signOffDailyBalance,
  getDailyBalanceHistory,
  BENCHMARK_ITEMS,
  STOREROOMS,
  CAUSE_CODES,
  BenchmarkItemDef,
  DailyBalanceRecord,
  StoreroomOption,
} from '@/lib/data/balance';

interface ItemRowState {
  item_code: string;
  name: string;
  uom: 'kg' | 'pcs';
  storage_type: 'COLD' | 'DRY';
  category: string;
  opening_qty: number;
  received_qty: number;
  issued_qty: number;
  counted_input: string;
  recount_input: string;
  variance_reason: string;
  responsible_person: string;
  investigation_note: string;
}

export default function DailyBalancePage() {
  const { role, roleConfig, store, showToast } = useShell();

  // Storeroom selection: Cold Room (WH-01) vs Dry Store (WH-02)
  const [activeStorage, setActiveStorage] = useState<'COLD' | 'DRY'>('COLD');

  const storeroomList: StoreroomOption[] = useMemo(() => {
    return STOREROOMS[store] || STOREROOMS['IND-DEL-01'];
  }, [store]);

  const activeStoreroom: StoreroomOption = useMemo(() => {
    return (
      storeroomList.find((s) => s.type === activeStorage) ||
      storeroomList[0] || {
        id: 'WH-DEL01-COLD',
        code: 'WH-01',
        name: 'Cold Room',
        type: 'COLD',
        floor: 'Ground floor',
      }
    );
  }, [storeroomList, activeStorage]);

  // Initialize row states for items
  const [itemRows, setItemRows] = useState<Record<string, ItemRowState>>(() => {
    const initial: Record<string, ItemRowState> = {};
    BENCHMARK_ITEMS.forEach((it) => {
      // Default sample count matching approved prototype
      const isSampleDiscrepancy = it.item_code === 'RM-BAS-01';
      initial[it.item_code] = {
        item_code: it.item_code,
        name: it.name,
        uom: it.uom,
        storage_type: it.storage_type,
        category: it.category,
        opening_qty: it.opening_qty,
        received_qty: it.received_qty,
        issued_qty: it.issued_qty,
        counted_input: String(it.sample_counted_qty),
        recount_input: isSampleDiscrepancy ? '3.0' : '',
        variance_reason: isSampleDiscrepancy ? 'Trimming or prep loss' : '',
        responsible_person: isSampleDiscrepancy ? 'Kitchen Lead' : '',
        investigation_note: isSampleDiscrepancy
          ? 'Checked prep station; trimming scrap observed'
          : '',
      };
    });
    return initial;
  });

  // Session submission and sign-off state
  const [balanceId, setBalanceId] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isSigned, setIsSigned] = useState<boolean>(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signedByRole, setSignedByRole] = useState<string | null>(null);
  const [signoffNotes, setSignoffNotes] = useState<string>('');
  const [isUnexplained, setIsUnexplained] = useState<boolean>(false);

  // Loading and action progress
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSigning, setIsSigning] = useState<boolean>(false);

  // History list
  const [history, setHistory] = useState<DailyBalanceRecord[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const records = await getDailyBalanceHistory(store);
      setHistory(records);
    } catch {
      // fallback history
    }
  }, [store]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Current storeroom items calculation
  const currentItems = useMemo(() => {
    return BENCHMARK_ITEMS.filter((it) => it.storage_type === activeStorage).map(
      (def) => {
        const row = itemRows[def.item_code] || {
          item_code: def.item_code,
          name: def.name,
          uom: def.uom,
          storage_type: def.storage_type,
          category: def.category,
          opening_qty: def.opening_qty,
          received_qty: def.received_qty,
          issued_qty: def.issued_qty,
          counted_input: String(def.sample_counted_qty),
          recount_input: '',
          variance_reason: '',
          responsible_person: '',
          investigation_note: '',
        };

        const expected =
          Math.round((row.opening_qty + row.received_qty - row.issued_qty) * 1000) /
          1000;

        const countNum =
          row.counted_input === '' ? expected : Number(row.counted_input);

        // Recount handling: if recount is entered and matches expected, it clears variance
        const recountNum =
          row.recount_input.trim() !== '' ? Number(row.recount_input) : null;

        const hasRecountMatch =
          recountNum !== null &&
          !isNaN(recountNum) &&
          Math.round((recountNum - expected) * 1000) / 1000 === 0;

        const rawVariance = Math.round((countNum - expected) * 1000) / 1000;
        const effectiveVariance = hasRecountMatch ? 0 : rawVariance;

        let rowState: 'ok' | 'var' | 'fixed' | 'esc' = 'ok';
        if (effectiveVariance !== 0) {
          if (row.variance_reason && row.variance_reason !== CAUSE_CODES[0]) {
            rowState = 'esc';
          } else {
            rowState = 'var';
          }
        } else if (hasRecountMatch && rawVariance !== 0) {
          rowState = 'fixed';
        }

        return {
          ...row,
          expected_qty: expected,
          counted_num: countNum,
          effective_variance: effectiveVariance,
          raw_variance: rawVariance,
          has_recount_match: hasRecountMatch,
          row_state: rowState,
        };
      }
    );
  }, [activeStorage, itemRows]);

  // Summary counts
  const totalItemCount = currentItems.length;
  const balancedItemCount = currentItems.filter(
    (it) => it.effective_variance === 0
  ).length;
  const varianceItems = currentItems.filter(
    (it) => it.effective_variance !== 0
  );
  const openUnresolvedCount = currentItems.filter(
    (it) => it.row_state === 'var'
  ).length;

  const hasAnyVariance = varianceItems.length > 0;
  const isAllBalanced = !hasAnyVariance;

  // Authorization checks
  const canCountAndSubmit = ['cust', 'keeper', 'admin'].includes(role);
  const canSignOffRole = ['rm', 'fc', 'acct', 'admin'].includes(role);
  // Custodian can sign off if completely balanced
  const canCustodianSign = role === 'cust' && isAllBalanced;
  const canSign = canSignOffRole || canCustodianSign;

  // Event handlers for inputs
  const handleCountChange = (itemCode: string, val: string) => {
    if (isSigned) return;
    setItemRows((prev) => ({
      ...prev,
      [itemCode]: {
        ...prev[itemCode],
        counted_input: val,
      },
    }));
  };

  const handleRecountChange = (itemCode: string, val: string) => {
    if (isSigned) return;
    setItemRows((prev) => ({
      ...prev,
      [itemCode]: {
        ...prev[itemCode],
        recount_input: val,
      },
    }));
  };

  const handleCauseChange = (itemCode: string, val: string) => {
    if (isSigned) return;
    setItemRows((prev) => ({
      ...prev,
      [itemCode]: {
        ...prev[itemCode],
        variance_reason: val,
      },
    }));
  };

  const handleResponsibleChange = (itemCode: string, val: string) => {
    if (isSigned) return;
    setItemRows((prev) => ({
      ...prev,
      [itemCode]: {
        ...prev[itemCode],
        responsible_person: val,
      },
    }));
  };

  const handleNoteChange = (itemCode: string, val: string) => {
    if (isSigned) return;
    setItemRows((prev) => ({
      ...prev,
      [itemCode]: {
        ...prev[itemCode],
        investigation_note: val,
      },
    }));
  };

  // Switch storeroom
  const handleSwitchStoreroom = (type: 'COLD' | 'DRY') => {
    setActiveStorage(type);
    setBalanceId(null);
    setIsSubmitted(false);
    setIsSigned(false);
    setSignedAt(null);
    setSignedByRole(null);
  };

  // Reset to default sample
  const handleResetSession = () => {
    setBalanceId(null);
    setIsSubmitted(false);
    setIsSigned(false);
    setSignedAt(null);
    setSignedByRole(null);
    setIsUnexplained(false);
    setSignoffNotes('');
    showToast('Daily balance session reset.');
  };

  // Submit Daily Balance
  const handleSubmitBalance = async () => {
    if (!canCountAndSubmit) {
      showToast('Your role has a read-only view of counts.');
      return;
    }

    if (hasAnyVariance && !isUnexplained) {
      const unhandled = varianceItems.filter(
        (it) => !it.variance_reason || it.variance_reason === CAUSE_CODES[0]
      );
      if (unhandled.length > 0) {
        showToast(
          'Please select a cause code for all variances or check unexplained evening close.'
        );
        return;
      }
    }

    setIsSubmitting(true);

    const payloadItems = currentItems.map((it) => ({
      item_code: it.item_code,
      opening_qty: it.opening_qty,
      received_qty: it.received_qty,
      issued_qty: it.issued_qty,
      expected_qty: it.expected_qty,
      counted_qty: it.counted_num,
      variance_qty: it.effective_variance,
      variance_reason: it.variance_reason || null,
      responsible_person: it.responsible_person || null,
    }));

    const result = await dispatchAction<string>({
      actionName: 'submit_daily_balance',
      storeId: store,
      payload: {
        warehouseId: activeStoreroom.id,
        itemsCount: payloadItems.length,
        isUnexplained,
      },
      execute: () =>
        submitDailyBalance(store, activeStoreroom.id, payloadItems, isUnexplained),
      onSuccess: (id) => {
        setBalanceId(id);
        setIsSubmitted(true);
        showToast(
          hasAnyVariance
            ? 'Daily balance submitted with variance flagged.'
            : 'Daily balance submitted successfully (balanced).'
        );
        loadHistory();
      },
      onError: (err) => {
        showToast(`Submission failed: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Sign off Daily Balance
  const handleSignOffBalance = async () => {
    const targetBalanceId = balanceId || 'bal-pending-close';

    // Segregation of duties: Custodian cannot sign off discrepancies
    if (hasAnyVariance && role === 'cust' && !isUnexplained) {
      showToast(
        'Segregation of duties: Restaurant Manager or Financial Controller must review and sign off variances.'
      );
      return;
    }

    setIsSigning(true);

    const result = await dispatchAction<void>({
      actionName: 'sign_off_daily_balance',
      storeId: store,
      payload: {
        balanceId: targetBalanceId,
        notes: signoffNotes,
      },
      execute: () => signOffDailyBalance(targetBalanceId, signoffNotes),
      onSuccess: () => {
        setIsSigned(true);
        const timeStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        setSignedAt(timeStr);
        setSignedByRole(roleConfig.l);
        showToast('Daily balance signed off. Sheet locked.');
        loadHistory();
      },
      onError: (err) => {
        showToast(`Sign-off failed: ${err.message}`);
      },
    });

    setIsSigning(false);
  };

  return (
    <>
      {/* Morning escalation banner */}
      {(hasAnyVariance || isUnexplained) && (
        <div
          className="note am"
          style={{
            marginBottom: 20,
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <b>Morning Escalation Notice &middot; 08:00 AM.</b>
          <span>
            Unexplained variances and unresolved discrepancies are automatically
            escalated to the Central Financial Controller at 08:00 AM. Storeroom
            morning operations will proceed on schedule.
          </span>
        </div>
      )}

      {/* Page Header */}
      <div className="head">
        <div>
          <div className="kicker">
            Daily Close &middot; Business Day 01 Nov 2026 &middot; {store}
          </div>
          <h1 className="h1">
            Daily <em>balance.</em>
          </h1>
          <p className="sub">
            Expected = Opening + Received &minus; Issued. Counted is typed in by
            the custodian. Difference is calculated, never entered.
          </p>
        </div>

        {/* Primary Action Button */}
        <div>
          {isSigned ? (
            <button className="btn" disabled>
              Signed off
            </button>
          ) : !isSubmitted ? (
            <button
              className="btn"
              onClick={handleSubmitBalance}
              disabled={
                isSubmitting ||
                !canCountAndSubmit ||
                (openUnresolvedCount > 0 && !isUnexplained)
              }
            >
              {isSubmitting ? 'Submitting...' : 'Submit daily balance'}
            </button>
          ) : (
            <button
              className="btn"
              onClick={handleSignOffBalance}
              disabled={isSigning || !canSign}
            >
              {isSigning ? 'Signing off...' : 'Sign off balance'}
            </button>
          )}
        </div>
      </div>

      {/* Grid Layout: Main Table (1fr) + Right Sidebar (330px) */}
      <div className="cols c-bal">
        <div className="stack">
          {/* Storeroom Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div
              className="seg"
              role="group"
              aria-label="Storeroom selector"
            >
              <button
                type="button"
                className={activeStorage === 'COLD' ? 'on' : ''}
                onClick={() => handleSwitchStoreroom('COLD')}
              >
                Cold Room (WH-01)
              </button>
              <button
                type="button"
                className={activeStorage === 'DRY' ? 'on' : ''}
                onClick={() => handleSwitchStoreroom('DRY')}
              >
                Dry Store (WH-02)
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="lbl">Status:</span>
              {isAllBalanced ? (
                <Badge variant="ok">BALANCED</Badge>
              ) : (
                <Badge variant="er">VARIANCE FLAGGED</Badge>
              )}
            </div>
          </div>

          {/* Benchmark Items Table Ticket */}
          <Ticket
            no={`BALANCE SHEET · ${activeStoreroom.id}`}
            right="benchmark items (sample)"
          >
            <table>
              <thead>
                <tr>
                  <th>Item Code &amp; Name</th>
                  <th className="num">Opening</th>
                  <th className="num">Received (+)</th>
                  <th className="num">Issued (&minus;)</th>
                  <th className="num">Expected</th>
                  <th className="num">Physical Count</th>
                  <th className="num">Variance</th>
                  <th>Reason</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.map((it) => {
                  const d = it.uom === 'kg' ? 1 : 0;
                  const diff = it.effective_variance;

                  return (
                    <tr key={it.item_code}>
                      <td>
                        <div
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 11.5,
                            color: 'var(--terra)',
                          }}
                        >
                          {it.item_code}
                        </div>
                        <b>{it.name}</b>
                        <div className="meta">{it.uom}</div>
                      </td>
                      <td className="num">{it.opening_qty.toFixed(d)}</td>
                      <td className="num">{it.received_qty.toFixed(d)}</td>
                      <td className="num">{it.issued_qty.toFixed(d)}</td>
                      <td className="num">
                        <b>{it.expected_qty.toFixed(d)}</b>
                      </td>
                      <td className="num">
                        {canCountAndSubmit && !isSigned ? (
                          <input
                            className="in num"
                            style={{
                              width: 84,
                              margin: 0,
                              display: 'inline-block',
                            }}
                            type="number"
                            step={it.uom === 'kg' ? 0.1 : 1}
                            min="0"
                            id={`cnt-${it.item_code}`}
                            value={it.counted_input}
                            onChange={(e) =>
                              handleCountChange(it.item_code, e.target.value)
                            }
                            aria-label={`Counted quantity for ${it.name}`}
                          />
                        ) : (
                          <b>{it.counted_num.toFixed(d)}</b>
                        )}
                      </td>
                      <td
                        className={`num ${
                          diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''
                        }`}
                      >
                        <b>
                          {diff === 0
                            ? '0'
                            : (diff > 0 ? '+' : '−') +
                              Math.abs(diff).toFixed(d)}
                        </b>
                      </td>
                      <td style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                        {it.variance_reason || '—'}
                      </td>
                      <td>
                        {it.row_state === 'ok' && (
                          <Badge variant="ok">BALANCED</Badge>
                        )}
                        {it.row_state === 'fixed' && (
                          <Badge variant="ok">RESOLVED BY RECOUNT</Badge>
                        )}
                        {it.row_state === 'var' && (
                          <Badge variant="er">VARIANCE &middot; RECOUNT</Badge>
                        )}
                        {it.row_state === 'esc' && (
                          <Badge variant="am">HANDLED &middot; ESCALATED</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Inline Discrepancy Forms for Items with Variances */}
            {varianceItems.map((it) => {
              const d = it.uom === 'kg' ? 1 : 0;
              const diff = it.effective_variance;
              const formattedDiff =
                (diff > 0 ? '+' : '−') +
                Math.abs(diff).toFixed(d) +
                ' ' +
                it.uom;

              return (
                <div key={it.item_code} style={{ marginTop: 14 }}>
                  <div className="dash" />
                  <div>
                    <span className="lbl">
                      {it.name}: Difference {formattedDiff}
                    </span>
                    <div
                      style={{
                        display: 'flex',
                        gap: 14,
                        flexWrap: 'wrap',
                        alignItems: 'flex-end',
                        marginTop: 6,
                      }}
                    >
                      <div>
                        <label
                          className="lbl"
                          htmlFor={`rc-${it.item_code}`}
                        >
                          Recount
                        </label>
                        <input
                          id={`rc-${it.item_code}`}
                          className="in num"
                          style={{ width: 100 }}
                          type="number"
                          step={it.uom === 'kg' ? 0.1 : 1}
                          disabled={!canCountAndSubmit || isSigned}
                          placeholder={it.uom}
                          value={it.recount_input}
                          onChange={(e) =>
                            handleRecountChange(it.item_code, e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <label
                          className="lbl"
                          htmlFor={`ca-${it.item_code}`}
                        >
                          Cause Code / Reason
                        </label>
                        <select
                          id={`ca-${it.item_code}`}
                          className="in"
                          style={{ width: 230 }}
                          disabled={!canCountAndSubmit || isSigned}
                          value={it.variance_reason}
                          onChange={(e) =>
                            handleCauseChange(it.item_code, e.target.value)
                          }
                        >
                          {CAUSE_CODES.map((c) => (
                            <option
                              key={c}
                              value={c === 'Select cause' ? '' : c}
                            >
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          className="lbl"
                          htmlFor={`resp-${it.item_code}`}
                        >
                          Responsible Person
                        </label>
                        <input
                          id={`resp-${it.item_code}`}
                          className="in"
                          style={{ width: 180 }}
                          disabled={!canCountAndSubmit || isSigned}
                          placeholder="e.g. Kitchen Lead"
                          value={it.responsible_person}
                          onChange={(e) =>
                            handleResponsibleChange(
                              it.item_code,
                              e.target.value
                            )
                          }
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <label
                          className="lbl"
                          htmlFor={`no-${it.item_code}`}
                        >
                          Investigation Note
                        </label>
                        <input
                          id={`no-${it.item_code}`}
                          className="in"
                          disabled={!canCountAndSubmit || isSigned}
                          placeholder="What was checked"
                          value={it.investigation_note}
                          onChange={(e) =>
                            handleNoteChange(it.item_code, e.target.value)
                          }
                        />
                      </div>
                    </div>

                    <p className="gloss" style={{ margin: '8px 0 0' }}>
                      Recount first. If the recount matches expected (
                      {it.expected_qty.toFixed(d)} {it.uom}), the variance
                      clears. If still different, select a cause code and record
                      the responsible person.
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Evening Close Fallback Checkbox */}
            {hasAnyVariance && !isSigned && (
              <div
                style={{
                  marginTop: 18,
                  padding: '12px 16px',
                  background: 'var(--sand)',
                  border: '1px solid var(--rule)',
                  borderRadius: 4,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isUnexplained}
                    disabled={isSigned}
                    onChange={(e) => setIsUnexplained(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: 'var(--navy)',
                    }}
                  >
                    Sign as unexplained evening close (is_unexplained = true)
                  </span>
                </label>
                <p className="gloss" style={{ margin: '6px 0 0 26px' }}>
                  If Finance Lead or Restaurant Manager is unavailable at shift
                  close, check this box. Storeroom doors are secured on time, and
                  unexplained variances are flagged for the 08:00 AM Central
                  Financial Controller morning review.
                </p>
              </div>
            )}

            <div className="dash" />

            {/* Status Feedback Note */}
            {isSigned ? (
              <div className="note ok">
                <b>
                  Signed off by {signedByRole || 'Custodian'} at{' '}
                  {signedAt || '10:15'}.
                </b>{' '}
                The sheet is locked and archived.
              </div>
            ) : isSubmitted ? (
              <div className="note am">
                <b>Daily balance submitted.</b> Sheet is pending sign-off.{' '}
                {canSign
                  ? 'Your role has sign-off authority.'
                  : 'Waiting for Finance Lead or Restaurant Manager review.'}
              </div>
            ) : isAllBalanced ? (
              <div className="note ok">
                All differences are zero or handled. Sign-off is available.
              </div>
            ) : isUnexplained ? (
              <div className="note am">
                <b>Unexplained evening close active.</b> Custodian may submit the
                sheet. Discrepancies will escalate to Central Financial
                Controller at 08:00 AM.
              </div>
            ) : (
              <div className="note er">
                <b>Sign-off locked.</b> {openUnresolvedCount} item
                {openUnresolvedCount > 1 ? 's have' : ' has'} an unresolved
                difference. Recount and document the cause first, or check
                unexplained evening close.
              </div>
            )}
          </Ticket>
        </div>

        {/* Right Sidebar */}
        <aside className="stack">
          {/* Sheet Metadata Stub */}
          <div className="stub w">
            <span className="lbl">Sheet</span>
            <table className="tick">
              <tbody>
                <tr>
                  <td>Day</td>
                  <td>01 Nov 2026</td>
                </tr>
                <tr>
                  <td>Room</td>
                  <td>{activeStoreroom.id}</td>
                </tr>
                <tr>
                  <td>Floor</td>
                  <td>{activeStoreroom.floor}</td>
                </tr>
                <tr>
                  <td>Counted by</td>
                  <td>{roleConfig.l}</td>
                </tr>
                <tr>
                  <td>Items</td>
                  <td>{totalItemCount}</td>
                </tr>
                <tr>
                  <td>Balanced</td>
                  <td>
                    <b>
                      {balancedItemCount} of {totalItemCount}
                    </b>
                  </td>
                </tr>
                <tr>
                  <td>State</td>
                  <td>
                    {isSigned ? (
                      <Badge variant="ok">LOCKED</Badge>
                    ) : isAllBalanced ? (
                      <Badge variant="ok">BALANCED</Badge>
                    ) : (
                      <Badge variant="am">VARIANCE</Badge>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Escalation or Difference Guide Stub */}
          {hasAnyVariance ? (
            <div className="note am">
              <b>Escalation.</b> Alert raised to Finance Lead and Restaurant
              Manager for {varianceItems.map((i) => i.name).join(', ')}. If
              still open tomorrow, it is included in the next-morning
              escalation digest to the Central Financial Controller (08:00 AM).
            </div>
          ) : (
            <div className="stub">
              <span className="lbl">If a difference remains</span>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Recount, document the cause and responsible person, alert
                Finance Lead and Restaurant Manager. Unresolved items go to the
                central Financial Controller next morning.
              </p>
            </div>
          )}

          {/* Governance Card */}
          <div className="stub">
            <span className="lbl">Who can do what</span>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Custodian and Warehouse Keeper count and submit. Restaurant Manager
              and Financial Controller review and sign off. Direct manual stock
              edits are prohibited; discrepancies go through Approvals.
            </p>
          </div>

          {/* Sign-off Notes Box (when submitted or signing) */}
          {isSubmitted && !isSigned && canSign && (
            <div className="stub w">
              <span className="lbl">Sign-off Review Notes</span>
              <textarea
                className="in"
                rows={3}
                placeholder="Optional sign-off observations or verification notes"
                value={signoffNotes}
                onChange={(e) => setSignoffNotes(e.target.value)}
              />
              <button
                className="btn sm"
                style={{ marginTop: 10, width: '100%' }}
                onClick={handleSignOffBalance}
                disabled={isSigning}
              >
                {isSigning ? 'Signing...' : 'Confirm Sign-Off'}
              </button>
            </div>
          )}

          {/* Prototype Reset Tool */}
          <div className="stub" style={{ textAlign: 'center' }}>
            <span className="lbl">Testing &amp; Reset</span>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
              }}
            >
              <button
                type="button"
                className="btn ghost sm"
                onClick={handleResetSession}
              >
                Reset Sample Session
              </button>
            </div>
          </div>

          {/* Recent Daily Balance Register */}
          <div className="stub w">
            <span className="lbl">Recent Closings</span>
            {history.length === 0 ? (
              <p className="gloss" style={{ margin: 0 }}>
                No prior closings found for {store}.
              </p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  marginTop: 6,
                }}
              >
                {history.slice(0, 3).map((rec) => (
                  <div
                    key={rec.balance_id}
                    style={{
                      borderBottom: '1px dotted var(--rule)',
                      paddingBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                      }}
                    >
                      <b style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {rec.balance_date}
                      </b>
                      <Badge
                        variant={rec.status === 'BALANCED' ? 'ok' : 'am'}
                      >
                        {rec.status}
                      </Badge>
                    </div>
                    <div
                      className="meta"
                      style={{
                        fontSize: 11.5,
                        marginTop: 2,
                        color: 'var(--ink-2)',
                      }}
                    >
                      {rec.warehouse_id} &middot;{' '}
                      {rec.signed_off_at ? 'Signed' : 'Unsigned'}{' '}
                      {rec.is_unexplained ? '&middot; Evening close' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
