'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { STORE_NAMES } from '@/components/ui/store-switcher';

/**
 * F19: Viewer / Internal Audit Reports Suite
 *
 * Dedicated read-only reporting suite for internal auditor and Viewer role:
 * - Report 1: Daily Physical Usage & ADU Report (Rolling N Days actual consumption)
 * - Report 2: Shift Handover & Key Custody Logbook
 * - Report 3: Reconciliation Variance History & Escalations
 * - Export to CSV / JSON (Quantities and operational identifiers only).
 *
 * NON-NEGOTIABLE COMPLIANCE:
 * - Physical inventory quantities only.
 * - Zero commercial, monetary, financial, or procurement trade metrics.
 */

export type ReportType = 'usage_adu' | 'custody_logbook' | 'reconciliation_variances';
export type RollingDays = 7 | 14 | 30;

export interface PhysicalUsageRecord {
  itemCode: string;
  itemName: string;
  category: string;
  warehouseId: string;
  warehouseName: string;
  uom: 'kg' | 'pcs';
  openingBalance: number;
  totalReceived: number; // Inbound GRPO movements
  totalConsumption: number; // Actual kitchen/bar usage
  closingBalance: number; // Current book stock
  adu: number; // Average Daily Usage
  daysOfCover: number; // Closing / ADU
  velocity: 'HIGH' | 'MODERATE' | 'LOW';
}

export interface CustodyHandoverRecord {
  logId: string;
  timestamp: string;
  shiftType: 'MORNING_TO_DAY' | 'DAY_TO_EVENING' | 'EVENING_TO_MORNING';
  warehouseId: string;
  warehouseName: string;
  keyId: string;
  outgoingCustodian: string;
  incomingHolder: string;
  physicalKeyHanded: boolean;
  locksInspected: boolean;
  perimeterSecure: boolean;
  signatureHash: string;
  status: 'VERIFIED' | 'EMERGENCY_OVERRIDE' | 'AUDITED';
  notes: string;
}

export interface CustodyAccessEventRecord {
  eventId: string;
  timestamp: string;
  warehouseName: string;
  actorName: string;
  actorRole: string;
  eventType: 'WINDOW_UNLOCK' | 'WINDOW_LOCK' | 'URGENT_ACCESS';
  reason: string;
  auditFlag: 'NORMAL' | 'SECURITY_REVIEW';
}

export interface ReconciliationVarianceRecord {
  recordId: string;
  sessionId: string;
  balanceDate: string;
  warehouseName: string;
  itemCode: string;
  itemName: string;
  uom: 'kg' | 'pcs';
  bookQty: number;
  countedQty: number;
  varianceQty: number; // Counted - Book
  variancePct: number;
  causeCode:
    | 'Trimming or prep loss'
    | 'Spoilage or damaged'
    | 'Weighing tolerance'
    | 'Portioning variance'
    | 'Unexplained discrepancy';
  custodianName: string;
  responsiblePerson: string;
  escalationStatus: 'BALANCED' | 'UNDER_REVIEW' | 'ESCALATED_TO_FC' | 'FC_APPROVED';
  adjustmentVoucherId: string | null;
  signoffNotes: string;
}

// Data fixtures for Report 1: Daily Physical Usage & ADU
const SEED_USAGE_RECORDS_7D: PhysicalUsageRecord[] = [
  {
    itemCode: 'RM-MOZ-01',
    itemName: 'Mozzarella block',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    openingBalance: 65.0,
    totalReceived: 50.0,
    totalConsumption: 72.5,
    closingBalance: 42.5,
    adu: 10.36,
    daysOfCover: 4.1,
    velocity: 'HIGH',
  },
  {
    itemCode: 'RM-BAS-01',
    itemName: 'Fresh sweet basil',
    category: 'Produce',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    openingBalance: 5.5,
    totalReceived: 10.0,
    totalConsumption: 12.3,
    closingBalance: 3.2,
    adu: 1.76,
    daysOfCover: 1.8,
    velocity: 'HIGH',
  },
  {
    itemCode: 'RM-BUR-01',
    itemName: 'Burrata Artisanal',
    category: 'Cheese',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'pcs',
    openingBalance: 32.0,
    totalReceived: 24.0,
    totalConsumption: 38.0,
    closingBalance: 18.0,
    adu: 5.43,
    daysOfCover: 3.3,
    velocity: 'HIGH',
  },
  {
    itemCode: 'RM-CHK-01',
    itemName: 'Chicken breast marinated',
    category: 'Meat',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    openingBalance: 40.0,
    totalReceived: 30.0,
    totalConsumption: 44.0,
    closingBalance: 26.0,
    adu: 6.29,
    daysOfCover: 4.1,
    velocity: 'MODERATE',
  },
  {
    itemCode: 'RM-DOU-01',
    itemName: 'Pizza dough ball 220g',
    category: 'Bakery',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'pcs',
    openingBalance: 280.0,
    totalReceived: 350.0,
    totalConsumption: 490.0,
    closingBalance: 140.0,
    adu: 70.0,
    daysOfCover: 2.0,
    velocity: 'HIGH',
  },
  {
    itemCode: 'RM-SAL-01',
    itemName: 'Salmon fillet',
    category: 'Seafood',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    openingBalance: 14.5,
    totalReceived: 10.0,
    totalConsumption: 15.1,
    closingBalance: 9.4,
    adu: 2.16,
    daysOfCover: 4.4,
    velocity: 'MODERATE',
  },
  {
    itemCode: 'RM-PAR-01',
    itemName: 'Parma ham prosciutto',
    category: 'Meat',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    uom: 'kg',
    openingBalance: 7.2,
    totalReceived: 5.0,
    totalConsumption: 8.1,
    closingBalance: 4.1,
    adu: 1.16,
    daysOfCover: 3.5,
    velocity: 'MODERATE',
  },
  {
    itemCode: 'DS-FLO-00',
    itemName: 'Caputo 00 Flour',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'kg',
    openingBalance: 150.0,
    totalReceived: 100.0,
    totalConsumption: 165.0,
    closingBalance: 85.0,
    adu: 23.57,
    daysOfCover: 3.6,
    velocity: 'HIGH',
  },
  {
    itemCode: 'DS-PAS-01',
    itemName: 'San Marzano tomato passata',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'pcs',
    openingBalance: 60.0,
    totalReceived: 24.0,
    totalConsumption: 48.0,
    closingBalance: 36.0,
    adu: 6.86,
    daysOfCover: 5.2,
    velocity: 'MODERATE',
  },
  {
    itemCode: 'RM-OIL-01',
    itemName: 'Extra virgin olive oil',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'kg',
    openingBalance: 35.0,
    totalReceived: 15.0,
    totalConsumption: 26.0,
    closingBalance: 24.0,
    adu: 3.71,
    daysOfCover: 6.5,
    velocity: 'MODERATE',
  },
  {
    itemCode: 'RM-YST-01',
    itemName: 'Active dry yeast',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'kg',
    openingBalance: 3.5,
    totalReceived: 2.0,
    totalConsumption: 3.4,
    closingBalance: 2.1,
    adu: 0.49,
    daysOfCover: 4.3,
    velocity: 'LOW',
  },
  {
    itemCode: 'RM-SLT-01',
    itemName: 'Coarse sea salt',
    category: 'Dry Goods',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    uom: 'kg',
    openingBalance: 28.0,
    totalReceived: 10.0,
    totalConsumption: 13.0,
    closingBalance: 25.0,
    adu: 1.86,
    daysOfCover: 13.4,
    velocity: 'LOW',
  },
];

