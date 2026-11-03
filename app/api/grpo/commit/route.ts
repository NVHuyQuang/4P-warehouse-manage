import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import type { ParsedGrpoLine } from '@/lib/sap/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { importId, lines, storeId, fileName, fileHash, userId } = body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload: "lines" must be a non-empty array of parsed GRPO lines.' },
        { status: 400 }
      );
    }

    let targetImportId = importId;

    // If importId not explicitly provided, create an audit record in t_grpo_imports
    if (!targetImportId) {
      const targetStoreId = storeId || lines[0]?.storeCode || 'IND-DEL-01';
      const targetFileName = fileName || 'grpo_upload.xlsx';
      const targetFileHash = fileHash || `hash_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const { data: importRecord, error: importError } = await supabase
        .from('t_grpo_imports')
        .insert({
          store_id: targetStoreId,
          file_name: targetFileName,
          file_hash: targetFileHash,
          detected_header_row: 1,
          total_rows: lines.length,
          uploaded_by_user_id: userId || '00000000-0000-0000-0000-000000000001',
        })
        .select('import_id')
        .single();

      if (importError) {
        return NextResponse.json(
          { error: `Failed to create import batch header: ${importError.message}` },
          { status: 400 }
        );
      }

      targetImportId = importRecord.import_id;
    }

    // Format lines for the commit_grpo_import_batch SQL function
    const formattedLines = lines.map((l: ParsedGrpoLine, idx: number) => ({
      row_number: idx + 1,
      grpo_no: l.grpoNo,
      item_code: l.itemCode,
      line_key: l.lineKey,
      quantity: l.quantity,
      uom: l.uom,
      doc_date: l.docDate,
      batch_number: l.batchNumber || null,
      expiry_date: l.expiryDate || null,
      vendor_code: l.vendorCode || null,
      base_document: l.baseDocument || null,
      store_code: l.storeCode,
      warehouse_id: l.warehouseId,
      status: l.status,
    }));

    const { data, error } = await supabase.rpc('commit_grpo_import_batch', {
      p_import_id: targetImportId,
      p_lines: formattedLines,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        success: true,
        importId: targetImportId,
        result: data,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error during GRPO commit';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
