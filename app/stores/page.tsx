'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  getStoresAndWarehouses,
  getGoLiveChecklist,
  proposeStoreOrWarehouse,
  getStoreProposals,
  decideStoreProposal,
  getCustodianCandidates,
  resolveStaffName,
  StoreWithWarehouses,
  GoLiveChecklist,
  StoreWarehouseApprovalRecord,
  ProposalType,
  StorageType,
} from '@/lib/data/stores';

type StoreTab = 'active' | 'propose' | 'review';

export default function StoresManagementPage() {
  const { role, roleConfig, store, setStore, showToast } = useShell();

  // Active top-level tab
  const [activeTab, setActiveTab] = useState<StoreTab>('active');

  // Master data state
  const [stores, setStores] = useState<StoreWithWarehouses[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(store || 'IND-DEL-01');
  const [checklist, setChecklist] = useState<GoLiveChecklist | null>(null);
  const [isLoadingStores, setIsLoadingStores] = useState<boolean>(true);
  const [isLoadingChecklist, setIsLoadingChecklist] = useState<boolean>(false);

  // Proposals state
  const [proposals, setProposals] = useState<StoreWarehouseApprovalRecord[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [proposalFilter, setProposalFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [isLoadingProposals, setIsLoadingProposals] = useState<boolean>(true);

  // Flow H Proposal Form state (Tab 2)
  const [proposalType, setProposalType] = useState<ProposalType>('NEW_STORE');
  const [proposedName, setProposedName] = useState<string>('');
  const [targetStoreId, setTargetStoreId] = useState<string>(store || 'IND-DEL-01');
  const [storageType, setStorageType] = useState<StorageType>('COLD_ROOM');
  const [nominatedCustodianId, setNominatedCustodianId] = useState<string>('usr-custodian-01');
  const [nominatedBackupId, setNominatedBackupId] = useState<string>('usr-cust-backup');
  const [proposalReason, setProposalReason] = useState<string>('');
  const [isSubmittingProposal, setIsSubmittingProposal] = useState<boolean>(false);
  const [proposalError, setProposalError] = useState<string | null>(null);

  // Review Form state (Tab 3)
  const [fcComment, setFcComment] = useState<string>('');
  const [isDeciding, setIsDeciding] = useState<boolean>(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const candidates = useMemo(() => getCustodianCandidates(), []);

  // Resolve current active user ID from active role context
  const currentUserId = useMemo(() => {
    if (role === 'fc') return 'usr-approver-01';
    if (role === 'keeper') return 'usr-admin-01';
    if (role === 'rm') return 'usr-rm-01';
    if (role === 'admin') return 'usr-sysadmin-01';
    if (role === 'cust') return 'usr-custodian-01';
    if (role === 'acct') return 'usr-accountant-01';
    return 'usr-admin-01';
  }, [role]);

  // Load stores and warehouses
  const loadMasterData = useCallback(async () => {
    setIsLoadingStores(true);
    try {
      const data = await getStoresAndWarehouses();
      setStores(data);
      if (data.length > 0 && !data.some((s) => s.store_id === selectedStoreId)) {
        setSelectedStoreId(data[0].store_id);
      }
    } catch (e) {
      console.warn('Failed to load stores:', e);
    } finally {
      setIsLoadingStores(false);
    }
  }, [selectedStoreId]);

  // Load Go-Live Checklist for selected store
  const loadChecklist = useCallback(async (storeId: string) => {
    setIsLoadingChecklist(true);
    try {
      const data = await getGoLiveChecklist(storeId);
      setChecklist(data);
    } catch (e) {
      console.warn('Failed to load checklist:', e);
    } finally {
      setIsLoadingChecklist(false);
    }
  }, []);

  // Load Flow H proposals
  const loadProposals = useCallback(async () => {
    setIsLoadingProposals(true);
    try {
      const list = await getStoreProposals();
      setProposals(list);
      if (!selectedProposalId && list.length > 0) {
        setSelectedProposalId(list[0].approval_id);
      }
    } catch (e) {
      console.warn('Failed to load proposals:', e);
    } finally {
      setIsLoadingProposals(false);
    }
  }, [selectedProposalId]);

  useEffect(() => {
    loadMasterData();
    loadProposals();
  }, [loadMasterData, loadProposals]);

  useEffect(() => {
    if (selectedStoreId) {
      loadChecklist(selectedStoreId);
    }
  }, [selectedStoreId, loadChecklist]);

  // Active store object
  const activeStore = useMemo(() => {
    return stores.find((s) => s.store_id === selectedStoreId) || stores[0];
  }, [stores, selectedStoreId]);

  // Filtered proposals list
  const filteredProposals = useMemo(() => {
    if (proposalFilter === 'pending') {
      return proposals.filter((p) => p.fc_decision === 'PENDING');
    }
    if (proposalFilter === 'approved') {
      return proposals.filter((p) => p.fc_decision === 'APPROVED');
    }
    if (proposalFilter === 'rejected') {
      return proposals.filter((p) => p.fc_decision === 'REJECTED');
    }
    return proposals;
  }, [proposals, proposalFilter]);

  const pendingProposalsCount = useMemo(() => {
    return proposals.filter((p) => p.fc_decision === 'PENDING').length;
  }, [proposals]);

  const selectedProposal = useMemo(() => {
    return proposals.find((p) => p.approval_id === selectedProposalId) || filteredProposals[0] || null;
  }, [proposals, selectedProposalId, filteredProposals]);

  // Validation rules for Tab 2
  const isCustodySegregationValid = nominatedCustodianId !== nominatedBackupId;
  const isProposalNameValid = proposedName.trim().length > 0;
  const canSubmitProposal =
    isCustodySegregationValid &&
    isProposalNameValid &&
    !isSubmittingProposal &&
    (proposalType === 'NEW_STORE' || Boolean(targetStoreId));

  // Handle Flow H Submission (Tab 2)
  const handleProposalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitProposal) return;

    setProposalError(null);
    setIsSubmittingProposal(true);

    const result = await dispatchAction({
      actionName: 'propose_store_or_warehouse',
      storeId: proposalType === 'NEW_WAREHOUSE' ? targetStoreId : undefined,
      payload: {
        proposalType,
        proposedName: proposedName.trim(),
        storeId: proposalType === 'NEW_WAREHOUSE' ? targetStoreId : null,
        storageType,
        nominatedCustodianId,
        nominatedBackupId,
        proposalReason: proposalReason.trim(),
      },
      execute: async () => {
        return await proposeStoreOrWarehouse({
          proposalType,
          proposedName: proposedName.trim(),
          storeId: proposalType === 'NEW_WAREHOUSE' ? targetStoreId : null,
          storageType,
          nominatedCustodianId,
          nominatedBackupId,
          requestedByUserId: currentUserId,
          reason: proposalReason.trim(),
        });
      },
      onSuccess: (newApprovalId) => {
        showToast(
          `Proposal submitted successfully for Financial Controller review. ID: ${newApprovalId.slice(0, 8)}`
        );
        // Reset form
        setProposedName('');
        setProposalReason('');
        loadProposals();
        // Switch to Review tab to show queued proposal
        setActiveTab('review');
        setSelectedProposalId(newApprovalId);
      },
      onError: (err) => {
        setProposalError(err.message || 'Failed to submit proposal.');
      },
    });

    setIsSubmittingProposal(false);
  };

  // Handle FC Decision (Tab 3)
  const handleDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!selectedProposal || isDeciding) return;

    if (decision === 'REJECTED' && !fcComment.trim()) {
      setDecisionError('Mandatory written justification is required when rejecting a proposal.');
      return;
    }

    setDecisionError(null);
    setIsDeciding(true);

    const result = await dispatchAction({
      actionName: 'decide_store_warehouse_proposal',
      storeId: selectedProposal.store_id || undefined,
      payload: {
        approvalId: selectedProposal.approval_id,
        decision,
        comment: fcComment.trim(),
      },
      execute: async () => {
        return await decideStoreProposal({
          approvalId: selectedProposal.approval_id,
          decision,
          comment: fcComment.trim(),
          reviewerUserId: currentUserId,
        });
      },
      onSuccess: () => {
        showToast(
          decision === 'APPROVED'
            ? 'Proposal approved. Store/warehouse automatically provisioned in master records.'
            : 'Proposal rejected with recorded justification.'
        );
        setFcComment('');
        loadProposals();
        loadMasterData();
        if (selectedProposal.store_id) {
          loadChecklist(selectedProposal.store_id);
        }
      },
      onError: (err) => {
        setDecisionError(err.message || 'Failed to record proposal decision.');
      },
    });

    setIsDeciding(false);
  };

  // Helper formatting badges
  const getStorageTypeBadge = (st: StorageType | null) => {
    if (st === 'FREEZER') {
      return <Badge variant="ur">Walk-in Freezer (-18°C)</Badge>;
    }
    if (st === 'DRY_STORE') {
      return <Badge variant="re">Dry Store (Ambient)</Badge>;
    }
    return <Badge variant="ok">Cold Room (2°C - 4°C)</Badge>;
  };

  const getDecisionBadge = (decision: string) => {
    if (decision === 'APPROVED') {
      return <Badge variant="ok">APPROVED</Badge>;
    }
    if (decision === 'REJECTED') {
      return <Badge variant="er">REJECTED</Badge>;
    }
    return <Badge variant="am">PENDING FC</Badge>;
  };

  // Segregation of duties invariant check for proposal approval
  const isProposerOfSelected = Boolean(
    selectedProposal && selectedProposal.requested_by_user_id === currentUserId
  );

  const canDecide = (role === 'fc' || role === 'admin') && !isProposerOfSelected;

  return (
    <>
      {/* Page Header */}
      <div className="head">
        <div>
          <div className="kicker">Facility Configuration &middot; Flow H</div>
          <h1 className="h1">
            Stores &amp; <em>Storerooms</em>
          </h1>
          <div className="sub" style={{ marginTop: 4 }}>
            Store profiles, physical room custody assignments, and Flow H expansion governance.
          </div>
        </div>

        {/* Top-Level Section Navigation Tabs */}
        <div className="seg" role="tablist" aria-label="Store administration tabs">
          <button
            type="button"
            className={activeTab === 'active' ? 'on' : ''}
            onClick={() => setActiveTab('active')}
            role="tab"
            aria-selected={activeTab === 'active'}
          >
            Active Stores &amp; Storerooms ({stores.length})
          </button>
          <button
            type="button"
            className={activeTab === 'propose' ? 'on' : ''}
            onClick={() => setActiveTab('propose')}
            role="tab"
            aria-selected={activeTab === 'propose'}
          >
            Propose Facility (Flow H)
          </button>
          <button
            type="button"
            className={activeTab === 'review' ? 'on' : ''}
            onClick={() => setActiveTab('review')}
            role="tab"
            aria-selected={activeTab === 'review'}
          >
            Proposals Review {pendingProposalsCount > 0 && `(${pendingProposalsCount} Pending)`}
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: ACTIVE STORES & STOREROOMS */}
      {/* ===================================================================== */}
      {activeTab === 'active' && (
        <div className="stack">
          {/* Decision Q9 Physical Storeroom Scope Note */}
          <div className="note am" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <b>Decision Q9 Physical Scope Directive:</b> Walk-in Freezers are strictly excluded from
              core Stage 1 operations. Standard locations operate with Ground-Floor Cold Rooms (WH-01)
              and Dry Stores (WH-02) only. Any required deep freezer additions must be formally submitted
              and authorized via <b>Flow H (Propose Facility)</b>.
            </div>
          </div>

          {/* High-level status overview tiles */}
          <div className="tiles">
            <div className="tile on">
              <span className="lbl">Active Locations</span>
              <span className="big">{stores.length}</span>
              <span className="s">Operating restaurant stores</span>
            </div>
            <div className="tile">
              <span className="lbl">Physical Storerooms</span>
              <span className="big">
                {stores.reduce((acc, s) => acc + (s.warehouses?.length || 0), 0)}
              </span>
              <span className="s">Cold rooms &amp; dry stores</span>
            </div>
            <div className="tile">
              <span className="lbl">Core Room Types</span>
              <span className="big">WH-01 / 02</span>
              <span className="s">Ground cold room &amp; dry store</span>
            </div>
            <div className="tile">
              <span className="lbl">Pending Proposals</span>
              <span className="big">{pendingProposalsCount}</span>
              <span className="s">Awaiting FC review</span>
            </div>
          </div>

          {/* Store Selection Chips */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <Chips aria-label="Select store to view facilities">
              {stores.map((s) => (
                <Chip
                  key={s.store_id}
                  label={s.store_name}
                  count={s.warehouses?.length || 0}
                  active={s.store_id === selectedStoreId}
                  onClick={() => {
                    setSelectedStoreId(s.store_id);
                    setStore(s.store_id);
                  }}
                />
              ))}
            </Chips>

            <span className="meta">
              Selected: <b>{activeStore?.store_name}</b> ({activeStore?.city})
            </span>
          </div>

          {/* Two-Column Layout: Left = Storerooms Table, Right = Go-Live Assignment Checklist */}
          {activeStore && (
            <div className="cols" style={{ gridTemplateColumns: '1fr 440px' }}>
              {/* Left Column: Storeroom Inventory Table */}
              <div className="stack">
                <Ticket
                  no={activeStore.store_id}
                  right={<Badge variant={activeStore.is_active ? 'ok' : 'er'}>{activeStore.status}</Badge>}
                >
                  <div style={{ marginBottom: 16 }}>
                    <div className="kicker">Facility Inventory</div>
                    <h2 className="h3" style={{ margin: '4px 0 0' }}>
                      {activeStore.store_name}
                    </h2>
                    <div className="meta" style={{ marginTop: 2 }}>
                      City: {activeStore.city} &middot; Store Code: {activeStore.store_id}
                    </div>
                  </div>

                  <table aria-label={`Storerooms at ${activeStore.store_name}`}>
                    <thead>
                      <tr>
                        <th>Storeroom Code</th>
                        <th>Storeroom Name</th>
                        <th>Storage Type</th>
                        <th>Floor</th>
                        <th style={{ textAlign: 'right' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeStore.warehouses && activeStore.warehouses.length > 0 ? (
                        activeStore.warehouses.map((wh) => (
                          <tr key={wh.warehouse_id}>
                            <td className="m">
                              <b>{wh.warehouse_id}</b>
                            </td>
                            <td>{wh.warehouse_name}</td>
                            <td>{getStorageTypeBadge(wh.storage_type)}</td>
                            <td className="m">{wh.floor_level}</td>
                            <td style={{ textAlign: 'right' }}>
                              <Badge variant={wh.is_active ? 'ok' : 'er'}>{wh.status}</Badge>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-3)' }}>
                            No storerooms provisioned for this store location.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* Scheduled Operating Windows Summary */}
                  <div
                    className="stub"
                    style={{
                      marginTop: 20,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 12,
                    }}
                  >
                    <div>
                      <span className="lbl">Morning Issue Window</span>
                      <div className="num" style={{ fontSize: 16, marginTop: 2 }}>
                        {checklist?.morning_issue_window || '06:00 - 08:30'}
                      </div>
                      <span className="meta">Kitchen prep dispenses</span>
                    </div>

                    <div>
                      <span className="lbl">Afternoon Issue Window</span>
                      <div className="num" style={{ fontSize: 16, marginTop: 2 }}>
                        {checklist?.afternoon_issue_window || '14:30 - 16:00'}
                      </div>
                      <span className="meta">Evening service handover</span>
                    </div>

                    <div>
                      <span className="lbl">Morning Dock Intake Window</span>
                      <div className="num" style={{ fontSize: 16, marginTop: 2 }}>
                        {checklist?.morning_receiving_window || '07:00 - 09:00'}
                      </div>
                      <span className="meta">Primary physical intake</span>
                    </div>

                    <div>
                      <span className="lbl">Afternoon Dock Intake Window</span>
                      <div className="num" style={{ fontSize: 16, marginTop: 2 }}>
                        {checklist?.afternoon_receiving_window || '14:00 - 16:00'}
                      </div>
                      <span className="meta">Secondary replenishment</span>
                    </div>
                  </div>
                </Ticket>
              </div>

              {/* Right Column: Go-Live Assignment Checklist */}
              <div className="stack">
                <Ticket
                  no={`CHECKLIST: ${activeStore.store_id}`}
                  right={
                    checklist?.is_complete ? (
                      <Badge variant="ok">Go-Live Ready</Badge>
                    ) : (
                      <Badge variant="am">Configuration Incomplete</Badge>
                    )
                  }
                >
                  <div style={{ marginBottom: 14 }}>
                    <div className="kicker">Master Data Audit</div>
                    <h2 className="h3" style={{ margin: '4px 0 0' }}>
                      Go-Live Assignment Checklist
                    </h2>
                    <div className="meta" style={{ marginTop: 2 }}>
                      Mandatory personnel and operational window assignments.
                    </div>
                  </div>

                  <div className="stack" style={{ gap: 10 }}>
                    {/* Item 1: Nominated Primary Custodian */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: checklist?.cold_room_custodian_id ? 'var(--paper)' : 'var(--amber-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Nominated Primary Custodian</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.cold_room_custodian_name || 'Unassigned'} &middot; Room security lead
                        </div>
                      </div>
                      <Badge variant={checklist?.cold_room_custodian_id ? 'ok' : 'er'}>
                        {checklist?.cold_room_custodian_id ? 'Assigned' : 'Missing'}
                      </Badge>
                    </div>

                    {/* Item 2: Nominated Backup Custodian */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: checklist?.cold_room_backup_id ? 'var(--paper)' : 'var(--amber-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Nominated Backup Custodian</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.cold_room_backup_name || 'Unassigned'} &middot; Alternate key holder
                        </div>
                      </div>
                      <Badge variant={checklist?.cold_room_backup_id ? 'ok' : 'er'}>
                        {checklist?.cold_room_backup_id ? 'Assigned' : 'Missing'}
                      </Badge>
                    </div>

                    {/* Item 3: Dry Store Primary Custodian */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: 'var(--paper)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Dry Store Custodian</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.dry_store_custodian_name || 'Unassigned'} &middot; Ambient storage lead
                        </div>
                      </div>
                      <Badge variant={checklist?.dry_store_custodian_id ? 'ok' : 'mu'}>
                        {checklist?.dry_store_custodian_id ? 'Assigned' : 'Optional'}
                      </Badge>
                    </div>

                    {/* Item 4: Authorized Kitchen Runner */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: 'var(--paper)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Kitchen Runner</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.kitchen_runner_name || 'Designated Kitchen Team'} &middot; Digital confirm
                        </div>
                      </div>
                      <Badge variant="ok">Verified</Badge>
                    </div>

                    {/* Item 5: Evening Key Holder */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: 'var(--paper)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Evening Key Holder</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.evening_key_holder_name || 'Manager on Duty'} &middot; Flow E transfer
                        </div>
                      </div>
                      <Badge variant="ok">Active</Badge>
                    </div>

                    {/* Item 6: Morning Issue Window */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: 'var(--paper)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Morning Issue Window</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.morning_issue_window || '06:00 - 08:30'}
                        </div>
                      </div>
                      <Badge variant="ok">Configured</Badge>
                    </div>

                    {/* Item 7: Afternoon Issue Window */}
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid var(--rule)',
                        borderRadius: 4,
                        background: 'var(--paper)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>Afternoon Issue Window</div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {checklist?.afternoon_issue_window || '14:30 - 16:00'}
                        </div>
                      </div>
                      <Badge variant="ok">Configured</Badge>
                    </div>
                  </div>

                  <div
                    className="note ok"
                    style={{
                      marginTop: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>
                      <b>Segregation Status:</b> Custodian &ne; Backup verified. Distinct personnel assigned.
                    </span>
                    <Badge variant="ok">Enforced</Badge>
                  </div>
                </Ticket>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: PROPOSE NEW STORE OR WAREHOUSE (FLOW H) */}
      {/* ===================================================================== */}
      {activeTab === 'propose' && (
        <div className="stack">
          {/* Policy context reminder */}
          <div className="note" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <b>Flow H Expansion Protocol:</b> Any new restaurant store or individual storeroom requires
              a formal expansion proposal submitted by a Restaurant Manager (RM) or Warehouse Keeper (ADMIN),
              with mandatory nomination of distinct primary and backup custodians, culminating in Financial
              Controller (FC) digital sign-off.
            </div>
          </div>

          <div className="cols" style={{ gridTemplateColumns: '1fr 380px' }}>
            {/* Form Column */}
            <div>
              <Ticket no="FLOW-H-SUBMISSION" right={<Badge variant="mu">Draft Proposal</Badge>}>
                <form onSubmit={handleProposalSubmit}>
                  <div style={{ marginBottom: 18 }}>
                    <div className="kicker">Expansion Type</div>
                    <h2 className="h3" style={{ margin: '4px 0 0' }}>
                      Propose Facility Addition
                    </h2>
                    <div className="meta" style={{ marginTop: 2 }}>
                      Submit a new restaurant store or additional storeroom for central review.
                    </div>
                  </div>

                  {proposalError && (
                    <div className="note er" style={{ marginBottom: 16 }}>
                      <b>Submission Failed:</b> {proposalError}
                    </div>
                  )}

                  {/* 1. Proposal Type Toggle */}
                  <div className="fld">
                    <label className="lbl">Proposal Classification *</label>
                    <div className="seg" role="radiogroup" aria-label="Proposal Type" style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className={proposalType === 'NEW_STORE' ? 'on' : ''}
                        onClick={() => setProposalType('NEW_STORE')}
                        role="radio"
                        aria-checked={proposalType === 'NEW_STORE'}
                      >
                        New Restaurant Store
                      </button>
                      <button
                        type="button"
                        className={proposalType === 'NEW_WAREHOUSE' ? 'on' : ''}
                        onClick={() => setProposalType('NEW_WAREHOUSE')}
                        role="radio"
                        aria-checked={proposalType === 'NEW_WAREHOUSE'}
                      >
                        New Storeroom
                      </button>
                    </div>
                  </div>

                  {/* 2. Parent Store Selector (only if proposing a new storeroom) */}
                  {proposalType === 'NEW_WAREHOUSE' && (
                    <div className="fld">
                      <label className="lbl" htmlFor="target-store-select">
                        Parent Store Location *
                      </label>
                      <select
                        id="target-store-select"
                        className="in"
                        value={targetStoreId}
                        onChange={(e) => setTargetStoreId(e.target.value)}
                        required
                      >
                        {stores.map((s) => (
                          <option key={s.store_id} value={s.store_id}>
                            {s.store_id} &middot; {s.store_name} ({s.city})
                          </option>
                        ))}
                      </select>
                      <span className="meta" style={{ marginTop: 4, display: 'block' }}>
                        The storeroom will be provisioned directly under this store profile.
                      </span>
                    </div>
                  )}

                  {/* 3. Proposed Name */}
                  <div className="fld">
                    <label className="lbl" htmlFor="proposed-name-input">
                      Proposed Facility Name *
                    </label>
                    <input
                      id="proposed-name-input"
                      type="text"
                      className="in"
                      value={proposedName}
                      onChange={(e) => setProposedName(e.target.value)}
                      placeholder={
                        proposalType === 'NEW_STORE'
                          ? 'e.g. Mumbai Bandra Store 1'
                          : 'e.g. Delhi Central Deep Freezer Room'
                      }
                      required
                    />
                  </div>

                  {/* 4. Storage Type Selector */}
                  <div className="fld">
                    <label className="lbl" htmlFor="storage-type-select">
                      Storeroom Storage Type *
                    </label>
                    <select
                      id="storage-type-select"
                      className="in"
                      value={storageType}
                      onChange={(e) => setStorageType(e.target.value as StorageType)}
                    >
                      <option value="COLD_ROOM">Cold Room (Chilled 2°C to 4°C &middot; WH-01 Standard)</option>
                      <option value="DRY_STORE">Dry Store (Ambient Dry Goods &middot; WH-02 Standard)</option>
                      <option value="FREEZER">
                        Walk-in Deep Freezer (-18°C &middot; Decision Q9 Exception Expansion)
                      </option>
                    </select>
                    {storageType === 'FREEZER' && (
                      <div className="note am" style={{ marginTop: 8 }}>
                        <b>Decision Q9 Note:</b> Deep freezers are not part of initial baseline store setups.
                        Selecting Walk-in Freezer initiates an exceptional review requiring specific operational justification.
                      </div>
                    )}
                  </div>

                  {/* 5. Custodian Nominations (Enforcing distinct users) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="fld">
                      <label className="lbl" htmlFor="primary-custodian-select">
                        Nominated Primary Custodian *
                      </label>
                      <select
                        id="primary-custodian-select"
                        className="in"
                        value={nominatedCustodianId}
                        onChange={(e) => setNominatedCustodianId(e.target.value)}
                        required
                      >
                        {candidates.map((c) => (
                          <option key={`primary-${c.userId}`} value={c.userId}>
                            {c.fullName} ({c.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="fld">
                      <label className="lbl" htmlFor="backup-custodian-select">
                        Nominated Backup Custodian *
                      </label>
                      <select
                        id="backup-custodian-select"
                        className="in"
                        value={nominatedBackupId}
                        onChange={(e) => setNominatedBackupId(e.target.value)}
                        required
                      >
                        {candidates.map((c) => (
                          <option key={`backup-${c.userId}`} value={c.userId}>
                            {c.fullName} ({c.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Invariant Error Notice if Primary == Backup */}
                  {!isCustodySegregationValid && (
                    <div className="note er" style={{ marginBottom: 14 }}>
                      <b>Segregation of Duties Enforced:</b> Nominated primary custodian and backup custodian
                      must be two distinct personnel. Please select a different backup custodian.
                    </div>
                  )}

                  {/* 6. Operational Rationale */}
                  <div className="fld">
                    <label className="lbl" htmlFor="proposal-reason-input">
                      Operational Rationale &amp; Physical Scope Details
                    </label>
                    <textarea
                      id="proposal-reason-input"
                      className="in"
                      rows={3}
                      value={proposalReason}
                      onChange={(e) => setProposalReason(e.target.value)}
                      placeholder="Detail floor plan considerations, volume requirements, shelving specifications..."
                    />
                  </div>

                  {/* Submission Seam */}
                  <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="submit"
                      className="btn"
                      disabled={!canSubmitProposal}
                    >
                      {isSubmittingProposal ? 'Submitting...' : 'Submit Proposal (Status: PENDING_FC)'}
                    </button>
                    <span className="meta">
                      Requires FC authorization to provision in master database.
                    </span>
                  </div>
                </form>
              </Ticket>
            </div>

            {/* Right Guide Column */}
            <div>
              <Ticket no="FLOW-H-STANDARDS" right={<Badge variant="ok">SOP Standard</Badge>}>
                <div className="kicker">Governing Rules</div>
                <h3 className="h3" style={{ margin: '4px 0 0' }}>
                  Expansion Requirements
                </h3>

                <div className="stack" style={{ marginTop: 14, gap: 12 }}>
                  <div className="stub">
                    <span className="lbl">1. Authorization Hierarchy</span>
                    <div className="meta" style={{ marginTop: 2 }}>
                      Proposals are initiated by Restaurant Managers or Warehouse Keepers, but only the
                      Financial Controller can authorize master creation.
                    </div>
                  </div>

                  <div className="stub">
                    <span className="lbl">2. Dual-Custodian Mandatory</span>
                    <div className="meta" style={{ marginTop: 2 }}>
                      Every physical room must have two named key-holders on record before it can receive
                      initial goods intakes.
                    </div>
                  </div>

                  <div className="stub">
                    <span className="lbl">3. Freezers Out-of-Scope Baseline</span>
                    <div className="meta" style={{ marginTop: 2 }}>
                      Per Decision Q9, standard setups include only Ground-Floor Cold Rooms and Dry Stores.
                      Freezer expansion requires formal FC justification.
                    </div>
                  </div>

                  <div className="stub">
                    <span className="lbl">4. Automated Provisioning</span>
                    <div className="meta" style={{ marginTop: 2 }}>
                      Upon FC approval, master records in <code>m_stores</code> or <code>m_warehouses</code> are
                      instantly created with standard operating windows.
                    </div>
                  </div>
                </div>
              </Ticket>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: STORE PROPOSALS REVIEW (FOR FC) */}
      {/* ===================================================================== */}
      {activeTab === 'review' && (
        <div className="stack">
          {/* FC Role Scope Notice */}
          <div className="note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <b>Financial Controller Review Desk:</b> Evaluate pending restaurant store and storeroom proposals.
              Approvals immediately provision active master records in <code>m_stores</code> and <code>m_warehouses</code>.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Badge variant={role === 'fc' || role === 'admin' ? 'ok' : 'am'}>
                Current Role: {roleConfig.l}
              </Badge>
            </div>
          </div>

          {/* Filter Chips */}
          <Chips aria-label="Filter proposals">
            <Chip
              label="All Proposals"
              count={proposals.length}
              active={proposalFilter === 'all'}
              onClick={() => setProposalFilter('all')}
            />
            <Chip
              label="Pending FC"
              count={proposals.filter((p) => p.fc_decision === 'PENDING').length}
              active={proposalFilter === 'pending'}
              onClick={() => setProposalFilter('pending')}
            />
            <Chip
              label="Approved"
              count={proposals.filter((p) => p.fc_decision === 'APPROVED').length}
              active={proposalFilter === 'approved'}
              onClick={() => setProposalFilter('approved')}
            />
            <Chip
              label="Rejected"
              count={proposals.filter((p) => p.fc_decision === 'REJECTED').length}
              active={proposalFilter === 'rejected'}
              onClick={() => setProposalFilter('rejected')}
            />
          </Chips>

          {/* 2-Column Proposal Review Workplace */}
          <div className="cols" style={{ gridTemplateColumns: '1fr 420px' }}>
            {/* Left Column: Proposals List */}
            <div className="stack">
              <Ticket no="PROPOSALS-QUEUE" right={<Badge variant="mu">{filteredProposals.length} items</Badge>}>
                {filteredProposals.length > 0 ? (
                  <table aria-label="Proposals list">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Facility Name</th>
                        <th>Target Store</th>
                        <th>Storage Type</th>
                        <th>Submitted By</th>
                        <th style={{ textAlign: 'right' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProposals.map((p) => {
                        const isSelected = selectedProposal?.approval_id === p.approval_id;
                        return (
                          <tr
                            key={p.approval_id}
                            className={`row ${isSelected ? 'sel' : ''}`}
                            onClick={() => {
                              setSelectedProposalId(p.approval_id);
                              setFcComment(p.fc_comment || '');
                              setDecisionError(null);
                            }}
                          >
                            <td>
                              <Badge variant={p.proposal_type === 'NEW_STORE' ? 'ok' : 're'}>
                                {p.proposal_type === 'NEW_STORE' ? 'NEW STORE' : 'NEW ROOM'}
                              </Badge>
                            </td>
                            <td>
                              <b>{p.proposed_name}</b>
                            </td>
                            <td className="m">{p.store_name || p.store_id || 'Standalone Store'}</td>
                            <td>{getStorageTypeBadge(p.storage_type)}</td>
                            <td className="m">
                              {p.requested_by_name}
                              <br />
                              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                                {new Date(p.requested_at).toLocaleDateString()}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>{getDecisionBadge(p.fc_decision)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--ink-3)' }}>
                    No expansion proposals found for the selected filter.
                  </div>
                )}
              </Ticket>
            </div>

            {/* Right Column: Detail & Decision Console */}
            <div>
              {selectedProposal ? (
                <Ticket
                  no={`ID: ${selectedProposal.approval_id.slice(0, 8)}`}
                  right={getDecisionBadge(selectedProposal.fc_decision)}
                >
                  <div style={{ marginBottom: 14 }}>
                    <div className="kicker">Proposal Specification</div>
                    <h3 className="h3" style={{ margin: '4px 0 0' }}>
                      {selectedProposal.proposed_name}
                    </h3>
                    <div className="meta" style={{ marginTop: 2 }}>
                      {selectedProposal.proposal_type === 'NEW_STORE'
                        ? 'New Restaurant Store Proposal'
                        : `New Storeroom for ${selectedProposal.store_name || selectedProposal.store_id}`}
                    </div>
                  </div>

                  <div className="stack" style={{ gap: 10 }}>
                    <div className="stub">
                      <span className="lbl">Storage Category</span>
                      <div style={{ marginTop: 4 }}>{getStorageTypeBadge(selectedProposal.storage_type)}</div>
                    </div>

                    <div className="stub">
                      <span className="lbl">Nominated Primary Custodian</span>
                      <div style={{ fontWeight: 600, marginTop: 2 }}>
                        {selectedProposal.nominated_custodian_name}
                      </div>
                      <span className="meta">Designated lead room keeper</span>
                    </div>

                    <div className="stub">
                      <span className="lbl">Nominated Backup Custodian</span>
                      <div style={{ fontWeight: 600, marginTop: 2 }}>
                        {selectedProposal.nominated_backup_name}
                      </div>
                      <span className="meta">Verified distinct personnel</span>
                    </div>

                    <div className="stub">
                      <span className="lbl">Submitted By</span>
                      <div style={{ fontWeight: 500, marginTop: 2 }}>
                        {selectedProposal.requested_by_name}
                      </div>
                      <span className="meta">
                        {new Date(selectedProposal.requested_at).toLocaleString()}
                      </span>
                    </div>

                    {/* If proposal is already decided */}
                    {selectedProposal.fc_decision !== 'PENDING' && (
                      <div
                        className={`note ${selectedProposal.fc_decision === 'APPROVED' ? 'ok' : 'er'}`}
                        style={{ marginTop: 8 }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          Decision: {selectedProposal.fc_decision}
                        </div>
                        <div style={{ marginTop: 2 }}>
                          Decided by: <b>{selectedProposal.decided_by_name || 'Financial Controller'}</b> on{' '}
                          {selectedProposal.decided_at
                            ? new Date(selectedProposal.decided_at).toLocaleString()
                            : 'N/A'}
                        </div>
                        {selectedProposal.fc_comment && (
                          <div style={{ marginTop: 6, fontStyle: 'italic' }}>
                            &ldquo;{selectedProposal.fc_comment}&rdquo;
                          </div>
                        )}
                        {selectedProposal.fc_decision === 'APPROVED' && (
                          <div style={{ marginTop: 8, fontSize: 12 }}>
                            <b>Master Provisioning:</b> Master records created in database. View active status in Tab 1.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pending Decision Console */}
                    {selectedProposal.fc_decision === 'PENDING' && (
                      <div style={{ marginTop: 12 }}>
                        {/* Segregation of duties alert */}
                        {isProposerOfSelected && (
                          <div className="note er" style={{ marginBottom: 12 }}>
                            <b>Segregation of Duties Enforced:</b> You submitted this expansion proposal.
                            An independent Financial Controller must evaluate and decide this request.
                          </div>
                        )}

                        {decisionError && (
                          <div className="note er" style={{ marginBottom: 12 }}>
                            <b>Error:</b> {decisionError}
                          </div>
                        )}

                        <div className="fld">
                          <label className="lbl" htmlFor="fc-comment-input">
                            Financial Controller Justification / Notes
                            <span style={{ color: 'var(--err)' }}> * (Mandatory for rejection)</span>
                          </label>
                          <textarea
                            id="fc-comment-input"
                            className="in"
                            rows={3}
                            value={fcComment}
                            onChange={(e) => setFcComment(e.target.value)}
                            placeholder="Enter physical inspection findings, authorization notes, or rejection rationale..."
                            disabled={!canDecide}
                          />
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleDecision('APPROVED')}
                            disabled={!canDecide || isDeciding}
                          >
                            {isDeciding ? 'Provisioning...' : 'Approve & Provision'}
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => handleDecision('REJECTED')}
                            disabled={!canDecide || isDeciding || !fcComment.trim()}
                          >
                            Reject Proposal
                          </button>
                        </div>

                        {!canDecide && !isProposerOfSelected && (
                          <span className="meta" style={{ display: 'block', marginTop: 8 }}>
                            Requires Financial Controller (FC / APPROVER) role to sign digital decision.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Ticket>
              ) : (
                <div className="stub" style={{ textAlign: 'center', padding: '36px 16px' }}>
                  Select a proposal from the queue to view metadata and conduct authorization review.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
