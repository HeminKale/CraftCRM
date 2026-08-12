// Recertification summary-sheet parsing — extracted for RecertificationImport.tsx
// Mirrors Surveillance 1's surveilanceSheetMapping.ts pattern exactly (same
// combined wide-table + vertical-list parser, same date helpers). Own file,
// own dictionaries — not imported from Surveillance 1's or External Client's
// mapping files, same field-name-collision lesson already learned from
// cdc_report/Team_Assigned across this whole build.
//
// New columns added in migration 273. Date columns from migrations 264-268.
// Field list verified against the actual uploaded CSV
// ("Untitled spreadsheet - Sheet2.csv"), not assumed from Surveillance 1's
// own Sprint 7 list — see 273's header for the full field-by-field diff.

export interface FieldMapping {
  extColumn?: string;
  kind: 'date' | 'text' | 'file';
}

// Every recognized Excel label for Recertification summary import.
export const FIELD_MAPPINGS_RECERT: Record<string, FieldMapping> = {
  // ─── Vertical list — per-checkpoint workflow dates ───
  // One label/value pair per row. Matches the 19-status flow from Sprints
  // 0-4 exactly (RECERT_STATUS_ORDER in RecordDetailView.tsx).

  'recertification intimation':      { extColumn: 'recert_intimation_sent_date__a',     kind: 'date' },
  'application form':                { extColumn: 'recert_application_sent_date__a',    kind: 'date' },
  'application acceptance':          { extColumn: 'recert_application_accepted_date__a',kind: 'date' },
  'quotation':                       { extColumn: 'recert_quotation_received_date__a',  kind: 'date' },
  'client agreement':                { extColumn: 'recert_agreement_sent_date__a',      kind: 'date' },
  'signed client agreement':         { extColumn: 'recert_agreement_signed_date__a',    kind: 'date' },
  'assign team':                     { extColumn: 'recert_team_assigned_date__a',       kind: 'date' },
  'recert audit plan':               { extColumn: 'recert_plan_sent_date__a',           kind: 'date' },
  'recert plan accept':              { extColumn: 'recert_plan_accepted_date__a',       kind: 'date' },
  'recert ncr':                      { extColumn: 'recert_ncr_sent_date__a',            kind: 'date' },
  'recert ncr rca':                  { extColumn: 'recert_ncr_rca_uploaded_date__a',    kind: 'date' },
  'recert ncr rca acceptance':       { extColumn: 'recert_auditor_accepted_date__a',    kind: 'date' },
  'recert ncr evidences':            { extColumn: 'recert_evidences_uploaded_date__a',  kind: 'date' },
  'recert audit report':             { extColumn: 'recert_report_sent_date__a',         kind: 'date' },
  'recert tech review findings':     { extColumn: 'recert_tech_findings_date__a',       kind: 'date' },
  // Judgment call, not a silent guess (flagged in 273's header too): shares
  // the findings date rather than getting its own column — the checklist
  // file has never had an independent date since Sprint 4.
  'recert tech review checklist':    { extColumn: 'recert_tech_findings_date__a',       kind: 'date' },
  'cdc':                             { extColumn: 'recert_cdc_date__a',                 kind: 'date' },
  'certificate issue':               { extColumn: 'recert_certificates_sent_date__a',   kind: 'date' },
  // 'withdrawal letter' deliberately NOT included — out of scope, this
  // matrix has no withdrawal chain at all (see 273's header). Unrecognized
  // labels are silently skipped by the parser below, same as every other
  // epic's importer already does for out-of-scope template rows.

  // ─── Wide table — company/audit metadata ───
  // Row 0 headers, row 1 data.

  'company name':                    { extColumn: 'company_name__a',              kind: 'text' },
  'standard':                        { extColumn: 'iso_standards__a',             kind: 'text' },
  'certificate no':                  { extColumn: 'certificate_no__a',            kind: 'text' },
  'country':                         { extColumn: 'country__a',                   kind: 'text' },
  'scope':                           { extColumn: 'scope__a',                     kind: 'text' },
  'iaf code':                        { extColumn: 'iaf_code__a',                  kind: 'text' },
  'no of empl':                      { extColumn: 'no_of_employees__a',           kind: 'text' },
  'total mandays':                   { extColumn: 'total_mandays__a',             kind: 'text' },
  'stg 1 manday':                    { extColumn: 'stage1_manday__a',             kind: 'text' },
  'stg 2 manday':                    { extColumn: 'stage2_manday__a',             kind: 'text' },
  // Both Auditor Stg 1/2 collapse into one field (last value wins) — same
  // pattern Surveillance 1's own mapping uses, and matches the sample CSV,
  // whose two columns already hold identical newline-separated names.
  'auditor stg 1':                   { extColumn: 'auditor_name__a',              kind: 'text' },
  'auditor stg 2':                   { extColumn: 'auditor_name__a',              kind: 'text' },
  'tech reviewer':                   { extColumn: 'tech_reviewer_name__a',        kind: 'text' },
  'director name':                   { extColumn: 'director_name__a',             kind: 'text' },
  'recert mandays':                  { extColumn: 'recert_mandays__a',            kind: 'text' },
  'auditor team':                    { extColumn: 'auditor_team__a',              kind: 'text' },
  'application reviewer name':       { extColumn: 'application_reviewer__a',      kind: 'text' },
  'lead auditor':                    { extColumn: 'lead_auditor__a',              kind: 'text' },
  'food category':                   { extColumn: 'food_category__a',             kind: 'text' },
  'soa date':                        { extColumn: 'soa_date__a',                  kind: 'text' },
  // Recert-cycle-specific — no Surveillance 1 equivalent, that CSV's
  // template didn't distinguish "historical" from "this cycle" the way
  // this one does.
  'recert audit date':               { extColumn: 'recert_audit_date__a',         kind: 'text' },
  'recert auditor':                  { extColumn: 'recert_auditor_name__a',       kind: 'text' },
  'recert la':                       { extColumn: 'recert_lead_auditor__a',       kind: 'text' },
  'recert tech reviewer':            { extColumn: 'recert_tech_reviewer_name__a', kind: 'text' },
  'recert cdc':                      { extColumn: 'recert_cdc_name__a',           kind: 'text' },

  // Deliberately excluded (see 273's header for full reasoning, not
  // repeated per-row here): 'reg date', 'type', 'address',
  // 'surveillance 1 mandays'.
};

