# Recertification — Sprint 5: What Shipped

Covers **Sprint 5** (Frontend) from [`00_Sprint_Plan.md`](00_Sprint_Plan.md) — the
first sprint that touches a file shared with the other two workflow objects
(`RecordDetailView.tsx`), not an isolated migration.

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) →
> [`Sprint_0_1.md`](Sprint_0_1.md) → [`Sprint_2.md`](Sprint_2.md) →
> [`Sprint_3.md`](Sprint_3.md) → [`Sprint_4.md`](Sprint_4.md) → **this doc**.

**Confirmed before starting:** read `RenewalActionPanel.tsx` (630 lines) and
`RenewalWorkflowBar.tsx` (245 lines) in full before writing anything, per the plan
doc's explicit "copy RenewalActionPanel's structure" instruction. Read
`RecordDetailView.tsx`'s existing `STAGE_STATUS_ORDER`/`SURV_STATUS_ORDER` arrays,
`EXTERNAL_CLIENT_FILE_FIELD_UPLOAD_ROLE`/`RENEWAL_FILE_FIELD_UPLOAD_ROLE` maps, the
`isFileUploadAllowedForRole`/`isStageReportLockedForClient` functions, and the two
existing workflow-bar/action-panel render blocks — all before editing, not assumed
from the plan doc's description of them.

---

## New files (own files, do not touch the other two objects' components)

**[`RecertificationActionPanel.tsx`](../../../app/commonfiles/core/components/custom/Recertification_Client/RecertificationActionPanel.tsx)**
— copies `RenewalActionPanel.tsx`'s structure line-for-line where the shape matches
(hardened `isClientOnly` exclusion built in from the start, generic
`handleReview(rpc, action)` shared across every accept/reject panel, the
"fetch team options unconditionally before the early-return" hook-count fix,
CDC included in the assigned-team read-only info strip from day one). **20 checkpoint
visibility flags** (`show*` booleans) — six more than Surveillance 1's 14, for the
intake phase (application/quotation/agreement, 6 panels) and evidences (2 panels)
Surveillance 1 doesn't have:

