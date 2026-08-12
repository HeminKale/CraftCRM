# Surveillance 1 (Renewal) — Sprint Plan

This document breaks the Surveillance 1 build into sprints. "Surveillance 1" is a UI
relabel of the existing `tenant.renewal_clients__a` object/table — not a new object.
The stakeholder renames "New Renewal" → "New Surveillance 1" manually in the UI; this
plan covers the schema/RPC/frontend work underneath that label.

**Scope confirmed this session:** build through **Certificate Issue** only.
Suspension and Withdrawal (the rights-matrix rows after Certificate Issue) are
explicitly deferred — not part of this plan.

Related: [`new-renewal-form.md`](../new-renewal-form.md) (current, pre-this-epic
behavior), and the External Client Stage 1/2 doc set (`S0_S1_S2.md` → `S6...md` in
`../../New/`) — this plan reuses that architecture throughout: two independent access
layers (Permission Sets for visibility, RPC role-name gating for upload-hard-block /
status-advance / accept-reject), soft-gate-by-default file uploads, plan-round
checkpoints (upload → client accept/reject-with-remarks, remarks cleared on
re-upload), dedicated date/rejection-notes columns per checkpoint, `status__a` as
plain TEXT resolved entirely in RPCs.

---

## Roles

Same convention as External Client — case-insensitive substring match on custom role
name, admin bypasses every gate, no new columns on `system.users`.

| Role | Matched by | Acts on |
|---|---|---|
| CRM Office | `%crm%` | Create record, upload intimation/plan/NCR/report/certificate, assign team, view everything |
| Auditor | `%auditor%` | Upload plan/NCR (alongside CRM), accept RCA (**alone** — see Sprint 2 note), close audit |
| Tech Reviewer | `%tech%` | Submit findings, upload checklist |
| CDC | `%cdc%` | Upload CDC report (upload *is* the approval) |
| Linked client | `renewal_clients__a.client_user_id__a = auth.uid()` | Accept intimation/plan, upload NCR RCA |
| admin | `system.users.role = 'admin'` | Everything (bypass) |

**Prerequisite, carried over from the External Client epic:** the Auditor / Tech
Reviewer / CDC roles must already exist in `tenant.roles` with names containing those
substrings, and real users must hold them, or the corresponding RPCs deny everyone
non-admin. Confirm before Sprint 1.

---

## Status flow (target, end of this plan)

```
(no status)        — record created, awaiting intimation letter
Intimation_Sent     — CRM uploads intimation letter                      [already live]
Intimation_Accepted — client accepts                                     [already live]
Team_Assigned       — CRM assigns Auditor + Tech Reviewer                [Sprint 1]
Surv_Plan_Sent       — CRM/Auditor upload audit plan                     [Sprint 1]
Surv_Plan_Accepted   — client accepts plan                               [Sprint 1]
Surv_NCR_Sent         — CRM/Auditor upload NCR                           [Sprint 2]
Surv_NCR_RCA_Uploaded — client uploads NCR + RCA                         [Sprint 2]
Surv_Auditor_Accepted — Auditor accepts RCA                              [Sprint 2]
Surv_Report_Sent      — CRM/Auditor upload audit report                 [Sprint 3]
Surv_Tech_Findings_Given — Tech Reviewer submits findings (or direct-accepts) [Sprint 3]
Surv_Closed           — Auditor closes                                  [Sprint 3]
CDC_Approved          — CDC uploads CDC report (upload is the approval) [Sprint 3]
Certificate_Issued    — CRM uploads certificate(s)                      [Sprint 3]
Suspension_Intimation_Sent   — CRM uploads suspension intimation        [Sprint 8]
Suspension_Decision_Uploaded — CDC uploads suspension decision          [Sprint 8]
Suspension_Letter_Sent       — CRM uploads suspension letter            [Sprint 8]
Withdrawal_Intimation_Sent   — CRM uploads withdrawal intimation        [Sprint 8]
Withdrawal_Decision_Uploaded — CDC uploads withdrawal decision          [Sprint 8]
Withdrawal_Letter_Sent       — CRM uploads withdrawal letter — terminal [Sprint 8]
```

