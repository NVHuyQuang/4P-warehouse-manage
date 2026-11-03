import * as XLSX from 'xlsx';
import type { ParsedGrpoLine, ParseResult, ParseError, GrpoLineStatus } from './types';

export const EXPECTED_COLUMN_COUNT = 27;

// sap-raw-allowlist
export const CONFIDENTIAL_DROP_COLUMNS = [
  'Price', // sap-raw-allowlist drop
  'Total Tax', // sap-raw-allowlist drop
  'Net Tax Amount', // sap-raw-allowlist drop
  'Row Total', // sap-raw-allowlist drop
  'Gross Total', // sap-raw-allowlist drop
  'Vendor Name', // sap-raw-allowlist drop
  'Vendor Address', // sap-raw-allowlist drop
] as const;

// Normalized confidential column patterns to detect and strip from raw memory stream
const CONFIDENTIAL_NORMALIZED_SET = new Set([
  'price', // sap-raw-allowlist drop
  'totaltax', // sap-raw-allowlist drop
  'nettaxamount', // sap-raw-allowlist drop
  'rowtotal', // sap-raw-allowlist drop
  'grosstotal', // sap-raw-allowlist drop
  'vendorname', // sap-raw-allowlist drop
  'vendoraddress', // sap-raw-allowlist drop
]);

export const DEFAULT_STORE_WAREHOUSE_MAPPINGS = new Map<string, string>([
  ['IND-DEL-01', 'WH-DEL01-DRY'],
  ['IND-DEL-02', 'WH-DEL02-DRY'],
  ['DEL01', 'WH-DEL01-DRY'],
  ['DEL02', 'WH-DEL02-DRY'],
  ['STORE-01', 'WH-01'],
  ['STORE01', 'WH-01'],
]);

export const DEFAULT_VALID_UOMS = new Set([
  'kg',
  'pcs',
  'piece',
  'pieces',
  'kg_1000gr',
  'pack',
  'bottle',
  'tin',
  'can',
  'box',
  'bag',
  'carton',
  'portion',
  'g',
  'gram',
  'grams',
  'l',
  'liter',
  'litre',
  'ml',
]);

function normalizeKey(str: string): string {
  return str.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isConfidentialColumn(headerName: string): boolean {
  const norm = normalizeKey(headerName);
  return CONFIDENTIAL_NORMALIZED_SET.has(norm);
}

export function parseDateString(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    return !isNaN(val.getTime()) ? val.toISOString().slice(0, 10) : '';
  }
  if (typeof val === 'number') {
    // Excel serial date representation
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  }
  const s = String(val).trim();
  if (!s) return '';
  // SAP dd.mm.yyyy format
  const dotParts = s.split('.');
  if (dotParts.length === 3 && dotParts[0].length <= 2 && dotParts[1].length <= 2 && dotParts[2].length === 4) {
    const day = dotParts[0].padStart(2, '0');
    const month = dotParts[1].padStart(2, '0');
    const year = dotParts[2];
    return `${year}-${month}-${day}`;
  }
  // yyyy-mm-dd or yyyy/mm/dd format
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) {
    const parts = s.split(/[-/]/);
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].slice(0, 2).padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return s;
}

export function parseQuantity(val: unknown): number {
  if (val === null || val === undefined || val === '') return NaN;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/,/g, '').trim();
  return Number(cleaned);
}

/**
 * Parses SAP GRPO Excel Workbook into sanitized, validated lines.
 * Strictly enforces zero confidential financial data retention in memory. // sap-raw-allowlist
 */
