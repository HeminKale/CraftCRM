// Shared Summary-sheet parsing — extracted 2026-08-02 out of StageDateImport.tsx
// so the "New Client from Summary" creation flow can reuse the exact same
// label dictionaries and row parser instead of forking a second copy. This
// mapping has already had three real bugs found and fixed against actual
// production sheets (column-index shift, three relabeled vertical dates, the
// wide-table/vertical duplicate-date conflict) — a fork here would silently
// drift out of sync with any future fix made in only one place.

// Every recognized Excel label, and where its value goes. `kind: 'date'`
// values are parsed/validated as calendar dates; `kind: 'text'` values are
// copied through as-is (trimmed), covering both genuinely free-text fields
// (names, standards, mandays) and the two fields that read like dates but
// are deliberately TEXT columns per S3/S4's design (stage1_audit_date__a /
// stage2_audit_date__a — manual, no status implication).
//
// extColumn / summaryColumn are independently optional — a label with only
// one of the two simply doesn't write to the other object. Several vertical
// dates have no reasonable client_summary__a target at all: that object's
// date columns are coarser (one stage1_date__a / stage2_date__a covering
// the whole stage, no per-checkpoint granularity), so per §5a of
// summary-excel-import-analysis.md, "tech review N date" (Stage N fully
// complete) is what's mirrored into stage{1,2}_date__a — not the mid-cycle
// "audit date"/"plan accept date"/"RCA accept date" checkpoints, which have
// nowhere coarse enough to land on Summary.
export interface FieldMapping {
  extColumn?: string;
  summaryColumn?: string;
  kind: 'date' | 'text';
}

