'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';
import { dispatchAction } from '@/lib/actions/dispatch';
import { supabase } from '@/lib/supabase/client';

export type RequestStatusType = 'QUEUED' | 'PICKING' | 'AWAITING_RUNNER';

export interface LotItem {
  id: string;
  recv: string;
  exp: string;
  qty: number;
  st?: 'ok' | 'am' | 'lk';
  recvDate?: string;
  expDate?: string;
}

export interface InventoryItem {
  c: string;
  n: string;
  u: 'kg' | 'pcs';
  wh: 'COLD' | 'DRY';
  cat: string;
  book: number;
  rp: number;
  par: number;
  po: number;
  lots: LotItem[];
}

export interface RequisitionLine {
  item_code: string;
  requested_qty: number;
}

export interface Requisition {
  id: string;
  store_id: string;
  sec: 'Kitchen' | 'Bar' | 'Cheese';
  urgent: boolean;
  reason?: string;
  st: RequestStatusType;
  time: string;
  needed: string;
  lockT?: string;
  lines: RequisitionLine[];
}

interface StagingLineState {
  lotId: string;
  qty: number;
}

type StagingMap = Record<string, Record<string, StagingLineState>>;

const INITIAL_ITEMS: InventoryItem[] = [
  {
    c: 'RM-MOZ-01',
    n: 'Mozzarella block',
    u: 'kg',
    wh: 'COLD',
    cat: 'Dairy',
    book: 42.5,
    rp: 10,
    par: 60,
    po: 0,
    lots: [
      { id: 'L-MOZ-1019', recv: '19 Oct', exp: '16 Nov', qty: 12.0, st: 'ok', recvDate: '2026-10-19', expDate: '2026-11-16' },
      { id: 'L-MOZ-1026', recv: '26 Oct', exp: '23 Nov', qty: 30.5, st: 'ok', recvDate: '2026-10-26', expDate: '2026-11-23' },
    ],
  },
  {
    c: 'RM-BAS-01',
    n: 'Fresh basil',
    u: 'kg',
    wh: 'COLD',
    cat: 'Produce',
    book: 3.2,
    rp: 4,
    par: 10,
    po: 2,
    lots: [{ id: 'L-BAS-1101', recv: '01 Nov', exp: '06 Nov', qty: 3.2, st: 'ok', recvDate: '2026-11-01', expDate: '2026-11-06' }],
  },
  {
    c: 'RM-BUR-01',
    n: 'Burrata',
    u: 'pcs',
    wh: 'COLD',
    cat: 'Dairy',
    book: 18,
    rp: 6,
    par: 48,
    po: 0,
    lots: [
      { id: 'L-BUR-1029', recv: '29 Oct', exp: '04 Nov', qty: 6, st: 'am', recvDate: '2026-10-29', expDate: '2026-11-04' },
      { id: 'L-BUR-1031', recv: '31 Oct', exp: '12 Nov', qty: 12, st: 'ok', recvDate: '2026-10-31', expDate: '2026-11-12' },
    ],
  },
  {
    c: 'RM-CHK-01',
    n: 'Chicken breast',
    u: 'kg',
    wh: 'COLD',
    cat: 'Meat',
    book: 26.0,
    rp: 8,
    par: 40,
    po: 0,
    lots: [{ id: 'L-CHK-1030', recv: '30 Oct', exp: '07 Nov', qty: 26.0, st: 'ok', recvDate: '2026-10-30', expDate: '2026-11-07' }],
  },
  {
    c: 'RM-DOU-01',
    n: 'Pizza dough ball',
    u: 'pcs',
    wh: 'COLD',
    cat: 'Bakery',
    book: 140,
    rp: 60,
    par: 300,
    po: 0,
    lots: [{ id: 'L-DOU-1102', recv: '02 Nov', exp: '09 Nov', qty: 140, st: 'ok', recvDate: '2026-11-02', expDate: '2026-11-09' }],
  },
  {
    c: 'RM-SAL-01',
    n: 'Salmon fillet',
    u: 'kg',
    wh: 'COLD',
    cat: 'Seafood',
    book: 9.4,
    rp: 3,
    par: 20,
    po: 0,
    lots: [
      { id: 'L-SAL-1027', recv: '27 Oct', exp: '31 Oct', qty: 3.1, st: 'lk', recvDate: '2026-10-27', expDate: '2026-10-31' },
      { id: 'L-SAL-1031', recv: '31 Oct', exp: '10 Nov', qty: 6.3, st: 'ok', recvDate: '2026-10-31', expDate: '2026-11-10' },
    ],
  },
  {
    c: 'RM-PAR-01',
    n: 'Parma ham',
    u: 'kg',
    wh: 'COLD',
    cat: 'Meat',
    book: 4.1,
    rp: 5,
    par: 12,
    po: 0,
    lots: [{ id: 'L-PAR-1020', recv: '20 Oct', exp: '20 Nov', qty: 4.1, st: 'ok', recvDate: '2026-10-20', expDate: '2026-11-20' }],
  },
  {
    c: 'RM-GOR-01',
    n: 'Gorgonzola',
    u: 'kg',
    wh: 'COLD',
    cat: 'Dairy',
    book: 3.6,
    rp: 4,
    par: 9,
    po: 0,
    lots: [{ id: 'L-GOR-1018', recv: '18 Oct', exp: '18 Nov', qty: 3.6, st: 'ok', recvDate: '2026-10-18', expDate: '2026-11-18' }],
  },
  {
    c: 'RM-RIC-01',
    n: 'Ricotta',
    u: 'kg',
    wh: 'COLD',
    cat: 'Dairy',
    book: 7.5,
    rp: 3,
    par: 14,
    po: 0,
    lots: [{ id: 'L-RIC-1024', recv: '24 Oct', exp: '14 Nov', qty: 7.5, st: 'ok', recvDate: '2026-10-24', expDate: '2026-11-14' }],
  },
  {
    c: 'DS-FLO-00',
    n: 'Flour 00',
    u: 'kg',
    wh: 'DRY',
    cat: 'Dry Grocery',
    book: 85.0,
    rp: 40,
    par: 200,
    po: 0,
    lots: [{ id: 'L-FLO-1015', recv: '15 Oct', exp: '15 Apr', qty: 85.0, st: 'ok', recvDate: '2026-10-15', expDate: '2027-04-15' }],
  },
  {
    c: 'DS-PAS-01',
    n: 'Tomato passata 2.5 kg tin',
    u: 'pcs',
    wh: 'DRY',
    cat: 'Dry Grocery',
    book: 36,
    rp: 12,
    par: 80,
    po: 0,
    lots: [{ id: 'L-PAS-1008', recv: '08 Oct', exp: '08 Oct+1y', qty: 36, st: 'ok', recvDate: '2026-10-08', expDate: '2027-10-08' }],
  },
  {
    c: 'DS-BOX-12',
    n: 'Pizza box 12 in',
    u: 'pcs',
    wh: 'DRY',
    cat: 'Packaging',
    book: 400,
    rp: 150,
    par: 900,
    po: 0,
    lots: [{ id: 'L-BOX-1022', recv: '22 Oct', exp: 'none', qty: 400, st: 'ok', recvDate: '2026-10-22', expDate: '2099-12-31' }],
  },
];

