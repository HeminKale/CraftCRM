# Recertification — Rights Matrix Verification

Row-by-row audit of the RECERT rights matrix against the actual live code —
not the plan docs, the real RPC bodies and Permission Set migrations. Done
by reading `start_file_upload` (migration 268, the current live body),
every accept/assign RPC (264–268), and the Permission Set migration (269)
directly, then cross-checking each cell. **One real discrepancy was found
and fixed** — see below.

---

## The three-layer enforcement model

Every cell in the matrix is enforced by one or more of these, never by
guesswork:

1. **RPC hard gates** — `start_file_upload` role-checks each file field by
   name; separate RPCs (`assign_recert_team`, `review_recert_application`,
   `review_recert_agreement`, `review_recert_plan`, `review_recert_ncr_rca`,
   `review_recert_evidences`, `submit_recert_tech_findings`,
   `close_recert_audit`) gate every accept/assign action. Several bind to
   the *specific* `auditor_id__a`/`tech_reviewer_id__a` assigned on that
   exact record, not any user with the role. Server-side, unbypassable —
   the authoritative control for every action.

2. **Permission Set `can_read`** — server-side field visibility
   (`get_tenant_fields`/`get_fields_metadata`, migration 209). An explicit
   `can_read = false` entry excludes the field from the API response
   entirely. **Fields/objects are deny-list**: no entry means fully
   accessible by default — most role/field combinations correctly have
   zero PS entries because they don't need one.

3. **Permission Set `can_edit`** (client-side) + a **hardcoded per-object
   role map** in `RecordDetailView.tsx` (`RECERT_FILE_FIELD_UPLOAD_ROLE`) —
   for file fields, the upload input requires BOTH `can('edit', 'field',
   field.id)` AND the field's entry in the hardcoded map to allow the
   caller's role. Two independent checks on top of the RPC gate.

**Unchecked in the Permission Sets UI ≠ denied.** It means "no explicit
entry," which defaults to full access for objects/fields. This came up
directly during verification: CRM Office showed every checkbox unchecked
on `recertification_clients__a` in the Settings UI, which looked like a
gap until traced back to source — CRM Office has exactly **one** PS entry
on this entire object (`recert_cdc_report`, `can_read=true, can_edit=false`
— view-only, migration 269), confirmed by grepping every migration for
`'CRM Office'` paired with any `recertification_clients__a` field name.
Every other field CRM touches relies on the deny-list default, correctly.

---

## Full matrix, verified

