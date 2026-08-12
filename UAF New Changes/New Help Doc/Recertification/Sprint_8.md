# Recertification — Sprint 8: Summary Excel Import

Unplanned addition to the original 0–7 sprint plan (Sprint 7 is QA, still the last
planned sprint) — mirrors Surveillance 1's own Sprint 7, which was added to its
plan the same way, after the fact, following New Client's original pattern.

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) →
> [`Sprint_0_1.md`](Sprint_0_1.md) → [`Sprint_2.md`](Sprint_2.md) →
> [`Sprint_3.md`](Sprint_3.md) → [`Sprint_4.md`](Sprint_4.md) →
> [`Sprint_5.md`](Sprint_5.md) → [`Sprint_6.md`](Sprint_6.md) → **this doc**.

**Confirmed before starting:** a real CSV template
(`Untitled spreadsheet - Sheet2.csv`) was supplied and checked field-by-field
against the live migrations (264–268) before writing anything — not assumed
from Surveillance 1's own field list. Architecture confirmed directly: *"Check
sprint 7 of Surveillance 1 ... build similar structure for recertification"* —
single-table direct import (matches Surveillance 1's own Sprint 7 as actually
built), not the heavier separate-`client_summary__a`-style table New Client
uses. Before writing the importer, `SurveilanceImport.tsx` was re-read fresh
(not from an earlier read this same session) after a discrepancy surfaced
between a memory note claiming "3 bugs fixed" and an earlier read that still
showed the buggy code — the file had been edited concurrently between the two
reads. Every RPC signature this sprint's code calls was verified against the
corrected version, not copied from the version with those bugs.

---

## Field-readiness check (done before writing any code)

**Vertical-list dates — 18 of 19 CSV rows already had a home**, all in
migrations 264–268, none new:

| CSV row | Column |
|---|---|
| Recertification intimation | `recert_intimation_sent_date__a` |
| Application form | `recert_application_sent_date__a` |
| Application acceptance | `recert_application_accepted_date__a` |
| Quotation | `recert_quotation_received_date__a` |
| Client agreement | `recert_agreement_sent_date__a` |
| Signed client agreement | `recert_agreement_signed_date__a` |
| assign team | `recert_team_assigned_date__a` |
| Recert audit plan | `recert_plan_sent_date__a` |
| Recert plan accept | `recert_plan_accepted_date__a` |
| Recert ncr | `recert_ncr_sent_date__a` |
| Recert ncr RCA | `recert_ncr_rca_uploaded_date__a` |
| Recert ncr RCA acceptance | `recert_auditor_accepted_date__a` |
| Recert ncr evidences | `recert_evidences_uploaded_date__a` |
| Recert audit report | `recert_report_sent_date__a` |
| Recert tech review findings | `recert_tech_findings_date__a` |
| CDC | `recert_cdc_date__a` |
| certificate issue | `recert_certificates_sent_date__a` |

Two deliberate decisions, not silent guesses:
- **"Recert tech review checklist"** shares `recert_tech_findings_date__a`
  with "Recert tech review findings" rather than getting a new column — the
  checklist file has never had an independent date since Sprint 4; adding one
  would be new scope beyond mapping the CSV to what exists.
- **"withdrawal letter"** is unmapped — genuinely out of scope, confirmed
  against the sprint plan (this matrix has no Suspension/Withdrawal chain at
  all, unlike Surveillance 1 which at least has one planned).

**Wide-table metadata — only 2 of 29 columns already existed**
(`company_name__a`, `iso_standards__a`). Everything else (27 columns) needed
either a new field or a deliberate "leave unmapped" decision — see migration
273's header for the full column-by-column reasoning. Net: **23 new columns**,
split into 16 historical/reference fields (named to match Surveillance 1's
own equivalents where the concept is identical) and 6 genuinely
Recert-cycle-specific fields (`recert_`-prefixed, no Surveillance 1
equivalent — that CSV's template didn't distinguish "historical" auditor/LA/
tech reviewer from "this cycle's").

**Real gap found, independent of this feature:** `recert_audit_date__a` — a
manual "audit conducted on" field. External Client and Surveillance 1 both
have one (`stage1/2_audit_date__a`, `surveillance_audit_date__a`);
Recertification's own Sprint 3 never added one, despite
`RecertificationActionPanel`'s "Conduct Recertification Audit" prompt implying
it should exist. Added here as part of this migration's field batch.

---

## What shipped

**`supabase/migrations/273_recert_summary_metadata_fields.sql`** — 23 new
columns + field registrations (display_order 44–66). No new `status__a`
values — same as Surveillance 1's own 271, this only adds metadata, it
doesn't add new checkpoints.