// Data fixtures for Report 2: Shift Handover & Key Custody Logbook
const SEED_HANDOVERS: CustodyHandoverRecord[] = [
  {
    logId: 'SH-2026-1103-01',
    timestamp: '2026-11-03 06:15 UTC',
    shiftType: 'MORNING_TO_DAY',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    keyId: 'KEY-DEL01-COLD',
    outgoingCustodian: 'Rajesh Kumar (Night Duty)',
    incomingHolder: 'Arun Verma (Cold Room Custodian)',
    physicalKeyHanded: true,
    locksInspected: true,
    perimeterSecure: true,
    signatureHash: 'sig_sha256_8f14b2d19e',
    status: 'VERIFIED',
    notes: 'Morning shift opening inspection clear. Seals intact.',
  },
  {
    logId: 'SH-2026-1102-03',
    timestamp: '2026-11-02 22:30 UTC',
    shiftType: 'EVENING_TO_MORNING',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    keyId: 'KEY-DEL01-COLD',
    outgoingCustodian: 'Vikram Singh (Evening Lead)',
    incomingHolder: 'Rajesh Kumar (Night Duty)',
    physicalKeyHanded: true,
    locksInspected: true,
    perimeterSecure: true,
    signatureHash: 'sig_sha256_7a391c4d0b',
    status: 'VERIFIED',
    notes: 'Evening shift closeout completed. Door locked and logged.',
  },
  {
    logId: 'SH-2026-1102-02',
    timestamp: '2026-11-02 14:05 UTC',
    shiftType: 'DAY_TO_EVENING',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    keyId: 'KEY-DEL01-COLD',
    outgoingCustodian: 'Arun Verma (Cold Room Custodian)',
    incomingHolder: 'Vikram Singh (Evening Lead)',
    physicalKeyHanded: true,
    locksInspected: true,
    perimeterSecure: true,
    signatureHash: 'sig_sha256_4e819b02cc',
    status: 'VERIFIED',
    notes: 'Routine mid-day handover. All physical stock bins secured.',
  },
  {
    logId: 'SH-2026-1102-01',
    timestamp: '2026-11-02 06:10 UTC',
    shiftType: 'MORNING_TO_DAY',
    warehouseId: 'WH-DEL01-DRY',
    warehouseName: 'Dry Store',
    keyId: 'KEY-DEL01-DRY',
    outgoingCustodian: 'Night Guard Desk',
    incomingHolder: 'Deepak Sharma (Dry Store Custodian)',
    physicalKeyHanded: true,
    locksInspected: true,
    perimeterSecure: true,
    signatureHash: 'sig_sha256_2c99a71e83',
    status: 'VERIFIED',
    notes: 'Dry Store morning unlock. Padlock tamper seal intact.',
  },
  {
    logId: 'SH-2026-1101-04',
    timestamp: '2026-11-01 23:45 UTC',
    shiftType: 'EVENING_TO_MORNING',
    warehouseId: 'WH-DEL01-COLD',
    warehouseName: 'Cold Room',
    keyId: 'KEY-DEL01-COLD',
    outgoingCustodian: 'Vikram Singh (Evening Lead)',
    incomingHolder: 'Rajesh Kumar (Night Duty)',
    physicalKeyHanded: true,
    locksInspected: true,
    perimeterSecure: true,
    signatureHash: 'sig_sha256_9d042fa118',
    status: 'VERIFIED',
    notes: 'End of month cycle close. Physical count room locked.',
  },
];