**No longer terminal as of Sprint 8's plan:** `Certificate_Issued` was the end of the
chain through Sprint 6. Sprint 8 extends it — see below. (Sprint 7, documented
separately in `Sprint_7.md`, is orthogonal — Summary Excel import — and doesn't sit
in this linear chain at all.)

Reject step-backs: plan reject → stays `Surv_Plan_Sent` + client remarks (cleared on
CRM/Auditor's next plan upload, not just on accept — building the 238 bug-fix in from
day one instead of hitting it later); RCA reject → `Surv_NCR_Sent` + auditor remarks.
No reject path past RCA acceptance, matching Stage 1's one-way tail precedent.

**Existing behavior to fix, not just extend:** `review_surveillance_intimation`'s
current reject path resets `status__a = NULL` rather than a named status. Low
priority (NULL doubles as "awaiting first upload," which is arguably correct here
unlike mid-pipeline rejects) — revisit only if it causes confusion in testing.

---

## Sprint 0 — Quick Win: Rename, Email Field, Notification Route

Ships independently, no dependency on later sprints.

**Tasks**
- `NewRenewalForm.tsx`: "New Renewal" → "New Surveillance 1" (title, button text, any
  other literal copy).
- Add an **Email** input to the create form — pre-filled from the linked client's
  `email__a` when a client is selected, editable, required only if you want a
  notification sent (optional otherwise).
