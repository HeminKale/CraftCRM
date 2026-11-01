import { FIELD_MAPPINGS, STAGE_PROGRESSION } from '../External_Client/summarySheetMapping';
import { FIELD_MAPPINGS_SURV, SURV_STAGE_PROGRESSION, parseFlexibleDate } from '../Renewal_Client/surveilanceSheetMapping';
import { FIELD_MAPPINGS_RECERT, RECERT_STAGE_PROGRESSION } from '../Recertification_Client/recertSheetMapping';

export type BulkWorkflow = 'initial' | 'surveillance' | 'recertification';
export type BulkField = { extColumn?: string; summaryColumn?: string; kind: 'date' | 'text' | 'file' };
export const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const normalizeCompany = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s/g, '');

// Match complete standard numbers, not ISO prefixes or revision years.
export function standardNumbersInOrder(value: unknown): string[] {
  const aliases: Record<string, string> = { '9': '9001', '14': '14001', '45': '45001' };
  const matches: string[] = String(value ?? '').match(/(?<!\d)\d{1,6}(?!\d)/g) || [];
  return Array.from(new Set(matches
    .filter(n => (Object.prototype.hasOwnProperty.call(aliases, n) || n.length >= 4) && !(+n >= 1900 && +n <= 2099))
    .map(n => aliases[n] || n)));
}
export const standardNumbers = (value: unknown) => standardNumbersInOrder(value).sort((a, b) => +a - +b);
export const isIntegrated = (value: unknown) => standardNumbers(value).length > 0 && standardNumbers(value).every(n => ['9001','14001','45001'].includes(n));
export const canonicalStandards = (value: unknown) => standardNumbers(value).map(n => `ISO ${n}`).join(', ');
export const mergeStandards = (a: unknown, b: unknown) => canonicalStandards(`${a ?? ''}, ${b ?? ''}`);

function parseBulkDate(raw: string): string | null {
  const parsed = parseFlexibleDate(raw);
  const dayFirst = /^(\d{1,2})[\s-]+([a-z]+)[,\s-]+(\d{4})$/i.exec(raw);
  const monthFirst = /^([a-z]+)[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/i.exec(raw);
  if (dayFirst || monthFirst) {
    const day = dayFirst ? dayFirst[1] : monthFirst![2];
    const month = (dayFirst ? dayFirst[2] : monthFirst![1]).slice(0, 3).toLowerCase();
    const year = dayFirst ? dayFirst[3] : monthFirst![3];
    const number = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month) + 1;
    if (parsed !== `${year}-${String(number).padStart(2, '0')}-${day.padStart(2, '0')}`) return null;
  }
  return parsed;
}

export function bulkMappings(workflow: BulkWorkflow): Record<string, BulkField> {
  const original = workflow === 'initial' ? FIELD_MAPPINGS : workflow === 'surveillance' ? FIELD_MAPPINGS_SURV : FIELD_MAPPINGS_RECERT;
  const result: Record<string, BulkField> = { ...original };
  const initial = workflow === 'initial';
  result.email = { extColumn: 'email__a', ...(initial ? { summaryColumn: 'email__a' } : {}), kind: 'text' };
  result['contact person'] = { extColumn: initial ? 'contactPerson__a' : 'contact_person__a', ...(initial ? { summaryColumn: 'contact_person__a' } : {}), kind: 'text' };
  result['client name'] = original['company name']; result.standards = original.standard;
  // Exact aliases with an established meaning in the selected workflow.
  if (workflow === 'recertification') {
    result['recert plan sent date'] = original['recert audit plan'];
    result['recert plan accept date'] = original['recert plan accept'];
    result['recert audit rca accept date'] = original['recert ncr rca acceptance'];
    result['recert ncr closure date'] = { extColumn: 'recert_evidences_accepted_date__a', kind: 'date' };
  }
  return result;
}

export function bulkSpec(workflow: BulkWorkflow) {
  const fields: Record<string, BulkField> = {};
  for (const field of Object.values(bulkMappings(workflow))) {
    if (field.extColumn && field.kind !== 'file') fields[field.extColumn] = field;
  }
  return { fields, stages: workflow === 'initial' ? STAGE_PROGRESSION : workflow === 'surveillance' ? SURV_STAGE_PROGRESSION : RECERT_STAGE_PROGRESSION };
}