export const FIELD_MAPPINGS: Record<string, FieldMapping> = {
  // Section B — per-checkpoint workflow dates (external_clients__a is the
  // detailed record; client_summary__a gets the ones that map cleanly onto
  // its coarser columns)
  'application':                     { extColumn: 'Date__a',                          summaryColumn: 'application_date__a',      kind: 'date' },
  'application review':              { extColumn: 'Application_Accpeted_Date__a',                                                 kind: 'date' },
  'quotation':                       { extColumn: 'Quotation_Received_Date__a',        summaryColumn: 'quotation_date__a',        kind: 'date' },
  'client agreement':                { extColumn: 'Client_Agreement_Signed_Date__a',   summaryColumn: 'client_agreement_date__a', kind: 'date' },
  'stage 1 plan sent date':          { extColumn: 'Stage_one_plan_Sent_Date__a',       summaryColumn: 'stage1_plan_sent_date__a', kind: 'date' },
  'stage 1 plan accept date':        { extColumn: 'stage1_plan_accepted_date__a',                                                 kind: 'date' },
  'stage 1 audit date':              { extColumn: 'stage1_audit_date__a',                                                         kind: 'text' },
  'stage 1 ncr rca acceptance date': { extColumn: 'stage1_auditor_accepted_date__a',                                              kind: 'date' },
  // Relabeled in a later template revision (confirmed 2026-08-02 against a
  // real production sheet) — additive alias, same target column, original
  // label above still works too.
  'ncr rca date':                    { extColumn: 'stage1_auditor_accepted_date__a',                                              kind: 'date' },
  'tech review 1 date':              { extColumn: 'stage1_tech_final_accepted_date__a', summaryColumn: 'stage1_date__a',          kind: 'date' },
  'stage 2 plan sent date':          { extColumn: 'stage2_plan_sent_date__a',          summaryColumn: 'stage2_plan_sent_date__a', kind: 'date' },
  'stage 2 plan accept date':        { extColumn: 'stage2_plan_accepted_date__a',                                                 kind: 'date' },
  'stage 2 audit date':              { extColumn: 'stage2_audit_date__a',                                                         kind: 'text' },
  'stage 2 audit rca accept date':   { extColumn: 'stage2_auditor_accepted_date__a',                                              kind: 'date' },
  'stage 2 audit + ncr upload date': { extColumn: 'stage2_auditor_accepted_date__a',                                              kind: 'date' }, // relabel alias, see note above
  'stage 2 ncr closure date':        { extColumn: 'stage2_evidences_accepted_date__a', summaryColumn: 'ncr_closure_date__a',      kind: 'date' },
  'stage 2 ncr rca accept date':     { extColumn: 'stage2_evidences_accepted_date__a', summaryColumn: 'ncr_closure_date__a',      kind: 'date' }, // relabel alias, see note above
  'tech review 2 date':              { extColumn: 'stage2_tech_findings_date__a',      summaryColumn: 'stage2_date__a',           kind: 'date' },
  'cdc date':                        { extColumn: 'cdc_date__a',                                                                  kind: 'date' },
  'registration date':               { extColumn: 'registration_date__a',              summaryColumn: 'registration_date__a',     kind: 'date' },

  // Section A — company/audit-planning metadata (migration 241)
  'company name':                    { extColumn: 'Company_name__a',           summaryColumn: 'company_name__a',      kind: 'text' },
  'standard':                        { extColumn: 'ISOStandard__a',            summaryColumn: 'iso_standards__a',     kind: 'text' },
  'certificate no':                  { extColumn: 'certificate_no__a',         summaryColumn: 'certificate_no__a',    kind: 'text' },
  'country':                         { extColumn: 'country__a',                summaryColumn: 'country__a',           kind: 'text' },
  'iaf code':                        { extColumn: 'iaf_code__a',               summaryColumn: 'iaf_code__a',          kind: 'text' },
  'address':                         { extColumn: 'Adddress__a',               summaryColumn: 'address__a',           kind: 'text' },
  'scope':                           { extColumn: 'scope__a',                  summaryColumn: 'scope__a',             kind: 'text' },
  'no of empl':                      { extColumn: 'totalNumberOfEmployees__a', summaryColumn: 'no_of_employees__a',   kind: 'text' },
  'total mandays':                   { extColumn: 'total_mandays__a',          summaryColumn: 'total_mandays__a',     kind: 'text' },
  'stg 1 manday':                    { extColumn: 'stage1_manday__a',          summaryColumn: 'stage1_manday__a',     kind: 'text' },
  'stg 2 manday':                    { extColumn: 'stage2_manday__a',          summaryColumn: 'stage2_manday__a',     kind: 'text' },
  'auditor stg 1':                   { extColumn: 'stage1_auditor__a',         summaryColumn: 'stage1_auditor__a',    kind: 'text' },
  'auditor stg 2':                   { extColumn: 'stage2_auditor__a',         summaryColumn: 'stage2_auditor__a',    kind: 'text' },
  // Excel has one "Tech Reviewer" column; maps to Stage 1 only (confirmed) —
  // stage2_tech_reviewer exists on both objects for parity but has no Excel source yet.
  'tech reviewer':                   { extColumn: 'stage1_tech_reviewer__a',   summaryColumn: 'stage1_tech_reviewer__a', kind: 'text' },
  'director name':                   { extColumn: 'director_name__a',          summaryColumn: 'director_name__a',     kind: 'text' },
  'auditor team':                    { extColumn: 'auditor_team__a',           summaryColumn: 'auditor_team__a',      kind: 'text' },
  'application reviewer name':       { extColumn: 'application_reviewer__a',   summaryColumn: 'application_reviewer__a', kind: 'text' },
  'appl reviewr name':               { extColumn: 'application_reviewer__a',   summaryColumn: 'application_reviewer__a', kind: 'text' }, // abbreviated spelling seen in a real wide-table header, confirmed 2026-08-02
  'lead auditor':                    { extColumn: 'lead_auditor__a',           summaryColumn: 'lead_auditor__a',      kind: 'text' },
  'food category':                   { extColumn: 'food_category__a',          summaryColumn: 'food_category__a',     kind: 'text' },
  'soa date':                        { extColumn: 'soa_date__a',               summaryColumn: 'soa_date__a',          kind: 'text' },
  // 'type', 'Surveillance 1 mandays', 'Recert mandays' — deferred, not mapped (see analysis doc §5a)
};

