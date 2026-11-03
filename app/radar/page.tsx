'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';

/**
 * F18: Reorder & Expiry Radar Screen
 *
 * Implements:
 * 1. Visual Shelf-Life Radar (Doc §4.5):
 *    - Lots grouped by expiry status:
 *      * Expired Locked in Red (Days to Expiry <= 0)
 *      * Warning in Amber (1 <= Days to Expiry <= 5)
 *      * Fresh/OK in Green (Days to Expiry > 5)
 *    - Days to expiry countdown counter per lot.
 * 2. Reorder Suggestion Engine (Doc §4.4):
 *    - Displays items where Current Book Stock <= Reorder Point.
 *    - Computes: Suggested Reorder Qty = max(0, Par Level - Current Stock - Open PO).
 *    - Explicit non-negotiable notice:
 *      "Quantities calculated from user-defined formulas. No automated ordering."
 *
 * NON-NEGOTIABLE COMPLIANCE:
 * - Physical inventory quantities only.
 * - Zero commercial, monetary, financial, or procurement trade metrics.
 */

export type ExpiryStatusTier = 'EXPIRED_LOCK' | 'EXPIRY_AMBER' | 'FIFO_OK';

export interface RadarLot {
  lotId: string;
  itemCode: string;
  itemName: string;
  category: string;
  warehouseId: string;
  warehouseName: string;
  receivedDate: string;
  expiryDate: string;
  daysToExpiry: number;
  quantity: number;
  uom: 'kg' | 'pcs';
  status: ExpiryStatusTier;
}

export interface ReorderItem {
  itemCode: string;
  itemName: string;
  category: string;
  warehouseId: string;
  warehouseName: string;
  uom: 'kg' | 'pcs';
  currentStock: number;
  reorderPoint: number;
  parLevel: number;
  openPoQty: number; // Open inbound quantities in transit
  minOrderQty: number;
}

// Master lot seed data covering Cold Room and Dry Store
const SEED_RADAR_LOTS: RadarLot[] = [
  // Expired Locked lots (Days <= 0) - Locked from kitchen issues
  {
    lotId: 'L-SAL-1027',
    itemCode: 'RM-SAL-01',
    itemName: 'Salmon fillet',
    category: 'Seafood',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '27 Oct 2026',
    expiryDate: '31 Oct 2026',
    daysToExpiry: -3,
    quantity: 3.1,
    uom: 'kg',
    status: 'EXPIRED_LOCK',
  },
  {
    lotId: 'LOT-2026-BUF-001',
    itemCode: 'ITM-CHZ-003',
    itemName: 'Buffalo Mozzarella 200g',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '25 Oct 2026',
    expiryDate: '02 Nov 2026',
    daysToExpiry: -1,
    quantity: 8,
    uom: 'pcs',
    status: 'EXPIRED_LOCK',
  },
  // Warning lots (Amber: 1 to 5 days remaining) - Prioritized in FIFO picking
  {
    lotId: 'L-BUR-1029',
    itemCode: 'RM-BUR-01',
    itemName: 'Burrata Artisanal',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '29 Oct 2026',
    expiryDate: '04 Nov 2026',
    daysToExpiry: 1,
    quantity: 6,
    uom: 'pcs',
    status: 'EXPIRY_AMBER',
  },
  {
    lotId: 'L-BAS-1101',
    itemCode: 'RM-BAS-01',
    itemName: 'Fresh sweet basil',
    category: 'Produce',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '01 Nov 2026',
    expiryDate: '06 Nov 2026',
    daysToExpiry: 3,
    quantity: 3.2,
    uom: 'kg',
    status: 'EXPIRY_AMBER',
  },
  {
    lotId: 'LOT-2026-CHK-002',
    itemCode: 'RM-CHK-01',
    itemName: 'Chicken breast marinated',
    category: 'Meat',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '30 Oct 2026',
    expiryDate: '07 Nov 2026',
    daysToExpiry: 4,
    quantity: 14.5,
    uom: 'kg',
    status: 'EXPIRY_AMBER',
  },
  {
    lotId: 'LOT-2026-RIC-004',
    itemCode: 'RM-RIC-01',
    itemName: 'Fresh Ricotta',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '31 Oct 2026',
    expiryDate: '08 Nov 2026',
    daysToExpiry: 5,
    quantity: 7.5,
    uom: 'kg',
    status: 'EXPIRY_AMBER',
  },
  // Fresh lots (Green / FIFO OK: > 5 days remaining)
  {
    lotId: 'L-DOU-1102',
    itemCode: 'RM-DOU-01',
    itemName: 'Pizza dough ball 220g',
    category: 'Bakery',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '02 Nov 2026',
    expiryDate: '09 Nov 2026',
    daysToExpiry: 6,
    quantity: 140,
    uom: 'pcs',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-SAL-1031',
    itemCode: 'RM-SAL-01',
    itemName: 'Salmon fillet',
    category: 'Seafood',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '31 Oct 2026',
    expiryDate: '10 Nov 2026',
    daysToExpiry: 7,
    quantity: 6.3,
    uom: 'kg',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-BUR-1031',
    itemCode: 'RM-BUR-01',
    itemName: 'Burrata Artisanal',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '31 Oct 2026',
    expiryDate: '12 Nov 2026',
    daysToExpiry: 9,
    quantity: 12,
    uom: 'pcs',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-MOZ-1019',
    itemCode: 'RM-MOZ-01',
    itemName: 'Mozzarella block',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '19 Oct 2026',
    expiryDate: '16 Nov 2026',
    daysToExpiry: 13,
    quantity: 12.0,
    uom: 'kg',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-MOZ-1026',
    itemCode: 'RM-MOZ-01',
    itemName: 'Mozzarella block',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '26 Oct 2026',
    expiryDate: '23 Nov 2026',
    daysToExpiry: 20,
    quantity: 30.5,
    uom: 'kg',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-PAR-1020',
    itemCode: 'RM-PAR-01',
    itemName: 'Parma ham prosciutto',
    category: 'Meat',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    receivedDate: '20 Oct 2026',
    expiryDate: '20 Nov 2026',
    daysToExpiry: 17,
    quantity: 4.1,
    uom: 'kg',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-FLO-1015',
    itemCode: 'DS-FLO-00',
    itemName: 'Caputo 00 Flour',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    receivedDate: '15 Oct 2026',
    expiryDate: '15 Apr 2027',
    daysToExpiry: 163,
    quantity: 85.0,
    uom: 'kg',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-PAS-1008',
    itemCode: 'DS-PAS-01',
    itemName: 'San Marzano tomato passata',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    receivedDate: '08 Oct 2026',
    expiryDate: '08 Oct 2027',
    daysToExpiry: 339,
    quantity: 36,
    uom: 'pcs',
    status: 'FIFO_OK',
  },
  {
    lotId: 'L-OIL-1010',
    itemCode: 'RM-OIL-01',
    itemName: 'Extra virgin olive oil',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    receivedDate: '10 Oct 2026',
    expiryDate: '10 Oct 2027',
    daysToExpiry: 341,
    quantity: 24.0,
    uom: 'kg',
    status: 'FIFO_OK',
  },
];

