'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  UserRecord,
  SecurityLogRecord,
  getUsers,
  getSecurityLogs,
  inviteUser,
  deactivateUser,
  unlockUser,
  lockUser,
  resendInvite,
  secondApproveInvitation,
} from '@/lib/data/users';
import { UserRole } from '@/lib/contracts/enums';

type FilterState = 'all' | 'active' | 'pending' | 'pending2' | 'locked' | 'deactivated';

const ROLE_OPTIONS = [
  { value: UserRole.ADMIN, label: 'Warehouse Keeper (ADMIN)' },
  { value: UserRole.RM, label: 'Restaurant Manager (RM)' },
  { value: UserRole.KITCHEN_REQ, label: 'Kitchen Section Requester (KITCHEN_REQ)' },
  { value: UserRole.RUNNER, label: 'Kitchen Runner (RUNNER)' },
  { value: UserRole.CUSTODIAN, label: 'Custodian (CUSTODIAN)' },
  { value: UserRole.ACCOUNTANT, label: 'Store Accountant (ACCOUNTANT)' },
  { value: UserRole.APPROVER, label: 'Financial Controller (APPROVER)' },
  { value: UserRole.VIEWER, label: 'Internal Audit (VIEWER)' },
];

const STORES = ['IND-DEL-01', 'IND-DEL-02', 'IND-BLR-01'];

const ROLE_MATRIX = [
  ['System Admin', 'Global', '—', '—', 'Invite users, unlock, deactivate leavers'],
  ['Warehouse Keeper', 'Store', 'Assigned', 'All', 'Import GRPO, pick, count, log waste'],
  ['Restaurant Manager', 'Store', '—', '—', 'Review daily balance, approve minor waste'],
  ['Section Requester', 'Store', '—', 'One section', 'Create and edit section stock requests'],
  ['Kitchen Runner', 'Store', '—', 'One section', 'Confirm quantities at physical storeroom door'],
  ['Custodian', 'Room', 'Assigned', '—', 'Pick, benchmark count, sign shift custody'],
  ['Store Accountant', 'Store', '—', '—', 'Periodic count, submit adjustment vouchers'],
  ['Financial Controller', 'Multi-store', '—', '—', 'Approve adjustment vouchers, transfers, stores'],
  ['Viewer', 'Global or store', '—', '—', 'Read-only access to ledger and audit trail'],
];

