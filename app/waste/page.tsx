'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  logWasteOrReturn,
  approveWasteOrReturn,
  getWasteLogs,
  WasteReturnLogRecord,
  WasteMovementType,
  MINOR_WASTE_THRESHOLD_KG,
  MASTER_ITEMS,
  WASTE_REASONS,
  RETURN_REASONS,
  KNOWN_USERS,
  getWarehousesForStore,
  getItemNameByCode,
  getUserDisplayName,
} from '@/lib/data/waste';

type ActiveTab = 'waste' | 'return' | 'approvals' | 'ledger';

export default function WasteAndReturnsPage() {
  const { role, store, showToast } = useShell();

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('waste');

  // Audit logs state
  const [logs, setLogs] = useState<WasteReturnLogRecord[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(true);

  // Filter state for logs & approvals
  const [approvalFilter, setApprovalFilter] = useState<'ALL' | 'MINOR' | 'MAJOR' | 'RETURN'>('ALL');
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');

  // Acting user state: maps from shell role, with option to test segregation of duties
  const roleToUserId: Record<string, string> = {
    keeper: 'usr-admin-01',
    rm: 'usr-rm-01',
    cust: 'usr-custodian-01',
    req: 'usr-kitchen-01',
    fc: 'usr-approver-01',
    admin: 'usr-sysadmin-01',
    acct: 'usr-accountant-01',
    viewer: 'usr-viewer-01',
  };

  const currentUserId = roleToUserId[role] || 'usr-admin-01';
  const currentUserInfo = KNOWN_USERS[currentUserId] || {
    name: 'Authorized Staff',
    role: 'Warehouse Staff',
  };

  // Available storerooms for current store
  const storerooms = useMemo(() => getWarehousesForStore(store), [store]);

  // ==========================================
  // ACTION 1: Waste Disposal Form State
  // ==========================================
  const [wasteItemCode, setWasteItemCode] = useState<string>(MASTER_ITEMS[0].itemCode);
  const selectedWasteItem = useMemo(
    () => MASTER_ITEMS.find((i) => i.itemCode === wasteItemCode) || MASTER_ITEMS[0],
    [wasteItemCode]
  );
  const [wasteWarehouseId, setWasteWarehouseId] = useState<string>(
    storerooms[0]?.warehouseId || `${store}-COLD`
  );
  const [wasteQtyInput, setWasteQtyInput] = useState<string>('2.500');
  const [wasteReasonCode, setWasteReasonCode] = useState<string>('SPOILED_ROTTEN');
  const [wasteReasonText, setWasteReasonText] = useState<string>('');
  const [wastePhotoUrl, setWastePhotoUrl] = useState<string>('');
  const [isSubmittingWaste, setIsSubmittingWaste] = useState<boolean>(false);

  // Sync default storeroom when item changes
  const handleWasteItemChange = (code: string) => {
    setWasteItemCode(code);
    const item = MASTER_ITEMS.find((i) => i.itemCode === code);
    if (item) {
      const matchWh = storerooms.find((s) => s.storageType === item.storageType);
      if (matchWh) {
        setWasteWarehouseId(matchWh.warehouseId);
      }
    }
  };

  const wasteQtyNumber = parseFloat(wasteQtyInput) || 0;
  const isMajorWaste = wasteQtyNumber > MINOR_WASTE_THRESHOLD_KG;

  // ==========================================
  // ACTION 2: Supplier Return Form State
  // ==========================================
  const [returnItemCode, setReturnItemCode] = useState<string>(MASTER_ITEMS[0].itemCode);
  const selectedReturnItem = useMemo(
    () => MASTER_ITEMS.find((i) => i.itemCode === returnItemCode) || MASTER_ITEMS[0],
    [returnItemCode]
  );
  const [returnWarehouseId, setReturnWarehouseId] = useState<string>(
    storerooms[0]?.warehouseId || `${store}-COLD`
  );
  const [returnQtyInput, setReturnQtyInput] = useState<string>('10.000');
  const [returnPoNumber, setReturnPoNumber] = useState<string>('PO-2026-DEL-0891');
  const [returnGrpoDocNo, setReturnGrpoDocNo] = useState<string>('GRPO-2026-1029-01');
  const [returnReasonCode, setReturnReasonCode] = useState<string>('TEMPERATURE_ABUSE');
  const [returnReasonText, setReturnReasonText] = useState<string>('');
  const [returnDriverSignature, setReturnDriverSignature] = useState<string>('');
  const [isSubmittingReturn, setIsSubmittingReturn] = useState<boolean>(false);

  // Driver signature canvas
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSignature, setIsDrawingSignature] = useState<boolean>(false);

  const handleReturnItemChange = (code: string) => {
    setReturnItemCode(code);
    const item = MASTER_ITEMS.find((i) => i.itemCode === code);
    if (item) {
      const matchWh = storerooms.find((s) => s.storageType === item.storageType);
      if (matchWh) {
        setReturnWarehouseId(matchWh.warehouseId);
      }
    }
  };

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawingSignature(true);
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const drawSignature = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingSignature) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1D1914';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawingSignature) return;
    setIsDrawingSignature(false);
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      setReturnDriverSignature(canvas.toDataURL('image/png'));
    }
  };

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setReturnDriverSignature('');
  };

  const simulateCarrierSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1D1914';

    // Draw stylized driver mark
    ctx.beginPath();
    ctx.moveTo(30, 65);
    ctx.bezierCurveTo(80, 20, 110, 95, 160, 50);
    ctx.bezierCurveTo(200, 15, 230, 85, 280, 45);
    ctx.moveTo(70, 75);
    ctx.lineTo(240, 75);
    ctx.stroke();

    const dataUrl = canvas.toDataURL('image/png');
    setReturnDriverSignature(dataUrl);
  };

  // ==========================================
  // Approvals & Comment Dialog State
  // ==========================================
  const [decisionComment, setDecisionComment] = useState<Record<string, string>>({});
  const [processingLogId, setProcessingLogId] = useState<string | null>(null);

  // Load logs
  const loadLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const data = await getWasteLogs(store);
      setLogs(data);
    } catch {
      showToast('Notice: Using local offline outflow records.');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [store, showToast]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Counts for pending badges
  const pendingClaims = useMemo(
    () => logs.filter((l) => l.approver_decision === 'PENDING'),
    [logs]
  );

  const minorWastePending = useMemo(
    () =>
      pendingClaims.filter(
        (l) => l.movement_type === 'WASTE_DISPOSAL' && l.quantity <= MINOR_WASTE_THRESHOLD_KG
      ),
    [pendingClaims]
  );

  const majorWastePending = useMemo(
    () =>
      pendingClaims.filter(
        (l) => l.movement_type === 'WASTE_DISPOSAL' && l.quantity > MINOR_WASTE_THRESHOLD_KG
      ),
    [pendingClaims]
  );

  const supplierReturnsPending = useMemo(
    () => pendingClaims.filter((l) => l.movement_type === 'SUPPLIER_RETURN'),
    [pendingClaims]
  );

  // Filtered approvals list
  const filteredApprovals = useMemo(() => {
    if (approvalFilter === 'MINOR') return minorWastePending;
    if (approvalFilter === 'MAJOR') return majorWastePending;
    if (approvalFilter === 'RETURN') return supplierReturnsPending;
    return pendingClaims;
  }, [approvalFilter, pendingClaims, minorWastePending, majorWastePending, supplierReturnsPending]);

  // Filtered ledger list
  const filteredLedger = useMemo(() => {
    if (ledgerFilter === 'ALL') return logs;
    return logs.filter((l) => l.approver_decision === ledgerFilter);
  }, [ledgerFilter, logs]);

  // ==========================================
  // Form Submission 1: Log Waste Disposal
  // ==========================================
  const handleLogWasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (wasteQtyNumber <= 0) {
      showToast('Error: Waste quantity must be strictly positive (> 0).');
      return;
    }
    if (!wasteReasonText.trim()) {
      showToast('Error: Physical observation notes are required.');
      return;
    }

    setIsSubmittingWaste(true);
    const result = await dispatchAction<string>({
      actionName: 'Log Waste Disposal',
      storeId: store,
      payload: {
        itemCode: wasteItemCode,
        quantity: wasteQtyNumber,
        warehouseId: wasteWarehouseId,
      },
      execute: async () => {
        return await logWasteOrReturn({
          storeId: store,
          warehouseId: wasteWarehouseId,
          movementType: 'WASTE_DISPOSAL',
          itemCode: wasteItemCode,
          quantity: wasteQtyNumber,
          uom: selectedWasteItem.baseUom,
          reasonCode: wasteReasonCode,
          reasonText: wasteReasonText.trim(),
          photoUrl: wastePhotoUrl || null,
          loggedByUserId: currentUserId,
        });
      },
      onSuccess: () => {
        showToast(
          `Waste disposal claim logged (${wasteQtyNumber} ${selectedWasteItem.baseUom}). Dual authorization pending.`
        );
        setWasteReasonText('');
        setWastePhotoUrl('');
        loadLogs();
        setActiveTab('approvals');
      },
      onError: (err) => {
        showToast(`Submission blocked: ${err.message}`);
      },
    });

    setIsSubmittingWaste(false);
  };

  // ==========================================
  // Form Submission 2: Log Supplier Return
  // ==========================================
  const handleLogReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const returnQtyNumber = parseFloat(returnQtyInput) || 0;
    if (returnQtyNumber <= 0) {
      showToast('Error: Return quantity must be strictly positive (> 0).');
      return;
    }
    if (!returnPoNumber.trim() && !returnGrpoDocNo.trim()) {
      showToast('Error: PO number or GRPO reference document is required for supplier returns.');
      return;
    }
    if (!returnDriverSignature.trim()) {
      showToast('Error: Driver carrier signature is mandatory on supplier return dispatch.');
      return;
    }
    if (!returnReasonText.trim()) {
      showToast('Error: Physical return defect description is required.');
      return;
    }

    setIsSubmittingReturn(true);
    const result = await dispatchAction<string>({
      actionName: 'Log Supplier Return',
      storeId: store,
      payload: {
        itemCode: returnItemCode,
        quantity: returnQtyNumber,
        warehouseId: returnWarehouseId,
        poNumber: returnPoNumber,
      },
      execute: async () => {
        return await logWasteOrReturn({
          storeId: store,
          warehouseId: returnWarehouseId,
          movementType: 'SUPPLIER_RETURN',
          itemCode: returnItemCode,
          quantity: returnQtyNumber,
          uom: selectedReturnItem.baseUom,
          reasonCode: returnReasonCode,
          reasonText: returnReasonText.trim(),
          poNumber: returnPoNumber.trim() || null,
          grpoDocNo: returnGrpoDocNo.trim() || null,
          driverSignature: returnDriverSignature,
          loggedByUserId: currentUserId,
        });
      },
      onSuccess: () => {
        showToast(
          `Supplier return claim logged (${returnQtyNumber} ${selectedReturnItem.baseUom}). Dual authorization pending.`
        );
        setReturnReasonText('');
        clearSignatureCanvas();
        loadLogs();
        setActiveTab('approvals');
      },
      onError: (err) => {
        showToast(`Return dispatch blocked: ${err.message}`);
      },
    });

    setIsSubmittingReturn(false);
  };

  // ==========================================
  // Authorization Decision Seam
  // ==========================================
  const handleDecision = async (
    claim: WasteReturnLogRecord,
    decision: 'APPROVED' | 'REJECTED'
  ) => {
    // Segregation of duties validation
    if (claim.logged_by_user_id === currentUserId) {
      showToast('Segregation of duties violation: Logger cannot approve or reject their own claim.');
      return;
    }

    // Role authority checks
    const isFcOrAdmin = role === 'fc' || role === 'admin';
    const isRm = role === 'rm';

    if (claim.movement_type === 'SUPPLIER_RETURN') {
      if (!isFcOrAdmin) {
        showToast('Unauthorized: Supplier returns strictly require Financial Controller (FC) approval.');
        return;
      }
    } else {
      if (claim.quantity > MINOR_WASTE_THRESHOLD_KG) {
        if (!isFcOrAdmin) {
          showToast(
            `Unauthorized: Major waste (${claim.quantity} kg > ${MINOR_WASTE_THRESHOLD_KG} kg) strictly requires Financial Controller (FC) approval.`
          );
          return;
        }
      } else {
        if (!isRm && !isFcOrAdmin) {
          showToast('Unauthorized: Approval requires Restaurant Manager (RM) or Financial Controller (FC).');
          return;
        }
      }
    }

    setProcessingLogId(claim.log_id);
    const comment = decisionComment[claim.log_id] || '';

    await dispatchAction<void>({
      actionName: `${decision === 'APPROVED' ? 'Approve' : 'Reject'} Outflow Claim`,
      storeId: store,
      payload: { logId: claim.log_id, decision, comment },
      execute: async () => {
        return await approveWasteOrReturn(claim.log_id, decision, comment, currentUserId);
      },
      onSuccess: () => {
        if (decision === 'APPROVED') {
          showToast(
            `Claim ${claim.log_id.slice(0, 8)} approved. Ledger appended: ${claim.movement_type} (-${claim.quantity} ${claim.uom}).`
          );
        } else {
          showToast(`Claim ${claim.log_id.slice(0, 8)} rejected.`);
        }
        loadLogs();
      },
      onError: (err) => {
        showToast(`Decision rejected by system: ${err.message}`);
      },
    });

    setProcessingLogId(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="head">
        <div>
          <div className="kicker">Flow G &middot; Non-Standard Stock Outflows</div>
          <h1 className="h1">
            Waste &amp; <em>Supplier Returns</em>
          </h1>
          <p className="sub" style={{ marginTop: 6, color: 'var(--ink-2)', maxWidth: 760 }}>
            Dual-party authorization for damaged, spoiled, or returned physical stock.
            Approved claims append immutable negative physical movements (<code>WASTE_DISPOSAL -Q</code> or{' '}
            <code>SUPPLIER_RETURN -Q</code>) to the central ledger. Zero commercial indicators.
          </p>
        </div>

        {/* User acting scope badge */}
        <div style={{ textAlign: 'right' }}>
          <div className="b mu" style={{ padding: '4px 10px', fontSize: 11 }}>
            Acting Staff: <b>{currentUserInfo.name}</b> ({currentUserInfo.role})
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Store Scope: <b>{store}</b>
          </div>
        </div>
      </div>

      {/* Primary Section Switcher Tabs */}
      <div style={{ marginBottom: 24 }}>
        <Chips>
          <Chip
            label="Log Waste Disposal"
            active={activeTab === 'waste'}
            onClick={() => setActiveTab('waste')}
          />
          <Chip
            label="Log Supplier Return"
            active={activeTab === 'return'}
            onClick={() => setActiveTab('return')}
          />
          <Chip
            label="Approvals Queue"
            count={pendingClaims.length}
            active={activeTab === 'approvals'}
            onClick={() => setActiveTab('approvals')}
          />
          <Chip
            label="Outflow Ledger &amp; History"
            count={logs.length}
            active={activeTab === 'ledger'}
            onClick={() => setActiveTab('ledger')}
          />
        </Chips>
      </div>

      {/* Main Two-Column Layout */}
      <div className="cols c-ov">
        {/* Left Column: Active Workspace */}
        <div>
          {/* ==================================================== */}
          {/* TAB 1: LOG WASTE DISPOSAL                            */}
          {/* ==================================================== */}
          {activeTab === 'waste' && (
            <Ticket
              no="DOC-WASTE-DISPOSAL"
              right={
                <Badge variant={isMajorWaste ? 'er' : 'am'}>
                  {isMajorWaste
                    ? `Major Waste (> ${MINOR_WASTE_THRESHOLD_KG} kg) • FC Required`
                    : `Minor Waste (≤ ${MINOR_WASTE_THRESHOLD_KG} kg) • RM / FC`}
                </Badge>
              }
            >
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 18, fontFamily: 'var(--disp)' }}>
                  Physical Waste Disposal Log
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                  Record spoilage, shelf-life expiration, preparation spillage, or quality rejects
                  requiring removal from physical stock.
                </p>
              </div>

              <form onSubmit={handleLogWasteSubmit}>
                {/* Item Selector */}
                <div className="fld">
                  <label htmlFor="waste-item" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Item Identification
                  </label>
                  <select
                    id="waste-item"
                    className="in"
                    value={wasteItemCode}
                    onChange={(e) => handleWasteItemChange(e.target.value)}
                    required
                  >
                    {MASTER_ITEMS.map((item) => (
                      <option key={item.itemCode} value={item.itemCode}>
                        [{item.itemCode}] {item.itemName} &middot; ({item.categoryGroup}) &middot; {item.baseUom}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Storeroom & Quantity row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 16 }}>
                  <div className="fld">
                    <label htmlFor="waste-wh" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      Physical Storeroom
                    </label>
                    <select
                      id="waste-wh"
                      className="in"
                      value={wasteWarehouseId}
                      onChange={(e) => setWasteWarehouseId(e.target.value)}
                      required
                    >
                      {storerooms.map((room) => (
                        <option key={room.warehouseId} value={room.warehouseId}>
                          {room.name} ({room.warehouseId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="fld">
                    <label htmlFor="waste-qty" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      Disposal Quantity
                    </label>
                    <input
                      id="waste-qty"
                      type="number"
                      step="0.001"
                      min="0.001"
                      className="in"
                      value={wasteQtyInput}
                      onChange={(e) => setWasteQtyInput(e.target.value)}
                      required
                    />
                  </div>

                  <div className="fld">
                    <label htmlFor="waste-uom" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      UoM
                    </label>
                    <input
                      id="waste-uom"
                      type="text"
                      className="in"
                      value={selectedWasteItem.baseUom}
                      readOnly
                      style={{ background: 'var(--sand)', cursor: 'not-allowed', textAlign: 'center' }}
                    />
                  </div>
                </div>

                {/* Live Dynamic Threshold Notice */}
                <div style={{ marginBottom: 16 }}>
                  {isMajorWaste ? (
                    <div className="note er" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Badge variant="er">THRESHOLD EXCEEDED</Badge>
                      <div>
                        <b>Major Waste Level ({wasteQtyNumber} kg &gt; {MINOR_WASTE_THRESHOLD_KG} kg):</b>{' '}
                        Restaurant Manager approval is insufficient. This claim will strictly mandate
                        Financial Controller (FC) digital sign-off.
                      </div>
                    </div>
                  ) : (
                    <div className="note am" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Badge variant="am">MINOR THRESHOLD</Badge>
                      <div>
                        <b>Minor Waste Level ({wasteQtyNumber} kg &le; {MINOR_WASTE_THRESHOLD_KG} kg):</b>{' '}
                        Eligible for Restaurant Manager (RM) or Financial Controller (FC) authorization.
                      </div>
                    </div>
                  )}
                </div>

                {/* Reason Code */}
                <div className="fld">
                  <label htmlFor="waste-reason" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Standard Reason Code
                  </label>
                  <select
                    id="waste-reason"
                    className="in"
                    value={wasteReasonCode}
                    onChange={(e) => setWasteReasonCode(e.target.value)}
                    required
                  >
                    {WASTE_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reason Details */}
                <div className="fld">
                  <label htmlFor="waste-desc" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Physical Observation &amp; Root Cause
                  </label>
                  <textarea
                    id="waste-desc"
                    className="in"
                    rows={3}
                    placeholder="Document specific physical condition (e.g. discoloration, broken seal, dropped during mise-en-place)..."
                    value={wasteReasonText}
                    onChange={(e) => setWasteReasonText(e.target.value)}
                    required
                  />
                </div>

                {/* Photo Evidence Simulation */}
                <div className="fld">
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Photo Evidence Attachment (Required for Major Waste)
                  </label>
                  <div
                    style={{
                      border: '1px dashed #BDB5A5',
                      borderRadius: 4,
                      padding: 12,
                      background: 'var(--sand)',
                      marginTop: 5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        className="in"
                        style={{ flex: 1, marginTop: 0 }}
                        placeholder="Simulated attachment path (e.g. /evidence/batch-spoilage-01.jpg)"
                        value={wastePhotoUrl}
                        onChange={(e) => setWastePhotoUrl(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() =>
                          setWastePhotoUrl(`/evidence/waste-item-${selectedWasteItem.itemCode.toLowerCase()}.jpg`)
                        }
                      >
                        Sample Photo
                      </button>
                    </div>

                    {wastePhotoUrl && (
                      <div
                        style={{
                          marginTop: 10,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 12,
                          color: 'var(--forest)',
                        }}
                      >
                        <Badge variant="ok">Photo Attached</Badge>
                        <span style={{ fontFamily: 'var(--mono)' }}>{wastePhotoUrl}</span>
                        <button
                          type="button"
                          className="btn sm ghost"
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => setWastePhotoUrl('')}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Segregation of Duties Notice */}
                <div className="note" style={{ marginBottom: 18, fontSize: 12 }}>
                  <b>Segregation of Duties Enforcement:</b> You are submitting as{' '}
                  <b>{currentUserInfo.name}</b>. Once logged, your account cannot approve or reject this
                  claim. An independent manager must review it.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button
                    type="submit"
                    className="btn"
                    disabled={isSubmittingWaste || wasteQtyNumber <= 0}
                  >
                    {isSubmittingWaste ? 'Dispatching...' : 'Log Waste Disposal Claim'}
                  </button>
                </div>
              </form>
            </Ticket>
          )}

          {/* ==================================================== */}
          {/* TAB 2: LOG SUPPLIER RETURN                           */}
          {/* ==================================================== */}
          {activeTab === 'return' && (
            <Ticket
              no="DOC-SUPPLIER-RETURN"
              right={<Badge variant="ur">Strictly FC Approval Required</Badge>}
            >
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 18, fontFamily: 'var(--disp)' }}>
                  Log Supplier Return Dispatch
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                  Record rejected stock returned to supplier at dock. Requires matching PO/GRPO
                  reference and driver carrier digital signature prior to submission.
                </p>
              </div>

              <form onSubmit={handleLogReturnSubmit}>
                {/* Item Selector */}
                <div className="fld">
                  <label htmlFor="return-item" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Item Identification
                  </label>
                  <select
                    id="return-item"
                    className="in"
                    value={returnItemCode}
                    onChange={(e) => handleReturnItemChange(e.target.value)}
                    required
                  >
                    {MASTER_ITEMS.map((item) => (
                      <option key={item.itemCode} value={item.itemCode}>
                        [{item.itemCode}] {item.itemName} &middot; {item.baseUom}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Storeroom, Quantity & UoM */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 16 }}>
                  <div className="fld">
                    <label htmlFor="return-wh" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      Physical Storeroom
                    </label>
                    <select
                      id="return-wh"
                      className="in"
                      value={returnWarehouseId}
                      onChange={(e) => setReturnWarehouseId(e.target.value)}
                      required
                    >
                      {storerooms.map((room) => (
                        <option key={room.warehouseId} value={room.warehouseId}>
                          {room.name} ({room.warehouseId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="fld">
                    <label htmlFor="return-qty" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      Return Quantity
                    </label>
                    <input
                      id="return-qty"
                      type="number"
                      step="0.001"
                      min="0.001"
                      className="in"
                      value={returnQtyInput}
                      onChange={(e) => setReturnQtyInput(e.target.value)}
                      required
                    />
                  </div>

                  <div className="fld">
                    <label htmlFor="return-uom" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      UoM
                    </label>
                    <input
                      id="return-uom"
                      type="text"
                      className="in"
                      value={selectedReturnItem.baseUom}
                      readOnly
                      style={{ background: 'var(--sand)', cursor: 'not-allowed', textAlign: 'center' }}
                    />
                  </div>
                </div>

                {/* PO & GRPO Reference Documentation */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="fld">
                    <label htmlFor="po-number" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      Purchase Order Reference (PO)
                    </label>
                    <input
                      id="po-number"
                      type="text"
                      className="in"
                      placeholder="e.g. PO-2026-DEL-0891"
                      value={returnPoNumber}
                      onChange={(e) => setReturnPoNumber(e.target.value)}
                    />
                  </div>

                  <div className="fld">
                    <label htmlFor="grpo-no" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      GRPO Document Number
                    </label>
                    <input
                      id="grpo-no"
                      type="text"
                      className="in"
                      placeholder="e.g. GRPO-2026-1029-01"
                      value={returnGrpoDocNo}
                      onChange={(e) => setReturnGrpoDocNo(e.target.value)}
                    />
                  </div>
                </div>

                {/* Return Reason Code */}
                <div className="fld">
                  <label htmlFor="return-reason" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Supplier Return Reason Code
                  </label>
                  <select
                    id="return-reason"
                    className="in"
                    value={returnReasonCode}
                    onChange={(e) => setReturnReasonCode(e.target.value)}
                    required
                  >
                    {RETURN_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Physical Inspection Details */}
                <div className="fld">
                  <label htmlFor="return-desc" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                    Dock Inspection &amp; Rejection Notes
                  </label>
                  <textarea
                    id="return-desc"
                    className="in"
                    rows={3}
                    placeholder="Document dock rejection findings (e.g. cold chain temperature breach, expired shelf-life on arrival, crushed packaging)..."
                    value={returnReasonText}
                    onChange={(e) => setReturnReasonText(e.target.value)}
                    required
                  />
                </div>

                {/* Driver Carrier Signature Canvas */}
                <div className="fld">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                      Driver Carrier Digital Signature (Mandatory)
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={simulateCarrierSignature}
                      >
                        Sample Driver Sign-off
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={clearSignatureCanvas}
                      >
                        Clear Canvas
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      border: returnDriverSignature ? '1.5px solid var(--forest)' : '1px solid #BDB5A5',
                      borderRadius: 4,
                      background: '#fff',
                      marginTop: 6,
                      position: 'relative',
                    }}
                  >
                    <canvas
                      ref={signatureCanvasRef}
                      width={600}
                      height={120}
                      style={{ width: '100%', height: 120, display: 'block', cursor: 'crosshair' }}
                      onMouseDown={startDrawing}
                      onMouseMove={drawSignature}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={drawSignature}
                      onTouchEnd={stopDrawing}
                    />
                    {!returnDriverSignature && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          color: '#A8A190',
                          pointerEvents: 'none',
                          fontSize: 12,
                          fontFamily: 'var(--mono)',
                        }}
                      >
                        [ Carrier / Driver to sign on screen ]
                      </div>
                    )}
                  </div>
                </div>

                {/* Authority Gate Card */}
                <div className="note am" style={{ marginBottom: 18, fontSize: 12 }}>
                  <b>Strict Authorization Gate:</b> All supplier returns require dual-party sign-off.
                  Restaurant Managers (RM) are restricted from approving returns; Financial Controller (FC)
                  review is strictly mandated.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button
                    type="submit"
                    className="btn"
                    disabled={
                      isSubmittingReturn ||
                      !returnDriverSignature ||
                      (!returnPoNumber.trim() && !returnGrpoDocNo.trim())
                    }
                  >
                    {isSubmittingReturn ? 'Dispatching...' : 'Log Supplier Return Claim'}
                  </button>
                </div>
              </form>
            </Ticket>
          )}

          {/* ==================================================== */}
          {/* TAB 3: APPROVALS SUB-PANEL                           */}
          {/* ==================================================== */}
          {activeTab === 'approvals' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontFamily: 'var(--disp)' }}>
                    Pending Outflow Approvals ({pendingClaims.length})
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>
                    Caller Authority: <b>{currentUserInfo.role}</b> &middot; Logger cannot self-approve.
                  </div>
                </div>

                <Chips>
                  <Chip
                    label="All Pending"
                    count={pendingClaims.length}
                    active={approvalFilter === 'ALL'}
                    onClick={() => setApprovalFilter('ALL')}
                  />
                  <Chip
                    label="Minor Waste"
                    count={minorWastePending.length}
                    active={approvalFilter === 'MINOR'}
                    onClick={() => setApprovalFilter('MINOR')}
                  />
                  <Chip
                    label="Major Waste"
                    count={majorWastePending.length}
                    active={approvalFilter === 'MAJOR'}
                    onClick={() => setApprovalFilter('MAJOR')}
                  />
                  <Chip
                    label="Supplier Returns"
                    count={supplierReturnsPending.length}
                    active={approvalFilter === 'RETURN'}
                    onClick={() => setApprovalFilter('RETURN')}
                  />
                </Chips>
              </div>

              {isLoadingLogs ? (
                <div className="stub" style={{ textAlign: 'center', padding: 32 }}>
                  Loading pending claims...
                </div>
              ) : filteredApprovals.length === 0 ? (
                <div className="stub" style={{ textAlign: 'center', padding: 36 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--forest)' }}>
                    Approvals Queue Clear
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>
                    No pending waste disposals or supplier returns awaiting your review.
                  </p>
                </div>
              ) : (
                <div className="stack">
                  {filteredApprovals.map((claim) => {
                    const isSelfLogged = claim.logged_by_user_id === currentUserId;
                    const isFcRole = role === 'fc' || role === 'admin';
                    const isRmRole = role === 'rm';
                    const isWaste = claim.movement_type === 'WASTE_DISPOSAL';
                    const isMajor = isWaste && claim.quantity > MINOR_WASTE_THRESHOLD_KG;

                    // Compute caller approval permission
                    let canCallerApprove = false;
                    let blockReason = '';

                    if (isSelfLogged) {
                      canCallerApprove = false;
                      blockReason = 'Segregation of duties: You logged this claim. An independent authorizer must sign off.';
                    } else if (claim.movement_type === 'SUPPLIER_RETURN') {
                      if (isFcRole) {
                        canCallerApprove = true;
                      } else {
                        canCallerApprove = false;
                        blockReason = 'Role authority gate: Supplier returns strictly require Financial Controller (FC) approval.';
                      }
                    } else {
                      // Waste disposal
                      if (isMajor) {
                        if (isFcRole) {
                          canCallerApprove = true;
                        } else {
                          canCallerApprove = false;
                          blockReason = `Role authority gate: Major waste (${claim.quantity} kg > ${MINOR_WASTE_THRESHOLD_KG} kg) requires Financial Controller (FC) approval. Restaurant Manager cannot authorize.`;
                        }
                      } else {
                        // Minor waste
                        if (isRmRole || isFcRole) {
                          canCallerApprove = true;
                        } else {
                          canCallerApprove = false;
                          blockReason = 'Role authority gate: Minor waste requires Restaurant Manager (RM) or Financial Controller (FC) approval.';
                        }
                      }
                    }

                    return (
                      <Ticket
                        key={claim.log_id}
                        no={`CLAIM-${claim.log_id.slice(0, 8).toUpperCase()}`}
                        right={
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Badge variant={claim.movement_type === 'WASTE_DISPOSAL' ? 'am' : 're'}>
                              {claim.movement_type === 'WASTE_DISPOSAL' ? 'Waste Disposal' : 'Supplier Return'}
                            </Badge>
                            {isWaste && (
                              <Badge variant={isMajor ? 'er' : 'ok'}>
                                {isMajor ? `Major (> ${MINOR_WASTE_THRESHOLD_KG} kg)` : `Minor (≤ ${MINOR_WASTE_THRESHOLD_KG} kg)`}
                              </Badge>
                            )}
                          </div>
                        }
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>
                              {claim.item_name} &middot;{' '}
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>
                                [{claim.item_code}]
                              </span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
                              Storeroom: <b>{claim.warehouse_id}</b> &middot; Logged by:{' '}
                              <b>{claim.logged_by_name || claim.logged_by_user_id}</b> &middot;{' '}
                              {new Date(claim.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--err)' }}>
                              -{claim.quantity.toFixed(3)} {claim.uom}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                              Physical Outflow (-Q)
                            </div>
                          </div>
                        </div>

                        {/* Reference and Reason Details */}
                        <div
                          style={{
                            background: 'var(--sand)',
                            borderRadius: 4,
                            padding: 10,
                            margin: '12px 0',
                            fontSize: 13,
                          }}
                        >
                          <div>
                            <b>Reason Code:</b> {claim.reason_code}
                          </div>
                          <div style={{ marginTop: 2, color: 'var(--ink-2)' }}>
                            <b>Notes:</b> {claim.reason_text}
                          </div>

                          {claim.movement_type === 'SUPPLIER_RETURN' && (
                            <div
                              style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: '1px dashed var(--rule)',
                                display: 'flex',
                                gap: 24,
                                flexWrap: 'wrap',
                              }}
                            >
                              <div>
                                <b>PO Ref:</b>{' '}
                                <span style={{ fontFamily: 'var(--mono)' }}>{claim.po_number || 'N/A'}</span>
                              </div>
                              <div>
                                <b>GRPO Ref:</b>{' '}
                                <span style={{ fontFamily: 'var(--mono)' }}>{claim.grpo_doc_no || 'N/A'}</span>
                              </div>
                              {claim.driver_signature_blob && (
                                <div>
                                  <Badge variant="ok">Driver Signature Verified</Badge>
                                </div>
                              )}
                            </div>
                          )}

                          {claim.photo_url && (
                            <div style={{ marginTop: 6, fontSize: 12 }}>
                              <Badge variant="ok">Photo Attached</Badge>{' '}
                              <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)' }}>
                                {claim.photo_url}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Authority & Segregation Notice */}
                        {!canCallerApprove && (
                          <div className="note am" style={{ marginBottom: 12, fontSize: 12 }}>
                            {blockReason}
                          </div>
                        )}

                        {/* Decision Controls */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            paddingTop: 10,
                            borderTop: '1px solid var(--rule)',
                          }}
                        >
                          <input
                            type="text"
                            className="in"
                            style={{ flex: 1, marginTop: 0 }}
                            placeholder="Optional authorization or rejection comment..."
                            value={decisionComment[claim.log_id] || ''}
                            onChange={(e) =>
                              setDecisionComment({
                                ...decisionComment,
                                [claim.log_id]: e.target.value,
                              })
                            }
                            disabled={!canCallerApprove}
                          />

                          <button
                            type="button"
                            className="btn sm"
                            style={{ background: 'var(--forest)', borderColor: 'var(--forest)' }}
                            disabled={!canCallerApprove || processingLogId === claim.log_id}
                            onClick={() => handleDecision(claim, 'APPROVED')}
                          >
                            Approve &amp; Append Ledger (-Q)
                          </button>

                          <button
                            type="button"
                            className="btn sm ghost"
                            style={{ color: 'var(--err)', borderColor: 'var(--err)' }}
                            disabled={!canCallerApprove || processingLogId === claim.log_id}
                            onClick={() => handleDecision(claim, 'REJECTED')}
                          >
                            Reject
                          </button>
                        </div>
                      </Ticket>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 4: OUTFLOW LEDGER & HISTORY                      */}
          {/* ==================================================== */}
          {activeTab === 'ledger' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontFamily: 'var(--disp)' }}>
                    Outflow Audit Ledger ({filteredLedger.length})
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                    Immutable history of logged, approved, and rejected physical stock deductions.
                  </div>
                </div>

                <Chips>
                  <Chip
                    label="All Outflows"
                    count={logs.length}
                    active={ledgerFilter === 'ALL'}
                    onClick={() => setLedgerFilter('ALL')}
                  />
                  <Chip
                    label="Approved (-Q)"
                    count={logs.filter((l) => l.approver_decision === 'APPROVED').length}
                    active={ledgerFilter === 'APPROVED'}
                    onClick={() => setLedgerFilter('APPROVED')}
                  />
                  <Chip
                    label="Pending"
                    count={logs.filter((l) => l.approver_decision === 'PENDING').length}
                    active={ledgerFilter === 'PENDING'}
                    onClick={() => setLedgerFilter('PENDING')}
                  />
                  <Chip
                    label="Rejected"
                    count={logs.filter((l) => l.approver_decision === 'REJECTED').length}
                    active={ledgerFilter === 'REJECTED'}
                    onClick={() => setLedgerFilter('REJECTED')}
                  />
                </Chips>
              </div>

              <div className="stub w" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="dense">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 14 }}>Log ID / Ref</th>
                      <th>Storeroom</th>
                      <th>Item Description</th>
                      <th className="num">Outflow (-Q)</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Logger &middot; Authorizer</th>
                      <th style={{ paddingRight: 14 }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedger.map((row) => (
                      <tr key={row.log_id}>
                        <td className="m" style={{ paddingLeft: 14 }}>
                          <b>{row.log_id.slice(0, 8)}</b>
                          {row.po_number && (
                            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.po_number}</div>
                          )}
                        </td>
                        <td className="m">{row.warehouse_id}</td>
                        <td>
                          <b>{row.item_name}</b>
                          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                            {row.reason_code} &middot; {row.reason_text.slice(0, 40)}
                            {row.reason_text.length > 40 ? '…' : ''}
                          </div>
                        </td>
                        <td
                          className="num m"
                          style={{
                            fontWeight: 700,
                            color: row.approver_decision === 'APPROVED' ? 'var(--err)' : 'var(--ink-2)',
                          }}
                        >
                          -{row.quantity.toFixed(3)} {row.uom}
                        </td>
                        <td>
                          <Badge variant={row.movement_type === 'WASTE_DISPOSAL' ? 'am' : 're'}>
                            {row.movement_type === 'WASTE_DISPOSAL' ? 'Waste' : 'Return'}
                          </Badge>
                        </td>
                        <td>
                          {row.approver_decision === 'APPROVED' && <Badge variant="ok">APPROVED</Badge>}
                          {row.approver_decision === 'PENDING' && <Badge variant="am">PENDING</Badge>}
                          {row.approver_decision === 'REJECTED' && <Badge variant="er">REJECTED</Badge>}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <div>Logged: {row.logged_by_name || row.logged_by_user_id}</div>
                          {row.approver_user_id && (
                            <div style={{ color: 'var(--ink-3)' }}>
                              Auth: {row.approver_name || row.approver_user_id}
                            </div>
                          )}
                        </td>
                        <td className="m" style={{ fontSize: 11, paddingRight: 14 }}>
                          {new Date(row.created_at).toLocaleDateString()}
                          <br />
                          {new Date(row.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Policy Rails & Real-Time Outflow Status */}
        <div className="stack">
          {/* Segregation of Duties Card */}
          <div className="stub">
            <span className="lbl kicker">Rule Enforcement</span>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Segregation of Duties</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
              Whoever logs a waste disposal or supplier return claim is structurally prohibited from
              approving or rejecting that same record.
            </p>
            <div style={{ marginTop: 12, padding: 8, background: 'var(--paper)', borderRadius: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Active Session:</div>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--navy)' }}>
                {currentUserInfo.name} ({currentUserInfo.role})
              </div>
            </div>
          </div>

          {/* Authorization Thresholds Card */}
          <div className="stub">
            <span className="lbl kicker">Dual Authorization Matrix</span>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Outflow Thresholds</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ padding: 8, background: 'var(--paper)', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>Minor Waste</b>
                  <Badge variant="ok">&le; 5.000 kg</Badge>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                  Restaurant Manager (RM) or Financial Controller (FC) approval.
                </div>
              </div>

              <div style={{ padding: 8, background: 'var(--paper)', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>Major Waste</b>
                  <Badge variant="er">&gt; 5.000 kg</Badge>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                  Financial Controller (FC) approval strictly required. RM cannot approve.
                </div>
              </div>

              <div style={{ padding: 8, background: 'var(--paper)', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>Supplier Return</b>
                  <Badge variant="ur">Strict FC Gate</Badge>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                  Driver signature + PO/GRPO doc reference + strict FC approval.
                </div>
              </div>
            </div>
          </div>

          {/* Append-Only Ledger Impact Notice */}
          <div className="stub w">
            <span className="lbl kicker">Append-Only Principle</span>
            <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Ledger Outflow (-Q)</h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2)' }}>
              Approved claims append negative physical movements to <code>t_stock_movements</code>:
            </p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--ink-2)' }}>
              <li>
                <code>WASTE_DISPOSAL (-Q)</code>
              </li>
              <li>
                <code>SUPPLIER_RETURN (-Q)</code>
              </li>
            </ul>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
              Records are permanently immutable; deletions are blocked at the database trigger layer.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
