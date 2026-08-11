# External Client — Stage 1 / Stage 2 Audit Workflow: Sprint Plan

This document breaks the Stage 1 / Stage 2 audit workflow build into sprints. It
covers the quotation-upload fix, all new backend schema/RPCs, and the frontend UI
needed to actually use them. Effort is given in **working days**, not fixed sprint
lengths — group into whatever sprint cadence your team runs.

> **⚠️ Sprints 1/2's backend design is superseded — read S3.md and S4.md first.**
> Migrations 237 and 238 realigned Stage 1 and Stage 2 to match the actual business
> flow (plan-round checkpoints, merged report/NCR steps, widened review gates, a
> restructured Stage 2 tail); this plan's Sprint 1/2 task lists and the reference-dates
> mapping table below predate both. The mapping table has been corrected in place
> (Sprint 5) — everything else describing Sprint 1/2's original shape is historical,
> not current. Sprint 0's quotation-lock design is unaffected and still accurate.
> See **S5.md** for what Sprint 5 actually did.

Related: see **sharing-policy.md**, **permission-sets.md**, and **created-by-updated-by.md**
in this folder for the conventions this design reuses (role-name gating, `custom_role_id`,
`resolveUserValue`).

---

## Roles involved

| Role | Status | Used for |
|---|---|---|
| CRM Office | Existing | Uploads reports/NCRs, closes nothing new here |
| **Auditor** | New — you are creating this | Accepts NCR+RCA, accepts evidences, closes each stage's audit |
| **Tech Reviewer** | New — you are creating this | Gives findings, final sign-off on each stage |
| External Client | Existing | Uploads NCR root-cause response, uploads Stage 2 evidences |

Role-name gating follows the existing convention (`lower(custom_role_id → name) LIKE
'%crm%'` etc.) — no new columns needed on `system.users`. Confirm your role names
contain `auditor` and `tech` respectively (case-insensitive) so the `LIKE` patterns
below match, e.g. "Auditor" and "Tech Reviewer" both work as-is.

---

## Sprint 0 — Quotation Upload Lock (quick win, ships independently)

**Goal:** Close the existing gap where any user with field-edit rights can upload the
`quotation` file — today only the status auto-advance is CRM-gated, not the upload
itself.

**Tasks**
- New migration: add a hard role-gate inside `start_file_upload` (defined once in
  `016_file_upload_rpc_functions.sql`, never redefined since), scoped only to
  `external_clients__a.quotation`. Block unless caller is admin or custom role
  `LIKE '%crm%'`.

**Acceptance criteria**
- Auditor, Tech Reviewer, External Client, and any unassigned user get "Access denied"
  when attempting to upload `quotation`.
- CRM Office and admin uploads are unaffected.
- No other field/object's upload behavior changes.

**Dependencies:** None — can ship before anything else in this plan.
**Effort:** 0.5 day

---

## Sprint 1 — Backend: Stage 1 Schema + RPCs

**Goal:** All database scaffolding for the Stage 1 audit lifecycle (report → NCR →
client RCA → auditor accept → tech findings → auditor closure → tech final sign-off).

**Tasks**
- Register 4 new file fields in `tenant.fields` (name **without** `__a` suffix, per
  the clean `renewal_clients__a` convention — not the legacy inconsistent naming
  already on this table) + `ALTER TABLE` for their columns and 11 supporting
  date/text columns (see field table below).
- New RPCs: `review_stage1_ncr_rca`, `submit_stage1_tech_findings`,
  `close_stage1_audit`, `accept_stage1_tech_review`.
- Extend `finalize_file_upload` (currently defined in `221_renewal_clients.sql`) with
  auto-advance logic for `stage1_report`/`stage1_ncr` (CRM/Auditor-gated) and
  `stage1_ncr_rca` (linked-client-gated).

**Acceptance criteria**
- Each RPC callable directly via SQL editor; status/date/notes columns update exactly
  per the table in "RPC Reference" below.
- Uploading `stage1_report`/`stage1_ncr` as CRM or Auditor auto-advances status and
  stamps the upload date; uploading as any other role still attaches the file but
  does **not** advance status.
- Uploading `stage1_ncr_rca` only auto-advances when done by the record's linked
  client (`client_user_id__a`) or admin.
- Reject paths step the record back to the correct prior status and populate the
  correct dedicated rejection-notes column (not a shared one).

**Dependencies:** Auditor and Tech Reviewer roles must exist in `tenant.roles` before
RPCs can be meaningfully tested end-to-end (role gate will otherwise always deny).
**Effort:** 2–3 days

---

## Sprint 2 — Backend: Stage 2 Schema + RPCs

**Goal:** Mirror of Sprint 1 for Stage 2, plus the extra client-evidences round that
Stage 1 doesn't have.