const SEED_ACCESS_EVENTS: CustodyAccessEventRecord[] = [
  {
    eventId: 'EV-8801',
    timestamp: '2026-11-03 06:15 UTC',
    warehouseName: 'Cold Room',
    actorName: 'Arun Verma',
    actorRole: 'Cold Room Custodian',
    eventType: 'WINDOW_UNLOCK',
    reason: 'Scheduled morning issue window opening',
    auditFlag: 'NORMAL',
  },
  {
    eventId: 'EV-8798',
    timestamp: '2026-11-02 17:15 UTC',
    warehouseName: 'Cold Room',
    actorName: 'Vikram Singh',
    actorRole: 'Restaurant Manager',
    eventType: 'URGENT_ACCESS',
    reason: 'Dinner rush unexpected mozzarella dough restock',
    auditFlag: 'SECURITY_REVIEW',
  },
  {
    eventId: 'EV-8795',
    timestamp: '2026-11-02 11:30 UTC',
    warehouseName: 'Cold Room',
    actorName: 'Arun Verma',
    actorRole: 'Cold Room Custodian',
    eventType: 'WINDOW_LOCK',
    reason: 'Scheduled morning window closeout',
    auditFlag: 'NORMAL',
  },
  {
    eventId: 'EV-8790',
    timestamp: '2026-11-02 08:30 UTC',
    warehouseName: 'Dry Store',
    actorName: 'Deepak Sharma',
    actorRole: 'Dry Store Custodian',
    eventType: 'WINDOW_UNLOCK',
    reason: 'Inbound flour replenishment staging',
    auditFlag: 'NORMAL',
  },
];

// Data fixtures for Report 3: Reconciliation Variance History & Escalations
const SEED_VARIANCES: ReconciliationVarianceRecord[] = [
  {
    recordId: 'VAR-2026-1102-01',
    sessionId: 'BAL-2026-1102-COLD',
    balanceDate: '2026-11-02',
    warehouseName: 'Cold Room',
    itemCode: 'RM-BAS-01',
    itemName: 'Fresh sweet basil',
    uom: 'kg',
    bookQty: 3.2,
    countedQty: 3.0,
    varianceQty: -0.2,
    variancePct: -6.25,
    causeCode: 'Trimming or prep loss',
    custodianName: 'Arun Verma',
    responsiblePerson: 'Kitchen Lead',
    escalationStatus: 'ESCALATED_TO_FC',
    adjustmentVoucherId: 'ADJ-2026-041',
    signoffNotes: 'Trimming and scrap stems verified at salad prep station. Recount matched 3.0 kg.',
  },
  {
    recordId: 'VAR-2026-1101-02',
    sessionId: 'BAL-2026-1101-COLD',
    balanceDate: '2026-11-01',
    warehouseName: 'Cold Room',
    itemCode: 'RM-SAL-01',
    itemName: 'Salmon fillet',
    uom: 'kg',
    bookQty: 12.5,
    countedQty: 9.4,
    varianceQty: -3.1,
    variancePct: -24.8,
    causeCode: 'Spoilage or damaged',
    custodianName: 'Arun Verma',
    responsiblePerson: 'Sous Chef',
    escalationStatus: 'FC_APPROVED',
    adjustmentVoucherId: 'ADJ-2026-038',
    signoffNotes: 'Lot L-SAL-1027 expired and locked. Quarantine waste disposal confirmed by FC.',
  },
  {
    recordId: 'VAR-2026-1031-03',
    sessionId: 'CNT-2026-1031-DRY',
    balanceDate: '2026-10-31',
    warehouseName: 'Dry Store',
    itemCode: 'DS-FLO-00',
    itemName: 'Caputo 00 Flour',
    uom: 'kg',
    bookQty: 90.0,
    countedQty: 85.0,
    varianceQty: -5.0,
    variancePct: -5.55,
    causeCode: 'Weighing tolerance',
    custodianName: 'Deepak Sharma',
    responsiblePerson: 'Pizza Station Chef',
    escalationStatus: 'BALANCED',
    adjustmentVoucherId: null,
    signoffNotes: 'Humidity dusting and atmospheric loss during bulk dough mixing.',
  },
  {
    recordId: 'VAR-2026-1030-04',
    sessionId: 'BAL-2026-1030-COLD',
    balanceDate: '2026-10-30',
    warehouseName: 'Cold Room',
    itemCode: 'RM-BUR-01',
    itemName: 'Burrata Artisanal',
    uom: 'pcs',
    bookQty: 20.0,
    countedQty: 18.0,
    varianceQty: -2.0,
    variancePct: -10.0,
    causeCode: 'Portioning variance',
    custodianName: 'Arun Verma',
    responsiblePerson: 'Appetizer Station',
    escalationStatus: 'UNDER_REVIEW',
    adjustmentVoucherId: null,
    signoffNotes: 'Two broken brine containers during walk-in transfer. Incident report filed.',
  },
  {
    recordId: 'VAR-2026-1028-05',
    sessionId: 'BAL-2026-1028-DRY',
    balanceDate: '2026-10-28',
    warehouseName: 'Dry Store',
    itemCode: 'DS-PAS-01',
    itemName: 'San Marzano tomato passata',
    uom: 'pcs',
    bookQty: 40.0,
    countedQty: 36.0,
    varianceQty: -4.0,
    variancePct: -10.0,
    causeCode: 'Unexplained discrepancy',
    custodianName: 'Deepak Sharma',
    responsiblePerson: 'Store Accountant',
    escalationStatus: 'ESCALATED_TO_FC',
    adjustmentVoucherId: 'ADJ-2026-035',
    signoffNotes: 'Audit discrepancy investigated across 4 shift handover logs. Escalated to FC.',
  },
];

