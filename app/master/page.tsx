'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  getMasterItems,
  updateItemReorderRule,
  updateExpiryConfig,
  getUomConversions,
  updateUomConversion,
  getStoreOperationalWindows,
  updateStoreOperationalWindows,
  type MasterItem,
  type MasterCategory,
  type UomConversion,
  type StoreOperationalWindows,
} from '@/lib/data/master';

type SubTab = 'catalog' | 'expiry' | 'uom' | 'windows';

export default function MasterDataAdminPage() {
  const { role, roleConfig, store, showToast } = useShell();

  // Tab navigation
  const [activeTab, setActiveTab] = useState<SubTab>('catalog');
  const [loading, setLoading] = useState<boolean>(true);

  // Master Data state
  const [items, setItems] = useState<MasterItem[]>([]);
  const [conversions, setConversions] = useState<UomConversion[]>([]);
  const [windows, setWindows] = useState<StoreOperationalWindows | null>(null);

  // Sub-tab 1: Item Catalog & Reorder Policies state
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | MasterCategory>('ALL');
  const [policyFilter, setPolicyFilter] = useState<'ALL' | 'CONFIGURED' | 'AWAITING'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingReorder, setEditingReorder] = useState<
    Record<string, { reorderPoint: string; parLevel: string }>
  >({});
  const [savingItemCode, setSavingItemCode] = useState<string | null>(null);

  // Sub-tab 2: Expiry Tracking Groups state
  const [editingExpiryDays, setEditingExpiryDays] = useState<Record<string, string>>({});
  const [savingExpiryCode, setSavingExpiryCode] = useState<string | null>(null);
  const [simulatedDaysRemaining, setSimulatedDaysRemaining] = useState<number>(2);

  // Sub-tab 3: UoM Conversions state
  const [editingConversions, setEditingConversions] = useState<
    Record<string, { factor: string; dual: boolean }>
  >({});
  const [savingConversionId, setSavingConversionId] = useState<string | null>(null);
  const [calcSelectedId, setCalcSelectedId] = useState<string>('');
  const [calcInputQty, setCalcInputQty] = useState<string>('5');

  // Sub-tab 4: Store Operational Windows state
  const [morningStart, setMorningStart] = useState<string>('08:30');
  const [morningEnd, setMorningEnd] = useState<string>('10:30');
  const [afternoonStart, setAfternoonStart] = useState<string>('14:30');
  const [afternoonEnd, setAfternoonEnd] = useState<string>('16:00');
  const [savingWindows, setSavingWindows] = useState<boolean>(false);

  // Role permissions: Admin (Keeper) and FC have operational authority
  const hasEditPermission = useMemo(() => {
    return role === 'admin' || role === 'keeper' || role === 'fc';
  }, [role]);

  const storeTitle = STORE_NAMES[store] || store;

  // Load all master data records
  const loadMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedItems, fetchedConversions, fetchedWindows] = await Promise.all([
        getMasterItems(store),
        getUomConversions(),
        getStoreOperationalWindows(store),
      ]);

      setItems(fetchedItems);
      setConversions(fetchedConversions);
      setWindows(fetchedWindows);

      // Seed initial editing buffers for reorder policies
      const initialReorder: Record<string, { reorderPoint: string; parLevel: string }> = {};
      const initialExpiry: Record<string, string> = {};
      for (const item of fetchedItems) {
        initialReorder[item.itemCode] = {
          reorderPoint: item.reorderPoint !== null ? String(item.reorderPoint) : '',
          parLevel: item.parLevel !== null ? String(item.parLevel) : '',
        };
        initialExpiry[item.itemCode] = String(item.expiryWarningDays);
      }
      setEditingReorder(initialReorder);
      setEditingExpiryDays(initialExpiry);

      // Seed initial editing buffers for UoM conversions
      const initialConv: Record<string, { factor: string; dual: boolean }> = {};
      for (const conv of fetchedConversions) {
        initialConv[conv.conversionId] = {
          factor: String(conv.conversionFactor),
          dual: conv.dualUomRequired,
        };
      }
      setEditingConversions(initialConv);
      if (fetchedConversions.length > 0 && !calcSelectedId) {
        setCalcSelectedId(fetchedConversions[0].conversionId);
      }

      // Seed operational windows
      if (fetchedWindows) {
        const [mStart, mEnd] = (fetchedWindows.morningIssueWindow || '08:30-10:30').split('-');
        const [aStart, aEnd] = (fetchedWindows.afternoonIssueWindow || '14:30-16:00').split('-');
        if (mStart && mEnd) {
          setMorningStart(mStart);
          setMorningEnd(mEnd);
        }
        if (aStart && aEnd) {
          setAfternoonStart(aStart);
          setAfternoonEnd(aEnd);
        }
      }
    } catch {
      showToast('Could not load master data parameters.');
    } finally {
      setLoading(false);
    }
  }, [store, showToast, calcSelectedId]);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  // Handle reorder policy save via dispatchAction
  const handleSaveReorderRule = async (itemCode: string) => {
    const buffer = editingReorder[itemCode];
    if (!buffer) return;

    if (buffer.reorderPoint.trim() === '' || buffer.parLevel.trim() === '') {
      showToast('Both Reorder Point and Par Level quantities must be specified.');
      return;
    }

    const rp = parseFloat(buffer.reorderPoint);
    const par = parseFloat(buffer.parLevel);

    if (isNaN(rp) || rp < 0 || isNaN(par) || par < 0) {
      showToast('Quantities must be valid non-negative numbers.');
      return;
    }

    if (par < rp) {
      showToast('Par Level quantity cannot be less than Reorder Point.');
      return;
    }

    setSavingItemCode(itemCode);

    const result = await dispatchAction({
      actionName: 'UPDATE_ITEM_REORDER_RULE',
      storeId: store,
      payload: { itemCode, reorderPoint: rp, parLevel: par },
      execute: async () => {
        await updateItemReorderRule(itemCode, store, rp, par);
      },
      onSuccess: () => {
        setItems((prev) =>
          prev.map((it) =>
            it.itemCode === itemCode ? { ...it, reorderPoint: rp, parLevel: par } : it
          )
        );
        showToast(`Saved reorder policy for ${itemCode}: RP ${rp}, Par ${par}`);
      },
      onError: (err) => {
        showToast(`Failed to update reorder rule: ${err.message}`);
      },
    });

    setSavingItemCode(null);
    if (!result.success && result.retry) {
      // Action logged and structure preserved
    }
  };

  // Handle expiry warning days update via dispatchAction
  const handleSaveExpiryDays = async (itemCode: string) => {
    const rawVal = editingExpiryDays[itemCode];
    if (rawVal === undefined || rawVal.trim() === '') {
      showToast('Expiry warning days cannot be empty.');
      return;
    }

    const days = parseInt(rawVal, 10);
    if (isNaN(days) || days < 0) {
      showToast('Warning days must be a valid positive integer.');
      return;
    }

    setSavingExpiryCode(itemCode);

    const result = await dispatchAction({
      actionName: 'UPDATE_EXPIRY_CONFIG',
      storeId: store,
      payload: { itemCode, warningDays: days },
      execute: async () => {
        await updateExpiryConfig(itemCode, days);
      },
      onSuccess: () => {
        setItems((prev) =>
          prev.map((it) => (it.itemCode === itemCode ? { ...it, expiryWarningDays: days } : it))
        );
        showToast(`Updated shelf-life warning threshold for ${itemCode}: ${days} days`);
      },
      onError: (err) => {
        showToast(`Failed to update expiry config: ${err.message}`);
      },
    });

    setSavingExpiryCode(null);
    if (!result.success && result.retry) {
      // Structured error handled
    }
  };

  // Handle UoM conversion save via dispatchAction
  const handleSaveConversion = async (conversionId: string) => {
    const buffer = editingConversions[conversionId];
    if (!buffer) return;

    const factor = parseFloat(buffer.factor);
    if (isNaN(factor) || factor <= 0) {
      showToast('Conversion factor must be a strictly positive number.');
      return;
    }

    setSavingConversionId(conversionId);

    const result = await dispatchAction({
      actionName: 'UPDATE_UOM_CONVERSION',
      storeId: store,
      payload: { conversionId, conversionFactor: factor, dualUomRequired: buffer.dual },
      execute: async () => {
        await updateUomConversion(conversionId, factor, buffer.dual);
      },
      onSuccess: () => {
        setConversions((prev) =>
          prev.map((c) =>
            c.conversionId === conversionId
              ? {
                  ...c,
                  conversionFactor: factor,
                  dualUomRequired: buffer.dual,
                  sampleExpression: `1 ${c.secondaryUom} = ${factor} ${c.baseUom} ${c.itemName}`,
                }
              : c
          )
        );
        showToast(`Updated UoM conversion factor: ${factor}`);
      },
      onError: (err) => {
        showToast(`Failed to update conversion: ${err.message}`);
      },
    });

    setSavingConversionId(null);
    if (!result.success && result.retry) {
      // Structured error handled
    }
  };

  // Handle operational windows save via dispatchAction
  const handleSaveWindows = async () => {
    const morningFormatted = `${morningStart.trim()}-${morningEnd.trim()}`;
    const afternoonFormatted = `${afternoonStart.trim()}-${afternoonEnd.trim()}`;

    if (!morningStart || !morningEnd || !afternoonStart || !afternoonEnd) {
      showToast('All morning and afternoon window bounds must be provided.');
      return;
    }

    setSavingWindows(true);

    const result = await dispatchAction({
      actionName: 'UPDATE_OPERATIONAL_WINDOWS',
      storeId: store,
      payload: {
        storeId: store,
        morningIssueWindow: morningFormatted,
        afternoonIssueWindow: afternoonFormatted,
      },
      execute: async () => {
        await updateStoreOperationalWindows(store, morningFormatted, afternoonFormatted);
      },
      onSuccess: () => {
        setWindows((prev) =>
          prev
            ? {
                ...prev,
                morningIssueWindow: morningFormatted,
                afternoonIssueWindow: afternoonFormatted,
              }
            : null
        );
        showToast(
          `Operational issue windows saved for ${store}: Morning (${morningFormatted}), Afternoon (${afternoonFormatted})`
        );
      },
      onError: (err) => {
        showToast(`Failed to update operational windows: ${err.message}`);
      },
    });

    setSavingWindows(false);
    if (!result.success && result.retry) {
      // Handled
    }
  };

  // Filtered items for Catalog tab
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== 'ALL' && item.categoryGroup !== categoryFilter) {
        return false;
      }
      if (policyFilter === 'CONFIGURED' && (item.reorderPoint === null || item.parLevel === null)) {
        return false;
      }
      if (policyFilter === 'AWAITING' && item.reorderPoint !== null && item.parLevel !== null) {
        return false;
      }
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase();
        const matchesCode = item.itemCode.toLowerCase().includes(query);
        const matchesName = item.itemName.toLowerCase().includes(query);
        if (!matchesCode && !matchesName) return false;
      }
      return true;
    });
  }, [items, categoryFilter, policyFilter, searchQuery]);

  // Metrics summary
  const configuredCount = useMemo(
    () => items.filter((i) => i.reorderPoint !== null && i.parLevel !== null).length,
    [items]
  );
  const awaitingCount = useMemo(
    () => items.filter((i) => i.reorderPoint === null || i.parLevel === null).length,
    [items]
  );
  const dualUnitCount = useMemo(() => items.filter((i) => i.dualUomRequired).length, [items]);

  // Calculator lookup
  const activeCalcConversion = useMemo(
    () => conversions.find((c) => c.conversionId === calcSelectedId),
    [conversions, calcSelectedId]
  );
  const calculatedBaseQty = useMemo(() => {
    if (!activeCalcConversion) return '0.00';
    const parsed = parseFloat(calcInputQty);
    if (isNaN(parsed) || parsed <= 0) return '0.00';
    return (parsed * activeCalcConversion.conversionFactor).toFixed(2);
  }, [activeCalcConversion, calcInputQty]);

  return (
    <div>
      {/* Page Header */}
      <div className="head">
        <div>
          <div className="kicker">Master Data Administration &middot; Flow B &sect;4.4 &sect;4.5</div>
          <h1 className="h1">
            Operational Master <em>Catalog &amp; Policies</em>
          </h1>
          <div className="sub">
            Physical stock parameters, user-defined reorder triggers, shelf-life radar thresholds,
            UoM conversions, and store requisition windows for {storeTitle}.
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="seg" role="tablist" aria-label="Master data administration navigation">
          <button
            type="button"
            className={activeTab === 'catalog' ? 'on' : ''}
            onClick={() => setActiveTab('catalog')}
          >
            Item Catalog &amp; Reorder
          </button>
          <button
            type="button"
            className={activeTab === 'expiry' ? 'on' : ''}
            onClick={() => setActiveTab('expiry')}
          >
            Expiry Tracking
          </button>
          <button
            type="button"
            className={activeTab === 'uom' ? 'on' : ''}
            onClick={() => setActiveTab('uom')}
          >
            UoM Conversions
          </button>
          <button
            type="button"
            className={activeTab === 'windows' ? 'on' : ''}
            onClick={() => setActiveTab('windows')}
          >
            Operational Windows
          </button>
        </div>
      </div>

      {/* Role Access Security Notice */}
      {!hasEditPermission && (
        <div className="note am" style={{ marginBottom: 18 }}>
          <b>Read-Only Mode &middot; Role: {roleConfig.l}</b>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            Reorder thresholds, shelf-life radar rules, and store issue windows can only be altered
            by the Warehouse Keeper (Admin) or Financial Controller (FC). Displaying in observation
            mode.
          </div>
        </div>
      )}

      {/* Overview Metric Tiles */}
      <div className="tiles">
        <button
          type="button"
          className={`tile ${activeTab === 'catalog' ? 'on' : ''}`}
          onClick={() => setActiveTab('catalog')}
        >
          <span className="lbl">Benchmark Catalog</span>
          <span className="big">{items.length}</span>
          <span className="s">Canonical active items across 6 categories</span>
        </button>
        <button
          type="button"
          className="tile"
          onClick={() => {
            setActiveTab('catalog');
            setPolicyFilter('CONFIGURED');
          }}
        >
          <span className="lbl">Configured Reorder Rules</span>
          <span className="big" style={{ color: 'var(--forest)' }}>
            {configuredCount}
          </span>
          <span className="s">Active user-defined RP and Par levels</span>
        </button>
        <button
          type="button"
          className="tile"
          onClick={() => {
            setActiveTab('catalog');
            setPolicyFilter('AWAITING');
          }}
        >
          <span className="lbl">Awaiting Owner Setup</span>
          <span className="big" style={{ color: awaitingCount > 0 ? 'var(--terra)' : 'inherit' }}>
            {awaitingCount}
          </span>
          <span className="s">Zero default assumption &middot; [Owner to set]</span>
        </button>
        <button
          type="button"
          className={`tile ${activeTab === 'uom' ? 'on' : ''}`}
          onClick={() => setActiveTab('uom')}
        >
          <span className="lbl">Dual-Unit Regimen</span>
          <span className="big" style={{ color: 'var(--blue)' }}>
            {dualUnitCount}
          </span>
          <span className="s">kg + pcs mandatory for cheese and meat</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: ITEM CATALOG & REORDER POLICIES (Doc §4.4)                      */}
      {/* ========================================================================= */}
      {activeTab === 'catalog' && (
        <div className="stack">
          {/* Formula Specification Card */}
          <div className="win" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span className="lbl">
                Doc &sect;4.4 &sect;5.2 &middot; User-Defined Reorder Trigger &amp; Quantity Formula
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge variant="ok">Pure Quantities</Badge>
                <Badge variant="mu">No Automated Defaults</Badge>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 14,
                fontSize: 13,
              }}
            >
              <div
                style={{
                  background: 'var(--sand)',
                  padding: '10px 14px',
                  borderRadius: 4,
                  border: '1px solid var(--rule)',
                }}
              >
                <b>Reorder Trigger Condition:</b>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    marginTop: 4,
                    color: 'var(--navy)',
                    fontWeight: 600,
                  }}
                >
                  Current Book Stock &le; Reorder Point [Owner to set]
                </div>
                <div className="meta" style={{ marginTop: 4 }}>
                  Evaluated at closing balance and pick staging.
                </div>
              </div>

              <div
                style={{
                  background: 'var(--sand)',
                  padding: '10px 14px',
                  borderRadius: 4,
                  border: '1px solid var(--rule)',
                }}
              >
                <b>Suggested Reorder Quantity Formula:</b>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    marginTop: 4,
                    color: 'var(--forest)',
                    fontWeight: 600,
                  }}
                >
                  max(0, Par Level &minus; Current Stock &minus; In-Transit Quantity)
                </div>
                <div className="meta" style={{ marginTop: 4 }}>
                  Prevents duplicate requisition while intake transfers are pending.
                </div>
              </div>
            </div>
          </div>

          {/* Filtering and Search Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 4,
            }}
          >
            <Chips>
              <Chip
                label="All Categories"
                count={items.length}
                active={categoryFilter === 'ALL'}
                onClick={() => setCategoryFilter('ALL')}
              />
              <Chip
                label="Dairy"
                count={items.filter((i) => i.categoryGroup === 'Dairy').length}
                active={categoryFilter === 'Dairy'}
                onClick={() => setCategoryFilter('Dairy')}
              />
              <Chip
                label="Meat"
                count={items.filter((i) => i.categoryGroup === 'Meat').length}
                active={categoryFilter === 'Meat'}
                onClick={() => setCategoryFilter('Meat')}
              />
              <Chip
                label="Produce"
                count={items.filter((i) => i.categoryGroup === 'Produce').length}
                active={categoryFilter === 'Produce'}
                onClick={() => setCategoryFilter('Produce')}
              />
              <Chip
                label="Seafood"
                count={items.filter((i) => i.categoryGroup === 'Seafood').length}
                active={categoryFilter === 'Seafood'}
                onClick={() => setCategoryFilter('Seafood')}
              />
              <Chip
                label="Dry"
                count={items.filter((i) => i.categoryGroup === 'Dry').length}
                active={categoryFilter === 'Dry'}
                onClick={() => setCategoryFilter('Dry')}
              />
              <Chip
                label="Packaging"
                count={items.filter((i) => i.categoryGroup === 'Packaging').length}
                active={categoryFilter === 'Packaging'}
                onClick={() => setCategoryFilter('Packaging')}
              />
            </Chips>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="text"
                className="in"
                style={{ width: 220, padding: '5px 10px', marginTop: 0 }}
                placeholder="Search code or item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="in"
                style={{ width: 180, padding: '5px 10px', marginTop: 0 }}
                value={policyFilter}
                onChange={(e) => setPolicyFilter(e.target.value as 'ALL' | 'CONFIGURED' | 'AWAITING')}
                aria-label="Filter policy configuration status"
              >
                <option value="ALL">All Policy States</option>
                <option value="CONFIGURED">Configured ({configuredCount})</option>
                <option value="AWAITING">Awaiting Owner ({awaitingCount})</option>
              </select>
            </div>
          </div>

          {/* Benchmark Items Table */}
          <Ticket
            no={`CATALOG & REORDER POLICIES (${filteredItems.length} ITEMS)`}
            right={
              <span className="meta">
                Store: <b>{store}</b> &middot; Physical Units Only
              </span>
            }
          >
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-2)' }}>
                Loading master items and reorder parameters...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="note mu">No items match the selected filter criteria.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Item Code</th>
                      <th>Item Description &amp; Storage</th>
                      <th style={{ width: 110 }}>Category</th>
                      <th style={{ width: 80 }}>Base UoM</th>
                      <th style={{ width: 150 }}>Dual-Unit Flag</th>
                      <th className="num" style={{ width: 150 }}>
                        Reorder Point
                      </th>
                      <th className="num" style={{ width: 150 }}>
                        Par Level
                      </th>
                      <th style={{ width: 110, textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const buffer = editingReorder[item.itemCode] || {
                        reorderPoint: '',
                        parLevel: '',
                      };
                      const isSaving = savingItemCode === item.itemCode;
                      const isAwaiting = item.reorderPoint === null || item.parLevel === null;

                      return (
                        <tr key={item.itemCode}>
                          <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                            {item.itemCode}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{item.itemName}</div>
                            <div className="meta" style={{ fontSize: 12 }}>
                              {item.storageType === 'COLD_ROOM' ? 'Cold Room' : 'Dry Store'} &middot;{' '}
                              {item.warehouseId}
                            </div>
                          </td>
                          <td>
                            <span
                              className="b mu"
                              style={{
                                fontSize: 11,
                                padding: '2px 6px',
                                textTransform: 'capitalize',
                              }}
                            >
                              {item.categoryGroup}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>
                            {item.baseUom}
                          </td>
                          <td>
                            {item.dualUomRequired ? (
                              <Badge
                                variant="re"
                                title="Dual-unit recording is mandatory for cheese and meat to monitor moisture loss"
                              >
                                kg + pcs Mandatory
                              </Badge>
                            ) : (
                              <span className="meta">Single ({item.baseUom})</span>
                            )}
                          </td>
                          <td className="num">
                            {hasEditPermission ? (
                              <div
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  className={`in ${isAwaiting ? 'err' : ''}`}
                                  style={{
                                    width: 100,
                                    textAlign: 'right',
                                    padding: '4px 8px',
                                    marginTop: 0,
                                    fontFamily: 'var(--mono)',
                                  }}
                                  placeholder="[Owner to set]"
                                  value={buffer.reorderPoint}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditingReorder((prev) => ({
                                      ...prev,
                                      [item.itemCode]: {
                                        ...prev[item.itemCode],
                                        reorderPoint: val,
                                      },
                                    }));
                                  }}
                                />
                                <span className="meta">{item.baseUom}</span>
                              </div>
                            ) : (
                              <span
                                className={`num ${isAwaiting ? 'ro' : ''}`}
                                style={{ fontWeight: 600 }}
                              >
                                {item.reorderPoint !== null
                                  ? `${item.reorderPoint} ${item.baseUom}`
                                  : '[Owner to set]'}
                              </span>
                            )}
                          </td>
                          <td className="num">
                            {hasEditPermission ? (
                              <div
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  className={`in ${isAwaiting ? 'err' : ''}`}
                                  style={{
                                    width: 100,
                                    textAlign: 'right',
                                    padding: '4px 8px',
                                    marginTop: 0,
                                    fontFamily: 'var(--mono)',
                                  }}
                                  placeholder="[Owner to set]"
                                  value={buffer.parLevel}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditingReorder((prev) => ({
                                      ...prev,
                                      [item.itemCode]: {
                                        ...prev[item.itemCode],
                                        parLevel: val,
                                      },
                                    }));
                                  }}
                                />
                                <span className="meta">{item.baseUom}</span>
                              </div>
                            ) : (
                              <span
                                className={`num ${isAwaiting ? 'ro' : ''}`}
                                style={{ fontWeight: 600 }}
                              >
                                {item.parLevel !== null
                                  ? `${item.parLevel} ${item.baseUom}`
                                  : '[Owner to set]'}
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {hasEditPermission && (
                              <button
                                type="button"
                                className="btn sm"
                                disabled={isSaving}
                                onClick={() => handleSaveReorderRule(itemCode(item))}
                                title="Persist user-defined reorder rule"
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Ticket>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: EXPIRY TRACKING GROUPS (Doc §4.5)                              */}
      {/* ========================================================================= */}
      {activeTab === 'expiry' && (
        <div className="stack">
          {/* Radar Trigger Rule Specification */}
          <div className="win" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span className="lbl">Doc &sect;4.5 &middot; Group-Configured Expiry Radar Rules</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge variant="am">Amber Warning Badge</Badge>
                <Badge variant="er">Hard-Lock Block</Badge>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 14,
                fontSize: 13,
              }}
            >
              <div
                style={{
                  background: 'var(--amber-bg)',
                  border: '1px solid #E4C987',
                  padding: '12px 16px',
                  borderRadius: 4,
                  color: '#4D2F00',
                }}
              >
                <b>1. EXPIRY WARNING (Amber Radar):</b>
                <div style={{ marginTop: 4, fontFamily: 'var(--mono)', fontWeight: 600 }}>
                  Days to Expiry &le; Expiry Warning Days [Owner to set]
                </div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4 }}>
                  Triggered batch is rendered with an amber warning badge. Item is automatically
                  prioritized at the top of the requisition picking list following strict FIFO.
                </div>
              </div>

              <div
                style={{
                  background: 'var(--err-bg)',
                  border: '1px solid #E8B8AD',
                  padding: '12px 16px',
                  borderRadius: 4,
                  color: '#6D1A0A',
                }}
              >
                <b>2. EXPIRED HARD-LOCK (Zero Exception):</b>
                <div style={{ marginTop: 4, fontFamily: 'var(--mono)', fontWeight: 600 }}>
                  Days to Expiry &le; 0
                </div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4 }}>
                  The application hard-locks the lot immediately. It cannot be picked, staged, or
                  transferred for kitchen issue under any circumstance. Must route to waste disposal.
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Radar Threshold Simulator */}
          <Ticket
            no="EXPIRY RADAR STATUS SIMULATOR"
            right={<span className="meta">Simulate Batch Shelf-Life Behavior</span>}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
                paddingBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label
                  htmlFor="sim-days"
                  className="lbl"
                  style={{ textTransform: 'none', fontSize: 13 }}
                >
                  Simulate Days to Expiry:
                </label>
                <input
                  id="sim-days"
                  type="number"
                  className="in"
                  style={{ width: 90, marginTop: 0, padding: '4px 8px', textAlign: 'center' }}
                  value={simulatedDaysRemaining}
                  onChange={(e) => setSimulatedDaysRemaining(parseInt(e.target.value, 10) || 0)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="meta">Radar Output Verdict:</span>
                {simulatedDaysRemaining <= 0 ? (
                  <Badge variant="er">EXPIRED &middot; HARD-LOCK (Picking Prohibited)</Badge>
                ) : simulatedDaysRemaining <= 3 ? (
                  <Badge variant="am">
                    EXPIRY WARNING &middot; Priority FIFO Pick ({simulatedDaysRemaining}d remaining)
                  </Badge>
                ) : (
                  <Badge variant="ok">NORMAL SHELF-LIFE &middot; Standard FIFO</Badge>
                )}
              </div>
            </div>
          </Ticket>

          {/* Group and Items Expiry Configuration Table */}
          <Ticket
            no="SHELF-LIFE EXPIRY CONFIGURATION BY ITEM"
            right={
              <span className="meta">Thresholds trigger automated amber pick priority</span>
            }
          >
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Item Code</th>
                    <th>Item Description</th>
                    <th style={{ width: 110 }}>Category</th>
                    <th style={{ width: 130 }}>Shelf-Life Tracking</th>
                    <th className="num" style={{ width: 120 }}>
                      Shelf Life
                    </th>
                    <th className="num" style={{ width: 170 }}>
                      Warning Days Trigger
                    </th>
                    <th style={{ width: 160 }}>Simulated Status</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const bufferDays = editingExpiryDays[item.itemCode] ?? String(item.expiryWarningDays);
                    const warningThreshold = parseInt(bufferDays, 10) || item.expiryWarningDays;
                    const isSaving = savingExpiryCode === item.itemCode;

                    let statusBadge = (
                      <Badge variant="ok">Normal</Badge>
                    );
                    if (simulatedDaysRemaining <= 0) {
                      statusBadge = <Badge variant="er">Hard-Lock</Badge>;
                    } else if (simulatedDaysRemaining <= warningThreshold) {
                      statusBadge = <Badge variant="am">Amber Warning</Badge>;
                    }

                    return (
                      <tr key={item.itemCode}>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                          {item.itemCode}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.itemName}</div>
                          <div className="meta" style={{ fontSize: 12 }}>
                            {item.warehouseId} &middot; Base UoM: {item.baseUom}
                          </div>
                        </td>
                        <td>
                          <span
                            className="b mu"
                            style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              textTransform: 'capitalize',
                            }}
                          >
                            {item.categoryGroup}
                          </span>
                        </td>
                        <td>
                          {item.requiresExpiryTracking ? (
                            <Badge variant="ok">Active Radar</Badge>
                          ) : (
                            <span className="meta">Non-perishable</span>
                          )}
                        </td>
                        <td className="num" style={{ fontFamily: 'var(--mono)' }}>
                          {item.shelfLifeDays} days
                        </td>
                        <td className="num">
                          {hasEditPermission ? (
                            <div
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <input
                                type="number"
                                min="0"
                                className="in"
                                style={{
                                  width: 80,
                                  textAlign: 'right',
                                  padding: '4px 8px',
                                  marginTop: 0,
                                  fontFamily: 'var(--mono)',
                                }}
                                value={bufferDays}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditingExpiryDays((prev) => ({
                                    ...prev,
                                    [item.itemCode]: val,
                                  }));
                                }}
                              />
                              <span className="meta">days</span>
                            </div>
                          ) : (
                            <span className="num" style={{ fontWeight: 600 }}>
                              {item.expiryWarningDays} days
                            </span>
                          )}
                        </td>
                        <td>{statusBadge}</td>
                        <td style={{ textAlign: 'right' }}>
                          {hasEditPermission && (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={isSaving}
                              onClick={() => handleSaveExpiryDays(item.itemCode)}
                              title="Persist warning threshold for this item"
                            >
                              {isSaving ? 'Saving...' : 'Save'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Ticket>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: UOM CONVERSIONS                                                */}
      {/* ========================================================================= */}
      {activeTab === 'uom' && (
        <div className="stack">
          {/* UoM Architecture Overview */}
          <div className="win" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span className="lbl">
                Physical Unit Transformations &middot; Base UoM vs Secondary Operational UoM
              </span>
              <Badge variant="re">Dual-Unit Mandate Enforced</Badge>
            </div>
            <div style={{ fontSize: 13, color: 'var(--navy)', lineHeight: 1.5 }}>
              Requisition requests and kitchen delivery containers frequently arrive in packs,
              tins, sacks, or bundles. All ledger postings remain strictly converted into base
              physical units (<b>kg</b> or <b>pcs</b>). For Cheese and Meat items, dual-unit tracking
              (both kg weight and discrete pieces) is enforced across intake, custody handover, and
              inter-store transfers to detect weight evaporation and trimming shrinkage.
            </div>
          </div>

          <div className="cols" style={{ gridTemplateColumns: '1fr 340px' }}>
            {/* Conversion Tables */}
            <Ticket
              no={`SECONDARY UOM CONVERSIONS (${conversions.length} RULES)`}
              right={<span className="meta">Deterministic Mathematical Factors</span>}
            >
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Item Code &amp; Name</th>
                      <th style={{ width: 100 }}>Secondary</th>
                      <th style={{ width: 80 }}>Base</th>
                      <th className="num" style={{ width: 140 }}>
                        Conversion Factor
                      </th>
                      <th style={{ width: 130 }}>Dual Regimen</th>
                      <th style={{ width: 100, textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversions.map((conv) => {
                      const buffer = editingConversions[conv.conversionId] || {
                        factor: String(conv.conversionFactor),
                        dual: conv.dualUomRequired,
                      };
                      const isSaving = savingConversionId === conv.conversionId;

                      return (
                        <tr key={conv.conversionId}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{conv.itemName}</div>
                            <div className="meta" style={{ fontSize: 12 }}>
                              {conv.itemCode} &middot; {conv.sampleExpression}
                            </div>
                          </td>
                          <td style={{ fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>
                            {conv.secondaryUom}
                          </td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{conv.baseUom}</td>
                          <td className="num">
                            {hasEditPermission ? (
                              <input
                                type="number"
                                min="0.0001"
                                step="any"
                                className="in"
                                style={{
                                  width: 100,
                                  textAlign: 'right',
                                  padding: '4px 8px',
                                  marginTop: 0,
                                  fontFamily: 'var(--mono)',
                                }}
                                value={buffer.factor}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setEditingConversions((prev) => ({
                                    ...prev,
                                    [conv.conversionId]: {
                                      ...prev[conv.conversionId],
                                      factor: val,
                                    },
                                  }));
                                }}
                              />
                            ) : (
                              <span className="num" style={{ fontWeight: 600 }}>
                                {conv.conversionFactor}
                              </span>
                            )}
                          </td>
                          <td>
                            {hasEditPermission ? (
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  cursor: 'pointer',
                                  fontSize: 12,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={buffer.dual}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setEditingConversions((prev) => ({
                                      ...prev,
                                      [conv.conversionId]: {
                                        ...prev[conv.conversionId],
                                        dual: checked,
                                      },
                                    }));
                                  }}
                                />
                                {buffer.dual ? (
                                  <Badge variant="re">kg + pcs</Badge>
                                ) : (
                                  <span className="meta">Single</span>
                                )}
                              </label>
                            ) : conv.dualUomRequired ? (
                              <Badge variant="re">kg + pcs</Badge>
                            ) : (
                              <span className="meta">Single</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {hasEditPermission && (
                              <button
                                type="button"
                                className="btn sm"
                                disabled={isSaving}
                                onClick={() => handleSaveConversion(conv.conversionId)}
                                title="Persist conversion factor"
                              >
                                {isSaving ? '...' : 'Save'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Ticket>

            {/* Quick Conversion Calculator Tool */}
            <Ticket no="UOM CONVERSION VERIFIER" pad={true}>
              <div className="stack">
                <div className="fld">
                  <label htmlFor="calc-rule" className="lbl">
                    Select Conversion Rule:
                  </label>
                  <select
                    id="calc-rule"
                    className="in"
                    value={calcSelectedId}
                    onChange={(e) => setCalcSelectedId(e.target.value)}
                  >
                    {conversions.map((c) => (
                      <option key={c.conversionId} value={c.conversionId}>
                        {c.secondaryUom.toUpperCase()} &rarr; {c.baseUom} ({c.itemName})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fld">
                  <label htmlFor="calc-qty" className="lbl">
                    Secondary Quantity ({activeCalcConversion?.secondaryUom}):
                  </label>
                  <input
                    id="calc-qty"
                    type="number"
                    min="1"
                    className="in"
                    value={calcInputQty}
                    onChange={(e) => setCalcInputQty(e.target.value)}
                  />
                </div>

                <div
                  style={{
                    background: 'var(--sand)',
                    border: '1px solid var(--rule)',
                    borderRadius: 4,
                    padding: '14px 16px',
                    textAlign: 'center',
                  }}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    Converted Base Ledger Stock
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 34,
                      fontWeight: 600,
                      color: 'var(--navy)',
                      marginTop: 4,
                    }}
                  >
                    {calculatedBaseQty}{' '}
                    <span style={{ fontSize: 20 }}>{activeCalcConversion?.baseUom}</span>
                  </div>
                  <div className="meta" style={{ marginTop: 4 }}>
                    {calcInputQty} {activeCalcConversion?.secondaryUom} &times;{' '}
                    {activeCalcConversion?.conversionFactor} = {calculatedBaseQty}{' '}
                    {activeCalcConversion?.baseUom}
                  </div>
                </div>

                {activeCalcConversion?.dualUomRequired && (
                  <div className="note am" style={{ fontSize: 12 }}>
                    <b>Dual-Unit Rule Active:</b> Physical intake must also register discrete piece
                    counts alongside this converted weight.
                  </div>
                )}
              </div>
            </Ticket>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 4: STORE OPERATIONAL WINDOWS (Flow B)                             */}
      {/* ========================================================================= */}
      {activeTab === 'windows' && (
        <div className="stack">
          {/* Flow B Security and Operational Schedule Architecture */}
          <div className="win" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span className="lbl">
                Flow B &sect;5.1 &middot; Storeroom Custody &amp; Operational Issue Windows
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge variant="ok">Physical Lock Protocol</Badge>
                <Badge variant="ur">Urgent Escalation Trigger</Badge>
              </div>
            </div>

            <div style={{ fontSize: 13, color: 'var(--navy)', lineHeight: 1.5 }}>
              The storeroom physical access schedule directly dictates requisition classification.
              Requisitions submitted during authorized issue windows are processed via standard batch
              FIFO picking. Any requisition submitted outside these windows is automatically flagged
              as <b>URGENT</b>, requiring a mandatory business justification note and manager review.
            </div>
          </div>

          <div className="cols" style={{ gridTemplateColumns: '1fr 380px' }}>
            {/* Operational Windows Configuration Editor */}
            <Ticket
              no={`STORE REQUISITION WINDOWS (${store})`}
              right={<span className="meta">Configured by Admin / FC &middot; Flow B</span>}
            >
              <div className="stack">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Morning Issue Window */}
                  <div
                    style={{
                      background: 'var(--paper)',
                      border: '1px solid var(--rule)',
                      borderRadius: 4,
                      padding: 16,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span className="b ok" style={{ fontSize: 11 }}>
                        Morning Window
                      </span>
                      <b style={{ fontSize: 14 }}>Batch Kitchen Prep</b>
                    </div>

                    <div className="fld">
                      <label htmlFor="m-start" className="lbl">
                        Window Opens (24h):
                      </label>
                      <input
                        id="m-start"
                        type="time"
                        className="in"
                        disabled={!hasEditPermission}
                        value={morningStart}
                        onChange={(e) => setMorningStart(e.target.value)}
                      />
                    </div>

                    <div className="fld">
                      <label htmlFor="m-end" className="lbl">
                        Window Closes (24h):
                      </label>
                      <input
                        id="m-end"
                        type="time"
                        className="in"
                        disabled={!hasEditPermission}
                        value={morningEnd}
                        onChange={(e) => setMorningEnd(e.target.value)}
                      />
                    </div>

                    <div className="meta" style={{ marginTop: 8 }}>
                      Canonical setting: <b>08:30 &ndash; 10:30</b>
                    </div>
                  </div>

                  {/* Afternoon Issue Window */}
                  <div
                    style={{
                      background: 'var(--paper)',
                      border: '1px solid var(--rule)',
                      borderRadius: 4,
                      padding: 16,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span className="b ok" style={{ fontSize: 11 }}>
                        Afternoon Window
                      </span>
                      <b style={{ fontSize: 14 }}>Evening Service Prep</b>
                    </div>

                    <div className="fld">
                      <label htmlFor="a-start" className="lbl">
                        Window Opens (24h):
                      </label>
                      <input
                        id="a-start"
                        type="time"
                        className="in"
                        disabled={!hasEditPermission}
                        value={afternoonStart}
                        onChange={(e) => setAfternoonStart(e.target.value)}
                      />
                    </div>

                    <div className="fld">
                      <label htmlFor="a-end" className="lbl">
                        Window Closes (24h):
                      </label>
                      <input
                        id="a-end"
                        type="time"
                        className="in"
                        disabled={!hasEditPermission}
                        value={afternoonEnd}
                        onChange={(e) => setAfternoonEnd(e.target.value)}
                      />
                    </div>

                    <div className="meta" style={{ marginTop: 8 }}>
                      Canonical setting: <b>14:30 &ndash; 16:00</b>
                    </div>
                  </div>
                </div>

                {hasEditPermission && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={savingWindows}
                      onClick={handleSaveWindows}
                    >
                      {savingWindows ? 'Persisting Changes...' : 'Save Operational Windows'}
                    </button>
                  </div>
                )}
              </div>
            </Ticket>

            {/* Live Operational Status & Policy Explanation */}
            <Ticket no="FLOW B CUSTODY SUMMARY" pad={true}>
              <div className="stack">
                <div
                  style={{
                    background: 'var(--sand)',
                    border: '1px solid var(--rule)',
                    borderRadius: 4,
                    padding: 14,
                  }}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    Active Configuration
                  </span>
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span className="meta">Store Identifier:</span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{store}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span className="meta">Morning Issue:</span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {morningStart} &ndash; {morningEnd}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span className="meta">Afternoon Issue:</span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {afternoonStart} &ndash; {afternoonEnd}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span className="meta">Morning Dock Intake:</span>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {windows?.morningReceivingWindow || '07:00-09:00'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="note am" style={{ fontSize: 12 }}>
                  <b>Out-of-Window Requisition Policy:</b>
                  <div style={{ marginTop: 4 }}>
                    Sections placing requests outside {morningStart}&ndash;{morningEnd} and{' '}
                    {afternoonStart}&ndash;{afternoonEnd} are blocked from routine queueing. The UI
                    mandates entry of an <i>Urgent Reason</i> before dispatching to the pick queue.
                  </div>
                </div>

                <div className="note ok" style={{ fontSize: 12 }}>
                  <b>Custodian Responsibility:</b>
                  <div style={{ marginTop: 4 }}>
                    Named room custodians unlock storerooms 10 minutes prior to window opening and
                    log secure lock-up at window conclusion.
                  </div>
                </div>
              </div>
            </Ticket>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to reliably access item code
function itemCode(item: MasterItem): string {
  return item.itemCode;
}
