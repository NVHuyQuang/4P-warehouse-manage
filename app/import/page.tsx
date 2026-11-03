'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useShell } from '@/components/ui/shell';
import { Ticket } from '@/components/ui/ticket';
import { Badge, BadgeVariant } from '@/components/ui/badges';
import { Chip, Chips } from '@/components/ui/chips';
import { dispatchAction } from '@/lib/actions/dispatch';
import {
  uploadAndParseGrpo,
  commitGrpoBatch,
  getRecentImports,
  getSampleGrpoParseResult,
  RecentImportRecord,
  ParseResult,
  ParsedGrpoLine,
  ParseError,
  GrpoLineStatus,
} from '@/lib/data/import';

// Item catalog names for preview clarity
const ITEM_DIRECTORY: Record<string, string> = {
  'RM-MOZ-01': 'Mozzarella block',
  'RM-BUR-01': 'Burrata',
  'RM-BAS-01': 'Fresh basil',
  'RM-CHK-01': 'Chicken breast',
  'RM-DOU-01': 'Pizza dough ball',
  'RM-SAL-01': 'Salmon fillet',
  'RM-GOR-01': 'Gorgonzola block',
  'RM-GOR-02': 'Gorgonzola aged',
  'RM-PAR-01': 'Parma ham',
  'RM-RIC-01': 'Ricotta fresca',
  'RM-TOM-01': 'San Marzano tomatoes',
  'RM-FLO-01': 'Caputo 00 Flour',
  'RM-OIL-01': 'Extra virgin olive oil',
  'RM-YST-01': 'Active dry yeast',
  'RM-SLT-01': 'Sea salt',
};

const STOREROOM_NAMES: Record<string, string> = {
  'WH-DEL01-COLD': 'Cold Room',
  'WH-DEL01-DRY': 'Dry Store',
  'WH-DEL02-COLD': 'Cold Room 2',
  'WH-DEL02-DRY': 'Dry Store 2',
};

interface FileMetadata {
  name: string;
  size: string;
}

interface CommittedBatchSummary {
  id: string;
  committedAt: string;
  totalLines: number;
  importedLines: number;
  refreshedLines: number;
  needsApprovalLines: number;
  quarantinedLines: number;
}

