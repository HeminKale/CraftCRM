-- ============================================================
-- Migration 273: Recertification — Summary Excel Import, schema
--
-- Mirrors Surveillance 1's Sprint 7 (271/272) exactly in technique — no
-- separate summary table, direct import into recertification_clients__a
-- itself (confirmed decision: "Check sprint 7 of Surveillance 1 ... build
-- similar structure for recertification"). Field LIST differs from 271's,
-- verified field-by-field against the actual uploaded CSV
-- (`Untitled spreadsheet - Sheet2.csv`), not assumed from Surveillance 1's
-- list — see the differences called out below.
--
-- ── Vertical-list dates: 18 of 19 CSV rows already have a home ──────────
-- Checked against migrations 264-268 before writing anything here — no new
-- date columns needed for the vertical list:
--   Recertification intimation  → recert_intimation_sent_date__a
--   Application form             → recert_application_sent_date__a
--   Application acceptance       → recert_application_accepted_date__a
--   Quotation                    → recert_quotation_received_date__a
--   Client agreement              → recert_agreement_sent_date__a
--   Signed client agreement       → recert_agreement_signed_date__a
--   assign team                   → recert_team_assigned_date__a
--   Recert audit plan              → recert_plan_sent_date__a
--   Recert plan accept             → recert_plan_accepted_date__a
--   Recert ncr                      → recert_ncr_sent_date__a
--   Recert ncr RCA                   → recert_ncr_rca_uploaded_date__a
--   Recert ncr RCA acceptance         → recert_auditor_accepted_date__a
--   Recert ncr evidences               → recert_evidences_uploaded_date__a
--   Recert audit report                 → recert_report_sent_date__a
--   Recert tech review findings          → recert_tech_findings_date__a
--   CDC                                   → recert_cdc_date__a
--   certificate issue                     → recert_certificates_sent_date__a
--   (Recert ncr evidences acceptance has no CSV row either — matches your
--    matrix, which doesn't split it out as a separate checkpoint either.)
--
-- Two rows deliberately NOT given a column here:
--   "Recert tech review checklist" — judgment call, not a silent guess:
--     shares recert_tech_findings_date__a with "Recert tech review
--     findings" rather than getting its own column. The checklist file
--     (recert_tech_findings_file__a) has never had an independent date
--     column since Sprint 4 — adding one now would be new scope beyond
--     "map the CSV to what exists." Flag if you want a dedicated
--     recert_tech_findings_file_date__a instead.
--   "withdrawal letter" — genuinely out of scope. Confirmed against the
--     sprint plan: this matrix has no Suspension/Withdrawal chain at all
--     (deliberately, unlike Surveillance 1 which at least has one
--     *planned*). Left unmapped in recertSheetMapping.ts — the parser
--     already skips any label it doesn't recognize, same as it silently
--     skipped "type"/"Reg date" for both prior epics.
--
-- ── Wide-table metadata: only 2 of 29 CSV columns already exist on
-- recertification_clients__a (company_name__a, iso_standards__a) ──────────
-- Splitting the rest into two groups, unlike Surveillance 1's flat list:
--
-- (a) Historical/reference data about the client's ORIGINAL certification
--     (16 fields) — named to match Surveillance 1's own equivalents
--     exactly where the concept is the same (same reasoning: this is the
--     same KIND of data, just imported into a third object now).
-- (b) Fields genuinely specific to THIS recertification cycle (6 fields,
--     recert_-prefixed per this epic's own naming convention) — the CSV's
--     last five columns (Recert audit date, Recert auditor, Recert LA,
--     Recert Tech reviewer, Recert CDC) plus "Recert mandays". These have
--     no Surveillance 1 equivalent — that CSV's template didn't
--     distinguish "historical auditor" from "this cycle's auditor" the
--     way this one does.
--
-- recert_audit_date__a is worth flagging on its own: this closes a real,
-- pre-existing gap independent of summary import. External Client
-- (stage1/2_audit_date__a) and Surveillance 1 (surveillance_audit_date__a)
-- both have a manual "audit conducted on" field; Recertification's own
-- Sprint 3 never added one, even though RecertificationActionPanel's
-- "Conduct Recertification Audit" prompt implies one should exist. TEXT,
-- not DATE — matches the established "manual, no status implication"
-- convention for this exact kind of field on both prior objects.
--
-- Deliberately NOT mapped/created (matching precedent, not silently
-- guessing new scope):
--   "Reg date" — Surveillance 1's own Sprint 7 explicitly ignored this
--     too ("Reg date: ignored in import, only vertical dates used"). For
--     Recertification specifically it's even more ambiguous — a client
--     being recertified already has an original registration date that
--     lives on External Client, not a new event this cycle produces.
--   "type" — deferred everywhere in this app (New Client's own analysis
--     deferred it explicitly); self-evident from table membership here.
--   "ADDRESS" — Surveillance 1's own Sprint 7 also did not add an address
--     column, despite External Client having one. Same precedent followed
--     here, not a new decision.
--
-- recert_summary_pack__a: DEFAULT '[]'::jsonb and registered as type
-- 'files' (plural), NOT '{}'::jsonb/'file' the way Surveillance 1's
-- surv_audit_pack__a was — that was a minor pre-existing inconsistency
-- there (declared as a single-object default but always treated as an
-- array by its own append RPC). Recertification already has the correct
-- 'files'/'[]' convention established for recert_evidences__a and
-- recert_certificates__a (Sprints 3-4) — this follows that, not
-- Surveillance 1's inconsistency.
-- ============================================================

-- ── 1. New columns ─────────────────────────────────────────────────
ALTER TABLE tenant.recertification_clients__a
  -- (a) Historical/reference — original-certification metadata
  ADD COLUMN IF NOT EXISTS "certificate_no__a"          TEXT,
  ADD COLUMN IF NOT EXISTS "country__a"                 TEXT,
  ADD COLUMN IF NOT EXISTS "scope__a"                    TEXT,
  ADD COLUMN IF NOT EXISTS "iaf_code__a"                  TEXT,
  ADD COLUMN IF NOT EXISTS "no_of_employees__a"            TEXT,
  ADD COLUMN IF NOT EXISTS "total_mandays__a"                TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_manday__a"                 TEXT,
  ADD COLUMN IF NOT EXISTS "stage2_manday__a"                  TEXT,
  ADD COLUMN IF NOT EXISTS "auditor_name__a"                    TEXT,
  ADD COLUMN IF NOT EXISTS "tech_reviewer_name__a"                TEXT,
  ADD COLUMN IF NOT EXISTS "director_name__a"                      TEXT,
  ADD COLUMN IF NOT EXISTS "auditor_team__a"                        TEXT,
  ADD COLUMN IF NOT EXISTS "application_reviewer__a"                  TEXT,
  ADD COLUMN IF NOT EXISTS "lead_auditor__a"                            TEXT,
  ADD COLUMN IF NOT EXISTS "food_category__a"                            TEXT,
  ADD COLUMN IF NOT EXISTS "soa_date__a"                                  TEXT,
  -- (b) Recert-cycle-specific
  ADD COLUMN IF NOT EXISTS "recert_mandays__a"                            TEXT,
  ADD COLUMN IF NOT EXISTS "recert_audit_date__a"                          TEXT,
  ADD COLUMN IF NOT EXISTS "recert_auditor_name__a"                        TEXT,
  ADD COLUMN IF NOT EXISTS "recert_lead_auditor__a"                        TEXT,
  ADD COLUMN IF NOT EXISTS "recert_tech_reviewer_name__a"                  TEXT,
  ADD COLUMN IF NOT EXISTS "recert_cdc_name__a"                            TEXT,
  -- Summary sheet attachment
  ADD COLUMN IF NOT EXISTS "recert_summary_pack__a"                       JSONB DEFAULT '[]'::jsonb;

-- ── 2. Register new fields in tenant.fields per tenant ──────────────
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'recertification_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'certificate_no',           'Certificate No',                    'text',  false, false, 44, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'country',                  'Country',                           'text',  false, false, 45, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'scope',                    'Scope',                             'text',  false, false, 46, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'iaf_code',                 'IAF Code',                          'text',  false, false, 47, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'no_of_employees',          'Number of Employees',               'text',  false, false, 48, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'total_mandays',            'Total Mandays',                     'text',  false, false, 49, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_manday',            'Stage 1 Manday',                    'text',  false, false, 50, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_manday',            'Stage 2 Manday',                    'text',  false, false, 51, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'auditor_name',             'Auditor Name',                      'text',  false, false, 52, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'tech_reviewer_name',       'Tech Reviewer Name',                'text',  false, false, 53, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'director_name',            'Director Name',                     'text',  false, false, 54, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'auditor_team',             'Auditor Team',                      'text',  false, false, 55, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'application_reviewer',     'Application Reviewer',              'text',  false, false, 56, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'lead_auditor',             'Lead Auditor',                      'text',  false, false, 57, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'food_category',            'Food Category',                     'text',  false, false, 58, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'soa_date',                 'SOA Date',                          'text',  false, false, 59, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_mandays',           'Recertification Mandays',           'text',  false, false, 60, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_audit_date',        'Recertification Audit Date',        'text',  false, false, 61, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_auditor_name',      'Recertification Auditor',           'text',  false, false, 62, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_lead_auditor',      'Recertification Lead Auditor',      'text',  false, false, 63, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_tech_reviewer_name','Recertification Tech Reviewer',     'text',  false, false, 64, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_cdc_name',          'Recertification CDC',               'text',  false, false, 65, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_summary_pack',      'Summary Sheets',                    'files', false, false, 66, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- No new status__a picklist values — this migration only adds metadata
-- fields, the summary import writes into checkpoints that already exist
-- (Sprints 0-4), same as Surveillance 1's own 271 needed none either.