**`supabase/migrations/274_recert_summary_rpcs.sql`** — `upsert_recert_from_summary`
(text fields, dynamic `UPDATE` from `jsonb_each_text`, tenant-scoped) and
`append_recert_summary_pack_entry` (file attachment, JSONB array append).
One correction versus 272's equivalent: the "is this empty" check tests
`'[]'::jsonb` (matching `recert_summary_pack__a`'s actual default), not
`'{}'::jsonb` the way `append_renewal_audit_pack_entry` does — that was a
pre-existing minor inconsistency there (declared as a single-object default,
always treated as an array in practice), not repeated here.

**`app/commonfiles/core/components/custom/Recertification_Client/recertSheetMapping.ts`**
— field mappings, 19-status `RECERT_STAGE_PROGRESSION` (matches
`RECERT_STATUS_ORDER` in `RecordDetailView.tsx` exactly, same values/order),
combined wide-table + vertical-list parser. Own file, own dictionaries — not
imported from Surveillance 1's or External Client's mapping files.

**`RecertificationImport.tsx`** — the importer component. Written against the
**corrected** RPC signatures from the start, not copied from the version of
`SurveilanceImport.tsx` that shipped with 3 real bugs:
1. `get_object_records_with_references` needs the real object UUID
   (resolved via `get_tenant_objects`), not the object's name string.
2. `update_tenant_record`'s real signature is `(p_table_name, p_record_id,
   p_tenant_id, p_update_data)` — migration 231, the latest of its three
   redefinitions.
3. Stored file entries use `{bucket, path}`, never a bare `url` — every
   download path in this app signs a fresh URL from `{bucket, path}` on
   demand.

**`RecertificationSummaryTab.tsx`** — the Summary page itself, mirroring
`SurveilanceSummaryTab.tsx`'s architecture exactly: no new table, a
differently-shaped list/detail VIEW over `recertification_clients__a`'s
existing fields via the generic `get_object_records_with_references`. 4
identity/contact rows + 22 editable metadata rows (23 new fields minus the
file field, shown separately) + 19 read-only workflow-checkpoint dates (kept
read-only for the same reason `SurveilanceSummaryTab.tsx` does — RPC-owned,
risk of `status__a` desync if hand-edited here). List view: company, ISO
standards, certificate no, auditor, tech reviewer, status, certificate-issued
date.

**`CustomTabRenderer.tsx`** — `RecertificationSummaryTab` registered in the
component registry, same one-line pattern `NewRecertificationForm` already
uses. Only shared file this sprint touches.

---

## Verified against source before finalizing

- `npx tsc --noEmit -p .` — **zero errors** in every file this sprint added or
  touched. One pre-existing error found elsewhere in the project
  (`surveilanceSheetMapping.ts(26,90)` — a `FieldMapping.kind` type only
  allowing `'date' | 'text'` but assigned `'file'`) — confirmed **not**
  introduced by this sprint (that file was only read, never edited) and left
  untouched, per the standing rule against touching Surveillance 1 code
  without explicit instruction.
- `git diff --stat` / `git status` checked directly — confirmed zero
  Surveillance 1 or External Client files were modified by this sprint's
  work, only read for reference.
- All 23 new field names double-checked against 273's own `INSERT INTO
  tenant.fields` list before being used in `recertSheetMapping.ts` and
  `RecertificationSummaryTab.tsx`'s `ROWS` array — no typos carried through
  three files.

## Not done in this sprint (by design)

- **Page Layout placement** of the 23 new fields — your side, same as every
  prior sprint.
- **Wiring `RecertificationSummaryTab` into an actual tab** — you said you'll
  do this yourself, "in similar way as the summary tab is created for new
  client." The component is registered in `CustomTabRenderer.tsx` and ready;
  the Object Manager → Tabs step is manual, same handoff Surveillance 1's own
  `SurveilanceImport.tsx`/`SurveilanceSummaryTab.tsx` got.
- **Live testing** — no service-role key available to test end-to-end from
  here, same caveat every migration in this repo has.
- Migrations 273/274 not yet run against the live database.

---

## Manual steps (post-build, pre-testing)

1. Run `273_recert_summary_metadata_fields.sql`, then `274_recert_summary_rpcs.sql`.
2. Add the 23 new fields to `recertification_clients__a`'s Page Layout
   (Object Manager → Recertification Clients → Page Layout).
3. Wire `RecertificationSummaryTab` into a tab (Object Manager → Tabs) — your
   side, as noted above.
4. Smoke test: upload the actual CSV (as an `.xlsx`) via the new Summary tab
   against a real recertification record, confirm the preview shows correct
   values for both text and date fields, confirm status advances correctly,
   confirm the sheet appears under "Summary Sheets" and downloads correctly.
