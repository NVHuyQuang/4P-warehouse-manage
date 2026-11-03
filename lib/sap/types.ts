/**
 * SAP GRPO Ingestion Types
 *
 * NON-NEGOTIABLE RULE: Quantities only. Physical movements and quantities only.
 * Zero confidential financial or vendor metadata fields permitted.
 */

export type GrpoLineStatus = 'IMPORTED' | 'REFRESHED' | 'NEEDS_2ND_APPROVAL' | 'QUARANTINED';

export interface ParsedGrpoLine {
  grpoNo: string;
  lineKey: string;
  itemCode: string;
  warehouseId: string;
  storeCode: string;
  quantity: number;
  uom: string;
  docDate: string;
  batchNumber?: string | null;
  expiryDate?: string | null;
  vendorCode?: string | null;
  baseDocument?: string | null;
  status: GrpoLineStatus;
  errorReason?: string;
}

export interface ParseError {
  rowNumber: number;
  rawData: string;
  reason: string;
}

export interface ParseResult {
  fileName: string;
  totalRows: number;
  importedCount: number;
  refreshedCount: number;
  needsApprovalCount: number;
  quarantinedCount: number;
  lines: ParsedGrpoLine[];
  errors: ParseError[];
  warnings: string[];
}
