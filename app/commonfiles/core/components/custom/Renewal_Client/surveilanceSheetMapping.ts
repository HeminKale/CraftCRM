// Surveillance 1 (Renewal) summary-sheet parsing — extracted for SurveilanceImport.tsx
// Mirrors External Client's summarySheetMapping.ts pattern exactly.
// New columns added in migrations 271/275; date columns from migrations 256–260.
//
// Fixed 2026-08-12 after re-checking against the REAL sample sheet (not just
// the rights-matrix labels) — three classes of bug found and fixed:
//   1. 'address' was mapped onto company_name__a (no address column existed
//      at all) — would have silently overwritten the company name on import.
//      Fixed: new address__a column (migration 275), mapped correctly.
//   2. The sheet has TWO distinct team-member column sets: 'Auditor Stg 1' /
//      'Auditor Stg 2' / 'Tech Reviewer' / 'lead auditor' describe the
//      client's ORIGINAL certification team (historical reference only —
//      confirmed NOT imported here, same treatment External Client gives
//      its own restated wide-table columns); 'surv auditor' / 'surv LA' /
//      'surv Tech reviewer' / 'surv CDC' describe THIS surveillance visit's
//      team and are what auditor_name__a / lead_auditor__a /
//      tech_reviewer_name__a / cdc_name__a should actually be sourced from.
//      Fixed: swapped the source labels; the Stg1/Stg2/generic labels are no
//      longer recognized by this file at all (not a silent no-op — they're
//      just absent from the dictionary, same as every other genuinely
//      unmapped column).
//   3. Three vertical-list labels didn't match the real sheet's text at all
//      ('acceptance by client' vs. coded 'intimation acceptance', 'assign
//      team' vs. coded 'team assigned', and a double-space typo in 'surv  ncr
//      RCA acceptance') — silently skipped every one of those three dates on
//      import. Fixed: real observed labels are now the primary keys, old
//      guessed labels kept as additive aliases (same convention External
//      Client's importer already uses for its own relabeled columns), and
//      the parser now collapses repeated whitespace before matching so a
//      stray double space doesn't cause another silent miss later.

export interface FieldMapping {
  extColumn?: string;
  summaryColumn?: string;
  // 'file' exists so a label like "surv tech review checklist" can be
  // recognized (and therefore excluded from the "unrecognized label" bucket)
  // without the parser attempting to date/text-parse its value — file
  // uploads aren't extractable from a spreadsheet cell, so kind: 'file'
  // rows are intentionally skipped in parseSummaryWorkbookRows.
  kind: 'date' | 'text' | 'file';
}

