'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StoreSwitcher } from './store-switcher';
import { RoleConfig } from './dev-role-switcher';

export const NAV_LABELS: Record<string, string> = {
  overview: 'Stock',
  requests: 'Pick queue',
  request: 'New request',
  issues: 'Issues & ledger',
  balance: 'Daily balance',
  import: 'GRPO import',
  count: 'Count',
  transfers: 'Transfers',
  approvals: 'Approvals',
  users: 'Users & access',
};

export function Pizza4PsLogo({ className = 'logo' }: { className?: string }) {
  return (
    <svg
      className={className}
      role="img"
      aria-label="Pizza 4P's"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 151.129 21.376"
      fill="currentColor"
    >
      <title>PIZZA 4P&apos;S</title>
      <defs>
        <clipPath id="logo-clip">
          <path fill="none" d="M0 0h151.129v21.376H0z" />
        </clipPath>
      </defs>
      <g clipPath="url(#logo-clip)">
        <path d="M5.495 12.218H2.566V4.799h3c2.665 0 3.961 1.2 3.961 3.674 0 2.45-1.395 3.745-4.033 3.745m.193-9.554H0v18.695h2.566v-7.008h2.929c4.177 0 6.67-2.2 6.67-5.878S9.8 2.664 5.687 2.664" />
        <path d="M18.598 2.666h2.565v18.693h-2.565z" />
        <path d="m42.49 4.634.031-.043V2.664h-13.2v2.3h9.9L28.976 19.392l-.031.043v1.929h13.773v-2.3H32.261Z" />
        <path d="m62.972 4.634.031-.043V2.664h-13.2v2.3h9.9l-10.25 14.428-.031.043v1.929h13.773v-2.3H52.743Z" />
        <path d="M77.297 5.564v-.005c.134.443.355 1.161.594 1.845l2.226 6.354H74.49l2.2-6.354c.235-.675.465-1.4.6-1.84m-1.372-2.9-6.647 18.693h2.587l1.9-5.472h7.107l1.92 5.472h2.731L78.791 2.664Z" />
        <path d="m100.245 14.687 4.9-7.14c.39-.579.671-1.06.854-1.4v8.54Zm8.236-11.938h-2.672l-8.366 12.176v1.994h8.559v4.44h2.479v-4.44h2.393v-2.257h-2.392Z" />
        <path d="M123.167 12.218h-2.929V4.799h3c2.665 0 3.961 1.2 3.961 3.674 0 2.45-1.395 3.745-4.034 3.745m.195-9.554h-5.687v18.695h2.565v-7.008h2.929c4.177 0 6.671-2.2 6.671-5.878s-2.361-5.809-6.478-5.809" />
        <path d="M132.803 5.637h1.851L136.975 0h-3.054Z" />
        <path d="m146.302 10.802-2.518-.443c-2-.378-2.851-1.215-2.851-2.8 0-1.77 1.4-2.913 3.567-2.913a3.3 3.3 0 0 1 3.544 3.167l.018.147h2.54l-.009-.176c-.178-3.3-2.39-5.2-6.07-5.2-3.656 0-6.21 2.122-6.21 5.16 0 2.725 1.639 4.414 4.874 5.017l2.5.444c1.975.336 2.895 1.233 2.895 2.822 0 2.166-1.365 3.263-4.057 3.263-3.453 0-4.152-2.428-4.292-3.472l-.019-.144h-2.586l.01.176c.2 3.407 2.823 5.523 6.839 5.523 4.228 0 6.653-2.017 6.653-5.533 0-2.842-1.534-4.444-4.827-5.041" />
      </g>
    </svg>
  );
}

export interface RailProps {
  role: RoleConfig;
  currentStore: string;
  onStoreChange?: (store: string) => void;
  className?: string;
}

export function Rail({
  role,
  currentStore,
  onStoreChange,
  className = '',
}: RailProps) {
  const pathname = usePathname();

  const isNavActive = (route: string) => {
    if (route === 'overview' && (pathname === '/' || pathname === '/overview')) {
      return true;
    }
    return pathname === `/${route}` || pathname.startsWith(`/${route}/`);
  };

  const truncatedScope =
    role.scope.length > 26 ? `${role.scope.slice(0, 24)}…` : role.scope;

  return (
    <header className={`rail ${className}`.trim()} id="rail">
      <Link href="/overview" title="Pizza 4P's - Home">
        <Pizza4PsLogo />
      </Link>
      <div className="div" />
      <div className="tag-line">
        Inventory Control
        <br />
        Internal
      </div>
      <div className="sp" />
      <nav aria-label="Primary">
        {role.nav.map((n) => {
          const active = isNavActive(n);
          return (
            <Link
              key={n}
              href={`/${n}`}
              className={active ? 'on' : ''}
              aria-current={active ? 'page' : undefined}
            >
              {NAV_LABELS[n] || n}
            </Link>
          );
        })}
      </nav>
      <div className="div" />
      <StoreSwitcher
        currentStore={currentStore}
        availableStores={role.stores}
        onStoreChange={onStoreChange}
      />
      <div className="who">
        <b>{role.l}</b>
        <br />
        <span title={role.scope}>{truncatedScope}</span>
      </div>
    </header>
  );
}
