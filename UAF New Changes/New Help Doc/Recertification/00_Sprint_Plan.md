# Recertification — Sprint Plan

**Status: Sprints 0-4 built and migrated to the live database; Sprints 5-6
(frontend, Permission Sets) built, not yet migrated/QA'd; Sprint 8 (Summary
Excel Import, unplanned addition) built, not yet migrated.** (264-268 all run
successfully; RLS deliberately skipped for the new table, consistent with
`external_clients__a`/`renewal_clients__a`, which have never had RLS either —
both rely purely on RPC-level `tenant_id` filtering.)

**CDC-checkpoint blocker: fixed, pending migration run.** The invite-user
flow had two bugs (a dual-account-creation collision that likely broke every
first-time invite, and a silently-dropped custom-role picker) — both fixed
this session, see `supabase/migrations/270_fix_invite_custom_role.sql` and
the `send-invitation` route rewrite. Resend is now configured (API key +
from-address added). Once 270 is run, inviting a CDC user works correctly in
one step. Not a code gap in migration 268 — that gate was always correct;
this was purely a prerequisite-data/invite-infrastructure problem.
- Sprint 0: `supabase/migrations/264_recertification_table_and_intimation.sql`
- Sprint 1: `supabase/migrations/265_recertification_intake.sql`
- Sprint 2: `supabase/migrations/266_recertification_team_and_plan.sql` —
  `assign_recert_team` / `review_recert_plan`, `recert_audit_plan` upload
  gates with the re-upload status guard shipped from day one (unlike
  Surveillance 1, which needed migration 262 as a follow-up fix for the same
  gap).
- Sprint 3: `supabase/migrations/267_recertification_ncr_rca_evidences.sql` —
  `review_recert_ncr_rca` / `review_recert_evidences`, both gated to the
  SPECIFIC assigned auditor (not just any Auditor-role holder); NCR/RCA/
  evidences upload gates, all three with re-upload status guards from day
  one; `recert_ncr_rca` and `recert_evidences` uploads deliberately do NOT
  clear their rejection-notes fields (only the review RPCs' accept branch
  does) — matches Surveillance 1's migration 259 correction, built in here
  from the start rather than needing its own fix.