// Every recognized Excel label for Surveillance 1 summary import
export const FIELD_MAPPINGS_SURV: Record<string, FieldMapping> = {
  // ─── Section B — Per-checkpoint workflow dates ───
  // Vertical list, one label/value pair per row.
  // Surveillance 1 has no client_summary__a equivalent, so no summaryColumn targets.
  // Primary keys are the REAL labels observed in the actual sample sheet
  // (Surv 1 Summary.csv) — old guessed labels kept below as additive aliases,
  // same convention External Client's importer uses for its own relabeled columns.

  'surveillance intimation letter':      { extColumn: 'intimation_sent_date__a',         kind: 'date' },
  'acceptance by client':                { extColumn: 'intimation_accepted_date__a',     kind: 'date' },
  'intimation acceptance':               { extColumn: 'intimation_accepted_date__a',     kind: 'date' }, // alias, original guess
  'assign team':                         { extColumn: 'team_assigned_date__a',           kind: 'date' },
  'team assigned':                       { extColumn: 'team_assigned_date__a',           kind: 'date' }, // alias, original guess
  'surv audit plan':                     { extColumn: 'surv_plan_sent_date__a',          kind: 'date' },
  'surv plan accept':                    { extColumn: 'surv_plan_accepted_date__a',      kind: 'date' },
  'surv ncr':                            { extColumn: 'surv_ncr_sent_date__a',           kind: 'date' },
  'surv ncr rca':                        { extColumn: 'surv_ncr_rca_uploaded_date__a',   kind: 'date' },
  'surv ncr rca acceptance':             { extColumn: 'surv_auditor_accepted_date__a',   kind: 'date' },
  'surv audit report':                   { extColumn: 'surv_report_sent_date__a',        kind: 'date' },
  'surv tech findings':                  { extColumn: 'surv_tech_findings_date__a',      kind: 'date' },
  'surv tech review checklist':          { extColumn: 'surv_tech_findings_file__a',      kind: 'file' }, // Not a date; file upload
  'surv tech review findings':           { extColumn: 'surv_tech_findings_notes__a',     kind: 'text' },
  'cdc':                                 { extColumn: 'cdc_date__a',                     kind: 'date' },
  'certificate issue':                   { extColumn: 'certificates_sent_date__a',       kind: 'date' },
  'surv closed':                         { extColumn: 'surv_closed_date__a',             kind: 'date' },

  // ─── Section A — Company/audit metadata ───
  // Wide table, one header row → one data row.

  'company name':                        { extColumn: 'company_name__a',                 kind: 'text' },
  'standard':                            { extColumn: 'iso_standards__a',                kind: 'text' },
  'certificate no':                      { extColumn: 'certificate_no__a',               kind: 'text' },
  'country':                             { extColumn: 'country__a',                      kind: 'text' },
  // Fixed — used to overwrite company_name__a (no address column existed at
  // all). address__a is a new column, migration 275.
  'address':                             { extColumn: 'address__a',                      kind: 'text' },
  'scope':                               { extColumn: 'scope__a',                        kind: 'text' },
  'iaf code':                            { extColumn: 'iaf_code__a',                     kind: 'text' },
  'no of empl':                          { extColumn: 'no_of_employees__a',              kind: 'text' },
  // 'total mandays' and 'surveillance 1 mandays' are the same figure per this
  // sheet's actual layout — both point at the one surv_mandays__a column.
  'total mandays':                       { extColumn: 'surv_mandays__a',                 kind: 'text' },
  'surv mandays':                        { extColumn: 'surv_mandays__a',                 kind: 'text' },
  'surveillance 1 mandays':              { extColumn: 'surv_mandays__a',                 kind: 'text' },
  'auditor team':                        { extColumn: 'auditor_team__a',                 kind: 'text' },
  // NOTE: 'Auditor Stg 1' / 'Auditor Stg 2' / generic 'Tech Reviewer' /
  // generic 'lead auditor' are the client's ORIGINAL certification team —
  // historical reference only, deliberately NOT mapped here (same treatment
  // External Client gives its own restated wide-table columns, §9b). The
  // 'surv '-prefixed columns below describe THIS surveillance visit's team
  // and are the real source for these fields.
  'surv audit date':                     { extColumn: 'surveillance_audit_date__a',      kind: 'text' }, // existing TEXT col, migration 221 — was never imported before
  'surv auditor':                        { extColumn: 'auditor_name__a',                 kind: 'text' },
  'surv la':                             { extColumn: 'lead_auditor__a',                 kind: 'text' },
  'surv tech reviewer':                  { extColumn: 'tech_reviewer_name__a',           kind: 'text' },
  'surv cdc':                            { extColumn: 'cdc_name__a',                     kind: 'text' }, // new column, migration 275
  'director name':                       { extColumn: 'director_name__a',                kind: 'text' },
  'application reviewer':                { extColumn: 'application_reviewer__a',         kind: 'text' },
  'application reviewer name':           { extColumn: 'application_reviewer__a',         kind: 'text' }, // Alternate
  'appl reviewr name':                   { extColumn: 'application_reviewer__a',         kind: 'text' }, // Typo variant, seen in production
  'food category':                       { extColumn: 'food_category__a',                kind: 'text' },
  'soa date':                            { extColumn: 'soa_date__a',                     kind: 'text' }, // TEXT not DATE — manual, no status implication
};

// Wide-table metadata columns only (Section A wide table: row 0 headers, row 1 data).
// Deliberately excludes date columns that also appear in the vertical list — when both
// are present, vertical list is the source of truth (same decision as External Client, 9b).
export const WIDE_TABLE_MAPPINGS_SURV: Record<string, FieldMapping> = {
  'company name':              FIELD_MAPPINGS_SURV['company name'],
  'standard':                  FIELD_MAPPINGS_SURV['standard'],
  'certificate no':            FIELD_MAPPINGS_SURV['certificate no'],
  'country':                   FIELD_MAPPINGS_SURV['country'],
  'address':                   FIELD_MAPPINGS_SURV['address'],
  'scope':                     FIELD_MAPPINGS_SURV['scope'],
  'iaf code':                  FIELD_MAPPINGS_SURV['iaf code'],
  'no of empl':                FIELD_MAPPINGS_SURV['no of empl'],
  'total mandays':             FIELD_MAPPINGS_SURV['total mandays'],
  'surv mandays':              FIELD_MAPPINGS_SURV['surv mandays'],
  'surveillance 1 mandays':    FIELD_MAPPINGS_SURV['surveillance 1 mandays'],
  'auditor team':              FIELD_MAPPINGS_SURV['auditor team'],
  'surv audit date':           FIELD_MAPPINGS_SURV['surv audit date'],
  'surv auditor':              FIELD_MAPPINGS_SURV['surv auditor'],
  'surv la':                   FIELD_MAPPINGS_SURV['surv la'],
  'surv tech reviewer':        FIELD_MAPPINGS_SURV['surv tech reviewer'],
  'surv cdc':                  FIELD_MAPPINGS_SURV['surv cdc'],
  'director name':             FIELD_MAPPINGS_SURV['director name'],
  'application reviewer':      FIELD_MAPPINGS_SURV['application reviewer'],
  'application reviewer name': FIELD_MAPPINGS_SURV['application reviewer name'],
  'appl reviewr name':         FIELD_MAPPINGS_SURV['appl reviewr name'],
  'food category':             FIELD_MAPPINGS_SURV['food category'],
  'soa date':                  FIELD_MAPPINGS_SURV['soa date'],
};

