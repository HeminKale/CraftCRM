import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// ExcelJS resolved at runtime to avoid Next.js bundling issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs');

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const storageHeaders = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
};

export async function POST(req: NextRequest) {
  try {
    const formData    = await req.formData();
    const bucket      = (formData.get('storage_bucket') as string) || 'tenant-uploads';
    const storagePath = formData.get('storage_path') as string;
    const signedBy    = (formData.get('signed_by') as string) || 'Client';
    const signMethod  = (formData.get('sign_method') as string) || 'draw';   // 'draw' | 'upload'
    const sigFile     = formData.get('signature') as File | null;
    const imgFile     = formData.get('uploaded_image') as File | null;

    if (!storagePath) {
      return NextResponse.json({ error: 'storage_path is required' }, { status: 400 });
    }

    // ── 1. Download the Excel from Storage ───────────────────────
    // tenant-uploads is a private bucket, so use /authenticated/ prefix
    const dlUrl = `${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${storagePath}`;
    console.log('[sign-agreement] Downloading from:', dlUrl);

    const dlRes = await fetch(dlUrl, { headers: storageHeaders });
    if (!dlRes.ok) {
      const body = await dlRes.text().catch(() => '');
      console.error('[sign-agreement] Download failed:', dlRes.status, body);
      return NextResponse.json({ error: `Download failed: ${dlRes.status} ${body}` }, { status: 500 });
    }
    const xlsxBuffer = Buffer.from(await dlRes.arrayBuffer());

    // ── 2. Parse Excel rows ───────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer);
    const ws = workbook.worksheets[0];
    if (!ws) return NextResponse.json({ error: 'Excel has no worksheets' }, { status: 422 });

    // Collect all rows as { colA, colB }
    const rows: { colA: string; colB: string }[] = [];
    let clientRowIndex = -1;   // 0-based index into rows[]

    ws.eachRow((row: any, rowNum: number) => {
      const colA = (row.getCell(1).value?.toString() ?? '').trim();
      const colB = (row.getCell(2).value?.toString() ?? '').trim();
      rows.push({ colA, colB });
      if (colA.toUpperCase().includes('BEHALF OF CLIENT') && clientRowIndex === -1) {
        clientRowIndex = rows.length - 1;
      }
    });

    // ── 3. Get signature image bytes ─────────────────────────────
    const imageBytes: Uint8Array | null =
      signMethod === 'draw' && sigFile
        ? new Uint8Array(await sigFile.arrayBuffer())
        : signMethod === 'upload' && imgFile
        ? new Uint8Array(await imgFile.arrayBuffer())
        : null;

    const imageMime =
      signMethod === 'upload' && imgFile ? imgFile.type : 'image/png';

    // ── 4. Build PDF ──────────────────────────────────────────────
    const pdfDoc  = await PDFDocument.create();
    let   page    = pdfDoc.addPage([595, 842]); // A4 portrait
    const { width, height } = page.getSize();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin     = 48;
    const colBx      = margin + 220;        // col B starts here (field/value rows only)
    const lineHeight = 11;
    const sigMinH    = 90;                  // minimum height reserved for the signature row

    let y = height - margin;

    // Splits on existing newlines first (merged cells carry literal \n), then
    // greedily wraps each resulting line to maxWidth — needed because most of
    // this document is free-flowing clause text, not short table values.
    const wrapLines = (text: string, font: any, size: number, maxWidth: number): string[] => {
      const out: string[] = [];
      for (const para of text.split('\n')) {
        const words = para.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) { out.push(''); continue; }
        let current = '';
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
            out.push(current);
            current = word;
          } else {
            current = candidate;
          }
        }
        if (current) out.push(current);
      }
      return out;
    };

    const ensureSpace = (neededH: number) => {
      if (y - neededH < margin) {
        page = pdfDoc.addPage([595, 842]);
        y = height - margin;
      }
    };

    // ── Title ─────────────────────────────────────────────────────
    page.drawText('Client Agreement', {
      x: margin, y,
      size: 16, font: fontBold,
      color: rgb(0.07, 0.22, 0.37),
    });
    y -= 8;

    // Thin rule
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 28;

    // ── Render each row ───────────────────────────────────────────
    // Rows with a populated column A are short label/value pairs (Company
    // name, Address, ISO standard, the signature block) and render as a
    // two-column table. Rows with an empty column A are free-flowing clause
    // text living entirely in column B, and render as wrapped, full-width
    // paragraphs. Skipping rows just because column A is blank was the bug
    // that dropped nearly the whole agreement from the signed PDF.
    for (let i = 0; i < rows.length; i++) {
      const { colA, colB } = rows[i];
      if (!colA && !colB) continue;

      const isClientRow = i === clientRowIndex;

      if (!colA) {
        // ── Paragraph row ──────────────────────────────────────────
        const lines = wrapLines(colB, fontRegular, 9, width - margin * 2 - 8);
        for (const line of lines) {
          ensureSpace(lineHeight);
          if (line) {
            page.drawText(line, { x: margin, y, size: 9, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
          }
          y -= lineHeight;
        }
        y -= 6;
        continue;
      }

      // ── Field/value row ────────────────────────────────────────
      const labelWidth = colBx - margin - 8;
      const valueWidth = width - colBx - margin - 8;
      const labelLines = wrapLines(colA, fontBold, 9, labelWidth);
      const valueLines = !isClientRow && colB ? wrapLines(colB, fontRegular, 8.5, valueWidth) : [];

      let sigImg: any = null;
      let sigDims: { width: number; height: number } | null = null;
      if (isClientRow && imageBytes) {
        try {
          sigImg = imageMime === 'image/jpeg'
            ? await pdfDoc.embedJpg(imageBytes)
            : await pdfDoc.embedPng(imageBytes);
          sigDims = sigImg.scaleToFit(valueWidth, sigMinH - 16);
        } catch {
          // fall through — '[Signature image error]' drawn below
        }
      }

      const contentH = Math.max(
        labelLines.length * lineHeight,
        valueLines.length * lineHeight,
        isClientRow ? (sigDims ? sigDims.height + 16 : sigMinH) : 0,
      );
      const thisRowH = contentH + 10;

      ensureSpace(thisRowH);

      if (i % 2 === 0) {
        page.drawRectangle({ x: margin, y: y - thisRowH + lineHeight, width: width - margin * 2, height: thisRowH, color: rgb(0.97, 0.97, 0.99) });
      }
      page.drawLine({ start: { x: colBx, y: y - thisRowH + lineHeight }, end: { x: colBx, y: y + 2 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });

      let labelY = y;
      for (const line of labelLines) {
        page.drawText(line, { x: margin + 4, y: labelY, size: 9, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
        labelY -= lineHeight;
      }

      if (isClientRow) {
        if (sigImg && sigDims) {
          page.drawImage(sigImg, { x: colBx + 4, y: y - sigDims.height + lineHeight, width: sigDims.width, height: sigDims.height });
        } else if (imageBytes) {
          page.drawText('[Signature image error]', { x: colBx + 4, y, size: 8, font: fontRegular, color: rgb(0.8, 0, 0) });
        }
      } else {
        let valueY = y;
        for (const line of valueLines) {
          page.drawText(line, { x: colBx + 4, y: valueY, size: 8.5, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
          valueY -= lineHeight;
        }
      }

      y -= thisRowH;
    }

    // ── Footer: signed-by + date ──────────────────────────────────
    y -= 16;
    page.drawLine({ start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    const signatureDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
    page.drawText(`Signed by: ${signedBy}   |   Date: ${signatureDate}`, {
      x: margin, y,
      size: 8, font: fontRegular,
      color: rgb(0.4, 0.4, 0.4),
    });

    // ── 5. Serialize PDF ──────────────────────────────────────────
    const pdfBytes = await pdfDoc.save();

    // Signed PDF is handed back to the caller as bytes rather than written to
    // Storage here — this route runs with the service-role key, which bypasses
    // the app's tenant.attachments bookkeeping entirely. The caller (the
    // client-side review panel) attaches it via the normal authenticated
    // start_file_upload → Storage upload → finalize_file_upload flow, the same
    // one every other file field uses, so the signed copy actually shows up as
    // the record's clientAgreement__c__a attachment instead of an orphaned
    // object nothing in the app ever references again.
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });
  } catch (err: any) {
    console.error('[sign-agreement]', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
