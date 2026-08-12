# Recertification — Sprint 4: What Shipped

Covers **Sprint 4** (Audit Report, Tech Review, Checklist, CDC, Certificate Issue)
from [`00_Sprint_Plan.md`](00_Sprint_Plan.md) — the last backend sprint before
Sprint 5's frontend build.

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) →
> [`Sprint_0_1.md`](Sprint_0_1.md) → [`Sprint_2.md`](Sprint_2.md) →
> [`Sprint_3.md`](Sprint_3.md) → **this doc**.

**Confirmed before starting:** the full rights matrix (screenshot) was provided and
cross-checked against migrations 264-267 before writing this one — rows 1-13 all
matched what was already built, at the RPC/hard-gate layer, with one correction made
to the Sprint 6 deny-list draft (see `00_Sprint_Plan.md`'s Sprint 6 section). Rows
14-18, covered here, were re-verified against the matrix row-by-row while writing
this migration (see section 3 below) — not just against the earlier plan doc text.
This migration was written against 267's actual `start_file_upload`/
`finalize_file_upload` bodies (reproduced verbatim, extracted via `sed`, then diffed
after — see section 4), not a stale copy.

---

## Migration: [`268_recertification_report_tech_cdc_certificate.sql`](../../../supabase/migrations/268_recertification_report_tech_cdc_certificate.sql)

**New columns** (final batch — 43 fields total registered across this epic):

| Column | Type | Registered? |
|---|---|---|
| `recert_audit_report__a` | JSONB (file) | Yes — `recert_audit_report` |
| `recert_report_sent_date__a` | DATE | Yes |
| `recert_tech_findings_notes__a` | TEXT | Yes |
| `recert_tech_findings_file__a` | JSONB (file) | Yes — `recert_tech_findings_file` |
| `recert_tech_findings_date__a` | DATE | Yes |
| `recert_closure_notes__a` | TEXT | Yes |
| `recert_closed_date__a` | DATE | Yes |
| `recert_cdc_report__a` | JSONB (file) | Yes — `recert_cdc_report` |
| `recert_cdc_date__a` | DATE | Yes |
| `recert_certificates__a` | JSONB, default `'[]'` (**files**, plural) | Yes — `recert_certificates`, type `files` |
| `recert_certificates_sent_date__a` | DATE | Yes |

**Not reusing legacy fields, unlike Surveillance 1.** Surveillance 1's Sprint 3
(migration 260) reused two pre-existing, previously-unwired columns from migration
221 — `surveillance_audit_report__a` and `surveillance_certificates__a`. Recertification
is a brand-new table with no such legacy fields to inherit, so `recert_audit_report__a`
and `recert_certificates__a` are both new columns here — no naming-collision risk
either way, per the plan doc's precedent table.

**`status__a` picklist:** `Recert_Report_Sent` (15), `Recert_Tech_Findings_Given`
(16), `Recert_Closed` (17), `Recert_CDC_Approved` (18), `Recert_Certificate_Issued`
(19) — the **final 5 of 19 total statuses** for this epic (1 + 5 + 3 + 5 + 5 = 19,
matching the plan doc's status-flow count exactly).

**`submit_recert_tech_findings(p_record_id, p_notes DEFAULT NULL)`.** Tech
Reviewer/admin, gated to the specific assigned `tech_reviewer_id__a` (same
convention as Sprint 3's two review RPCs). `p_notes` optional — a blank submission
is valid ("no findings"), not an error. Always advances to
`Recert_Tech_Findings_Given` regardless of whether notes were given. Deliberately
does **not** implement External Client's revision-loop-back (migration 253) — that
was a separate stakeholder request specific to that object, not in this rights
matrix or the sprint plan.

**`close_recert_audit(p_record_id, p_closure_notes DEFAULT NULL)`.** Auditor/admin,
gated to the specific assigned `auditor_id__a`. → `Recert_Closed` + stamp
`recert_closed_date__a`. No status precondition checked (mirrors
`close_surv_audit` exactly — neither RPC checks the record is at a particular prior
status before closing).

**`start_file_upload` redefined**, adding **all four Sprint 4 hard gates in this
same migration** — deliberately not split the way Surveillance 1's were (migration
260 shipped the RPCs/soft-gates only; the Tech-only and CDC-only hard gates didn't
land until a follow-up, migration 261):
- `recert_audit_report` — CRM-or-Auditor hard gate.
- `recert_tech_findings_file` — **Tech-only hard gate**, matching Surveillance 1's
  improvement over External Client's still-ungated equivalent field.
- `recert_cdc_report` — **CDC-only hard gate**, matching Surveillance 1's
  improvement over External Client's PS-only `cdc_report` (243's deliberate,
  now-superseded shortcut).
- `recert_certificates` — CRM-only hard gate.

**`finalize_file_upload` redefined**, adding:
- `recert_audit_report` upload (CRM/Auditor/admin) → `Recert_Report_Sent` + stamps
  `recert_report_sent_date__a`. **Re-upload status guard shipped from day one**:
  `status__a IN ('Recert_Evidences_Accepted', 'Recert_Report_Sent')` — mirrors
  migration 262's fix for Surveillance 1's `surveillance_audit_report`, which
  originally shipped without one.
- `recert_tech_findings_file` upload — **no status-side-effect block at all**, by
  design. It's a supporting file only; `submit_recert_tech_findings` drives the
  checkpoint. Identical shape to Surveillance 1's `surv_tech_findings_file`.
- `recert_cdc_report` upload (CDC/admin) → `Recert_CDC_Approved` + stamps
  `recert_cdc_date__a`. Upload **is** the approval — no separate accept RPC, same
  as both prior epics' CDC checkpoints. Re-upload guard: `status__a IN
  ('Recert_Closed', 'Recert_CDC_Approved')` — again shipped from day one rather
  than waiting for a 262-style follow-up.
- `recert_certificates` upload (CRM/admin) → `Recert_Certificate_Issued` + stamps
  `recert_certificates_sent_date__a`. **No re-upload guard** — terminal status for
  this plan, matching `surveillance_certificates`'s same no-guard treatment (262's
  note: "a re-upload just re-sets the same terminal status, no rewind possible").

---

## Row-by-row re-verification against the rights-matrix screenshot

Done while writing this migration, not assumed from the plan doc text alone:

| Matrix row | Client | CRM | Auditor | Tech | CDC | What's gated |
|---|---|---|---|---|---|---|
| Recert audit report | view (conditional — Sprint 5) | upload | upload | view | view | CRM-or-Auditor upload gate ✓ |
| Recert tech review findings | *(blank)* | view | view/close | write | view | `submit_recert_tech_findings` Tech-only + `close_recert_audit` Auditor-only, **no CRM bypass on either** ✓ |
| Recert tech review checklist | *(blank)* | view | view | upload | view | `recert_tech_findings_file` Tech-only hard gate, **no CRM/Auditor upload right** ✓ |
| CDC | *(blank)* | view | *(blank)* | *(blank)* | upload | `recert_cdc_report` CDC-only hard gate, **CRM stays view-only, not upload** ✓ |
| certificate issue | view | upload | *(blank)* | *(blank)* | view | `recert_certificates` CRM-only hard gate ✓ |

The "auditor: view/close" cell on the tech-review-findings row is the one easy
misread — it's `close_recert_audit` (a *separate* RPC/checkpoint two rows down in
the status flow, `Recert_Tech_Findings_Given` → `Recert_Closed`), not an accept
action on the findings themselves. Confirmed against the target status flow in
`00_Sprint_Plan.md` before writing `close_recert_audit`, not assumed from the row
label alone.

The client's "view only after tech review acceptance" cell on the audit-report row
is the status-conditional visibility lock already flagged as Sprint 5 frontend work
in the plan doc (`recert_audit_report` hidden from the client until
`Recert_Tech_Findings_Given`) — not built here, this sprint is backend-only.

---

## Verified against source before writing

- Read `267_recertification_ncr_rca_evidences.sql`'s `start_file_upload` and
  `finalize_file_upload` bodies via `sed` extraction (not retyped from memory)
  before adding the four new blocks to each.
- Diffed the reproduced bodies (comments-stripped) against 267's — confirmed pure
  additions only in both functions, zero drift in any prior block (External Client,
  Surveillance 1, Recertification Sprints 0-3 all untouched).
- Confirmed `268` doesn't collide with any existing migration filename.
- Confirmed function-delimiter balance (`$$` count = 12 for 4 functions) and fixed
  two cosmetic double-blank-line artifacts left over from the file-assembly process
  before finalizing.
- Confirmed the status-flow arithmetic: 1 (Sprint 0) + 5 (Sprint 1) + 3 (Sprint 2) +
  5 (Sprint 3) + 5 (Sprint 4) = 19, matching the plan doc's target flow exactly —
  this is also the last sprint that adds `status__a` values for this epic.

## Not done in this sprint (by design)

- Frontend (`RecertificationActionPanel.tsx` report/findings/checklist/CDC/
  certificate upload+action UI, `RecertificationWorkflowBar.tsx`) — **Sprint 5**.
- The `recert_audit_report` client-visibility status lock — **Sprint 5**, flagged
  explicitly in the plan doc as a "build it in from the start" item (Surveillance 1
  missed this on its first pass and needed a follow-up audit to catch it).
- Permission Set entries (view/deny per role per field) — **Sprint 6**.
- Not yet run against the live database or QA'd as of writing this doc.

---

## Next

**Sprint 5** (Frontend) is next — the last backend-only sprint (this one) is done;
everything from here on touches `RecordDetailView.tsx` and needs the cross-epic
safety checklist applied to frontend maps/arrays too (own object-scoped variables,
never merged with Surveillance 1's or External Client's), not just SQL functions.
