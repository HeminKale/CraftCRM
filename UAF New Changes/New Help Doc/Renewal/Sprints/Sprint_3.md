# Surveillance 1 (Renewal) — Sprint 3: What Shipped

Covers **Sprint 3** (Audit Report, Tech Review, Checklist, CDC, Certificate Issue)
plus two corrections made this session on top of Sprints 1–2. See
[`00_Sprint_Plan.md`](00_Sprint_Plan.md) → [`Sprint_0_1.md`](Sprint_0_1.md) →
[`Sprint_2.md`](Sprint_2.md) → **this doc**.

---

## Migrations

- **`259_surv_ncr_rca_rejection_notes_fix.sql`** — correction. `surv_ncr_rca` upload
  no longer clears `surv_rca_rejection_notes__a`; verified against the live
  `stage1_ncr_rca` behavior (External Client), which never clears its rejection
  notes on upload either — only `review_stage1_ncr_rca`'s accept branch does.
  258's version was a genuine deviation, not a considered improvement — reverted.
- **`260_surv_report_tech_cdc_certificate.sql`** — Sprint 3 backend. New RPCs
  `submit_surv_tech_findings` (Tech Reviewer, assigned-specific) and
  `close_surv_audit` (Auditor, assigned-specific). Reuses `surveillance_audit_report__a`
  / `surveillance_certificates__a` / `certificates_sent_date__a` from migration 221
  rather than duplicating them. Added a re-upload status guard on
  `surveillance_audit_report` (mirrors migration 249's External Client fix) so a late
  revision can't rewind a record that's already past Tech Review/CDC/Certificate.
- **`261_surv_start_upload_role_gates.sql`** — hard upload-role gates in
  `start_file_upload` for every renewal_clients__a file field, prompted by your
  question this session (see chat reply for the full PS-vs-RPC answer). Sprints 1–3
  only had soft gates (status-advance only); this closes the same class of gap
  migration 248 had to fix for External Client after live testing found it — done
  here up front instead.

## Fields added this sprint (need Page Layout placement)

| Field (API name) | Label | Type |
|---|---|---|
| `surv_report_sent_date` | Report Sent Date | date |
| `surv_tech_findings_notes` | Tech Review Findings | text |
| `surv_tech_findings_file` | Tech Review Checklist | file |
| `surv_tech_findings_date` | Tech Review Date | date |
| `surv_closure_notes` | Closure Notes | text |
| `surv_closed_date` | Closed Date | date |
| `cdc_report` | CDC Report | file |
| `cdc_date` | CDC Date | date |

(`surveillance_audit_report`, `surveillance_certificates`, `certificates_sent_date`
were already placed since the original build — nothing new needed for those three.)

## Frontend spec for the hard floor (your side, not written here)

Mirror `RecordDetailView.tsx`'s `FILE_FIELD_UPLOAD_ROLE` map (~line 137) for
`renewal_clients__a`. It currently only supports `'crm_or_auditor'` /
`'client_only'` — you'll need two new rule kinds plus their branches in
`isFileUploadAllowedForRole()`:

```
surveillance_intimation_letter: 'crm_only'
surveillance_certificates:      'crm_only'
surv_audit_plan:                'crm_or_auditor'
surv_ncr:                       'crm_or_auditor'
surveillance_audit_report:      'crm_or_auditor'
surv_ncr_rca:                   'client_only'
surv_tech_findings_file:        'tech_only'   // NEW rule kind
cdc_report:                     'cdc_only'    // NEW rule kind
```
`'tech_only'`/`'cdc_only'` branches: same shape as the existing role check, just
substring-matching `'tech'`/`'cdc'` instead of `'crm'`/`'auditor'`.

## Not done (by design)

- Frontend (`RenewalActionPanel.tsx`, `RenewalWorkflowBar.tsx`, the hard-floor map
  above) — yours, per this session's direction.
- Permission Set config — Sprint 5, and see chat reply for why it's secondary to the
  RPC gates now in place, not the primary control.
- No live DB execution — migration files only.
