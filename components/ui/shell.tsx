'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { DevRoleSwitcher, ROLES, RoleKey, RoleConfig } from './dev-role-switcher';
import { Rail } from './rail';
import { Toast } from './toast';

export interface ShellContextValue {
  role: RoleKey;
  roleConfig: RoleConfig;
  setRole: (role: RoleKey) => void;
  store: string;
  setStore: (store: string) => void;
  showToast: (message: string) => void;
}

const ShellContext = createContext<ShellContextValue | undefined>(undefined);

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error('useShell must be used within a Shell component');
  }
  return ctx;
}

export interface ShellProps {
  children: React.ReactNode;
  initialRole?: RoleKey;
  initialStore?: string;
}

export function Shell({
  children,
  initialRole = 'keeper',
  initialStore = 'IND-DEL-01',
}: ShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [role, setRoleState] = useState<RoleKey>(initialRole);
  const [store, setStoreState] = useState<string>(initialStore);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const roleConfig = ROLES[role] || ROLES.keeper;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const setRole = useCallback(
    (newRole: RoleKey) => {
      setRoleState(newRole);
      const newConfig = ROLES[newRole];
      if (!newConfig) return;

      // Ensure store is valid for new role
      if (!newConfig.stores.includes(store)) {
        setStoreState(newConfig.stores[0]);
      }

      // Check route permission
      const currentSegment = pathname.replace(/^\//, '').split('/')[0] || 'overview';
      if (!newConfig.nav.includes(currentSegment)) {
        const fallbackRoute = `/${newConfig.nav[0]}`;
        router.push(fallbackRoute);
      }
    },
    [store, pathname, router]
  );

  const setStore = useCallback((newStore: string) => {
    setStoreState(newStore);
  }, []);

  return (
    <ShellContext.Provider
      value={{
        role,
        roleConfig,
        setRole,
        store,
        setStore,
        showToast,
      }}
    >
      <div className="frame" id="frame">
        <DevRoleSwitcher currentRole={role} onRoleChange={setRole} />
        <Rail
          role={roleConfig}
          currentStore={store}
          onStoreChange={setStore}
        />
        <main id="app">{children}</main>
        <footer className="foot">
          <span className="meta">Pizza 4P&apos;s</span>
          <span className="sp" />
          <span className="meta">
            Internal use only &middot; Quantities in kg and pcs &middot; No prices or costs are stored
          </span>
        </footer>
      </div>
      <Toast message={toastMessage} />
    </ShellContext.Provider>
  );
}
