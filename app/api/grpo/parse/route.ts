import { NextRequest, NextResponse } from 'next/server';
import { parseGrpoWorkbook } from '@/lib/sap/parser';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: 'No valid file provided. Please attach an Excel (.xlsx) file as "file".' },
        { status: 400 }
      );
    }

    const fileName = (file as File).name || 'grpo_upload.xlsx';
    if (!fileName.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json(
        { error: 'Invalid file extension. Only .xlsx files are supported.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let storeWarehouseMappings: Map<string, string> | undefined;
    const mappingsRaw = formData.get('mappings');
    if (mappingsRaw && typeof mappingsRaw === 'string') {
      try {
        const parsed = JSON.parse(mappingsRaw);
        if (typeof parsed === 'object' && parsed !== null) {
          storeWarehouseMappings = new Map(Object.entries(parsed));
        }
      } catch {
        // Fall back to default mappings if JSON parsing fails
      }
    }

    const result = parseGrpoWorkbook(buffer, fileName, storeWarehouseMappings);

    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown parsing error occurred';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
