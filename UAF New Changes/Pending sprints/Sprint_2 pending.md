# Sprint 2 — Pending Verification Items

Sprint 2 (Stage 2 schema + RPCs, migration `234_stage2_audit_workflow.sql`) has its
schema, field registrations, and RPC logic confirmed working — the full accept-chain
and one reject case were run successfully against a live record. What's below is what's
still open before Sprint 2 (and the carried-over half of Sprint 1) can be called fully
verified. See **S0_S1_S2.md** for the full design reference these items check against.

---

## Confirmed so far ✅

- All 19 Stage 2 columns exist with correct types.
- All 5 Stage 2 file fields registered in `tenant.fields` (`stage2_evidences` correctly
  typed `files`).
- All 6 functions exist (5 new RPCs + `finalize_file_upload` replaced).
- Full accept-chain (`review_stage2_ncr_rca` → `review_stage2_evidences` →
  `submit_stage2_tech_findings` → `close_stage2_audit` → `accept_stage2_tech_review`)
  run end-to-end as admin — every date/notes column stamped correctly,
  `status__a` landed on `Stage2_Complete`.
- `review_stage2_evidences` reject confirmed: `status__a` → `Stage2_Auditor_Accepted`,
  `stage2_evidences_rejection_notes__a` → the given notes.
- Stage 1 accept-chain also confirmed end-to-end (carried over from Sprint 1, closed
  out in this pass): `status__a` → `Stage1_Complete`, all dates/notes correct.
- Auditor and Tech Reviewer roles confirmed to exist (`auditor`, `tech`).

---

## 1. Remaining reject-path tests

Only `review_stage2_evidences` reject has been tested. Same pattern, not yet run:

| RPC | Expected reject result |
|---|---|
| `review_stage1_ncr_rca('<id>','reject','<notes>')` | `status__a = 'Stage1_NCR_Uploaded'`, `stage1_rejection_notes__a = '<notes>'` |
| `accept_stage1_tech_review('<id>','reject','<notes>')` | `status__a = 'Stage1_Tech_Findings_Given'`, `stage1_tech_final_rejection_notes__a = '<notes>'` |
| `review_stage2_ncr_rca('<id>','reject','<notes>')` | `status__a = 'Stage2_NCR_Uploaded'`, `stage2_rejection_notes__a = '<notes>'` |
| `accept_stage2_tech_review('<id>','reject','<notes>')` | `status__a = 'Stage2_Tech_Findings_Given'`, `stage2_tech_final_rejection_notes__a = '<notes>'` |

Also worth confirming: accepting after a prior reject correctly **clears** the
matching rejection-notes column back to `NULL` (the accept branch always does this —
hasn't been explicitly checked with a before/after read).

## 2. Role-deny path — not yet run

Every RPC above has only been tested as admin (which bypasses all gates). Still need:
impersonate a user whose custom role is **neither** Auditor nor Tech Reviewer (e.g.
CRM Office or External Client) and confirm each RPC returns
`Access denied: <Role> role required` rather than silently succeeding.

```sql
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<crm_or_client_user_id>')::text, true);
SELECT * FROM public.review_stage2_ncr_rca('<record_id>','accept',NULL);
-- expect success=false, 'Access denied: Auditor role required'
COMMIT;
```

## 3. File-upload auto-advance — not yet tested with real files

Every RPC-based transition is confirmed, but the **upload-triggered** auto-advance
inside `finalize_file_upload` has only been exercised for `quotation` (pre-existing
field). None of the 9 new Stage 1/2 file fields have been uploaded to yet, so this
logic is unverified:

| Field | Uploaded by | Expected result |
|---|---|---|
| `stage1_report` / `stage1_ncr` | CRM/Auditor/admin | File attaches, `status__a` advances, date stamped |
| `stage1_report` / `stage1_ncr` | Any other role | File attaches, `status__a` **unchanged** (negative test) |
| `stage1_ncr_rca` | Linked client/admin | File attaches, `status__a` → `Stage1_NCR_RCA_Uploaded` |
| `stage1_ncr_rca` | CRM (not the linked client) | File attaches, `status__a` **unchanged** |
| `stage2_report` / `stage2_ncr` | CRM/Auditor/admin | Same pattern as Stage 1 |
| `stage2_ncr_rca` | Linked client/admin | `status__a` → `Stage2_NCR_RCA_Uploaded` |
| `stage2_evidences` | Linked client/admin | `status__a` → `Stage2_Evidences_Uploaded` |
| `stage1_tech_findings_file` / `stage2_tech_findings_file` | Anyone | File attaches, `status__a` **never** auto-advances (by design — advance only via `submit_stage*_tech_findings`) |

This can't be tested in pure SQL (needs real bytes through Storage), so it needs
either a UI to upload through (see #4) or a manual three-step RPC test (`start_file_upload`
→ real `supabase.storage.upload()` call → `finalize_file_upload`) via a script.

## 4. Object Manager layout placement — status unknown

Not yet answered: do `stage1_report`, `stage2_report`, etc. already appear on the
External Client record page (Settings → Object Manager → External Client → Fields
tab, and/or the record detail page itself), or do they need to be manually placed into
a page-layout section before anyone can upload through them? The fields exist in
`tenant.fields` (required for the RPCs to resolve them), but placement on the visible
layout is a separate step that this backend work did not touch.

If they're not on the layout yet, uploading to test #3 above isn't possible through the
UI until either:
- You manually add them to the External Client layout via Object Manager, or
- Sprint 4's dedicated Stage 1/2 action panel is built (which would render them itself,
  independent of the generic layout).