**Tasks**
- Register 5 new file fields (includes `stage2_evidences`, type `files` — multiple) +
  13 supporting date/text columns.
- New RPCs: `review_stage2_ncr_rca`, `review_stage2_evidences`,
  `submit_stage2_tech_findings`, `close_stage2_audit`, `accept_stage2_tech_review`.
- Extend `finalize_file_upload` further: `stage2_report`/`stage2_ncr` (CRM/Auditor),
  `stage2_ncr_rca` and `stage2_evidences` (linked client).

**Acceptance criteria**
- Same shape as Sprint 1's criteria, applied to Stage 2's two acceptance checkpoints
  (NCR+RCA, then evidences) before the record is considered "in tech review."
- `review_stage2_evidences` reject sends the record back to `Stage2_Auditor_Accepted`
  (not back to the NCR+RCA step) so the client only has to redo the evidences.

**Dependencies:** Sprint 1 merged first (reuses the same `finalize_file_upload`
definition — Sprint 2's migration should extend Sprint 1's, not fork it).
**Effort:** 2–3 days

---

## Sprint 3 — Frontend: Stage 1 Action Panel + Stepper

**Goal:** Make Stage 1 actually usable by CRM/Auditor/Client/Tech Reviewer without
needing the SQL editor.

**Tasks**
- New component (e.g. `StageAuditActionPanel.tsx`), modeled on the existing
  `ReviewActionPanel.tsx` pattern: role-aware conditional panels, one per Stage 1
  checkpoint, each calling the matching RPC from Sprint 1.
- Extend or fork `ClientWorkflowBar.tsx` (currently a hardcoded 7-stage array,
  `ClientWorkflowBar.tsx:13-21`) to show the Stage 1 sub-stages — likely as a
  collapsible "Stage 1 Audit" section rather than flattening everything into one bar.
- Wire the new panel/bar into `RecordDetailView.tsx` alongside the existing
  `ReviewActionPanel`/`ClientWorkflowBar` mount points.

**Acceptance criteria**
- CRM Office/Auditor see upload prompts for `stage1_report`/`stage1_ncr` at the right
  point; External Client sees the RCA upload prompt only after NCR is uploaded;
  Auditor sees accept/reject for RCA; Tech Reviewer sees the findings form
  (text + optional file) and later the final accept/reject; Auditor sees the closure
  form in between.
- Rejection notes (whichever of the two Stage 1 columns applies) surface to the user
  the way `rejectionNotes` does today in `ReviewActionPanel.tsx`.

**Dependencies:** Sprint 1 (RPCs must exist and be tested first).
**Effort:** 3–4 days

---

## Sprint 4 — Frontend: Stage 2 Action Panel + Stepper

**Goal:** Same as Sprint 3, for Stage 2's longer chain (includes the evidences round).

**Tasks**
- Extend the Sprint 3 panel/bar (not a separate component from scratch) to cover
  Stage 2's 5 checkpoints instead of Stage 1's 4.

**Acceptance criteria:** Same shape as Sprint 3, applied to Stage 2, including the
extra evidences-upload-then-accept round before hand-off to tech review.

**Dependencies:** Sprint 2 (RPCs) and Sprint 3 (reused panel/bar structure).
**Effort:** 3–4 days

---

## Sprint 5 — QA, Picklist Registration, Manual Dates Coordination, Docs

**Goal:** Close out loose ends before calling the epic done.

**Tasks**
- End-to-end test with 4 real test users (one per role: CRM Office, Auditor, Tech
  Reviewer, External Client) walking one record through the entire Stage 1 → Stage 2
  lifecycle.
- Optional: register the new `status__a` values in `tenant.picklist_values` so the
  generic edit-mode dropdown shows them (not required for RPCs to function — no
  workflow RPC reads that table today, this is purely so the field looks complete in
  the UI if anyone edits it manually).
- When you manually add the 7 reference dates (`Stg 1 date`, `Stage 2 date`,
  `Stage 2 start date`, `Tech review stg1 Date`, `Tech review stg2 Date`, `Client
  agreement date`, `Application date`) — cross-check against columns this workflow
  already creates before adding duplicates (see mapping note below).
- Finalize this document and the field/RPC reference tables with anything that
  changed during implementation.

**Dependencies:** Sprints 1–4 complete.
**Effort:** 2 days

---

## Total estimated effort

~13–16.5 working days across 6 sprints (0–5). At one developer, roughly 3–3.5 calendar
weeks; parallelizable (backend sprints 1–2 and frontend sprints 3–4 each pair up) if
you have two people.