// Wide-table metadata columns only (row 0 headers, row 1 data). Deliberately
// excludes every column that only appears in the vertical list — there is
// no overlap here the way External Client's sheet had (no wide-table column
// restates a vertical-list date), so this is a straight subset of the
// non-date entries above.
export const WIDE_TABLE_MAPPINGS_RECERT: Record<string, FieldMapping> = {
  'company name':              FIELD_MAPPINGS_RECERT['company name'],
  'standard':                  FIELD_MAPPINGS_RECERT['standard'],
  'certificate no':            FIELD_MAPPINGS_RECERT['certificate no'],
  'country':                   FIELD_MAPPINGS_RECERT['country'],
  'scope':                     FIELD_MAPPINGS_RECERT['scope'],
  'iaf code':                  FIELD_MAPPINGS_RECERT['iaf code'],
  'no of empl':                FIELD_MAPPINGS_RECERT['no of empl'],
  'total mandays':             FIELD_MAPPINGS_RECERT['total mandays'],
  'stg 1 manday':              FIELD_MAPPINGS_RECERT['stg 1 manday'],
  'stg 2 manday':              FIELD_MAPPINGS_RECERT['stg 2 manday'],
  'auditor stg 1':             FIELD_MAPPINGS_RECERT['auditor stg 1'],
  'auditor stg 2':             FIELD_MAPPINGS_RECERT['auditor stg 2'],
  'tech reviewer':             FIELD_MAPPINGS_RECERT['tech reviewer'],
  'director name':             FIELD_MAPPINGS_RECERT['director name'],
  'recert mandays':            FIELD_MAPPINGS_RECERT['recert mandays'],
  'auditor team':              FIELD_MAPPINGS_RECERT['auditor team'],
  'application reviewer name': FIELD_MAPPINGS_RECERT['application reviewer name'],
  'lead auditor':              FIELD_MAPPINGS_RECERT['lead auditor'],
  'food category':             FIELD_MAPPINGS_RECERT['food category'],
  'soa date':                  FIELD_MAPPINGS_RECERT['soa date'],
  'recert audit date':         FIELD_MAPPINGS_RECERT['recert audit date'],
  'recert auditor':            FIELD_MAPPINGS_RECERT['recert auditor'],
  'recert la':                 FIELD_MAPPINGS_RECERT['recert la'],
  'recert tech reviewer':      FIELD_MAPPINGS_RECERT['recert tech reviewer'],
  'recert cdc':                FIELD_MAPPINGS_RECERT['recert cdc'],
};

