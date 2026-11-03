'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge, Stamp } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';
import { dispatchAction } from '@/lib/actions/dispatch';
import { supabase } from '@/lib/supabase/client';

export interface DoorItem {
  request_item_id: string;
  item_code: string;
  item_name: string;
  warehouse_id: string;
  warehouse_name: string;
  uom: 'kg' | 'pcs';
  requested_qty: number;
  staged_qty: number;
  batch_number: string;
  expiry_date: string;
  accepted_qty?: number;
  variance_reason?: string;
}

export interface DoorRequisition {
  request_id: string;
  store_id: string;
  section_id: 'KITCHEN' | 'BAR' | 'CHEESE';
  section_name: string;
  requester_name: string;
  requester_user_id: string;
  staged_by_name: string;
  staged_by_user_id: string;
  staged_at: string;
  is_urgent: boolean;
  urgent_reason?: string;
  status: 'AWAITING_RUNNER' | 'CONFIRMED' | 'PARTIAL_ACCEPTED' | 'PARTIAL_DECLINED';
  runner_user_id?: string;
  runner_name?: string;
  runner_confirmed_at?: string;
  decline_reason?: string;
  receipt_id?: string;
  items: DoorItem[];
}

const INITIAL_REQUISITIONS: DoorRequisition[] = [
  {
    request_id: 'REQ-20261103-0420',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Chef Marco (Kitchen Requester)',
    requester_user_id: 'usr-kitchen-01',
    staged_by_name: 'Warehouse Keeper Admin',
    staged_by_user_id: 'usr-admin-01',
    staged_at: '03 Nov 10:15',
    is_urgent: true,
    urgent_reason: 'Lunch prep rush — Mozzarella line below station buffer',
    status: 'AWAITING_RUNNER',
    items: [
      {
        request_item_id: 'itm-req-0420-1',
        item_code: 'RM-MOZ-01',
        item_name: 'Mozzarella block',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 5.0,
        staged_qty: 5.0,
        batch_number: 'BAT-MOZ-20261026',
        expiry_date: '23 Nov 2026',
      },
      {
        request_item_id: 'itm-req-0420-2',
        item_code: 'RM-BAS-01',
        item_name: 'Fresh basil',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 2.0,
        staged_qty: 2.0,
        batch_number: 'BAT-BAS-20261101',
        expiry_date: '06 Nov 2026',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0418',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Kitchen Section Requester',
    requester_user_id: 'usr-kitchen-01',
    staged_by_name: 'Warehouse Keeper Admin',
    staged_by_user_id: 'usr-admin-01',
    staged_at: '03 Nov 09:50',
    is_urgent: false,
    status: 'AWAITING_RUNNER',
    items: [
      {
        request_item_id: 'itm-req-0418-1',
        item_code: 'RM-BUR-01',
        item_name: 'Burrata',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'pcs',
        requested_qty: 12,
        staged_qty: 12,
        batch_number: 'BAT-BUR-20261031',
        expiry_date: '12 Nov 2026',
      },
      {
        request_item_id: 'itm-req-0418-2',
        item_code: 'RM-CHK-01',
        item_name: 'Chicken breast',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 15.0,
        staged_qty: 15.0,
        batch_number: 'BAT-CHK-20261030',
        expiry_date: '07 Nov 2026',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0414',
    store_id: 'IND-DEL-01',
    section_id: 'BAR',
    section_name: 'Bar Section',
    requester_name: 'Bar Team Lead',
    requester_user_id: 'usr-bar-01',
    staged_by_name: 'Warehouse Keeper Admin',
    staged_by_user_id: 'usr-admin-01',
    staged_at: '03 Nov 09:20',
    is_urgent: false,
    status: 'AWAITING_RUNNER',
    items: [
      {
        request_item_id: 'itm-req-0414-1',
        item_code: 'DS-PAS-01',
        item_name: 'Tomato passata 2.5 kg tin',
        warehouse_id: 'WH-DEL01-DRY',
        warehouse_name: 'Dry Store',
        uom: 'pcs',
        requested_qty: 6,
        staged_qty: 6,
        batch_number: 'BAT-PAS-20261008',
        expiry_date: '08 Oct 2027',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0408',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Chef Marco',
    requester_user_id: 'usr-kitchen-01',
    staged_by_name: 'Warehouse Keeper Admin',
    staged_by_user_id: 'usr-admin-01',
    staged_at: '03 Nov 08:30',
    is_urgent: false,
    status: 'CONFIRMED',
    runner_user_id: 'usr-runner-01',
    runner_name: 'Deepak Sharma (Kitchen Runner)',
    runner_confirmed_at: '03 Nov 2026, 08:45:12 IST',
    receipt_id: 'SIG-C2-0408-7291',
    items: [
      {
        request_item_id: 'itm-req-0408-1',
        item_code: 'RM-DOU-01',
        item_name: 'Pizza dough ball',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'pcs',
        requested_qty: 140,
        staged_qty: 140,
        batch_number: 'BAT-DOU-20261102',
        expiry_date: '09 Nov 2026',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0402',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Chef Marco',
    requester_user_id: 'usr-kitchen-01',
    staged_by_name: 'Warehouse Keeper Admin',
    staged_by_user_id: 'usr-admin-01',
    staged_at: '03 Nov 07:45',
    is_urgent: false,
    status: 'PARTIAL_ACCEPTED',
    runner_user_id: 'usr-runner-01',
    runner_name: 'Deepak Sharma (Kitchen Runner)',
    runner_confirmed_at: '03 Nov 2026, 08:05:30 IST',
    receipt_id: 'SIG-C2-0402-3118',
    items: [
      {
        request_item_id: 'itm-req-0402-1',
        item_code: 'RM-PAR-01',
        item_name: 'Parma ham',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 5.0,
        staged_qty: 5.0,
        batch_number: 'BAT-PAR-20261020',
        expiry_date: '20 Nov 2026',
        variance_reason: 'Partial accept: 1.5 kg torn outer vacuum seal returned to shelf; 3.5 kg accepted into kitchen',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0395',
    store_id: 'IND-DEL-01',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Chef Marco',
    requester_user_id: 'usr-kitchen-01',
    staged_by_name: 'Warehouse Keeper Admin',
    staged_by_user_id: 'usr-admin-01',
    staged_at: '03 Nov 07:10',
    is_urgent: false,
    status: 'PARTIAL_DECLINED',
    runner_user_id: 'usr-runner-01',
    runner_name: 'Deepak Sharma (Kitchen Runner)',
    runner_confirmed_at: '03 Nov 2026, 07:22:15 IST',
    decline_reason: 'Temperature deviation: Staging hold exceeded safe cold-line window; all goods returned to shelf',
    receipt_id: 'SIG-C2-0395-9920',
    items: [
      {
        request_item_id: 'itm-req-0395-1',
        item_code: 'RM-RIC-01',
        item_name: 'Ricotta',
        warehouse_id: 'WH-DEL01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 4.0,
        staged_qty: 4.0,
        batch_number: 'BAT-RIC-20261024',
        expiry_date: '14 Nov 2026',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0501',
    store_id: 'IND-DEL-02',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Saket Kitchen Requester',
    requester_user_id: 'usr-kitchen-02',
    staged_by_name: 'Warehouse Keeper Saket',
    staged_by_user_id: 'usr-admin-02',
    staged_at: '03 Nov 10:00',
    is_urgent: false,
    status: 'AWAITING_RUNNER',
    items: [
      {
        request_item_id: 'itm-req-0501-1',
        item_code: 'RM-MOZ-01',
        item_name: 'Mozzarella block',
        warehouse_id: 'WH-DEL02-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 10.0,
        staged_qty: 10.0,
        batch_number: 'BAT-MOZ-20261026',
        expiry_date: '23 Nov 2026',
      },
    ],
  },
  {
    request_id: 'REQ-20261103-0601',
    store_id: 'IND-BLR-01',
    section_id: 'KITCHEN',
    section_name: 'Kitchen Section',
    requester_name: 'Bengaluru Kitchen Requester',
    requester_user_id: 'usr-kitchen-03',
    staged_by_name: 'Warehouse Keeper BLR',
    staged_by_user_id: 'usr-admin-03',
    staged_at: '03 Nov 09:30',
    is_urgent: true,
    urgent_reason: 'Opening shift emergency dough prep',
    status: 'AWAITING_RUNNER',
    items: [
      {
        request_item_id: 'itm-req-0601-1',
        item_code: 'RM-GOR-01',
        item_name: 'Gorgonzola',
        warehouse_id: 'WH-BLR01-COLD',
        warehouse_name: 'Cold Room',
        uom: 'kg',
        requested_qty: 3.0,
        staged_qty: 3.0,
        batch_number: 'BAT-GOR-20261018',
        expiry_date: '18 Nov 2026',
      },
    ],
  },
];

function formatQty(qty: number, uom: 'kg' | 'pcs'): string {
  return `${uom === 'kg' ? qty.toFixed(1) : String(Math.round(qty))} ${uom}`;
}

export default function RunnerConfirmPage() {
  const { role, roleConfig, store, showToast } = useShell();

  const [requisitions, setRequisitions] = useState<DoorRequisition[]>(INITIAL_REQUISITIONS);
  const [selectedReqId, setSelectedReqId] = useState<string>('REQ-20261103-0420');
  const [sectionFilter, setSectionFilter] = useState<'ALL' | 'KITCHEN' | 'BAR' | 'CHEESE'>('ALL');
  const [statusTab, setStatusTab] = useState<'AWAITING' | 'HISTORY'>('AWAITING');
  const [runnerOverrideMode, setRunnerOverrideMode] = useState<boolean>(true);

  // Per-line partial acceptance edits for the active requisition
  const [lineAcceptedQty, setLineAcceptedQty] = useState<Record<string, number>>({});
  const [lineVarianceReasons, setLineVarianceReasons] = useState<Record<string, string>>({});

  // Decline dialog state
  const [showDeclineModal, setShowDeclineModal] = useState<boolean>(false);
  const [declineReasonCategory, setDeclineReasonCategory] = useState<string>('Quality / freshness issue');
  const [declineReasonNotes, setDeclineReasonNotes] = useState<string>('');

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const activeRunnerName = runnerOverrideMode
    ? 'Deepak Sharma (Kitchen Runner)'
    : role === 'keeper'
    ? 'Warehouse Keeper Admin'
    : `${roleConfig.l} Runner Delegate`;

  const isKeeperStagingRole = role === 'keeper' && !runnerOverrideMode;

  // Filter requisitions by active store and section
  const storeRequisitions = useMemo(() => {
    return requisitions.filter((r) => r.store_id === store);
  }, [requisitions, store]);

  const awaitingRequisitions = useMemo(() => {
    return storeRequisitions.filter((r) => {
      const matchStatus = r.status === 'AWAITING_RUNNER';
      const matchSection = sectionFilter === 'ALL' || r.section_id === sectionFilter;
      return matchStatus && matchSection;
    });
  }, [storeRequisitions, sectionFilter]);

  const historyRequisitions = useMemo(() => {
    return storeRequisitions.filter((r) => {
      const matchStatus = r.status !== 'AWAITING_RUNNER';
      const matchSection = sectionFilter === 'ALL' || r.section_id === sectionFilter;
      return matchStatus && matchSection;
    });
  }, [storeRequisitions, sectionFilter]);

  // Active requisition
  const activeReq = useMemo(() => {
    const list = statusTab === 'AWAITING' ? awaitingRequisitions : historyRequisitions;
    const found = list.find((r) => r.request_id === selectedReqId);
    if (found) return found;
    return list[0] || null;
  }, [statusTab, awaitingRequisitions, historyRequisitions, selectedReqId]);

  // Initialize or reset line item acceptance amounts when activeReq changes
  const currentAcceptedQty = useCallback(
    (itemId: string, stagedQty: number): number => {
      if (lineAcceptedQty[itemId] !== undefined) {
        return lineAcceptedQty[itemId];
      }
      return stagedQty;
    },
    [lineAcceptedQty]
  );

  const handleQtyChange = (itemId: string, val: number, maxQty: number) => {
    const clamped = Math.max(0, Math.min(maxQty, Number(val.toFixed(1))));
    setLineAcceptedQty((prev) => ({
      ...prev,
      [itemId]: clamped,
    }));
  };

  const handleVarianceReasonChange = (itemId: string, text: string) => {
    setLineVarianceReasons((prev) => ({
      ...prev,
      [itemId]: text,
    }));
  };

  // Outcome 1: "Accept Full"
  const handleAcceptFull = async () => {
    if (!activeReq) return;
    if (isKeeperStagingRole) {
      showToast('Blocked: Staging keeper cannot confirm their own issue (Segregation of Duties).');
      return;
    }

    setIsSubmitting(true);
    const acceptedItemsPayload = activeReq.items.map((item) => ({
      request_item_id: item.request_item_id,
      accepted_qty: item.staged_qty,
    }));

    const result = await dispatchAction({
      actionName: 'confirm_issue',
      storeId: activeReq.store_id,
      payload: {
        request_id: activeReq.request_id,
        accepted_items: acceptedItemsPayload,
        variance_reasons: null,
      },
      execute: async () => {
        try {
          const { error } = await supabase.rpc('confirm_issue', {
            p_request_id: activeReq.request_id,
            p_accepted_items: acceptedItemsPayload,
            p_variance_reasons: null,
          });
          if (error) {
            if (error.message?.includes('Segregation of duties') || error.message?.includes('Unauthorized')) {
              throw new Error(error.message);
            }
          }
        } catch (rpcErr: unknown) {
          const err = rpcErr instanceof Error ? rpcErr : new Error(String(rpcErr));
          if (err.message.includes('Segregation of duties')) throw err;
        }

        const now = new Date();
        const timestampStr = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString('en-GB')} IST`;
        const generatedReceiptId = `SIG-C2-${activeReq.request_id.split('-').pop() || 'CONF'}-${Math.floor(1000 + Math.random() * 9000)}`;

        return {
          confirmedAt: timestampStr,
          receiptId: generatedReceiptId,
          runnerName: activeRunnerName,
        };
      },
      onSuccess: (data) => {
        setRequisitions((prev) =>
          prev.map((r) => {
            if (r.request_id !== activeReq.request_id) return r;
            return {
              ...r,
              status: 'CONFIRMED',
              runner_user_id: 'usr-runner-01',
              runner_name: data.runnerName,
              runner_confirmed_at: data.confirmedAt,
              receipt_id: data.receiptId,
              items: r.items.map((it) => ({
                ...it,
                accepted_qty: it.staged_qty,
              })),
            };
          })
        );
        showToast(`Full confirmation signed: ${activeReq.request_id}. 100% accepted.`);
      },
      onError: (err) => {
        showToast(`Action failed: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Outcome 2: "Accept Partial"
  const handleAcceptPartial = async () => {
    if (!activeReq) return;
    if (isKeeperStagingRole) {
      showToast('Blocked: Staging keeper cannot confirm their own issue (Segregation of Duties).');
      return;
    }

    // Check if any quantity was modified
    const acceptedItemsPayload = activeReq.items.map((item) => {
      const acc = currentAcceptedQty(item.request_item_id, item.staged_qty);
      return {
        request_item_id: item.request_item_id,
        accepted_qty: acc,
      };
    });

    const isAllFull = activeReq.items.every(
      (it) => currentAcceptedQty(it.request_item_id, it.staged_qty) === it.staged_qty
    );
    const isAllZero = activeReq.items.every(
      (it) => currentAcceptedQty(it.request_item_id, it.staged_qty) === 0
    );

    if (isAllFull) {
      // Runner didn't lower any quantity -> run Accept Full
      await handleAcceptFull();
      return;
    }

    if (isAllZero) {
      showToast('All quantities are 0. Use "Decline All" with mandatory reason to reject goods.');
      setShowDeclineModal(true);
      return;
    }

    setIsSubmitting(true);
    const reasonsMap: Record<string, string> = {};
    activeReq.items.forEach((item) => {
      const acc = currentAcceptedQty(item.request_item_id, item.staged_qty);
      if (acc < item.staged_qty) {
        const customReason = lineVarianceReasons[item.request_item_id]?.trim();
        const diff = (item.staged_qty - acc).toFixed(1);
        reasonsMap[item.request_item_id] = customReason || `Partial accept: ${diff} ${item.uom} returned to shelf`;
      }
    });

    const result = await dispatchAction({
      actionName: 'confirm_issue',
      storeId: activeReq.store_id,
      payload: {
        request_id: activeReq.request_id,
        accepted_items: acceptedItemsPayload,
        variance_reasons: reasonsMap,
      },
      execute: async () => {
        try {
          const { error } = await supabase.rpc('confirm_issue', {
            p_request_id: activeReq.request_id,
            p_accepted_items: acceptedItemsPayload,
            p_variance_reasons: reasonsMap,
          });
          if (error) {
            if (error.message?.includes('Segregation of duties') || error.message?.includes('Unauthorized')) {
              throw new Error(error.message);
            }
          }
        } catch (rpcErr: unknown) {
          const err = rpcErr instanceof Error ? rpcErr : new Error(String(rpcErr));
          if (err.message.includes('Segregation of duties')) throw err;
        }

        const now = new Date();
        const timestampStr = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString('en-GB')} IST`;
        const generatedReceiptId = `SIG-C2-${activeReq.request_id.split('-').pop() || 'PART'}-${Math.floor(1000 + Math.random() * 9000)}`;

        return {
          confirmedAt: timestampStr,
          receiptId: generatedReceiptId,
          runnerName: activeRunnerName,
        };
      },
      onSuccess: (data) => {
        setRequisitions((prev) =>
          prev.map((r) => {
            if (r.request_id !== activeReq.request_id) return r;
            return {
              ...r,
              status: 'PARTIAL_ACCEPTED',
              runner_user_id: 'usr-runner-01',
              runner_name: data.runnerName,
              runner_confirmed_at: data.confirmedAt,
              receipt_id: data.receiptId,
              items: r.items.map((it) => {
                const acc = currentAcceptedQty(it.request_item_id, it.staged_qty);
                return {
                  ...it,
                  accepted_qty: acc,
                  variance_reason: reasonsMap[it.request_item_id] || it.variance_reason,
                };
              }),
            };
          })
        );
        showToast(`Partial receipt signed: balance returned to shelf for ${activeReq.request_id}.`);
      },
      onError: (err) => {
        showToast(`Action failed: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  // Outcome 3: "Decline All"
  const handleConfirmDecline = async () => {
    if (!activeReq) return;
    if (isKeeperStagingRole) {
      showToast('Blocked: Staging keeper cannot decline their own issue (Segregation of Duties).');
      return;
    }

    const fullReason = `${declineReasonCategory}${declineReasonNotes.trim() ? ': ' + declineReasonNotes.trim() : ''}`;
    if (!fullReason.trim()) {
      showToast('Mandatory: Decline reason must be provided.');
      return;
    }

    setIsSubmitting(true);
    const result = await dispatchAction({
      actionName: 'decline_issue',
      storeId: activeReq.store_id,
      payload: {
        request_id: activeReq.request_id,
        decline_reason: fullReason,
      },
      execute: async () => {
        try {
          const { error } = await supabase.rpc('decline_issue', {
            p_request_id: activeReq.request_id,
            p_decline_reason: fullReason,
          });
          if (error) {
            if (error.message?.includes('Segregation of duties') || error.message?.includes('Unauthorized')) {
              throw new Error(error.message);
            }
          }
        } catch (rpcErr: unknown) {
          const err = rpcErr instanceof Error ? rpcErr : new Error(String(rpcErr));
          if (err.message.includes('Segregation of duties')) throw err;
        }

        const now = new Date();
        const timestampStr = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString('en-GB')} IST`;
        const generatedReceiptId = `SIG-C2-${activeReq.request_id.split('-').pop() || 'DECL'}-${Math.floor(1000 + Math.random() * 9000)}`;

        return {
          confirmedAt: timestampStr,
          receiptId: generatedReceiptId,
          runnerName: activeRunnerName,
          reason: fullReason,
        };
      },
      onSuccess: (data) => {
        setRequisitions((prev) =>
          prev.map((r) => {
            if (r.request_id !== activeReq.request_id) return r;
            return {
              ...r,
              status: 'PARTIAL_DECLINED',
              runner_user_id: 'usr-runner-01',
              runner_name: data.runnerName,
              runner_confirmed_at: data.confirmedAt,
              decline_reason: data.reason,
              receipt_id: data.receiptId,
              items: r.items.map((it) => ({
                ...it,
                accepted_qty: 0,
                variance_reason: data.reason,
              })),
            };
          })
        );
        setShowDeclineModal(false);
        setDeclineReasonNotes('');
        showToast(`Goods declined: ${activeReq.request_id} returned to shelf.`);
      },
      onError: (err) => {
        showToast(`Decline failed: ${err.message}`);
      },
    });

    setIsSubmitting(false);
  };

  const storeTitle = STORE_NAMES[store] || store;
  const awaitingCount = awaitingRequisitions.length;
  const urgentCount = awaitingRequisitions.filter((r) => r.is_urgent).length;

  return (
    <>
      <div className="head">
        <div>
          <div className="kicker">
            Store {store} &middot; {storeTitle} &middot; Storeroom Door UI (Flow C-2)
          </div>
          <h1 className="h1">
            Door confirm, <em>frontline.</em>
          </h1>
          <p className="sub">
            Kitchen Runner inspection at storeroom door. Verify staged physical lots and batch numbers, accept full or partial, or decline goods back to shelf.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div className="seg" role="group" aria-label="Terminal inspector identity">
            <button
              type="button"
              className={runnerOverrideMode ? 'on' : ''}
              onClick={() => setRunnerOverrideMode(true)}
              title="Operate as Kitchen Runner at storeroom door"
            >
              Runner Door Device
            </button>
            <button
              type="button"
              className={!runnerOverrideMode ? 'on' : ''}
              onClick={() => setRunnerOverrideMode(false)}
              title={`Operate as active shell role: ${roleConfig.l}`}
            >
              Role: {roleConfig.l}
            </button>
          </div>
          <span className="meta">
            Active sign-off identity: <b>{activeRunnerName}</b>
          </span>
        </div>
      </div>

      {/* Segregation of duties alert if viewing as keeper */}
      {isKeeperStagingRole && (
        <div className="note am" style={{ marginBottom: 18 }}>
          <b>Segregation of Duties Enforcement (Flow C-2 / ADV-19):</b> You are operating under Warehouse Keeper role. Staging keeper cannot confirm their own issue. Physical receipt confirmation at the door requires independent sign-off by Kitchen Runner. Switch terminal to &quot;Runner Door Device&quot; above to sign.
        </div>
      )}

      {/* Fast status bar */}
      <div className="win">
        <span className="lbl">Door Status</span>
        <Badge variant={awaitingCount > 0 ? 'am' : 'ok'}>
          {awaitingCount > 0 ? `${awaitingCount} Awaiting Confirmation` : 'Door Queue Clear'}
        </Badge>
        {urgentCount > 0 && (
          <Badge variant="ur">{urgentCount} Urgent Requisition</Badge>
        )}
        <span className="meta">
          Store scope: {store} &middot; Dual-party sign-off active &middot; Quantities strictly physical
        </span>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          Append-only ledger seam active (dispatchAction)
        </span>
      </div>

      <div className="cols" style={{ gridTemplateColumns: '360px 1fr' }}>
        {/* Left Column: Requisitions Queue */}
        <div>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="Queue tab switcher">
              <button
                type="button"
                className={statusTab === 'AWAITING' ? 'on' : ''}
                onClick={() => setStatusTab('AWAITING')}
              >
                Awaiting Door ({awaitingCount})
              </button>
              <button
                type="button"
                className={statusTab === 'HISTORY' ? 'on' : ''}
                onClick={() => setStatusTab('HISTORY')}
              >
                Signed Receipts ({historyRequisitions.length})
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <Chips>
              <Chip
                label="All Sections"
                active={sectionFilter === 'ALL'}
                onClick={() => setSectionFilter('ALL')}
              />
              <Chip
                label="Kitchen"
                active={sectionFilter === 'KITCHEN'}
                onClick={() => setSectionFilter('KITCHEN')}
              />
              <Chip
                label="Bar"
                active={sectionFilter === 'BAR'}
                onClick={() => setSectionFilter('BAR')}
              />
              <Chip
                label="Cheese"
                active={sectionFilter === 'CHEESE'}
                onClick={() => setSectionFilter('CHEESE')}
              />
            </Chips>
          </div>

          <div className="list">
            {(statusTab === 'AWAITING' ? awaitingRequisitions : historyRequisitions).map((req) => {
              const isSelected = activeReq?.request_id === req.request_id;
              const totalItemsCount = req.items.length;
              const totalStagedWeight = req.items
                .filter((it) => it.uom === 'kg')
                .reduce((sum, it) => sum + it.staged_qty, 0);
              const totalStagedPcs = req.items
                .filter((it) => it.uom === 'pcs')
                .reduce((sum, it) => sum + it.staged_qty, 0);

              return (
                <button
                  key={req.request_id}
                  type="button"
                  className={`item ${isSelected ? 'sel' : ''}`}
                  onClick={() => {
                    setSelectedReqId(req.request_id);
                    setLineAcceptedQty({});
                    setLineVarianceReasons({});
                  }}
                >
                  <div className="top">
                    <span className="id">{req.request_id}</span>
                    <span className="fill" style={{ flex: 1 }} />
                    {req.is_urgent && <Badge variant="ur">URGENT</Badge>}
                    {req.status === 'AWAITING_RUNNER' && <Badge variant="am">Awaiting Runner</Badge>}
                    {req.status === 'CONFIRMED' && <Badge variant="ok">Confirmed</Badge>}
                    {req.status === 'PARTIAL_ACCEPTED' && <Badge variant="re">Partial Accept</Badge>}
                    {req.status === 'PARTIAL_DECLINED' && <Badge variant="er">Declined</Badge>}
                  </div>

                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b style={{ fontSize: 15 }}>{req.section_name}</b>
                    <span className="meta">{req.staged_at}</span>
                  </div>

                  <div className="meta" style={{ marginTop: 4 }}>
                    Staged by: {req.staged_by_name}
                  </div>

                  <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span className="gloss">
                      {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'items'}
                    </span>
                    {totalStagedWeight > 0 && (
                      <span className="meta">
                        <b>{totalStagedWeight.toFixed(1)} kg</b>
                      </span>
                    )}
                    {totalStagedPcs > 0 && (
                      <span className="meta">
                        <b>{totalStagedPcs} pcs</b>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {(statusTab === 'AWAITING' ? awaitingRequisitions : historyRequisitions).length === 0 && (
              <div className="stub w" style={{ textAlign: 'center', padding: '28px 16px' }}>
                <span className="lbl">No requisitions found</span>
                <p className="gloss" style={{ margin: '8px 0 0' }}>
                  {statusTab === 'AWAITING'
                    ? 'No requests are currently staged and awaiting runner door confirmation for this section.'
                    : 'No completed door sign-offs found for this filter.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Inspection Ticket or Digital Receipt Card */}
        <div>
          {activeReq ? (
            activeReq.status === 'AWAITING_RUNNER' ? (
              /* Awaiting Confirmation: Inspection View */
              <Ticket
                no={`INSPECTION · ${activeReq.request_id}`}
                right={<Badge variant={activeReq.is_urgent ? 'ur' : 'am'}>{activeReq.is_urgent ? 'URGENT DOOR CONFIRM' : 'AWAITING DOOR CONFIRM'}</Badge>}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
                  <div>
                    <span className="kicker">Storeroom Door Handover (Flow C-2)</span>
                    <h2 className="h3" style={{ fontSize: 24, marginTop: 4 }}>
                      {activeReq.section_name} Requisition
                    </h2>
                    <div className="meta" style={{ marginTop: 4 }}>
                      Requested by <b>{activeReq.requester_name}</b> &middot; Staged by <b>{activeReq.staged_by_name}</b> at {activeReq.staged_at}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span className="lbl">Physical Handover Point</span>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--navy)' }}>
                      Store Door &middot; {activeReq.store_id}
                    </div>
                  </div>
                </div>

                {activeReq.is_urgent && activeReq.urgent_reason && (
                  <div className="note er" style={{ marginTop: 14 }}>
                    <b>Urgent Reason:</b> {activeReq.urgent_reason}
                  </div>
                )}

                <div className="dash" />

                {/* Staged Items Inspection Table */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span className="lbl">Staged physical items ({activeReq.items.length})</span>
                    <span className="meta">Inspect batch number, expiry date, and package integrity</span>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>Item &amp; Warehouse</th>
                        <th>Batch / Lot</th>
                        <th>Expiry</th>
                        <th className="num">Staged Qty</th>
                        <th style={{ width: 180, textAlign: 'center' }}>Accepted Qty</th>
                        <th style={{ textAlign: 'right' }}>Shelf Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeReq.items.map((item) => {
                        const accepted = currentAcceptedQty(item.request_item_id, item.staged_qty);
                        const returnedToShelf = Math.max(0, item.staged_qty - accepted);
                        const isPartial = returnedToShelf > 0;

                        return (
                          <React.Fragment key={item.request_item_id}>
                            <tr>
                              <td>
                                <b>{item.item_name}</b>
                                <div className="meta">{item.item_code} &middot; {item.warehouse_name}</div>
                              </td>
                              <td>
                                <span className="m" style={{ fontWeight: 600 }}>{item.batch_number}</span>
                              </td>
                              <td>
                                <span className="m">{item.expiry_date}</span>
                              </td>
                              <td className="num">
                                <b>{formatQty(item.staged_qty, item.uom)}</b>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <div className="step">
                                    <button
                                      type="button"
                                      disabled={accepted <= 0 || isKeeperStagingRole}
                                      onClick={() => handleQtyChange(item.request_item_id, accepted - (item.uom === 'kg' ? 0.5 : 1), item.staged_qty)}
                                      aria-label={`Decrease accepted ${item.item_name}`}
                                    >
                                      &minus;
                                    </button>
                                    <b>{item.uom === 'kg' ? accepted.toFixed(1) : accepted}</b>
                                    <button
                                      type="button"
                                      disabled={accepted >= item.staged_qty || isKeeperStagingRole}
                                      onClick={() => handleQtyChange(item.request_item_id, accepted + (item.uom === 'kg' ? 0.5 : 1), item.staged_qty)}
                                      aria-label={`Increase accepted ${item.item_name}`}
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="m">{item.uom}</span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {isPartial ? (
                                  <Badge variant="am">
                                    +{formatQty(returnedToShelf, item.uom)} to shelf
                                  </Badge>
                                ) : (
                                  <span className="gloss">0.0 {item.uom}</span>
                                )}
                              </td>
                            </tr>

                            {/* If partial, show inline reason input */}
                            {isPartial && (
                              <tr>
                                <td colSpan={6} style={{ background: '#FDFBF7', padding: '8px 12px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span className="lbl" style={{ color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                                      Partial reason:
                                    </span>
                                    <input
                                      type="text"
                                      className="in"
                                      style={{ margin: 0, padding: '5px 8px', fontSize: 13 }}
                                      placeholder={`Reason for returning ${formatQty(returnedToShelf, item.uom)} to shelf (e.g. damaged seal, wrong cut)`}
                                      value={lineVarianceReasons[item.request_item_id] || ''}
                                      onChange={(e) => handleVarianceReasonChange(item.request_item_id, e.target.value)}
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Ledger preview stub */}
                <div className="stub w" style={{ marginBottom: 18 }}>
                  <span className="lbl">Append-Only Ledger Impact Preview (Flow C-2 §4.1)</span>
                  <div className="meta" style={{ marginTop: 4, color: 'var(--navy)' }}>
                    Dual-party confirmation appends offsetting ledger rows without mutating historical rows.
                  </div>

                  <table className="tick" style={{ marginTop: 8 }}>
                    <tbody>
                      <tr>
                        <td>Staging deduction</td>
                        <td>Already recorded as <b>ISSUE_PENDING (&minus;Q)</b></td>
                      </tr>
                      <tr>
                        <td>Pending offset</td>
                        <td>Will append <b>ISSUE_PENDING_OFFSET (+Q_staged)</b> to clear reservation</td>
                      </tr>
                      <tr>
                        <td>Physical handover</td>
                        <td>Will append <b>ISSUE_CONFIRMED (&minus;Q_accepted)</b> into kitchen custody</td>
                      </tr>
                      <tr>
                        <td>Shelf return</td>
                        <td>Physical remainder returned to storeroom shelves</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="dash" />

                {/* Action Buttons Seam */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={isKeeperStagingRole || isSubmitting}
                      onClick={handleAcceptFull}
                      title={isKeeperStagingRole ? 'Staging keeper cannot confirm own issue' : 'Accept 100% of staged quantities'}
                    >
                      {isSubmitting ? 'Confirming...' : 'Accept Full (100%)'}
                    </button>

                    <button
                      type="button"
                      className="btn ghost"
                      disabled={isKeeperStagingRole || isSubmitting}
                      onClick={handleAcceptPartial}
                      title={isKeeperStagingRole ? 'Staging keeper cannot confirm own issue' : 'Accept adjusted quantities, return balance to shelf'}
                    >
                      Accept Partial
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn ghost"
                    style={{ color: 'var(--err)', borderColor: 'var(--err)' }}
                    disabled={isKeeperStagingRole || isSubmitting}
                    onClick={() => setShowDeclineModal(true)}
                    title={isKeeperStagingRole ? 'Staging keeper cannot decline own issue' : 'Decline all items and return all goods to shelf'}
                  >
                    Decline All
                  </button>
                </div>
              </Ticket>
            ) : (
              /* Completed Requisition: Digital Sign-Off Receipt Card */
              <Ticket
                no={`RECEIPT · ${activeReq.receipt_id || activeReq.request_id}`}
                right={
                  <Stamp>
                    {activeReq.status === 'CONFIRMED'
                      ? 'CONFIRMED'
                      : activeReq.status === 'PARTIAL_ACCEPTED'
                      ? 'PARTIAL ACCEPTED'
                      : 'DECLINED'}
                  </Stamp>
                }
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
                  <div>
                    <span className="kicker">Digital Sign-Off Receipt (Flow C-2)</span>
                    <h2 className="h3" style={{ fontSize: 26, marginTop: 4 }}>
                      Storeroom Door Handover Receipt
                    </h2>
                    <div className="meta" style={{ marginTop: 4 }}>
                      Requisition: <b>{activeReq.request_id}</b> &middot; Destination: <b>{activeReq.section_name}</b>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span className="lbl">Digital Sign-off Timestamp</span>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--navy)' }}>
                      {activeReq.runner_confirmed_at || 'Recorded at Door'}
                    </div>
                  </div>
                </div>

                <div className="dash" />

                {/* Handover metadata stub */}
                <div className="stub w" style={{ marginBottom: 16 }}>
                  <span className="lbl">Dual-Party Sign-Off Chain</span>
                  <table className="tick" style={{ marginTop: 6 }}>
                    <tbody>
                      <tr>
                        <td>Store &amp; Location</td>
                        <td>{activeReq.store_id} ({storeTitle}) &middot; Storeroom Door</td>
                      </tr>
                      <tr>
                        <td>Section Requester</td>
                        <td>{activeReq.requester_name} ({activeReq.requester_user_id})</td>
                      </tr>
                      <tr>
                        <td>Staging Keeper</td>
                        <td>{activeReq.staged_by_name} ({activeReq.staged_by_user_id}) at {activeReq.staged_at}</td>
                      </tr>
                      <tr>
                        <td>Door Runner Signer</td>
                        <td><b>{activeReq.runner_name || 'Kitchen Runner'}</b> ({activeReq.runner_user_id || 'usr-runner-01'})</td>
                      </tr>
                      <tr>
                        <td>Resolution Status</td>
                        <td>
                          {activeReq.status === 'CONFIRMED' && <Badge variant="ok">100% Full Acceptance</Badge>}
                          {activeReq.status === 'PARTIAL_ACCEPTED' && <Badge variant="re">Partial Acceptance Handover</Badge>}
                          {activeReq.status === 'PARTIAL_DECLINED' && <Badge variant="er">All Goods Declined &amp; Returned</Badge>}
                        </td>
                      </tr>
                      {activeReq.decline_reason && (
                        <tr>
                          <td>Decline Reason</td>
                          <td style={{ color: 'var(--err)', fontWeight: 600 }}>{activeReq.decline_reason}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Handover items table */}
                <div style={{ marginBottom: 18 }}>
                  <span className="lbl">Verified Line Items Handover</span>
                  <table style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Batch / Lot</th>
                        <th>Expiry</th>
                        <th className="num">Staged Qty</th>
                        <th className="num">Accepted Qty</th>
                        <th className="num">Returned to Shelf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeReq.items.map((item) => {
                        const acc = item.accepted_qty !== undefined ? item.accepted_qty : item.staged_qty;
                        const ret = Math.max(0, item.staged_qty - acc);
                        return (
                          <tr key={item.request_item_id}>
                            <td>
                              <b>{item.item_name}</b>
                              <div className="meta">{item.item_code}</div>
                            </td>
                            <td><span className="m">{item.batch_number}</span></td>
                            <td><span className="m">{item.expiry_date}</span></td>
                            <td className="num">{formatQty(item.staged_qty, item.uom)}</td>
                            <td className="num">
                              <b style={{ color: acc > 0 ? 'var(--forest)' : 'var(--ink-2)' }}>
                                {formatQty(acc, item.uom)}
                              </b>
                            </td>
                            <td className="num">
                              {ret > 0 ? (
                                <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                                  +{formatQty(ret, item.uom)}
                                </span>
                              ) : (
                                <span className="gloss">0.0 {item.uom}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Immutable Ledger Appended Rows Card */}
                <div className="stub" style={{ marginBottom: 18 }}>
                  <span className="lbl">Immutable Stock Ledger Audit Footprint (Flow C-2)</span>
                  <p className="gloss" style={{ margin: '4px 0 10px' }}>
                    Movement transactions appended to table <code>t_stock_movements</code>:
                  </p>

                  {activeReq.items.map((item) => {
                    const acc = item.accepted_qty !== undefined ? item.accepted_qty : item.staged_qty;
                    const isFull = activeReq.status === 'CONFIRMED';
                    const isDeclined = activeReq.status === 'PARTIAL_DECLINED';

                    return (
                      <div key={item.request_item_id} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px dotted var(--rule)' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                          {item.item_name} ({item.item_code}) &middot; Batch: {item.batch_number}
                        </div>

                        {isDeclined ? (
                          <div className="ledrow">
                            <span className="t" style={{ color: 'var(--forest)' }}>ISSUE_REVERSAL</span>
                            <span>Shelf stock restored &middot; Full decline</span>
                            <span className="num pos">+{formatQty(item.staged_qty, item.uom)}</span>
                          </div>
                        ) : (
                          <>
                            <div className="ledrow">
                              <span className="t" style={{ color: 'var(--forest)' }}>ISSUE_PENDING_OFFSET</span>
                              <span>Staging reservation cleared</span>
                              <span className="num pos">+{formatQty(item.staged_qty, item.uom)}</span>
                            </div>
                            {acc > 0 && (
                              <div className="ledrow">
                                <span className="t" style={{ color: 'var(--err)' }}>ISSUE_CONFIRMED</span>
                                <span>Kitchen physical custody booked</span>
                                <span className="num neg">&minus;{formatQty(acc, item.uom)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
                    <span className="meta">Digital Receipt Verification Signature</span>
                    <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      SHA-256: 8c3f91a7e4b2... verified append-only
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => {
                      showToast(`Digital receipt ${activeReq.receipt_id} copied to clipboard`);
                    }}
                  >
                    Copy Receipt Reference
                  </button>

                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setStatusTab('AWAITING');
                      const nextAwaiting = awaitingRequisitions[0];
                      if (nextAwaiting) setSelectedReqId(nextAwaiting.request_id);
                    }}
                  >
                    Back to Door Queue
                  </button>
                </div>
              </Ticket>
            )
          ) : (
            <div className="stub w" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <span className="lbl">No requisition selected</span>
              <p className="sub" style={{ margin: '8px auto 0' }}>
                Select an awaiting requisition from the left column to begin frontline door inspection.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Decline All Modal / Dialog */}
      {showDeclineModal && activeReq && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="decline-dialog-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(23, 28, 43, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
        >
          <div
            className="tk"
            style={{
              width: 520,
              maxWidth: '100%',
              borderRadius: 4,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <div className="tk-head">
              <span className="no" id="decline-dialog-title">DECLINE REQUISITION GOODS</span>
              <span className="fill" />
              <Badge variant="er">MANDATORY REASON</Badge>
            </div>

            <div className="tk-body">
              <p className="sub" style={{ margin: '0 0 14px' }}>
                You are declining all goods for <b>{activeReq.request_id}</b> ({activeReq.section_name}). All physical items will be returned to storeroom shelves and an <code>ISSUE_REVERSAL</code> will be appended to the ledger.
              </p>

              <div className="fld">
                <label htmlFor="decline-category" className="lbl">
                  Primary Decline Reason *
                </label>
                <select
                  id="decline-category"
                  className="in"
                  value={declineReasonCategory}
                  onChange={(e) => setDeclineReasonCategory(e.target.value)}
                >
                  <option value="Quality / freshness issue">Quality / freshness issue</option>
                  <option value="Temperature deviation / cold-line break">Temperature deviation / cold-line break</option>
                  <option value="Damaged / torn outer packaging">Damaged / torn outer packaging</option>
                  <option value="Wrong item or incorrect specification cut">Wrong item or incorrect specification cut</option>
                  <option value="Shelf life / expiry too short for service prep">Shelf life / expiry too short for service prep</option>
                  <option value="Other reason">Other reason (describe below)</option>
                </select>
              </div>

              <div className="fld">
                <label htmlFor="decline-notes" className="lbl">
                  Specific Inspection Notes *
                </label>
                <textarea
                  id="decline-notes"
                  className="in"
                  rows={3}
                  placeholder="Detail physical inspection finding (e.g. torn vacuum seal on mozzarella block; temperature probe measured 11C)..."
                  value={declineReasonNotes}
                  onChange={(e) => setDeclineReasonNotes(e.target.value)}
                />
              </div>

              <div className="dash" />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setShowDeclineModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn sm"
                  style={{ background: 'var(--err)', borderColor: 'var(--err)' }}
                  onClick={handleConfirmDecline}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Recording Decline...' : 'Confirm Decline & Return to Shelf'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
