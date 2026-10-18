// Server-only local conversion. Never upload customer letters to a conversion service.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const maxPdfBytes = 10 * 1024 * 1024;
type OfficeRunner = (executable: string, args: string[]) => Promise<void>;
const runOffice: OfficeRunner = (executable, args) => new Promise((resolve, reject) => {
  execFile(executable, args, { timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 65536, windowsHide: true }, error => {
    if (error) reject(new Error('suspension_pdf_conversion_failed'));
    else resolve();
  });
});

export async function validateSuspensionPdf(bytes: Buffer): Promise<void> {
  if (bytes.length < 16 || bytes.length > maxPdfBytes || bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii'))) throw new Error('invalid_suspension_pdf');
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    if (pdf.getPageCount() < 1) throw new Error('empty_pdf');
  } catch { throw new Error('invalid_suspension_pdf'); }
}

export async function convertSuspensionDocxToPdf(docx: Buffer, run: OfficeRunner = runOffice, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  if (docx.length < 4 || docx.length > maxPdfBytes || docx.subarray(0, 2).toString('ascii') !== 'PK') throw new Error('invalid_docx');
  const directory = await mkdtemp(join(tmpdir(), 'craft-suspension-'));
  try {
    const input = join(directory, 'letter.docx'), output = join(directory, 'output');
    await mkdir(output, { mode: 0o700 });
    await writeFile(input, docx, { mode: 0o600, flag: 'wx' });
    // Unique profile per job prevents concurrent office instances sharing state.
    await run(env.SUSPENSION_LIBREOFFICE_PATH || (process.platform === 'win32' ? 'soffice.exe' : 'libreoffice'), [
      `-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
      '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--nolockcheck',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', output, input,
    ]);
    const file = join(output, 'letter.pdf'), info = await stat(file);
    if (!info.isFile() || info.size > maxPdfBytes) throw new Error('invalid_suspension_pdf');
    const pdf = await readFile(file);
    await validateSuspensionPdf(pdf);
    return pdf;
  } finally {
    // Only this invocation's mkdtemp directory is removed; shared template is untouched.
    await rm(directory, { recursive: true, force: true });
  }
}

export async function validateSuspensionPdfPayload(payload: any, recordId: string): Promise<void> {
  const files = payload?.attachments;
  if (!Array.isArray(files) || files.length !== 1) throw new Error('suspension_pdf_required');
  const file = files[0];
  if (file.filename !== `suspension-${recordId}.pdf` || file.content_type !== 'application/pdf' ||
      typeof file.content !== 'string' || file.content.length > Math.ceil(maxPdfBytes / 3) * 4 ||
      file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.content)) throw new Error('suspension_pdf_required');
  await validateSuspensionPdf(Buffer.from(file.content, 'base64'));
}
