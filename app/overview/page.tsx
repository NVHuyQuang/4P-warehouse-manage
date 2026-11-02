'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';

interface Lot {
  id: string;
  recv: string;
  exp: string;
  qty: number;
  st?: 'ok' | 'am' | 'lk';
}

interface Item {
  c: string;
  n: string;
  u: 'kg' | 'pcs';
  wh: 'COLD' | 'DRY';
  cat: string;
  book: number;
  rp: number;
  par: number;
  po: number;
  lots: Lot[];
}

const ITEMS: Item[] = [
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
      { id: 'L-MOZ-1019', recv: '19 Oct', exp: '16 Nov', qty: 12.0, st: 'ok' },
      { id: 'L-MOZ-1026', recv: '26 Oct', exp: '23 Nov', qty: 30.5, st: 'ok' },
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
    lots: [{ id: 'L-BAS-1101', recv: '01 Nov', exp: '06 Nov', qty: 3.2, st: 'ok' }],
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
      { id: 'L-BUR-1029', recv: '29 Oct', exp: '04 Nov', qty: 6, st: 'am' },
      { id: 'L-BUR-1031', recv: '31 Oct', exp: '12 Nov', qty: 12, st: 'ok' },
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
    lots: [{ id: 'L-CHK-1030', recv: '30 Oct', exp: '07 Nov', qty: 26.0, st: 'ok' }],
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
    lots: [{ id: 'L-DOU-1102', recv: '02 Nov', exp: '09 Nov', qty: 140, st: 'ok' }],
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
      { id: 'L-SAL-1027', recv: '27 Oct', exp: '31 Oct', qty: 3.1, st: 'lk' },
      { id: 'L-SAL-1031', recv: '31 Oct', exp: '10 Nov', qty: 6.3, st: 'ok' },
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
    lots: [{ id: 'L-PAR-1020', recv: '20 Oct', exp: '20 Nov', qty: 4.1, st: 'ok' }],
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
    lots: [{ id: 'L-GOR-1018', recv: '18 Oct', exp: '18 Nov', qty: 3.6, st: 'ok' }],
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
    lots: [{ id: 'L-RIC-1024', recv: '24 Oct', exp: '14 Nov', qty: 7.5, st: 'ok' }],
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
    lots: [{ id: 'L-FLO-1015', recv: '15 Oct', exp: '15 Apr', qty: 85.0, st: 'ok' }],
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
    lots: [{ id: 'L-PAS-1008', recv: '08 Oct', exp: '08 Oct+1y', qty: 36, st: 'ok' }],
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
    lots: [{ id: 'L-BOX-1022', recv: '22 Oct', exp: 'none', qty: 400, st: 'ok' }],
  },
];

function formatQty(it: Item, qty: number): string {
  return `${it.u === 'kg' ? qty.toFixed(1) : String(Math.round(qty))} ${it.u}`;
}

function getItemBadges(it: Item): Array<{ variant: 'ok' | 'am' | 'er' | 're'; label: string }> {
  const result: Array<{ variant: 'ok' | 'am' | 'er' | 're'; label: string }> = [];
  const hasLock = it.lots.some((l) => l.st === 'lk' && l.qty > 0);
  const hasAmber = it.lots.some((l) => l.st === 'am' && l.qty > 0);

  if (hasLock) result.push({ variant: 'er', label: 'EXPIRED LOCK' });
  if (hasAmber) result.push({ variant: 'am', label: 'Expiry amber' });
  if (it.book <= it.rp) result.push({ variant: 're', label: 'Reorder' });
  if (result.length === 0) result.push({ variant: 'ok', label: 'In stock' });

  return result;
}