- Extend `create_renewal_client` RPC with an optional `p_email` param — overrides the
  copied `email__a` when provided (covers both "no client linked" and "client's
  stored email is stale" cases).
- New generic route `app/api/notifications/send/route.ts` (service-role, mirrors
  `send-invitation`'s shape) using **Resend** (`RESEND_API_KEY`,
  `RESEND_FROM_ADDRESS` default `sales1@twe.co.in`) — accepts `{ to, template,
  recordId, ... }` so it's reusable for every future "view/get email" checkpoint, not
  a one-off.
- Wire `NewRenewalForm.tsx`: after `create_renewal_client` succeeds (and after the
  optional intimation-letter upload), call the route with the intimation-letter
  template. Failure is a toast warning only — never blocks record creation, same
  philosophy the form already uses for its file-attach step.

**Acceptance criteria**
- Form reads "New Surveillance 1" everywhere the old label appeared.
- Creating a record with an email filled in sends a real email once
  `RESEND_API_KEY` is set and the `twe.co.in` domain shows Verified in Resend.
- Creating a record with no email, or before Resend is configured, still succeeds —
  the email step never fails record creation.

**Dependencies:** Resend account + domain verification (stakeholder-side, see prior
turn in this conversation). Code can be written and reviewed before verification
completes; only live sending is blocked until then.
**Effort:** 1 day

---

## Sprint 1 — Backend: Team Assignment + Plan Round

**Tasks**
- New migration (next free number — verify the current migration head before
  applying, `255` is the latest as of this session).
- Columns: `auditor_id__a` UUID, `tech_reviewer_id__a` UUID, `team_assigned_date__a`
  DATE, `surv_audit_plan__a` JSONB, `surv_plan_sent_date__a` DATE,
  `surv_plan_accepted_date__a` DATE, `surv_plan_client_remarks__a` TEXT.
- Convert existing `surveillance_audit_date__a` DATE → TEXT (free-text manual entry,
  no status implication — matching Stage 2's audit-date field and the corrected
  Stage 1 convention, so this object skips the DATE→TEXT rework Stage 1 needed).
  Placed conceptually between plan-accept and NCR upload, CRM/Auditor-entered.
- New RPC `assign_surv_team(p_record_id, p_auditor_id, p_tech_reviewer_id)` —
  CRM/admin gate, sets `status__a = 'Team_Assigned'` + date. Reuses the existing
  `get_tenant_users_by_role_pattern` RPC (already live from migration 244/247 — no
  new lookup RPC needed).
- New RPC `review_surv_plan(p_record_id, p_action, p_notes)` — linked-client/admin
  gate, mirrors `review_stage1_plan` exactly.
- Extend `finalize_file_upload`: `surv_audit_plan` upload — CRM-or-Auditor soft gate,
  auto-advance to `Surv_Plan_Sent`, clears `surv_plan_client_remarks__a` on **every**
  upload (not just accept).

**Acceptance criteria**
- CRM can assign an Auditor and Tech Reviewer; Auditor/Tech/CDC see the assignment
  read-only; wrong role denied.
- Plan upload by CRM/Auditor auto-advances; by anyone else, attaches but doesn't
  advance.
- Client accept/reject on the plan works; reject remarks show to CRM/Auditor and
  clear on the next upload, not on accept.

**Dependencies:** Auditor/Tech Reviewer roles must exist (see Roles section).
**Effort:** 2 days

---

## Sprint 2 — Backend: NCR + RCA + RCA Acceptance

**Tasks**
- New migration. Columns: `surv_ncr__a` JSONB, `surv_ncr_sent_date__a` DATE,
  `surv_ncr_rca__a` JSONB, `surv_ncr_rca_uploaded_date__a` DATE,
  `surv_auditor_accepted_date__a` DATE, `surv_rca_rejection_notes__a` TEXT.
- New RPC `review_surv_ncr_rca(p_record_id, p_action, p_notes)` — **Auditor/admin
  only.** ⚠️ Deliberately **not** widened to CRM, unlike Stage 1/2's equivalent gate —
  your rights matrix gives CRM view-only here. Flagging again since it's the one
  place this object's gate is *narrower* than the precedent it's otherwise copying.
  Accept → `Surv_Auditor_Accepted`; reject → `Surv_NCR_Sent` + notes.
- Extend `finalize_file_upload`: `surv_ncr` — CRM-or-Auditor soft gate, auto →
  `Surv_NCR_Sent`. `surv_ncr_rca` — linked-client soft gate, auto →
  `Surv_NCR_RCA_Uploaded`.

**Acceptance criteria**
- NCR upload by CRM/Auditor advances status; client cannot see `surv_ncr` at all once
  the Sprint 5 Permission Set change lands (code-side, the field itself is untouched
  here — this sprint is upload/accept gating only).
- RCA upload only by the linked client advances status.
- RCA accept only works for Auditor/admin; CRM gets denied on the RPC even though
  they can see the record — confirms the narrower gate is real, not accidental.

**Dependencies:** Sprint 1 (reuses its `finalize_file_upload` definition — extend,
don't fork).
**Effort:** 1.5 days

---

## Sprint 3 — Backend: Audit Report, Tech Review, Checklist, CDC, Certificate

**Tasks**
- New migration. Reuses two existing columns from the original schema instead of
  duplicating them: `surveillance_audit_report__a` (existing file field, relabel
  stays "Surveillance Audit Report") and `surveillance_certificates__a` /
  `certificates_sent_date__a` (existing files field + date, for Certificate Issue).
- New columns: `surv_report_sent_date__a` DATE, `surv_tech_findings_notes__a` TEXT,
  `surv_tech_findings_file__a` JSONB, `surv_tech_findings_date__a` DATE,
  `surv_closure_notes__a` TEXT, `surv_closed_date__a` DATE, `cdc_report__a` JSONB,
  `cdc_date__a` DATE.
- New RPC `submit_surv_tech_findings(p_record_id, p_notes)` — Tech Reviewer/admin,
  notes optional (empty box = direct accept, same trick Stage 1 uses) →
  `Surv_Tech_Findings_Given`.
- New RPC `close_surv_audit(p_record_id, p_closure_notes)` — **Auditor/admin only**
  (matches "auditor: view/close" in your matrix) → `Surv_Closed`.
- Extend `finalize_file_upload`:
  - `surveillance_audit_report` — CRM-or-Auditor soft gate, auto → `Surv_Report_Sent`.
  - `surv_tech_findings_file` — **Tech-Reviewer-only** soft gate, no auto-advance
    (optional supporting file). Note: External Client's equivalent field has *no*
    gate at all today (a known, flagged gap there) — this one ships properly gated
    from the start rather than copying that gap.
  - `cdc_report` — CDC-role-only soft gate (mirrors migration 243), auto →
    `CDC_Approved`.
  - `surveillance_certificates` — CRM-only soft gate, auto → `Certificate_Issued`
    (**terminal status for this plan**).
- Frontend: status-conditional visibility in `RecordDetailView.tsx` — hide
  `surveillance_audit_report` from the linked client until `Surv_Tech_Findings_Given`,
  same mechanism already implemented for `stage1_report`/`stage2_report`.

**Acceptance criteria**
- Full chain from `Surv_Auditor_Accepted` through `Certificate_Issued` walkable via
  RPC calls in the SQL editor, each gate denying the wrong role.
- Client cannot see the audit report until Tech Reviewer findings are in.
- CDC report upload by CRM/Tech does **not** advance status (only CDC role does) —
  confirms the gate isn't accidentally reused from the pre-243 wide version.

**Dependencies:** Sprints 1–2 (same `finalize_file_upload` chain).
**Effort:** 2.5 days

---

## Sprint 4 — Frontend: Action Panel + Workflow Bar

**Tasks**
- Extend `RenewalActionPanel.tsx` (currently 3 checkpoints) to cover all of: Assign
  Team, Plan upload/review, NCR upload, RCA upload/review, Report upload, Tech
  findings, Checklist upload, CDC upload, Certificate issue — one role-gated
  conditional block per checkpoint, same pattern as `StageAuditActionPanel.tsx`.
  Assign Team panel needs the role-pattern user dropdowns (reuse
  `get_tenant_users_by_role_pattern`, same UI pattern as External Client's Assign
  Team prompt).
- Rebuild `RenewalWorkflowBar.tsx` from its current hardcoded 5-stage array to the
  ~13-stage list above. Build the 7-wide sliding-window pattern proactively (Stage
  1/2 didn't need it until 12 stages; this object arrives there in one sprint) rather
  than retrofitting later.
- Remarks surfacing: `surv_plan_client_remarks__a` → CRM/Auditor on the revise-plan
  prompt; `surv_rca_rejection_notes__a` → client on the RCA upload prompt;
  `surv_closure_notes__a`/rejection equivalents → surfaced per the existing
  `rejection_notes__a` convention.
- Page Layout: place every new field (12+ across Sprints 1–3) into
  Settings → Object Manager → Renewal Clients → Page Layout — same manual step
  Stage 1/2 needed (fields registered in `tenant.fields` aren't visible until placed
  on a layout section).

**Acceptance criteria**
- Every role sees exactly the prompts their row of the rights matrix says they
  should, at the right status, and nothing else.
- Bar renders all stages, current stage centered, no layout break at 13 entries.
- `npx tsc --noEmit` clean.

**Dependencies:** Sprints 1–3 (RPCs must exist first).
**Effort:** 3 days

---

## Sprint 5 — Permission Set Configuration (manual, stakeholder-side, no code)

Per the app's two-layer architecture, these are Permission-Set-only jobs — no RPC
can express "hide this field from this role," and no code task exists for them:

- `surv_ncr`: `can_read = false` for the Client role (blank Client column in your
  matrix = no access at all, not just no-upload — matches the `stage1_ncr`
  precedent).
- `cdc_report`: `can_edit = false` for CRM (stays `can_read = true` — view only);
  `can_read = false` for Auditor / Tech Reviewer / Client.
- Confirm the CDC custom role exists (Settings → User Management) and is assigned to
  whoever handles CDC review — the RPC gate in Sprint 3 is inert without a real user
  carrying a role name matching `%cdc%`.

Also verify (code-adjacent, quick check not a build task): the new `status__a`
values got registered in `tenant.picklist_values` by Sprints 1–3's migrations (built
in from the start this time, unlike Stage 1's original gap) — confirm they show in
the edit-mode dropdown in the right order.

**Effort:** 0.5 day, stakeholder time

---

## Sprint 6 — QA, Real Uploads, Docs

**Tasks**
- End-to-end walk of one record through the full chain with 5 real test logins (CRM,
  Auditor, Tech Reviewer, CDC, External Client) — real file bytes through Storage,
  not RPC-only calls.
- Confirm Resend email actually lands for the intimation-letter notification once the
  domain is verified.
- Reject-path and role-deny tests at every checkpoint (wrong role denied, right role
  succeeds).
- Close out this doc set with a "what shipped" doc in `../` (this folder's parent),
  mirroring `S5.md`'s closing style from the External Client epic.

**Dependencies:** Sprints 0–5 complete.
**Effort:** 2 days

---

## Total estimated effort

~15.5 working days across 8 sprints (0–6, then 8; Sprint 7 — Summary Excel import —
is documented separately in `Sprint_7.md` and not counted here since it's
orthogonal to this linear chain). Backend sprints (1–3) and Sprint 4 (frontend) are
the bulk; Sprint 5 is pure stakeholder config; Sprint 0 can run in parallel with
Sprint 1 since it touches different files.

| Sprint | Focus | Effort |
|---|---|---|
| 0 | Rename + email field + Resend route | 1 day |
| 1 | Team assignment + plan round (backend) | 2 days |
| 2 | NCR + RCA + RCA acceptance (backend) | 1.5 days |
| 3 | Report + tech review + CDC + certificate (backend) | 2.5 days |
| 4 | Action panel + workflow bar (frontend) | 3 days |
| 5 | Permission Set config | 0.5 day (stakeholder) |
| 6 | QA + docs | 2 days |
| 8 | Suspension & Withdrawal chain (backend + frontend + PS + email) | 3 days |

---

## Field Reference (new/changed columns)

| Field | Column | Type | Set by |
|---|---|---|---|
| — | `auditor_id__a` | UUID | `assign_surv_team` |
| — | `tech_reviewer_id__a` | UUID | `assign_surv_team` |
| — | `team_assigned_date__a` | DATE | `assign_surv_team` |
| `surv_audit_plan` | `surv_audit_plan__a` | file | Upload — CRM/Auditor |
| — | `surv_plan_sent_date__a` | DATE | Auto, on upload |
| — | `surv_plan_accepted_date__a` | DATE | `review_surv_plan` accept |
| — | `surv_plan_client_remarks__a` | TEXT | `review_surv_plan` reject; cleared on next plan upload |
| — | `surveillance_audit_date__a` | TEXT (converted from DATE) | Manual entry, CRM/Auditor |
| `surv_ncr` | `surv_ncr__a` | file | Upload — CRM/Auditor |
| — | `surv_ncr_sent_date__a` | DATE | Auto, on upload |
| `surv_ncr_rca` | `surv_ncr_rca__a` | file | Upload — linked client |
| — | `surv_ncr_rca_uploaded_date__a` | DATE | Auto, on upload |
| — | `surv_auditor_accepted_date__a` | DATE | `review_surv_ncr_rca` accept |
| — | `surv_rca_rejection_notes__a` | TEXT | `review_surv_ncr_rca` reject |
| `surveillance_audit_report` | `surveillance_audit_report__a` | file *(existing, reused)* | Upload — CRM/Auditor |
| — | `surv_report_sent_date__a` | DATE | Auto, on upload |
| — | `surv_tech_findings_notes__a` | TEXT | `submit_surv_tech_findings` |
| `surv_tech_findings_file` | `surv_tech_findings_file__a` | file (optional) | Upload — Tech Reviewer only |
| — | `surv_tech_findings_date__a` | DATE | `submit_surv_tech_findings` |
| — | `surv_closure_notes__a` | TEXT | `close_surv_audit` |
| — | `surv_closed_date__a` | DATE | `close_surv_audit` |
| `cdc_report` | `cdc_report__a` | file | Upload — CDC role only |
| — | `cdc_date__a` | DATE | Auto, on upload |
| `surveillance_certificates` | `surveillance_certificates__a` | files *(existing, reused)* | Upload — CRM only |
| — | `certificates_sent_date__a` *(existing, reused)* | DATE | Auto, on upload |
| `surv_suspension_intimation` | `surv_suspension_intimation__a` | file | Upload — CRM only *(Sprint 8)* |
| — | `surv_suspension_intimation_date__a` | DATE | Auto, on upload *(Sprint 8)* |
| `surv_suspension_decision` | `surv_suspension_decision__a` | file | Upload — CDC only *(Sprint 8)* |
| — | `surv_suspension_decision_date__a` | DATE | Auto, on upload *(Sprint 8)* |
| `surv_suspension_letter` | `surv_suspension_letter__a` | file | Upload — CRM only *(Sprint 8)* |
| — | `surv_suspension_letter_date__a` | DATE | Auto, on upload *(Sprint 8)* |
| `surv_withdrawal_intimation` | `surv_withdrawal_intimation__a` | file | Upload — CRM only *(Sprint 8)* |
| — | `surv_withdrawal_intimation_date__a` | DATE | Auto, on upload *(Sprint 8)* |
| `surv_withdrawal_decision` | `surv_withdrawal_decision__a` | file | Upload — CDC only *(Sprint 8)* |
| — | `surv_withdrawal_decision_date__a` | DATE | Auto, on upload *(Sprint 8)* |
| `surv_withdrawal_letter` | `surv_withdrawal_letter__a` | file | Upload — CRM only *(Sprint 8, terminal)* |
| — | `surv_withdrawal_letter_date__a` | DATE | Auto, on upload *(Sprint 8)* |

---

## RPC Reference

| RPC | Gate | Effect |
|---|---|---|
| `create_renewal_client(p_external_client_id, p_email)` | CRM/admin | Creates record; `p_email` new, optional override |
| `assign_surv_team(p_record_id, p_auditor_id, p_tech_reviewer_id)` | CRM/admin | → `Team_Assigned` + date |
| `review_surv_plan(p_record_id, p_action, p_notes)` | Linked client/admin | accept → `Surv_Plan_Accepted` + date · reject → stays `Surv_Plan_Sent` + remarks |
| `review_surv_ncr_rca(p_record_id, p_action, p_notes)` | **Auditor/admin only** | accept → `Surv_Auditor_Accepted` + date · reject → `Surv_NCR_Sent` + notes |
| `submit_surv_tech_findings(p_record_id, p_notes)` | Tech Reviewer/admin | notes optional → `Surv_Tech_Findings_Given` + date |
| `close_surv_audit(p_record_id, p_closure_notes)` | Auditor/admin | → `Surv_Closed` + notes + date |

**No new RPCs in Sprint 8** — all six suspension/withdrawal checkpoints are
"upload IS the action," handled entirely inside `finalize_file_upload` /
`start_file_upload`, same as `cdc_report` and `surveillance_certificates` above.

No RPC hard-blocks on current `status__a` before acting — matches the existing loose
convention across the whole app; sequencing is enforced by which panel the frontend
shows, not by the RPC itself.

---

## Sprint 8 — Suspension & Withdrawal Chain

**✅ Built.** `npx tsc --noEmit` clean. Migrations 277–280 written, not yet
applied. Full build record: [`Sprint_8.md`](Sprint_8.md).

**Un-deferred.** The six rights-matrix rows after Certificate Issue (`suspension
intimation` → `withdrawal letter`) were explicitly out of scope through Sprint 6.
This sprint picks them back up, confirmed against a fresh read of the matrix.

**Confirmed shape (all six rows), different from every earlier checkpoint in this
object:** none of these six rows has an accept/reject step at all — every one is a
plain file/document field, and **the act of uploading it is the entire action**,
same pattern Sprint 3 already used for `cdc_report` and `surveillance_certificates`.
No new custom accept/reject RPC is needed anywhere in this sprint — only
`finalize_file_upload` / `start_file_upload` extensions, exactly like Sprint 3's
last two rows.

### Roles (confirmed against the matrix screenshot)

| Row | CRM | CDC | Client | Auditor / Tech Reviewer |
|---|---|---|---|---|
| suspension intimation | upload | — | view / **get email** | — |
| suspension decision | view | upload | — | — |
| suspension letter | upload | — | view / **get email** | — |
| withdrawal intimation | upload | — | view / **get email** | — |
| withdrawal decision | view | upload | — | — |
| withdrawal letter | upload | — | view / **get email** | — |

`—` = no access at all (`can_read = false`), not just no-upload — same convention
`surv_ncr`'s Client-blank cell used in Sprint 5.

**Email only fires for the four CRM-uploaded fields** (intimation ×2, letter ×2) —
the two CDC-uploaded decision fields are view-eligible (CRM can see them) but never
trigger an email, per this session's explicit confirmation. This lines up exactly
with the matrix: only rows with "get email" in the Client column send mail; the
decision rows have no Client cell at all.

### Field naming (proposed, confirms the `surv_` prefix convention Sprints 1–3
established for every genuinely new field — distinct from the original
`surveillance_` prefix migration 221 used for pre-existing fields)

| Matrix row | File column | Companion date column |
|---|---|---|
| suspension intimation | `surv_suspension_intimation__a` | `surv_suspension_intimation_date__a` |
| suspension decision | `surv_suspension_decision__a` | `surv_suspension_decision_date__a` |
| suspension letter | `surv_suspension_letter__a` | `surv_suspension_letter_date__a` |
| withdrawal intimation | `surv_withdrawal_intimation__a` | `surv_withdrawal_intimation_date__a` |
| withdrawal decision | `surv_withdrawal_decision__a` | `surv_withdrawal_decision_date__a` |
| withdrawal letter | `surv_withdrawal_letter__a` | `surv_withdrawal_letter_date__a` |

12 new columns total — 6 file, 6 date. No new text/notes columns: per this
session's confirmation, every one of these six rows is file/document-only, no
free-text remarks field the way earlier checkpoints (plan, RCA) had.

### Sequencing — confirmed strictly linear

Each of the 6 fields' `start_file_upload` hard block requires `status__a` to be
**exactly** the status the previous checkpoint set — no branching, no
"withdrawal without suspension" shortcut, matching every other chain in this
object:

| Field | Requires `status__a =` |
|---|---|
| `surv_suspension_intimation` | `Certificate_Issued` |
| `surv_suspension_decision` | `Suspension_Intimation_Sent` |
| `surv_suspension_letter` | `Suspension_Decision_Uploaded` |
| `surv_withdrawal_intimation` | `Suspension_Letter_Sent` |
| `surv_withdrawal_decision` | `Withdrawal_Intimation_Sent` |
| `surv_withdrawal_letter` | `Withdrawal_Decision_Uploaded` |

### Tasks

- New migration (next free number at build time — verify current head).
- 12 new columns on `tenant.renewal_clients__a` per the table above.
- Register all 12 in `tenant.fields` per tenant (display_order continues from
  Sprint 7's `surv_audit_pack` at 52 → 53 through 64).
- 6 new `status__a` picklist values (`Suspension_Intimation_Sent` through
  `Withdrawal_Letter_Sent`), display_order 14–19, continuing directly after
  Sprint 3's `Certificate_Issued` (13).
- Extend `finalize_file_upload` with 6 new `IF` blocks, one per field — CRM-only
  soft gate + auto-advance for the 4 intimation/letter fields, CDC-only soft gate
  + auto-advance for the 2 decision fields. Each sets its own `..._date__a` to
  `CURRENT_DATE`. Mirrors the `cdc_report` / `surveillance_certificates` blocks in
  migration 260 exactly — reproduce the full current live body, don't diff-patch
  (this repo's established convention for every shared-function change).
- Extend `start_file_upload` with 6 new hard-block role gates (CRM-only ×4,
  CDC-only ×2) plus the exact-prior-status sequencing gate from the table above.
  Mirrors migration 261's structure.
- Permission Set entries (SQL migration, same technique as migration 263 —
  resolved by tenant + PS name + field name, not hardcoded UUIDs):
  - Auditor, Tech reviewer: `can_read = false` on all 12 new fields (6 file + 6
    date) — blank cells across the board in the matrix.
  - Client: `can_read = false` on the 2 decision fields + their date columns —
    blank Client cell on those two rows only.
  - CDC: `can_read = false` on the 4 intimation/letter fields + their date
    columns — blank CDC cell on those four rows.
  - CRM: `can_edit = false` on the 2 decision fields (stays `can_read = true` —
    view only) — defense-in-depth alongside the RPC hard block, same pattern
    migration 263 used for `cdc_report`.
- **Email:** 4 new templates in `app/api/notifications/send/route.ts`'s
  `TEMPLATES` map — `surveillance_suspension_intimation`,
  `surveillance_suspension_letter`, `surveillance_withdrawal_intimation`,
  `surveillance_withdrawal_letter`. Same generic-route pattern Sprint 0 already
  built (this route was deliberately designed to grow one template per
  checkpoint, not a new endpoint each time).
- **Attachment plumbing (frontend, non-trivial — this is the real new work in
  this sprint, not the migration):** unlike Sprint 0's intimation-letter email
  (sent once, at record-creation time, from `NewRenewalForm.tsx`, which already
  has the file's bucket/path in scope right after upload), these four emails
  fire from an **existing record's** generic field editor — `FileUploadField.tsx`
  via `RecordDetailView.tsx`. `FileUploadField`'s `onUploadComplete` callback
  currently takes no arguments; it needs to optionally report back the
  bucket/path/filename of what was just uploaded (additive change — a bare
  `() => void` caller stays valid, every other object's call site is
  untouched). `RecordDetailView.tsx` then needs a small object-scoped map (same
  pattern as `RENEWAL_FILE_FIELD_UPLOAD_ROLE`) naming which 4 fields trigger an
  email, and on a matching upload: read `recordData.email__a` (already stored on
  every renewal record, copied at creation — no extra lookup needed), sign a URL
  for the just-uploaded file (`supabase.storage.createSignedUrl`, same call
  `NewRenewalForm.tsx`'s Sprint 0 fix now uses — **not** a stored `.url` key,
  there isn't one), and POST to `/api/notifications/send` with the matching
  template. Failure is a toast warning only, never blocks the upload itself —
  same soft-failure philosophy as every other notification in this epic.
- `RenewalActionPanel.tsx`: 6 new instructional banner blocks (no buttons, no
  RPC calls from this panel — same shape as the existing "Upload CDC Report" /
  "Issue Certificate" banners), one per checkpoint, gated to the correct
  uploading role at the correct status.
- `RenewalWorkflowBar.tsx`: extend `STAGES` from 13 to 19 entries. The
  sliding-window pattern is already built (Sprint 4) — this is array growth
  only, no logic change.
- `RecordDetailView.tsx`: add all 6 new file fields to
  `RENEWAL_FILE_FIELD_UPLOAD_ROLE` (4× `crm_only`, 2× `cdc_only`).
- Page Layout: place all 12 new fields (Object Manager → Renewal Clients → Page
  Layout) — same manual step every prior sprint needed.
- **Verify `surveillance_intimation_letter` is actually viewable on the record**
  (this session's point 4) — it's been a registered field since the original
  migration 221 and almost certainly already sits on Page Layout from before
  this epic renamed "Renewal" to "Surveillance 1," but confirm rather than
  assume: check Object Manager → Page Layout has it placed, and that no
  Permission Set entry denies Client `can_read` on it. If both are already true,
  this is a zero-code verification step, not a build task.

**Acceptance criteria**
- CRM can upload suspension intimation only when `status__a = 'Certificate_Issued'`;
  wrong role/status denied at every one of the 6 sequencing gates in the table above.
- Client receives an email with the suspension-intimation file attached the
  moment CRM uploads it; Auditor/Tech Reviewer/CDC cannot see the field at all.
- CDC can upload the suspension decision; CRM can view it (not edit); Client
  cannot see it; no email fires for this upload.
- Same two patterns repeat correctly for suspension letter, then all three
  withdrawal rows.
- `surveillance_intimation_letter` confirmed viewable on the record by the
  linked client (verification step, not new code, unless something's actually
  missing).
- `npx tsc --noEmit` clean.

**Dependencies:** Sprints 1–4 (same `finalize_file_upload` / `start_file_upload` /
`RenewalActionPanel.tsx` / `RenewalWorkflowBar.tsx` chain, extended not forked).
Independent of Sprint 7 (Summary Excel import) — no shared files.
**Effort:** 3 days (migration + PS entries ~0.5 day, email plumbing ~1 day since it
touches a shared component's prop signature, action panel + workflow bar ~1 day,
manual Page Layout + verification + QA ~0.5 day).

---

## Explicitly out of scope for this plan

- **`review_surveillance_intimation`'s NULL-reset reject path** — left as-is, not a
  confirmed bug (see status-flow section above).
- **Repeat suspension cycles** (a client suspended, reinstated, then suspended
  again) — Sprint 8 models one pass through Suspension → Withdrawal as a terminal
  chain, not a loop. Revisit only if the real workflow needs reinstatement.