| Sprint | Focus | Effort |
|---|---|---|
| 0 | Quotation upload lock | 0.5 day |
| 1 | Stage 1 backend | 2–3 days |
| 2 | Stage 2 backend | 2–3 days |
| 3 | Stage 1 frontend | 3–4 days |
| 4 | Stage 2 frontend | 3–4 days |
| 5 | QA + docs | 2 days |

---

## Field Reference (created in Sprints 1–2)

**Stage 1**

| Field | Column | Type | Set by |
|---|---|---|---|
| `stage1_report` | `stage1_report__a` | file (PDF) | Upload — CRM/Auditor |
| — | `stage1_report_uploaded_date__a` | DATE | Auto, on upload |
| `stage1_ncr` | `stage1_ncr__a` | file (Excel) | Upload — CRM/Auditor |
| — | `stage1_ncr_uploaded_date__a` | DATE | Auto, on upload |
| `stage1_ncr_rca` | `stage1_ncr_rca__a` | file (Excel) | Upload — linked client |
| — | `stage1_ncr_rca_uploaded_date__a` | DATE | Auto, on upload |
| — | `stage1_auditor_accepted_date__a` | DATE | `review_stage1_ncr_rca` accept |
| — | `stage1_rejection_notes__a` | TEXT | `review_stage1_ncr_rca` reject |
| — | `stage1_tech_findings_notes__a` | TEXT | `submit_stage1_tech_findings` |
| `stage1_tech_findings_file` | `stage1_tech_findings_file__a` | file (optional) | Upload — Tech Reviewer |
| — | `stage1_tech_findings_date__a` | DATE | `submit_stage1_tech_findings` |
| — | `stage1_closure_notes__a` | TEXT | `close_stage1_audit` |
| — | `stage1_closed_date__a` | DATE | `close_stage1_audit` |
| — | `stage1_tech_final_accepted_date__a` | DATE | `accept_stage1_tech_review` accept |
| — | `stage1_tech_final_rejection_notes__a` | TEXT | `accept_stage1_tech_review` reject |

**Stage 2** (mirrors Stage 1, plus the evidences round)

| Field | Column | Type | Set by |
|---|---|---|---|
| `stage2_report` | `stage2_report__a` | file (PDF) | Upload — CRM/Auditor |
| — | `stage2_report_uploaded_date__a` | DATE | Auto, on upload |
| `stage2_ncr` | `stage2_ncr__a` | file (Excel) | Upload — CRM/Auditor |
| — | `stage2_ncr_uploaded_date__a` | DATE | Auto, on upload |
| `stage2_ncr_rca` | `stage2_ncr_rca__a` | file (Excel) | Upload — linked client |
| — | `stage2_ncr_rca_uploaded_date__a` | DATE | Auto, on upload |
| — | `stage2_auditor_accepted_date__a` | DATE | `review_stage2_ncr_rca` accept |
| — | `stage2_rejection_notes__a` | TEXT | `review_stage2_ncr_rca` reject |
| `stage2_evidences` | `stage2_evidences__a` | files (multiple) | Upload — linked client |
| — | `stage2_evidences_uploaded_date__a` | DATE | Auto, on upload |
| — | `stage2_evidences_accepted_date__a` | DATE | `review_stage2_evidences` accept |
| — | `stage2_evidences_rejection_notes__a` | TEXT | `review_stage2_evidences` reject |
| — | `stage2_tech_findings_notes__a` | TEXT | `submit_stage2_tech_findings` |
| `stage2_tech_findings_file` | `stage2_tech_findings_file__a` | file (optional) | Upload — Tech Reviewer |
| — | `stage2_tech_findings_date__a` | DATE | `submit_stage2_tech_findings` |
| — | `stage2_closure_notes__a` | TEXT | `close_stage2_audit` |
| — | `stage2_closed_date__a` | DATE | `close_stage2_audit` |
| — | `stage2_tech_final_accepted_date__a` | DATE | `accept_stage2_tech_review` accept |
| — | `stage2_tech_final_rejection_notes__a` | TEXT | `accept_stage2_tech_review` reject |

Two dedicated rejection-notes columns per stage (not one shared column) because each
stage has two distinct reject checkpoints with two different step-back targets —
reusing a single column would make it ambiguous which rejection the notes belong to.

---

## RPC Reference (created in Sprints 1–2)

All follow the existing `review_client_application`/`review_surveillance_intimation`
style: `LANGUAGE plpgsql SECURITY DEFINER`, `RETURNS TABLE(success BOOLEAN, message
TEXT)`, `GRANT EXECUTE ... TO authenticated`.