export default function StockOverviewPage() {
  const { role, roleConfig, store } = useShell();

  const [activeWh, setActiveWh] = useState<'COLD' | 'DRY'>('COLD');
  const [filter, setFilter] = useState<'all' | 'ex' | 're'>('all');
  const [selectedCode, setSelectedCode] = useState<string>('RM-BAS-01');

  const storeTitle = STORE_NAMES[store] || store;
  const whMeta =
    activeWh === 'COLD'
      ? { code: 'WH-DEL01-COLD', name: 'Cold Room', floor: 'Ground floor' }
      : { code: 'WH-DEL01-DRY', name: 'Dry Store', floor: 'Ground floor' };

  const whItems = ITEMS.filter((i) => i.wh === activeWh);
  const nExp = whItems.filter((i) =>
    getItemBadges(i).some((b) => b.variant === 'er' || b.variant === 'am')
  ).length;
  const nRe = whItems.filter((i) =>
    getItemBadges(i).some((b) => b.variant === 're')
  ).length;

  const filteredItems = whItems.filter((i) => {
    if (filter === 'all') return true;
    const badges = getItemBadges(i);
    if (filter === 'ex') return badges.some((b) => b.variant === 'er' || b.variant === 'am');
    if (filter === 're') return badges.some((b) => b.variant === 're');
    return true;
  });

  const selectedItem = whItems.find((i) => i.c === selectedCode) || whItems[0] || ITEMS[0];
  const suggestedReorder = selectedItem
    ? Math.max(0, selectedItem.par - selectedItem.book - selectedItem.po)
    : 0;

  const roleAction = (() => {
    switch (role) {
      case 'keeper':
        return { label: 'Open pick queue', href: '/requests' };
      case 'cust':
        return { label: 'Start daily balance', href: '/balance' };
      case 'rm':
        return { label: 'Review daily balance', href: '/balance' };
      case 'fc':
        return { label: 'Open approvals inbox', href: '/approvals' };
      default:
        return null;
    }
  })();

  return (
    <>
      {store !== 'IND-DEL-01' && (
        <div className="note am" style={{ marginBottom: 16 }}>
          Prototype shows the IND-DEL-01 data set for {store}.
        </div>
      )}

      <div className="head">
        <div>
          <div className="kicker">
            Store {store} &middot; {storeTitle}
          </div>
          <h1 className="h1">
            {whMeta.name},{' '}
            <em>as of 10:15.</em>
          </h1>
          <p className="sub">
            Book stock is derived from the append-only ledger. It is never typed in or edited.
          </p>
        </div>
        {roleAction ? (
          <Link href={roleAction.href} className="btn">
            {roleAction.label}
          </Link>
        ) : (
          <div className="note" style={{ maxWidth: 420 }}>
            Read-only for {roleConfig.l}. No primary action on this screen.
          </div>
        )}
      </div>

      <div className="win">
        <span className="lbl">Issue window (sample)</span>
        <Badge variant="ok">Open</Badge>
        <span className="meta">
          Morning 06:00–11:30 &middot; closes in 1 h 15 min &middot; Afternoon 14:00–17:00
        </span>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          Requests outside the window are accepted and flagged URGENT with a reason.
        </span>
      </div>

      <div className="cols c-ov">
        <div>
          <div className="tiles">
            <Link href="/requests" className="tile">
              <span className="lbl">Pick queue</span>
              <span className="big">5</span>
              <span className="s">1 urgent &middot; 4 standard</span>
            </Link>
            <Link href="/issues" className="tile">
              <span className="lbl">Awaiting runner</span>
              <span className="big">1</span>
              <span className="s">staged, not yet at the door</span>
            </Link>
            <button
              type="button"
              className={`tile ${filter === 'ex' ? 'on' : ''}`}
              onClick={() => setFilter(filter === 'ex' ? 'all' : 'ex')}
            >
              <span className="lbl">Expiry watch</span>
              <span className="big">{nExp}</span>
              <span className="s">amber or EXPIRED LOCK lots</span>
            </button>
            <button
              type="button"
              className={`tile ${filter === 're' ? 'on' : ''}`}
              onClick={() => setFilter(filter === 're' ? 'all' : 're')}
            >
              <span className="lbl">Reorder</span>
              <span className="big">{nRe}</span>
              <span className="s">at or below reorder point</span>
            </button>
          </div>

          <Ticket no={`STOCK · ${whMeta.code}`} right="Derived from ledger">
            <div
              style={{
                display: 'flex',
                gap: 16,
                alignItems: 'center',
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <div className="seg" role="group" aria-label="Warehouse selection">
                <button
                  type="button"
                  className={activeWh === 'COLD' ? 'on' : ''}
                  onClick={() => {
                    setActiveWh('COLD');
                    setFilter('all');
                  }}
                >
                  Cold Room
                </button>
                <button
                  type="button"
                  className={activeWh === 'DRY' ? 'on' : ''}
                  onClick={() => {
                    setActiveWh('DRY');
                    setFilter('all');
                  }}
                >
                  Dry Store
                </button>
              </div>

              <Chips>
                <Chip
                  label="All"
                  count={whItems.length}
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                />
                <Chip
                  label="Expiry"
                  count={nExp}
                  active={filter === 'ex'}
                  onClick={() => setFilter(filter === 'ex' ? 'all' : 'ex')}
                />
                <Chip
                  label="Reorder"
                  count={nRe}
                  active={filter === 're'}
                  onClick={() => setFilter(filter === 're' ? 'all' : 're')}
                />
              </Chips>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Code</th>
                  <th>Category</th>
                  <th className="num">Book qty</th>
                  <th>UoM</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isSelected = item.c === selectedItem?.c;
                  const badges = getItemBadges(item);
                  return (
                    <tr
                      key={item.c}
                      className={`row ${isSelected ? 'sel' : ''}`}
                      onClick={() => setSelectedCode(item.c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedCode(item.c);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <b>{item.n}</b>
                      </td>
                      <td className="m">{item.c}</td>
                      <td>{item.cat}</td>
                      <td className="num">
                        <b>{item.u === 'kg' ? item.book.toFixed(1) : item.book}</b>
                      </td>
                      <td className="m">{item.u}</td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          {badges.map((b) => (
                            <Badge key={b.label} variant={b.variant}>
                              {b.label}
                            </Badge>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Ticket>
        </div>

        <aside className="stack">
          <div className="stub w">
            <span className="lbl">Store and warehouse</span>
            <table className="tick">
              <tbody>
                <tr>
                  <td>Store</td>
                  <td>{store}</td>
                </tr>
                <tr>
                  <td>Warehouse</td>
                  <td>{whMeta.code}</td>
                </tr>
                <tr>
                  <td>Type</td>
                  <td>{whMeta.name}</td>
                </tr>
                <tr>
                  <td>Status</td>
                  <td>ACTIVE</td>
                </tr>
                <tr>
                  <td>Your scope</td>
                  <td>{roleConfig.scope}</td>
                </tr>
                <tr>
                  <td>Backup sync</td>
                  <td>02 Nov 03:00</td>
                </tr>
              </tbody>
            </table>
          </div>

          {selectedItem && (
            <div className="stub">
              <span className="lbl">Selected: {selectedItem.n}</span>
              {selectedItem.lots.map((lot) => (
                <div key={lot.id} className="ledrow">
                  <span className="t">{lot.id}</span>
                  <span>exp {lot.exp}</span>
                  <span>
                    {formatQty(selectedItem, lot.qty)}{' '}
                    {lot.st === 'lk' && <Badge variant="er">LOCK</Badge>}
                    {lot.st === 'am' && <Badge variant="am">Amber</Badge>}
                  </span>
                </div>
              ))}
              <p className="gloss" style={{ margin: '8px 0 0' }}>
                Lots ordered oldest first (FIFO). Locked lots cannot be issued.
              </p>
            </div>
          )}

          {selectedItem && (
            <div className="stub w">
              <span className="lbl">Reorder suggestion (sample rule)</span>
              <div className="meta" style={{ color: 'var(--navy)' }}>
                suggested = max(0, par − book − open PO)
              </div>
              <table className="tick" style={{ marginTop: 6 }}>
                <tbody>
                  <tr>
                    <td>Par</td>
                    <td>{formatQty(selectedItem, selectedItem.par)}</td>
                  </tr>
                  <tr>
                    <td>Book</td>
                    <td>{formatQty(selectedItem, selectedItem.book)}</td>
                  </tr>
                  <tr>
                    <td>Open PO</td>
                    <td>{formatQty(selectedItem, selectedItem.po)}</td>
                  </tr>
                  <tr>
                    <td>Reorder pt</td>
                    <td>{formatQty(selectedItem, selectedItem.rp)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="dash" />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span className="lbl">Suggest</span>
                <b className="num" style={{ fontSize: 20 }}>
                  {formatQty(selectedItem, suggestedReorder)}
                </b>
              </div>
              <p className="gloss" style={{ margin: '6px 0 0' }}>
                {selectedItem.book <= selectedItem.rp
                  ? 'Book is at or below the reorder point.'
                  : 'Above reorder point, no action needed.'}{' '}
                Par and reorder point are [Owner to set]; values shown are sample.
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
