# RPC Gating for File Fields — How Access Actually Works

This document exists to answer one recurring question precisely: **"CRM/Auditor/Client
uploads X — is that controlled by Permission Sets?"** Short answer: **partly, and it's
two independent layers that can disagree.** This doc covers both layers, gives the full
current reference table for every External Client file field, and explains how to
change either layer if a real need for it shows up later.

Related: **permission-sets.md**, **sharing-policy.md**, **S0_S1_S2.md**, **S3.md**, **S4.md**.

---

## Migration status (check before trusting anything below as "live")

| Migration | Contents | Applied? |
|---|---|---|
| 232 | `quotation` hard block | ✅ Applied |
| 237, 238 | Stage 1/2 realignment, `finalize_file_upload` soft gates | ✅ Applied |
| 239 | `clientAgreement__c` hard block (CRM/admin/linked-client) | ❌ **Not applied** — verified live: an Auditor-role account successfully called `start_file_upload` for `clientAgreement__c` on the sandbox record, which 239's gate should have denied |
| 240 (two files share this number — `240_client_agreement_single_file.sql` and `240_register_stage_workflow_dates.sql`) | `clientAgreement__c` type fix; registers 9 Stage 1/2 dates | ✅ Both applied |
| 241 | Separate Excel-import fields, incl. a *different* `registration_date__a` + status-sync trigger | ❌ Not applied |
| 242 | Registers the remaining 9 notes/remarks columns + 2 dates | Written this session, not yet applied |

The duplicate `240` filename is a pre-existing pattern in this repo, not a new mistake —
the migration history has several duplicate number prefixes going back to `016`/`026`/`100`/
`130`/etc. Migrations here are applied individually, not run through a version-enforcing
CLI, so it hasn't caused a problem in practice — just don't assume filename order implies
apply order.

---

## The two layers