export function parseGrpoWorkbook(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
  storeWarehouseMappings?: Map<string, string>
): ParseResult {
  const warnings: string[] = [];
  const errors: ParseError[] = [];
  const lines: ParsedGrpoLine[] = [];

  const isBuffer = Buffer.isBuffer(buffer);
  const wb = XLSX.read(buffer, {
    type: isBuffer ? 'buffer' : 'array',
    dense: true,
    cellDates: false,
  });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      fileName,
      totalRows: 0,
      importedCount: 0,
      refreshedCount: 0,
      needsApprovalCount: 0,
      quarantinedCount: 0,
      lines: [],
      errors: [{ rowNumber: 1, rawData: '', reason: 'Empty workbook: no sheets found' }],
      warnings: ['Workbook contains no sheets'],
    };
  }

  const sheet = wb.Sheets[sheetName];
  const rawMatrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  if (rawMatrix.length === 0) {
    return {
      fileName,
      totalRows: 0,
      importedCount: 0,
      refreshedCount: 0,
      needsApprovalCount: 0,
      quarantinedCount: 0,
      lines: [],
      errors: [{ rowNumber: 1, rawData: '', reason: 'Empty sheet: no data found' }],
      warnings: ['Sheet contains no data'],
    };
  }

  // Row 1 (index 0) is expected to be the header row
  const rawHeaders = (rawMatrix[0] || []).map((c) => String(c ?? '').trim());
  const detectedColumnCount = rawHeaders.filter((h) => h !== '').length;

  if (rawHeaders.length !== EXPECTED_COLUMN_COUNT && detectedColumnCount !== EXPECTED_COLUMN_COUNT) {
    warnings.push(
      `Detected header at Row 1 with ${rawHeaders.length} columns (non-empty: ${detectedColumnCount}), expected ${EXPECTED_COLUMN_COUNT} columns.`
    );
  }

  // Map header column indices, purging confidential columns immediately
  const confidentialIndices = new Set<number>();
  const columnMap = new Map<string, number>();

  rawHeaders.forEach((header, idx) => {
    if (!header) return;
    if (isConfidentialColumn(header)) {
      confidentialIndices.add(idx);
      return; // Do NOT add to columnMap
    }
    const norm = normalizeKey(header);
    columnMap.set(norm, idx);
  });

  // Helper to find column index by potential header aliases
  const findCol = (...aliases: string[]): number | undefined => {
    for (const alias of aliases) {
      const norm = normalizeKey(alias);
      if (columnMap.has(norm)) {
        return columnMap.get(norm);
      }
    }
    return undefined;
  };

  const colGrpoNo = findCol('GRPO No.', 'grpo_no', 'grpo number', 'grpo');
  const colDocDate = findCol('Doc Date', 'doc_date', 'document date', 'docdate');
  const colItemCode = findCol('Item Code', 'item_code', 'item no', 'item');
  const colQuantity = findCol('Quantity', 'qty');
  const colUom = findCol('UoM Code', 'uom', 'uom_code', 'unit', 'uom entry');
  const colStoreCode = findCol('Store Code', 'store_code', 'store', 'store id');
  const colVendorCode = findCol('Vendor Code', 'vendor_code', 'card code');
  const colBaseDocument = findCol('Base Document', 'base_document', 'po number', 'po');
  const colBatchNumber = findCol('Batch Number', 'batch_number', 'batch', 'lot', 'lot number');
  const colExpiryDate = findCol('Expiry Date', 'expiry_date', 'expiry', 'exp date');

  const occurrenceMap = new Map<string, number>();
  const documentItemsSequence = new Map<string, string[]>();

  const activeMappings = storeWarehouseMappings ?? DEFAULT_STORE_WAREHOUSE_MAPPINGS;

  // Process data rows starting at Row 2 (index 1)
  for (let rowIdx = 1; rowIdx < rawMatrix.length; rowIdx++) {
    const rawRow = rawMatrix[rowIdx] as unknown[];
    if (!rawRow || rawRow.every((cell) => cell === '' || cell === null || cell === undefined)) {
      continue; // Skip entirely empty rows
    }

    const rowNumber = rowIdx + 1; // 1-indexed Excel row number

    // Build sanitized raw line representation (confidential columns dropped immediately in memory)
    const sanitizedRawLine: Record<string, unknown> = {};
    rawHeaders.forEach((header, colIdx) => {
      if (!header || confidentialIndices.has(colIdx)) {
        return; // Purge confidential column cell from memory stream
      }
      sanitizedRawLine[header] = rawRow[colIdx] ?? '';
    });

    const getCell = (colIndex: number | undefined): unknown => {
      if (colIndex === undefined || confidentialIndices.has(colIndex)) return '';
      return rawRow[colIndex] ?? '';
    };

    const grpoNo = String(getCell(colGrpoNo) ?? '').trim();
    const itemCode = String(getCell(colItemCode) ?? '').trim();
    const storeCode = String(getCell(colStoreCode) ?? '').trim();
    const uom = String(getCell(colUom) ?? '').trim();
    const quantity = parseQuantity(getCell(colQuantity));
    const docDate = parseDateString(getCell(colDocDate));
    const batchNumber = String(getCell(colBatchNumber) ?? '').trim() || null;
    const rawExpiry = getCell(colExpiryDate);
    const expiryDate = rawExpiry ? parseDateString(rawExpiry) : null;
    const vendorCode = String(getCell(colVendorCode) ?? '').trim() || null;
    const baseDocument = String(getCell(colBaseDocument) ?? '').trim() || null;

    // Line Key Derivation: ${grpoNo}_${itemCode}_${occurrenceOrder}
    const baseKey = `${grpoNo}_${itemCode}`;
    const occurrenceOrder = (occurrenceMap.get(baseKey) || 0) + 1;
    occurrenceMap.set(baseKey, occurrenceOrder);
    const lineKey = `${grpoNo}_${itemCode}_${occurrenceOrder}`;

    // Detect row order changes across repeated keys
    if (occurrenceOrder > 1) {
      warnings.push(
        `Repeated key '${baseKey}' at row ${rowNumber} (occurrence ${occurrenceOrder}). Assigned line key '${lineKey}'.`
      );

      const itemsInDoc = documentItemsSequence.get(grpoNo) || [];
      const lastItemInDoc = itemsInDoc[itemsInDoc.length - 1];
      if (lastItemInDoc && lastItemInDoc !== itemCode) {
        warnings.push(
          `Row order change detected: Item '${itemCode}' in GRPO '${grpoNo}' reappeared at row ${rowNumber} after item '${lastItemInDoc}'. Potential row order shift.`
        );
      }
    }

    if (!documentItemsSequence.has(grpoNo)) {
      documentItemsSequence.set(grpoNo, [itemCode]);
    } else {
      const list = documentItemsSequence.get(grpoNo)!;
      if (list[list.length - 1] !== itemCode) {
        list.push(itemCode);
      }
    }

    // Validation & Quarantine logic
    let status: GrpoLineStatus = 'IMPORTED';
    let errorReason: string | undefined;
    let warehouseId = '';

    if (!itemCode) {
      status = 'QUARANTINED';
      errorReason = 'MISSING_ITEM_CODE';
    } else if (isNaN(quantity) || quantity <= 0) {
      status = 'QUARANTINED';
      errorReason = 'INVALID_QTY';
    } else if (!uom || !DEFAULT_VALID_UOMS.has(uom.toLowerCase())) {
      status = 'QUARANTINED';
      errorReason = 'UNMAPPED_UOM';
    } else if (!storeCode || !activeMappings.has(storeCode)) {
      status = 'QUARANTINED';
      errorReason = 'UNMAPPED_STORE';
    } else {
      warehouseId = activeMappings.get(storeCode) || '';
    }

    if (status === 'QUARANTINED') {
      errors.push({
        rowNumber,
        rawData: JSON.stringify(sanitizedRawLine),
        reason: errorReason || 'QUARANTINED',
      });
    }

    lines.push({
      grpoNo,
      lineKey,
      itemCode,
      warehouseId,
      storeCode,
      quantity: isNaN(quantity) ? 0 : quantity,
      uom,
      docDate,
      batchNumber,
      expiryDate,
      vendorCode,
      baseDocument,
      status,
      errorReason,
    });
  }

  const importedCount = lines.filter((l) => l.status === 'IMPORTED').length;
  const refreshedCount = lines.filter((l) => l.status === 'REFRESHED').length;
  const needsApprovalCount = lines.filter((l) => l.status === 'NEEDS_2ND_APPROVAL').length;
  const quarantinedCount = lines.filter((l) => l.status === 'QUARANTINED').length;

  return {
    fileName,
    totalRows: lines.length,
    importedCount,
    refreshedCount,
    needsApprovalCount,
    quarantinedCount,
    lines,
    errors,
    warnings,
  };
}