- Sprint 4: `supabase/migrations/268_recertification_report_tech_cdc_certificate.sql`
  — `submit_recert_tech_findings` / `close_recert_audit`; all four Sprint 4
  hard upload gates (`recert_audit_report` CRM-or-Auditor, `recert_tech_findings_file`
  Tech-only, `recert_cdc_report` CDC-only, `recert_certificates` CRM-only)
  shipped in this same migration rather than split across a follow-up file
  the way Surveillance 1's were. Row-by-row re-verified against the actual
  rights-matrix screenshot while writing, not just the plan text — see
  `Sprint_4.md`. This is the **19th and final** `status__a` value registered
  for this epic (1+5+3+5+5 = 19, matching the plan's target flow exactly).
- Sprint 5 (Frontend): `RecertificationActionPanel.tsx` (20 checkpoint panels)
  + `RecertificationWorkflowBar.tsx` (19-stage bar), both own files, plus
  `RecordDetailView.tsx` changes — a third, independent `RECERT_STATUS_ORDER`
  array (client-visibility lock on `recert_audit_report`, built in from the
  start, not retrofitted) and `RECERT_FILE_FIELD_UPLOAD_ROLE` map (12
  entries), neither merged with the other two objects' equivalents.
  `npx tsc --noEmit` clean (0 errors); `git diff` on `RecordDetailView.tsx`
  showed only the 2 intentional line replacements as deletions — External
  Client's and Surveillance 1's code paths confirmed untouched.
- Sprint 6 (Permission Sets): `supabase/migrations/269_recertification_permission_set_entries.sql`
  — 18 entries across 10 fields, direct `INSERT ... ON CONFLICT`, no manual
  Settings walkthrough. Scope re-derived from 263's precedent while writing,
  not transcribed from the earlier draft table in this doc — three rows in
  that draft turned out to be wrong (an unregistered-field target and two
  remarks-fields CRM/Auditor/the client need to read, not hide) and were
  dropped; the table above now matches what actually shipped.
- `NewRecertificationForm.tsx` (registered in `CustomTabRenderer.tsx`) +
  `recertification_intimation` email template in
  `app/api/notifications/send/route.ts`.
- Sprint 8 (Summary Excel Import, unplanned addition — mirrors Surveillance
  1's own Sprint 7): `supabase/migrations/273_recert_summary_metadata_fields.sql`
  (23 new fields, including a real pre-existing gap this closed —
  `recert_audit_date__a`, the only one of the three workflow objects that
  never got a manual "audit conducted on" field) +
  `274_recert_summary_rpcs.sql` + `RecertificationImport.tsx` +
  `RecertificationSummaryTab.tsx` + `recertSheetMapping.ts`. Single-table
  direct import (no separate summary object), matching Surveillance 1's own
  Sprint 7 as actually built, not New Client's heavier separate-table
  architecture — confirmed decision. Written against `SurveilanceImport.tsx`'s
  *corrected* RPC signatures from the start (3 real bugs that component
  shipped with — wrong object-UUID resolution, wrong `update_tenant_record`
  params, wrong stored-file shape — none repeated here). See `Sprint_8.md`.

Per-sprint "what shipped" docs: [`Sprint_0_1.md`](Sprint_0_1.md),
[`Sprint_2.md`](Sprint_2.md), [`Sprint_3.md`](Sprint_3.md),
[`Sprint_4.md`](Sprint_4.md), [`Sprint_5.md`](Sprint_5.md),
[`Sprint_6.md`](Sprint_6.md), [`Sprint_8.md`](Sprint_8.md) — written alongside
each sprint from Sprint 4 onward (Sprints 0-3's docs were written
retroactively after the gap was
flagged).

Every migration from 265 onward that touches `start_file_upload`/
`finalize_file_upload` reproduces the immediately-prior migration's body and
gets diffed (comments-stripped) to confirm byte-identical outside the new
blocks — done for every hop (264→265→266→267→268), not just assumed. Not yet
QA'd. Sprint 7 (QA) remains unbuilt — the last sprint in this plan. Page
Layout placement (your side) still needed before the new fields are visible
in the UI, same as both prior epics.

A third parallel workflow object alongside New Client (`external_clients__a`) and
Surveillance 1 (`renewal_clients__a`). Confirmed this session: **new table**
`tenant.recertification_clients__a`, linked back to the original client via
`external_client_id__a` — same shape as how Renewal links to External Client, never
sharing a table with either.

**Naming convention, deliberate:** every new column/RPC in this epic uses a
`recert_`/`Recert` prefix, distinct from Renewal's `surv_`/`Surv` prefix and
External Client's `stage1_`/`stage2_` prefix. This isn't just tidiness — a
**Surveillance 2** epic is explicitly planned to follow this one, and picking
non-colliding prefixes now is what let this session's `surv_ncr` vs `stage1_ncr`
naming stay collision-free for two different objects sharing `finalize_file_upload`/
`start_file_upload`. Recertification does the same for whatever Surveillance 2 will
need.

**Confirmed decisions this session** (do not re-litigate without a reason):
1. New table, linked via `external_client_id__a` — not new columns on
   `external_clients__a`.
2. Rows 2–6 (Application form → Signed client agreement) are a **fresh cycle** —
   new fields, new uploads, new accept RPCs, independent of the client's original
   External Client application/quotation/agreement.
3. **Application form is Client-uploaded**, not CRM — matches row 2 as written, and
   matches how New Client's form actually works today (confirmed by you, not
   assumed by me).
4. Scope: build through **Certificate Issue (row 18)** only — this matrix has no
   Suspension/Withdrawal rows at all, so there's no equivalent boundary question
   Renewal had.
5. **Permission Set entries as SQL from the start** (migrations against
   `tenant.permission_set_entries`, matched by tenant + PS name + field name — same
   technique proven working in Renewal's migration 263) — no manual-walkthrough
   sprint, no "convert it to SQL later" detour.

---

## Source precedent for every phase

| Recertification phase | Copies the shape of | Not a copy of |
|---|---|---|
| Intimation (row 1) | Surveillance 1 Sprint 0 (CRM upload → notify) | — |
| Application/Quotation/Agreement (rows 2–6) | New Client's `review_client_application` / `review_client_agreement` RPCs (233/213) | New Client's Excel-parsing `create_object_record` bootstrapping — record creation is a simple `create_recertification_client(p_external_client_id)` picker, like `create_renewal_client`, not a file-driven record creation |
| Assign Team (row 7) | Surveillance 1 `assign_surv_team` / External Client `assign_stage_team` | — |
| Audit Plan (row 8–9) | Surveillance 1 `surv_audit_plan` / `review_surv_plan` | — |
| NCR + RCA + RCA-accept (rows 10–12) | Surveillance 1 `surv_ncr` / `surv_ncr_rca` / `review_surv_ncr_rca` | — |
| **Evidences (row 13)** | **External Client Stage 2's `stage2_evidences` / `review_stage2_evidences`** | Surveillance 1 has no evidences round at all — this row makes Recertification structurally closer to Stage 2 than to Surveillance 1 |
| Audit Report + Tech Findings + Close (rows 14–15) | Surveillance 1 `surveillance_audit_report` / `submit_surv_tech_findings` / `close_surv_audit` | External Client's later revision-loop-back (migration 253) — not built here, same call as Surveillance 1 made |
| Tech Checklist (row 16) | Surveillance 1 `surv_tech_findings_file` — Tech-only hard gate from day one | External Client's `stage1_tech_findings_file`, which still has no upload gate at all |
| CDC (row 17) | Surveillance 1 `cdc_report` — hard-gated in `start_file_upload` from day one | External Client's `cdc_report`, which is PS-only (243's deliberate choice, still true today) |
| Certificate Issue (row 18) | Surveillance 1 `surveillance_certificates` (reused-field pattern) | Not reused here — Recertification gets its own `recert_certificates__a`, since there's no pre-existing field to inherit the way Renewal inherited from migration 221 |

---

## Roles

Identical convention to both prior epics — case-insensitive substring match on
custom role name, admin bypasses every gate, reuses the same five Permission Sets
already confirmed live this session (`CRM Office`, `Auditor`, `Tech reviewer`,
`CDC`, `External Customer`) and the same `get_tenant_users_by_role_pattern` /
`assign_*_team` pattern — no new roles, no new Permission Sets to create.

---

## Target status flow

```
Recert_Intimation_Sent        — CRM uploads intimation letter
Recert_Application_Sent       — Client uploads application form
Recert_Application_Accepted   — CRM accepts
Recert_Quotation_Received     — CRM uploads quotation
Recert_Agreement_Sent         — CRM uploads client agreement
Recert_Agreement_Signed       — Client accepts + signs
Recert_Team_Assigned          — CRM assigns Auditor + Tech Reviewer
Recert_Plan_Sent              — CRM/Auditor upload audit plan
Recert_Plan_Accepted          — Client accepts plan
Recert_NCR_Sent                — CRM/Auditor upload NCR
Recert_NCR_RCA_Uploaded        — Client uploads NCR + RCA
Recert_Auditor_Accepted        — Auditor accepts RCA
Recert_Evidences_Uploaded      — Client uploads evidences
Recert_Evidences_Accepted      — Auditor accepts evidences
Recert_Report_Sent             — CRM/Auditor upload audit report
Recert_Tech_Findings_Given     — Tech Reviewer writes findings
Recert_Closed                  — Auditor closes
Recert_CDC_Approved            — CDC uploads CDC report
Recert_Certificate_Issued      — CRM uploads certificate(s) — terminal
```

19 statuses — six more than Surveillance 1's 13, driven entirely by the intake
phase (6 rows) this epic has and Surveillance 1 didn't. Reject step-backs mirror
the same "stays at the sent status + remarks, cleared on next upload not just
accept" pattern used for the plan checkpoint in both prior epics; RCA/evidences
reject follows External Client Stage 2's step-back targets (reject evidences →
back to `Recert_Auditor_Accepted`, not further back to NCR).

