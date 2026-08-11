# External Client — Rights Matrix vs. Live System (Sprint 6 verification)

Stakeholder supplied a rights-matrix spreadsheet (Client / CRM / Auditor / Tech
Reviewer / CDC / Admin × 25 checkpoints, read top-to-bottom as the process
sequence) for the External Client Stage 1/2 audit workflow. This doc checks it
against the **live RPC/migration source** (232–238, confirmed applied;
239/241/242/243/244 confirmed not applied — see **RPC for file fields.md** for
the up-to-date migration status table) and records exactly where they agree
and where they don't.

**This started as a verification-only pass with no code changes.** That
stopped being true partway through — several findings turned into actual
decisions, and three of those were implemented in the same session (see
"Files changed this session" immediately below, and "Decisions made / work
done this session" further down). **Read this whole document before assuming
anything is or isn't done** — do not stop at the row-by-row table, the
"Decisions made" and "Still open" sections below it are where the current
state actually lives.

> **Read order:** S0_S1_S2.md → S3.md → S4.md → S5.md → **this doc**.

Related: **RPC for file fields.md** (the two-layer permission model this doc
assumes throughout), **S3.md**, **S4.md**, **S5.md**.

---

## Files changed this session (2026-08-01) — check this before doing anything else

**New migrations, all written, none applied yet — apply all three (any order,
no interdependency between them):**
- [`242_register_remaining_stage_notes_and_dates.sql`](../../supabase/migrations/242_register_remaining_stage_notes_and_dates.sql) — registers 12 pre-existing notes/date columns in `tenant.fields` (from before this session's rights-matrix work; unrelated to it, just also still pending)
- [`243_cdc_role_upload_gate.sql`](../../supabase/migrations/243_cdc_role_upload_gate.sql) — redefines `finalize_file_upload`: `cdc_report` auto-advance now CDC-role-only
- [`244_assign_stage_team.sql`](../../supabase/migrations/244_assign_stage_team.sql) — new `auditor_id__a`/`tech_reviewer_id__a` columns, new `Team_Assigned` status, 2 new RPCs (`get_tenant_users_by_role_pattern`, `assign_stage_team`), redefines `start_file_upload` (hard block on Stage 1 plan upload) and 7 existing Auditor/Tech-Reviewer RPCs (assignment check added)

**Frontend files edited (already live in the working tree, not gated by any migration apply — but some of these won't function correctly until 243/244 are applied, since they call the new RPCs):**
- [`RecordDetailView.tsx`](../../app/commonfiles/core/components/Application/RecordDetailView.tsx) — `stage1_report`/`stage2_report` hidden from the linked client until Tech Reviewer findings (works today, no migration dependency — reads existing `status__a`/`client_user_id__a`)
- [`ClientWorkflowBar.tsx`](../../app/commonfiles/core/components/custom/External_Client/ClientWorkflowBar.tsx) — added `Team_Assigned` to the `STAGES` array (cosmetically fine before 244 is applied — it just won't ever match a real record's status until then)
- [`StageAuditActionPanel.tsx`](../../app/commonfiles/core/components/custom/External_Client/StageAuditActionPanel.tsx) — new Assign Team prompt + read-only assigned-team strip (calls `assign_stage_team`/`get_tenant_users_by_role_pattern` — **will error until 244 is applied**), `showPlanUploadPrompt` tightened to require `Team_Assigned` status, `showCdcUploadPrompt` fixed to check the CDC role instead of CRM/Tech

`npx tsc --noEmit` was run clean after each frontend edit this session.

---

## Legend

- ✅ **Match** — live RPC gate agrees with the image
- ⚠️ **Divergence** — something is built, but the gate/sequence disagrees with the image
- ❌ **Gap** — nothing built for this row at all
- ❓ **Needs stakeholder decision** — image contradicts an *already-confirmed* prior decision (237/238 comments explicitly say "confirmed with stakeholder"); do not silently pick a side

---

## Row-by-row

| # | Right (image) | Image says | Live system | Verdict |
|---|---|---|---|---|
| 1 | Application form | Client uploads, CRM views | **Correction (2026-08-01, sprint planning session) — the row-1 verdict above was wrong.** `application_Form__a` **does** exist as a real registered `file`-type field on `external_clients__a` and holds real data — confirmed via a live query against `tenant.external_clients__a` (see `rights_Sprint_Planning/rights_S3.md`). It's populated by [`NewClientForm.tsx`](../../app/commonfiles/core/components/custom/External_Client/NewClientForm.tsx), the bulk Excel-import tool ("Upload an Excel application form... to create clients in bulk") — the source Excel *is* the stored application form. No `start_file_upload`/`finalize_file_upload` block exists for this field anywhere in the migrations (confirmed by grep across all of `supabase/migrations/`), so nothing stops any role with generic field-edit access from re-uploading/replacing it outside that tool. | ✅ Field exists, is populated via the Excel bulk-import tool, no role gate needed — stakeholder confirmed current behavior is fine as-is (`rights_S3.md`) |
| 2 | Application acceptance | CRM accepts | `review_client_application` (213) — CRM/admin only, exact match | ✅ |
| 3 | Quotation | Client views, CRM uploads | Hard block in `start_file_upload` (232) — CRM/admin only for upload; auto-advance in `finalize_file_upload` | ✅ |
| 4 | Client agreement | CRM uploads | **No hard block today.** `clientAgreement__c` upload is currently open to anyone with Permission-Set field-edit access — the CRM-only restriction is migration **239, written but not applied**. | ⚠️ Matches the image only once 239 is applied |
| 5 | Signed client agreement | Client accepts & signs | `review_client_agreement` (213) — linked client/admin only, exact match | ✅ |
| 6 | **Assign team** | CRM assigns, Auditor/Tech Reviewer/CDC view | **Built this session** — migration 244 (not yet applied). `auditor_id__a`/`tech_reviewer_id__a` columns, new `assign_stage_team` RPC (CRM/admin only), new `Team_Assigned` status inserted between `Client_Agreement_Signed` and `Stage_one_plan_Sent`. Picklists populated live via `get_tenant_users_by_role_pattern`. | ✅ (written, not yet applied) |
| 7 | Stage 1 audit plan | CRM or Auditor upload, Tech Reviewer views | `stage_one_audit_plan` upload — `_is_crm_or_auditor` gate, exact match | ✅ |
| 8 | Stage 1 plan accept | Client accepts | `review_stage1_plan` — linked client/admin only | ✅ |
| 9 | Stage 1 NCR | CRM/Auditor upload, **Client has no access at all** | Upload gate matches (`_is_crm_or_auditor`). Client-visibility part not done — `stage1_ncr` is currently accessible to Client by default (Permission Sets are deny-list); needs an explicit `can_read = false` Permission Set entry for the Client role. | ✅ upload / ❌ visibility restriction not configured |
| 10 | Stage 1 NCR RCA | Client uploads | `stage1_ncr_rca` upload — linked client/admin, exact match | ✅ |
| 11 | Stage 1 NCR RCA acceptance | Auditor accepts | `review_stage1_ncr_rca` accept — gate is **Auditor OR CRM** (widened in 237), image lists Auditor only | ⚠️ Gate is wider than spec'd |
| 12 | Stage 1 audit report | CRM/Auditor upload; **Client can only view after Tech Reviewer acceptance**; Tech Reviewer accepts/gives findings | **Resolved — same field as row 9's report/NCR upload, not a separate step.** Upload timing/gate already matched. Client conditional-visibility now **implemented** in `RecordDetailView.tsx` — `stage1_report` hidden from linked client until `Stage1_Tech_Findings_Given`. | ✅ (fixed this session) |
| 13 | Stage 1 tech review findings | Tech Reviewer writes, Auditor views/**closes** | `submit_stage1_tech_findings` (tech-only, matches "write") → `close_stage1_audit` (auditor-only, matches "close") → `accept_stage1_tech_review` (tech-only final sign-off, not shown as its own row in the image but present live) | ✅ (Stage 1's tail is intact and matches) |
| 14 | Stage 1 tech review checklist | Tech Reviewer uploads, CRM/Auditor view | `stage1_tech_findings_file` — **no role gate on upload at all** (any role with field-edit access can upload it; confirmed "None" in RPC for file fields.md's reference table) | ⚠️ Should be Tech-Reviewer-only per image, currently wide open |
| 15 | Stage 2 audit plan | CRM/Auditor upload, Tech Reviewer views | `Stage_two_audit_plan` — `_is_crm_or_auditor`, exact match | ✅ |
| 16 | Stage 2 plan accept | Client accepts | `review_stage2_plan` — linked client/admin only | ✅ |
| 17 | Stage 2 NCR | CRM/Auditor upload | Upload gate matches (`_is_crm_or_auditor`), same field as row 21's report (mirrors row 9's resolution) | ✅ |
| 18 | Stage 2 NCR RCA | Client uploads | `stage2_ncr_rca` — linked client/admin, exact match | ✅ |
| 19 | Stage 2 NCR RCA acceptance | Auditor accepts | `review_stage2_ncr_rca` accept — gate is **Auditor OR CRM** (widened in 238), image lists Auditor only | ⚠️ Gate is wider than spec'd |
| 20 | Stage 2 NCR evidences | Client uploads, Auditor accepts | `stage2_evidences` upload (linked client/admin) + `review_stage2_evidences` accept — gate is **Auditor OR CRM** (widened in 238), image lists Auditor only | ✅ upload / ⚠️ accept gate wider than spec'd |
| 21 | Stage 2 audit report | CRM/Auditor upload; **Client views only after tech review acceptance**; Tech Reviewer just **views** (not accept/findings, unlike Stage 1's row 12) | Upload gate already matches (mirrors row 12's resolution). Client conditional-visibility **implemented** — `stage2_report` hidden from linked client until `Stage2_Tech_Findings_Given`. | ✅ (fixed this session) |
| 22 | Stage 2 tech review findings | Tech Reviewer writes, Auditor views/**closes** | `submit_stage2_tech_findings` (tech-only, matches "write") — **but `close_stage2_audit` and `accept_stage2_tech_review` were explicitly RETIRED in migration 238**, "confirmed with stakeholder," specifically to make Stage 2's tail *shorter* than Stage 1's (straight to CDC after findings, no auditor-close step). | ❓ **Direct contradiction with an already-confirmed decision** — see "Critical findings" below |
| 23 | Stage 2 tech review checklist | Tech Reviewer uploads, CRM/Auditor view | `stage2_tech_findings_file` — same as row 14, no role gate on upload | ⚠️ Should be Tech-Reviewer-only, currently wide open |
| 24 | CDC | CRM views, **CDC role uploads** | Split across both layers — see "Critical findings" #3. RPC side **done** (migration 243, not yet applied): `cdc_report` auto-advance now gates on CDC role only. PS side (CRM view-only, others hidden) being configured manually by the stakeholder. | ✅ (fixed this session, pending migration apply + PS config) |
| 25 | Certificate issue | Client views, CRM uploads, CDC views | No field, RPC, or status tied to `external_clients__a`'s `status__a` flow. Certificate generation exists as a **completely separate subsystem** (`CertificateGeneratorTab.tsx`, `certificate-generator` tool, PDF-generation API routes) with no connection to this workflow's role gating. | ❌ Gap |

---

## Critical findings — need an explicit decision, not a silent fix

### 1. Report vs. NCR — RESOLVED, was a misreading, not a real divergence

**Stakeholder clarification (2026-08-01):** row 12/21 ("Stage 1/2 audit report")
is the *same* field as `stage1_report`/`stage1_ncr` — not a second, later
document. The image's row ordering was describing *who reviews the report and
when* (Tech Reviewer, right after RCA acceptance), not a separate upload
event. **The live sequence already matches**: RCA accepted
(`Stage1_Auditor_Accepted`) → Tech Reviewer's turn
(`submit_stage1_tech_findings`). No new field, status, or migration needed —
237/238's merge stands as-is.

The one real gap this surfaced: the image's Client column is **blank** on row 9
("stage 1 ncr" — no client access at all, ever) but shows conditional view on
row 12 ("stage 1 audit report" — visible only after Tech Reviewer findings).
Since `stage1_report` and `stage1_ncr` are still two distinct upload slots
today (they just happen to share a status), these two visibility rules are
achievable independently:
- `stage1_ncr` hidden from Client entirely → plain Permission Set change
  (`can_read = false` for the Client role), no code needed. **Stakeholder is
  doing this manually in Settings — not a code task, nothing for a future
  session to do here.**
- `stage1_report` conditional view → **implemented this session**, see below.

**Implemented:** [`RecordDetailView.tsx`](../../app/commonfiles/core/components/Application/RecordDetailView.tsx)
now hides both `stage1_report` and `stage2_report` from the linked client
(`client_user_id__a === current user`) until the respective stage's Tech
Reviewer has submitted findings:
- `stage1_report` unlocks at `Stage1_Tech_Findings_Given` (stakeholder's
  chosen trigger — one step earlier than the final `Stage1_Complete`
  sign-off).
- `stage2_report` unlocks at `Stage2_Tech_Findings_Given` (confirmed as the
  only sensible trigger, since Stage 2 has no auditor-close/final-signoff
  pair after it).

Non-client roles (CRM/Auditor/Tech Reviewer/admin) are unaffected — the check
only fires when `client_user_id__a` matches the viewer.

This is a **frontend-only, non-Permission-Set, non-RPC** gate — a genuinely new
mechanism (status-conditional field visibility), since neither existing layer
can express "visible only when status = X" (see RPC for file fields.md).
Implemented as one small lookup table (`STAGE_REPORT_LOCKED_STATUSES`, keyed
by field name) plus one helper (`isStageReportLockedForClient`) and one
conditional branch at the file-field render point — not a general framework,
consistent with how the rest of this app special-cases individual fields by
name rather than building configuration-driven rules.

### 2. Stage 2 tail: no auditor-close (live, confirmed) vs. auditor-close exists (image)

238's own header comment states the Stage 2 tail was "RESTRUCTURED
(deliberately, NOT a mirror of Stage 1 — confirmed with stakeholder)" specifically
to retire `close_stage2_audit`/`accept_stage2_tech_review`, going straight from
tech findings to CDC. Row 22 of the image shows "Auditor view/**close**" on
Stage 2 tech review findings — i.e., the auditor-close step the stakeholder
previously confirmed should be *gone*. **This is a direct contradiction with a
already-shipped, confirmed decision** — needs to be resolved explicitly (was
the image drawn before that decision, or does the decision need reversing?)
before touching `close_stage2_audit`/`accept_stage2_tech_review`.

### 3. CDC role doesn't exist in the app's role-matching convention — DONE

**Stakeholder decision (2026-08-01):** CDC role uploads, only CRM sees it —
and split cleanly across the two layers, per the stakeholder's standing
PS-over-RPC preference:

- **Visibility (who sees/edits `cdc_report` in the record form) — 100% a
  Permission Set job, no RPC involved.** Configure in Settings:
  - CRM Office: `can_edit = false`, leave `can_read = true` → view only
  - Auditor / Tech Reviewer / External Client: `can_read = false` → no
    access at all
  - CDC (new custom role — create via Settings → User Management first, if
    not already done): leave unrestricted, default deny-list access already
    gives it full read/edit
  **Stakeholder is configuring this manually — not a code task.**
- **Whether the upload counts as the approval (advances `status__a` to
  `CDC_Approved`) — unavoidably RPC.** No Permission Set anywhere in this app
  is consulted by workflow auto-advance logic, confirmed uniformly across
  every RPC in the codebase — this half genuinely cannot be done through PS.
  **Implemented:** [`243_cdc_role_upload_gate.sql`](../../supabase/migrations/243_cdc_role_upload_gate.sql)
  — `finalize_file_upload`'s `cdc_report` block now gates on `_is_cdc`
  (custom role matches `%cdc%`, or admin) instead of `_is_crm_or_tech`. CRM's
  and Tech Reviewer's uploads no longer advance status. **Written, not yet
  applied.**

Kept **soft** (no hard block added to `start_file_upload`, unlike `quotation`
or the pending `clientAgreement__c`) — once the Permission Set restriction
above is live, CRM/Auditor/Tech Reviewer/Client won't see an editable upload
control for this field at all through the normal UI, which covers everyday
use; a hard block would only add defense against someone calling the RPC
directly. Not built, since it wasn't asked for and the PS change already
closes the normal-use gap — flag if that stronger guarantee turns out to be
wanted later.

---

## Answering item 8 directly: "upload and accept permissions are existing controlled by RPC, correct?"

**Mostly yes, with two named exceptions**, confirmed by reading the live RPC
source in this session:

- Every **accept/reject** action in the image (Application acceptance, Signed
  agreement, Plan accept ×2, NCR RCA acceptance ×2, Evidences accept, Tech
  findings write, Stage 1 close/final-signoff, CDC upload-as-approval) is
  gated purely by role-name string matching inside a `SECURITY DEFINER` RPC —
  zero Permission Set involvement, confirmed uniform across the whole app in
  the earlier verification pass.
- **Upload** gating is RPC-controlled only for fields with an explicit block:
  `quotation` (hard, live), Stage 1/2 plan/report/NCR/RCA/evidences/CDC (soft,
  auto-advance-only, live). Two named exceptions where the image implies a
  role restriction that **does not exist** in the RPC layer today:
  - `clientAgreement__c` — no hard block yet (239 not applied)
  - `stage1_tech_findings_file` / `stage2_tech_findings_file` — no gate at all,
    open to any role with field-edit Permission Set access

So the general principle you're describing (upload/accept = RPC, not
Permission Set) is confirmed correct as the app's actual architecture — the
two gaps above are missing implementations of that same principle, not
evidence the principle is wrong.

---

## What matches cleanly, no action needed

Rows 2, 3, 5, 7, 8, 9 (upload), 10, 12, 13 (Stage 1 tail), 15, 16, 17, 18, 20
(upload half) — the large majority of the matrix — match the live system
exactly, including the sequencing. The plan-round pattern (upload → client
accept/reject-with-remarks) and the RCA-upload pattern (linked-client-only)
are solid across both stages.

---

## Decisions made / work done this session (2026-08-01)

- **Stage 2 tail (critical finding #2):** stakeholder says ignore — leaving
  `close_stage2_audit`/`accept_stage2_tech_review` retired, no changes.
- **Report vs. NCR (critical finding #1):** resolved as a misreading, not a
  real divergence — see §1 above. Implemented the one real gap it surfaced:
  `stage1_report` now hidden from the linked client until
  `Stage1_Tech_Findings_Given`, in `RecordDetailView.tsx`.
- **CDC role (critical finding #3):** done — RPC half implemented in
  migration 243 (not yet applied); PS half (CRM view-only, others hidden)
  being configured manually by the stakeholder in Settings.

## Still open for the next session

**Standing preference:** stakeholder prefers Permission Sets over RPC changes
whenever PS can actually express the rule — PS is self-serve through Settings,
an RPC change needs a migration. Before writing any new RPC, confirm PS
genuinely can't cover it (it can't for workflow action buttons or
status-conditional visibility — see "The two layers" in RPC for file
fields.md — but double-check for anything not already covered here).

**Blocking — nothing below this session's new features works until these are done:**

1. **Apply `243_cdc_role_upload_gate.sql` and `244_assign_stage_team.sql`**
   (order doesn't matter, no interdependency). Until both are applied: the
   CDC upload will still silently advance status for CRM/Tech Reviewer
   (old behavior), and the new Assign Team panel in
   `StageAuditActionPanel.tsx` will error on every RPC call, since
   `assign_stage_team` and `get_tenant_users_by_role_pattern` won't exist yet.
2. **Confirm the CDC custom role actually exists** (Settings → User
   Management) and is assigned to whoever handles CDC review — migration 243's
   gate is inert without a real user carrying a role name matching `%cdc%`.
3. **Confirm Auditor/Tech Reviewer custom roles are correctly named** for
   the same reason — `get_tenant_users_by_role_pattern('auditor')`/`('tech')`
   only finds users whose `tenant.roles.name` contains those substrings.

**Permission Set config — stakeholder is doing these manually in Settings,
not a code task, nothing for a future session to build:**
- `stage1_ncr`: `can_read = false` for Client
- `cdc_report`: `can_edit = false` for CRM (stays `can_read = true`); `can_read = false` for Auditor/Tech Reviewer/Client

**Remaining design gaps, not yet built, no decision made yet:**

4. Stage 1/2 tech-findings-file uploads (`stage1_tech_findings_file`,
   `stage2_tech_findings_file`) have no role gate at all — should be
   Tech-Reviewer-only per the image, currently open to any role with
   Permission-Set edit access.
5. RCA/evidences accept gates (`review_stage1_ncr_rca`, `review_stage2_ncr_rca`,
   `review_stage2_evidences`) still allow CRM as well as the assigned Auditor
   — the image specifies Auditor-only. This is a **known, accepted**
   divergence (CRM's bypass was explicitly kept this session, see "Critical
   findings" #3 area above), not an oversight — don't "fix" it without
   re-raising it first.
6. `clientAgreement__c`'s CRM-only upload lock is written (migration 239)
   but not applied — decide whether to apply it, given the linked-client
   carve-out it contains is confirmed necessary for the signing flow to keep
   working (see RPC for file fields.md).
7. Certificate issuance (row 25) is a disconnected subsystem
   (`CertificateGeneratorTab.tsx` etc.) with no tie to this workflow's
   `status__a` flow at all — not scoped or discussed beyond noting the gap.
8. ~~Row 1 ("Application form") still needs clarification — is it actually a
   file upload, or a data-entry form?~~ **Resolved 2026-08-01 (sprint
   planning session):** it's a real file field (`application_Form__a`),
   populated by the Excel bulk-import tool — see row 1's updated verdict
   above. Stakeholder decision: no CRM/admin-only upload lock needed —
   current behavior (ungated at the RPC layer, reachable in practice only
   through the import tool) is fine as-is. Closed, no further action.
9. Migration 241 (separate Excel-import fields + a second, distinct
   `registration_date__a` + status-sync trigger) is a separate workstream,
   not written by this epic's sessions — not applied, not otherwise covered
   by anything in this document.
