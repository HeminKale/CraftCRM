# Sprint 3 — Decision Gate: answers received (2026-08-01)

## Q1 — Apply migration 239 (clientAgreement__c CRM-only lock)?

**Your answer:** wanted to verify "not applied" via Supabase first rather than
trust the doc's claim. Fair — I can't query `tenant.*` from this repo (schema
not exposed over PostgREST, no direct Postgres connection string anywhere in
`.env.local` or the repo). Run this and send me the result:

```sql
SELECT
  prosrc ILIKE '%clientAgreement__c%'    AS has_239_client_agreement_gate,
  prosrc ILIKE '%stage_one_audit_plan%'  AS has_244_team_assignment_gate,
  prosrc ILIKE '%quotation%'             AS has_232_quotation_gate
FROM pg_proc
WHERE proname = 'start_file_upload';
```

- `has_239_client_agreement_gate = false` → 239 not applied (matches the
  doc's claim, but now confirmed by you rather than assumed).
- `has_244_team_assignment_gate = true` → 244 already applied (shouldn't be,
  per the earlier DB check — this would be a surprise, tell me if you see it).

**While building this check I found a real bug — fixed, not just flagged:**
migration 244 redefines `start_file_upload` too (needed for its own Stage 1
team-assignment hard block), and its original text said it "supersedes 235"
— i.e. it was written by copying migration 235's body, which **predates**
239. Since `CREATE OR REPLACE FUNCTION` fully replaces the function body with
no merging, applying 244 as originally written would have **silently
deleted** 239's clientAgreement__c gate the moment 244 landed — regardless of
whether 239 had been applied first, second, or not at all. This is exactly
the regression 239's own header comment warned the next editor about.

Fixed directly in [`244_assign_stage_team.sql`](../../supabase/migrations/244_assign_stage_team.sql)
(not yet applied anywhere, so editing it in place is safe): it now carries
239's `clientAgreement__c` block forward verbatim alongside its own new
`stage_one_audit_plan` block. **Net effect: you no longer need to apply 239
separately at all** — just apply 242, 243, 244 (fixed) in Sprint 1, and all
three gates (quotation/232, clientAgreement/239, team-assignment/244) end up
live together. If 239 somehow already got applied on its own before now,
applying fixed-244 afterward is still correct — it reproduces the same
clientAgreement__c logic, so nothing regresses either way.

**Updated recommendation: apply 242, 243, 244 as Sprint 1 already said — 239
is now folded into 244, don't apply it separately.**

## Q2 — Is "Application form" (row 1) actually a file upload?

**Your answer, with data:** yes — `application_Form__a` already exists and
already holds real files. I was wrong that it didn't exist; corrected in
`S6_rights_matrix_verification.md` row 1 and "Still open" item 8. What I
found tracing it down:

- It's a real registered `file`-type field on `external_clients__a` (found
  by name via `get_tenant_fields` in
  [`NewClientForm.tsx`](../../app/commonfiles/core/components/custom/External_Client/NewClientForm.tsx)).
- It's populated by that same file — the **bulk Excel-import tool** ("Upload
  an Excel application form, or a ZIP containing multiple Excel files to
  create clients in bulk"). The uploaded Excel *is* the stored application
  form; the storage path matches the standard `start_file_upload` canonical
  path convention, so it does flow through the normal RPC pipeline, just via
  this tool rather than a generic record-detail upload.
- **No migration anywhere gates who can upload/replace this field** (grepped
  all of `supabase/migrations/` for `application_form`/`application_Form` —
  zero hits in any `start_file_upload`/`finalize_file_upload` block). Today,
  any role with generic field-edit access on `external_clients__a` could
  overwrite it directly through `RecordDetailView.tsx`'s normal file-upload
  control, bypassing the import tool entirely.

**Resolved 2026-08-01 — no lock needed.** You confirmed `application_Form`
is "already doing fine" as-is. No RPC hard block will be added; the field
stays reachable only through the Excel bulk-import tool in practice (no
External Client UI path to it), which is sufficient. This closes the last
open item from Sprint 3 — Sprint 4 has nothing queued.

## Q3 — Tech-findings-file PS config

**Your answer: yes**, add `stage1_tech_findings_file` /
`stage2_tech_findings_file` to the PS checklist. Already written into
[`rights_S2.md`](rights_S2.md) item 3 — no longer conditional, go ahead and
configure it whenever convenient, no dependency on Sprint 1.

---

## Manual steps after this sprint

1. Run the SQL above, send me the results.
2. Once confirmed, proceed with Sprint 1's apply step using the
   already-corrected `244_assign_stage_team.sql` — no separate 239 apply
   needed.
3. Decide (no rush) whether `application_Form` should get the same hard
   upload lock as quotation/clientAgreement — tell me if/when you want that
   written.
