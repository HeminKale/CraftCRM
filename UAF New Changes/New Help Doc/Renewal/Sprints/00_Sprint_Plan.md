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
Certificate_Issued    — CRM uploads certificate(s) — terminal for this plan [Sprint 3]
```

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

~12.5 working days across 7 sprints (0–6). Backend sprints (1–3) and Sprint 4
(frontend) are the bulk; Sprint 5 is pure stakeholder config; Sprint 0 can run in
parallel with Sprint 1 since it touches different files.

| Sprint | Focus | Effort |
|---|---|---|
| 0 | Rename + email field + Resend route | 1 day |
| 1 | Team assignment + plan round (backend) | 2 days |
| 2 | NCR + RCA + RCA acceptance (backend) | 1.5 days |
| 3 | Report + tech review + CDC + certificate (backend) | 2.5 days |
| 4 | Action panel + workflow bar (frontend) | 3 days |
| 5 | Permission Set config | 0.5 day (stakeholder) |
| 6 | QA + docs | 2 days |

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

No RPC hard-blocks on current `status__a` before acting — matches the existing loose
convention across the whole app; sequencing is enforced by which panel the frontend
shows, not by the RPC itself.

---

## Explicitly out of scope for this plan

- **Suspension / Withdrawal** (rights-matrix rows after Certificate Issue) —
  deferred per this session's decision. `Certificate_Issued` is the terminal status
  until a future sprint plan picks this back up.
- **`review_surveillance_intimation`'s NULL-reset reject path** — left as-is, not a
  confirmed bug (see status-flow section above).
