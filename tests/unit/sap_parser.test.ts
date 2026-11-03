import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseGrpoWorkbook } from '@/lib/sap/parser';

describe('SAP GRPO Spreadsheet Parser & Validator (Flow A-2)', () => {
  // sap-raw-allowlist 27 expected SAP column headers
  const sample27Headers = [
    '#',
    'GRPO No.',
    'Status',
    'Object Type',
    'Doc Date',
    'Due Date',
    'Document Date',
    'Remarks',
    'Journal Remarks',
    'Vendor Code',
    'Vendor Name', // sap-raw-allowlist drop
    'Vendor Address', // sap-raw-allowlist drop
    'Item Code',
    'Item Name',
    'Quantity',
    'Price', // sap-raw-allowlist drop
    'Total Tax', // sap-raw-allowlist drop
    'Net Tax Amount', // sap-raw-allowlist drop
    'Row Total', // sap-raw-allowlist drop
    'Gross Total', // sap-raw-allowlist drop
    'Store Code',
    'Store Name',
    'UoM Entry',
    'UoM Code',
    'Target Type',
    'Open Quantity',
    'Base Document',
  ];

  it('1. parses 27-column sample workbook correctly', () => {
    const rowData = [
      {
        '#': 1,
        'GRPO No.': '5104412',
        Status: 'O',
        'Object Type': '20',
        'Doc Date': '15.10.2026',
        'Due Date': '15.10.2026',
        'Document Date': '15.10.2026',
        Remarks: 'PO Inbound Receipt',
        'Journal Remarks': 'Goods Receipt PO 5104412',
        'Vendor Code': 'VEND-001',
        'Vendor Name': 'Confidential Dairy Supplier Ltd', // sap-raw-allowlist drop
        'Vendor Address': 'Plot 42 Industrial Area, New Delhi', // sap-raw-allowlist drop
        'Item Code': 'ITM-CHZ-001',
        'Item Name': 'Fresh Mozzarella Ball 1kg',
        Quantity: 25,
        'Price': 250.0, // sap-raw-allowlist drop
        'Total Tax': 25.0, // sap-raw-allowlist drop
        'Net Tax Amount': 25.0, // sap-raw-allowlist drop
        'Row Total': 6250.0, // sap-raw-allowlist drop
        'Gross Total': 6275.0, // sap-raw-allowlist drop
        'Store Code': 'IND-DEL-01',
        'Store Name': 'Delhi Saket Central',
        'UoM Entry': 1,
        'UoM Code': 'kg',
        'Target Type': null,
        'Open Quantity': 25,
        'Base Document': 'PO-99001',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(rowData, { header: sample27Headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GRPO_Export');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parseGrpoWorkbook(buffer, 'sap_sample_27_col.xlsx');

    expect(result.fileName).toBe('sap_sample_27_col.xlsx');
    expect(result.totalRows).toBe(1);
    expect(result.importedCount).toBe(1);
    expect(result.quarantinedCount).toBe(0);
    expect(result.errors.length).toBe(0);

    const line = result.lines[0];
    expect(line).toBeDefined();
    expect(line.grpoNo).toBe('5104412');
    expect(line.itemCode).toBe('ITM-CHZ-001');
    expect(line.quantity).toBe(25);
    expect(line.uom).toBe('kg');
    expect(line.docDate).toBe('2026-10-15');
    expect(line.storeCode).toBe('IND-DEL-01');
    expect(line.warehouseId).toBe('WH-DEL01-DRY');
    expect(line.vendorCode).toBe('VEND-001');
    expect(line.baseDocument).toBe('PO-99001');
    expect(line.status).toBe('IMPORTED');
    expect(line.lineKey).toBe('5104412_ITM-CHZ-001_1');
  });

  it('2. confirms 7 confidential columns are 100% purged from all output objects', () => {
    const rowData = [
      {
        '#': 1,
        'GRPO No.': '5104412',
        'Doc Date': '15.10.2026',
        'Vendor Code': 'VEND-001',
        'Vendor Name': 'Confidential Dairy Supplier Ltd', // sap-raw-allowlist drop
        'Vendor Address': 'Plot 42 Industrial Area, New Delhi', // sap-raw-allowlist drop
        'Item Code': 'ITM-CHZ-001',
        Quantity: 25,
        'Price': 250.0, // sap-raw-allowlist drop
        'Total Tax': 25.0, // sap-raw-allowlist drop
        'Net Tax Amount': 25.0, // sap-raw-allowlist drop
        'Row Total': 6250.0, // sap-raw-allowlist drop
        'Gross Total': 6275.0, // sap-raw-allowlist drop
        'Store Code': 'IND-DEL-01',
        'UoM Code': 'kg',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(rowData, { header: sample27Headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GRPO_Export');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parseGrpoWorkbook(buffer, 'test_confidential_purge.xlsx');
    expect(result.lines.length).toBe(1);

    const line = result.lines[0];

    // Explicit check on line properties // sap-raw-allowlist drop
    const forbiddenColumns = [ // sap-raw-allowlist drop
      'Price', // sap-raw-allowlist drop
      'Total Tax', // sap-raw-allowlist drop
      'Net Tax Amount', // sap-raw-allowlist drop
      'Row Total', // sap-raw-allowlist drop
      'Gross Total', // sap-raw-allowlist drop
      'Vendor Name', // sap-raw-allowlist drop
      'Vendor Address', // sap-raw-allowlist drop
    ]; // sap-raw-allowlist drop

    forbiddenColumns.forEach((col) => { // sap-raw-allowlist drop
      expect(col in line).toBe(false); // sap-raw-allowlist drop
      expect(Object.prototype.hasOwnProperty.call(line, col)).toBe(false); // sap-raw-allowlist drop
    }); // sap-raw-allowlist drop

    // Also check camelCase variants // sap-raw-allowlist drop
    const record = line as unknown as Record<string, unknown>;
    expect(record.price).toBeUndefined(); // sap-raw-allowlist drop
    expect(record.totalTax).toBeUndefined(); // sap-raw-allowlist drop
    expect(record.netTaxAmount).toBeUndefined(); // sap-raw-allowlist drop
    expect(record.rowTotal).toBeUndefined(); // sap-raw-allowlist drop
    expect(record.grossTotal).toBeUndefined(); // sap-raw-allowlist drop
    expect(record.vendorName).toBeUndefined(); // sap-raw-allowlist drop
    expect(record.vendorAddress).toBeUndefined(); // sap-raw-allowlist drop

    // Check stringified output contains zero confidential words
    const jsonStr = JSON.stringify(result.lines);
    expect(jsonStr).not.toMatch(/(?:(?:\b|_)price[a-z]*(?:\b|_)|[a-z0-9]Price[a-zA-Z]*)/i); // sap-raw-allowlist drop
    expect(jsonStr).not.toMatch(/(?:total[_\s-]?tax|totalTax)/i); // sap-raw-allowlist drop
    expect(jsonStr).not.toMatch(/(?:net[_\s-]?tax[_\s-]?amount|netTaxAmount)/i); // sap-raw-allowlist drop
    expect(jsonStr).not.toMatch(/(?:row[_\s-]?total|rowTotal)/i); // sap-raw-allowlist drop
    expect(jsonStr).not.toMatch(/(?:gross[_\s-]?total|grossTotal)/i); // sap-raw-allowlist drop
    expect(jsonStr).not.toMatch(/(?:vendor[_\s-]?name|vendorName)/i); // sap-raw-allowlist drop
    expect(jsonStr).not.toMatch(/(?:vendor[_\s-]?address|vendorAddress)/i); // sap-raw-allowlist drop
  });

  it('3. generates unique line keys for 121-duplicate GRPO No. + Item Code rows', () => {
    const duplicateRows: Record<string, unknown>[] = [];
    for (let i = 1; i <= 121; i++) {
      duplicateRows.push({
        '#': i,
        'GRPO No.': '5104412',
        'Doc Date': '15.10.2026',
        'Item Code': 'ITM-CHZ-001',
        Quantity: 5.5,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
        'Base Document': `PO-99${String(i).padStart(3, '0')}`,
        'Price': 200, // sap-raw-allowlist drop
      });
    }

    const ws = XLSX.utils.json_to_sheet(duplicateRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Duplicates');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parseGrpoWorkbook(buffer, '121_duplicates.xlsx');

    expect(result.totalRows).toBe(121);
    expect(result.lines.length).toBe(121);
    expect(result.quarantinedCount).toBe(0);
    expect(result.importedCount).toBe(121);

    const lineKeys = result.lines.map((l) => l.lineKey);
    const uniqueKeys = new Set(lineKeys);

    // All 121 derived line keys must be strictly unique
    expect(uniqueKeys.size).toBe(121);
    expect(lineKeys[0]).toBe('5104412_ITM-CHZ-001_1');
    expect(lineKeys[50]).toBe('5104412_ITM-CHZ-001_51');
    expect(lineKeys[120]).toBe('5104412_ITM-CHZ-001_121');

    // Warnings should document repeated occurrences
    expect(result.warnings.length).toBeGreaterThanOrEqual(120);
  });

  it('4. validates and quarantines lines for invalid quantity or missing item code', () => {
    const invalidRows = [
      // Row 2: Missing item code
      {
        '#': 1,
        'GRPO No.': 'GRPO-001',
        'Item Code': '',
        Quantity: 10,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
      // Row 3: Negative quantity
      {
        '#': 2,
        'GRPO No.': 'GRPO-002',
        'Item Code': 'ITM-CHZ-001',
        Quantity: -10,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
      // Row 4: Zero quantity
      {
        '#': 3,
        'GRPO No.': 'GRPO-003',
        'Item Code': 'ITM-CHZ-001',
        Quantity: 0,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
      // Row 5: Malformed non-numeric quantity
      {
        '#': 4,
        'GRPO No.': 'GRPO-004',
        'Item Code': 'ITM-CHZ-001',
        Quantity: 'invalid-qty',
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
      // Row 6: Unmapped UoM
      {
        '#': 5,
        'GRPO No.': 'GRPO-005',
        'Item Code': 'ITM-CHZ-001',
        Quantity: 10,
        'UoM Code': 'UNKNOWN_UOM_VAL',
        'Store Code': 'IND-DEL-01',
      },
      // Row 7: Unmapped Store Code
      {
        '#': 6,
        'GRPO No.': 'GRPO-006',
        'Item Code': 'ITM-CHZ-001',
        Quantity: 10,
        'UoM Code': 'kg',
        'Store Code': 'UNMAPPED_STORE_99',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(invalidRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'InvalidData');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parseGrpoWorkbook(buffer, 'quarantine_cases.xlsx');

    expect(result.totalRows).toBe(6);
    expect(result.quarantinedCount).toBe(6);
    expect(result.importedCount).toBe(0);
    expect(result.errors.length).toBe(6);

    expect(result.lines[0].status).toBe('QUARANTINED');
    expect(result.lines[0].errorReason).toBe('MISSING_ITEM_CODE');

    expect(result.lines[1].status).toBe('QUARANTINED');
    expect(result.lines[1].errorReason).toBe('INVALID_QTY');

    expect(result.lines[2].status).toBe('QUARANTINED');
    expect(result.lines[2].errorReason).toBe('INVALID_QTY');

    expect(result.lines[3].status).toBe('QUARANTINED');
    expect(result.lines[3].errorReason).toBe('INVALID_QTY');

    expect(result.lines[4].status).toBe('QUARANTINED');
    expect(result.lines[4].errorReason).toBe('UNMAPPED_UOM');

    expect(result.lines[5].status).toBe('QUARANTINED');
    expect(result.lines[5].errorReason).toBe('UNMAPPED_STORE');

    // Check error entries
    expect(result.errors[0].rowNumber).toBe(2);
    expect(result.errors[0].reason).toBe('MISSING_ITEM_CODE');
    expect(result.errors[1].rowNumber).toBe(3);
    expect(result.errors[1].reason).toBe('INVALID_QTY');
  });

  it('5. detects row order shifts across repeated keys in the same GRPO', () => {
    const interleavedRows = [
      {
        'GRPO No.': 'GRPO-MULTI-01',
        'Doc Date': '15.10.2026',
        'Item Code': 'ITM-A',
        Quantity: 10,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
      {
        'GRPO No.': 'GRPO-MULTI-01',
        'Doc Date': '15.10.2026',
        'Item Code': 'ITM-B',
        Quantity: 20,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
      {
        'GRPO No.': 'GRPO-MULTI-01',
        'Doc Date': '15.10.2026',
        'Item Code': 'ITM-A',
        Quantity: 15,
        'UoM Code': 'kg',
        'Store Code': 'IND-DEL-01',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(interleavedRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Interleaved');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parseGrpoWorkbook(buffer, 'row_order_shift.xlsx');

    expect(result.totalRows).toBe(3);
    expect(result.lines[0].lineKey).toBe('GRPO-MULTI-01_ITM-A_1');
    expect(result.lines[1].lineKey).toBe('GRPO-MULTI-01_ITM-B_1');
    expect(result.lines[2].lineKey).toBe('GRPO-MULTI-01_ITM-A_2');

    // Must have a warning specifically identifying the non-consecutive order shift
    const shiftWarning = result.warnings.find((w) => w.includes('Row order change detected'));
    expect(shiftWarning).toBeDefined();
    expect(shiftWarning).toContain('ITM-A');
  });
});
