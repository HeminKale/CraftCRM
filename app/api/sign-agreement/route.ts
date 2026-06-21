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
    const dlRes = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`,
      { headers: storageHeaders }
    );
    if (!dlRes.ok) {
      const body = await dlRes.text().catch(() => '');
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
    const page    = pdfDoc.addPage([595, 842]); // A4 portrait
    const { width, height } = page.getSize();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin   = 48;
    const colBx    = margin + 220;          // col B starts here
    const rowH     = 22;                    // normal row height
    const sigRowH  = 90;                    // height for signature row
    const headerH  = 28;

    let y = height - margin;

    // ── Title ─────────────────────────────────────────────────────
    page.drawText('Client Agreement', {
      x: margin, y,
      size: 16, font: fontBold,
      color: rgb(0.07, 0.22, 0.37),
    });
    y -= 8;

    // Thin rule
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= headerH;

    // ── Column header row ─────────────────────────────────────────
    page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: rowH, color: rgb(0.93, 0.93, 0.97) });
    page.drawText('Field', { x: margin + 4, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('Value', { x: colBx + 4, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    y -= rowH + 4;

    // ── Render each row ───────────────────────────────────────────
    for (let i = 0; i < rows.length; i++) {
      const { colA, colB } = rows[i];
      if (!colA) continue;

      const isClientRow = i === clientRowIndex;
      const thisRowH    = isClientRow ? sigRowH : rowH;

      // Alternate background
      if (i % 2 === 0) {
        page.drawRectangle({ x: margin, y: y - thisRowH + rowH, width: width - margin * 2, height: thisRowH, color: rgb(0.97, 0.97, 0.99) });
      }

      // Vertical divider
      page.drawLine({ start: { x: colBx, y: y - thisRowH + rowH }, end: { x: colBx, y: y + 2 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });

      // Col A label
      const labelFont = isClientRow ? fontBold : fontRegular;
      const labelSize = isClientRow ? 9 : 8.5;
      page.drawText(colA.length > 38 ? colA.slice(0, 38) + '…' : colA, {
        x: margin + 4, y,
        size: labelSize, font: labelFont,
        color: rgb(0.15, 0.15, 0.15),
      });

      if (isClientRow && imageBytes) {
        // Embed signature image
        try {
          const sigImg = imageMime === 'image/jpeg'
            ? await pdfDoc.embedJpg(imageBytes)
            : await pdfDoc.embedPng(imageBytes);

          const maxW = width - colBx - margin - 8;
          const maxH = sigRowH - 8;
          const dims = sigImg.scaleToFit(maxW, maxH);

          page.drawImage(sigImg, {
            x: colBx + 4,
            y: y - dims.height + rowH,
            width: dims.width,
            height: dims.height,
          });
        } catch (imgErr) {
          page.drawText('[Signature image error]', { x: colBx + 4, y, size: 8, font: fontRegular, color: rgb(0.8, 0, 0) });
        }
      } else if (!isClientRow && colB) {
        page.drawText(colB.length > 42 ? colB.slice(0, 42) + '…' : colB, {
          x: colBx + 4, y,
          size: 8.5, font: fontRegular,
          color: rgb(0.15, 0.15, 0.15),
        });
      }

      y -= thisRowH;

      // Page overflow guard
      if (y < margin + 60) {
        const newPage = pdfDoc.addPage([595, 842]);
        y = newPage.getSize().height - margin;
      }
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

    // ── 6. Derive PDF storage path (replace extension) ───────────
    const pdfPath = storagePath.replace(/\.(xlsx?|xls)$/i, '.pdf');

    // ── 7. Upload PDF to Storage ──────────────────────────────────
    const upRes = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${pdfPath}`,
      {
        method: 'PUT',
        headers: {
          ...storageHeaders,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        },
        body: pdfBytes,
      }
    );

    if (!upRes.ok) {
      const body = await upRes.text().catch(() => '');
      return NextResponse.json({ error: `Failed to save PDF: ${upRes.status} ${body}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, pdf_path: pdfPath });
  } catch (err: any) {
    console.error('[sign-agreement]', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
