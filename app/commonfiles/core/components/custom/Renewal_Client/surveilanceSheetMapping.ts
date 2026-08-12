// Surveillance 1 (Renewal) summary-sheet parsing — extracted for SurveilanceImport.tsx
// Mirrors External Client's summarySheetMapping.ts pattern exactly.
// New columns added in migration 265; date columns from migrations 256–260.

export interface FieldMapping {
  extColumn?: string;
  summaryColumn?: string;
  kind: 'date' | 'text';
}

// Every recognized Excel label for Surveillance 1 summary import
export const FIELD_MAPPINGS_SURV: Record<string, FieldMapping> = {
  // ─── Section B — Per-checkpoint workflow dates ───
  // Vertical list, one label/value pair per row.
  // Surveillance 1 has no client_summary__a equivalent, so no summaryColumn targets.

  'surveillance intimation letter':      { extColumn: 'intimation_sent_date__a',         kind: 'date' },
  'intimation acceptance':               { extColumn: 'intimation_accepted_date__a',     kind: 'date' },
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

  // Also include legacy/alternate labels if the template changes
  'team assigned':                       { extColumn: 'team_assigned_date__a',           kind: 'date' },
  'surv closed':                         { extColumn: 'surv_closed_date__a',             kind: 'date' },

  // ─── Section A — Company/audit metadata ───
  // Wide table, one header row → one data row.

  'company name':                        { extColumn: 'company_name__a',                 kind: 'text' },
  'standard':                            { extColumn: 'iso_standards__a',                kind: 'text' },
  'certificate no':                      { extColumn: 'certificate_no__a',               kind: 'text' },
  'country':                             { extColumn: 'country__a',                      kind: 'text' },
  'address':                             { extColumn: 'company_name__a',                 kind: 'text' }, // Coupled with company name per External Client
  'scope':                               { extColumn: 'scope__a',                        kind: 'text' },
  'iaf code':                            { extColumn: 'iaf_code__a',                     kind: 'text' },
  'no of empl':                          { extColumn: 'no_of_employees__a',              kind: 'text' },
  'surv mandays':                        { extColumn: 'surv_mandays__a',                 kind: 'text' },
  'surveillance 1 mandays':              { extColumn: 'surv_mandays__a',                 kind: 'text' }, // Alternate label
  'auditor team':                        { extColumn: 'auditor_team__a',                 kind: 'text' },
  'auditor stg 1':                       { extColumn: 'auditor_name__a',                 kind: 'text' }, // Text name, not ID
  'auditor name':                        { extColumn: 'auditor_name__a',                 kind: 'text' }, // Alternate
  'tech reviewer':                       { extColumn: 'tech_reviewer_name__a',           kind: 'text' }, // Text name, not ID
  'tech reviewer name':                  { extColumn: 'tech_reviewer_name__a',           kind: 'text' }, // Alternate
  'director name':                       { extColumn: 'director_name__a',                kind: 'text' },
  'lead auditor':                        { extColumn: 'lead_auditor__a',                 kind: 'text' },
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
  'surv mandays':              FIELD_MAPPINGS_SURV['surv mandays'],
  'surveillance 1 mandays':    FIELD_MAPPINGS_SURV['surveillance 1 mandays'],
  'auditor team':              FIELD_MAPPINGS_SURV['auditor team'],
  'auditor stg 1':             FIELD_MAPPINGS_SURV['auditor stg 1'],
  'auditor name':              FIELD_MAPPINGS_SURV['auditor name'],
  'tech reviewer':             FIELD_MAPPINGS_SURV['tech reviewer'],
  'tech reviewer name':        FIELD_MAPPINGS_SURV['tech reviewer name'],
  'director name':             FIELD_MAPPINGS_SURV['director name'],
  'lead auditor':              FIELD_MAPPINGS_SURV['lead auditor'],
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

// Combined wide-table + vertical-list parser
// Exact same logic as External Client's summarySheetMapping.ts.
export function parseSummaryWorkbookRows(sheetRows: any[][]): ParsedRow[] {
  const parsed: ParsedRow[] = [];

  // Wide-table pass: row 0 as headers, row 1 as the single data row
  const headerRow = sheetRows[0] || [];
  const dataRow = sheetRows[1] || [];
  let wideTableDetected = false;

  headerRow.forEach((cell, colIdx) => {
    const label = String(cell ?? '').trim().toLowerCase();
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

    const labelRaw = String(row[0] ?? '').trim().toLowerCase();
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
