# Tech Reviewer Findings → Auditor Revision Loop

Stakeholder request (2026-08-03): when the Tech Reviewer records findings on a Stage 1/Stage 2 audit report, the record should **not** proceed straight to closure/CDC upload. Instead it should go back to the Auditor/CRM to revise and re-upload the report/NCR, then return to the Tech Reviewer. Only an **accept with no findings** should advance to the next stage.

Implemented in migration `253_tech_findings_revision_loop.sql` + `StageAuditActionPanel.tsx`. Applies identically to Stage 1 and Stage 2.

---

## Behavior change

| Tech Reviewer action | Before | After |
|---|---|---|
| Textarea left blank → "Accept Without Findings" | `status__a = Stage1_Tech_Findings_Given` (proceeds to closure) | **Unchanged** |
| Textarea filled in → "Submit Findings" | `status__a = Stage1_Tech_Findings_Given` (proceeded to closure anyway — notes were just stored alongside) | `status__a = Stage1_Tech_Findings_Rejected` (sent back to Auditor/CRM — does **not** proceed) |

The button already said "Submit Findings" vs "Accept Without Findings" based on whether the textarea had content (`StageAuditActionPanel.tsx:559`) — previously that was cosmetic only; both paths called the same RPC with the same status transition. Now the label matches what actually happens.

---

## Status flow

```
                     ┌─────────────────────────────────────────────┐
                     │                                               │
                     ▼                                               │
Stage1_Auditor_Accepted  ──(Tech: no findings)──►  Stage1_Tech_Findings_Given ──► closure
        ▲                                                            
        │                                                            
        │ Auditor/CRM re-uploads                                     
        │ stage1_report / stage1_ncr                                 
        │                                                            
Stage1_Tech_Findings_Rejected  ◄──(Tech: findings given)──┘
```

Stage 2 mirrors this exactly: `Stage2_Evidences_Accepted ⇄ Stage2_Tech_Findings_Rejected`, proceeding to `Stage2_Tech_Findings_Given` (then CDC upload) only on no-findings acceptance.

**The loop skips the Client entirely.** A revision uploaded in response to Tech Reviewer findings goes straight from Auditor/CRM back to the Tech Reviewer — it does not re-enter `Stage1_Report_Sent` / re-collect the Client's NCR+RCA. The RCA itself isn't what's in question at this point; the Auditor's report/NCR write-up is. There is no cap on how many times this loop can run.

---

## Code changes

### RPCs (`supabase/migrations/253_tech_findings_revision_loop.sql`)

| Function | Change |
|---|---|
| `submit_stage1_tech_findings` | Branches on `p_notes`. Blank → unchanged (`Stage1_Tech_Findings_Given`). Non-blank → **new**: `Stage1_Tech_Findings_Rejected`, stores the notes, does **not** stamp `stage1_tech_findings_date__a`. |
| `submit_stage2_tech_findings` | Same branch, mirrored (`Stage2_Tech_Findings_Rejected`). |
| `finalize_file_upload` | Adds one new guarded `UPDATE` per stage: when `stage1_report`/`stage1_ncr` (or `stage2_report`/`stage2_ncr`) is uploaded by CRM/Auditor while `status__a` is `*_Tech_Findings_Rejected`, jump straight back to `*_Auditor_Accepted` / `*_Evidences_Accepted` and clear the findings notes. The existing migration-249 guard (`Stage1_Plan_Accepted`/`Stage1_Report_Sent` → `Stage1_Report_Sent`) is untouched — first upload and idempotent pre-RCA re-upload behave exactly as before. |

Why the date isn't stamped on rejection: `stage1_tech_findings_date__a` / `stage2_tech_findings_date__a` are the `dateKey`s for the "Tech Review Passed" dot in `ClientWorkflowBar.tsx`. Stamping them before the review has actually passed would make that bar's date-driven fallback jump ahead of where the record really is.

### UI (`app/commonfiles/core/components/custom/External_Client/StageAuditActionPanel.tsx`)

- New visibility flags: `showTechFindingsRevisionPrompt` (`(isCRM || isAuditor) && status === 'Stage1_Tech_Findings_Rejected'`) and its Stage 2 mirror `showStage2TechFindingsRevisionPrompt`.
- New panels "Revise Stage 1 Audit Report" / "Revise Stage 2 Audit Report", shown to CRM/Auditor, displaying the Tech Reviewer's findings text in a red remarks box — same visual pattern as the existing `planClientRemarks` / `rcaRejectionNotes` boxes elsewhere in this file.
- Both flags added to the `anyVisible` OR-chain and to the admin-only "nothing to show" fallback remarks list.
- No changes to `handleSubmitFindings` / `handleSubmitStage2Findings` — the existing "Submit Findings" button now correctly triggers the loop-back purely because the RPC's own behavior changed.