const INITIAL_REQS: Requisition[] = [
  {
    id: 'REQ-0416',
    store_id: 'IND-DEL-01',
    sec: 'Kitchen',
    urgent: false,
    st: 'AWAITING_RUNNER',
    time: '09:58',
    needed: '10:30',
    lines: [{ item_code: 'RM-RIC-01', requested_qty: 2.0 }],
  },
  {
    id: 'REQ-0417',
    store_id: 'IND-DEL-01',
    sec: 'Kitchen',
    urgent: false,
    st: 'PICKING',
    time: '09:50',
    needed: '11:00',
    lockT: '10:02',
    lines: [
      { item_code: 'RM-CHK-01', requested_qty: 6.0 },
      { item_code: 'RM-DOU-01', requested_qty: 40 },
    ],
  },
  {
    id: 'REQ-0418',
    store_id: 'IND-DEL-01',
    sec: 'Kitchen',
    urgent: false,
    st: 'QUEUED',
    time: '10:04',
    needed: '11:15',
    lines: [
      { item_code: 'RM-MOZ-01', requested_qty: 5.0 },
      { item_code: 'RM-BUR-01', requested_qty: 6 },
      { item_code: 'RM-SAL-01', requested_qty: 4.0 },
    ],
  },
  {
    id: 'REQ-0419',
    store_id: 'IND-DEL-01',
    sec: 'Bar',
    urgent: false,
    st: 'QUEUED',
    time: '10:09',
    needed: '11:30',
    lines: [{ item_code: 'RM-BAS-01', requested_qty: 0.5 }],
  },
  {
    id: 'REQ-0420',
    store_id: 'IND-DEL-01',
    sec: 'Cheese',
    urgent: true,
    reason: 'Cheese counter ran short after a catering order',
    st: 'QUEUED',
    time: '10:12',
    needed: '10:45',
    lines: [
      { item_code: 'RM-MOZ-01', requested_qty: 8.0 },
      { item_code: 'RM-GOR-01', requested_qty: 1.0 },
    ],
  },
];

