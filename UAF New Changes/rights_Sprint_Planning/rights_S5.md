# Sprint 5 — Live UI testing feedback (2026-08-02)

Stakeholder tested the built workflow end-to-end across CRM/Auditor/Client
logins and reported four bugs. **All four are rows already specified in the
original rights-matrix image (rows 7, 9, 11, 12) — none of this is a new
requirement.** They're gaps in enforcement that slipped through because the
image's upload-role column was never actually hard-gated for most stage file
fields — only `quotation`, `clientAgreement__c`, and (assignment-existence
only, not role) `stage_one_audit_plan` ever had a real block in
`start_file_upload`. Everything else relied on Permission Sets alone, which
are client-side-only and were never configured for these specific fields.

## What was reported

1. **Client login could upload "Stage 1 Audit Report" and "Stage 1 NCR"**
   (row 7/9/12 say CRM/Auditor-only) — and **CRM could upload "Stage 1 NCR +
   RCA"** (row 10 says Client-only).
2. **Auditor login was missing the Stage 1 Audit Plan upload option.**
3. **Client login saw the "Review NCR + RCA" panel** (row 11 — Auditor/CRM
   only, blank for Client in the image).
4. **Stage 1 report must stay view-only for the client**, not become an
   editable upload control once unlocked.

## Root cause — #1 and #4

`start_file_upload` never had a role check for `stage_one_audit_plan`,
`Stage_two_audit_plan`, `stage1_report`, `stage1_ncr`, `stage2_report`,
`stage2_ncr`, `stage1_ncr_rca`, `stage2_ncr_rca`, or `stage2_evidences`.
Permission Sets are deny-list and default-unrestricted, and none of these
nine fields had ever been given an explicit `can_edit` restriction — so the
generic Page Layout form's file-upload control was editable to every role
for every one of them. `stage1_report`'s "locked until Tech Reviewer
findings" behavior (built in an earlier session) only ever hid the field
*before* unlock — after unlock it fell through to the same
unrestricted-by-default edit control as everything else, which is exactly
why the client could upload it once visible.

**Fixed, both layers (belt and suspenders, since PS alone can't stop a
direct RPC call and RPCs have zero PS awareness — confirmed throughout this
epic):**

- **Frontend hard floor** — [`RecordDetailView.tsx`](../../app/commonfiles/core/components/Application/RecordDetailView.tsx):
  new `FILE_FIELD_UPLOAD_ROLE` map + `isFileUploadAllowedForRole()`, ANDed
  into the file-field `readOnly` check alongside the existing
  `can('edit','field',...)` Permission Set check and `isEditing`. CRM/Auditor
  own the plan/report/NCR fields; only the record's linked client owns
  NCR+RCA/evidences. This is a hard floor — Permission Sets can still narrow
  further (e.g. hide a field from Tech Reviewer entirely) but can never widen
  past it.
- **Server-side hard block** — [`supabase/migrations/248_stage_file_upload_role_gates.sql`](../../supabase/migrations/248_stage_file_upload_role_gates.sql):
  redefines `start_file_upload` (supersedes 244) adding the same two rules
  as real `RAISE`-equivalent rejections, so calling the RPC directly can't
  bypass the frontend check either — same pattern as the existing
  quotation/clientAgreement__c blocks.
- `npx tsc --noEmit` clean after the frontend edit.

## Root cause — #3 (Client seeing an Auditor/CRM-only panel)

The gating logic in `StageAuditActionPanel.tsx` (`isCRM`, `isAuditor`, etc.)
was already correct on paper — substring-matches the caller's custom role
name, and a Client's role shouldn't match `%crm%`/`%auditor%`. Rather than
chase a live-data mismatch blind, hardened the component itself:
[`StageAuditActionPanel.tsx`](../../app/commonfiles/core/components/custom/External_Client/StageAuditActionPanel.tsx)
now computes `isClientOnly = !isAdmin && currentUserId === clientUserId`
and ANDs `!isClientOnly` into `isCRM`/`isAuditor`/`isTech`/`isCdc` directly
(not `isLinkedClient`, which intentionally still includes admin). This means
the record's own linked client can never trigger a CRM/Auditor/Tech/CDC-only
panel, full stop, regardless of what their custom role string happens to
contain — closes this bug even if the live root cause turns out to be a role
naming quirk rather than a code path I can see from here.

## Root cause — #2 (Auditor missing the plan-upload option) — **not fixed, needs one query**

Traced every code path that could explain this (`showPlanUploadPrompt`'s
`isCRM || isAuditor` gate, `get_tenant_users` — the RPC that resolves
`customRoleName` — confirmed it has no role restriction of its own, so an
Auditor login should resolve their own custom role name same as anyone
else) and found no bug in the gating logic itself. Two live-state
explanations remain, both needing your data to distinguish:

- The record simply wasn't at `Team_Assigned` (or `Stage_one_plan_Sent` with
  client remarks) at the moment you tested as Auditor — the banner is
  supposed to disappear once uploaded, this would be correct behavior, not
  a bug.
- The Auditor test account's `custom_role_id`/role name doesn't actually
  resolve to something containing "auditor" (typo, wrong role assigned,
  or `custom_role_id` is null).

**Query to run** (paste results back):
```sql
select su.email, su.role as system_role, r.name as custom_role_name,
       ec.status__a, ec.auditor_id__a, ec.tech_reviewer_id__a, ec.id as record_id
from system.users su
left join tenant.roles r on r.id = su.custom_role_id
left join tenant.external_clients__a ec on true
where su.email = '<the auditor test account email>'
order by ec.updated_at desc
limit 5;
```
If `custom_role_name` doesn't contain "auditor", that's the bug — fix by
assigning the correct custom role to that user in Settings → User
Management. If it does, and `status__a` isn't `Team_Assigned` on the record
you were testing, the missing banner was correct — re-test on a record at
that exact checkpoint (or trigger the field's edit control directly; with
248 applied, Auditor should now also pass the new CRM-or-Auditor upload
gate on `stage_one_audit_plan`).

## Manual steps

1. Apply `248_stage_file_upload_role_gates.sql`.
2. Run the query above for the Auditor test account and paste back results.
3. Re-test all four scenarios:
   - Client login: no upload control on Stage 1 Audit Report, Stage 1 NCR,
     Stage 1 Audit Plan (or their Stage 2 equivalents).
   - CRM login: no upload control on Stage 1/2 NCR + RCA, Stage 2 Evidences
     (view only).
   - Client login: no "Review NCR + RCA" panel, or any other CRM/Auditor/
     Tech/CDC-only panel.
   - Auditor login: Stage 1 Audit Plan upload appears once the record is at
     `Team_Assigned`.