// Section A recognized a second time, for a *wide-table* header row —
// COMPANY NAME | Standard | ... across columns, one client's values in the
// single row beneath it. Confirmed 2026-08-02 against a real production
// sheet: this table sits at rows 0-1, immediately above the vertical date
// list (rows vary), and is a stable, recurring structure, not a one-off.
//
// Deliberately a separate, smaller dictionary from FIELD_MAPPINGS rather
// than reusing it wholesale: the wide table also carries columns that
// *restate* several of the vertical list's dates under sometimes-different
// header text (Reg date, Stg 1 date, Stage 2 date, Stage 2 start date, CDC,
// Tech review stg 1/2 Date, Client agreement date, Quotation, Application
// date) — confirmed 2026-08-02 that when both are present, the vertical
// list stays the source of truth and these wide-table restatements are
// read as reference/notes only, never imported. "Stage 2 start date" and
// standalone "CDC" don't correspond to any existing field either way and
// are left unmapped for now (not yet confirmed what they should mean).
// Only genuinely wide-table-only columns (company/audit metadata, no date
// duplication) are listed here.
export const WIDE_TABLE_MAPPINGS: Record<string, FieldMapping> = {
  'company name':              FIELD_MAPPINGS['company name'],
  'standard':                  FIELD_MAPPINGS['standard'],
  'certificate no':            FIELD_MAPPINGS['certificate no'],
  'country':                   FIELD_MAPPINGS['country'],
  'address':                   FIELD_MAPPINGS['address'],
  'scope':                     FIELD_MAPPINGS['scope'],
  'iaf code':                  FIELD_MAPPINGS['iaf code'],
  'no of empl':                FIELD_MAPPINGS['no of empl'],
  'total mandays':             FIELD_MAPPINGS['total mandays'],
  'stg 1 manday':              FIELD_MAPPINGS['stg 1 manday'],
  'stg 2 manday':              FIELD_MAPPINGS['stg 2 manday'],
  'auditor stg 1':             FIELD_MAPPINGS['auditor stg 1'],
  'auditor stg 2':             FIELD_MAPPINGS['auditor stg 2'],
  'tech reviewer':             FIELD_MAPPINGS['tech reviewer'],
  'director name':             FIELD_MAPPINGS['director name'],
  'auditor team':              FIELD_MAPPINGS['auditor team'],
  'application reviewer name': FIELD_MAPPINGS['application reviewer name'],
  'appl reviewr name':         FIELD_MAPPINGS['appl reviewr name'],
  'lead auditor':              FIELD_MAPPINGS['lead auditor'],
  'food category':             FIELD_MAPPINGS['food category'],
  'soa date':                  FIELD_MAPPINGS['soa date'],
};

// Mirrors ClientWorkflowBar.tsx's STAGES order — keep in sync if that array
// changes. registration_date__a is last since Client_Registered is the
// terminal stage.
export const STAGE_PROGRESSION: { column: string; status: string }[] = [
  { column: 'Date__a',                            status: 'Application_Sent' },
  { column: 'Application_Accpeted_Date__a',       status: 'Application_Accepted' },
  { column: 'Quotation_Received_Date__a',         status: 'Quotation_Received' },
  { column: 'Client_Agreement_Signed_Date__a',    status: 'Client_Agreement_Signed' },
  { column: 'Stage_one_plan_Sent_Date__a',        status: 'Stage_one_plan_Sent' },
  { column: 'stage1_plan_accepted_date__a',       status: 'Stage1_Plan_Accepted' },
  { column: 'stage1_auditor_accepted_date__a',    status: 'Stage1_Auditor_Accepted' },
  { column: 'stage1_tech_final_accepted_date__a', status: 'Stage1_Complete' },
  { column: 'stage2_plan_sent_date__a',           status: 'Stage2_Plan_Sent' },
  { column: 'stage2_plan_accepted_date__a',       status: 'Stage2_Plan_Accepted' },
  { column: 'stage2_auditor_accepted_date__a',    status: 'Stage2_Auditor_Accepted' },
  { column: 'stage2_evidences_accepted_date__a',  status: 'Stage2_Evidences_Accepted' },
  { column: 'stage2_tech_findings_date__a',       status: 'Stage2_Tech_Findings_Given' },
  { column: 'cdc_date__a',                        status: 'CDC_Approved' },
  { column: 'registration_date__a',               status: 'Client_Registered' },
];