export interface BulkRow { row: number; part: string; company: string; standards: string; data: Record<string, string>; errors: string[] }
export interface BulkParsed { headers: string[]; columns: string[]; ignored: string[]; rows: BulkRow[] }

export function parseBulkRows(sheet: unknown[][], workflow: BulkWorkflow, overrides: Record<number, string> = {}): BulkParsed {
  const headers = (sheet[0] || []).map(v => String(v ?? '').trim());
  const dictionary = bulkMappings(workflow), spec = bulkSpec(workflow);
  const columns = headers.map((h, i) => Object.hasOwn(overrides, i) ? overrides[i] : dictionary[normalizeHeader(h)]?.kind !== 'file' ? dictionary[normalizeHeader(h)]?.extColumn || '' : '');
  const companyColumn = workflow === 'initial' ? 'Company_name__a' : 'company_name__a';
  const isoColumn = workflow === 'initial' ? 'ISOStandard__a' : 'iso_standards__a';
  const ignored = headers.filter((h, i) => !columns[i] && normalizeHeader(h) !== 'type' && sheet.slice(1).some(row => String(row[i] ?? '').trim()));
  const rows: BulkRow[] = [];
  const seen = new Map<string, BulkRow>();
  sheet.slice(1).forEach((cells, offset) => {
    if (!cells.some(v => String(v ?? '').trim())) return;
    const data: Record<string, string> = {}, errors: string[] = [];
    headers.forEach((header, i) => {
      const raw = String(cells[i] ?? '').trim(), column = columns[i];
      // The business sheet's "type" column (e.g. "Initial") describes the client's
      // certification type, not which upload it belongs to, so it is never validated.
      if (!column || !raw) return;
      const field = spec.fields[column];
      if (!field) { errors.push(`Unknown mapping for ${header}.`); return; }
      const value = field.kind === 'date' ? parseBulkDate(raw) : raw;
      if (raw.startsWith('#') || !value || field.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { errors.push(`Invalid value in ${header}: ${raw}`); return; }
      if (data[column] && data[column] !== value) errors.push(`Conflicting columns map to ${column}. Choose one mapping.`);
      data[column] = value;
    });
    const company = data[companyColumn] || '', standards = canonicalStandards(data[isoColumn]);
    if (!normalizeCompany(company)) errors.push('Company name is required.');
    if (!standards) errors.push('At least one recognised ISO standard number is required.');
    const numbers = standardNumbersInOrder(data[isoColumn]);
    const integrated = numbers.filter(n => ['9001','14001','45001'].includes(n));
    const groups = [...(integrated.length ? [integrated] : []), ...numbers.filter(n => !integrated.includes(n)).map(n => [n])];
    const certificates = String(data.certificate_no__a || '').split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
    if (groups.length > 1 && certificates.length && certificates.length !== numbers.length) errors.push('Cannot pair certificate numbers to split standards. Supply one per standard in the same order, or separate the spreadsheet rows.');
    for (const group of groups.length ? groups : [[]]) {
      const part = group.some(n => ['9001','14001','45001'].includes(n)) ? 'integrated' : group[0] || 'invalid';
      const splitData = { ...data, [isoColumn]: canonicalStandards(group.join(',')) };
      // Canonical standards are sorted. Reorder their paired certificates too,
      // even for an unsplit integrated row supplied in a different order.
      if (certificates.length === numbers.length) splitData.certificate_no__a = [...group].sort((a, b) => +a - +b).map(n => certificates[numbers.indexOf(n)]).join('\n');
      const row: BulkRow = { row: offset + 2, part, company, standards: splitData[isoColumn], data: splitData, errors: [...errors] };
      const key = normalizeCompany(company) + ':' + part;
      if (company && seen.has(key)) {
        row.errors.push(`Duplicate company/standard group at row ${seen.get(key)!.row}; combine or remove duplicate rows.`);
        seen.get(key)!.errors.push(`Duplicate company/standard group at row ${row.row}.`);
      } else seen.set(key, row);
      rows.push(row);
    }
  });
  if (rows.length > 500) throw new Error('Upload at most 500 record parts per batch after splitting standards.');
  return { headers, columns, ignored, rows };
}