export default function UsersAdminPage() {
  const { role, roleConfig, store, showToast } = useShell();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>('all');
  const [selectedUserId, setSelectedUserId] = useState<string>('U-034');

  // Modal / Drawer state for "Invite New User"
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>(UserRole.ADMIN);
  const [inviteStores, setInviteStores] = useState<string[]>([store || 'IND-DEL-01']);
  const [inviteWarehouse, setInviteWarehouse] = useState('Both');
  const [inviteSection, setInviteSection] = useState('All');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [uList, sLogs] = await Promise.all([
        getUsers(),
        getSecurityLogs(),
      ]);
      setUsers(uList);
      setSecurityLogs(sLogs);
    } catch {
      // Data load caught
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    if (filter === 'all') return users;
    return users.filter((u) => u.status === filter);
  }, [users, filter]);

  const selectedUser = useMemo(() => {
    return users.find((u) => u.id === selectedUserId) || users[0] || null;
  }, [users, selectedUserId]);

  // Counts for chips
  const counts = useMemo(() => {
    return {
      all: users.length,
      active: users.filter((u) => u.status === 'active').length,
      pending: users.filter((u) => u.status === 'pending').length,
      pending2: users.filter((u) => u.status === 'pending2').length,
      locked: users.filter((u) => u.status === 'locked').length,
      deactivated: users.filter((u) => u.status === 'deactivated').length,
    };
  }, [users]);

  const isSelectedRoleApprover = inviteRole === UserRole.APPROVER;

  const toggleStore = (s: string) => {
    setInviteStores((prev) =>
      prev.includes(s)
        ? prev.length > 1
          ? prev.filter((item) => item !== s)
          : prev
        : [...prev, s]
    );
  };

  const handleSendInvite = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setInviteError('Please enter a valid staff email address.');
      return;
    }

    setInviteError(null);
    setIsInviting(true);

    const targetStore = inviteStores[0] || 'IND-DEL-01';

    await dispatchAction({
      actionName: 'INVITE_USER',
      payload: {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        storeId: targetStore,
      },
      execute: async () => {
        return await inviteUser(inviteEmail, inviteRole, targetStore, {
          warehouse: inviteWarehouse,
          section: inviteSection,
        });
      },
      onSuccess: () => {
        setIsInviting(false);
        setInviteEmail('');
        setShowInviteModal(false);
        showToast(
          isSelectedRoleApprover
            ? 'Approver invitation queued. Independent 2nd approval required.'
            : 'Invitation email dispatched with private set-password token.'
        );
        loadData();
      },
      onError: (err) => {
        setIsInviting(false);
        setInviteError(err.message || 'Failed to dispatch invitation.');
      },
    });
  };

  const handleUnlockUser = async (u: UserRecord) => {
    await dispatchAction({
      actionName: 'UNLOCK_USER_ACCOUNT',
      payload: { userId: u.id },
      execute: async () => {
        return await unlockUser(u.id);
      },
      onSuccess: () => {
        showToast(`Account ${u.id} unlocked. Attempt counter reset.`);
        loadData();
      },
      onError: (err) => {
        showToast(`Unlock failed: ${err.message}`);
      },
    });
  };

  const handleLockUser = async (u: UserRecord) => {
    await dispatchAction({
      actionName: 'LOCK_USER_ACCOUNT',
      payload: { userId: u.id },
      execute: async () => {
        return await lockUser(u.id);
      },
      onSuccess: () => {
        showToast(`Account ${u.id} locked by System Admin.`);
        loadData();
      },
      onError: (err) => {
        showToast(`Lock failed: ${err.message}`);
      },
    });
  };

  const handleDeactivateUser = async (u: UserRecord) => {
    await dispatchAction({
      actionName: 'DEACTIVATE_USER_ACCOUNT',
      payload: { userId: u.id },
      execute: async () => {
        return await deactivateUser(u.id);
      },
      onSuccess: () => {
        showToast(`Account ${u.id} deactivated. History preserved.`);
        loadData();
      },
      onError: (err) => {
        showToast(`Deactivation failed: ${err.message}`);
      },
    });
  };

  const handleResendInvite = async (u: UserRecord) => {
    await dispatchAction({
      actionName: 'RESEND_USER_INVITE',
      payload: { userId: u.id, email: u.email },
      execute: async () => {
        return await resendInvite(u.id);
      },
      onSuccess: () => {
        showToast(`New activation link sent to ${u.email}.`);
        loadData();
      },
      onError: (err) => {
        showToast(`Resend failed: ${err.message}`);
      },
    });
  };

  const handleSecondApprove = async (u: UserRecord) => {
    await dispatchAction({
      actionName: 'SECOND_APPROVE_APPROVER',
      payload: { userId: u.id, invitationId: u.invitation_id },
      execute: async () => {
        return await secondApproveInvitation(u.invitation_id || u.id);
      },
      onSuccess: () => {
        showToast(`Second approval granted. Activation link issued to ${u.email}.`);
        loadData();
      },
      onError: (err) => {
        showToast(`Approval failed: ${err.message}`);
      },
    });
  };

  const renderStatusBadge = (st: UserRecord['status']) => {
    switch (st) {
      case 'active':
        return <Badge variant="ok">Active</Badge>;
      case 'pending':
        return <Badge variant="re">Pending invite</Badge>;
      case 'pending2':
        return <Badge variant="am">Pending 2nd approval</Badge>;
      case 'locked':
        return <Badge variant="er">Locked</Badge>;
      case 'deactivated':
        return <Badge variant="mu">Deactivated</Badge>;
      default:
        return <Badge variant="mu">{st}</Badge>;
    }
  };

  return (
    <>
      {/* Header */}
      <div className="head">
        <div>
          <div className="kicker">System Admin &middot; Global</div>
          <h1 className="h1">
            Users <em>&amp; access.</em>
          </h1>
          <p className="sub">
            Permission = Role + Scope. Only System Admin invites users. Passwords are never shown, set or seen here; people set their own through the emailed link.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setInviteError(null);
            setShowInviteModal(true);
          }}
        >
          Invite New User
        </button>
      </div>

      <div className="cols c-us">
        {/* Main Column */}
        <div className="stack">
          {/* Users Table Ticket */}
          <Ticket
            no={`USERS · ${users.length}`}
            right={<Badge variant="ok">APPEND-ONLY SECURE</Badge>}
          >
            {/* Filter Chips */}
            <div style={{ marginBottom: 12 }}>
              <Chips>
                <Chip
                  label="All"
                  count={counts.all}
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                />
                <Chip
                  label="Active"
                  count={counts.active}
                  active={filter === 'active'}
                  onClick={() => setFilter('active')}
                />
                <Chip
                  label="Pending invite"
                  count={counts.pending}
                  active={filter === 'pending'}
                  onClick={() => setFilter('pending')}
                />
                <Chip
                  label="Pending 2nd approval"
                  count={counts.pending2}
                  active={filter === 'pending2'}
                  onClick={() => setFilter('pending2')}
                />
                <Chip
                  label="Locked"
                  count={counts.locked}
                  active={filter === 'locked'}
                  onClick={() => setFilter('locked')}
                />
                <Chip
                  label="Deactivated"
                  count={counts.deactivated}
                  active={filter === 'deactivated'}
                  onClick={() => setFilter('deactivated')}
                />
              </Chips>
            </div>

            {/* Users Table */}
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Scope</th>
                  <th>State</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isSelected = selectedUser?.id === u.id;
                  return (
                    <tr
                      key={u.id}
                      className={`row ${isSelected ? 'sel' : ''}`}
                      onClick={() => setSelectedUserId(u.id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedUserId(u.id);
                        }
                      }}
                    >
                      <td className="m" style={{ color: 'var(--navy)' }}>
                        <b>{u.id}</b>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{u.full_name}</div>
                      </td>
                      <td className="m" style={{ fontSize: 12 }}>
                        {u.email}
                      </td>
                      <td>{u.role}</td>
                      <td className="m">{u.scope}</td>
                      <td>{renderStatusBadge(u.status)}</td>
                      <td className="m">{u.last_activity}</td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-3)' }}>
                      No users match the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Context Action Bar for Selected User */}
            {selectedUser && (
              <div style={{ marginTop: 16, borderTop: '1px dashed var(--rule)', paddingTop: 14 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="lbl" style={{ margin: 0 }}>
                    {selectedUser.id} &middot; {selectedUser.full_name} ({selectedUser.role})
                  </span>

                  {selectedUser.status === 'locked' && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => handleUnlockUser(selectedUser)}
                    >
                      Unlock and reset attempt counter
                    </button>
                  )}

                  {selectedUser.status === 'active' && (
                    <>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => handleLockUser(selectedUser)}
                      >
                        Lock account
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => handleDeactivateUser(selectedUser)}
                      >
                        Deactivate leaver
                      </button>
                    </>
                  )}

                  {selectedUser.status === 'pending' && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => handleResendInvite(selectedUser)}
                    >
                      Resend invite link
                    </button>
                  )}

                  {selectedUser.status === 'pending2' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="b am">
                        Waiting for an independent executive. No activation link issued yet.
                      </span>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => handleSecondApprove(selectedUser)}
                      >
                        Second Approve
                      </button>
                    </div>
                  )}

                  {selectedUser.status === 'deactivated' && (
                    <span className="meta">Access revoked. History is kept.</span>
                  )}
                </div>
              </div>
            )}
          </Ticket>

          {/* Role and Scope Matrix Ticket */}
          <Ticket no="ROLE AND SCOPE MATRIX" right={<Badge variant="mu">REFERENCE</Badge>}>
            <table className="mat">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Scope level</th>
                  <th>Warehouse</th>
                  <th>Section</th>
                  <th style={{ textAlign: 'left' }}>Can do</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_MATRIX.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <b>{r[0]}</b>
                    </td>
                    <td className="m">{r[1]}</td>
                    <td className="m">{r[2]}</td>
                    <td className="m">{r[3]}</td>
                    <td style={{ textAlign: 'left' }}>{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="gloss" style={{ margin: '10px 0 0' }}>
              Operational physical metrics: Physical counts and stock quantities only. All movements recorded in kg and pcs.
            </p>
          </Ticket>

          {/* Security & Access Audit Log Ticket */}
          <Ticket no="SECURITY LOG" right={<Badge variant="re">APPEND-ONLY</Badge>}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>User</th>
                  <th>Detail</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {securityLogs.map((log) => (
                  <tr key={log.log_id} className={log.fresh ? 'sel' : ''}>
                    <td className="m">{log.dt}</td>
                    <td className="m" style={{ color: 'var(--navy)' }}>
                      <b>{log.ev}</b>
                    </td>
                    <td className="m">{log.u}</td>
                    <td>{log.d}</td>
                    <td className="m">{log.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Ticket>
        </div>

        {/* Right Sidebar */}
        <aside className="stack">
          {/* Quick Invite Form Stub */}
          <div className="stub w">
            <span className="lbl">Invite by Email</span>
            <form onSubmit={handleSendInvite}>
              <div className="fld">
                <label className="lbl" htmlFor="quick-email">
                  Staff Email Address
                </label>
                <input
                  id="quick-email"
                  type="email"
                  className={`in ${inviteError ? 'err' : ''}`}
                  placeholder="name@example.test"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
                {inviteError && (
                  <div style={{ color: 'var(--err)', fontSize: 13, marginTop: 4 }}>
                    {inviteError}
                  </div>
                )}
              </div>

              <div className="fld">
                <label className="lbl" htmlFor="quick-role">
                  Role
                </label>
                <select
                  id="quick-role"
                  className="in"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fld">
                <span className="lbl">Assigned Store(s)</span>
                <div className="chips" style={{ marginTop: 6 }}>
                  {STORES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`chip ${inviteStores.includes(s) ? 'on' : ''}`}
                      onClick={() => toggleStore(s)}
                      aria-pressed={inviteStores.includes(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="fld">
                  <label className="lbl" htmlFor="quick-wh">
                    Warehouse
                  </label>
                  <select
                    id="quick-wh"
                    className="in"
                    value={inviteWarehouse}
                    onChange={(e) => setInviteWarehouse(e.target.value)}
                  >
                    <option value="Both">Both</option>
                    <option value="WH-DEL01-COLD">Cold Room</option>
                    <option value="WH-DEL01-DRY">Dry Store</option>
                  </select>
                </div>

                <div className="fld">
                  <label className="lbl" htmlFor="quick-sec">
                    Section
                  </label>
                  <select
                    id="quick-sec"
                    className="in"
                    value={inviteSection}
                    onChange={(e) => setInviteSection(e.target.value)}
                  >
                    <option value="All">All</option>
                    <option value="Kitchen">Kitchen</option>
                    <option value="Bar">Bar</option>
                    <option value="Cheese">Cheese</option>
                  </select>
                </div>
              </div>

              {isSelectedRoleApprover ? (
                <div className="note am" style={{ marginBottom: 14 }}>
                  <b>Approver 2nd Approval rule notice:</b> If role is APPROVER, a second independent executive approval is required before the activation token is dispatched. The account remains <i>Pending 2nd approval</i> until signed.
                </div>
              ) : (
                <p className="gloss" style={{ margin: '0 0 14px' }}>
                  The person receives an email link to set their own private password. Link expires in 48 hours.
                </p>
              )}

              <button
                type="submit"
                className="btn"
                style={{ width: '100%' }}
                disabled={isInviting || !inviteEmail}
              >
                {isInviting ? 'Sending Invitation...' : 'Send Invite'}
              </button>
            </form>
          </div>

          {/* Lockout Rules Stub */}
          <div className="stub">
            <span className="lbl">Lockout Rules</span>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              After 5 consecutive failed sign-ins, the account locks and System Admin is alerted. Only System Admin can unlock and reset the counter. Lockout cooldown is 30 minutes.
            </p>
          </div>

          {/* Backups Stub */}
          <div className="stub w">
            <span className="lbl">Backups &amp; System Health</span>
            <table className="tick">
              <tbody>
                <tr>
                  <td>Last export</td>
                  <td>02 Nov 03:00</td>
                </tr>
                <tr>
                  <td>Status</td>
                  <td>OK</td>
                </tr>
                <tr>
                  <td>Keep-alive</td>
                  <td>ON</td>
                </tr>
              </tbody>
            </table>
          </div>
        </aside>
      </div>

      {/* "Invite New User" Modal / Drawer */}
      {showInviteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
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
              width: 540,
              maxWidth: '100%',
              borderRadius: 4,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <div className="tk-head">
              <span className="no" id="invite-modal-title">
                INVITE NEW STAFF USER
              </span>
              <span className="fill" />
              <Badge variant="re">FLOW 0</Badge>
            </div>

            <div className="tk-body">
              <p className="sub" style={{ margin: '0 0 16px' }}>
                Create an onboarding invitation. An invitation link with a unique cryptographic token will be dispatched. Passwords are never configured by administrators.
              </p>

              {inviteError && (
                <div className="note er" style={{ marginBottom: 14 }}>
                  <b>Error:</b> {inviteError}
                </div>
              )}

              <form onSubmit={handleSendInvite}>
                <div className="fld">
                  <label className="lbl" htmlFor="modal-email">
                    Staff Email Address *
                  </label>
                  <input
                    id="modal-email"
                    type="email"
                    className="in"
                    placeholder="name@example.test"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="fld">
                  <label className="lbl" htmlFor="modal-role">
                    Role *
                  </label>
                  <select
                    id="modal-role"
                    className="in"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fld">
                  <span className="lbl">Store Scope *</span>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {STORES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`chip ${inviteStores.includes(s) ? 'on' : ''}`}
                        onClick={() => toggleStore(s)}
                        aria-pressed={inviteStores.includes(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="fld">
                    <label className="lbl" htmlFor="modal-wh">
                      Warehouse Scope
                    </label>
                    <select
                      id="modal-wh"
                      className="in"
                      value={inviteWarehouse}
                      onChange={(e) => setInviteWarehouse(e.target.value)}
                    >
                      <option value="Both">Both Storerooms</option>
                      <option value="WH-DEL01-COLD">Cold Room</option>
                      <option value="WH-DEL01-DRY">Dry Store</option>
                    </select>
                  </div>

                  <div className="fld">
                    <label className="lbl" htmlFor="modal-sec">
                      Section Scope
                    </label>
                    <select
                      id="modal-sec"
                      className="in"
                      value={inviteSection}
                      onChange={(e) => setInviteSection(e.target.value)}
                    >
                      <option value="All">All Sections</option>
                      <option value="Kitchen">Kitchen</option>
                      <option value="Bar">Bar</option>
                      <option value="Cheese">Cheese</option>
                    </select>
                  </div>
                </div>

                {isSelectedRoleApprover && (
                  <div className="note am" style={{ marginBottom: 14 }}>
                    <b>Approver 2nd Approval Rule Notice:</b> Because the selected role is <code>APPROVER</code>, a second independent executive approval is required before the activation token is dispatched. The account will be created with status <i>Pending 2nd approval</i>.
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setShowInviteModal(false)}
                    disabled={isInviting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn"
                    disabled={isInviting || !inviteEmail}
                  >
                    {isInviting ? 'Dispatching...' : 'Dispatch Invitation'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