// Status progression for Recertification (19 statuses total). Mirrors
// RECERT_STATUS_ORDER in RecordDetailView.tsx exactly (Sprint 5) — same
// values, same order, so the frontend lock mechanism, the workflow bar, and
// this importer's status-advance logic never disagree.
export const RECERT_STAGE_PROGRESSION: { column: string; status: string }[] = [
  { column: 'recert_intimation_sent_date__a',      status: 'Recert_Intimation_Sent' },
  { column: 'recert_application_sent_date__a',     status: 'Recert_Application_Sent' },
  { column: 'recert_application_accepted_date__a', status: 'Recert_Application_Accepted' },
  { column: 'recert_quotation_received_date__a',   status: 'Recert_Quotation_Received' },
  { column: 'recert_agreement_sent_date__a',        status: 'Recert_Agreement_Sent' },
  { column: 'recert_agreement_signed_date__a',       status: 'Recert_Agreement_Signed' },
  { column: 'recert_team_assigned_date__a',           status: 'Recert_Team_Assigned' },
  { column: 'recert_plan_sent_date__a',                status: 'Recert_Plan_Sent' },
  { column: 'recert_plan_accepted_date__a',             status: 'Recert_Plan_Accepted' },
  { column: 'recert_ncr_sent_date__a',                   status: 'Recert_NCR_Sent' },
  { column: 'recert_ncr_rca_uploaded_date__a',            status: 'Recert_NCR_RCA_Uploaded' },
  { column: 'recert_auditor_accepted_date__a',             status: 'Recert_Auditor_Accepted' },
  { column: 'recert_evidences_uploaded_date__a',            status: 'Recert_Evidences_Uploaded' },
  { column: 'recert_evidences_accepted_date__a',             status: 'Recert_Evidences_Accepted' },
  { column: 'recert_report_sent_date__a',                     status: 'Recert_Report_Sent' },
  { column: 'recert_tech_findings_date__a',                    status: 'Recert_Tech_Findings_Given' },
  { column: 'recert_closed_date__a',                             status: 'Recert_Closed' },
  { column: 'recert_cdc_date__a',                                 status: 'Recert_CDC_Approved' },
  { column: 'recert_certificates_sent_date__a',                    status: 'Recert_Certificate_Issued' },
];

// ──────────────────────────────────────────────────────────────
// Shared date parsing & formatting (exact same as Surveillance 1's /
// External Client's — duplicated deliberately, not imported cross-file,
// per this build's own "own file, no cross-epic imports" convention)
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

// Combined wide-table + vertical-list parser. Exact same logic as
// Surveillance 1's/External Client's — wide-table pass first (row 0
// headers, row 1 data), then vertical pass starting at row 2 if a wide
// table was detected (so row 0's own header text never misreads as a
// vertical label/value pair). Vertical pass reads column B, falling back
// to column C when B is blank (handles the column-shift quirk a real
// External Client production sheet already exposed).
export function parseSummaryWorkbookRows(sheetRows: any[][]): ParsedRow[] {
  const parsed: ParsedRow[] = [];

  const headerRow = sheetRows[0] || [];
  const dataRow = sheetRows[1] || [];
  let wideTableDetected = false;

  headerRow.forEach((cell, colIdx) => {
    const label = String(cell ?? '').trim().toLowerCase();
    if (label && WIDE_TABLE_MAPPINGS_RECERT[label]) {
      wideTableDetected = true;
      const mapping = WIDE_TABLE_MAPPINGS_RECERT[label];
      const rawValue = String(dataRow[colIdx] ?? '').trim();

      let value: string | null = null;
      if (rawValue) {
        value = mapping.kind === 'date' ? parseFlexibleDate(rawValue) : rawValue;
      }

      if (value !== null || rawValue === '') {
        parsed.push({
          label: label.charAt(0).toUpperCase() + label.slice(1),
          mapping,
          raw: rawValue,
          value,
        });
      }
    }
  });

  const verticalStartRow = wideTableDetected ? 2 : 0;
  for (let rowIdx = verticalStartRow; rowIdx < sheetRows.length; rowIdx++) {
    const row = sheetRows[rowIdx];
    if (!row || row.length < 2) continue;

    const labelRaw = String(row[0] ?? '').trim().toLowerCase();
    if (!labelRaw) continue;

    let rawValue = String(row[1] ?? '').trim();
    if (!rawValue && row[2]) {
      rawValue = String(row[2]).trim();
    }

    const mapping = FIELD_MAPPINGS_RECERT[labelRaw];
    if (!mapping) continue; // Unrecognized label (e.g. "withdrawal letter") — skip

    let value: string | null = null;
    if (rawValue) {
      if (mapping.kind === 'date') value = parseFlexibleDate(rawValue);
      else if (mapping.kind === 'text') value = rawValue;
      // kind === 'file': skip parsing, handled separately
    }

    if (value !== null || rawValue === '') {
      parsed.push({
        label: labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1),
        mapping,
        raw: rawValue,
        value,
      });
    }
  }

  return parsed;
}