| Flag | Gate | RPC / action |
|---|---|---|
| `showIntimationPrompt` | CRM, no status yet | (upload only, no RPC) |
| `showApplicationPrompt` | Linked client | (upload only) |
| `showApplicationReview` | CRM | `review_recert_application` |
| `showQuotationPrompt` | CRM | (upload only) |
| `showAgreementUploadPrompt` | CRM | (upload only) |
| `showAgreementReviewPanel` | Linked client | `review_recert_agreement` |
| `showAssignTeamPrompt` | CRM | `assign_recert_team` |
| `showAssignedTeamInfo` | CRM/Auditor/Tech/**CDC** (read-only) | — |
| `showPlanUploadPrompt` | CRM/Auditor | (upload only) |
| `showPlanReviewPanel` | Linked client | `review_recert_plan` |
| `showAuditPrepPrompt` | CRM/Auditor | (instructional only) |
| `showRcaUploadPrompt` | Linked client | (upload only) |
| `showRcaReviewPanel` | **Auditor only, no CRM bypass** | `review_recert_ncr_rca` |
| `showEvidencesUploadPrompt` | Linked client | (upload only) |
| `showEvidencesReviewPanel` | **Auditor only, no CRM bypass** | `review_recert_evidences` |
| `showReportPrompt` | CRM/Auditor | (upload only) |
| `showFindingsPanel` | Tech Reviewer | `submit_recert_tech_findings` |
| `showClosurePanel` | Auditor | `close_recert_audit` |
| `showCdcUploadPrompt` | CDC | (upload only) |
| `showCertificatePrompt` | CRM | (upload only) |

Reject-notes handling verified against each RPC's actual behavior (not assumed):
`showApplicationPrompt` and `showAgreementUploadPrompt` re-fire on the same status
the record steps back to after a reject (no separate "with remarks" branch needed
for agreement, since `review_recert_agreement`'s reject is a real status step-back to
`Recert_Quotation_Received` — unlike the plan-round reject, which stays in place).
`rejection_notes__a` is deliberately read as a **shared** field in both the
application and agreement panels — migration 265's own design (one shared
generic-reject-notes column for both RPCs, not two separate ones), not a frontend
shortcut.

**[`RecertificationWorkflowBar.tsx`](../../../app/commonfiles/core/components/custom/Recertification_Client/RecertificationWorkflowBar.tsx)**
— copies `RenewalWorkflowBar.tsx` exactly (`resolveCurrentStageIndex`/`resolveWindow`/
`StageTrack` all identical, only the `STAGES` array content differs). **19 stages**,
same `WINDOW_RADIUS = 3` (7-wide sliding window) as both prior epics' bars. Every
`dateKey`/`statusValue` pair checked against the actual column names registered in
migrations 264-268, not re-derived from the plan doc's prose.

---

## `RecordDetailView.tsx` changes (the one shared file)

Every addition is a **new, independent block** — nothing added to or merged with
either existing map/array, per the plan doc's explicit instruction and the
cross-epic safety checklist's item 2.

1. **`RECERT_STATUS_ORDER`** — own 19-value array, added to `STAGE_REPORT_UNLOCK_AT`
   as a new `recert_audit_report` entry (`unlockAt: 'Recert_Tech_Findings_Given'`).
   This is the Sprint 4 frontend spec note being fulfilled: `recert_audit_report`
   is hidden from the linked client until the Tech Reviewer submits findings — built
   in **from the start**, not caught by a follow-up audit the way Surveillance 1's
   `SURV_STATUS_ORDER` was. Kept as its own array for the exact reason
   `SURV_STATUS_ORDER`'s own header comment gives: `'Team_Assigned'` is now a real
   `status__a` value on **all three** objects (External Client, Surveillance 1,
   Recertification) — a shared array would silently rank Recertification's
   `Team_Assigned` at whichever other object's position for that name was defined
   first.
2. **`RECERT_FILE_FIELD_UPLOAD_ROLE`** — own 12-entry map, the frontend hard floor
   matching migrations 264/265/266/267/268's server-side `start_file_upload` gates
   exactly (checked field-by-field against those migrations while writing this map,
   not copied from the plan doc's field reference table). Four more entries than
   `RENEWAL_FILE_FIELD_UPLOAD_ROLE`'s 8 — application form, quotation, agreement,
   evidences.
3. **`isFileUploadAllowedForRole`** — signature extended with a new
   `isRecertObject: boolean = false` parameter (default `false` so every existing
   call site not yet updated keeps working unchanged); the map-selection ternary
   now checks Recert first, then Renewal, then falls back to External Client. Only
   one call site exists in this file and it was updated to pass
   `objectLabel?.toLowerCase().includes('recertification')` as the new argument.
4. **Render block** — a third, independent `{objectLabel?.toLowerCase().includes('recertification') && recordData && (...)}`
   block immediately after the Renewal block, rendering
   `RecertificationWorkflowBar` + `RecertificationActionPanel`. Copied the Renewal
   block's exact prop-passing shape (`recordId`, `recordData`, `objectId`,
   `currentUserRole`, `currentCustomRole`, `currentUserId`, `tenantId`,
   `onActionComplete`).

**Object-identity detection**: `objectLabel?.toLowerCase().includes('recertification')`,
matching the exact pattern the Renewal block already uses
(`.includes('renewal')`). Confirmed no collision either direction — checked that
`'renewal clients'` doesn't contain `'recertification'` and `'recertification clients'`
doesn't contain `'renewal'` before relying on simple substring matching for object
identity (same reasoning already applied to `'external client'` vs `'renewal'`
labels in the existing code).

---

## Verified against source before finalizing

- `npx tsc --noEmit -p .` — **zero errors, exit code 0**, across the whole project
  (not just the new/changed files) after all changes were made.
- `git diff --stat` on `RecordDetailView.tsx` showed 80 insertions / **2 deletions**
  — checked both deleted lines by hand: they're exactly the two lines intentionally
  replaced (the map-selection ternary and the call site), each expanded into a
  multi-line form. Nothing else in the file was touched — External Client's and
  Surveillance 1's code paths are byte-identical to before this sprint.
- Confirmed the new `isRecertObject` parameter defaults to `false`, so the one
  existing call site is the only one affected — no other caller of
  `isFileUploadAllowedForRole` silently changes behavior.

## Not done in this sprint (by design)

- **Page Layout placement** — your side, same as every prior sprint. All fields
  from Sprints 0-4 need to be on the layout before any of this UI has something to
  render against.
- **Permission Set entries** (view/deny per role per field) — **Sprint 6**. This
  sprint's `RECERT_FILE_FIELD_UPLOAD_ROLE` map is a hard *upload* floor, not a
  *visibility* control — a Tech Reviewer who can't upload `recert_ncr` can still
  *see* the field and its current value until Sprint 6's Permission Set entries
  narrow that.
- QA / live walkthrough with real logins — **Sprint 7**.

---

## Next

**Sprint 6** (Permission Set Entries, SQL) is next — the deny-list table in
`00_Sprint_Plan.md`'s Sprint 6 section is already reconciled against the actual
rights-matrix screenshot (done two sessions ago, see that section's note), so this
should be a more direct migration than the earlier sprints, following the same
technique as Surveillance 1's migration 263.