---

## Sprint 0 — Table + Intimation

**Tasks**
- New migration: `CREATE TABLE tenant.recertification_clients__a` — `id`,
  `tenant_id`, `external_client_id__a` (FK, required — this object never exists
  without a prior External Client), `client_user_id__a` (copied for RLS/auth, same
  as Renewal), `name`, `company_name__a`, `contact_person__a`, `email__a`,
  `iso_standards__a`, `status__a`, plus the intimation file/date pair.
- Register object + these initial fields in `tenant.objects`/`tenant.fields`.
- `create_recertification_client(p_external_client_id UUID, p_email TEXT DEFAULT NULL)`
  — CRM/admin gate, copies fields from the linked `external_clients__a` record
  (mirrors `create_renewal_client` exactly, including the `p_email` override
  Renewal's Sprint 0 added). `p_external_client_id` is **required**, not optional
  like Renewal's — this object cannot exist unlinked.
- `recert_intimation_letter` upload — CRM-only soft + hard gate (`start_file_upload`
  hard block from day one, not added later like Surveillance 1's intimation letter
  had to be) → `Recert_Intimation_Sent`.
- Reuse `app/api/notifications/send/route.ts` from Surveillance 1 — add one new
  template (`recertification_intimation`), same non-blocking wiring as Renewal's
  form.
- New frontend form `NewRecertificationForm.tsx` (client picker required, not
  optional — company/date/email fields, intimation upload) — own file, does not
  touch `NewRenewalForm.tsx` or `NewClientForm.tsx`.

**Acceptance criteria:** CRM can create a recertification record only against an
existing External Client; intimation upload is hard-blocked to CRM/admin at the RPC
level from the first migration, not retrofitted.

**Effort:** 1.5 days

---

## Sprint 1 — Intake: Application, Quotation, Agreement

**Tasks**
- Columns: `recert_application_form__a` (file), `recert_application_sent_date__a`,
  `recert_application_accepted_date__a`, `recert_quotation__a` (file),
  `recert_quotation_received_date__a`, `recert_agreement__a` (file),
  `recert_agreement_sent_date__a`, `recert_agreement_signed_date__a`,
  `rejection_notes__a` (shared, matches the generic-reject-notes convention already
  used on both prior objects).
- `recert_application_form` upload — **Client-only** hard gate (start_file_upload,
  from day one) → `Recert_Application_Sent`. Confirmed deliberately different from
  Surveillance 1's intimation-letter/CRM pattern — the client submits their own
  application.
- `review_recert_application(p_record_id, p_action, p_notes)` — CRM/admin, mirrors
  `review_client_application` (213) — accept → `Recert_Application_Accepted` +
  date; reject → back to `Recert_Application_Sent` (not NULL — this record already
  has a linked client, unlike New Client's from-scratch reject-to-NULL) + notes.
- `recert_quotation` upload — CRM-only hard gate → `Recert_Quotation_Received`.
- `recert_agreement` upload — CRM-only hard gate → `Recert_Agreement_Sent`.
- `review_recert_agreement(p_record_id, p_action, p_notes)` — linked client/admin,
  mirrors `review_client_agreement` (213) — accept → `Recert_Agreement_Signed` +
  date; reject → back to `Recert_Quotation_Received` + notes.

**Acceptance criteria:** full intake chain walkable via RPC calls, each gate
denying the wrong role; reject paths land on the matrix-correct step-back status,
not a blanket NULL reset.

**Dependencies:** Sprint 0.
**Effort:** 2 days

---

## Sprint 2 — Team Assignment + Audit Plan

**Tasks**
- Columns: `auditor_id__a`, `tech_reviewer_id__a` (UUID, **not** registered in
  `tenant.fields` — same reasoning as both prior epics), `recert_team_assigned_date__a`,
  `recert_audit_plan__a` (file), `recert_plan_sent_date__a`,
  `recert_plan_accepted_date__a`, `recert_plan_client_remarks__a`.
- `assign_recert_team(p_record_id, p_auditor_id, p_tech_reviewer_id)` — CRM/admin,
  only fires at `Recert_Agreement_Signed` (mirrors both prior epics' "team assigned
  right after the client's final intake step" placement). Reuses
  `get_tenant_users_by_role_pattern` — no new lookup RPC.
- `recert_audit_plan` upload — CRM-or-Auditor hard gate + team-assignment-required
  hard gate (mirrors Surveillance 1's `surv_audit_plan` exactly, including the
  re-upload status guard from day one — not retrofitted like Surveillance 1 needed
  migration 262 for) → `Recert_Plan_Sent`, clears remarks on every upload.
- `review_recert_plan(p_record_id, p_action, p_notes)` — linked client/admin,
  mirrors `review_surv_plan` — accept → `Recert_Plan_Accepted` + date + clear
  remarks; reject → stays `Recert_Plan_Sent` + remarks.

**Dependencies:** Sprint 1. Auditor/Tech Reviewer roles must exist (same
prerequisite as both prior epics).
**Effort:** 2 days

---

## Sprint 3 — NCR + RCA + Evidences (the Stage-2-shaped round)

**Tasks**
- Columns: `recert_ncr__a`, `recert_ncr_sent_date__a`, `recert_ncr_rca__a`,
  `recert_ncr_rca_uploaded_date__a`, `recert_auditor_accepted_date__a`,
  `recert_rca_rejection_notes__a`, `recert_evidences__a` (**files**, plural —
  matches External Client's `stage2_evidences` multi-file shape, not a single
  `file` like everything else in this epic), `recert_evidences_uploaded_date__a`,
  `recert_evidences_accepted_date__a`, `recert_evidences_rejection_notes__a`.
- `recert_ncr` upload — CRM-or-Auditor hard gate + re-upload guard →
  `Recert_NCR_Sent`.
- `recert_ncr_rca` upload — Client-only hard gate + re-upload guard →
  `Recert_NCR_RCA_Uploaded`.
- `review_recert_ncr_rca(p_record_id, p_action, p_notes)` — **Auditor/admin only,
  specific-assigned-auditor** (matches row 12: CRM is view-only, same confirmed
  pattern as Surveillance 1's `review_surv_ncr_rca`) — accept →
  `Recert_Auditor_Accepted` + date + clear notes; reject → `Recert_NCR_Sent` +
  notes. **Does not clear notes on RCA re-upload** — matches the corrected
  behavior from Renewal's migration 259, built in here from the start rather than
  needing its own fix.
- `recert_evidences` upload — Client-only hard gate + re-upload guard →
  `Recert_Evidences_Uploaded`.
- `review_recert_evidences(p_record_id, p_action, p_notes)` — Auditor/admin,
  specific-assigned-auditor, mirrors `review_stage2_evidences` (234) — accept →
  `Recert_Evidences_Accepted` + date; reject → back to `Recert_Auditor_Accepted`
  (client re-uploads evidences only, RCA itself isn't reopened) + notes.

**Acceptance criteria:** row 12/13's CRM-view-only, Auditor-only-accept pattern
holds on both the RCA and the evidences checkpoint; Tech Reviewer denied read on
`recert_ncr` per row 10's blank cell (Sprint 6/PS territory, but the RPC/hard-gate
half must already be correct here).

**Dependencies:** Sprint 2.
**Effort:** 2.5 days

---

## Sprint 4 — Audit Report, Tech Review, Checklist, CDC, Certificate

**Tasks**
- Columns: `recert_audit_report__a` (file), `recert_report_sent_date__a`,
  `recert_tech_findings_notes__a`, `recert_tech_findings_file__a` (optional file),
  `recert_tech_findings_date__a`, `recert_closure_notes__a`, `recert_closed_date__a`,
  `recert_cdc_report__a`, `recert_cdc_date__a`, `recert_certificates__a` (files),
  `recert_certificates_sent_date__a`.
- `recert_audit_report` upload — CRM-or-Auditor hard gate + re-upload guard →
  `Recert_Report_Sent`.
- `submit_recert_tech_findings(p_record_id, p_notes)` — Tech Reviewer/admin,
  specific-assigned, notes optional (blank = accept without findings) →
  `Recert_Tech_Findings_Given`.
- `close_recert_audit(p_record_id, p_closure_notes)` — Auditor/admin,
  specific-assigned → `Recert_Closed`.
- `recert_tech_findings_file` upload — **Tech-only hard gate from day one**
  (matches Surveillance 1's improvement over External Client's still-ungated
  equivalent).
- `recert_cdc_report` upload — CDC-only hard gate **from day one** (matches
  Surveillance 1's improvement over External Client's PS-only `cdc_report`) →
  `Recert_CDC_Approved`.
- `recert_certificates` upload — CRM-only hard gate → `Recert_Certificate_Issued`
  (terminal for this plan).
- Frontend spec note (Sprint 5 territory, flagged here since it's the same pattern
  as both prior epics): `recert_audit_report` needs the status-conditional
  client-visibility lock (hide until `Recert_Tech_Findings_Given`) — build it in
  Sprint 5 from the start; Surveillance 1 missed this on the first pass and it took
  a follow-up audit to catch.

**Dependencies:** Sprint 3.
**Effort:** 2.5 days

---

## Sprint 5 — Frontend

**Tasks**
- `RecertificationActionPanel.tsx` — own file, ~16 checkpoints (Intimation review →
  Application upload/review → Quotation → Agreement upload/review → Assign Team →
  Plan upload/review → NCR upload → RCA upload/review → Evidences upload/review →
  Report upload → Tech Findings → Close → Checklist → CDC → Certificate). Copy
  `RenewalActionPanel.tsx`'s structure (hardened `isClientOnly` exclusion, shared
  accept/reject handler, CDC included in the assigned-team read-only strip from the
  start — Surveillance 1 missed that one on the first pass too).
- `RecertificationWorkflowBar.tsx` — own file, 19-stage sliding-window bar, same
  `WINDOW_RADIUS = 3` pattern as both prior epics.
- `RecordDetailView.tsx` changes (the one shared file this touches, same as both
  prior epics did): add a **third**, independent `RECERTIFICATION_FILE_FIELD_UPLOAD_ROLE`
  map — do not add entries to the Surveillance 1 or External Client maps, and do
  not merge maps. Add `recert_audit_report` to the status-lock mechanism using its
  own status-order array (`RECERT_STATUS_ORDER`), same reason
  `SURV_STATUS_ORDER` had to be its own array — `Recert_Team_Assigned` and other
  status names will very likely collide with names already used by the other two
  objects' arrays if merged.
- Page Layout placement (manual, your side, same as always) — full field list from
  Sprints 0–4.

**Dependencies:** Sprints 0–4.
**Effort:** 3.5 days

---

## Sprint 6 — Permission Set Entries (SQL) — BUILT

**Migration:** `supabase/migrations/269_recertification_permission_set_entries.sql`.
Same technique as Renewal's 263: resolve each Permission Set by tenant + exact
name (`CRM Office`, `Auditor`, `Tech reviewer`, `CDC`, `External Customer`),
resolve each field by object + name, direct `INSERT ... ON CONFLICT` into
`tenant.permission_set_entries`. No manual Settings walkthrough sprint.

**Deny list actually shipped** — narrower than every earlier draft of this
table, not broader. Re-deriving from 263's own scope discipline (not just its
SQL technique) while writing the migration found the previous draft below
included several rows that don't belong at all: an unregistered-field entry
(`auditor_id__a`/`tech_reviewer_id__a` — impossible to target, not in
`tenant.fields`) and three reject-reason/remarks-field entries that would have
hidden context CRM/Auditor/the client need to read to act on a revision
(`recert_plan_client_remarks__a`, `recert_rca_rejection_notes__a`) — see
`Sprint_6.md` for the full reasoning on each dropped row:

| Field | Denied for |
|---|---|
| `recert_intimation_letter` | Auditor, Tech reviewer |
| `recert_application_form` | Auditor, Tech reviewer |
| `recert_quotation` | Auditor, Tech reviewer |
| `recert_agreement` | Auditor, Tech reviewer |
| `recert_audit_plan` | Tech reviewer only |
| `recert_ncr` | Tech reviewer only |
| `recert_ncr_rca` | none — no blank cell on this row at all |
| `recert_evidences` | none — no blank cell on this row at all |
| `recert_tech_findings_notes` | External Customer (Client) |
| `recert_tech_findings_file` | External Customer (Client) |
| `recert_cdc_report` | External Customer, Auditor, Tech reviewer |
| `recert_cdc_report` (CRM) | edit denied, stays view-only |
| `recert_certificates` | Auditor, Tech reviewer |

Accept-only rows (Application acceptance, Signed client agreement, Recert plan
accept, NCR+RCA acceptance, Tech findings close) get no PS entries — their
blank cells mean "no accept/close button for this role," already enforced by
each RPC's own role check, matching 263's exact precedent for its own
equivalent rows.

- Confirm CDC/Auditor/Tech reviewer roles exist and are assigned (should already be
  true from the Surveillance 1 rollout — just a check, not new work). **CDC
  specifically is a known open blocker** — see the status header above; the
  migration's `recert_cdc_report` entries are correct and ready regardless.

**Dependencies:** Sprint 5 (fields must be registered before entries can target
them by field ID).
**Effort:** 1 day

---

## Sprint 7 — QA

**Tasks**
- Full chain walk, 5 real logins (CRM, Auditor, Tech Reviewer, CDC, External
  Client), real files through Storage.
- Confirm none of Sprints 0–6 touched External Client's or Surveillance 1's tables,
  RPCs, or components — same verification method used to confirm that for
  Surveillance 1 (diff the shared-function bodies before/after, not just re-read
  the code and assume).
- Closing "what shipped" doc.

**Dependencies:** Sprints 0–6 complete, your Page Layout + role-assignment steps done.
**Effort:** 2 days

---

## Total estimated effort

~14.5 working days across 8 sprints (0–7) — about 2 days more than Surveillance 1,
almost entirely from the intake phase (Sprint 1) Surveillance 1 didn't need.

| Sprint | Focus | Effort |
|---|---|---|
| 0 | Table + Intimation | 1.5 days |
| 1 | Intake: Application/Quotation/Agreement | 2 days |
| 2 | Team Assignment + Audit Plan | 2 days |
| 3 | NCR + RCA + Evidences | 2.5 days |
| 4 | Report + Tech Review + CDC + Certificate | 2.5 days |
| 5 | Frontend | 3.5 days |
| 6 | Permission Sets (SQL) | 1 day |
| 7 | QA | 2 days |

---

## Cross-epic safety checklist (apply every sprint, not just at the end)

Learned the hard way this session — check this every time a migration touches
`finalize_file_upload` / `start_file_upload`, or a frontend edit touches
`RecordDetailView.tsx`:

1. Does the migration reproduce the **current live** body of the shared function
   (verified via `pg_get_functiondef`, not assumed from the migrations folder —
   the two have already drifted once this session) before adding to it?
2. Does every new frontend map/array live in its **own** variable, never merged
   into an existing one, even when a field name is identical across objects
   (`cdc_report` already proved this can happen)?
3. After the change, can you produce a clean diff (comments-stripped) showing the
   other two objects' code paths are byte-identical to before?

---

## Field Reference (all new columns)

| Field | Column | Type | Set by |
|---|---|---|---|
| — | `external_client_id__a` | UUID, required | `create_recertification_client` |
| — | `client_user_id__a` | UUID | copied at creation |
| `recert_intimation_letter` | `recert_intimation_letter__a` | file | Upload — CRM |
| — | `recert_intimation_sent_date__a` | DATE | Auto, on upload |
| `recert_application_form` | `recert_application_form__a` | file | Upload — Client |
| — | `recert_application_sent_date__a` | DATE | Auto, on upload |
| — | `recert_application_accepted_date__a` | DATE | `review_recert_application` accept |
| `recert_quotation` | `recert_quotation__a` | file | Upload — CRM |
| — | `recert_quotation_received_date__a` | DATE | Auto, on upload |
| `recert_agreement` | `recert_agreement__a` | file | Upload — CRM |
| — | `recert_agreement_sent_date__a` | DATE | Auto, on upload |
| — | `recert_agreement_signed_date__a` | DATE | `review_recert_agreement` accept |
| — | `auditor_id__a` / `tech_reviewer_id__a` | UUID, unregistered | `assign_recert_team` |
| — | `recert_team_assigned_date__a` | DATE | `assign_recert_team` |
| `recert_audit_plan` | `recert_audit_plan__a` | file | Upload — CRM/Auditor |
| — | `recert_plan_sent_date__a` / `recert_plan_accepted_date__a` | DATE | Auto / `review_recert_plan` |
| — | `recert_plan_client_remarks__a` | TEXT | `review_recert_plan` reject; cleared on next upload |
| `recert_ncr` | `recert_ncr__a` | file | Upload — CRM/Auditor |
| `recert_ncr_rca` | `recert_ncr_rca__a` | file | Upload — Client |
| — | `recert_auditor_accepted_date__a` / `recert_rca_rejection_notes__a` | DATE/TEXT | `review_recert_ncr_rca` |
| `recert_evidences` | `recert_evidences__a` | **files** | Upload — Client |
| — | `recert_evidences_accepted_date__a` / `recert_evidences_rejection_notes__a` | DATE/TEXT | `review_recert_evidences` |
| `recert_audit_report` | `recert_audit_report__a` | file | Upload — CRM/Auditor |
| — | `recert_tech_findings_notes__a` / `_file__a` / `_date__a` | TEXT/file/DATE | `submit_recert_tech_findings` |
| — | `recert_closure_notes__a` / `recert_closed_date__a` | TEXT/DATE | `close_recert_audit` |
| `recert_cdc_report` | `recert_cdc_report__a` | file | Upload — CDC |
| `recert_certificates` | `recert_certificates__a` | files | Upload — CRM |

---

## RPC Reference

| RPC | Gate | Effect |
|---|---|---|
| `create_recertification_client(p_external_client_id, p_email)` | CRM/admin | Creates record — `p_external_client_id` required |
| `review_recert_application(p_record_id, p_action, p_notes)` | CRM/admin | accept → `Recert_Application_Accepted` · reject → stays `Recert_Application_Sent` + notes |
| `review_recert_agreement(p_record_id, p_action, p_notes)` | Linked client/admin | accept → `Recert_Agreement_Signed` · reject → `Recert_Quotation_Received` + notes |
| `assign_recert_team(p_record_id, p_auditor_id, p_tech_reviewer_id)` | CRM/admin | → `Recert_Team_Assigned` |
| `review_recert_plan(p_record_id, p_action, p_notes)` | Linked client/admin | accept → `Recert_Plan_Accepted` · reject → stays `Recert_Plan_Sent` + remarks |
| `review_recert_ncr_rca(p_record_id, p_action, p_notes)` | **Auditor/admin only, specific-assigned** | accept → `Recert_Auditor_Accepted` · reject → `Recert_NCR_Sent` + notes |
| `review_recert_evidences(p_record_id, p_action, p_notes)` | Auditor/admin, specific-assigned | accept → `Recert_Evidences_Accepted` · reject → `Recert_Auditor_Accepted` + notes |
| `submit_recert_tech_findings(p_record_id, p_notes)` | Tech Reviewer/admin, specific-assigned | → `Recert_Tech_Findings_Given` |
| `close_recert_audit(p_record_id, p_closure_notes)` | Auditor/admin, specific-assigned | → `Recert_Closed` |

---

## Explicitly out of scope

- Everything past Certificate Issue — the matrix doesn't define anything further,
  unlike Renewal which had Suspension/Withdrawal rows it deferred. Nothing to defer
  here; row 18 is genuinely the end of this matrix.
- Excel/PDF-parsing autofill for `recert_application_form` (New Client Form's
  `LABEL_TO_COLUMN` mechanism) — designed here as a plain file upload instead. Say
  so if you want the fuller parsing behavior; it's a New Client Form-sized addition
  on its own, not folded into Sprint 1's estimate above.
- A `Surveillance 2` epic — referenced only as the reason this epic's naming
  prefix was chosen carefully; not started here.