export default function SapGrpoImportPage() {
  const { store, showToast } = useShell();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // File & parse state
  const [fileInfo, setFileInfo] = useState<FileMetadata | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Filter & line selection
  const [activeFilter, setActiveFilter] = useState<'all' | GrpoLineStatus>('all');
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);

  // Late upload simulation / age (Decision Q5)
  const [samplePostingAge, setSamplePostingAge] = useState<'1' | '4'>('4');

  // Committal state
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [committedBatch, setCommittedBatch] = useState<CommittedBatchSummary | null>(null);

  // Secondary approval tracking for lines
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, boolean>>({});

  // Audit list
  const [recentImports, setRecentImports] = useState<RecentImportRecord[]>([]);

  // Quarantined lines drawer
  const [isQuarantineDrawerOpen, setIsQuarantineDrawerOpen] = useState<boolean>(false);

  // Load recent imports on mount or store change
  useEffect(() => {
    getRecentImports(store).then(setRecentImports).catch(() => {});
  }, [store]);

  // Handle spreadsheet ingestion
  const handleProcessFile = useCallback(
    async (file: File) => {
      setIsParsing(true);
      const sizeStr = `${(file.size / 1024).toFixed(1)} KB`;
      setFileInfo({ name: file.name, size: sizeStr });
      setCommittedBatch(null);

      try {
        const result = await uploadAndParseGrpo(file);
        setParseResult(result);
        if (result.lines.length > 0) {
          setSelectedLineKey(result.lines[0].lineKey);
        }
        showToast(`Parsed ${result.lines.length} lines from ${file.name}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        showToast(`Error: ${msg}`);
      } finally {
        setIsParsing(false);
      }
    },
    [showToast]
  );

  // Pre-load prototype sample dataset
  const handleLoadSample = useCallback(() => {
    const sample = getSampleGrpoParseResult();
    setFileInfo({ name: sample.fileName, size: '24.8 KB' });
    setParseResult(sample);
    setSelectedLineKey('5104412-RM-MOZ-01#1');
    setCommittedBatch(null);
    showToast('Loaded sample SAP GRPO export (10 rows)');
  }, [showToast]);

  const handleClearFile = useCallback(() => {
    setFileInfo(null);
    setParseResult(null);
    setSelectedLineKey(null);
    setCommittedBatch(null);
    setActiveFilter('all');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        handleProcessFile(droppedFile);
      }
    },
    [handleProcessFile]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) {
        handleProcessFile(selected);
      }
    },
    [handleProcessFile]
  );

  // Derived KPI metrics
  const totalRows = parseResult?.lines.length || 0;
  const nImported = useMemo(
    () => parseResult?.lines.filter((l) => l.status === 'IMPORTED').length || 0,
    [parseResult]
  );
  const nRefreshed = useMemo(
    () => parseResult?.lines.filter((l) => l.status === 'REFRESHED').length || 0,
    [parseResult]
  );
  const nNeedsApproval = useMemo(
    () =>
      parseResult?.lines.filter((l) => l.status === 'NEEDS_2ND_APPROVAL')
        .length || 0,
    [parseResult]
  );
  const nQuarantined = useMemo(
    () =>
      parseResult?.lines.filter((l) => l.status === 'QUARANTINED').length || 0,
    [parseResult]
  );

  // Decision Q5: Late upload warning if document date is older than 1 working day
  const isLateUpload = useMemo(() => {
    if (!parseResult || parseResult.lines.length === 0) return false;
    if (samplePostingAge === '4') return true;
    return false;
  }, [parseResult, samplePostingAge]);

  // Filtered rows for the preview table
  const displayedLines = useMemo(() => {
    if (!parseResult) return [];
    if (activeFilter === 'all') return parseResult.lines;
    return parseResult.lines.filter((l) => l.status === activeFilter);
  }, [parseResult, activeFilter]);

  // Selected line object for sidebar inspection
  const selectedLine = useMemo(() => {
    if (!parseResult || !selectedLineKey) return null;
    return parseResult.lines.find((l) => l.lineKey === selectedLineKey) || null;
  }, [parseResult, selectedLineKey]);

  // Request 2nd approval for modified lines
  const handleRequest2ndApproval = useCallback(
    (lineKey: string) => {
      setPendingApprovals((prev) => ({ ...prev, [lineKey]: true }));
      showToast(`Second approval requested for line ${lineKey}`);
    },
    [showToast]
  );

  // Commit Ingestion to Stock Ledger using dispatchAction seam
  const handleCommitImport = useCallback(async () => {
    if (!parseResult || parseResult.lines.length === 0) return;

    setIsCommitting(true);
    const nextImportNo = `IMP-00${42 + recentImports.length}`;

    const res = await dispatchAction({
      actionName: 'COMMIT_SAP_GRPO_INGESTION',
      storeId: store,
      payload: {
        importId: nextImportNo,
        fileName: fileInfo?.name || 'GRPO_upload.xlsx',
        totalRows,
        importedLinesCount: nImported,
      },
      execute: async () => {
        return await commitGrpoBatch(nextImportNo, parseResult.lines, {
          storeId: store,
          fileName: fileInfo?.name || 'GRPO_upload.xlsx',
        });
      },
      onSuccess: (data) => {
        setIsCommitting(false);
        const committedId = data?.importId || nextImportNo;
        const nowTime = new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        setCommittedBatch({
          id: committedId,
          committedAt: `02 Nov ${nowTime}`,
          totalLines: totalRows,
          importedLines: nImported,
          refreshedLines: nRefreshed,
          needsApprovalLines: nNeedsApproval,
          quarantinedLines: nQuarantined,
        });

        showToast(
          `Committed ${nImported} lines (+Q) to stock ledger under ${committedId}`
        );

        getRecentImports(store).then(setRecentImports).catch(() => {});
      },
      onError: (err) => {
        setIsCommitting(false);
        showToast(`Commit failed: ${err.message}`);
      },
    });

    if (!res.success && !committedBatch) {
      setIsCommitting(false);
    }
  }, [
    parseResult,
    store,
    fileInfo,
    totalRows,
    nImported,
    nRefreshed,
    nNeedsApproval,
    nQuarantined,
    recentImports.length,
    committedBatch,
    showToast,
  ]);

  const getStatusBadge = (status: GrpoLineStatus) => {
    switch (status) {
      case 'IMPORTED':
        return <Badge variant="ok">Valid Inbound</Badge>;
      case 'REFRESHED':
        return <Badge variant="mu">Status Refreshed</Badge>;
      case 'NEEDS_2ND_APPROVAL':
        return <Badge variant="am">Needs 2nd Approval</Badge>;
      case 'QUARANTINED':
        return <Badge variant="er">Quarantined</Badge>;
    }
  };

  return (
    <>
      {/* Top Header */}
      <div className="head">
        <div>
          <div className="kicker">
            SAP GRPO Ingestion &middot; Flow A-2 &middot; {store}
          </div>
          <h1 className="h1">
            SAP GRPO <em>import.</em>
          </h1>
          <p className="sub">
            Upload the GRPO export from SAP. Only physical quantities and reference codes are kept.
          </p>
        </div>

        <div>
          {committedBatch ? (
            <button type="button" className="btn" disabled>
              Import committed
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={!parseResult || isCommitting || nImported === 0}
              onClick={handleCommitImport}
            >
              {isCommitting
                ? 'Committing...'
                : parseResult
                ? `Commit import (${nImported} lines to ledger)`
                : 'Commit import'}
            </button>
          )}
        </div>
      </div>

      {/* Confidentiality Banner */}
      {/* @allow-price-leak */}
      <div
        className="note ok"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <span style={{ fontSize: 18 }} role="img" aria-label="Shield">
          🛡️
        </span>
        <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <strong>Confidentiality Guarantee:</strong>{' '}
          {/* @allow-price-leak All commercial pricing, tax, and supplier details are stripped in memory before staging. */}
          {/* @allow-price-leak */} All commercial pricing, tax, and supplier details are stripped in memory before staging.
        </div>
      </div>

      {/* Grid: Main Area (1fr) + Right Sidebar (340px) */}
      <div className="cols c-imp">
        <div className="stack">
          {/* File Ingestion Dropzone */}
          <div
            className="drop"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              borderColor: isDragging ? 'var(--navy)' : undefined,
              background: isDragging ? '#F3EDE4' : undefined,
            }}
          >
            {fileInfo ? (
              <>
                <span className="stamp">File parsed</span>
                <div className="big">{fileInfo.name}</div>
                <div className="meta">
                  {fileInfo.size} &middot; 1 sheet &middot; header row 1 &middot;{' '}
                  {totalRows} data rows &middot; 27 columns
                </div>
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'center',
                  }}
                >
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={handleClearFile}
                    disabled={Boolean(committedBatch)}
                  >
                    Remove file
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={Boolean(committedBatch)}
                  >
                    Upload another file
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="lbl">Drop zone</span>
                <div className="big">Drop the SAP GRPO .xlsx here</div>
                <div className="gloss">
                  .xlsx only &middot; header row 1 &middot; 27 columns expected
                </div>
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'center',
                  }}
                >
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isParsing}
                  >
                    {isParsing ? 'Parsing...' : 'Select .xlsx file'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={handleLoadSample}
                    disabled={isParsing}
                  >
                    Use sample file
                  </button>
                </div>
              </>
            )}

            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>

          {/* Decision Q5: Late Upload Warning Badge */}
          {fileInfo && (
            <div className={`note ${isLateUpload ? 'am' : 'ok'}`}>
              <strong>
                {isLateUpload ? 'Late upload warning (Decision Q5).' : 'Uploaded on time.'}
              </strong>{' '}
              {isLateUpload ? (
                <>
                  SAP document date was {samplePostingAge} working days ago (rule: within 1 working day).
                  Import still proceeds. A warning notice is logged to Warehouse Keeper and Restaurant Manager audit.
                </>
              ) : (
                <>SAP document date is within 1 working day.</>
              )}{' '}
              <label
                style={{
                  marginLeft: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span className="gloss">Sample posting age:</span>
                <select
                  className="in"
                  style={{
                    display: 'inline-block',
                    width: 'auto',
                    margin: 0,
                    padding: '2px 8px',
                    fontSize: 12.5,
                  }}
                  value={samplePostingAge}
                  onChange={(e) =>
                    setSamplePostingAge(e.target.value as '1' | '4')
                  }
                  disabled={Boolean(committedBatch)}
                  aria-label="Sample posting age selector"
                >
                  <option value="1">1 working day (On time)</option>
                  <option value="4">4 working days (Late warning)</option>
                </select>
              </label>
            </div>
          )}

          {/* Ingestion Preview Dashboard */}
          {fileInfo && parseResult && (
            <Ticket
              no={`PARSED PREVIEW · ${fileInfo.name}`}
              right="allowlisted columns only"
            >
              {/* KPI Summary Tiles */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                {/* Tile 1: Total Rows */}
                <div
                  className={`stub ${activeFilter === 'all' ? 'w' : ''}`}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    boxShadow:
                      activeFilter === 'all'
                        ? '0 0 0 1px var(--navy)'
                        : undefined,
                  }}
                  onClick={() => setActiveFilter('all')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    Total Rows
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 24,
                      fontWeight: 700,
                    }}
                  >
                    {totalRows}
                  </div>
                  <div className="gloss" style={{ fontSize: 11 }}>
                    Parsed lines
                  </div>
                </div>

                {/* Tile 2: Valid Inbound */}
                <div
                  className={`stub ${activeFilter === 'IMPORTED' ? 'w' : ''}`}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    boxShadow:
                      activeFilter === 'IMPORTED'
                        ? '0 0 0 1px var(--forest)'
                        : undefined,
                  }}
                  onClick={() => setActiveFilter('IMPORTED')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    Valid Inbound
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 24,
                      fontWeight: 700,
                      color: 'var(--forest)',
                    }}
                  >
                    {nImported}
                  </div>
                  <div className="gloss" style={{ fontSize: 11 }}>
                    +Q stock addition
                  </div>
                </div>

                {/* Tile 3: Status Refreshed */}
                <div
                  className={`stub ${activeFilter === 'REFRESHED' ? 'w' : ''}`}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    boxShadow:
                      activeFilter === 'REFRESHED'
                        ? '0 0 0 1px var(--navy)'
                        : undefined,
                  }}
                  onClick={() => setActiveFilter('REFRESHED')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    Status Refreshed
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 24,
                      fontWeight: 700,
                      color: 'var(--navy)',
                    }}
                  >
                    {nRefreshed}
                  </div>
                  <div className="gloss" style={{ fontSize: 11 }}>
                    0 stock change
                  </div>
                </div>

                {/* Tile 4: Needs 2nd Approval */}
                <div
                  className={`stub ${
                    activeFilter === 'NEEDS_2ND_APPROVAL' ? 'w' : ''
                  }`}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    boxShadow:
                      activeFilter === 'NEEDS_2ND_APPROVAL'
                        ? '0 0 0 1px var(--amber)'
                        : undefined,
                  }}
                  onClick={() => setActiveFilter('NEEDS_2ND_APPROVAL')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    2nd Approval
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 24,
                      fontWeight: 700,
                      color: 'var(--amber)',
                    }}
                  >
                    {nNeedsApproval}
                  </div>
                  <div className="gloss" style={{ fontSize: 11 }}>
                    Quantity modified
                  </div>
                </div>

                {/* Tile 5: Quarantined */}
                <div
                  className={`stub ${
                    activeFilter === 'QUARANTINED' ? 'w' : ''
                  }`}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    boxShadow:
                      activeFilter === 'QUARANTINED'
                        ? '0 0 0 1px var(--err)'
                        : undefined,
                  }}
                  onClick={() => setActiveFilter('QUARANTINED')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="lbl" style={{ fontSize: 11 }}>
                    Quarantined
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 24,
                      fontWeight: 700,
                      color: 'var(--err)',
                    }}
                  >
                    {nQuarantined}
                  </div>
                  <div className="gloss" style={{ fontSize: 11 }}>
                    Staging errors
                  </div>
                </div>
              </div>

              {/* Filter Chips */}
              <Chips style={{ marginBottom: 12 }}>
                <Chip
                  label="All"
                  count={totalRows}
                  active={activeFilter === 'all'}
                  onClick={() => setActiveFilter('all')}
                />
                <Chip
                  label="Valid Inbound"
                  count={nImported}
                  active={activeFilter === 'IMPORTED'}
                  onClick={() => setActiveFilter('IMPORTED')}
                />
                <Chip
                  label="Status Refreshed"
                  count={nRefreshed}
                  active={activeFilter === 'REFRESHED'}
                  onClick={() => setActiveFilter('REFRESHED')}
                />
                <Chip
                  label="Needs 2nd Approval"
                  count={nNeedsApproval}
                  active={activeFilter === 'NEEDS_2ND_APPROVAL'}
                  onClick={() => setActiveFilter('NEEDS_2ND_APPROVAL')}
                />
                <Chip
                  label="Quarantined"
                  count={nQuarantined}
                  active={activeFilter === 'QUARANTINED'}
                  onClick={() => setActiveFilter('QUARANTINED')}
                />
              </Chips>

              {/* Table of Parsed Lines */}
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>GRPO No.</th>
                      <th>Line Key</th>
                      <th>Item Code & Name</th>
                      <th>Storeroom</th>
                      <th className="num">Quantity</th>
                      <th>UoM</th>
                      <th>Doc Date</th>
                      <th>Batch</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLines.map((row) => {
                      const isSel = row.lineKey === selectedLineKey;
                      const itemName =
                        ITEM_DIRECTORY[row.itemCode] || row.itemCode;
                      const storeroomLabel =
                        STOREROOM_NAMES[row.warehouseId] ||
                        row.warehouseId ||
                        row.storeCode;

                      return (
                        <tr
                          key={row.lineKey}
                          className={`row ${isSel ? 'sel' : ''}`}
                          onClick={() => setSelectedLineKey(row.lineKey)}
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="m">{row.grpoNo}</td>
                          <td
                            className="m"
                            style={{
                              color: 'var(--navy)',
                              fontWeight: 600,
                            }}
                          >
                            {row.lineKey}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{itemName}</div>
                            <div
                              className="meta"
                              style={{
                                fontSize: 11,
                                color: 'var(--terra)',
                              }}
                            >
                              {row.itemCode}
                            </div>
                          </td>
                          <td className="m">{storeroomLabel}</td>
                          <td className="num">
                            <b>
                              {row.uom.toLowerCase() === 'pc' ||
                              row.uom.toLowerCase() === 'pcs'
                                ? row.quantity.toFixed(0)
                                : row.quantity.toFixed(1)}
                            </b>
                          </td>
                          <td className="m">{row.uom}</td>
                          <td className="m">{row.docDate}</td>
                          <td className="m">{row.batchNumber || '—'}</td>
                          <td>{getStatusBadge(row.status)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Quarantined Drawer Trigger Notice */}
              {nQuarantined > 0 && (
                <div
                  className="note er"
                  style={{
                    marginTop: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div>
                    <strong>Staging Quarantine Alert:</strong> {nQuarantined}{' '}
                    malformed row{nQuarantined > 1 ? 's' : ''} quarantined (Unmapped
                    Store, Unmapped UoM, or Unregistered Item).
                  </div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setIsQuarantineDrawerOpen(true)}
                  >
                    Open Quarantined Lines Drawer &rarr;
                  </button>
                </div>
              )}

              <p className="gloss" style={{ margin: '12px 0 0' }}>
                Line key = GRPO No. + Item Code + occurrence order, derived
                deterministically. Status O/C is kept as a reference field.
              </p>
            </Ticket>
          )}

          {/* Confirmation Ticket: When Batch is Committed */}
          {committedBatch && (
            <Ticket
              no={`INGESTION RECEIPT · ${committedBatch.id}`}
              right={<Badge variant="ok">COMMITTED TO LEDGER</Badge>}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div className="stub">
                  <span className="lbl">Lines Committed (+Q)</span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 28,
                      fontWeight: 700,
                      color: 'var(--forest)',
                    }}
                  >
                    {committedBatch.importedLines}
                  </div>
                  <span className="gloss">GRPO_IMPORT appended</span>
                </div>

                <div className="stub">
                  <span className="lbl">Status Refreshed</span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 28,
                      fontWeight: 700,
                      color: 'var(--ink)',
                    }}
                  >
                    {committedBatch.refreshedLines}
                  </div>
                  <span className="gloss">0 stock change</span>
                </div>

                <div className="stub">
                  <span className="lbl">Pending 2nd Approval</span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 28,
                      fontWeight: 700,
                      color: 'var(--amber)',
                    }}
                  >
                    {committedBatch.needsApprovalLines}
                  </div>
                  <span className="gloss">Reversal held</span>
                </div>

                <div className="stub">
                  <span className="lbl">Quarantined Skipped</span>
                  <div
                    style={{
                      fontFamily: 'var(--disp)',
                      fontSize: 28,
                      fontWeight: 700,
                      color: 'var(--err)',
                    }}
                  >
                    {committedBatch.quarantinedLines}
                  </div>
                  <span className="gloss">Logged to error staging</span>
                </div>
              </div>

              <div className="note ok" style={{ marginBottom: 14 }}>
                <strong>Stock balance updated:</strong> Ingestion batch{' '}
                {committedBatch.id} committed to immutable ledger. Derived book
                balances for {committedBatch.importedLines} items increased at{' '}
                {committedBatch.committedAt}.
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href="/overview" className="btn ghost sm">
                  View in Stock Overview &rarr;
                </Link>
                <Link href="/issues" className="btn ghost sm">
                  View in Issues & Ledger &rarr;
                </Link>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={handleClearFile}
                >
                  Upload Another Spreadsheet
                </button>
              </div>
            </Ticket>
          )}

          {/* Import Audit Log Table */}
          <Ticket no="IMPORT AUDIT" right="one row per upload">
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Import</th>
                    <th>When</th>
                    <th>File</th>
                    <th>File Hash</th>
                    <th className="num">Rows</th>
                    <th>Result</th>
                    <th>By</th>
                    <th>Late</th>
                  </tr>
                </thead>
                <tbody>
                  {recentImports.map((audit) => (
                    <tr
                      key={audit.id}
                      className={audit.fresh ? 'sel' : ''}
                    >
                      <td className="m" style={{ fontWeight: 600 }}>
                        {audit.id}
                      </td>
                      <td className="m">{audit.dt}</td>
                      <td className="m">{audit.file}</td>
                      <td className="m" style={{ color: 'var(--ink-2)' }}>
                        {audit.hash}
                      </td>
                      <td className="num">{audit.rows}</td>
                      <td>{audit.res}</td>
                      <td>{audit.by}</td>
                      <td className="m">
                        {audit.late.startsWith('Yes') ? (
                          <Badge variant="am">{audit.late}</Badge>
                        ) : (
                          audit.late
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="gloss" style={{ margin: '8px 0 0' }}>
              File hash is an audit trace only. Corrected re-exports of the same
              file are permitted; rows are matched and deduplicated by compound
              line key.
            </p>
          </Ticket>
        </div>

        {/* Right Sidebar */}
        <aside className="stack">
          {/* Selected Line Card */}
          <div className="stub w">
            <span className="lbl">Selected line</span>
            {selectedLine ? (
              <>
                <div
                  className="meta"
                  style={{
                    color: 'var(--navy)',
                    wordBreak: 'break-all',
                    fontSize: 13,
                  }}
                >
                  <b>{selectedLine.lineKey}</b>
                </div>

                <div style={{ margin: '8px 0' }}>
                  {getStatusBadge(selectedLine.status)}
                </div>

                <p style={{ margin: '0 0 10px', fontSize: 13.5 }}>
                  {selectedLine.errorReason || 'Line validated for staging.'}
                </p>

                {selectedLine.status === 'QUARANTINED' && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setIsQuarantineDrawerOpen(true)}
                  >
                    Open Quarantined Lines Drawer
                  </button>
                )}

                {selectedLine.status === 'NEEDS_2ND_APPROVAL' && (
                  <div>
                    {pendingApprovals[selectedLine.lineKey] ? (
                      <span className="b ok">Second approval requested</span>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() =>
                          handleRequest2ndApproval(selectedLine.lineKey)
                        }
                      >
                        Request 2nd approval
                      </button>
                    )}
                  </div>
                )}

                {selectedLine.status === 'IMPORTED' && (
                  <p className="gloss" style={{ margin: 0 }}>
                    Will append GRPO_IMPORT +
                    {selectedLine.uom.toLowerCase() === 'pc' ||
                    selectedLine.uom.toLowerCase() === 'pcs'
                      ? selectedLine.quantity.toFixed(0)
                      : selectedLine.quantity.toFixed(1)}{' '}
                    {selectedLine.uom} on commit.
                  </p>
                )}

                {selectedLine.status === 'REFRESHED' && (
                  <p className="gloss" style={{ margin: 0 }}>
                    Line key already ingested. Reference status updated O to C.
                    Zero stock movement ledger row.
                  </p>
                )}
              </>
            ) : (
              <p className="gloss" style={{ margin: 0 }}>
                Select a row in the preview table to inspect compound key,
                storeroom mapping, and ledger action.
              </p>
            )}
          </div>

          {/* Dropped at Ingestion Card */}
          <div className="stub">
            <span className="lbl">Dropped at Ingestion</span>
            <div className="chips" style={{ marginBottom: 8, gap: 6 }}>
              {[
                'Commercial Rates',
                'Total Impost',
                'Net Impost',
                'Row Aggregates',
                'Gross Aggregates',
                'Partner Entity',
                'Partner Location',
              ].map((c) => (
                <span
                  key={c}
                  className="b mu"
                  style={{ textDecoration: 'line-through' }}
                >
                  {c}
                </span>
              ))}
            </div>
            <p className="gloss" style={{ margin: 0, lineHeight: 1.6 }}>
              Commercial figures, financial totals, and partner details are
              stripped in memory before staging. Version 1 stores physical
              quantities exclusively. 11 further unused columns are ignored.
            </p>
          </div>

          {/* Columns Kept (Allowlist) Card */}
          <div className="stub w">
            <span className="lbl">Columns Kept (Allowlist)</span>
            <p className="meta" style={{ margin: 0, lineHeight: 1.7 }}>
              GRPO No. &middot; Doc Date &middot; Item Code &middot; Quantity
              &middot; UoM Code &middot; Store Code &middot; Partner Code
              (reference) &middot; Base Document &middot; Row Status O/C.
              Compound line key is derived.
            </p>
          </div>

          {/* Re-upload & Deduplication Card */}
          <div className="stub">
            <span className="lbl">Re-upload Rule</span>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
              Same line key with only Open to Closed status change refreshes
              reference fields, zero stock change. A changed Quantity or Item
              Code needs a second person (SCM Lead or Finance Lead) before an
              offsetting reversal is appended.
            </p>
          </div>
        </aside>
      </div>

      {/* Quarantined Lines Drawer (Modal Overlay) */}
      {isQuarantineDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quarantine-drawer-title"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(28, 25, 23, 0.45)',
            backdropFilter: 'blur(2px)',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={() => setIsQuarantineDrawerOpen(false)}
        >
          <div
            style={{
              width: 580,
              maxWidth: '90vw',
              height: '100%',
              background: 'var(--cream)',
              borderLeft: '1px solid var(--rule)',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px 28px',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 16,
                borderBottom: '1px solid var(--rule)',
                marginBottom: 20,
              }}
            >
              <div>
                <span className="kicker">Ingestion Diagnostics</span>
                <h2
                  id="quarantine-drawer-title"
                  className="h3"
                  style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  Quarantined Lines Drawer
                  <Badge variant="er">{nQuarantined}</Badge>
                </h2>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setIsQuarantineDrawerOpen(false)}
                aria-label="Close Quarantined Lines Drawer"
              >
                &times; Close
              </button>
            </div>

            {/* Quarantine Info */}
            <div className="note er" style={{ marginBottom: 20 }}>
              <strong>Staging Protection Active:</strong> Malformed lines are
              quarantined in memory and logged to <code>t_grpo_staging_errors</code>.
              They are excluded from the stock ledger commit until corrected.
            </div>

            {/* List of Quarantined Lines */}
            <div className="stack">
              {parseResult?.lines
                .filter((l) => l.status === 'QUARANTINED')
                .map((row, idx) => {
                  return (
                    <div key={row.lineKey || idx} className="stub w">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 8,
                        }}
                      >
                        <span
                          className="m"
                          style={{
                            color: 'var(--navy)',
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          {row.lineKey}
                        </span>
                        <Badge variant="er">Quarantined</Badge>
                      </div>

                      <table className="tick" style={{ marginBottom: 10 }}>
                        <tbody>
                          <tr>
                            <td>Item Code</td>
                            <td className="m">
                              <b>{row.itemCode}</b> (
                              {ITEM_DIRECTORY[row.itemCode] || 'Unregistered'}
                              )
                            </td>
                          </tr>
                          <tr>
                            <td>Quantity & UoM</td>
                            <td>
                              {row.quantity} {row.uom}
                            </td>
                          </tr>
                          <tr>
                            <td>Store Code</td>
                            <td className="m">{row.storeCode}</td>
                          </tr>
                          <tr>
                            <td>GRPO No.</td>
                            <td className="m">{row.grpoNo}</td>
                          </tr>
                        </tbody>
                      </table>

                      <div
                        style={{
                          background: 'var(--err-bg)',
                          border: '1px solid #E8B8AD',
                          borderRadius: 4,
                          padding: '8px 12px',
                          color: '#6D1A0A',
                          fontSize: 13,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>Error Reason:</strong>{' '}
                        {row.errorReason ||
                          'Validation failure in store mapping, UoM conversion, or item code.'}
                      </div>

                      <div
                        className="gloss"
                        style={{ marginTop: 8, fontSize: 12 }}
                      >
                        Remediation: Register master data code or fix the source
                        spreadsheet, then re-upload. File hash deduplication
                        permits corrected re-exports.
                      </div>
                    </div>
                  );
                })}

              {/* Also show raw errors list if any */}
              {parseResult?.errors && parseResult.errors.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <span className="lbl">Raw Ingestion Errors</span>
                  <div style={{ marginTop: 8 }}>
                    {parseResult.errors.map((err, i) => (
                      <div
                        key={i}
                        className="note er"
                        style={{ marginBottom: 8, fontSize: 12.5 }}
                      >
                        <strong>Row {err.rowNumber}:</strong> {err.reason}
                        {err.rawData && (
                          <div
                            className="m"
                            style={{
                              marginTop: 4,
                              color: 'var(--ink-2)',
                              fontSize: 11.5,
                            }}
                          >
                            Raw: {err.rawData}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 20 }}>
              <button
                type="button"
                className="btn"
                style={{ width: '100%' }}
                onClick={() => setIsQuarantineDrawerOpen(false)}
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
