# Surveillance 1 (Renewal) — Summary Excel Import Analysis

> **⚠️ SUPERSEDED — kept for historical record only, not authoritative.**
> This was the pre-build analysis; the actual build happened afterward and
> diverged from it in real ways (migration numbers, field names, and 4
> mapping bugs found by re-checking against the real sheet). **For current
> field mappings, migration numbers, and schema, read
> [`Sprints/Sprint_7.md`](Sprints/Sprint_7.md) — specifically §6 (what
> shipped), §11 (Summary tab + 3 RPC bugs), and §12 (mapping re-verified
> against the real sheet, address/CDC-name/team-column fixes).** Known
> drift from this doc, so you don't get misled reading below:
> - "migration 265" here → actually shipped as **271/272** (265 was already
>   claimed by Recertification's own work by build time)
> - §3's "ADDRESS → company_name__a (coupled)" was an early guess that
>   shipped as a real bug, since fixed — see §12
> - §3/§6 don't mention `cdc_name__a` or the `surv `-prefixed
>   auditor/tech-reviewer/lead-auditor source columns — those were only
>   discovered when the real sample sheet was re-checked field-by-field
>   after the first build, see §12
> - Every item in "Clarifications needed from you" (bottom of this doc) was
>   answered during the actual build — answers are in Sprint_7.md §6/§11/§12,
>   not reflected here

**Status:** Analysis only — no code/migrations written yet.

This document maps your Surveillance 1 summary CSV against what's currently in the `tenant.renewal_clients__a` schema, to decide whether and how to build a summary import tool like External Client has.

---

## 1. Your CSV structure

The CSV you provided has two sections:

### Section A — Wide metadata (one row of company/audit info)
- COMPANY NAME, Standards, Certificate no, Country, Reg date, type, ADDRESS, SCOPE, IAF Code, No of empl
- Surveillance 1 mandays, Recert mandays, auditor team, auditor names, tech reviewer, director name
- Lead auditor, application reviewer name, Food category, SOA Date

### Section B — Vertical milestone checklist (one row per checkpoint)
- Columns: milestone name, "date capture" (implied)
- Rows: surveillance intimation letter, surv audit plan, surv plan accept, surv ncr, surv ncr RCA, surv ncr RCA acceptance, surv audit report, surv tech review findings, surv tech review checklist, CDC, certificate issue
- Plus legacy suspension/withdrawal rows (not in scope for current build)

---

## 2. Date field coverage — all 13 Surveillance 1 dates ARE in your schema

| Your CSV Checkpoint | Required Date Field | Our Actual Column | Status |
|---|---|---|---|
| surveillance intimation letter | date capture | `intimation_sent_date__a` | ✅ |
| — | acceptance date | `intimation_accepted_date__a` | ✅ |
| surv audit plan | date capture | `surv_plan_sent_date__a` | ✅ |
| surv plan accept | date capture | `surv_plan_accepted_date__a` | ✅ |
| — | (plan remarks captured separately) | `surv_plan_client_remarks__a` | ✅ |
| surv ncr | date capture | `surv_ncr_sent_date__a` | ✅ |
| surv ncr RCA | (upload implied) | `surv_ncr_rca_uploaded_date__a` | ✅ |
| surv ncr RCA acceptance | date capture | `surv_auditor_accepted_date__a` | ✅ |
| surv audit report | date capture | `surv_report_sent_date__a` | ✅ |
| surv tech review findings | (findings + checklist) | `surv_tech_findings_file__a` (checklist), `surv_tech_findings_notes__a` | ✅ |
| CDC | date capture | `cdc_date__a` | ✅ |
| certificate issue | date capture | `certificates_sent_date__a` | ✅ |

**Tally:** ✅ **All 13 date checkpoints have corresponding columns.** No schema gaps.

**Also present:** `team_assigned_date__a`, `surv_closed_date__a`, `surv_closure_notes__a` (extras beyond your CSV's checkpoints).

---

## 3. Metadata field mapping — Section A wide table

| Your CSV Column | Target Column (renewal_clients__a) | Type | Status |
|---|---|---|---|
| COMPANY NAME | `company_name__a` | TEXT | ✅ |
| Standards | `iso_standards__a` | TEXT | ✅ |
| Certificate no | (not in renewal schema) | — | ❌ New field needed |
| Country | (not in renewal schema) | — | ❌ New field needed |
| Reg date | (ambiguous — see note below) | — | ⚠️ Need clarification |
| type | (not in renewal schema; deferred per Recert plan) | — | ❌ Deferred |
| ADDRESS | `company_name__a` (coupled; see note) | — | ⚠️ |
| SCOPE | `scope__a` (would need to add) | TEXT | ❌ New field needed |
| IAF Code | (not in renewal schema) | — | ❌ New field needed |
| No of empl | (not in renewal schema) | — | ❌ New field needed |
| total mandays | (not in renewal schema) | — | ❌ New field needed |
| Stg 1 manday | (not in renewal schema) | — | ❌ New field needed |
| stg 2 manday | (not in renewal schema; and Stage 2 doesn't apply to Surveillance 1) | — | ❌ N/A |
| Auditor Stg 1 | `auditor_id__a` (or `auditor_team__a` text) | UUID or TEXT | ⚠️ |
| Auditor Stg 2 | (doesn't apply to Surveillance 1) | — | ❌ N/A |
| Tech Reviewer | `tech_reviewer_id__a` | UUID | ⚠️ |
| Director name | (not in renewal schema) | — | ❌ New field needed |
| Surveillance 1 mandays | `surv_plan_sent_date__a` (coupled, not separate) | — | ⚠️ |
| auditor team | (not in renewal schema) | — | ❌ New field needed |
| application reviewer name | (not in renewal schema) | — | ❌ New field needed |
| lead auditor | (not in renewal schema) | — | ❌ New field needed |
| Food category | (standard-specific, optional) | TEXT | ❌ New field needed |
| SOA Date | (standard-specific, optional) | TEXT | ❌ New field needed |

**Tally:** ✅ 4 fields exist on renewal_clients__a; ⚠️ 5 fields need clarification/adjustment; ❌ **14 metadata fields need to be added to the schema** to match your CSV.

---

## 4. How New Client Summary actually works (reference)

**Two separate tables:**
- `tenant.external_clients__a` — main record (all Stage 1/2 dates, plus new metadata fields)
- `tenant.client_summary__a` — summary-only record (coarser fields: stage1_date vs. per-checkpoint dates)

**Import workflow (StageDateImport.tsx):**
1. Parse Excel (two sections: wide metadata + vertical date list)
2. For CRM/Admin only, upload sheet → preview changes → apply
3. On apply:
   - Write all fields to `external_clients__a`
   - Write matching fields to `client_summary__a` (if that table has a coarser version of the field)
   - Compute `status__a` based on which dates are present
   - Attach the uploaded file itself to the Summary record (`audit_pack__a` file field)

**Mapping table:**
- `FIELD_MAPPINGS` (shared dict) — label → {extColumn?, summaryColumn?, kind}
- `STAGE_PROGRESSION` — column → next status (used to auto-advance status on import)

**Code:** `StageDateImport.tsx` + `summarySheetMapping.ts` (shared parsing logic)

---

## 5. Open questions before building Surveillance 1 summary import

### Q1: Do you need a separate `renewal_summary__a` table?

**External Client has one** because a single external client can have many renewal/stage audits. The summary is a read-only aggregate view per external client, not per audit.

**Surveillance 1 is different:** each `renewal_clients__a` record is ONE audit cycle for ONE external client. A summary table would just duplicate the same record.

**Recommendation:** Put the metadata fields directly on `renewal_clients__a`. No separate table needed. The import tool would update the same table, not a parallel summary record.

### Q2: Are "Auditor Stg 1" and "Tech Reviewer" in your CSV the *names* (text) or *assignments* (user IDs)?

Current schema has:
- `auditor_id__a` (UUID, set via `assign_surv_team` RPC only, NOT in tenant.fields)
- `tech_reviewer_id__a` (UUID, set via `assign_surv_team` RPC only, NOT in tenant.fields)

Your CSV shows *names* (`Ahmed Matashar Al-Azzun`, `aniket kalaskar`), not IDs.

**Three paths:**
1. **Create a text field** `auditor_name__a` / `tech_reviewer_name__a` for the CSV to import, keep the UUID fields as-is (for RPC assignment). Both stay independently writable.
2. **Deprecate the UUID fields** and use the text names only (loses the programmatic assignment step).
3. **Lookup by name** in the import (complex, assumes name uniqueness, brittle if a name typo appears in the CSV).

**Recommendation:** Path 1 — add text fields. Matches External Client's split between `stage1_auditor__a` (text summary field) and the separate RPC-driven assignment.

### Q3: "Surveillance 1 mandays" — is this a single count, or separate breakdown?

Your CSV shows "3" as the Surveillance 1 mandays value. External Client breaks this out as `stage1_manday__a` + `stage2_manday__a` (both text fields, matching the wide-table columns you'd import).

**Recommendation:** For Surveillance 1, create a single `surv_mandays__a` field (text, not date). Don't split it like Stage 1/2.

### Q4: Should `status__a` auto-advance on import, like External Client?

External Client's importer auto-computes status based on which dates are present (via `STAGE_PROGRESSION`). Surveillance 1's status is also date-driven (`Intimation_Sent` → `Surv_Plan_Accepted` → ... → `Certificate_Issued`).

**Recommendation:** Yes, same behavior. Compute the "furthest" status reached based on present dates, advance only if moving forward (never backward).

### Q5: Where should the 14 new metadata fields go in the schema?

Current `renewal_clients__a` has display_order up to ~37. New fields would need registration in `tenant.fields` with appropriate display_orders, and placement on the Object Manager → Page Layout.

**Recommendation:** Batch them into a new migration, similar to migration 241 (which added 16 fields to External Client). Same pattern: DO block registering all fields per tenant.

---

## 6. Proposed next steps (if you want to proceed)

### A. Schema migration (migration TBD, let's call it 265_surv_metadata_fields.sql)

Add these columns to `tenant.renewal_clients__a`:
- `certificate_no__a` (TEXT)
- `country__a` (TEXT)
- `scope__a` (TEXT)
- `iaf_code__a` (TEXT)
- `no_of_employees__a` (TEXT)
- `total_mandays__a` (TEXT) [generic across audit types]
- `surv_mandays__a` (TEXT) [Surveillance 1 specific]
- `auditor_name__a` (TEXT) [distinct from auditor_id__a UUID]
- `tech_reviewer_name__a` (TEXT) [distinct from tech_reviewer_id__a UUID]
- `director_name__a` (TEXT)
- `auditor_team__a` (TEXT)
- `application_reviewer__a` (TEXT)
- `lead_auditor__a` (TEXT)
- `food_category__a` (TEXT)
- `soa_date__a` (TEXT) [date-like but no status implication, same as stage1_audit_date__a]

Register all 15 in `tenant.fields` per tenant.

### B. Extend the importer (SurveilanceImport.tsx, new file)

Create a new component similar to `StageDateImport.tsx`, but:
- Input: Surveillance 1 CSV with the same two-section structure (wide metadata + vertical dates)
- Output: Update a single `renewal_clients__a` record (no separate summary table)
- Reuse the shared field-mapping pattern, but with Surveillance 1–specific mappings

### C. Add to surveillance workflow bar (RenewalWorkflowBar.tsx)

Status progression for Surveillance 1 (13 statuses) is already built. The importer would need to know this same progression to auto-compute status.

### D. Manual tests post-migration

1. Does the CSV parse correctly with both wide + vertical sections?
2. Do all 13 dates populate correctly?
3. Does `status__a` advance to the correct stage based on which dates are present?
4. Can the imported file itself be attached (like External Client does)?

---

## 7. What's NOT in scope (yet)

- **Separate `renewal_summary__a` table:** Not needed; everything lives on `renewal_clients__a`.
- **Recertification variant:** The CSV shows "Recert mandays" in the wide table, but Recertification is a separate epic with its own schema. Defer per the Recertification plan.
- **PDF parsing:** External Client's importer supports both Excel and PDF, but PDF parsing is brittle and not yet validated. Stick to Excel only for now.
- **Suspension/Withdrawal rows:** Your CSV has them, but they're out of the current Surveillance 1 scope.

---

## 8. Quick wins vs. effort

| Feature | Effort | Impact | Recommendation |
|---|---|---|---|
| Add 15 metadata columns + register in tenant.fields | **Low** (one migration, ~50 lines) | **Medium** — enables import, but fields are manual-edit-only unless importer is built | **Do it** — low-hanging fruit |
| Build SurveilanceImport.tsx component (reuse summarySheetMapping) | **Medium** (~250–300 lines, most is parsing) | **High** — enables bulk import from Excel, saves manual data entry | **Do it next session** — same pattern as External Client, proven approach |
| Create new migration for the import (status computation, file attachment) | **Low** (standard RPC extension pattern, reuse finalize_file_upload logic) | **Medium** — needed to support import end-to-end | **Do it with importer** |

---

## 9. Comparison: External Client vs. Surveillance 1 summary approach

| Aspect | External Client | Surveillance 1 (proposed) |
|---|---|---|
| Main table | `external_clients__a` (one per client) | `renewal_clients__a` (one per audit cycle) |
| Summary table | `client_summary__a` (one per client, aggregate) | None — would duplicate renewal_clients__a |
| Import target | Two tables (external_clients + client_summary) | One table (renewal_clients__a only) |
| Metadata fields | Batch migration 241 (16 new fields) | Batch migration 265 (15 new fields) |
| Date progression | 15 stages (Application → Registration) | 13 stages (Intimation → Certificate) |
| File attachment | Attached to client_summary__a.audit_pack__a | Should attach to renewal_clients__a (new field?) |
| CRM/Admin gate | Yes, `isCrmOrAdmin` (StageDateImport) | Yes, proposed `isCrmOrAdmin` (SurveilanceImport) |

---

## Clarifications needed from you

1. **Auditor/Tech Reviewer:** Are those text names in the CSV meant to populate `auditor_name__a` (text) and keep `auditor_id__a` (UUID) for the RPC assignment), or do they replace the IDs?
2. **"Reg date" vs. real registration date:** In your CSV, one row shows "Reg date: 13 August 2025" — is this the Surveillance 1 invite date, or something else? (External Client's "registration date" is the final approval; Surveillance 1 doesn't have that concept yet.)
3. **Stage 2 mandays:** Your CSV shows both "Stg 1" and "Stg 2" mandays, but Surveillance 1 only has one audit cycle, no Stage 2. Should we:
   - Add only `surv_mandays__a` (single field)?
   - Or add both `surv_stage1_mandays__a` and `surv_stage2_mandays__a` for future Surveillance 2?
4. **File attachment for the summary sheet:** Should the uploaded CSV/Excel itself be stored somewhere? (External Client attaches to `client_summary__a.audit_pack__a`. Surveillance 1 doesn't have a summary table — should we add a `surv_audit_pack__a` field to `renewal_clients__a`, or skip the attachment?)