// Status progression for Surveillance 1 (13 statuses total).
// Mirrors RenewalWorkflowBar.tsx's STAGES order (Sprint 3).
// Used by SurveilanceImport to auto-advance status based on which dates are present.
export const SURV_STAGE_PROGRESSION: { column: string; status: string }[] = [
  { column: 'intimation_sent_date__a',         status: 'Intimation_Sent' },
  { column: 'intimation_accepted_date__a',     status: 'Intimation_Accepted' },
  { column: 'team_assigned_date__a',           status: 'Team_Assigned' },
  { column: 'surv_plan_sent_date__a',          status: 'Surv_Plan_Sent' },
  { column: 'surv_plan_accepted_date__a',      status: 'Surv_Plan_Accepted' },
  { column: 'surv_ncr_sent_date__a',           status: 'Surv_NCR_Sent' },
  { column: 'surv_ncr_rca_uploaded_date__a',   status: 'Surv_NCR_RCA_Uploaded' },
  { column: 'surv_auditor_accepted_date__a',   status: 'Surv_Auditor_Accepted' },
  { column: 'surv_report_sent_date__a',        status: 'Surv_Report_Sent' },
  { column: 'surv_tech_findings_date__a',      status: 'Surv_Tech_Findings_Given' },
  { column: 'surv_closed_date__a',             status: 'Surv_Closed' },
  { column: 'cdc_date__a',                     status: 'CDC_Approved' },
  { column: 'certificates_sent_date__a',       status: 'Certificate_Issued' },
];

// ──────────────────────────────────────────────────────────────
// Shared date parsing & formatting (exact same as External Client)
// ──────────────────────────────────────────────────────────────

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

// Lowercases, trims, and collapses any run of internal whitespace to a
// single space before dictionary lookup — added after a real sheet had
// "surv  ncr RCA acceptance" (double space) silently fail to match the
// single-spaced dictionary key. Cheap insurance against the next typo like
// it, on top of the explicit alias entries already added for this one.
function normalizeLabel(cell: any): string {
  return String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Combined wide-table + vertical-list parser
// Exact same logic as External Client's summarySheetMapping.ts.
export function parseSummaryWorkbookRows(sheetRows: any[][]): ParsedRow[] {
  const parsed: ParsedRow[] = [];

  // Wide-table pass: row 0 as headers, row 1 as the single data row
  const headerRow = sheetRows[0] || [];
  const dataRow = sheetRows[1] || [];
  let wideTableDetected = false;

  headerRow.forEach((cell, colIdx) => {
    const label = normalizeLabel(cell);
    if (label && WIDE_TABLE_MAPPINGS_SURV[label]) {
      wideTableDetected = true;
      const mapping = WIDE_TABLE_MAPPINGS_SURV[label];
      const rawValue = String(dataRow[colIdx] ?? '').trim();

      let value: string | null = null;
      if (rawValue) {
        if (mapping.kind === 'date') {
          value = parseFlexibleDate(rawValue);
        } else {
          value = rawValue; // text as-is
        }
      } else {
        // Empty cell — save as null, which tells apply() to skip it
        value = null;
      }

      if (value !== null || rawValue === '') {
        // Include even if value is null, so we can distinguish
        // "blank in spreadsheet" from "not present in spreadsheet"
        parsed.push({
          label: label.charAt(0).toUpperCase() + label.slice(1),
          mapping,
          raw: rawValue,
          value: value,
        });
      }
    }
  });

  // Vertical pass: start at row 2 if wide table was detected, else row 0
  const verticalStartRow = wideTableDetected ? 2 : 0;
  for (let rowIdx = verticalStartRow; rowIdx < sheetRows.length; rowIdx++) {
    const row = sheetRows[rowIdx];
    if (!row || row.length < 2) continue;

    const labelRaw = normalizeLabel(row[0]);
    if (!labelRaw) continue; // Skip empty rows

    // Try column B first, fall back to C if B is blank (handles column shift)
    let rawValue = String(row[1] ?? '').trim();
    if (!rawValue && row[2]) {
      rawValue = String(row[2]).trim();
    }

    const mapping = FIELD_MAPPINGS_SURV[labelRaw];
    if (!mapping) continue; // Unrecognized label, skip

    let value: string | null = null;
    if (rawValue) {
      if (mapping.kind === 'date') {
        value = parseFlexibleDate(rawValue);
      } else if (mapping.kind === 'text') {
        value = rawValue;
      }
      // For kind === 'file', skip parsing (file uploads handled separately)
    } else {
      // Empty cell — save as null
      value = null;
    }

    if (value !== null || rawValue === '') {
      parsed.push({
        label: labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1),
        mapping,
        raw: rawValue,
        value: value,
      });
    }
  }

  return parsed;
}