| Layer | What it controls | Where it lives | Aware of custom role names? | Aware of Permission Sets? |
|---|---|---|---|---|
| **Permission Sets** | Whether the upload/edit UI even renders for this user, on this field | `can('edit', 'field', field.id)` in [`RecordDetailView.tsx:1343`](../../app/commonfiles/core/components/Application/RecordDetailView.tsx#L1343); server-side `can_read` filtering in `get_tenant_fields` (migration 209) — **but only for columns that have a `tenant.fields` row at all, see "Date and notes fields" below** | No | — |
| **Role-name gating** | Whether an upload that *does* happen advances `status__a`, and (for `quotation`, and `clientAgreement__c` once 239 is applied) whether the upload is allowed to happen at all | `start_file_upload` (hard blocks) and `finalize_file_upload` (soft gate, everything else) — currently defined in [`238_stage2_workflow_and_stage1_followup.sql`](../../supabase/migrations/238_stage2_workflow_and_stage1_followup.sql); `clientAgreement__c`'s hard block is in [`239_restrict_client_agreement_upload.sql`](../../supabase/migrations/239_restrict_client_agreement_upload.sql), not yet applied | Yes — `lower(custom_role_name) LIKE '%crm%'` etc. | No |

They are **completely independent** and never check each other. A user can:
- Have Permission Set access to upload a field but the wrong custom role → file attaches, status never advances (silent no-op, by design — see S0_S1_S2.md's "no file-existence precondition" note, same philosophy).
- Have the right custom role but no Permission Set access → never sees the upload button at all, regardless of role.

**Accept/Reject/Submit buttons are different again** — `StageAuditActionPanel.tsx`,
`ReviewActionPanel.tsx`, and `RenewalActionPanel.tsx` call zero `can()`/`usePermissions()`
anywhere (verified by grep — none of the three files reference either). Those RPCs
(`review_stage1_ncr_rca`, `submit_stage1_tech_findings`, `review_client_application`,
etc.) are gated **only** by the same custom-role-name string matching, re-checked
server-side inside each `SECURITY DEFINER` function. Permission Sets have **zero**
effect on whether someone can click Accept/Reject/Submit — only on whether they can
see/edit the file fields around those buttons. Confirmed uniform across the entire
app, not just this epic: `_check_permission()` (the permission-set-aware helper from
migration 209) is called nowhere except inside 209 itself — not in any of the 15
Stage 1/2 RPCs (233/234/237/238), and not in any of the pre-existing pipeline's RPCs
(`review_client_application`, `review_client_agreement`,
`review_surveillance_intimation`, `review_surveillance_audit_plan`) either.

---

## Full reference — every External Client file field

| Field (api name) | Object | Permission Sets | Role-name gate | What the gate controls |
|---|---|---|---|---|
| `quotation` | external_clients__a | can_read/can_edit as configured | **Hard block** in `start_file_upload` — CRM/admin only | Wrong role: upload itself rejected before any bytes sent. |
| `clientAgreement__c` | external_clients__a | as configured | **Hard block** in `start_file_upload` (239, **not yet applied**) — CRM/admin/linked-client only | Once applied: wrong role rejected before any bytes sent. Carve-out for the linked client, since `ReviewActionPanel.tsx`'s signing flow uploads the signed PDF back through this same field. |
| `stage_one_audit_plan` | external_clients__a | as configured | Soft — CRM/Auditor/admin | Auto-advance to `Stage_one_plan_Sent`, clears client remarks. Wrong role: file attaches, no status change. |
| `stage1_report` | external_clients__a | as configured | Soft — CRM/Auditor/admin | Auto-advance to `Stage1_Report_Sent` (merged with NCR) |
| `stage1_ncr` | external_clients__a | as configured | Soft — CRM/Auditor/admin | Same merged status as above |
| `stage1_ncr_rca` | external_clients__a | as configured | Soft — linked client/admin | Auto-advance to `Stage1_NCR_RCA_Uploaded`, no date stamped |
| `stage1_tech_findings_file` | external_clients__a | as configured | **None** | No auto-advance for *any* uploader — by design, the transition is the explicit `submit_stage1_tech_findings` RPC, this file is optional supporting material |
| `Stage_two_audit_plan` | external_clients__a | as configured | Soft — CRM/Auditor/admin | Auto-advance to `Stage2_Plan_Sent`, clears client remarks |
| `stage2_report` | external_clients__a | as configured | Soft — CRM/Auditor/admin | Auto-advance to `Stage2_Report_Sent` (merged with NCR) |
| `stage2_ncr` | external_clients__a | as configured | Soft — CRM/Auditor/admin | Same merged status as above |
| `stage2_ncr_rca` | external_clients__a | as configured | Soft — linked client/admin | Auto-advance to `Stage2_NCR_RCA_Uploaded`, no date stamped |
| `stage2_evidences` | external_clients__a | as configured | Soft — linked client/admin | Auto-advance to `Stage2_Evidences_Uploaded`, date stamped (kept — this one wasn't retired) |
| `stage2_tech_findings_file` | external_clients__a | as configured | **None** | Same as `stage1_tech_findings_file` — no auto-advance by design |
| `cdc_report` | external_clients__a | as configured | Soft — CRM/Tech Reviewer/admin | Auto-advance directly to `CDC_Approved` — upload **is** the approval, no separate accept step |

"As configured" means: accessible by default (fields are deny-list, per `permission-sets.md`)
unless an admin has explicitly restricted `can_read`/`can_edit` for that field in a
Permission Set.

---

## Date and notes fields — a structurally different situation

Everything above is about **file fields**, which were all registered in `tenant.fields`
from the moment their migration created them (233/234/237/238 all register their file
fields alongside the column). **Date and notes/remarks columns were not** —
S0_S1_S2.md's original design note says so explicitly: "Date/text columns are not
registered in `tenant.fields` — only the file fields are... every physical column
reaches the frontend regardless."

This matters for Permission Sets specifically: `can('edit'/'read', 'field', field.id)`
needs a `field.id` to check against. **A column with no `tenant.fields` row cannot be
gated by a Permission Set at all** — not "accessible by default" in the deny-list sense
`permission-sets.md` describes for registered fields, but literally unreachable by the
permission system, because there's no row to attach a rule to. `get_object_records`
returns every physical column unconditionally, so these values reach any user who can
see the record at all.

| Registered (Permission Sets apply) | Registered by |
|---|---|
| `stage1_audit_date`, `stage2_audit_date` | 237, 238 |
| `stage1_plan_accepted_date`, `stage1_auditor_accepted_date`, `stage1_tech_final_accepted_date`, `stage2_plan_sent_date`, `stage2_plan_accepted_date`, `stage2_auditor_accepted_date`, `stage2_evidences_accepted_date`, `stage2_tech_findings_date`, `cdc_date` | 240 (`register_stage_workflow_dates`) |
| `stage1_rejection_notes`, `stage1_plan_client_remarks`, `stage1_tech_findings_notes`, `stage1_closure_notes`, `stage1_tech_final_rejection_notes`, `stage1_tech_findings_date`, `stage1_closed_date`, `stage2_plan_client_remarks`, `stage2_rejection_notes`, `stage2_evidences_rejection_notes`, `stage2_tech_findings_notes`, `stage2_evidences_uploaded_date` | 242 (this session) |

**Deliberately left unregistered — not an oversight:**

| Column | Why |
|---|---|
| `stage1_report_uploaded_date`, `stage1_ncr_uploaded_date` | Orphaned — merged away by 237, nothing writes to them anymore |
| `stage1_ncr_rca_uploaded_date`, `stage2_ncr_rca_uploaded_date` | Retired per explicit stakeholder instruction: "shall never be under consideration in the flow" |
| `stage2_closed_date`, `stage2_tech_final_accepted_date`, `stage2_closure_notes`, `stage2_tech_final_rejection_notes` | Dead — `close_stage2_audit`/`accept_stage2_tech_review` are retired for Stage 2 (238's tail restructure) |
| `stage2_registration_date` | **Deliberately excluded even though it's live.** `set_stage2_registration_date` sets this date and `status__a` together in one call. Registering it generically would let someone edit the date directly through the record form, bypassing the RPC — the date would change but `status__a` wouldn't, breaking the one guarantee that RPC exists to provide. Both 240's and 241's own comments independently reconfirm this reasoning — don't register it without revisiting that decision explicitly. |

**A separate, unrelated `registration_date__a` exists too** (migration 241, not yet
applied) — a distinct column on `external_clients__a` for manual entry / Excel-sheet
import, with its own `BEFORE INSERT OR UPDATE` trigger that forces
`status__a = 'Client_Registered'` whenever it's set. This is **not** the same column as
`stage2_registration_date__a` and doesn't go through `set_stage2_registration_date` —
it's a second, independent path to the same terminal status, intended for bulk-importing
already-registered historical clients without walking them through the live workflow.
Worth knowing both paths exist if `status__a` ever jumps to `Client_Registered`
unexpectedly — check which column actually changed before assuming the workflow RPC ran.

---

## Your question: do the new fields behave the same?

**Yes — identically, with zero special-casing.** Every field listed above (everything
except `quotation`) goes through the exact same generic pipeline:
`FileUploadField.tsx` → `start_file_upload` → real upload to Supabase Storage →
`finalize_file_upload`. None of the fields introduced in this epic (Stage 1 or Stage 2,
original or realigned) have a hard block — only `quotation` does, and that was a
pre-existing, deliberately scoped fix from Sprint 0 (`232_restrict_quotation_upload.sql`),
unrelated to anything built in Sprints 1–4.

Permission Sets apply the same way to all of them too — there's nothing in
`get_tenant_fields`, `PermissionSets.tsx`, or `RecordDetailView.tsx`'s rendering path
that special-cases Stage 1/2 fields versus any other file field on the object. If you
configure a Permission Set to hide `stage2_evidences`, it hides exactly the way hiding
`quotation`'s or `clientAgreement__c`'s *edit* flag would (though not upload — those
two fields' hard blocks are at the RPC layer, not the Permission Set layer).

---

## How to change either layer, if a real need shows up later

**To add a hard block to a new field** (like `quotation`'s): add an `IF` block inside
`start_file_upload` following the exact pattern at the top of
[`232_restrict_quotation_upload.sql`](../../supabase/migrations/232_restrict_quotation_upload.sql) —
resolve `_caller_role`/`_custom_role`, check before issuing the storage path, return
`success = false` with a message if it fails. Needs a new migration; `start_file_upload`
is defined once and redefined only for this purpose so far.

**To change a soft gate's role match or target status:** edit the relevant `IF`/`ELSIF`
block inside `finalize_file_upload`. It is redefined in full on every migration that
touches it (232 → 234 → 237 → 238) — **each redefinition must reproduce every prior
block verbatim** and only change what's intended, or earlier auto-advance logic is
silently lost. Always make 238 (or whichever migration is currently last) the
migration you edit next, and bump the number — never edit an already-applied migration
file in place.

**To make Accept/Reject/Submit RPCs Permission-Set-aware** (currently they are not, for
any RPC in the app): this is a bigger, deliberate architecture change, not a quick
patch. It would need:
1. A new resource type (e.g. `'action'` or `'rpc'`) added to `tenant.permission_set_entries`
   and to `PermissionsProvider.tsx`'s `can()` logic — today it only understands `app`,
   `tab`, `object`, `field`.
2. A `_check_permission()` call added to every business-action RPC that should respect
   it — currently zero of them do, across the whole app, not just this epic.
3. A matching `can('edit', 'action', ...)`-style check added to every action panel
   (`StageAuditActionPanel.tsx`, `ReviewActionPanel.tsx`, `RenewalActionPanel.tsx`) —
   currently none of them import `usePermissions` at all.

Not recommended without a concrete driving need — see the "why document, not rework"
reasoning already discussed. If that need arrives, treat it as its own scoped project,
not a follow-up migration, since it touches the whole app's permission model, not just
External Client.