// Master inventory items for reorder formula calculation
const SEED_REORDER_ITEMS: ReorderItem[] = [
  {
    itemCode: 'RM-BAS-01',
    itemName: 'Fresh sweet basil',
    category: 'Produce',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    currentStock: 3.2,
    reorderPoint: 4.0,
    parLevel: 10.0,
    openPoQty: 2.0,
    minOrderQty: 2.0,
  },
  {
    itemCode: 'RM-BUR-01',
    itemName: 'Burrata Artisanal',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'pcs',
    currentStock: 18.0,
    reorderPoint: 20.0,
    parLevel: 48.0,
    openPoQty: 0.0,
    minOrderQty: 12.0,
  },
  {
    itemCode: 'RM-PAR-01',
    itemName: 'Parma ham prosciutto',
    category: 'Meat',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    currentStock: 4.1,
    reorderPoint: 5.0,
    parLevel: 12.0,
    openPoQty: 0.0,
    minOrderQty: 3.0,
  },
  {
    itemCode: 'RM-GOR-01',
    itemName: 'Gorgonzola DOP',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    currentStock: 3.6,
    reorderPoint: 4.0,
    parLevel: 9.0,
    openPoQty: 0.0,
    minOrderQty: 2.0,
  },
  {
    itemCode: 'RM-SAL-01',
    itemName: 'Salmon fillet',
    category: 'Seafood',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    currentStock: 6.3, // Usable book stock excluding locked expired lot
    reorderPoint: 8.0,
    parLevel: 20.0,
    openPoQty: 5.0,
    minOrderQty: 5.0,
  },
  {
    itemCode: 'RM-YST-01',
    itemName: 'Active dry yeast',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'kg',
    currentStock: 2.1,
    reorderPoint: 3.0,
    parLevel: 8.0,
    openPoQty: 0.0,
    minOrderQty: 2.0,
  },
  {
    itemCode: 'RM-MOZ-01',
    itemName: 'Mozzarella block',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    currentStock: 42.5,
    reorderPoint: 20.0,
    parLevel: 60.0,
    openPoQty: 0.0,
    minOrderQty: 10.0,
  },
  {
    itemCode: 'RM-CHK-01',
    itemName: 'Chicken breast marinated',
    category: 'Meat',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    currentStock: 26.0,
    reorderPoint: 15.0,
    parLevel: 40.0,
    openPoQty: 0.0,
    minOrderQty: 10.0,
  },
  {
    itemCode: 'DS-FLO-00',
    itemName: 'Caputo 00 Flour',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'kg',
    currentStock: 85.0,
    reorderPoint: 60.0,
    parLevel: 200.0,
    openPoQty: 0.0,
    minOrderQty: 50.0,
  },
];

