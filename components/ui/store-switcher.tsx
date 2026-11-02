'use client';

import React from 'react';

export const STORES = ['IND-DEL-01', 'IND-DEL-02', 'IND-BLR-01'] as const;
export type StoreId = (typeof STORES)[number];

export const STORE_NAMES: Record<string, string> = {
  'IND-DEL-01': 'Delhi store 1',
  'IND-DEL-02': 'Delhi store 2',
  'IND-BLR-01': 'Bengaluru store 1',
};

export interface StoreSwitcherProps {
  currentStore: string;
  onStoreChange?: (store: string) => void;
  availableStores?: readonly string[] | string[];
  className?: string;
  disabled?: boolean;
}

export function StoreSwitcher({
  currentStore,
  onStoreChange,
  availableStores = STORES,
  className = '',
  disabled = false,
}: StoreSwitcherProps) {
  const storesToRender =
    availableStores && availableStores.length > 0 ? availableStores : STORES;

  return (
    <label className={`sw ${className}`.trim()}>
      <span>Store</span>
      <select
        value={currentStore}
        onChange={(e) => onStoreChange?.(e.target.value)}
        aria-label="Store switcher"
        disabled={disabled}
      >
        {storesToRender.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