| Row | Matrix | RPC enforcement | PS enforcement |
|---|---|---|---|
| Recertification intimation | Client view/email, CRM upload, CDC view, Auditor/Tech blank | `start_file_upload`: CRM-only | Auditor+Tech denied; **CDC granted view** — deliberate divergence from Surveillance's equivalent row, confirmed correct against this matrix (269's header explicitly flags it) |
| Application form | Client upload, CRM/CDC view, Auditor/Tech blank | Linked-client-only upload gate | Auditor+Tech denied |
| Application acceptance | CRM accept, CDC view, rest blank | `review_recert_application`: CRM-only | none needed (action-only row) |
| Quotation | Client view, CRM upload, CDC view, Auditor/Tech blank | `start_file_upload`: CRM-only | Auditor+Tech denied |
| Client agreement | CRM upload, CDC view, rest blank | `start_file_upload`: CRM-only | Auditor+Tech denied (Client's blank cell here is "no action yet," not a visibility deny — same field as the row below) |
| Signed client agreement | Client accept+sign, CRM view, CDC view, Auditor/Tech blank | `review_recert_agreement`: linked-client-only | none needed |
| Assign team | CRM upload, Auditor/Tech/CDC view, Client blank | `assign_recert_team`: CRM-only, validates chosen users' roles, requires prior status `Recert_Agreement_Signed` | Client blank by construction — `auditor_id__a`/`tech_reviewer_id__a` never registered in `tenant.fields` |
| Recert audit plan | Client/Tech/CDC view, CRM/Auditor upload | Team-assigned-first gate + CRM-or-Auditor upload gate | **Bug found: 269 incorrectly denied Tech reviewer. Fixed in 285** — see below |
| Recert plan accept | Client accept, rest view/blank | `review_recert_plan`: linked-client-only | none needed |
| Recert NCR | Client/CDC view, CRM/Auditor upload, Tech blank | CRM-or-Auditor upload gate | **Tech reviewer denied** (269, matches Surveillance's equivalent precedent) |
| Recert NCR RCA | Client upload, rest view | Linked-client-only upload gate | none needed |
| Recert NCR RCA acceptance | Auditor accept, rest view/blank | `review_recert_ncr_rca`: gated to the **specific assigned auditor** | none needed |
| Recert evidences | Client upload, Auditor accept, rest view | Linked-client-only upload; `review_recert_evidences`: assigned-auditor-only | none needed |
| Recert audit report | CRM/Auditor upload, Tech findings, Client conditional | `submit_recert_tech_findings`/`close_recert_audit`: assigned-tech/assigned-auditor only | Client's "view only after tech acceptance" is a frontend status-lock (`RECERT_STATUS_ORDER`, unlocks at `Recert_Tech_Findings_Given`) |
| Tech review findings | Client blank, Tech write, Auditor view/close | Same two RPCs above | **Client denied** (`recert_tech_findings_notes`, 269) |
| Tech review checklist | Client blank, Tech upload | `start_file_upload`: Tech-only | **Client denied** (`recert_tech_findings_file`, 269) |
| CDC | Client/Auditor/Tech blank, CDC upload | `start_file_upload`: CDC-only | **Client + Auditor + Tech denied**, CRM view-only (269) |
| Certificate issue | Auditor/Tech blank, CRM upload | `start_file_upload`: CRM-only | **Auditor + Tech denied** (269) |

---

## Bug found and fixed: `recert_audit_plan` Tech Reviewer access

Migration 269 denied Tech Reviewer `can_read` on `recert_audit_plan`
("Row 8 — audit plan: blank for Tech Reviewer only"). Re-checking against
the actual matrix screenshot shows Tech Reviewer = **view** for this row,
not blank — 269's entry was a mistake, not a deliberate divergence.
Confirmed with the user before touching anything.

**Fix:** `supabase/migrations/285_fix_recert_audit_plan_tech_reviewer_access.sql`
— deletes the incorrect deny entry (matched by tenant + PS name + field
name, not a hardcoded UUID). No replacement entry needed: deny-list default
restores correct "view" access once the bad entry is gone.

**Why the fix is safe** (doesn't accidentally grant Tech Reviewer upload
rights they shouldn't have): `recert_audit_plan` is mapped to
`'crm_or_auditor'` in `RECERT_FILE_FIELD_UPLOAD_ROLE` — Tech Reviewer isn't
in that set, so the upload button stays disabled for them regardless of
`can_edit`. And `start_file_upload`'s own RPC gate (CRM-or-Auditor only,
migration 268) would reject an upload attempt from Tech Reviewer anyway.
Deleting the deny entry only restores **view**, not edit — the two other
independent layers still block upload exactly as the matrix requires.

---

## Migrations behind this

| # | What |
|---|---|
| 264–268 | Original `start_file_upload` hard gates + accept/assign RPCs, Sprints 0–4 |
| 269 | Permission Set entries — Sprint 6 |
| 285 | Fix — removes incorrect Tech Reviewer deny on `recert_audit_plan` |

All still queued for migration, alongside 277–284 from the same session.

---

## Why this matters going forward

Any new field/row added to this matrix should be verified the same way —
don't assume a PS entry is missing just because a checkbox looks unchecked
in the Settings UI; check whether the deny-list default already covers it.
Read the actual live RPC body (highest-numbered `CREATE OR REPLACE
FUNCTION`, not the object's own last-touched migration — `start_file_upload`
and `finalize_file_upload` are shared across External Client, Surveillance
1, and Recertification, and drift silently) before assuming what's
enforced. This exact discipline is what caught the `recert_audit_plan` bug
above — cross-checking the real code against the real screenshot, not
trusting the migration's own comments at face value.