export default function ReorderAndExpiryRadarPage() {
  const { role, roleConfig, store, showToast } = useShell();

  // Primary navigation view tabs
  const [activeTab, setActiveTab] = useState<'all' | 'expiry' | 'reorder'>('all');

  // Storeroom selection filter
  const [activeWarehouse, setActiveWarehouse] = useState<'ALL' | 'COLD' | 'DRY'>('ALL');

  // Expiry tier filter chip
  const [expiryTierFilter, setExpiryTierFilter] = useState<'ALL' | ExpiryStatusTier>('ALL');

  // Selected item code for formula inspector ticket
  const [selectedItemCode, setSelectedItemCode] = useState<string>('RM-BAS-01');

  // Search filter query
  const [searchQuery, setSearchQuery] = useState<string>('');

  const storeTitle = STORE_NAMES[store] || store;

  // Filtered radar lots
  const filteredLots = useMemo(() => {
    return SEED_RADAR_LOTS.filter((lot) => {
      // Storeroom filter
      if (activeWarehouse === 'COLD' && !lot.warehouseId.includes('COLD')) return false;
      if (activeWarehouse === 'DRY' && !lot.warehouseId.includes('DRY')) return false;

      // Expiry status filter
      if (expiryTierFilter !== 'ALL' && lot.status !== expiryTierFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCode = lot.itemCode.toLowerCase().includes(q);
        const matchesName = lot.itemName.toLowerCase().includes(q);
        const matchesLot = lot.lotId.toLowerCase().includes(q);
        const matchesCat = lot.category.toLowerCase().includes(q);
        if (!matchesCode && !matchesName && !matchesLot && !matchesCat) return false;
      }

      return true;
    });
  }, [activeWarehouse, expiryTierFilter, searchQuery]);

  // Aggregate lot tier counts
  const lotStats = useMemo(() => {
    const expiredLots = SEED_RADAR_LOTS.filter((l) => l.status === 'EXPIRED_LOCK');
    const warningLots = SEED_RADAR_LOTS.filter((l) => l.status === 'EXPIRY_AMBER');
    const freshLots = SEED_RADAR_LOTS.filter((l) => l.status === 'FIFO_OK');

    return {
      expiredCount: expiredLots.length,
      expiredQtyKg: expiredLots.filter((l) => l.uom === 'kg').reduce((sum, l) => sum + l.quantity, 0),
      expiredQtyPcs: expiredLots.filter((l) => l.uom === 'pcs').reduce((sum, l) => sum + l.quantity, 0),
      warningCount: warningLots.length,
      warningQtyKg: warningLots.filter((l) => l.uom === 'kg').reduce((sum, l) => sum + l.quantity, 0),
      warningQtyPcs: warningLots.filter((l) => l.uom === 'pcs').reduce((sum, l) => sum + l.quantity, 0),
      freshCount: freshLots.length,
      totalLots: SEED_RADAR_LOTS.length,
    };
  }, []);

  // Compute reorder suggestions strictly according to Doc §4.4:
  // Trigger condition: Current Book Stock <= Reorder Point
  // Suggested Reorder Qty = max(0, Par Level - Current Book Stock - Open PO Quantity)
  const reorderSuggestions = useMemo(() => {
    return SEED_REORDER_ITEMS.map((item) => {
      const isTriggered = item.currentStock <= item.reorderPoint;
      const netGap = item.parLevel - item.currentStock - item.openPoQty;
      const suggestedQty = Math.max(0, Number(netGap.toFixed(2)));

      let urgency: 'CRITICAL_STOCKOUT' | 'REORDER_TRIGGERED' | 'COVERED_BY_PO' | 'STOCK_HEALTHY' =
        'STOCK_HEALTHY';

      if (item.currentStock === 0) {
        urgency = 'CRITICAL_STOCKOUT';
      } else if (isTriggered) {
        if (suggestedQty > 0) {
          urgency = 'REORDER_TRIGGERED';
        } else {
          urgency = 'COVERED_BY_PO';
        }
      }

      return {
        ...item,
        isTriggered,
        netGap,
        suggestedQty,
        urgency,
      };
    }).filter((item) => {
      // Storeroom filter
      if (activeWarehouse === 'COLD' && !item.warehouseId.includes('COLD')) return false;
      if (activeWarehouse === 'DRY' && !item.warehouseId.includes('DRY')) return false;

      // In reorder tab, show only triggered items
      if (activeTab === 'reorder' && !item.isTriggered) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCode = item.itemCode.toLowerCase().includes(q);
        const matchesName = item.itemName.toLowerCase().includes(q);
        const matchesCat = item.category.toLowerCase().includes(q);
        if (!matchesCode && !matchesName && !matchesCat) return false;
      }

      return true;
    });
  }, [activeWarehouse, activeTab, searchQuery]);

  // Aggregate reorder stats
  const reorderStats = useMemo(() => {
    const triggeredItems = SEED_REORDER_ITEMS.filter((i) => i.currentStock <= i.reorderPoint);
    const totalSuggestedKg = triggeredItems
      .filter((i) => i.uom === 'kg')
      .reduce((sum, i) => sum + Math.max(0, i.parLevel - i.currentStock - i.openPoQty), 0);
    const totalSuggestedPcs = triggeredItems
      .filter((i) => i.uom === 'pcs')
      .reduce((sum, i) => sum + Math.max(0, i.parLevel - i.currentStock - i.openPoQty), 0);

    return {
      triggeredCount: triggeredItems.length,
      criticalCount: triggeredItems.filter((i) => i.currentStock === 0).length,
      totalSuggestedKg,
      totalSuggestedPcs,
    };
  }, []);

  // Currently inspected item in the formula sidebar
  const inspectedItem = useMemo(() => {
    return (
      reorderSuggestions.find((i) => i.itemCode === selectedItemCode) ||
      reorderSuggestions[0] ||
      SEED_REORDER_ITEMS[0]
    );
  }, [reorderSuggestions, selectedItemCode]);

  // Copy suggested quantity calculation to clipboard
  const handleCopyFormula = useCallback(() => {
    if (!inspectedItem) return;
    const text = `REORDER FORMULA BREAKDOWN:
Item: ${inspectedItem.itemName} (${inspectedItem.itemCode})
Par Level: ${inspectedItem.parLevel} ${inspectedItem.uom}
Current Book Stock: ${inspectedItem.currentStock} ${inspectedItem.uom}
Open Inbound PO: ${inspectedItem.openPoQty} ${inspectedItem.uom}
Calculation: max(0, ${inspectedItem.parLevel} - ${inspectedItem.currentStock} - ${inspectedItem.openPoQty})
Suggested Reorder Qty: ${inspectedItem.suggestedQty} ${inspectedItem.uom}
Notice: Quantities calculated from user-defined formulas. No automated ordering.`;

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast(`Formula breakdown copied for ${inspectedItem.itemCode}`);
    } else {
      showToast('Clipboard access unavailable');
    }
  }, [inspectedItem, showToast]);

  // Download reorder suggestions draft as CSV (Quantities only!)
  const handleExportReorderCsv = useCallback(() => {
    const headers = [
      'Item Code',
      'Item Name',
      'Category',
      'Storeroom',
      'UoM',
      'Current Book Stock',
      'Reorder Point',
      'Par Level',
      'Open Inbound PO Qty',
      'Suggested Reorder Qty',
      'Trigger Status',
    ];

    const rows = reorderSuggestions.map((item) => [
      `"${item.itemCode}"`,
      `"${item.itemName}"`,
      `"${item.category}"`,
      `"${item.warehouseName}"`,
      `"${item.uom}"`,
      item.currentStock,
      item.reorderPoint,
      item.parLevel,
      item.openPoQty,
      item.suggestedQty,
      `"${item.urgency}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `reorder-suggestions-quantities-${store}-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Reorder suggestions CSV exported (quantities only).');
  }, [reorderSuggestions, store, showToast]);

  return (
    <>
      {store !== 'IND-DEL-01' && (
        <div className="note am" style={{ marginBottom: 16 }}>
          Prototype displays live telemetry baseline for {store}.
        </div>
      )}

      {/* Screen Header */}
      <div className="head">
        <div>
          <div className="kicker">
            Store {store} &middot; {storeTitle} &middot; Inventory Control
          </div>
          <h1 className="h1">
            Reorder & Expiry Radar,{' '}
            <em>Shelf-Life & Stock Replenishment.</em>
          </h1>
          <p className="sub">
            Real-time visual lot expiration monitoring and algorithmic reorder suggestions based
            strictly on append-only book stock and open purchase orders.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span className="stamp">F18 RADAR</span>
          <span className="meta">Role: {roleConfig.l}</span>
        </div>
      </div>

      {/* Non-negotiable User-Defined Formula Notice Banner */}
      <div className="win" style={{ borderColor: 'var(--terra)', background: 'var(--paper)' }}>
        <span className="lbl" style={{ color: 'var(--terra)', fontWeight: 600 }}>
          FORMULA NOTICE (DOC §4.4)
        </span>
        <Badge variant="re">User-Defined</Badge>
        <span style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 500 }}>
          Quantities calculated from user-defined formulas. No automated ordering.
        </span>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          Suggested Reorder Qty = max(0, Par Level &minus; Current Stock &minus; Open PO)
        </span>
      </div>

      {/* Top Metric Tiles */}
      <div className="tiles">
        <button
          type="button"
          className={`tile ${activeTab === 'expiry' && expiryTierFilter === 'EXPIRED_LOCK' ? 'on' : ''}`}
          onClick={() => {
            setActiveTab('expiry');
            setExpiryTierFilter('EXPIRED_LOCK');
          }}
        >
          <span className="lbl">Expired Locked</span>
          <span className="big" style={{ color: 'var(--err)' }}>
            {lotStats.expiredCount}
          </span>
          <span className="s">
            Hard-locked lots &middot; {lotStats.expiredQtyKg.toFixed(1)} kg, {lotStats.expiredQtyPcs}{' '}
            pcs
          </span>
        </button>

        <button
          type="button"
          className={`tile ${activeTab === 'expiry' && expiryTierFilter === 'EXPIRY_AMBER' ? 'on' : ''}`}
          onClick={() => {
            setActiveTab('expiry');
            setExpiryTierFilter('EXPIRY_AMBER');
          }}
        >
          <span className="lbl">Expiry Warning</span>
          <span className="big" style={{ color: 'var(--amber)' }}>
            {lotStats.warningCount}
          </span>
          <span className="s">
            1&ndash;5 days horizon &middot; {lotStats.warningQtyKg.toFixed(1)} kg,{' '}
            {lotStats.warningQtyPcs} pcs
          </span>
        </button>

        <button
          type="button"
          className={`tile ${activeTab === 'expiry' && expiryTierFilter === 'FIFO_OK' ? 'on' : ''}`}
          onClick={() => {
            setActiveTab('expiry');
            setExpiryTierFilter('FIFO_OK');
          }}
        >
          <span className="lbl">Fresh (FIFO OK)</span>
          <span className="big" style={{ color: 'var(--forest)' }}>
            {lotStats.freshCount}
          </span>
          <span className="s">Healthy shelf-life holding (&gt; 5 days)</span>
        </button>

        <button
          type="button"
          className={`tile ${activeTab === 'reorder' ? 'on' : ''}`}
          onClick={() => setActiveTab('reorder')}
        >
          <span className="lbl">Reorder Triggered</span>
          <span className="big" style={{ color: 'var(--blue)' }}>
            {reorderStats.triggeredCount}
          </span>
          <span className="s">
            At or below RP &middot; {reorderStats.totalSuggestedKg.toFixed(1)} kg,{' '}
            {reorderStats.totalSuggestedPcs} pcs suggested
          </span>
        </button>
      </div>

      {/* Main 2-Column Grid */}
      <div className="cols c-ov">
        <div className="stack">
          {/* Controls Bar */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              background: 'var(--sand)',
              padding: '10px 16px',
              borderRadius: 4,
              border: '1px solid var(--rule)',
            }}
          >
            {/* View Selector Tabs */}
            <div className="seg" role="group" aria-label="Radar View Selection">
              <button
                type="button"
                className={activeTab === 'all' ? 'on' : ''}
                onClick={() => {
                  setActiveTab('all');
                  setExpiryTierFilter('ALL');
                }}
              >
                Combined Radar
              </button>
              <button
                type="button"
                className={activeTab === 'expiry' ? 'on' : ''}
                onClick={() => setActiveTab('expiry')}
              >
                Shelf-Life Expiry
              </button>
              <button
                type="button"
                className={activeTab === 'reorder' ? 'on' : ''}
                onClick={() => setActiveTab('reorder')}
              >
                Reorder Engine
              </button>
            </div>

            {/* Storeroom Selector */}
            <div className="seg" role="group" aria-label="Storeroom Filter">
              <button
                type="button"
                className={activeWarehouse === 'ALL' ? 'on' : ''}
                onClick={() => setActiveWarehouse('ALL')}
              >
                All Storerooms
              </button>
              <button
                type="button"
                className={activeWarehouse === 'COLD' ? 'on' : ''}
                onClick={() => setActiveWarehouse('COLD')}
              >
                Cold Room
              </button>
              <button
                type="button"
                className={activeWarehouse === 'DRY' ? 'on' : ''}
                onClick={() => setActiveWarehouse('DRY')}
              >
                Dry Store
              </button>
            </div>

            {/* Search Input */}
            <input
              type="search"
              aria-label="Filter items or lots"
              placeholder="Search item, code, lot..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="in"
              style={{ width: 220, margin: 0, padding: '5px 10px', fontSize: 13 }}
            />
          </div>

          {/* Section 1: Expiry Radar View */}
          {(activeTab === 'all' || activeTab === 'expiry') && (
            <Ticket
              no="RADAR-EXP · SHELF-LIFE EXPIRY HORIZONS"
              right={
                <span className="meta">
                  {filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''} tracked
                </span>
              }
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <Chips>
                  <Chip
                    label="All Lots"
                    count={SEED_RADAR_LOTS.length}
                    active={expiryTierFilter === 'ALL'}
                    onClick={() => setExpiryTierFilter('ALL')}
                  />
                  <Chip
                    label="Expired Locked"
                    count={lotStats.expiredCount}
                    active={expiryTierFilter === 'EXPIRED_LOCK'}
                    onClick={() => setExpiryTierFilter('EXPIRED_LOCK')}
                  />
                  <Chip
                    label="Warning (1-5d)"
                    count={lotStats.warningCount}
                    active={expiryTierFilter === 'EXPIRY_AMBER'}
                    onClick={() => setExpiryTierFilter('EXPIRY_AMBER')}
                  />
                  <Chip
                    label="Fresh (FIFO OK)"
                    count={lotStats.freshCount}
                    active={expiryTierFilter === 'FIFO_OK'}
                    onClick={() => setExpiryTierFilter('FIFO_OK')}
                  />
                </Chips>

                <span className="gloss">
                  Hard-locked lots cannot be picked for kitchen requisitions.
                </span>
              </div>

              {/* Visual Radar Shelf-Life Spectrum Bar */}
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    height: 10,
                    borderRadius: 3,
                    overflow: 'hidden',
                    background: 'var(--sand)',
                    border: '1px solid var(--rule)',
                  }}
                  title="Visual shelf life distribution"
                >
                  <div
                    style={{
                      width: `${(lotStats.expiredCount / lotStats.totalLots) * 100}%`,
                      background: 'var(--err)',
                    }}
                  />
                  <div
                    style={{
                      width: `${(lotStats.warningCount / lotStats.totalLots) * 100}%`,
                      background: 'var(--amber)',
                    }}
                  />
                  <div
                    style={{
                      width: `${(lotStats.freshCount / lotStats.totalLots) * 100}%`,
                      background: 'var(--forest)',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    fontFamily: 'var(--mono)',
                    color: 'var(--ink-2)',
                    marginTop: 4,
                  }}
                >
                  <span>&bull; Expired Locked ({lotStats.expiredCount})</span>
                  <span>&bull; Warning Horizon 1&ndash;5d ({lotStats.warningCount})</span>
                  <span>&bull; Fresh / FIFO OK ({lotStats.freshCount})</span>
                </div>
              </div>

              {/* Lots Table */}
              <table>
                <thead>
                  <tr>
                    <th>Lot / Batch #</th>
                    <th>Item Description</th>
                    <th>Storeroom</th>
                    <th>Received</th>
                    <th>Expiry Date</th>
                    <th className="num">Countdown</th>
                    <th className="num">Quantity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLots.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '24px 0' }}>
                        <span className="ro">No lots match current filter criteria.</span>
                      </td>
                    </tr>
                  ) : (
                    filteredLots.map((lot) => {
                      const isExpired = lot.status === 'EXPIRED_LOCK';
                      const isWarning = lot.status === 'EXPIRY_AMBER';

                      const countdownText = (() => {
                        if (lot.daysToExpiry < 0) {
                          return `${Math.abs(lot.daysToExpiry)}d OVERDUE`;
                        }
                        if (lot.daysToExpiry === 0) {
                          return 'EXPIRES TODAY';
                        }
                        return `+${lot.daysToExpiry}d remaining`;
                      })();

                      return (
                        <tr
                          key={lot.lotId}
                          className={`row ${isExpired ? 'dim' : ''}`}
                          onClick={() => setSelectedItemCode(lot.itemCode)}
                          style={{
                            background: isExpired
                              ? 'rgba(179, 46, 22, 0.04)'
                              : isWarning
                              ? 'rgba(122, 75, 0, 0.04)'
                              : undefined,
                          }}
                        >
                          <td className="m">
                            <b>{lot.lotId}</b>
                          </td>
                          <td>
                            <b>{lot.itemName}</b>
                            <br />
                            <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              {lot.itemCode} &middot; {lot.category}
                            </span>
                          </td>
                          <td className="m">{lot.warehouseName}</td>
                          <td className="m">{lot.receivedDate}</td>
                          <td className="m">
                            <b>{lot.expiryDate}</b>
                          </td>
                          <td className="num">
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontWeight: 600,
                                fontSize: 12,
                                color: isExpired
                                  ? 'var(--err)'
                                  : isWarning
                                  ? 'var(--amber)'
                                  : 'var(--forest)',
                              }}
                            >
                              {countdownText}
                            </span>
                          </td>
                          <td className="num">
                            <b>
                              {lot.uom === 'kg' ? lot.quantity.toFixed(1) : lot.quantity} {lot.uom}
                            </b>
                          </td>
                          <td>
                            {lot.status === 'EXPIRED_LOCK' && (
                              <Badge variant="er">EXPIRED LOCK</Badge>
                            )}
                            {lot.status === 'EXPIRY_AMBER' && (
                              <Badge variant="am">EXPIRY WARNING</Badge>
                            )}
                            {lot.status === 'FIFO_OK' && <Badge variant="ok">FIFO OK</Badge>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Ticket>
          )}

          {/* Section 2: Reorder Suggestion Engine (Doc §4.4) */}
          {(activeTab === 'all' || activeTab === 'reorder') && (
            <Ticket
              no="REORDER-ENG · FORMULA-DRIVEN SUGGESTIONS"
              right={
                <span className="meta">
                  Trigger: Book Stock &le; Reorder Point
                </span>
              }
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <span className="lbl" style={{ color: 'var(--navy)' }}>
                    Replenishment Candidates
                  </span>
                  <p className="sub" style={{ margin: '2px 0 0', fontSize: 13 }}>
                    Displaying items where Current Book Stock &le; Reorder Point.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={handleExportReorderCsv}
                    title="Export reorder quantities as CSV"
                  >
                    Export CSV (Quantities)
                  </button>
                </div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Storeroom</th>
                    <th className="num">Book Stock</th>
                    <th className="num">Reorder Point</th>
                    <th className="num">Par Level</th>
                    <th className="num">Open PO</th>
                    <th className="num">Suggested Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reorderSuggestions.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '24px 0' }}>
                        <span className="ro">All item balances are currently above reorder points.</span>
                      </td>
                    </tr>
                  ) : (
                    reorderSuggestions.map((item) => {
                      const isSelected = item.itemCode === inspectedItem?.itemCode;
                      const isCritical = item.urgency === 'CRITICAL_STOCKOUT';
                      const isTriggered = item.isTriggered;

                      return (
                        <tr
                          key={item.itemCode}
                          className={`row ${isSelected ? 'sel' : ''}`}
                          onClick={() => setSelectedItemCode(item.itemCode)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedItemCode(item.itemCode);
                            }
                          }}
                        >
                          <td>
                            <b>{item.itemName}</b>
                            <br />
                            <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              {item.itemCode} &middot; {item.category}
                            </span>
                          </td>
                          <td className="m">{item.warehouseName}</td>
                          <td className="num">
                            <b
                              style={{
                                color: isCritical
                                  ? 'var(--err)'
                                  : isTriggered
                                  ? 'var(--terra)'
                                  : 'inherit',
                              }}
                            >
                              {item.uom === 'kg' ? item.currentStock.toFixed(1) : item.currentStock}{' '}
                              {item.uom}
                            </b>
                          </td>
                          <td className="num m">
                            {item.uom === 'kg' ? item.reorderPoint.toFixed(1) : item.reorderPoint}{' '}
                            {item.uom}
                          </td>
                          <td className="num m">
                            {item.uom === 'kg' ? item.parLevel.toFixed(1) : item.parLevel}{' '}
                            {item.uom}
                          </td>
                          <td className="num m">
                            {item.openPoQty > 0 ? (
                              <span style={{ color: 'var(--blue)', fontWeight: 600 }}>
                                +{item.uom === 'kg' ? item.openPoQty.toFixed(1) : item.openPoQty}{' '}
                                {item.uom}
                              </span>
                            ) : (
                              '0'
                            )}
                          </td>
                          <td className="num">
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontWeight: 700,
                                fontSize: 14,
                                color: item.suggestedQty > 0 ? 'var(--terra)' : 'var(--ink-2)',
                              }}
                            >
                              {item.uom === 'kg' ? item.suggestedQty.toFixed(1) : item.suggestedQty}{' '}
                              {item.uom}
                            </span>
                          </td>
                          <td>
                            {item.urgency === 'CRITICAL_STOCKOUT' && (
                              <Badge variant="er">STOCKOUT RISK</Badge>
                            )}
                            {item.urgency === 'REORDER_TRIGGERED' && (
                              <Badge variant="re">REORDER NEEDED</Badge>
                            )}
                            {item.urgency === 'COVERED_BY_PO' && (
                              <Badge variant="am">PO IN TRANSIT</Badge>
                            )}
                            {item.urgency === 'STOCK_HEALTHY' && (
                              <Badge variant="ok">HEALTHY</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Ticket>
          )}
        </div>

        {/* Right Sidebar: Formula Breakdown & Action Inspector */}
        <aside className="stack">
          {/* Selected Item Formula Calculation Inspector */}
          {inspectedItem ? (
            <Ticket
              no={`FORMULA · ${inspectedItem.itemCode}`}
              right={<Badge variant={inspectedItem.isTriggered ? 're' : 'ok'}>Doc §4.4</Badge>}
            >
              <div className="stub w" style={{ marginBottom: 14 }}>
                <span className="lbl">Inspected Item</span>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy)' }}>
                  {inspectedItem.itemName}
                </div>
                <div className="meta" style={{ marginTop: 2 }}>
                  Storeroom: {inspectedItem.warehouseName} &middot; Base UoM: {inspectedItem.uom}
                </div>
              </div>

              {/* Step-by-step formula breakdown */}
              <div className="stub" style={{ marginBottom: 14 }}>
                <span className="lbl" style={{ color: 'var(--terra)' }}>
                  Formula Breakdown
                </span>
                <table className="dense tick">
                  <tbody>
                    <tr>
                      <td>Target Par Level</td>
                      <td className="num">
                        <b>
                          {inspectedItem.uom === 'kg'
                            ? inspectedItem.parLevel.toFixed(1)
                            : inspectedItem.parLevel}{' '}
                          {inspectedItem.uom}
                        </b>
                      </td>
                    </tr>
                    <tr>
                      <td>&minus; Current Book Stock</td>
                      <td className="num" style={{ color: 'var(--terra)' }}>
                        &minus;
                        {inspectedItem.uom === 'kg'
                          ? inspectedItem.currentStock.toFixed(1)
                          : inspectedItem.currentStock}{' '}
                        {inspectedItem.uom}
                      </td>
                    </tr>
                    <tr>
                      <td>&minus; Open Inbound PO</td>
                      <td className="num" style={{ color: 'var(--blue)' }}>
                        &minus;
                        {inspectedItem.uom === 'kg'
                          ? inspectedItem.openPoQty.toFixed(1)
                          : inspectedItem.openPoQty}{' '}
                        {inspectedItem.uom}
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px dashed var(--rule)' }}>
                      <td>Net Replenishment Gap</td>
                      <td className="num">
                        <b>
                          {inspectedItem.uom === 'kg'
                            ? inspectedItem.netGap.toFixed(1)
                            : inspectedItem.netGap}{' '}
                          {inspectedItem.uom}
                        </b>
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid var(--navy)' }}>
                      <td>
                        <b>max(0, Gap)</b>
                      </td>
                      <td className="num" style={{ fontSize: 15, color: 'var(--terra)' }}>
                        <b>
                          {inspectedItem.uom === 'kg'
                            ? inspectedItem.suggestedQty.toFixed(1)
                            : inspectedItem.suggestedQty}{' '}
                          {inspectedItem.uom}
                        </b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Threshold trigger status card */}
              <div
                className={`note ${
                  inspectedItem.currentStock === 0
                    ? 'er'
                    : inspectedItem.currentStock <= inspectedItem.reorderPoint
                    ? 'am'
                    : 'ok'
                }`}
                style={{ marginBottom: 14, fontSize: 12.5 }}
              >
                <b>Reorder Trigger Check:</b>
                <br />
                Book Stock ({inspectedItem.currentStock} {inspectedItem.uom}) &le; Reorder Point (
                {inspectedItem.reorderPoint} {inspectedItem.uom}):{' '}
                <b>{inspectedItem.isTriggered ? 'TRIGGERED' : 'NOT TRIGGERED'}</b>.
                {inspectedItem.openPoQty > 0 && (
                  <div style={{ marginTop: 4 }}>
                    Open PO Quantity of {inspectedItem.openPoQty} {inspectedItem.uom} protects
                    against redundant over-ordering.
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button type="button" className="btn sm" onClick={handleCopyFormula}>
                  Copy Calculation Breakdown
                </button>
                <Link href="/requests" className="btn ghost sm" style={{ textAlign: 'center' }}>
                  Open Pick Queue
                </Link>
              </div>
            </Ticket>
          ) : (
            <div className="stub w">
              <span className="lbl">Item Inspector</span>
              <p className="gloss">Select any item row from the table to view its formula breakdown.</p>
            </div>
          )}

          {/* Quick Regulatory / Internal Audit Card */}
          <div className="stub w">
            <span className="lbl">Audit Standard</span>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
              All reorder quantities are consultative recommendations. Stock requisition orders must
              be manually submitted and verified against physical capacity before inbound receipt.
            </div>
            <div className="dash" />
            <div className="meta">
              Document Ref: SOP-INV-04 &middot; Rule Doc §4.4 &amp; §4.5
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
