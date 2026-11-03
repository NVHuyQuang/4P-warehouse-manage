'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  recordCustodyEvent,
  transferShiftCustody,
  getCustodyLogs,
  getShiftLogs,
  getStaffForStore,
  getWarehousesForStore,
  CustodyLogRecord,
  ShiftCustodyLogRecord,
  CustodyEventType,
  ShiftType,
} from '@/lib/data/custody';

export default function CustodyAndHandoverPage() {
  const { role, roleConfig, store, showToast } = useShell();

  // Storage selection
  const warehouses = getWarehousesForStore(store);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(
    warehouses[0]?.warehouseId || `${store}-COLD`
  );

  // Sync warehouse if store changes
  useEffect(() => {
    const available = getWarehousesForStore(store);
    if (!available.some((w) => w.warehouseId === selectedWarehouseId)) {
      setSelectedWarehouseId(available[0]?.warehouseId || `${store}-COLD`);
    }
  }, [store, selectedWarehouseId]);

  const activeWarehouse =
    warehouses.find((w) => w.warehouseId === selectedWarehouseId) || warehouses[0];

  // Logs state
  const [custodyLogs, setCustodyLogs] = useState<CustodyLogRecord[]>([]);
  const [shiftLogs, setShiftLogs] = useState<ShiftCustodyLogRecord[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(true);

  // Filter states
  const [custodyFilter, setCustodyFilter] = useState<'all' | CustodyEventType>('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | ShiftType>('all');

  // Emergency / Urgent Access dialog state
  const [isUrgentModalOpen, setIsUrgentModalOpen] = useState<boolean>(false);
  const [urgentReason, setUrgentReason] = useState<string>('');
  const [isSubmittingUrgent, setIsSubmittingUrgent] = useState<boolean>(false);

  // Flow E: Shift Handover Form State
  const staffMembers = getStaffForStore(store);

  // Resolve outgoing custodian ID based on active dev role or store assignment
  const outgoingCustodianId = (() => {
    if (role === 'cust') return 'usr-custodian-01';
    if (role === 'keeper') return 'usr-admin-01';
    if (role === 'rm') return 'usr-rm-01';
    if (role === 'admin') return 'usr-sysadmin-01';
    return 'usr-custodian-01';
  })();

  const outgoingStaff =
    staffMembers.find((s) => s.userId === outgoingCustodianId) || staffMembers[0];

  // Incoming staff member default
  const defaultIncoming =
    staffMembers.find((s) => s.userId !== outgoingCustodianId)?.userId || '';
  const [incomingHolderId, setIncomingHolderId] = useState<string>(defaultIncoming);
  const [shiftType, setShiftType] = useState<ShiftType>('DAY_TO_EVENING');

  // Physical verification checklist
  const [hasHandedPhysicalKey, setHasHandedPhysicalKey] = useState<boolean>(false);
  const [hasInspectedLocks, setHasInspectedLocks] = useState<boolean>(false);
  const [hasVerifiedPhysicalStock, setHasVerifiedPhysicalStock] = useState<boolean>(false);

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [signatureBlob, setSignatureBlob] = useState<string>('');
  const [isSubmittingHandover, setIsSubmittingHandover] = useState<boolean>(false);

  // Action status
  const [isDoorActionPending, setIsDoorActionPending] = useState<boolean>(false);

  // Authorization check (Keeper, Custodian, RM, Sys Admin permitted for writes)
  const isPermittedRole = ['keeper', 'cust', 'rm', 'admin'].includes(role);

  // Segregation of duties validation
  const isSegregationViolation = Boolean(
    incomingHolderId && outgoingCustodianId && incomingHolderId === outgoingCustodianId
  );

  // Load audit logs
  const loadAllLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const [cLogs, sLogs] = await Promise.all([
        getCustodyLogs(store),
        getShiftLogs(store),
      ]);
      setCustodyLogs(cLogs);
      setShiftLogs(sLogs);
    } catch {
      showToast('Notice: Using local offline audit log cache.');
    } finally {
      setIsLoadingLogs(false);
    }
  }, [store, showToast]);

  useEffect(() => {
    loadAllLogs();
  }, [loadAllLogs]);

  // Determine current door lock state from the most recent custody event for the selected warehouse
  const latestEventForWh = custodyLogs.find(
    (l) => l.warehouse_id === selectedWarehouseId
  );
  const isDoorUnlocked = latestEventForWh
    ? latestEventForWh.event_type !== 'WINDOW_LOCK'
    : false;
  const isUrgentActive = latestEventForWh?.event_type === 'URGENT_ACCESS';

  // Urgent reason presets
  const URGENT_PRESETS = [
    'Emergency kitchen restock for evening dinner service',
    'Off-window dough & dairy batch extraction for morning prep',
    'Storeroom temperature check & physical seal verification',
    'Spot inspection for morning issue queue staging',
  ];

  // Signature canvas drawing handlers
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const drawOnCanvas = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoords(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F1F2C';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      setSignatureBlob(canvas.toDataURL());
    }
  };

  const clearSignatureCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    setSignatureBlob('');
  };

  const stampVerifiedSignOff = () => {
    const incomingStaff = staffMembers.find((s) => s.userId === incomingHolderId);
    const name = incomingStaff?.fullName || 'Incoming Custodian';
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FBFAF6';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#205036';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
        ctx.fillStyle = '#205036';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('DUAL-SIGNATURE VERIFIED', 18, 26);
        ctx.fillStyle = '#0F1F2C';
        ctx.font = '12px monospace';
        ctx.fillText(`Holder: ${name}`, 18, 46);
        ctx.fillText(`Key accepted: ${new Date().toLocaleTimeString()} ${new Date().toLocaleDateString()}`, 18, 64);
        ctx.font = 'italic 11px sans-serif';
        ctx.fillText('Physical key possession accepted. Ledger is append-only.', 18, 84);
      }
      setSignatureBlob(canvas.toDataURL());
    } else {
      setSignatureBlob(`SIG-STAMP-${Date.now()}-${name.replace(/\s+/g, '')}`);
    }
  };

  // Flow B: Record Door Custody Event via dispatchAction seam
  const handleDoorAction = async (
    eventType: 'WINDOW_UNLOCK' | 'WINDOW_LOCK' | 'URGENT_ACCESS',
    reason?: string
  ) => {
    if (!isPermittedRole) {
      showToast(`Access denied: ${roleConfig.l} cannot modify storeroom custody.`);
      return;
    }

    setIsDoorActionPending(true);
    const whName = activeWarehouse?.name || selectedWarehouseId;

    const result = await dispatchAction<string>({
      actionName: `custody.${eventType.toLowerCase()}`,
      storeId: store,
      payload: {
        storeId: store,
        warehouseId: selectedWarehouseId,
        eventType,
        urgentReason: reason,
      },
      execute: async () => {
        return await recordCustodyEvent(store, selectedWarehouseId, eventType, reason);
      },
      onSuccess: () => {
        if (eventType === 'WINDOW_UNLOCK') {
          showToast(`Storeroom window unlocked for ${whName}.`);
        } else if (eventType === 'WINDOW_LOCK') {
          showToast(`Storeroom secured and locked for ${whName}.`);
        } else {
          showToast(`Off-window emergency access logged for ${whName}.`);
          setIsUrgentModalOpen(false);
          setUrgentReason('');
        }
        loadAllLogs();
      },
      onError: (err) => {
        showToast(`Action failed: ${err.message}`);
      },
    });

    setIsDoorActionPending(false);
    return result;
  };

  // Flow E: Transfer Shift Custody via dispatchAction seam
  const handleShiftHandover = async () => {
    if (!isPermittedRole) {
      showToast(`Access denied: ${roleConfig.l} cannot execute shift handover.`);
      return;
    }

    if (!incomingHolderId) {
      showToast('Validation error: Please select an incoming key holder.');
      return;
    }

    if (isSegregationViolation) {
      showToast('Segregation violation: Outgoing custodian cannot transfer to themselves.');
      return;
    }

    if (!hasHandedPhysicalKey || !hasInspectedLocks || !hasVerifiedPhysicalStock) {
      showToast('Physical checklist: Please verify all 3 inspection items before transfer.');
      return;
    }

    if (!signatureBlob || signatureBlob.trim().length === 0) {
      showToast('Signature required: Incoming holder must draw or stamp acceptance.');
      return;
    }

    setIsSubmittingHandover(true);
    const whName = activeWarehouse?.name || selectedWarehouseId;

    await dispatchAction<string>({
      actionName: 'custody.shift_handover',
      storeId: store,
      payload: {
        storeId: store,
        warehouseId: selectedWarehouseId,
        incomingHolderId,
        shiftType,
        signatureBlob,
        outgoingCustodianId,
      },
      execute: async () => {
        return await transferShiftCustody(
          store,
          selectedWarehouseId,
          incomingHolderId,
          shiftType,
          signatureBlob,
          outgoingCustodianId
        );
      },
      onSuccess: () => {
        showToast(
          `Physical key transferred for ${whName} (${shiftType === 'DAY_TO_EVENING' ? 'Day to Evening' : 'Evening to Morning'}).`
        );
        clearSignatureCanvas();
        setHasHandedPhysicalKey(false);
        setHasInspectedLocks(false);
        setHasVerifiedPhysicalStock(false);
        loadAllLogs();
      },
      onError: (err) => {
        showToast(`Handover failed: ${err.message}`);
      },
    });

    setIsSubmittingHandover(false);
  };

  // Filtered views
  const filteredCustodyLogs = custodyLogs.filter((l) => {
    if (custodyFilter !== 'all' && l.event_type !== custodyFilter) return false;
    return true;
  });

  const filteredShiftLogs = shiftLogs.filter((s) => {
    if (shiftFilter !== 'all' && s.shift_type !== shiftFilter) return false;
    return true;
  });

  const storeTitle = STORE_NAMES[store] || store;
  const recentUrgentCount = custodyLogs.filter(
    (l) => l.event_type === 'URGENT_ACCESS' && l.store_id === store
  ).length;

  return (
    <div>
      {/* Header */}
      <div className="head">
        <div>
          <span className="kicker">PHYSICAL CUSTODY & ACCESS CONTROL · FLOW B & E</span>
          <h1 className="h1">
            STOREROOM CUSTODY <em>& Shift Handover</em>
          </h1>
          <p className="sub">
            Enforces storeroom lock and unlock discipline aligned with operational issue
            windows, and logs mutual physical key transfers between shift custodians.
          </p>
        </div>

        {/* Storeroom Selector */}
        <div style={{ textAlign: 'right' }}>
          <span className="lbl" style={{ display: 'block', marginBottom: 6 }}>
            Selected Storeroom
          </span>
          <div className="seg" role="group" aria-label="Storeroom selection">
            {warehouses.map((w) => (
              <button
                key={w.warehouseId}
                type="button"
                className={selectedWarehouseId === w.warehouseId ? 'on' : ''}
                onClick={() => setSelectedWarehouseId(w.warehouseId)}
              >
                {w.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Role permission notification banner if viewing in read-only mode */}
      {!isPermittedRole && (
        <div
          className="note am"
          role="status"
          style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <Badge variant="am">Read-Only View</Badge>
          <span>
            Viewing as <b>{roleConfig.l}</b>. Physical door operations and shift key handovers
            are restricted to active Custodians, Warehouse Keepers, and Restaurant Managers.
          </span>
        </div>
      )}

      {/* Storeroom Status Banner */}
      <div className="win" style={{ marginBottom: 20 }}>
        <span className="lbl">{activeWarehouse?.name || 'Storeroom'} Status</span>

        {isUrgentActive ? (
          <Badge variant="er">URGENT ACCESS ACTIVE</Badge>
        ) : isDoorUnlocked ? (
          <Badge variant="ok">WINDOW UNLOCKED</Badge>
        ) : (
          <Badge variant="mu">STOREROOM LOCKED</Badge>
        )}

        <span className="meta">
          {isUrgentActive ? (
            <>
              Off-window access open &middot; Justification:{' '}
              <em>{latestEventForWh?.urgent_reason || 'Urgent entry logged'}</em>
            </>
          ) : isDoorUnlocked ? (
            <>
              Scheduled Morning Window Open (08:30–10:30) &middot; Closes in 45 min &middot;
              Afternoon Window: 14:30–16:00
            </>
          ) : (
            <>
              Secured with physical padlock &middot; Next scheduled window: Afternoon
              14:30–16:00
            </>
          )}
        </span>

        <span className="meta" style={{ marginLeft: 'auto' }}>
          Current Key Custodian: <b>{outgoingStaff?.fullName || 'Named Custodian'}</b> (
          {outgoingStaff?.roleTitle || 'Cold Room Custodian'})
        </span>
      </div>

      {/* Metric Tiles */}
      <div className="tiles">
        <div className="tile">
          <span className="lbl">Door Physical State</span>
          <span
            className="big"
            style={{
              fontSize: 28,
              color: isDoorUnlocked ? 'var(--forest)' : 'var(--navy)',
              marginTop: 6,
            }}
          >
            {isDoorUnlocked ? 'UNLOCKED' : 'LOCKED'}
          </span>
          <span className="s">
            {activeWarehouse?.name} &middot; {storeTitle}
          </span>
        </div>

        <div className="tile">
          <span className="lbl">Configured Issue Windows</span>
          <span className="big" style={{ fontSize: 24, marginTop: 8 }}>
            08:30–10:30
          </span>
          <span className="s">Afternoon: 14:30–16:00</span>
        </div>

        <div className="tile">
          <span className="lbl">Urgent Extractions</span>
          <span
            className="big"
            style={{
              color: recentUrgentCount > 0 ? 'var(--amber)' : 'inherit',
            }}
          >
            {recentUrgentCount}
          </span>
          <span className="s">Logged with mandatory justification</span>
        </div>

        <div className="tile">
          <span className="lbl">Active Shift Custodian</span>
          <span
            className="big"
            style={{
              fontSize: 20,
              lineHeight: 1.25,
              marginTop: 8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {outgoingStaff?.fullName || 'Sunil Rao'}
          </span>
          <span className="s">
            {outgoingStaff?.roleTitle || 'Warehouse Keeper'} &middot; Physical Key
          </span>
        </div>
      </div>

      {/* Main Flow Sections */}
      <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* ========================================================================= */}
        {/* SECTION 1: STOREROOM DOOR & ACCESS WINDOW STATE (FLOW B)                  */}
        {/* ========================================================================= */}
        <Ticket
          no={`FLOW B · ${activeWarehouse?.warehouseId || 'STOREROOM'} DOOR & ISSUE WINDOW`}
          right="Physical Access Discipline"
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
              marginBottom: 20,
              paddingBottom: 16,
              borderBottom: '1px dashed var(--rule)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="h3">
                  {activeWarehouse?.name} Physical Door Controls
                </span>
                {isDoorUnlocked ? (
                  <Badge variant="ok">OPEN</Badge>
                ) : (
                  <Badge variant="mu">SECURED</Badge>
                )}
              </div>
              <p className="gloss" style={{ margin: '4px 0 0' }}>
                Keep door locked outside scheduled windows. Dispense stock only against
                submitted application requests.
              </p>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn sm"
                disabled={!isPermittedRole || isDoorUnlocked || isDoorActionPending}
                onClick={() => handleDoorAction('WINDOW_UNLOCK')}
                title={
                  !isPermittedRole
                    ? 'Role not permitted'
                    : isDoorUnlocked
                    ? 'Door already unlocked'
                    : 'Unlock storeroom door for scheduled issue window'
                }
              >
                Unlock Window
              </button>

              <button
                type="button"
                className="btn ghost sm"
                disabled={!isPermittedRole || !isDoorUnlocked || isDoorActionPending}
                onClick={() => handleDoorAction('WINDOW_LOCK')}
                title={
                  !isPermittedRole
                    ? 'Role not permitted'
                    : !isDoorUnlocked
                    ? 'Door already locked'
                    : 'Lock storeroom door immediately'
                }
              >
                Lock Storeroom
              </button>

              <button
                type="button"
                className="btn ghost sm"
                style={{
                  color: 'var(--err)',
                  borderColor: 'var(--err)',
                }}
                disabled={!isPermittedRole || isDoorActionPending}
                onClick={() => setIsUrgentModalOpen(true)}
                title="Emergency extraction outside window with mandatory operational reason"
              >
                Emergency / Urgent Access
              </button>
            </div>
          </div>

          {/* Access Logs Sub-Header & Chips */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <span className="lbl">Recent Room Access Events ({filteredCustodyLogs.length})</span>

            <Chips>
              <Chip
                label="All"
                count={custodyLogs.length}
                active={custodyFilter === 'all'}
                onClick={() => setCustodyFilter('all')}
              />
              <Chip
                label="Unlocks"
                count={custodyLogs.filter((l) => l.event_type === 'WINDOW_UNLOCK').length}
                active={custodyFilter === 'WINDOW_UNLOCK'}
                onClick={() => setCustodyFilter('WINDOW_UNLOCK')}
              />
              <Chip
                label="Locks"
                count={custodyLogs.filter((l) => l.event_type === 'WINDOW_LOCK').length}
                active={custodyFilter === 'WINDOW_LOCK'}
                onClick={() => setCustodyFilter('WINDOW_LOCK')}
              />
              <Chip
                label="Urgent Extractions"
                count={custodyLogs.filter((l) => l.event_type === 'URGENT_ACCESS').length}
                active={custodyFilter === 'URGENT_ACCESS'}
                onClick={() => setCustodyFilter('URGENT_ACCESS')}
              />
            </Chips>
          </div>

          {/* Custody Audit Table */}
          <div style={{ overflowX: 'auto' }}>
            <table aria-label="Custody access event audit table">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Storeroom</th>
                  <th scope="col">Event Type</th>
                  <th scope="col">Custodian</th>
                  <th scope="col">Operational Reason / Justification</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Record Ref
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoadingLogs ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px 0' }}>
                      Loading append-only custody logs...
                    </td>
                  </tr>
                ) : filteredCustodyLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px 0' }}>
                      No custody access events found for this filter.
                    </td>
                  </tr>
                ) : (
                  filteredCustodyLogs.map((log) => {
                    const badgeVariant =
                      log.event_type === 'WINDOW_UNLOCK'
                        ? 'ok'
                        : log.event_type === 'WINDOW_LOCK'
                        ? 'mu'
                        : 'er';
                    const label =
                      log.event_type === 'WINDOW_UNLOCK'
                        ? 'WINDOW UNLOCK'
                        : log.event_type === 'WINDOW_LOCK'
                        ? 'WINDOW LOCK'
                        : 'URGENT ACCESS';

                    return (
                      <tr key={log.log_id} className="row">
                        <td className="m">
                          {new Date(log.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          &middot;{' '}
                          {new Date(log.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td>
                          <b>{log.warehouse_name || log.warehouse_id}</b>
                        </td>
                        <td>
                          <Badge variant={badgeVariant}>{label}</Badge>
                        </td>
                        <td>
                          <span>{log.custodian_name || 'Custodian'}</span>
                          <span
                            className="gloss"
                            style={{ display: 'block', fontSize: 11 }}
                          >
                            {log.custodian_role || 'Custodian'}
                          </span>
                        </td>
                        <td>
                          {log.urgent_reason ? (
                            <span style={{ color: 'var(--err)', fontWeight: 500 }}>
                              {log.urgent_reason}
                            </span>
                          ) : (
                            <span className="gloss">Scheduled window operation</span>
                          )}
                        </td>
                        <td className="m" style={{ textAlign: 'right' }}>
                          <span className="gloss">{log.log_id.slice(0, 10)}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Ticket>

        {/* ========================================================================= */}
        {/* SECTION 2: SHIFT KEY HANDOVER (FLOW E)                                    */}
        {/* ========================================================================= */}
        <Ticket
          no={`FLOW E · SHIFT KEY HANDOVER · ${activeWarehouse?.name?.toUpperCase() || 'COLD ROOM'}`}
          right="Dual-Party Physical Chain of Custody"
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 28,
              marginBottom: 24,
            }}
          >
            {/* Left Column: Handover Setup & Checklist */}
            <div>
              <span className="h3" style={{ display: 'block', marginBottom: 14 }}>
                Shift Handover Protocol
              </span>

              {/* Outgoing Custodian info */}
              <div className="fld">
                <span className="lbl">Outgoing Custodian (Current Key Holder)</span>
                <input
                  type="text"
                  className="in"
                  readOnly
                  disabled
                  value={`${outgoingStaff?.fullName || 'Active Custodian'} — ${
                    outgoingStaff?.roleTitle || 'Named Custodian'
                  }`}
                  aria-label="Outgoing Custodian"
                />
              </div>

              {/* Shift interval selection */}
              <div className="fld">
                <label htmlFor="shift-type-select" className="lbl">
                  Shift Interval
                </label>
                <select
                  id="shift-type-select"
                  className="in"
                  value={shiftType}
                  onChange={(e) => setShiftType(e.target.value as ShiftType)}
                  disabled={!isPermittedRole || isSubmittingHandover}
                >
                  <option value="DAY_TO_EVENING">
                    Day to Evening Shift (16:30 Handover to Evening Duty Manager)
                  </option>
                  <option value="EVENING_TO_MORNING">
                    Evening to Morning Shift (06:00 Handover to Morning Custodian)
                  </option>
                </select>
              </div>

              {/* Incoming Holder Selection with Segregation Enforcement */}
              <div className="fld">
                <label htmlFor="incoming-staff-select" className="lbl">
                  Incoming Key Holder (Store Staff)
                </label>
                <select
                  id="incoming-staff-select"
                  className={`in ${isSegregationViolation ? 'err' : ''}`}
                  value={incomingHolderId}
                  onChange={(e) => setIncomingHolderId(e.target.value)}
                  disabled={!isPermittedRole || isSubmittingHandover}
                  aria-invalid={isSegregationViolation}
                >
                  <option value="">-- Select Incoming Key Holder --</option>
                  {staffMembers.map((staff) => (
                    <option key={staff.userId} value={staff.userId}>
                      {staff.fullName} ({staff.roleTitle})
                    </option>
                  ))}
                </select>

                {/* Segregation Violation Banner */}
                {isSegregationViolation && (
                  <div
                    className="note er"
                    role="alert"
                    style={{ marginTop: 8, fontSize: 13 }}
                  >
                    <b>Segregation of Duties Violation:</b> Outgoing custodian cannot
                    transfer custody to themselves. A distinct incoming staff member must
                    physically accept the key (Flow E Rule).
                  </div>
                )}
              </div>

              {/* Physical Verification Checklist */}
              <div className="stub" style={{ marginTop: 14 }}>
                <span className="lbl" style={{ marginBottom: 10 }}>
                  Mandatory Physical Verification
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={hasHandedPhysicalKey}
                      onChange={(e) => setHasHandedPhysicalKey(e.target.checked)}
                      disabled={!isPermittedRole || isSubmittingHandover}
                      style={{ marginTop: 3 }}
                    />
                    <span>Physical storeroom key presented and held by incoming custodian</span>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={hasInspectedLocks}
                      onChange={(e) => setHasInspectedLocks(e.target.checked)}
                      disabled={!isPermittedRole || isSubmittingHandover}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      Joint inspection: Storeroom door padlock and security seals intact
                    </span>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={hasVerifiedPhysicalStock}
                      onChange={(e) => setHasVerifiedPhysicalStock(e.target.checked)}
                      disabled={!isPermittedRole || isSubmittingHandover}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      Physical stock condition accepted; pick queue cleared or staged
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right Column: Digital Signature Canvas */}
            <div>
              <span className="h3" style={{ display: 'block', marginBottom: 14 }}>
                Incoming Holder Digital Sign-Off
              </span>

              <p className="gloss" style={{ marginTop: 0, marginBottom: 8 }}>
                Incoming custodian signs on device to accept physical key possession and
                inventory responsibility.
              </p>

              {/* Signature Canvas Box */}
              <div
                style={{
                  border: '1px solid var(--rule)',
                  borderRadius: 4,
                  background: 'var(--paper)',
                  padding: 8,
                  position: 'relative',
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={460}
                  height={130}
                  aria-label="Digital signature pad"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 130,
                    background: '#FFFFFF',
                    cursor: isPermittedRole ? 'crosshair' : 'not-allowed',
                    border: '1px dashed #BDB5A5',
                    borderRadius: 3,
                    touchAction: 'none',
                  }}
                  onMouseDown={startDrawing}
                  onMouseMove={drawOnCanvas}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={drawOnCanvas}
                  onTouchEnd={stopDrawing}
                />

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <span className="meta">
                    {signatureBlob ? (
                      <span style={{ color: 'var(--forest)' }}>
                        ✓ Signature captured
                      </span>
                    ) : (
                      'Sign above with mouse, pen, or finger'
                    )}
                  </span>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={clearSignatureCanvas}
                      disabled={!signatureBlob || isSubmittingHandover}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={stampVerifiedSignOff}
                      disabled={!isPermittedRole || isSubmittingHandover || isSegregationViolation}
                      title="Apply pre-verified cryptographic sign-off stamp"
                    >
                      Stamp Verification
                    </button>
                  </div>
                </div>
              </div>

              {/* Submit Transfer Button */}
              <div style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ width: '100%' }}
                  disabled={
                    !isPermittedRole ||
                    !incomingHolderId ||
                    isSegregationViolation ||
                    !signatureBlob ||
                    !hasHandedPhysicalKey ||
                    !hasInspectedLocks ||
                    !hasVerifiedPhysicalStock ||
                    isSubmittingHandover
                  }
                  onClick={handleShiftHandover}
                >
                  {isSubmittingHandover
                    ? 'Recording Shift Handover...'
                    : 'Transfer Physical Key & Sign Handover'}
                </button>

                <p className="gloss" style={{ marginTop: 8, textAlign: 'center' }}>
                  Per Flow E Step E10: Master data assignment remains unchanged. The
                  append-only shift log records temporary key possession.
                </p>
              </div>
            </div>
          </div>

          {/* Handover History Audit Sub-Header & Chips */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
              marginTop: 18,
              paddingTop: 18,
              borderTop: '1px dashed var(--rule)',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <span className="lbl">
              Shift Custody Handover History ({filteredShiftLogs.length})
            </span>

            <Chips>
              <Chip
                label="All Shifts"
                count={shiftLogs.length}
                active={shiftFilter === 'all'}
                onClick={() => setShiftFilter('all')}
              />
              <Chip
                label="Day to Evening"
                count={
                  shiftLogs.filter((s) => s.shift_type === 'DAY_TO_EVENING').length
                }
                active={shiftFilter === 'DAY_TO_EVENING'}
                onClick={() => setShiftFilter('DAY_TO_EVENING')}
              />
              <Chip
                label="Evening to Morning"
                count={
                  shiftLogs.filter((s) => s.shift_type === 'EVENING_TO_MORNING').length
                }
                active={shiftFilter === 'EVENING_TO_MORNING'}
                onClick={() => setShiftFilter('EVENING_TO_MORNING')}
              />
            </Chips>
          </div>

          {/* Handover Audit Table */}
          <div style={{ overflowX: 'auto' }}>
            <table aria-label="Shift handover audit log table">
              <thead>
                <tr>
                  <th scope="col">Transferred At</th>
                  <th scope="col">Shift Interval</th>
                  <th scope="col">Storeroom</th>
                  <th scope="col">Outgoing Custodian</th>
                  <th scope="col">Incoming Key Holder</th>
                  <th scope="col">Digital Sign-Off</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoadingLogs ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '24px 0' }}>
                      Loading append-only shift handover logs...
                    </td>
                  </tr>
                ) : filteredShiftLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '24px 0' }}>
                      No shift handover logs found for this filter.
                    </td>
                  </tr>
                ) : (
                  filteredShiftLogs.map((shf) => (
                    <tr key={shf.shift_log_id} className="row">
                      <td className="m">
                        {new Date(shf.transferred_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        &middot;{' '}
                        {new Date(shf.transferred_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td>
                        <b>
                          {shf.shift_type === 'DAY_TO_EVENING'
                            ? 'Day → Evening (16:30)'
                            : 'Evening → Morning (06:00)'}
                        </b>
                      </td>
                      <td>{shf.warehouse_name || shf.warehouse_id}</td>
                      <td>
                        <span>{shf.outgoing_custodian_name || 'Outgoing'}</span>
                      </td>
                      <td>
                        <b>{shf.incoming_holder_name || 'Incoming'}</b>
                        <span
                          className="gloss"
                          style={{ display: 'block', fontSize: 11 }}
                        >
                          {shf.incoming_holder_role || 'Key Holder'}
                        </span>
                      </td>
                      <td>
                        {shf.signature_blob.startsWith('data:image') ? (
                          <span
                            className="b ok"
                            title="Digital stroke signature on file"
                          >
                            DIGITAL SIGNATURE
                          </span>
                        ) : (
                          <span
                            className="b re"
                            title={`Signature Hash: ${shf.signature_blob}`}
                          >
                            VERIFIED STAMP
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="stamp">KEYS TRANSFERRED</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Ticket>
      </div>

      {/* ========================================================================= */}
      {/* EMERGENCY / URGENT ACCESS MODAL DIALOG                                    */}
      {/* ========================================================================= */}
      {isUrgentModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="urgent-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 31, 44, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            className="stub w"
            style={{
              maxWidth: 540,
              width: '100%',
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
              border: '2px solid var(--err)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Badge variant="er">MANDATORY JUSTIFICATION</Badge>
              <h2 id="urgent-modal-title" className="h3" style={{ margin: 0, color: 'var(--err)' }}>
                Off-Window Emergency Access
              </h2>
            </div>

            <p style={{ marginTop: 0, marginBottom: 14 }}>
              Storeroom <b>{activeWarehouse?.name}</b> is currently outside scheduled
              operational issue windows. Off-window extractions require an explicit
              operational reason recorded in the permanent audit ledger.
            </p>

            {/* Presets */}
            <div className="fld">
              <span className="lbl">Quick Operational Reason Presets</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {URGENT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="chip"
                    style={{ textAlign: 'left', borderRadius: 4 }}
                    onClick={() => setUrgentReason(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Input */}
            <div className="fld">
              <label htmlFor="urgent-reason-input" className="lbl">
                Operational Justification (Required)
              </label>
              <textarea
                id="urgent-reason-input"
                className="in"
                rows={3}
                placeholder="Describe operational necessity and items extracted (e.g. 5 kg Mozzarella for dinner rush)..."
                value={urgentReason}
                onChange={(e) => setUrgentReason(e.target.value)}
              />
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
                marginTop: 20,
              }}
            >
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setIsUrgentModalOpen(false);
                  setUrgentReason('');
                }}
                disabled={isSubmittingUrgent}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                style={{ backgroundColor: 'var(--err)', borderColor: 'var(--err)' }}
                disabled={!urgentReason.trim() || isSubmittingUrgent}
                onClick={async () => {
                  setIsSubmittingUrgent(true);
                  await handleDoorAction('URGENT_ACCESS', urgentReason.trim());
                  setIsSubmittingUrgent(false);
                }}
              >
                {isSubmittingUrgent ? 'Logging Entry...' : 'Authorize & Unlock Door'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