export default function AuditReportsPage() {
  const { role, roleConfig, store, showToast } = useShell();

  // Active report tab
  const [activeReport, setActiveReport] = useState<ReportType>('usage_adu');

  // Rolling days selection (for Report 1)
  const [rollingDays, setRollingDays] = useState<RollingDays>(7);

  // Storeroom filter
  const [selectedWarehouse, setSelectedWarehouse] = useState<'ALL' | 'COLD' | 'DRY'>('ALL');

  // Search input query
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected variance record for inspector ticket
  const [selectedVarianceId, setSelectedVarianceId] = useState<string>('VAR-2026-1102-01');

  const storeTitle = STORE_NAMES[store] || store;

  // Filtered physical usage records (Report 1)
  const filteredUsage = useMemo(() => {
    return SEED_USAGE_RECORDS_7D.filter((item) => {
      // Storeroom filter
      if (selectedWarehouse === 'COLD' && !item.warehouseId.includes('COLD')) return false;
      if (selectedWarehouse === 'DRY' && !item.warehouseId.includes('DRY')) return false;

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
  }, [selectedWarehouse, searchQuery]);

  // Filtered shift handovers (Report 2)
  const filteredHandovers = useMemo(() => {
    return SEED_HANDOVERS.filter((h) => {
      if (selectedWarehouse === 'COLD' && !h.warehouseId.includes('COLD')) return false;
      if (selectedWarehouse === 'DRY' && !h.warehouseId.includes('DRY')) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = h.logId.toLowerCase().includes(q);
        const matchesKey = h.keyId.toLowerCase().includes(q);
        const matchesOut = h.outgoingCustodian.toLowerCase().includes(q);
        const matchesIn = h.incomingHolder.toLowerCase().includes(q);
        if (!matchesId && !matchesKey && !matchesOut && !matchesIn) return false;
      }

      return true;
    });
  }, [selectedWarehouse, searchQuery]);

  // Filtered variances (Report 3)
  const filteredVariances = useMemo(() => {
    return SEED_VARIANCES.filter((v) => {
      if (selectedWarehouse === 'COLD' && !v.warehouseName.includes('Cold')) return false;
      if (selectedWarehouse === 'DRY' && !v.warehouseName.includes('Dry')) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = v.recordId.toLowerCase().includes(q);
        const matchesCode = v.itemCode.toLowerCase().includes(q);
        const matchesName = v.itemName.toLowerCase().includes(q);
        const matchesCause = v.causeCode.toLowerCase().includes(q);
        if (!matchesId && !matchesCode && !matchesName && !matchesCause) return false;
      }

      return true;
    });
  }, [selectedWarehouse, searchQuery]);

  // Currently inspected variance item
  const inspectedVariance = useMemo(() => {
    return (
      filteredVariances.find((v) => v.recordId === selectedVarianceId) ||
      filteredVariances[0] ||
      SEED_VARIANCES[0]
    );
  }, [filteredVariances, selectedVarianceId]);

  // Export current active report as CSV (Quantities only!)
  const handleExportCsv = useCallback(() => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let reportFilename = '';

    if (activeReport === 'usage_adu') {
      reportFilename = `report1-physical-usage-rolling-${rollingDays}d-${store}`;
      headers = [
        'Item Code',
        'Item Name',
        'Category',
        'Storeroom',
        'UoM',
        'Opening Balance',
        'Total Received (GRPO)',
        'Total Physical Consumption',
        'Closing Book Stock',
        'Rolling ADU',
        'Days of Cover',
        'Usage Velocity',
      ];
      rows = filteredUsage.map((r) => [
        `"${r.itemCode}"`,
        `"${r.itemName}"`,
        `"${r.category}"`,
        `"${r.warehouseName}"`,
        `"${r.uom}"`,
        r.openingBalance,
        r.totalReceived,
        r.totalConsumption,
        r.closingBalance,
        r.adu,
        r.daysOfCover,
        `"${r.velocity}"`,
      ]);
    } else if (activeReport === 'custody_logbook') {
      reportFilename = `report2-shift-custody-logbook-${store}`;
      headers = [
        'Log ID',
        'Timestamp',
        'Shift Type',
        'Storeroom',
        'Physical Key ID',
        'Outgoing Custodian',
        'Incoming Key Holder',
        'Physical Key Handed',
        'Locks Inspected',
        'Perimeter Secure',
        'Signature Hash',
        'Status',
        'Notes',
      ];
      rows = filteredHandovers.map((h) => [
        `"${h.logId}"`,
        `"${h.timestamp}"`,
        `"${h.shiftType}"`,
        `"${h.warehouseName}"`,
        `"${h.keyId}"`,
        `"${h.outgoingCustodian}"`,
        `"${h.incomingHolder}"`,
        h.physicalKeyHanded ? 'YES' : 'NO',
        h.locksInspected ? 'YES' : 'NO',
        h.perimeterSecure ? 'YES' : 'NO',
        `"${h.signatureHash}"`,
        `"${h.status}"`,
        `"${h.notes.replace(/"/g, '""')}"`,
      ]);
    } else {
      reportFilename = `report3-reconciliation-variances-${store}`;
      headers = [
        'Record ID',
        'Session ID',
        'Balance Date',
        'Storeroom',
        'Item Code',
        'Item Name',
        'UoM',
        'Book Qty',
        'Counted Qty',
        'Variance Qty',
        'Variance Percentage',
        'Cause Code',
        'Custodian',
        'Responsible Person',
        'Escalation Status',
        'Adjustment Voucher ID',
        'Signoff Notes',
      ];
      rows = filteredVariances.map((v) => [
        `"${v.recordId}"`,
        `"${v.sessionId}"`,
        `"${v.balanceDate}"`,
        `"${v.warehouseName}"`,
        `"${v.itemCode}"`,
        `"${v.itemName}"`,
        `"${v.uom}"`,
        v.bookQty,
        v.countedQty,
        v.varianceQty,
        `${v.variancePct}%`,
        `"${v.causeCode}"`,
        `"${v.custodianName}"`,
        `"${v.responsiblePerson}"`,
        `"${v.escalationStatus}"`,
        `"${v.adjustmentVoucherId || 'N/A'}"`,
        `"${v.signoffNotes.replace(/"/g, '""')}"`,
      ]);
    }

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${reportFilename}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Audit report exported as CSV (quantities only).');
  }, [activeReport, rollingDays, store, filteredUsage, filteredHandovers, filteredVariances, showToast]);

  // Export current active report as JSON (Quantities only!)
  const handleExportJson = useCallback(() => {
    let exportData: unknown = null;
    let reportFilename = '';

    if (activeReport === 'usage_adu') {
      reportFilename = `report1-physical-usage-rolling-${rollingDays}d-${store}`;
      exportData = {
        report: 'Daily Physical Usage & ADU Report',
        storeId: store,
        rollingDays,
        generatedAt: new Date().toISOString(),
        compliance: 'Quantities only. Zero commercial metrics.',
        records: filteredUsage,
      };
    } else if (activeReport === 'custody_logbook') {
      reportFilename = `report2-shift-custody-logbook-${store}`;
      exportData = {
        report: 'Shift Handover & Key Custody Logbook',
        storeId: store,
        generatedAt: new Date().toISOString(),
        compliance: 'Physical key verification logs only.',
        records: filteredHandovers,
        accessEvents: SEED_ACCESS_EVENTS,
      };
    } else {
      reportFilename = `report3-reconciliation-variances-${store}`;
      exportData = {
        report: 'Reconciliation Variance History & Escalations',
        storeId: store,
        generatedAt: new Date().toISOString(),
        compliance: 'Physical count discrepancies only.',
        records: filteredVariances,
      };
    }

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${reportFilename}-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Audit report exported as JSON (quantities only).');
  }, [activeReport, rollingDays, store, filteredUsage, filteredHandovers, filteredVariances, showToast]);

  return (
    <>
      {store !== 'IND-DEL-01' && (
        <div className="note am" style={{ marginBottom: 16 }}>
          Prototype displays verified audit logs for store {store}.
        </div>
      )}

      {/* Header */}
      <div className="head">
        <div>
          <div className="kicker">
            Store {store} &middot; {storeTitle} &middot; Compliance &amp; Internal Audit
          </div>
          <h1 className="h1">
            Audit Reports,{' '}
            <em>Ledger Verification &amp; Control Logs.</em>
          </h1>
          <p className="sub">
            Dedicated read-only reporting suite for internal auditors, Store Accountants, and
            Controllers. Verifies append-only movements, key custody transfers, and reconciliation
            variances.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span className="stamp">AUDITOR SUITE</span>
          <span className="meta">Read-Only Mode &middot; Role: {roleConfig.l}</span>
        </div>
      </div>

      {/* Compliance / Read-Only Banner */}
      <div className="win" style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}>
        <span className="lbl" style={{ color: 'var(--navy)' }}>
          IMMUTABLE LEDGER VERIFICATION
        </span>
        <Badge variant="ok">Audit Locked</Badge>
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          All reports reflect append-only physical records. Modification and manual overwrites are
          cryptographically prevented.
        </span>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          Physical inventory quantities only &middot; Zero commercial metrics
        </span>
      </div>

      {/* Report Switcher & Global Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          background: 'var(--sand)',
          padding: '12px 18px',
          borderRadius: 4,
          border: '1px solid var(--rule)',
          marginBottom: 20,
        }}
      >
        {/* Report Tabs */}
        <div className="seg" role="group" aria-label="Report Suite Selection">
          <button
            type="button"
            className={activeReport === 'usage_adu' ? 'on' : ''}
            onClick={() => setActiveReport('usage_adu')}
          >
            1. Daily Usage &amp; ADU
          </button>
          <button
            type="button"
            className={activeReport === 'custody_logbook' ? 'on' : ''}
            onClick={() => setActiveReport('custody_logbook')}
          >
            2. Shift Custody Logbook
          </button>
          <button
            type="button"
            className={activeReport === 'reconciliation_variances' ? 'on' : ''}
            onClick={() => setActiveReport('reconciliation_variances')}
          >
            3. Variances &amp; Escalations
          </button>
        </div>

        {/* Secondary Filters */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Rolling window selector (Only for Report 1) */}
          {activeReport === 'usage_adu' && (
            <div className="seg" role="group" aria-label="Rolling Window Period">
              <button
                type="button"
                className={rollingDays === 7 ? 'on' : ''}
                onClick={() => setRollingDays(7)}
              >
                Rolling 7d
              </button>
              <button
                type="button"
                className={rollingDays === 14 ? 'on' : ''}
                onClick={() => setRollingDays(14)}
              >
                Rolling 14d
              </button>
              <button
                type="button"
                className={rollingDays === 30 ? 'on' : ''}
                onClick={() => setRollingDays(30)}
              >
                Rolling 30d
              </button>
            </div>
          )}

          {/* Storeroom Selector */}
          <div className="seg" role="group" aria-label="Storeroom Filter">
            <button
              type="button"
              className={selectedWarehouse === 'ALL' ? 'on' : ''}
              onClick={() => setSelectedWarehouse('ALL')}
            >
              All
            </button>
            <button
              type="button"
              className={selectedWarehouse === 'COLD' ? 'on' : ''}
              onClick={() => setSelectedWarehouse('COLD')}
            >
              Cold Room
            </button>
            <button
              type="button"
              className={selectedWarehouse === 'DRY' ? 'on' : ''}
              onClick={() => setSelectedWarehouse('DRY')}
            >
              Dry Store
            </button>
          </div>

          {/* Search Box */}
          <input
            type="search"
            aria-label="Search report lines"
            placeholder="Search records..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="in"
            style={{ width: 180, margin: 0, padding: '5px 10px', fontSize: 13 }}
          />

          {/* Export Actions */}
          <button
            type="button"
            className="btn ghost sm"
            onClick={handleExportCsv}
            title="Download CSV report (Quantities only)"
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={handleExportJson}
            title="Download JSON report (Quantities only)"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* REPORT 1: Daily Physical Usage & ADU Report                  */}
      {/* ============================================================ */}
      {activeReport === 'usage_adu' && (
        <div className="stack">
          {/* Metric Tiles */}
          <div className="tiles">
            <div className="tile">
              <span className="lbl">Items Monitored</span>
              <span className="big">{filteredUsage.length}</span>
              <span className="s">Across Cold Room &amp; Dry Store</span>
            </div>
            <div className="tile">
              <span className="lbl">Total Consumption ({rollingDays}d)</span>
              <span className="big" style={{ color: 'var(--forest)' }}>
                {filteredUsage
                  .filter((u) => u.uom === 'kg')
                  .reduce((sum, u) => sum + u.totalConsumption, 0)
                  .toFixed(1)}{' '}
                <span style={{ fontSize: 18 }}>kg</span>
              </span>
              <span className="s">
                Plus{' '}
                {filteredUsage
                  .filter((u) => u.uom === 'pcs')
                  .reduce((sum, u) => sum + u.totalConsumption, 0)}{' '}
                pcs kitchen issues
              </span>
            </div>
            <div className="tile">
              <span className="lbl">Fast Moving (High ADU)</span>
              <span className="big" style={{ color: 'var(--terra)' }}>
                {filteredUsage.filter((u) => u.velocity === 'HIGH').length}
              </span>
              <span className="s">Rapid turnover items</span>
            </div>
            <div className="tile">
              <span className="lbl">Critical Cover (&lt; 2d)</span>
              <span className="big" style={{ color: 'var(--err)' }}>
                {filteredUsage.filter((u) => u.daysOfCover < 2.0).length}
              </span>
              <span className="s">Replenishment priority items</span>
            </div>
          </div>

          <Ticket
            no={`REP-01 · DAILY PHYSICAL USAGE & ADU (ROLLING ${rollingDays} DAYS)`}
            right={
              <span className="meta">
                Formula: Opening + Receipts &minus; Closing = Consumption
              </span>
            }
          >
            <div style={{ marginBottom: 12 }}>
              <span className="gloss">
                Average Daily Usage (ADU) = Total Actual Consumption over Rolling {rollingDays} Days /{' '}
                {rollingDays} Days. Days of Cover = Current Book Stock / ADU.
              </span>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Item Code &amp; Description</th>
                  <th>Storeroom</th>
                  <th>UoM</th>
                  <th className="num">Opening ({rollingDays}d ago)</th>
                  <th className="num">Inbound Receipts</th>
                  <th className="num">Physical Consumption</th>
                  <th className="num">Current Stock</th>
                  <th className="num">Rolling ADU</th>
                  <th className="num">Days of Cover</th>
                  <th>Velocity</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsage.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '24px 0' }}>
                      <span className="ro">No records match current filters.</span>
                    </td>
                  </tr>
                ) : (
                  filteredUsage.map((item) => {
                    const isCriticalCover = item.daysOfCover < 2.0;
                    const isWarningCover = item.daysOfCover >= 2.0 && item.daysOfCover <= 5.0;

                    return (
                      <tr key={item.itemCode} className="row">
                        <td>
                          <b>{item.itemName}</b>
                          <br />
                          <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            {item.itemCode} &middot; {item.category}
                          </span>
                        </td>
                        <td className="m">{item.warehouseName}</td>
                        <td className="m">{item.uom}</td>
                        <td className="num m">
                          {item.uom === 'kg' ? item.openingBalance.toFixed(1) : item.openingBalance}
                        </td>
                        <td className="num m" style={{ color: 'var(--forest)' }}>
                          +{item.uom === 'kg' ? item.totalReceived.toFixed(1) : item.totalReceived}
                        </td>
                        <td className="num m" style={{ color: 'var(--terra)', fontWeight: 600 }}>
                          &minus;
                          {item.uom === 'kg'
                            ? item.totalConsumption.toFixed(1)
                            : item.totalConsumption}
                        </td>
                        <td className="num">
                          <b>
                            {item.uom === 'kg'
                              ? item.closingBalance.toFixed(1)
                              : item.closingBalance}
                          </b>
                        </td>
                        <td className="num m">
                          <b>{item.adu.toFixed(2)}</b> /day
                        </td>
                        <td className="num">
                          <span
                            style={{
                              fontFamily: 'var(--mono)',
                              fontWeight: 700,
                              color: isCriticalCover
                                ? 'var(--err)'
                                : isWarningCover
                                ? 'var(--amber)'
                                : 'var(--forest)',
                            }}
                          >
                            {item.daysOfCover.toFixed(1)} days
                          </span>
                        </td>
                        <td>
                          {item.velocity === 'HIGH' && <Badge variant="er">HIGH VELOCITY</Badge>}
                          {item.velocity === 'MODERATE' && (
                            <Badge variant="re">MODERATE</Badge>
                          )}
                          {item.velocity === 'LOW' && <Badge variant="ok">LOW</Badge>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </Ticket>
        </div>
      )}

      {/* ============================================================ */}
      {/* REPORT 2: Shift Handover & Key Custody Logbook               */}
      {/* ============================================================ */}
      {activeReport === 'custody_logbook' && (
        <div className="cols c-ov">
          <div className="stack">
            <Ticket
              no="REP-02 · PHYSICAL KEY CUSTODY & SHIFT HANDOVER LOG"
              right={<span className="meta">{filteredHandovers.length} shifts recorded</span>}
            >
              <div style={{ marginBottom: 14 }}>
                <span className="gloss">
                  Immutable audit trail of physical key custody, door perimeter security checks, and
                  tamper seal inspections between outgoing and incoming custodians.
                </span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Log ID &amp; Timestamp</th>
                    <th>Shift Type</th>
                    <th>Storeroom / Key ID</th>
                    <th>Outgoing Custodian</th>
                    <th>Incoming Key Holder</th>
                    <th>Physical Checks</th>
                    <th>Signature Hash</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHandovers.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '24px 0' }}>
                        <span className="ro">No shift records found.</span>
                      </td>
                    </tr>
                  ) : (
                    filteredHandovers.map((h) => (
                      <tr key={h.logId} className="row">
                        <td>
                          <b>{h.logId}</b>
                          <br />
                          <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            {h.timestamp}
                          </span>
                        </td>
                        <td className="m">
                          {h.shiftType === 'MORNING_TO_DAY' && 'Morning &rarr; Day'}
                          {h.shiftType === 'DAY_TO_EVENING' && 'Day &rarr; Evening'}
                          {h.shiftType === 'EVENING_TO_MORNING' && 'Evening &rarr; Morning'}
                        </td>
                        <td className="m">
                          <b>{h.warehouseName}</b>
                          <br />
                          <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{h.keyId}</span>
                        </td>
                        <td>{h.outgoingCustodian}</td>
                        <td>
                          <b>{h.incomingHolder}</b>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <span
                            title="Physical Key Handed, Lock Inspected, Perimeter Secure"
                            style={{ color: 'var(--forest)', fontWeight: 600 }}
                          >
                            &#10003; Key &#10003; Locks &#10003; Perimeter
                          </span>
                        </td>
                        <td className="m" style={{ fontSize: 11, color: 'var(--blue)' }}>
                          {h.signatureHash}
                        </td>
                        <td>
                          {h.status === 'VERIFIED' && <Badge variant="ok">VERIFIED</Badge>}
                          {h.status === 'EMERGENCY_OVERRIDE' && (
                            <Badge variant="er">OVERRIDE</Badge>
                          )}
                          {h.status === 'AUDITED' && <Badge variant="re">AUDITED</Badge>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Ticket>

            {/* Door & Window Unlocking Events Log */}
            <Ticket
              no="REP-02B · ACCESS WINDOW & UNLOCKING EVENTS"
              right={<span className="meta">{SEED_ACCESS_EVENTS.length} events logged</span>}
            >
              <table>
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Timestamp</th>
                    <th>Storeroom</th>
                    <th>Actor &amp; Role</th>
                    <th>Action</th>
                    <th>Stated Reason</th>
                    <th>Audit Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {SEED_ACCESS_EVENTS.map((ev) => (
                    <tr key={ev.eventId} className="row">
                      <td className="m">
                        <b>{ev.eventId}</b>
                      </td>
                      <td className="m">{ev.timestamp}</td>
                      <td>{ev.warehouseName}</td>
                      <td>
                        <b>{ev.actorName}</b>
                        <br />
                        <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {ev.actorRole}
                        </span>
                      </td>
                      <td>
                        {ev.eventType === 'WINDOW_UNLOCK' && <Badge variant="ok">WINDOW UNLOCK</Badge>}
                        {ev.eventType === 'WINDOW_LOCK' && <Badge variant="mu">WINDOW LOCK</Badge>}
                        {ev.eventType === 'URGENT_ACCESS' && (
                          <Badge variant="er">URGENT ACCESS</Badge>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>{ev.reason}</td>
                      <td>
                        {ev.auditFlag === 'NORMAL' ? (
                          <span className="m" style={{ color: 'var(--forest)' }}>
                            PASS
                          </span>
                        ) : (
                          <Badge variant="am">SECURITY REVIEW</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Ticket>
          </div>

          <aside className="stack">
            <div className="stub w">
              <span className="lbl">Key Control Custody Policy</span>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                Physical storeroom keys may only reside with the designated shift custodian. Key
                transfer requires dual-party biometric or physical verification. Unscheduled door
                access triggers urgent security flags.
              </p>
              <div className="dash" />
              <div className="meta">Standard: SOP-SEC-01 &middot; Key Ring ID: KEY-DEL01-COLD</div>
            </div>

            <div className="stub">
              <span className="lbl" style={{ color: 'var(--terra)' }}>
                Auditor Verification Checklist
              </span>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                <li>No overlapping active key holders across shifts.</li>
                <li>All urgent access sessions contain recorded business justifications.</li>
                <li>Digital signatures cryptographically match ledger events.</li>
                <li>Zero missing lock inspections.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {/* ============================================================ */}
      {/* REPORT 3: Reconciliation Variance History & Escalations      */}
      {/* ============================================================ */}
      {activeReport === 'reconciliation_variances' && (
        <div className="cols c-ov">
          <div className="stack">
            {/* Stat Tiles */}
            <div className="tiles">
              <div className="tile">
                <span className="lbl">Variance Records</span>
                <span className="big">{filteredVariances.length}</span>
                <span className="s">Historical discrepancies</span>
              </div>
              <div className="tile">
                <span className="lbl">Escalated to FC</span>
                <span className="big" style={{ color: 'var(--err)' }}>
                  {
                    filteredVariances.filter(
                      (v) => v.escalationStatus === 'ESCALATED_TO_FC' || v.escalationStatus === 'FC_APPROVED'
                    ).length
                  }
                </span>
                <span className="s">Controller review required</span>
              </div>
              <div className="tile">
                <span className="lbl">Under Review</span>
                <span className="big" style={{ color: 'var(--amber)' }}>
                  {filteredVariances.filter((v) => v.escalationStatus === 'UNDER_REVIEW').length}
                </span>
                <span className="s">Pending root-cause investigation</span>
              </div>
              <div className="tile">
                <span className="lbl">Resolved &amp; Balanced</span>
                <span className="big" style={{ color: 'var(--forest)' }}>
                  {filteredVariances.filter((v) => v.escalationStatus === 'BALANCED').length}
                </span>
                <span className="s">Variance explained within tolerance</span>
              </div>
            </div>

            <Ticket
              no="REP-03 · RECONCILIATION VARIANCE AUDIT TRAIL"
              right={<span className="meta">Quantities &amp; Cause Codes</span>}
            >
              <table>
                <thead>
                  <tr>
                    <th>Date &amp; Session</th>
                    <th>Item</th>
                    <th>Storeroom</th>
                    <th className="num">Book Qty</th>
                    <th className="num">Counted</th>
                    <th className="num">Variance</th>
                    <th>Root Cause Code</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVariances.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '24px 0' }}>
                        <span className="ro">No variance records match current criteria.</span>
                      </td>
                    </tr>
                  ) : (
                    filteredVariances.map((v) => {
                      const isSelected = v.recordId === inspectedVariance?.recordId;
                      const isNegative = v.varianceQty < 0;

                      return (
                        <tr
                          key={v.recordId}
                          className={`row ${isSelected ? 'sel' : ''}`}
                          onClick={() => setSelectedVarianceId(v.recordId)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedVarianceId(v.recordId);
                            }
                          }}
                        >
                          <td>
                            <b>{v.balanceDate}</b>
                            <br />
                            <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              {v.sessionId}
                            </span>
                          </td>
                          <td>
                            <b>{v.itemName}</b>
                            <br />
                            <span className="m" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              {v.itemCode}
                            </span>
                          </td>
                          <td className="m">{v.warehouseName}</td>
                          <td className="num m">
                            {v.uom === 'kg' ? v.bookQty.toFixed(1) : v.bookQty} {v.uom}
                          </td>
                          <td className="num m">
                            <b>
                              {v.uom === 'kg' ? v.countedQty.toFixed(1) : v.countedQty} {v.uom}
                            </b>
                          </td>
                          <td className="num">
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontWeight: 700,
                                color: isNegative ? 'var(--err)' : 'var(--forest)',
                              }}
                            >
                              {v.varianceQty > 0 ? `+${v.varianceQty}` : v.varianceQty} {v.uom}
                              <br />
                              <span style={{ fontSize: 11, fontWeight: 500 }}>
                                ({v.variancePct > 0 ? `+${v.variancePct}` : v.variancePct}%)
                              </span>
                            </span>
                          </td>
                          <td style={{ fontSize: 13 }}>
                            <b>{v.causeCode}</b>
                            <br />
                            <span className="m" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                              Lead: {v.responsiblePerson}
                            </span>
                          </td>
                          <td>
                            {v.escalationStatus === 'BALANCED' && (
                              <Badge variant="ok">BALANCED</Badge>
                            )}
                            {v.escalationStatus === 'UNDER_REVIEW' && (
                              <Badge variant="am">UNDER REVIEW</Badge>
                            )}
                            {v.escalationStatus === 'ESCALATED_TO_FC' && (
                              <Badge variant="er">ESCALATED TO FC</Badge>
                            )}
                            {v.escalationStatus === 'FC_APPROVED' && (
                              <Badge variant="re">FC ADJUSTED</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Ticket>
          </div>

          {/* Right Aside: Variance Detail Inspector */}
          <aside className="stack">
            {inspectedVariance ? (
              <Ticket
                no={`INSPECTION · ${inspectedVariance.recordId}`}
                right={<Badge variant="re">{inspectedVariance.escalationStatus}</Badge>}
              >
                <div className="stub w" style={{ marginBottom: 14 }}>
                  <span className="lbl">Audit Item Details</span>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy)' }}>
                    {inspectedVariance.itemName}
                  </div>
                  <div className="meta" style={{ marginTop: 2 }}>
                    {inspectedVariance.itemCode} &middot; {inspectedVariance.warehouseName}
                  </div>
                </div>

                <div className="stub" style={{ marginBottom: 14 }}>
                  <span className="lbl" style={{ color: 'var(--terra)' }}>
                    Discrepancy Breakdown
                  </span>
                  <table className="dense tick">
                    <tbody>
                      <tr>
                        <td>Expected Book Qty</td>
                        <td className="num">
                          {inspectedVariance.uom === 'kg'
                            ? inspectedVariance.bookQty.toFixed(1)
                            : inspectedVariance.bookQty}{' '}
                          {inspectedVariance.uom}
                        </td>
                      </tr>
                      <tr>
                        <td>Counted Physical Qty</td>
                        <td className="num">
                          <b>
                            {inspectedVariance.uom === 'kg'
                              ? inspectedVariance.countedQty.toFixed(1)
                              : inspectedVariance.countedQty}{' '}
                            {inspectedVariance.uom}
                          </b>
                        </td>
                      </tr>
                      <tr style={{ borderTop: '1px dashed var(--rule)' }}>
                        <td>Discrepancy Variance</td>
                        <td className="num" style={{ color: 'var(--err)', fontWeight: 700 }}>
                          {inspectedVariance.varianceQty}{' '}
                          {inspectedVariance.uom} ({inspectedVariance.variancePct}%)
                        </td>
                      </tr>
                      <tr>
                        <td>Root Cause</td>
                        <td className="num">{inspectedVariance.causeCode}</td>
                      </tr>
                      <tr>
                        <td>Responsible Person</td>
                        <td className="num">{inspectedVariance.responsiblePerson}</td>
                      </tr>
                      {inspectedVariance.adjustmentVoucherId && (
                        <tr>
                          <td>Adjustment Voucher</td>
                          <td className="num" style={{ color: 'var(--blue)', fontWeight: 600 }}>
                            {inspectedVariance.adjustmentVoucherId}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="stub w" style={{ marginBottom: 14 }}>
                  <span className="lbl">Custodian Sign-Off Notes</span>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--navy)', fontStyle: 'italic' }}>
                    &ldquo;{inspectedVariance.signoffNotes}&rdquo;
                  </p>
                  <div className="meta" style={{ marginTop: 6 }}>
                    Recorded by {inspectedVariance.custodianName} &middot; Session{' '}
                    {inspectedVariance.sessionId}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        navigator.clipboard.writeText(
                          JSON.stringify(inspectedVariance, null, 2)
                        );
                        showToast(`Variance record copied: ${inspectedVariance.recordId}`);
                      }
                    }}
                  >
                    Copy Audit Record
                  </button>
                </div>
              </Ticket>
            ) : (
              <div className="stub w">
                <span className="lbl">Record Inspector</span>
                <p className="gloss">Select any variance row to view full root-cause audit details.</p>
              </div>
            )}

            <div className="stub w">
              <span className="lbl">Internal Audit Standard</span>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                Physical variances exceeding &plusmn;5% require mandatory written explanation from
                the section lead and approval by the Financial Controller before ledger adjustment
                vouchers may be posted.
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