| RPC | Gate | Accept → | Reject → |
|---|---|---|---|
| `review_stage1_ncr_rca(p_record_id, p_action, p_notes)` | Auditor/admin | `Stage1_Auditor_Accepted` + date | `Stage1_NCR_Uploaded` + notes |
| `submit_stage1_tech_findings(p_record_id, p_notes)` | Tech Reviewer/admin | `Stage1_Tech_Findings_Given` + notes + date | n/a (one-way) |
| `close_stage1_audit(p_record_id, p_closure_notes)` | Auditor/admin | `Stage1_Closed` + notes + date | n/a (one-way) |
| `accept_stage1_tech_review(p_record_id, p_action, p_notes)` | Tech Reviewer/admin | `Stage1_Complete` + date | `Stage1_Tech_Findings_Given` + notes |
| `review_stage2_ncr_rca(p_record_id, p_action, p_notes)` | Auditor/admin | `Stage2_Auditor_Accepted` + date | `Stage2_NCR_Uploaded` + notes |
| `review_stage2_evidences(p_record_id, p_action, p_notes)` | Auditor/admin | `Stage2_Evidences_Accepted` + date | `Stage2_Auditor_Accepted` + notes |
| `submit_stage2_tech_findings(p_record_id, p_notes)` | Tech Reviewer/admin | `Stage2_Tech_Findings_Given` + notes + date | n/a (one-way) |
| `close_stage2_audit(p_record_id, p_closure_notes)` | Auditor/admin | `Stage2_Closed` + notes + date | n/a (one-way) |
| `accept_stage2_tech_review(p_record_id, p_action, p_notes)` | Tech Reviewer/admin | `Stage2_Complete` + date | `Stage2_Tech_Findings_Given` + notes |

Every accept branch also clears the relevant rejection-notes column, matching the
existing `rejection_notes__a = NULL` pattern used on every other accept RPC in the app.

### Status flow

```
Stage 1: Report Uploaded → NCR Uploaded → NCR+RCA Uploaded → Auditor Accepted
         → (in tech review) → Tech Findings Given → Closed → Complete

Stage 2: Report Uploaded → NCR Uploaded → NCR+RCA Uploaded → Auditor Accepted
         → Evidences Uploaded → Evidences Accepted → (in tech review)
         → Tech Findings Given → Closed → Complete
```

No RPC hard-blocks based on current `status__a` before acting — matches the existing
loose convention (`review_client_application`/`review_client_agreement` fetch current
status but don't gate on it; sequencing is enforced by which action panel the
frontend shows, not by the RPC itself).

---

## Reference dates you're adding manually (not created by this plan)

> **Superseded by migration 238 — corrected 2026-07-25 (Sprint 5).** This table
> predates the Stage 2 tail restructuring in migration 238 (see **S4.md**):
> `close_stage2_audit` and `accept_stage2_tech_review` are retired, so
> `stage2_tech_final_accepted_date__a` is never written by any live code path and
> must not be used as a mapping target. The corrected mappings below replace the
> three rows that referenced it or that 238 has since covered.

`Stg 1 date`, `Stage 2 date`, `Stage 2 start date`, `Tech review stg1 Date`, `Tech
review stg2 Date`, `Client agreement date`, `Application date`. Mapping to avoid
duplicates:

| Your planned field | Already covered by |
|---|---|
| Stg 1 date | `stage1_tech_final_accepted_date__a` (Stage 1 fully complete) |
| Stage 2 date | `stage2_registration_date__a` (Stage 2 complete — set by `set_stage2_registration_date`, **not** `stage2_tech_final_accepted_date__a`, which is dead since 238 retired its writer `accept_stage2_tech_review`) |
| Tech review stg1 Date | `stage1_tech_final_accepted_date__a` |
| Tech review stg2 Date | `stage2_tech_findings_date__a` (set by `submit_stage2_tech_findings` — **not** `stage2_tech_final_accepted_date__a`, dead for the same reason) |
| Client agreement date | Existing `Client_Agreement_Signed_Date__a` |
| Application date | Existing `Date__a` |
| Stage 2 start date | `stage2_plan_sent_date__a` (added by migration 238 — **not** genuinely new as this table previously said) |

---

## Out of scope / carried risk

- **No per-record assignment** — any user holding Auditor or Tech Reviewer can act on
  any External Client record, same model as CRM Office today. Confirmed with
  stakeholder; revisit only if accountability issues surface later.
- **Legacy field-naming inconsistencies** on this table (`Adddress__a` typo,
  `clientAgreement__c__a`'s doubled suffix, `stage_one_audit_plan__a` created outside
  the normal field-creation flow) are **not** touched by this work — new fields follow
  the clean convention, old ones are left as-is to avoid breaking existing references.
- **`tenant.picklist_values` registration** for the new status strings is optional
  (Sprint 5) — no workflow RPC anywhere in the app reads from that table today, so
  skipping it has no functional impact, only cosmetic (dropdown completeness).