## 5. Test record cleanup — decision needed

Record `f82d9948-a755-4d3e-967a-1932cd1dfed0` has now been pushed through the full
Stage 2 chain (`status__a = 'Stage2_Complete'` as of this testing, before the reject
test was run afterward) and the Stage 1 chain (`status__a` reached `Stage1_Complete`
in a separate test) — both with today's date stamped across multiple columns, and it
skipped Stage 1 entirely before Stage 2 in the actual sequence tested. If this is a
real client record (not a disposable test record), decide whether to:
- Reset `status__a` and the stamped date/notes columns back to a realistic state, or
- Keep it as a dedicated "test/sandbox" record going forward and stop using it for
  anything real.

No column was dropped or corrupted — this is purely a status/data content concern, not
a schema issue.

---

## Not blocking Sprint 2 completion (informational only)

- `tenant.picklist_values` registration for the new status strings — optional
  (Sprint 5), no functional impact.
- Frontend action panels (Sprint 3/4) — separate, larger piece of work; items 3–4
  above are backend-verification concerns that exist independently of whether the
  dedicated UI is built yet.





  =============Remaining steps to do===================
  Here's a complete script. First, find the user IDs you'll need — you'll want one Auditor, one Tech Reviewer, and one user who is neither (e.g. CRM Office or External Client) for the deny tests:


SELECT su.id, su.email, r.name AS custom_role, su.role AS system_role
FROM system.users su
LEFT JOIN tenant.roles r ON r.id = su.custom_role_id
ORDER BY r.name;
A. Remaining reject-path tests
Run each block separately, substituting the right user id and a record id (can reuse f82d9948-... — it's already your test/sandbox record).

1. Stage 1 NCR+RCA reject (as Auditor)


BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<auditor_user_id>')::text, true);
SELECT * FROM public.review_stage1_ncr_rca('<record_id>','reject','RCA insufficient — resubmit with more detail');
SELECT status__a, stage1_rejection_notes__a FROM tenant.external_clients__a WHERE id='<record_id>';
COMMIT;
-- expect: status__a = 'Stage1_NCR_Uploaded', stage1_rejection_notes__a = the notes above
2. Stage 1 final sign-off reject (as Tech Reviewer)


BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<tech_reviewer_user_id>')::text, true);
SELECT * FROM public.accept_stage1_tech_review('<record_id>','reject','Closure notes incomplete — re-address finding #2');
SELECT status__a, stage1_tech_final_rejection_notes__a FROM tenant.external_clients__a WHERE id='<record_id>';
COMMIT;
-- expect: status__a = 'Stage1_Tech_Findings_Given', stage1_tech_final_rejection_notes__a = the notes above
3. Stage 2 NCR+RCA reject (as Auditor)


BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<auditor_user_id>')::text, true);
SELECT * FROM public.review_stage2_ncr_rca('<record_id>','reject','Root cause analysis incomplete');
SELECT status__a, stage2_rejection_notes__a FROM tenant.external_clients__a WHERE id='<record_id>';
COMMIT;
-- expect: status__a = 'Stage2_NCR_Uploaded', stage2_rejection_notes__a = the notes above
4. Bonus — confirm accept clears the rejection notes (do this right after #3, same record):


BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<auditor_user_id>')::text, true);
SELECT * FROM public.review_stage2_ncr_rca('<record_id>','accept',NULL);
SELECT status__a, stage2_rejection_notes__a FROM tenant.external_clients__a WHERE id='<record_id>';
COMMIT;
-- expect: status__a = 'Stage2_Auditor_Accepted', stage2_rejection_notes__a = NULL (cleared, not left over from #3)
B. Role-deny path tests
Use ROLLBACK instead of COMMIT here — these calls are expected to fail before any UPDATE runs, so there's nothing to persist, but it's good habit for negative tests.

Auditor-gated RPC, called by a non-Auditor:


BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<crm_or_client_user_id>')::text, true);
SELECT * FROM public.review_stage1_ncr_rca('<record_id>','accept',NULL);
-- expect: success = false, message = 'Access denied: Auditor role required'
ROLLBACK;
Tech-Reviewer-gated RPC, called by a non-Tech-Reviewer:


BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','<crm_or_client_user_id>')::text, true);
SELECT * FROM public.submit_stage1_tech_findings('<record_id>','test findings');
-- expect: success = false, message = 'Access denied: Tech Reviewer role required'
ROLLBACK;
That pattern (swap the RPC name, keep the same denied user) covers all 9 RPCs — every Auditor-gated one (review_stage1_ncr_rca, close_stage1_audit, review_stage2_ncr_rca, review_stage2_evidences, close_stage2_audit) should deny the same non-Auditor user the same way, and every Tech-gated one (submit_stage1_tech_findings, accept_stage1_tech_review, submit_stage2_tech_findings, accept_stage2_tech_review) should deny the same non-Tech user. You don't need to run all 9 individually if the first one of each type passes — the gate logic is identical code copy-pasted across all of them, so one clean pass per gate type is solid evidence the rest behave the same.

Paste back whatever you get and I'll update the pending doc.
=============================================
