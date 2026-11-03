'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  dispatchTransfer,
  receiveTransfer,
  approveTransferVariance,
  rejectTransferVariance,
  getActiveTransfers,
  TransferRecord,
  TransferStatus,
  TRANSFER_ITEMS,
  TRANSFER_WAREHOUSES,
  TRANSFER_STORES,
  getItemMeta,
  isDualUnitRequired,
} from '@/lib/data/transfers';

type TabType = 'dispatch' | 'receive' | 'variance' | 'all';

export default function TransfersPage() {
  const { role, roleConfig, store, setRole, showToast } = useShell();

  // Active top-level tab
  const [activeTab, setActiveTab] = useState<TabType>('dispatch');

  // Transfers data
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Tab 1: Dispatch Inter-Store Transfer form state
  const [destStoreId, setDestStoreId] = useState<string>(() => {
    return store === 'IND-DEL-01' ? 'IND-DEL-02' : 'IND-DEL-01';
  });
  const [selectedItemCode, setSelectedItemCode] = useState<string>('RM-MOZ-01');
  const [sourceWhId, setSourceWhId] = useState<string>('WH-DEL01-COLD');
  const [targetWhId, setTargetWhId] = useState<string>('WH-DEL02-COLD');
  const [qtyKgInput, setQtyKgInput] = useState<string>('12.5');
  const [qtyPcsInput, setQtyPcsInput] = useState<string>('5');
  const [sealNoInput, setSealNoInput] = useState<string>('SEAL-DL01-7721');
  const [dispatchNotes, setDispatchNotes] = useState<string>('');

  // Tab 2: Inbound Receipt at Destination state
  const [selectedInboundId, setSelectedInboundId] = useState<string | null>(null);
  const [inboundTabFilter, setInboundTabFilter] = useState<'pending' | 'history'>('pending');
  const [receiveKgInput, setReceiveKgInput] = useState<string>('');
  const [receivePcsInput, setReceivePcsInput] = useState<string>('');
  const [sealVerified, setSealVerified] = useState<boolean>(true);
  const [simulateAlternateReceiver, setSimulateAlternateReceiver] = useState<boolean>(false);

  // Tab 3: Variance Approval (FC only) state
  const [selectedVarianceId, setSelectedVarianceId] = useState<string | null>(null);
  const [fcApprovalNotes, setFcApprovalNotes] = useState<string>('');

  // Keep target store distinct from source store when store changes
  useEffect(() => {
    if (destStoreId === store) {
      const alt = TRANSFER_STORES.find((s) => s.storeId !== store);
      if (alt) setDestStoreId(alt.storeId);
    }
  }, [store, destStoreId]);

  // Sync storerooms when item or stores change
  const selectedItemMeta = useMemo(() => getItemMeta(selectedItemCode), [selectedItemCode]);
  const dualUnitActive = useMemo(() => isDualUnitRequired(selectedItemCode), [selectedItemCode]);

  useEffect(() => {
    const requiredType = selectedItemMeta?.default_warehouse_type || 'COLD_ROOM';

    const defaultSourceWh =
      TRANSFER_WAREHOUSES.find(
        (w) => w.storeId === store && w.storageType === requiredType
      )?.warehouseId ||
      TRANSFER_WAREHOUSES.find((w) => w.storeId === store)?.warehouseId ||
      '';

    const defaultTargetWh =
      TRANSFER_WAREHOUSES.find(
        (w) => w.storeId === destStoreId && w.storageType === requiredType
      )?.warehouseId ||
      TRANSFER_WAREHOUSES.find((w) => w.storeId === destStoreId)?.warehouseId ||
      '';

    setSourceWhId(defaultSourceWh);
    setTargetWhId(defaultTargetWh);
  }, [store, destStoreId, selectedItemMeta]);

  // Load transfers for active store / role scope
  const refreshTransfers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getActiveTransfers(role === 'fc' ? 'ALL' : store);
      setTransfers(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Failed to load transfer records: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [role, store]);

  useEffect(() => {
    refreshTransfers();
  }, [refreshTransfers]);

  // Filter transfers for Tab 2 (Inbound shipments targeted to CURRENT store)
  const inboundTransfers = useMemo(() => {
    return transfers.filter((t) => t.target_store_id === store);
  }, [transfers, store]);

  const pendingInbound = useMemo(() => {
    return inboundTransfers.filter((t) => t.status === 'IN_TRANSIT');
  }, [inboundTransfers]);

  const historyInbound = useMemo(() => {
    return inboundTransfers.filter((t) => t.status !== 'IN_TRANSIT');
  }, [inboundTransfers]);

  // Selected inbound shipment
  const activeInbound = useMemo(() => {
    const list = inboundTabFilter === 'pending' ? pendingInbound : historyInbound;
    if (selectedInboundId) {
      const found = list.find((t) => t.transfer_id === selectedInboundId);
      if (found) return found;
    }
    return list[0] || null;
  }, [inboundTabFilter, pendingInbound, historyInbound, selectedInboundId]);

  // Reset receive inputs when active inbound selection changes
  useEffect(() => {
    if (activeInbound && activeInbound.status === 'IN_TRANSIT') {
      setReceiveKgInput(String(activeInbound.dispatch_qty_kg));
      setReceivePcsInput(
        activeInbound.dispatch_qty_pcs != null ? String(activeInbound.dispatch_qty_pcs) : ''
      );
      setSealVerified(true);
    } else if (activeInbound) {
      setReceiveKgInput(
        activeInbound.receive_qty_kg != null ? String(activeInbound.receive_qty_kg) : ''
      );
      setReceivePcsInput(
        activeInbound.receive_qty_pcs != null ? String(activeInbound.receive_qty_pcs) : ''
      );
    }
  }, [activeInbound]);

  // Filter transfers for Tab 3 (Transit discrepancies awaiting FC review)
  const varianceClaims = useMemo(() => {
    return transfers.filter((t) => t.status === 'VARIANCE_PENDING_FC');
  }, [transfers]);

  const activeVariance = useMemo(() => {
    if (selectedVarianceId) {
      const found = varianceClaims.find((t) => t.transfer_id === selectedVarianceId);
      if (found) return found;
    }
    return varianceClaims[0] || null;
  }, [varianceClaims, selectedVarianceId]);

  // Counts for tabs badges
  const pendingInboundCount = pendingInbound.length;
  const varianceClaimsCount = varianceClaims.length;

  // Active user resolver for segregation of duties
  const effectiveUserId = useMemo(() => {
    if (simulateAlternateReceiver) {
      return 'usr-receiver-alt-02';
    }
    if (role === 'keeper') return 'usr-admin-01';
    if (role === 'rm') return 'usr-rm-01';
    if (role === 'fc') return 'usr-approver-01';
    if (role === 'admin') return 'usr-sysadmin-01';
    return 'usr-current-session';
  }, [role, simulateAlternateReceiver]);

  // Segregation of duties violation checks
  const isDispatcherSelfReceiving = useMemo(() => {
    if (!activeInbound) return false;
    return activeInbound.dispatcher_user_id === effectiveUserId;
  }, [activeInbound, effectiveUserId]);

  const isDispatcherSelfApproving = useMemo(() => {
    if (!activeVariance) return false;
    return activeVariance.dispatcher_user_id === effectiveUserId;
  }, [activeVariance, effectiveUserId]);

  // Status badge styling helper
  const renderStatusBadge = (st: TransferStatus) => {
    switch (st) {
      case 'IN_TRANSIT':
        return <Badge variant="am">IN TRANSIT</Badge>;
      case 'RECEIVED_MATCH':
        return <Badge variant="ok">RECEIVED &middot; MATCH</Badge>;
      case 'VARIANCE_PENDING_FC':
        return <Badge variant="ur">VARIANCE &middot; PENDING FC</Badge>;
      case 'RECEIVED_VARIANCE_APPROVED':
        return <Badge variant="ok">VARIANCE APPROVED</Badge>;
      case 'REJECTED':
        return <Badge variant="er">REJECTED</Badge>;
      default:
        return <Badge variant="mu">{st}</Badge>;
    }
  };

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  // Tab 1: Dispatch Transfer
  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);

    const kg = parseFloat(qtyKgInput);
    const pcs = qtyPcsInput.trim() !== '' ? parseFloat(qtyPcsInput) : null;

    if (isNaN(kg) || kg <= 0) {
      setActionError('Dispatch weight (kg) must be a positive number.');
      return;
    }

    if (dualUnitActive && (pcs === null || isNaN(pcs) || pcs <= 0)) {
      setActionError(
        'Dual-Unit Rule Active: Cheese and meat items strictly require a positive piece count (pcs).'
      );
      return;
    }

    if (!sealNoInput.trim()) {
      setActionError('Vehicle seal number is mandatory before vehicle departure.');
      return;
    }

    if (store === destStoreId) {
      setActionError('Source store cannot be identical to destination store.');
      return;
    }

    setIsSubmitting(true);

    const result = await dispatchAction<string>({
      actionName: 'DISPATCH_INTERSTORE_TRANSFER',
      storeId: store,
      payload: {
        sourceStoreId: store,
        sourceWhId,
        targetStoreId: destStoreId,
        targetWhId,
        itemCode: selectedItemCode,
        qtyKg: kg,
        qtyPcs: pcs,
        sealNo: sealNoInput.trim(),
      },
      execute: async () => {
        return await dispatchTransfer(
          store,
          sourceWhId,
          destStoreId,
          targetWhId,
          selectedItemCode,
          kg,
          pcs,
          sealNoInput.trim()
        );
      },
      onSuccess: (transferId) => {
        showToast(
          `Transfer ${transferId} dispatched. Appended TRANSFER_OUT_INTRANSIT (-${kg} kg) to ledger.`
        );
        // Reset form inputs
        setQtyKgInput('10.0');
        setQtyPcsInput(dualUnitActive ? '4' : '');
        setSealNoInput(`SEAL-DL-${Math.floor(1000 + Math.random() * 9000)}`);
        setDispatchNotes('');
        refreshTransfers();
      },
      onError: (err) => {
        setActionError(err.message || 'Failed to dispatch transfer.');
      },
    });

    setIsSubmitting(false);
    if (!result.success && result.error) {
      setActionError(result.error);
    }
  };

  // Tab 2: Confirm Inbound Receipt
  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInbound) return;
    setActionError(null);

    if (isDispatcherSelfReceiving) {
      setActionError(
        'Segregation of duties violation: Transfer dispatcher cannot receive their own transfer.'
      );
      return;
    }

    if (!sealVerified) {
      setActionError('Vehicle tamper seal must be physically inspected and verified intact.');
      return;
    }

    const rKg = parseFloat(receiveKgInput);
    const rPcs = receivePcsInput.trim() !== '' ? parseFloat(receivePcsInput) : null;

    if (isNaN(rKg) || rKg < 0) {
      setActionError('Received weight (kg) must be zero or a positive number.');
      return;
    }

    if (activeInbound.dispatch_qty_pcs != null && (rPcs === null || isNaN(rPcs) || rPcs < 0)) {
      setActionError(
        'Dual-Unit Rule Active: Physical piece count must be recorded for this dual-unit item.'
      );
      return;
    }

    setIsSubmitting(true);

    const isMatch =
      rKg === activeInbound.dispatch_qty_kg &&
      (activeInbound.dispatch_qty_pcs == null || rPcs === activeInbound.dispatch_qty_pcs);

    const result = await dispatchAction<void>({
      actionName: 'RECEIVE_INTERSTORE_TRANSFER',
      storeId: store,
      payload: {
        transferId: activeInbound.transfer_id,
        receiveQtyKg: rKg,
        receiveQtyPcs: rPcs,
      },
      execute: async () => {
        await receiveTransfer(activeInbound.transfer_id, rKg, rPcs);
      },
      onSuccess: () => {
        if (isMatch) {
          showToast(
            `Receipt confirmed. Perfect match! Appended TRANSFER_IN_RECEIVED (+${rKg} kg) to ledger.`
          );
        } else {
          const diff = Number((rKg - activeInbound.dispatch_qty_kg).toFixed(3));
          showToast(
            `Discrepancy logged (${diff > 0 ? '+' : ''}${diff} kg). Routed to VARIANCE_PENDING_FC.`
          );
        }
        refreshTransfers();
      },
      onError: (err) => {
        setActionError(err.message || 'Failed to record inbound receipt.');
      },
    });

    setIsSubmitting(false);
    if (!result.success && result.error) {
      setActionError(result.error);
    }
  };

  // Tab 3: Approve Variance (FC)
  const handleApproveVariance = async () => {
    if (!activeVariance) return;
    setActionError(null);

    if (role !== 'fc' && role !== 'admin') {
      setActionError('Restricted Access: Only Financial Controller (FC) or System Admin can approve transfer variances.');
      return;
    }

    if (isDispatcherSelfApproving) {
      setActionError('Segregation of duties violation: Transfer dispatcher cannot approve their own transfer variance.');
      return;
    }

    setIsSubmitting(true);

    const result = await dispatchAction<void>({
      actionName: 'APPROVE_TRANSFER_VARIANCE',
      storeId: activeVariance.target_store_id,
      payload: {
        transferId: activeVariance.transfer_id,
        notes: fcApprovalNotes,
      },
      execute: async () => {
        await approveTransferVariance(activeVariance.transfer_id, fcApprovalNotes);
      },
      onSuccess: () => {
        showToast(
          `Variance approved by FC. Appended TRANSFER_IN_RECEIVED (+${activeVariance.receive_qty_kg} kg) to destination ledger.`
        );
        setFcApprovalNotes('');
        refreshTransfers();
      },
      onError: (err) => {
        setActionError(err.message || 'Failed to approve variance.');
      },
    });

    setIsSubmitting(false);
    if (!result.success && result.error) {
      setActionError(result.error);
    }
  };

  // Tab 3: Reject Variance (FC)
  const handleRejectVariance = async () => {
    if (!activeVariance) return;
    setActionError(null);

    if (role !== 'fc' && role !== 'admin') {
      setActionError('Restricted Access: Only Financial Controller (FC) or System Admin can reject transfer variances.');
      return;
    }

    setIsSubmitting(true);

    const result = await dispatchAction<void>({
      actionName: 'REJECT_TRANSFER_VARIANCE',
      storeId: activeVariance.target_store_id,
      payload: {
        transferId: activeVariance.transfer_id,
        notes: fcApprovalNotes,
      },
      execute: async () => {
        await rejectTransferVariance(activeVariance.transfer_id, fcApprovalNotes);
      },
      onSuccess: () => {
        showToast(`Variance rejected by FC. Discrepancy closed with status REJECTED.`);
        setFcApprovalNotes('');
        refreshTransfers();
      },
      onError: (err) => {
        setActionError(err.message || 'Failed to reject variance.');
      },
    });

    setIsSubmitting(false);
    if (!result.success && result.error) {
      setActionError(result.error);
    }
  };

  return (
    <>
      {/* Page Header */}
      <div className="head">
        <div>
          <div className="kicker">FLOW G &middot; INTER-STORE TRANSIT CUSTODY</div>
          <h1 className="h1">
            INTER-STORE TRANSFERS <em>&amp; seal custody</em>
          </h1>
          <div className="sub">
            Strict physical stock movements between branches under tamper-evident vehicle seal. Dual-unit accounting in kilograms and piece counts eliminates cutting shrinkage ambiguity. Discrepancies escalate to Financial Controller.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="lbl" style={{ marginBottom: 4 }}>
            ACTIVE BRANCH
          </div>
          <b style={{ fontFamily: 'var(--disp)', fontSize: 18, color: 'var(--navy)' }}>
            {STORE_NAMES[store] || store}
          </b>
        </div>
      </div>

      {/* Main Tab Controls */}
      <Chips style={{ marginBottom: 20 }}>
        <Chip
          label="1. Dispatch Transfer"
          active={activeTab === 'dispatch'}
          onClick={() => {
            setActiveTab('dispatch');
            setActionError(null);
          }}
        />
        <Chip
          label="2. Inbound Receipt at Destination"
          count={pendingInboundCount > 0 ? pendingInboundCount : undefined}
          active={activeTab === 'receive'}
          onClick={() => {
            setActiveTab('receive');
            setActionError(null);
          }}
        />
        <Chip
          label="3. Variance Approval (FC)"
          count={varianceClaimsCount > 0 ? varianceClaimsCount : undefined}
          active={activeTab === 'variance'}
          onClick={() => {
            setActiveTab('variance');
            setActionError(null);
          }}
        />
        <Chip
          label="Transfer Audit Ledger"
          count={transfers.length}
          active={activeTab === 'all'}
          onClick={() => {
            setActiveTab('all');
            setActionError(null);
          }}
        />
      </Chips>

      {/* Global Action Error Banner */}
      {actionError && (
        <div
          className="note er"
          style={{
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <b>Operational Warning:</b> {actionError}
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setActionError(null)}
            style={{ padding: '2px 8px', fontSize: 11 }}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* =========================================================================
          TAB 1: DISPATCH INTER-STORE TRANSFER
         ========================================================================= */}
      {activeTab === 'dispatch' && (
        <div className="cols" style={{ gridTemplateColumns: '1fr 400px' }}>
          {/* Dispatch Form Card */}
          <div className="stub w" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <span className="lbl">OUTBOUND DISPATCH CONSOLE</span>
                <h3 className="h3" style={{ marginTop: 2 }}>
                  Create Inter-Store Transfer
                </h3>
              </div>
              <Badge variant="re">OUTBOUND CUSTODY</Badge>
            </div>

            <form onSubmit={handleDispatch}>
              {/* Route: Source -> Destination */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label className="lbl" htmlFor="sourceStoreSelect">
                    Sending Store (Current)
                  </label>
                  <input
                    id="sourceStoreSelect"
                    className="in"
                    type="text"
                    value={`${STORE_NAMES[store] || store} (${store})`}
                    disabled
                    style={{ background: 'var(--sand)', cursor: 'not-allowed', fontWeight: 600 }}
                  />
                  <div className="gloss" style={{ marginTop: 4 }}>
                    Active branch session scope
                  </div>
                </div>

                <div>
                  <label className="lbl" htmlFor="targetStoreSelect">
                    Destination Store *
                  </label>
                  <select
                    id="targetStoreSelect"
                    className="in"
                    value={destStoreId}
                    onChange={(e) => setDestStoreId(e.target.value)}
                    required
                  >
                    {TRANSFER_STORES.map((s) => (
                      <option key={s.storeId} value={s.storeId} disabled={s.storeId === store}>
                        {s.name} ({s.storeId}) {s.storeId === store ? '— [Source Branch]' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="gloss" style={{ marginTop: 4 }}>
                    Must cross branch boundary (chk_transfer_different_stores)
                  </div>
                </div>
              </div>

              {/* Storerooms */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label className="lbl" htmlFor="sourceWhSelect">
                    Source Storeroom *
                  </label>
                  <select
                    id="sourceWhSelect"
                    className="in"
                    value={sourceWhId}
                    onChange={(e) => setSourceWhId(e.target.value)}
                    required
                  >
                    {TRANSFER_WAREHOUSES.filter((w) => w.storeId === store).map((w) => (
                      <option key={w.warehouseId} value={w.warehouseId}>
                        {w.name} ({w.warehouseId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="lbl" htmlFor="targetWhSelect">
                    Destination Storeroom *
                  </label>
                  <select
                    id="targetWhSelect"
                    className="in"
                    value={targetWhId}
                    onChange={(e) => setTargetWhId(e.target.value)}
                    required
                  >
                    {TRANSFER_WAREHOUSES.filter((w) => w.storeId === destStoreId).map((w) => (
                      <option key={w.warehouseId} value={w.warehouseId}>
                        {w.name} ({w.warehouseId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Item Selection */}
              <div className="fld">
                <label className="lbl" htmlFor="itemCodeSelect">
                  Item to Transfer *
                </label>
                <select
                  id="itemCodeSelect"
                  className="in"
                  value={selectedItemCode}
                  onChange={(e) => setSelectedItemCode(e.target.value)}
                  required
                >
                  {TRANSFER_ITEMS.map((it) => (
                    <option key={it.item_code} value={it.item_code}>
                      {it.item_code} &middot; {it.item_name} [{it.category_group}] &middot; Base: {it.base_uom}
                      {it.dual_unit_required ? ' (DUAL-UNIT MANDATORY)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dual-Unit Explanation Callout */}
              {dualUnitActive && (
                <div className="note am" style={{ marginBottom: 16 }}>
                  <b>Dual-Unit Rule Active:</b> {selectedItemMeta?.item_name} is classified under{' '}
                  <b>{selectedItemMeta?.category_group}</b>. Both weight in kilograms (kg) and piece count (pcs) are mandatory upon departure and arrival to eliminate cutting and moisture shrinkage ambiguity during transit.
                </div>
              )}

              {/* Quantities (Dual-Unit kg + pcs) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label className="lbl" htmlFor="qtyKgInput">
                    Dispatched Weight (kg) *
                  </label>
                  <input
                    id="qtyKgInput"
                    className="in num"
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={qtyKgInput}
                    onChange={(e) => setQtyKgInput(e.target.value)}
                    placeholder="e.g. 15.000"
                    required
                  />
                  <div className="gloss" style={{ marginTop: 4 }}>
                    Dispatched weight in kilograms (&gt; 0)
                  </div>
                </div>

                <div>
                  <label className="lbl" htmlFor="qtyPcsInput">
                    Dispatched Pieces (pcs) {dualUnitActive ? '*' : '(Optional)'}
                  </label>
                  <input
                    id="qtyPcsInput"
                    className={`in num ${dualUnitActive && (!qtyPcsInput || parseFloat(qtyPcsInput) <= 0) ? 'err' : ''}`}
                    type="number"
                    step="1"
                    min={dualUnitActive ? '1' : '0'}
                    value={qtyPcsInput}
                    onChange={(e) => setQtyPcsInput(e.target.value)}
                    placeholder={dualUnitActive ? 'Mandatory for Cheese/Meat' : 'Optional unit count'}
                    required={dualUnitActive}
                  />
                  <div className="gloss" style={{ marginTop: 4 }}>
                    {dualUnitActive
                      ? 'Mandatory piece count for cutting validation'
                      : 'Optional unit piece count'}
                  </div>
                </div>
              </div>

              {/* Vehicle Seal Number */}
              <div className="fld">
                <label className="lbl" htmlFor="sealNoInput">
                  Vehicle Tamper-Evident Seal Number *
                </label>
                <input
                  id="sealNoInput"
                  className="in"
                  type="text"
                  value={sealNoInput}
                  onChange={(e) => setSealNoInput(e.target.value)}
                  placeholder="e.g. SEAL-DL01-9812"
                  required
                />
                <div className="gloss" style={{ marginTop: 4 }}>
                  Mandatory vehicle transit lock seal identifier. Recorded on manifest and inspected at receiving dock.
                </div>
              </div>

              {/* Dispatch Notes */}
              <div className="fld">
                <label className="lbl" htmlFor="dispatchNotes">
                  Dispatch Manifest Remarks
                </label>
                <input
                  id="dispatchNotes"
                  className="in"
                  type="text"
                  value={dispatchNotes}
                  onChange={(e) => setDispatchNotes(e.target.value)}
                  placeholder="e.g. Packed in insulated transit tote with fresh ice packs."
                />
              </div>

              {/* Ledger Notice */}
              <div className="note" style={{ marginBottom: 20 }}>
                <b>Immutable Ledger Action:</b> Submitting dispatches transfer in status{' '}
                <code>IN_TRANSIT</code> and appends <code>TRANSFER_OUT_INTRANSIT</code> (
                <span className="neg">-{parseFloat(qtyKgInput) || 0} kg</span>) at source warehouse{' '}
                <code>{sourceWhId}</code>.
              </div>

              <button
                type="submit"
                className="btn"
                disabled={isSubmitting || store === destStoreId}
                style={{ width: '100%' }}
              >
                {isSubmitting ? 'DISPATCHING...' : 'CONFIRM DISPATCH & LOCK VEHICLE SEAL'}
              </button>
            </form>
          </div>

          {/* Waybill / Dispatch Preview Ticket */}
          <div>
            <Ticket no="TRF-DISPATCH-PREVIEW" right={<Badge variant="am">IN TRANSIT</Badge>}>
              <div className="lbl" style={{ marginBottom: 6 }}>
                WAYBILL SUMMARY
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--navy)', marginBottom: 12 }}>
                {STORE_NAMES[store]} &rarr; {STORE_NAMES[destStoreId] || destStoreId}
              </div>

              <div className="dash" />

              <table style={{ marginBottom: 16 }}>
                <tbody>
                  <tr>
                    <td className="m">Item Code</td>
                    <td style={{ fontWeight: 600 }}>{selectedItemCode}</td>
                  </tr>
                  <tr>
                    <td className="m">Item Description</td>
                    <td>{selectedItemMeta?.item_name}</td>
                  </tr>
                  <tr>
                    <td className="m">Category</td>
                    <td>
                      <Badge variant="mu">{selectedItemMeta?.category_group || 'GENERAL'}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="m">Dispatched Weight</td>
                    <td className="num neg">
                      <b>-{parseFloat(qtyKgInput) || 0} kg</b>
                    </td>
                  </tr>
                  <tr>
                    <td className="m">Dispatched Count</td>
                    <td className="num">
                      {qtyPcsInput ? `${parseFloat(qtyPcsInput)} pcs` : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="m">Tamper Seal</td>
                    <td className="m" style={{ color: 'var(--terra)', fontWeight: 600 }}>
                      {sealNoInput || '[UNSEALED]'}
                    </td>
                  </tr>
                  <tr>
                    <td className="m">Outbound Ledger</td>
                    <td style={{ fontSize: 12 }}>
                      <code>TRANSFER_OUT_INTRANSIT</code>
                    </td>
                  </tr>
                  <tr>
                    <td className="m">Dispatcher Staff</td>
                    <td style={{ fontSize: 12 }}>{roleConfig.l} ({effectiveUserId})</td>
                  </tr>
                </tbody>
              </table>

              <div className="stub" style={{ fontSize: 12, lineHeight: 1.45, background: 'var(--sand)' }}>
                <b>Segregation of Duties Notice:</b>
                <div style={{ marginTop: 4, color: 'var(--ink-2)' }}>
                  Once dispatched, database constraint <code>chk_transfer_distinct_users</code> prevents user{' '}
                  <code>{effectiveUserId}</code> from acting as destination receiver.
                </div>
              </div>
            </Ticket>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: INBOUND RECEIPT AT DESTINATION
         ========================================================================= */}
      {activeTab === 'receive' && (
        <div className="cols" style={{ gridTemplateColumns: '400px 1fr' }}>
          {/* Left Column: Inbound Shipments List */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="lbl">INCOMING TRANSFERS</span>
              <button
                type="button"
                className="btn ghost sm"
                onClick={refreshTransfers}
                disabled={isLoading}
              >
                REFRESH
              </button>
            </div>

            <Chips style={{ marginBottom: 14 }}>
              <Chip
                label="In Transit (Awaiting Receipt)"
                count={pendingInbound.length}
                active={inboundTabFilter === 'pending'}
                onClick={() => setInboundTabFilter('pending')}
              />
              <Chip
                label="Receipt History"
                count={historyInbound.length}
                active={inboundTabFilter === 'history'}
                onClick={() => setInboundTabFilter('history')}
              />
            </Chips>

            {/* List */}
            {inboundTabFilter === 'pending' && pendingInbound.length === 0 && (
              <div className="stub" style={{ textAlign: 'center', padding: '36px 16px' }}>
                <div className="lbl" style={{ marginBottom: 6 }}>
                  NO SHIPMENTS IN TRANSIT
                </div>
                <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No active in-transit shipments currently targeted to {STORE_NAMES[store]}.
                </div>
              </div>
            )}

            {inboundTabFilter === 'history' && historyInbound.length === 0 && (
              <div className="stub" style={{ textAlign: 'center', padding: '36px 16px' }}>
                <div className="lbl">NO COMPLETED INTAKES</div>
                <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 4 }}>
                  No historical receipts recorded yet for {STORE_NAMES[store]}.
                </div>
              </div>
            )}

            <div className="stack">
              {(inboundTabFilter === 'pending' ? pendingInbound : historyInbound).map((t) => {
                const isSelected = activeInbound?.transfer_id === t.transfer_id;
                return (
                  <div
                    key={t.transfer_id}
                    onClick={() => {
                      setSelectedInboundId(t.transfer_id);
                      setActionError(null);
                    }}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedInboundId(t.transfer_id);
                      }
                    }}
                    className={`stub ${isSelected ? 'w' : ''}`}
                    style={{
                      cursor: 'pointer',
                      borderColor: isSelected ? 'var(--navy)' : 'var(--rule)',
                      borderWidth: isSelected ? 2 : 1,
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <b style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--navy)' }}>
                        {t.transfer_id}
                      </b>
                      {renderStatusBadge(t.status)}
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)', marginBottom: 4 }}>
                      {t.item_name || t.item_code}
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>
                      From: <b>{STORE_NAMES[t.source_store_id] || t.source_store_id}</b> &rarr;{' '}
                      {STORE_NAMES[t.target_store_id] || t.target_store_id}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: 'var(--mono)' }}>
                      <span>
                        Dispatched: <b>{t.dispatch_qty_kg} kg</b>
                        {t.dispatch_qty_pcs != null ? ` (${t.dispatch_qty_pcs} pcs)` : ''}
                      </span>
                      <span style={{ color: 'var(--terra)' }}>Seal: {t.vehicle_seal_no}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Physical Intake Verification Ticket & Form */}
          <div>
            {activeInbound ? (
              <Ticket
                no={activeInbound.transfer_id}
                right={renderStatusBadge(activeInbound.status)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <div>
                    <span className="lbl">INBOUND DOCK INTAKE &amp; SEAL VERIFICATION</span>
                    <h3 className="h3" style={{ marginTop: 4 }}>
                      {activeInbound.item_name || activeInbound.item_code}
                    </h3>
                  </div>
                  <Badge variant="mu">{activeInbound.category_group || 'GENERAL'}</Badge>
                </div>

                {/* Transfer Metadata Table */}
                <table style={{ marginBottom: 16 }}>
                  <tbody>
                    <tr>
                      <td className="m">Dispatch Route</td>
                      <td style={{ fontWeight: 600 }}>
                        {STORE_NAMES[activeInbound.source_store_id]} ({activeInbound.source_warehouse_id}) &rarr;{' '}
                        {STORE_NAMES[activeInbound.target_store_id]} ({activeInbound.target_warehouse_id})
                      </td>
                    </tr>
                    <tr>
                      <td className="m">Vehicle Seal Number</td>
                      <td className="m" style={{ color: 'var(--terra)', fontWeight: 600 }}>
                        {activeInbound.vehicle_seal_no}
                      </td>
                    </tr>
                    <tr>
                      <td className="m">Dispatched Quantities</td>
                      <td className="num">
                        <b>{activeInbound.dispatch_qty_kg} kg</b>
                        {activeInbound.dispatch_qty_pcs != null
                          ? ` &middot; ${activeInbound.dispatch_qty_pcs} pcs`
                          : ''}
                      </td>
                    </tr>
                    <tr>
                      <td className="m">Dispatched By</td>
                      <td>
                        {activeInbound.dispatcher_name || activeInbound.dispatcher_user_id} &middot;{' '}
                        <span className="meta">
                          {new Date(activeInbound.dispatched_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </td>
                    </tr>
                    {activeInbound.received_at && (
                      <tr>
                        <td className="m">Received At</td>
                        <td>
                          {new Date(activeInbound.received_at).toLocaleDateString()}{' '}
                          {new Date(activeInbound.received_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    )}
                    {activeInbound.variance_qty != null && (
                      <tr>
                        <td className="m">Recorded Variance</td>
                        <td
                          className={`num ${
                            activeInbound.variance_qty < 0
                              ? 'neg'
                              : activeInbound.variance_qty > 0
                              ? 'pos'
                              : ''
                          }`}
                        >
                          <b>
                            {activeInbound.variance_qty === 0
                              ? '0.000 kg (Exact Match)'
                              : `${activeInbound.variance_qty > 0 ? '+' : ''}${activeInbound.variance_qty} kg`}
                          </b>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Segregation of Duties Banner & Simulation Toggle */}
                {isDispatcherSelfReceiving && activeInbound.status === 'IN_TRANSIT' && (
                  <div className="note er" style={{ marginBottom: 16 }}>
                    <b>Segregation of Duties Enforced (chk_transfer_distinct_users):</b>
                    <div style={{ marginTop: 4 }}>
                      You are logged in as the dispatcher (<code>{activeInbound.dispatcher_user_id}</code>). The user who dispatched the shipment cannot confirm physical receipt at the receiving dock.
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setSimulateAlternateReceiver(true)}
                      >
                        SIMULATE DESTINATION RECEIVING KEEPER (SWITCH USER)
                      </button>
                    </div>
                  </div>
                )}

                {simulateAlternateReceiver && (
                  <div className="note ok" style={{ marginBottom: 16 }}>
                    <b>Active Receiving Staff:</b> Acting as <code>usr-receiver-alt-02</code> (Destination Receiving Keeper). Segregation of duties satisfied.
                  </div>
                )}

                {/* Physical Intake Form for IN_TRANSIT */}
                {activeInbound.status === 'IN_TRANSIT' ? (
                  <form onSubmit={handleReceive} style={{ marginTop: 18 }}>
                    <div className="stub" style={{ background: 'var(--sand)', padding: 16, marginBottom: 16 }}>
                      <div className="lbl" style={{ marginBottom: 8 }}>
                        PHYSICAL COUNT INTAKE &amp; VERIFICATION
                      </div>

                      {/* Seal Verification Checkbox */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={sealVerified}
                          onChange={(e) => setSealVerified(e.target.checked)}
                          required
                        />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          Vehicle tamper-evident seal <b>{activeInbound.vehicle_seal_no}</b> inspected and verified intact upon unsealing.
                        </span>
                      </label>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
                        <div>
                          <label className="lbl" htmlFor="recvKg">
                            Counted Weight (kg) *
                          </label>
                          <input
                            id="recvKg"
                            className="in num"
                            type="number"
                            step="0.001"
                            min="0"
                            value={receiveKgInput}
                            onChange={(e) => setReceiveKgInput(e.target.value)}
                            required
                          />
                        </div>

                        {activeInbound.dispatch_qty_pcs != null ? (
                          <div>
                            <label className="lbl" htmlFor="recvPcs">
                              Counted Pieces (pcs) *
                            </label>
                            <input
                              id="recvPcs"
                              className="in num"
                              type="number"
                              step="1"
                              min="0"
                              value={receivePcsInput}
                              onChange={(e) => setReceivePcsInput(e.target.value)}
                              required
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="lbl" htmlFor="recvPcsOpt">
                              Counted Pieces (pcs)
                            </label>
                            <input
                              id="recvPcsOpt"
                              className="in num"
                              type="number"
                              step="1"
                              min="0"
                              value={receivePcsInput}
                              onChange={(e) => setReceivePcsInput(e.target.value)}
                              placeholder="Not required"
                            />
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => {
                            setReceiveKgInput(String(activeInbound.dispatch_qty_kg));
                            setReceivePcsInput(
                              activeInbound.dispatch_qty_pcs != null
                                ? String(activeInbound.dispatch_qty_pcs)
                                : ''
                            );
                          }}
                        >
                          SET TO DISPATCHED QUANTITIES (MATCH)
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => {
                            const reduced = Math.max(0, activeInbound.dispatch_qty_kg - 0.5);
                            setReceiveKgInput(reduced.toFixed(3));
                          }}
                        >
                          SIMULATE SHORTAGE (-0.500 KG)
                        </button>
                      </div>
                    </div>

                    {/* Discrepancy Real-Time Analysis */}
                    {receiveKgInput !== '' && (
                      <div style={{ marginBottom: 16 }}>
                        {parseFloat(receiveKgInput) === activeInbound.dispatch_qty_kg &&
                        (activeInbound.dispatch_qty_pcs == null ||
                          parseFloat(receivePcsInput) === activeInbound.dispatch_qty_pcs) ? (
                          <div className="note ok">
                            <b>Quantities Match:</b> Counted weight and piece counts match dispatched quantities exactly.
                            <div style={{ marginTop: 4 }}>
                              Submitting will immediately mark shipment <code>RECEIVED_MATCH</code> and append{' '}
                              <code>TRANSFER_IN_RECEIVED</code> (
                              <span className="pos">+{activeInbound.dispatch_qty_kg} kg</span>) to receiving storeroom <code>{activeInbound.target_warehouse_id}</code>.
                            </div>
                          </div>
                        ) : (
                          <div className="note am">
                            <b>Discrepancy Detected (Variance Claim):</b>
                            <div style={{ marginTop: 4 }}>
                              Variance: <b>{(parseFloat(receiveKgInput) - activeInbound.dispatch_qty_kg).toFixed(3)} kg</b>.
                              Because quantities do not match, status will transition to{' '}
                              <code>VARIANCE_PENDING_FC</code>. <b>No stock will be booked into the receiving ledger</b> until the Financial Controller conducts review and approves.
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="btn"
                      disabled={isSubmitting || isDispatcherSelfReceiving || !sealVerified}
                      style={{ width: '100%' }}
                    >
                      {isSubmitting ? 'RECORDING RECEIPT...' : 'CONFIRM INBOUND RECEIPT & SIGN MANIFEST'}
                    </button>
                  </form>
                ) : (
                  <div className="note" style={{ marginTop: 16 }}>
                    <b>Transfer Closed:</b> This shipment has already undergone intake processing with status{' '}
                    <b>{activeInbound.status}</b>.
                    {activeInbound.status === 'VARIANCE_PENDING_FC' && (
                      <div style={{ marginTop: 6 }}>
                        Awaiting Financial Controller adjudication in Tab 3.
                      </div>
                    )}
                  </div>
                )}
              </Ticket>
            ) : (
              <div className="stub" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <span className="lbl">SELECT A SHIPMENT</span>
                <p style={{ color: 'var(--ink-3)', marginTop: 6 }}>
                  Choose an in-transit transfer from the left column to verify seal and record physical receipt.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: VARIANCE APPROVAL (FINANCIAL CONTROLLER ONLY)
         ========================================================================= */}
      {activeTab === 'variance' && (
        <div>
          {/* FC Role Guard Notice */}
          {role !== 'fc' && role !== 'admin' && (
            <div
              className="note am"
              style={{
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <b>Restricted Access:</b> You are viewing as <b>{roleConfig.l}</b>. Inter-store transit variance sign-off is strictly reserved for the <b>Financial Controller (FC)</b> or System Admin.
              </div>
              <button
                type="button"
                className="btn sm"
                onClick={() => setRole('fc')}
                style={{ padding: '4px 12px' }}
              >
                SWITCH ROLE TO FINANCIAL CONTROLLER
              </button>
            </div>
          )}

          <div className="cols" style={{ gridTemplateColumns: '380px 1fr' }}>
            {/* Left Column: Discrepancy Claims List */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="lbl">DISCREPANCY CLAIMS</span>
                <span className="meta">{varianceClaims.length} awaiting FC</span>
              </div>

              {varianceClaims.length === 0 ? (
                <div className="stub" style={{ textAlign: 'center', padding: '40px 16px' }}>
                  <div className="lbl">NO PENDING DISCREPANCIES</div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 4 }}>
                    All in-transit shipments are matched or resolved. Zero variance claims pending FC adjudication.
                  </div>
                </div>
              ) : (
                <div className="stack">
                  {varianceClaims.map((claim) => {
                    const isSelected = activeVariance?.transfer_id === claim.transfer_id;
                    const diff = claim.variance_qty || 0;
                    return (
                      <div
                        key={claim.transfer_id}
                        onClick={() => {
                          setSelectedVarianceId(claim.transfer_id);
                          setActionError(null);
                        }}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedVarianceId(claim.transfer_id);
                          }
                        }}
                        className={`stub ${isSelected ? 'w' : ''}`}
                        style={{
                          cursor: 'pointer',
                          borderColor: isSelected ? 'var(--terra)' : 'var(--rule)',
                          borderWidth: isSelected ? 2 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <b style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--navy)' }}>
                            {claim.transfer_id}
                          </b>
                          <Badge variant="ur">PENDING FC</Badge>
                        </div>

                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)', marginBottom: 4 }}>
                          {claim.item_name || claim.item_code}
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>
                          {STORE_NAMES[claim.source_store_id] || claim.source_store_id} &rarr;{' '}
                          {STORE_NAMES[claim.target_store_id] || claim.target_store_id}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: 'var(--mono)' }}>
                          <span>
                            Disp: <b>{claim.dispatch_qty_kg} kg</b>
                          </span>
                          <span className={diff < 0 ? 'neg' : 'pos'} style={{ fontWeight: 600 }}>
                            Variance: {diff > 0 ? '+' : ''}
                            {diff} kg
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: FC Adjudication Dossier */}
            <div>
              {activeVariance ? (
                <Ticket
                  no={activeVariance.transfer_id}
                  right={<Badge variant="ur">VARIANCE PENDING FC</Badge>}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                    <div>
                      <span className="lbl">FINANCIAL CONTROLLER DISCREPANCY AUDIT</span>
                      <h3 className="h3" style={{ marginTop: 4 }}>
                        {activeVariance.item_name || activeVariance.item_code}
                      </h3>
                    </div>
                    <Badge variant="mu">{activeVariance.category_group || 'GENERAL'}</Badge>
                  </div>

                  {/* Segregation of duties guard */}
                  {isDispatcherSelfApproving && (
                    <div className="note er" style={{ marginBottom: 16 }}>
                      <b>Segregation of Duties Enforced (chk_transfer_distinct_fc):</b>
                      <div style={{ marginTop: 4 }}>
                        You dispatched this transfer (<code>{activeVariance.dispatcher_user_id}</code>). The transfer dispatcher cannot approve their own transit variance.
                      </div>
                    </div>
                  )}

                  {/* Comparison Breakdown Table */}
                  <table style={{ marginBottom: 16 }}>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th className="num">Dispatched (Origin)</th>
                        <th className="num">Counted (Destination)</th>
                        <th className="num">Discrepancy (Delta)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <b>Weight (kg)</b>
                        </td>
                        <td className="num">{activeVariance.dispatch_qty_kg} kg</td>
                        <td className="num">{activeVariance.receive_qty_kg} kg</td>
                        <td
                          className={`num ${
                            (activeVariance.variance_qty || 0) < 0
                              ? 'neg'
                              : (activeVariance.variance_qty || 0) > 0
                              ? 'pos'
                              : ''
                          }`}
                        >
                          <b>
                            {(activeVariance.variance_qty || 0) > 0 ? '+' : ''}
                            {activeVariance.variance_qty} kg
                          </b>
                        </td>
                      </tr>
                      {activeVariance.dispatch_qty_pcs != null && (
                        <tr>
                          <td>
                            <b>Piece Count (pcs)</b>
                          </td>
                          <td className="num">{activeVariance.dispatch_qty_pcs} pcs</td>
                          <td className="num">{activeVariance.receive_qty_pcs ?? '—'} pcs</td>
                          <td className="num">
                            {activeVariance.receive_qty_pcs != null
                              ? `${
                                  activeVariance.receive_qty_pcs - activeVariance.dispatch_qty_pcs > 0
                                    ? '+'
                                    : ''
                                }${activeVariance.receive_qty_pcs - activeVariance.dispatch_qty_pcs} pcs`
                              : '—'}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="m">Vehicle Seal Number</td>
                        <td colSpan={3} className="m" style={{ color: 'var(--terra)', fontWeight: 600 }}>
                          {activeVariance.vehicle_seal_no}
                        </td>
                      </tr>
                      <tr>
                        <td className="m">Origin Branch</td>
                        <td colSpan={3}>
                          {STORE_NAMES[activeVariance.source_store_id]} ({activeVariance.source_warehouse_id})
                        </td>
                      </tr>
                      <tr>
                        <td className="m">Destination Branch</td>
                        <td colSpan={3}>
                          {STORE_NAMES[activeVariance.target_store_id]} ({activeVariance.target_warehouse_id})
                        </td>
                      </tr>
                      <tr>
                        <td className="m">Dispatcher Staff</td>
                        <td colSpan={3}>
                          {activeVariance.dispatcher_name || activeVariance.dispatcher_user_id}
                        </td>
                      </tr>
                      <tr>
                        <td className="m">Receiving Staff</td>
                        <td colSpan={3}>
                          {activeVariance.receiver_name || activeVariance.receiver_user_id}
                        </td>
                      </tr>
                      {activeVariance.notes && (
                        <tr>
                          <td className="m">Transit Remarks</td>
                          <td colSpan={3} style={{ fontStyle: 'italic' }}>
                            {activeVariance.notes}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* FC Review Notes Input */}
                  <div className="fld" style={{ marginTop: 16 }}>
                    <label className="lbl" htmlFor="fcNotesInput">
                      Financial Controller Resolution Notes
                    </label>
                    <textarea
                      id="fcNotesInput"
                      className="in"
                      rows={3}
                      value={fcApprovalNotes}
                      onChange={(e) => setFcApprovalNotes(e.target.value)}
                      placeholder="e.g. Verified vacuum bag seal failure with logistics carrier. Slicing moisture loss approved within acceptable transit shrinkage threshold."
                    />
                  </div>

                  {/* Ledger Action Explanation */}
                  <div className="note ok" style={{ marginBottom: 18 }}>
                    <b>Ledger Effect upon FC Approval:</b>
                    <div style={{ marginTop: 4 }}>
                      Appends <code>TRANSFER_IN_RECEIVED</code> (
                      <span className="pos">+{activeVariance.receive_qty_kg} kg</span>) at destination storeroom{' '}
                      <code>{activeVariance.target_warehouse_id}</code>. The difference of{' '}
                      <b>{Math.abs(activeVariance.variance_qty || 0)} kg</b> represents approved in-transit shrinkage. Status transitions to <code>RECEIVED_VARIANCE_APPROVED</code>.
                    </div>
                  </div>

                  {/* FC Action Buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 12 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        isSubmitting ||
                        (role !== 'fc' && role !== 'admin') ||
                        isDispatcherSelfApproving
                      }
                      onClick={handleApproveVariance}
                    >
                      {isSubmitting ? 'PROCESSING...' : 'APPROVE VARIANCE & POST INBOUND LEDGER'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={isSubmitting || (role !== 'fc' && role !== 'admin')}
                      onClick={handleRejectVariance}
                      style={{ color: 'var(--err)', borderColor: 'var(--err)' }}
                    >
                      REJECT DISCREPANCY
                    </button>
                  </div>
                </Ticket>
              ) : (
                <div className="stub" style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <span className="lbl">SELECT A DISCREPANCY CLAIM</span>
                  <p style={{ color: 'var(--ink-3)', marginTop: 6 }}>
                    Choose a pending variance claim from the left column to review transit audit details and sign off.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: TRANSFER AUDIT LEDGER (ALL RECORDS)
         ========================================================================= */}
      {activeTab === 'all' && (
        <div className="stub w" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span className="lbl">INTER-STORE CUSTODY LOGS</span>
              <h3 className="h3" style={{ marginTop: 2 }}>
                Transfer Registry &amp; Tamper Seal Audit Trail
              </h3>
            </div>
            <button type="button" className="btn ghost sm" onClick={refreshTransfers}>
              REFRESH LOGS
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Transfer ID</th>
                <th>Status</th>
                <th>Route</th>
                <th>Item</th>
                <th>Vehicle Seal</th>
                <th className="num">Dispatched</th>
                <th className="num">Received</th>
                <th className="num">Variance</th>
                <th>Dispatched At</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.transfer_id} className="row">
                  <td className="m" style={{ fontWeight: 600 }}>
                    {t.transfer_id}
                  </td>
                  <td>{renderStatusBadge(t.status)}</td>
                  <td style={{ fontSize: 12.5 }}>
                    <b>{t.source_store_id}</b> &rarr; <b>{t.target_store_id}</b>
                  </td>
                  <td>
                    <b>{t.item_name || t.item_code}</b>
                    <div className="gloss">{t.item_code}</div>
                  </td>
                  <td className="m" style={{ color: 'var(--terra)', fontWeight: 600 }}>
                    {t.vehicle_seal_no}
                  </td>
                  <td className="num">
                    {t.dispatch_qty_kg} kg
                    {t.dispatch_qty_pcs != null ? ` (${t.dispatch_qty_pcs} pcs)` : ''}
                  </td>
                  <td className="num">
                    {t.receive_qty_kg != null ? `${t.receive_qty_kg} kg` : '—'}
                    {t.receive_qty_pcs != null ? ` (${t.receive_qty_pcs} pcs)` : ''}
                  </td>
                  <td
                    className={`num ${
                      t.variance_qty != null && t.variance_qty < 0
                        ? 'neg'
                        : t.variance_qty != null && t.variance_qty > 0
                        ? 'pos'
                        : ''
                    }`}
                  >
                    {t.variance_qty != null
                      ? `${t.variance_qty > 0 ? '+' : ''}${t.variance_qty} kg`
                      : '—'}
                  </td>
                  <td className="m" style={{ fontSize: 12 }}>
                    {new Date(t.dispatched_at).toLocaleDateString()}{' '}
                    {new Date(t.dispatched_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