---

## Design decisions worth knowing

**No new `tenant.picklist_values` entries, no new dot on `ClientWorkflowBar.tsx`.** `Stage1_Tech_Findings_Rejected` / `Stage2_Tech_Findings_Rejected` are intentionally *not* registered there. Reasoning:

- `ClientWorkflowBar` is client-facing progress display. "Sent back to the Auditor for an internal revision" isn't a client-facing pipeline step, and shoehorning it into a strictly linear, ordered dot sequence (`STAGES` array in `ClientWorkflowBar.tsx:22-46`) has no real payoff.
- `resolveCurrentStageIndex()` (`ClientWorkflowBar.tsx:66-80`) already falls back cleanly: if `status__a` doesn't match any `STAGES` entry, it derives the current stage from the last filled date column instead. Since we deliberately don't stamp a new date for the rejected status, the bar just keeps showing "Stage 1 NCR + RCA Accepted" / "Stage 2 NCR Closed" (whichever was already stamped) as current — an accurate approximation from the client's point of view.
- `status__a` is documented as "plain text convention, no DB constraint" (migration 233's header) — writing an unregistered value is safe at the DB layer.

**Interaction with the Stage-report client lock is fail-safe by construction.** `RecordDetailView.tsx`'s `isStageReportLockedForClient()` uses a separate ordered list, `STAGE_STATUS_ORDER` (`RecordDetailView.tsx:101-111`), to decide whether the linked Client may see `stage1_report`/`stage2_report` yet — unlocking only once `status__a`'s rank reaches `Stage1_Tech_Findings_Given` / `Stage2_Tech_Findings_Given`. That list also does **not** include the two new rejected statuses, and the function's own contract is "unknown/unranked status defaults to locked" (`indexOf` returns `-1`, which is always less than the unlock rank). So while a revision is in progress, the report correctly stays hidden from the Client — no change was needed there, it was already fail-closed.

**File upload permission is unaffected.** `FILE_FIELD_UPLOAD_ROLE` (`RecordDetailView.tsx:137-147`) gates `stage1_report`/`stage1_ncr`/`stage2_report`/`stage2_ncr` uploads to `crm_or_auditor` purely by role — it has no `status__a` dependency, so CRM/Auditor can re-upload during `*_Tech_Findings_Rejected` exactly as they could during the original `Stage1_Plan_Accepted` checkpoint. Combined with the file-upload-without-Edit-Mode change from earlier this session, the Auditor doesn't need to press "Edit Record" to act on this either.

**Findings text reuses the existing notes column**, same "one remarks field, latest value wins" convention already used by `stage1_plan_client_remarks__a` / `stage1_rejection_notes__a` elsewhere in this workflow — no new columns were added. It gets cleared by `finalize_file_upload` once the Auditor re-uploads, so a stale finding doesn't linger into the next review round.

---

## Applying this change

Migration `253_tech_findings_revision_loop.sql` has **not** been run against the database yet — this project isn't linked to the Supabase CLI in this environment (`supabase link` not run, no direct Postgres connection string in `.env.local`), so it needs to be pasted into the Supabase Dashboard's SQL editor and run manually, the same way migrations 248–250 were applied.

---

## Test plan

1. Drive a record to `Stage1_Auditor_Accepted` (Auditor accepts the Client's NCR+RCA).
2. As Tech Reviewer, type findings text and submit → confirm `status__a` becomes `Stage1_Tech_Findings_Rejected`, and the Auditor's Closure panel (`showClosurePanel`) does **not** appear.
3. As CRM/Auditor, confirm the new "Revise Stage 1 Audit Report" panel appears showing the findings text, and re-upload `stage1_report` (or `stage1_ncr`) without needing to press "Edit Record".
4. Confirm `status__a` returns to `Stage1_Auditor_Accepted` and the Tech Reviewer's findings panel reappears; confirm `stage1_tech_findings_notes__a` is cleared.
5. Repeat steps 2–4 once more to confirm the loop has no cap.
6. As Tech Reviewer, submit with the textarea left blank → confirm `status__a` becomes `Stage1_Tech_Findings_Given` and the Auditor's Closure panel appears as before.
7. Confirm the linked Client still cannot see `stage1_report` at any point during steps 2–5 (only after step 6).
8. Repeat 1–7 for Stage 2 (`Stage2_Evidences_Accepted` / `Stage2_Tech_Findings_Rejected` / `stage2_report` / `stage2_ncr` / CDC upload prompt).