// Builds a plain calendar-date string from a Date object's LOCAL fields.
// Deliberately never touches toISOString()/UTC conversion — these are
// date-only values with no time-of-day or timezone meaning, and going
// through UTC shifts the day backward by one whenever the runtime's local
// offset is positive (e.g. IST, UTC+5:30): local midnight on the 20th is
// still the 19th in UTC. Round-tripping through local fields only, both
// here and in formatIso below, keeps the calendar date the user typed
// exactly what gets stored and displayed, regardless of server/browser TZ.
export function toIsoDateString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseFlexibleDate(raw: any): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return toIsoDateString(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  const s = String(raw ?? '').trim();
  if (!s || s.startsWith('#')) return null; // blank, or an Excel error value (#REF!, #N/A, #VALUE!, ...)
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return toIsoDateString(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export interface ParsedRow {
  label: string;
  mapping: FieldMapping;
  raw: string;
  value: string | null; // ISO date (kind 'date') or trimmed text (kind 'text'); null = blank/unparseable, skipped
}

// Combined wide-table + vertical-list parser — the exact logic StageDateImport.tsx
// used inline before this file was extracted (2026-08-02), now shared with the
// "New Client from Summary" creation flow.
export function parseSummaryWorkbookRows(sheetRows: any[][]): ParsedRow[] {
  const parsed: ParsedRow[] = [];

  // Wide-table pass: row 0 as headers, row 1 as the single data row — if any
  // header in row 0 is recognized, treat both rows as consumed by this table
  // and skip them in the vertical pass below (otherwise row 0's headers
  // would themselves get misread as vertical label/value pairs, e.g.
  // label="Company Name", value="Standard").
  const headerRow = sheetRows[0] || [];
  const dataRow = sheetRows[1] || [];
  let wideTableDetected = false;
  headerRow.forEach((cell, colIdx) => {
    const header = String(cell ?? '').trim();
    const mapping = WIDE_TABLE_MAPPINGS[header.toLowerCase()];
    if (!mapping) return;
    wideTableDetected = true;
    const rawValue = dataRow[colIdx];
    const value = mapping.kind === 'date'
      ? parseFlexibleDate(rawValue)
      : (String(rawValue ?? '').trim() || null);
    parsed.push({ label: header, mapping, raw: String(rawValue ?? '').trim(), value });
  });

  // Vertical pass: label in column A, value in column B — falling back to
  // column C when B is blank (a later template revision, confirmed
  // 2026-08-02 against a real production sheet, shifted the value over one
  // column; supporting both keeps older-format sheets working too).
  sheetRows.forEach((r, rowIdx) => {
    if (wideTableDetected && (rowIdx === 0 || rowIdx === 1)) return;
    const label = String(r[0] ?? '').trim();
    if (!label) return;
    const mapping = FIELD_MAPPINGS[label.toLowerCase()];
    if (!mapping) return; // unmapped label — silently ignored, matches NewClientForm's convention
    const rawValue = (r[1] !== undefined && String(r[1]).trim() !== '') ? r[1] : r[2];
    const value = mapping.kind === 'date'
      ? parseFlexibleDate(rawValue)
      : (String(rawValue ?? '').trim() || null);
    parsed.push({ label, mapping, raw: String(rawValue ?? '').trim(), value });
  });

  return parsed;
}
