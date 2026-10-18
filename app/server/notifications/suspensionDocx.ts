import JSZip from 'jszip';
import { Readable } from 'node:stream';

const xmlEscape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const xmlText = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
  if (entity[0] === '#') {
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('invalid_template_text');
    return String.fromCodePoint(code);
  }
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()];
});

async function boundedRead(entry: JSZip.JSZipObject, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const stream = entry.nodeStream('nodebuffer') as Readable;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('template_part_too_large')); stream.destroy(); return; }
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Only approved {{tokens}} in visible Word text are replaced. Split Word runs
// retain their formatting; no plain-text guesses, XML code, URLs, or macros run.
export async function personalizeSuspensionDocx(bytes: Buffer, values: Record<string, string>): Promise<Buffer> {
  if (bytes.length < 4 || bytes.length > 2 * 1024 * 1024 || bytes.readUInt16LE(0) !== 0x4b50) throw new Error('invalid_docx');
  for (const value of Object.values(values)) {
    if (value.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('invalid_letter_value');
  }
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > 512 || !zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) throw new Error('invalid_docx_package');
  let total = 0, companyTokens = 0;
  for (const entry of entries) {
    if ((entry as any).unsafeOriginalName && (entry as any).unsafeOriginalName !== entry.name) throw new Error('unsafe_template_path');
    if (/vbaProject|activex|embeddings|\.bin$|\.\.\/|^\//i.test(entry.name)) throw new Error('unsupported_template_part');
    const raw = await boundedRead(entry, 5 * 1024 * 1024);
    total += raw.length;
    if (total > 20 * 1024 * 1024) throw new Error('template_too_large');
    if (!/\.(xml|rels)$/.test(entry.name)) continue;
    let xml = raw.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY|macroEnabled|TargetMode\s*=\s*["']External["']/i.test(xml)) throw new Error('unsupported_template_content');
    if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(entry.name)) {
      xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
        const nodes = Array.from(paragraph.matchAll(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g)).map(m => ({
          index: m.index!, full: m[0], open: m[1], text: xmlText(m[2]), edits: [] as { start: number; end: number; value: string }[], offset: 0,
        }));
        let length = 0;
        for (const node of nodes) { node.offset = length; length += node.text.length; }
        const combined = nodes.map(n => n.text).join('');
        const tokens = Array.from(combined.matchAll(/\{\{([a-z_]+)\}\}/g));
        if (combined.replace(/\{\{([a-z_]+)\}\}/g, '').includes('{{') || combined.replace(/\{\{([a-z_]+)\}\}/g, '').includes('}}')) throw new Error('invalid_template_token');
        for (const token of tokens) {
          const key = token[1];
          if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error('unknown_template_token');
          if (key === 'company_name') companyTokens++;
          const start = token.index!, end = start + token[0].length;
          let inserted = false;
          for (const node of nodes) {
            const a = Math.max(start, node.offset), b = Math.min(end, node.offset + node.text.length);
            if (a >= b) continue;
            node.edits.push({ start: a - node.offset, end: b - node.offset, value: inserted ? '' : values[key] });
            inserted = true;
          }
        }
        let result = paragraph;
        for (const node of [...nodes].reverse()) if (node.edits.length) {
          let text = node.text;
          for (const edit of node.edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
          const open = /xml:space=/.test(node.open) ? node.open : node.open.replace(/>$/, ' xml:space="preserve">');
          result = result.slice(0, node.index) + open + xmlEscape(text) + '</w:t>' + result.slice(node.index + node.full.length);
        }
        return result;
      });
      zip.file(entry.name, xml);
    }
    if (/\{\{|\}\}/.test(xml)) throw new Error('unresolved_template_token');
  }
  if (!companyTokens || !values.company_name?.trim()) throw new Error('company_placeholder_required');
  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (result.length > 10 * 1024 * 1024) throw new Error('letter_too_large');
  return result;
}
