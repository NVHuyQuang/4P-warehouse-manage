'use client';

import React from 'react';

export type RoleKey =
  | 'admin'
  | 'keeper'
  | 'rm'
  | 'req'
  | 'cust'
  | 'acct'
  | 'fc'
  | 'viewer';

export interface RoleConfig {
  key: RoleKey;
  l: string;
  nav: string[];
  stores: string[];
  scope: string;
}

export const ROLES: Record<RoleKey, RoleConfig> = {
  admin: {
    key: 'admin',
    l: 'System Admin',
    nav: ['users'],
    stores: ['IND-DEL-01', 'IND-DEL-02', 'IND-BLR-01'],
    scope: 'Global',
  },
  keeper: {
    key: 'keeper',
    l: 'Warehouse Keeper',
    nav: ['overview', 'requests', 'issues', 'balance', 'import', 'count', 'transfers'],
    stores: ['IND-DEL-01'],
    scope: 'Cold Room + Dry Store',
  },
  rm: {
    key: 'rm',
    l: 'Restaurant Manager',
    nav: ['overview', 'issues', 'balance', 'transfers', 'approvals'],
    stores: ['IND-DEL-01'],
    scope: 'Store',
  },
  req: {
    key: 'req',
    l: 'Section Requester',
    nav: ['request'],
    stores: ['IND-DEL-01'],
    scope: 'Section: Kitchen',
  },
  cust: {
    key: 'cust',
    l: 'Custodian',
    nav: ['overview', 'balance', 'count', 'transfers', 'issues'],
    stores: ['IND-DEL-01'],
    scope: 'Room: Cold Room',
  },
  acct: {
    key: 'acct',
    l: 'Store Accountant',
    nav: ['overview', 'count', 'issues'],
    stores: ['IND-DEL-01'],
    scope: 'Store',
  },
  fc: {
    key: 'fc',
    l: 'Financial Controller',
    nav: ['approvals', 'count', 'transfers', 'issues', 'balance', 'overview'],
    stores: ['IND-DEL-01', 'IND-DEL-02', 'IND-BLR-01'],
    scope: 'Multi-store',
  },
  viewer: {
    key: 'viewer',
    l: 'Viewer',
    nav: ['overview', 'issues', 'count', 'transfers'],
    stores: ['IND-DEL-01', 'IND-DEL-02'],
    scope: 'Read-only',
  },
};

export interface DevRoleSwitcherProps {
  currentRole: RoleKey;
  onRoleChange?: (role: RoleKey) => void;
  className?: string;
}

export function DevRoleSwitcher({
  currentRole,
  onRoleChange,
  className = '',
}: DevRoleSwitcherProps) {
  const isProduction = process.env.NODE_ENV === 'production';

  return (
    <div className={`demo ${className}`.trim()}>
      <b>PROTOTYPE</b>
      <span>Sample data. Windows and thresholds are [Owner to set].</span>
      <span className="sp" />
      <label htmlFor="viewas">View as</label>
      <select
        id="viewas"
        data-i="role"
        value={currentRole}
        disabled={isProduction}
        aria-label="View as role"
        title={isProduction ? 'Disabled in production' : 'Select role'}
        onChange={(e) => onRoleChange?.(e.target.value as RoleKey)}
      >
        {(Object.keys(ROLES) as RoleKey[]).map((k) => (
          <option key={k} value={k}>
            {ROLES[k].l}
          </option>
        ))}
      </select>
    </div>
  );
}