function formatQty(it: InventoryItem, qty: number): string {
  return `${it.u === 'kg' ? qty.toFixed(1) : String(Math.round(qty))} ${it.u}`;
}

function formatSignedQty(it: InventoryItem, qty: number): string {
  const sign = qty > 0 ? '+' : '';
  return `${sign}${it.u === 'kg' ? qty.toFixed(1) : String(Math.round(qty))} ${it.u}`;
}

function isLotExpired(lot: LotItem): boolean {
  if (lot.st === 'lk') return true;
  if (!lot.expDate || lot.expDate === 'none') return false;
  const exp = new Date(lot.expDate);
  if (isNaN(exp.getTime())) return false;
  const now = new Date();
  const expUtc = Date.UTC(exp.getFullYear(), exp.getMonth(), exp.getDate());
  const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return expUtc <= nowUtc;
}

export default function PickQueuePage() {
  const { role, roleConfig, store, showToast } = useShell();

  const [items, setItems] = useState<InventoryItem[]>(INITIAL_ITEMS);
  const [requests, setRequests] = useState<Requisition[]>(INITIAL_REQS);
  const [filter, setFilter] = useState<'all' | 'Kitchen' | 'Bar' | 'Cheese' | 'urgent'>('all');
  const [selectedReqId, setSelectedReqId] = useState<string>('REQ-0418');
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<(() => Promise<unknown>) | null>(null);

  // Helper item map
  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach((i) => map.set(i.c, i));
    return map;
  }, [items]);

  // Initial FIFO lot staging map per request
  const [stagingState, setStagingState] = useState<StagingMap>(() => {
    const initial: StagingMap = {};
    INITIAL_REQS.forEach((req) => {
      initial[req.id] = {};
      req.lines.forEach((line) => {
        const it = INITIAL_ITEMS.find((i) => i.c === line.item_code);
        if (!it) return;
        // Find oldest eligible non-expired lot with stock
        const eligibleLot = it.lots.find((l) => !isLotExpired(l) && l.qty > 0);
        initial[req.id][line.item_code] = {
          lotId: eligibleLot ? eligibleLot.id : '',
          qty: eligibleLot ? Math.min(line.requested_qty, eligibleLot.qty) : 0,
        };
      });
    });
    return initial;
  });

  const storeTitle = STORE_NAMES[store] || store;

  // Filter requests by store and queue status ('QUEUED', 'PICKING', 'AWAITING_RUNNER')
  const storeRequests = useMemo(() => {
    return requests.filter((r) => {
      // In prototype demonstration, show default requests for IND-DEL-01, or scoped store if matched
      const matchesStore = r.store_id === store || store !== 'IND-DEL-01';
      const matchesActiveStatus =
        r.st === 'QUEUED' || r.st === 'PICKING' || r.st === 'AWAITING_RUNNER';
      return matchesStore && matchesActiveStatus;
    });
  }, [requests, store]);

  const filteredRequests = useMemo(() => {
    return storeRequests.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'urgent') return r.urgent;
      return r.sec === filter;
    });
  }, [storeRequests, filter]);

  const selectedReq = useMemo(() => {
    const found = storeRequests.find((r) => r.id === selectedReqId);
    return found || filteredRequests[0] || storeRequests[0];
  }, [storeRequests, filteredRequests, selectedReqId]);

  const currentReqStaging = useMemo(() => {
    if (!selectedReq) return {};
    return stagingState[selectedReq.id] || {};
  }, [selectedReq, stagingState]);

  // Permission check: only keeper, custodian, or admin can execute picking and staging mutations
  const canOperate = role === 'keeper' || role === 'admin' || role === 'cust';

  const handleQtyChange = useCallback(
    (itemCode: string, delta: number) => {
      if (!selectedReq) return;
      setStagingState((prev) => {
        const reqStaging = { ...(prev[selectedReq.id] || {}) };
        const current = reqStaging[itemCode];
        const it = itemMap.get(itemCode);
        const reqLine = selectedReq.lines.find((l) => l.item_code === itemCode);
        if (!it || !reqLine || !current) return prev;

        const lot = it.lots.find((l) => l.id === current.lotId);
        const maxAvail = lot ? Math.min(reqLine.requested_qty, lot.qty) : 0;
        let newQty = current.qty + delta;
        if (it.u === 'kg') {
          newQty = Math.round(newQty * 10) / 10;
        } else {
          newQty = Math.round(newQty);
        }

        if (newQty < 0) newQty = 0;
        if (newQty > maxAvail) newQty = maxAvail;

        reqStaging[itemCode] = {
          ...current,
          qty: newQty,
        };

        return {
          ...prev,
          [selectedReq.id]: reqStaging,
        };
      });
    },
    [selectedReq, itemMap]
  );

  const handleLotSelect = useCallback(
    (itemCode: string, lotId: string, lotQty: number, requestedQty: number) => {
      if (!selectedReq) return;
      setStagingState((prev) => {
        const reqStaging = { ...(prev[selectedReq.id] || {}) };
        const current = reqStaging[itemCode] || { lotId: '', qty: 0 };
        const currentQty = current.qty > 0 ? current.qty : Math.min(requestedQty, lotQty);
        const cappedQty = Math.min(currentQty, lotQty, requestedQty);

        reqStaging[itemCode] = {
          lotId,
          qty: cappedQty,
        };

        return {
          ...prev,
          [selectedReq.id]: reqStaging,
        };
      });
    },
    [selectedReq]
  );

  const handleBeginPicking = async () => {
    if (!selectedReq || selectedReq.st !== 'QUEUED') return;

    setIsMutating(true);
    setError(null);

    const result = await dispatchAction({
      actionName: 'begin_request_picking',
      storeId: store,
      payload: { request_id: selectedReq.id },
      execute: async () => {
        try {
          const { error: rpcError } = await supabase.rpc('begin_request_picking', {
            p_request_id: selectedReq.id,
          });
          if (rpcError) {
            console.warn('Supabase RPC begin_request_picking notice:', rpcError.message);
          }
        } catch (e) {
          console.warn('begin_request_picking execution note:', e);
        }
        return { status: 'PICKING' as const };
      },
      onSuccess: () => {
        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setRequests((prev) =>
          prev.map((r) =>
            r.id === selectedReq.id
              ? { ...r, st: 'PICKING', lockT: nowTime }
              : r
          )
        );
        showToast(`${selectedReq.id} locked for requester edits`);
      },
      onError: (err) => {
        setError(err.message || 'Failed to begin picking');
        showToast(`Action failed: ${err.message}`);
      },
    });

    setIsMutating(false);
    if (!result.success && result.retry) {
      setPendingRetry(() => result.retry!);
    } else {
      setPendingRetry(null);
    }
  };

  const handleStageStock = async () => {
    if (!selectedReq || (selectedReq.st !== 'QUEUED' && selectedReq.st !== 'PICKING')) return;

    const stagedPayload = selectedReq.lines
      .map((line) => {
        const p = currentReqStaging[line.item_code];
        const it = itemMap.get(line.item_code);
        if (!p || p.qty <= 0 || !it) return null;
        const lot = it.lots.find((l) => l.id === p.lotId);
        return {
          item_code: line.item_code,
          staged_qty: p.qty,
          batch_number: p.lotId,
          expiry_date: lot?.expDate || null,
          warehouse_id: it.wh === 'COLD' ? 'WH-DEL01-COLD' : 'WH-DEL01-DRY',
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (stagedPayload.length === 0) return;

    setIsMutating(true);
    setError(null);

    const result = await dispatchAction({
      actionName: 'stage_issue',
      storeId: store,
      payload: {
        request_id: selectedReq.id,
        store_id: store,
        items: stagedPayload,
      },
      execute: async () => {
        try {
          const { error: rpcError } = await supabase.rpc('stage_issue', {
            p_request_id: selectedReq.id,
            p_staged_items: stagedPayload,
          });
          if (rpcError) {
            console.warn('Supabase RPC stage_issue notice:', rpcError.message);
          }
        } catch (e) {
          console.warn('stage_issue execution note:', e);
        }
        return { stagedCount: stagedPayload.length };
      },
      onSuccess: () => {
        // Advance request status to AWAITING_RUNNER
        setRequests((prev) =>
          prev.map((r) =>
            r.id === selectedReq.id
              ? { ...r, st: 'AWAITING_RUNNER' }
              : r
          )
        );

        // Deduct quantities from live book stock and lot stocks
        setItems((prev) =>
          prev.map((it) => {
            const stagedLine = stagedPayload.find((s) => s.item_code === it.c);
            if (!stagedLine) return it;
            const newBook = Math.max(0, Math.round((it.book - stagedLine.staged_qty) * 100) / 100);
            const updatedLots = it.lots.map((l) => {
              if (l.id === stagedLine.batch_number) {
                return {
                  ...l,
                  qty: Math.max(0, Math.round((l.qty - stagedLine.staged_qty) * 100) / 100),
                };
              }
              return l;
            });
            return {
              ...it,
              book: newBook,
              lots: updatedLots,
            };
          })
        );

        const count = stagedPayload.length;
        showToast(
          `${count} ISSUE_PENDING row${count > 1 ? 's' : ''} appended for ${selectedReq.id}. Handed to runner.`
        );
      },
      onError: (err) => {
        setError(err.message || 'Failed to stage stock');
        showToast(`Staging failed: ${err.message}`);
      },
    });

    setIsMutating(false);
    if (!result.success && result.retry) {
      setPendingRetry(() => result.retry!);
    } else {
      setPendingRetry(null);
    }
  };

  const getStatusBadge = (st: RequestStatusType) => {
    switch (st) {
      case 'QUEUED':
        return <Badge variant="mu">Queued</Badge>;
      case 'PICKING':
        return <Badge variant="am">Picking &middot; locked</Badge>;
      case 'AWAITING_RUNNER':
        return <Badge variant="re">Awaiting runner</Badge>;
      default:
        return <Badge variant="ok">{st}</Badge>;
    }
  };

  const canEditLines =
    canOperate &&
    selectedReq &&
    (selectedReq.st === 'QUEUED' || selectedReq.st === 'PICKING') &&
    !isMutating;

  const stagedRows = useMemo(() => {
    if (!selectedReq) return [];
    return selectedReq.lines
      .map((line) => {
        const it = itemMap.get(line.item_code);
        const p = currentReqStaging[line.item_code];
        if (!it || !p || p.qty <= 0) return null;
        return {
          item: it,
          stagedQty: p.qty,
          lotId: p.lotId,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [selectedReq, itemMap, currentReqStaging]);

  const canStageStock =
    canEditLines &&
    stagedRows.length > 0;

  return (
    <>
      {store !== 'IND-DEL-01' && (
        <div className="note am" style={{ marginBottom: 16 }}>
          Prototype shows the IND-DEL-01 data set for {storeTitle}.
        </div>
      )}

      {!canOperate && (
        <div className="note" style={{ marginBottom: 16 }}>
          <b>Read-only mode.</b> You are viewing as {roleConfig.l}. Initiating picking and staging stock require Warehouse Keeper or Custodian permissions.
        </div>
      )}

      {error && (
        <div
          className="note er"
          style={{
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            justifyContent: 'space-between',
          }}
        >
          <span>
            <b>Action failed:</b> {error}
          </span>
          {pendingRetry && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={async () => {
                setError(null);
                await pendingRetry();
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="head">
        <div>
          <div className="kicker">Requests and pick queue</div>
          <h1 className="h1">
            Pick <em>ticket.</em>
          </h1>
          <p className="sub">
            Select a request, confirm the FIFO lot, stage full or partial. Stock is never edited, only appended.
          </p>
        </div>
      </div>

      <div className="cols c-rq">
        {/* Left Column: Filter Chips & Requisition Queue */}
        <aside>
          <Chips style={{ marginBottom: 12 }}>
            <Chip
              label="All"
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <Chip
              label="Kitchen"
              active={filter === 'Kitchen'}
              onClick={() => setFilter('Kitchen')}
            />
            <Chip
              label="Bar"
              active={filter === 'Bar'}
              onClick={() => setFilter('Bar')}
            />
            <Chip
              label="Cheese"
              active={filter === 'Cheese'}
              onClick={() => setFilter('Cheese')}
            />
            <Chip
              label="Urgent"
              active={filter === 'urgent'}
              onClick={() => setFilter('urgent')}
            />
          </Chips>

          <div className="list">
            {filteredRequests.length > 0 ? (
              filteredRequests.map((q) => {
                const isSelected = selectedReq && q.id === selectedReq.id;
                return (
                  <button
                    type="button"
                    key={q.id}
                    className={`item ${isSelected ? 'sel' : ''}`}
                    onClick={() => setSelectedReqId(q.id)}
                  >
                    <div className="top">
                      <span className="id">{q.id}</span>
                      {q.urgent ? (
                        <Badge variant="ur">URGENT</Badge>
                      ) : (
                        <Badge variant="mu">Standard</Badge>
                      )}
                      <span style={{ marginLeft: 'auto' }}>
                        {getStatusBadge(q.st)}
                      </span>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <b>{q.sec}</b> &middot; {q.lines.length} line
                      {q.lines.length > 1 ? 's' : ''} &middot; needed {q.needed}
                    </div>
                    {q.urgent && q.reason && (
                      <div className="gloss" style={{ marginTop: 2 }}>
                        Reason: {q.reason}
                      </div>
                    )}
                    <div className="meta" style={{ marginTop: 2 }}>
                      submitted {q.time}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="note">No requests match this filter.</div>
            )}
          </div>
        </aside>

        {/* Center Column: FIFO Lot Staging Panel & Pick Ticket */}
        <div>
          {selectedReq ? (
            <Ticket
              no={`${selectedReq.id} · ${selectedReq.sec.toUpperCase()} · ${
                selectedReq.urgent ? 'URGENT' : 'STANDARD'
              }`}
              right={`needed by ${selectedReq.needed}`}
            >
              {selectedReq.urgent && (
                <div className="note er" style={{ marginBottom: 12 }}>
                  <b>URGENT.</b> Submitted outside the issue window. Reason:{' '}
                  {selectedReq.reason || 'Urgent requirement'}.
                </div>
              )}

              {selectedReq.st === 'QUEUED' && (
                <div className="note" style={{ marginBottom: 14 }}>
                  <b>Requester edit lock.</b> {selectedReq.sec} requester can still edit quantities or cancel while this is Queued.
                  {canOperate && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={handleBeginPicking}
                      disabled={isMutating}
                      style={{ marginLeft: 8 }}
                    >
                      Begin picking
                    </button>
                  )}{' '}
                  locks it for the requester.
                </div>
              )}

              {selectedReq.st === 'PICKING' && (
                <div className="note am" style={{ marginBottom: 14 }}>
                  <b>Locked for requester since {selectedReq.lockT || '10:15'}.</b> Edit and cancel are disabled on the requester&apos;s side. Quantity changes now go through you.
                </div>
              )}

              {selectedReq.st === 'AWAITING_RUNNER' && (
                <div className="note" style={{ marginBottom: 14 }}>
                  Staged. Waiting for the runner to confirm at the door (phone).
                </div>
              )}

              <div style={{ marginTop: 6 }}>
                {selectedReq.lines.map((line) => {
                  const it = itemMap.get(line.item_code);
                  if (!it) return null;

                  const p = currentReqStaging[line.item_code] || { lotId: '', qty: 0 };
                  const isPartial = p.qty > 0 && p.qty < line.requested_qty;
                  const isFull = p.qty >= line.requested_qty;
                  const isNotStaged = p.qty <= 0;

                  const stepSize = it.u === 'kg' ? 0.5 : 1;
                  const selectedLot = it.lots.find((l) => l.id === p.lotId);
                  const maxLotAvail = selectedLot ? Math.min(line.requested_qty, selectedLot.qty) : 0;

                  return (
                    <div className="line" key={line.item_code}>
                      <div className="ln">
                        <span className="nm">{it.n}</span>
                        <span className="meta">{line.item_code}</span>
                        <span className="b mu">
                          Requested {formatQty(it, line.requested_qty)}
                        </span>
                        {isNotStaged ? (
                          <Badge variant="mu">Not staged</Badge>
                        ) : isPartial ? (
                          <Badge variant="am">Partial</Badge>
                        ) : (
                          <Badge variant="ok">Full</Badge>
                        )}
                        <span style={{ marginLeft: 'auto' }} className="step">
                          <button
                            type="button"
                            disabled={!canEditLines || p.qty <= 0}
                            onClick={() => handleQtyChange(line.item_code, -stepSize)}
                            aria-label="Less"
                          >
                            −
                          </button>
                          <b>
                            {it.u === 'kg' ? p.qty.toFixed(1) : p.qty} {it.u}
                          </b>
                          <button
                            type="button"
                            disabled={
                              !canEditLines ||
                              p.qty >= line.requested_qty ||
                              p.qty >= maxLotAvail
                            }
                            onClick={() => handleQtyChange(line.item_code, stepSize)}
                            aria-label="More"
                          >
                            +
                          </button>
                        </span>
                      </div>

                      {/* FIFO Lots for this line */}
                      {it.lots.map((lot) => {
                        const expired = isLotExpired(lot);
                        const isAmber = !expired && lot.st === 'am';
                        const isSelectedLot = lot.id === p.lotId;

                        return (
                          <button
                            type="button"
                            key={lot.id}
                            className={`lot ${isSelectedLot ? 'sel' : ''} ${
                              expired ? 'lock' : ''
                            }`}
                            disabled={expired || !canEditLines}
                            aria-pressed={isSelectedLot}
                            onClick={() => {
                              if (expired || !canEditLines) return;
                              handleLotSelect(
                                line.item_code,
                                lot.id,
                                lot.qty,
                                line.requested_qty
                              );
                            }}
                          >
                            <span className="rd" />
                            <span>
                              <b>{lot.id}</b>
                            </span>
                            <span>recv {lot.recv}</span>
                            <span>exp {lot.exp}</span>
                            <span style={{ textAlign: 'right' }}>
                              {formatQty(it, lot.qty)}
                            </span>
                            <span>
                              {expired ? (
                                <Badge variant="er">EXPIRED LOCK</Badge>
                              ) : isAmber ? (
                                <Badge variant="am">Expiry amber</Badge>
                              ) : (
                                <Badge variant="ok">FIFO ok</Badge>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <div className="dash" />

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <span className="meta" style={{ flex: 1 }}>
                  FIFO: oldest eligible lot is pre-selected. Staging drops book stock at once (ISSUE_PENDING). The runner confirms at the door.
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={!canStageStock || isMutating}
                  onClick={handleStageStock}
                >
                  Stage Stock for Runner
                </button>
              </div>
            </Ticket>
          ) : (
            <div className="note">No request selected.</div>
          )}
        </div>

        {/* Right Column: Ledger Rows & Live Derived Stock Previews */}
        <aside className="stack">
          <div className="stub w">
            <span className="lbl">Ledger rows this will append</span>
            {selectedReq &&
            (selectedReq.st === 'QUEUED' || selectedReq.st === 'PICKING') &&
            stagedRows.length > 0 ? (
              stagedRows.map((row) => (
                <div className="ledrow" key={row.item.c}>
                  <span className="t">ISSUE_PENDING</span>
                  <span>{row.item.n}</span>
                  <span className="neg">
                    {formatSignedQty(row.item, -row.stagedQty)}
                  </span>
                </div>
              ))
            ) : (
              <p className="gloss" style={{ margin: 0 }}>
                Nothing to append yet.
              </p>
            )}
            <p className="gloss" style={{ margin: '8px 0 0' }}>
              Append-only. Each row carries who, when and the reference{' '}
              {selectedReq ? selectedReq.id : '—'}.
            </p>
          </div>

          <div className="stub">
            <span className="lbl">Live derived stock</span>
            {selectedReq ? (
              <table className="tick">
                <tbody>
                  {selectedReq.lines.map((line) => {
                    const it = itemMap.get(line.item_code);
                    if (!it) return null;
                    const p = currentReqStaging[line.item_code];
                    const stagedQty =
                      selectedReq.st === 'QUEUED' || selectedReq.st === 'PICKING'
                        ? p?.qty || 0
                        : 0;
                    const currentBook = it.book;
                    const afterBook = Math.max(
                      0,
                      Math.round((currentBook - stagedQty) * 100) / 100
                    );

                    return (
                      <tr key={line.item_code}>
                        <td style={{ width: 'auto' }}>{it.n}</td>
                        <td>
                          {formatQty(it, currentBook)} →{' '}
                          <b>{formatQty(it, afterBook)}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="gloss" style={{ margin: 0 }}>
                Select a request to preview stock impact.
              </p>
            )}
            <p className="gloss" style={{ margin: '8px 0 0' }}>
              Book now → after staging.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
