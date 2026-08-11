# Surveillance 1 (Renewal) — Sprint 4: What Shipped

Frontend rebuild — you asked me to code this one directly instead of just spec'ing it.

## Files changed

- **`RenewalWorkflowBar.tsx`** — rebuilt from the hardcoded 5-stage array to the full
  13-stage sliding-window pattern (copied from `ClientWorkflowBar.tsx`: 7-wide window,
  prev/next paging, date-driven fallback when `status__a` doesn't match a known
  stage). Legacy statuses (`Audit_Plan_Sent`/`Audit_Plan_Accepted`/`Renewal_Complete`)
  are deliberately excluded from the array, same as External Client excludes its
  retired statuses — an old-flow record falls back to date-driven resolution.
- **`RenewalActionPanel.tsx`** — rebuilt from 3 checkpoints to all 14 (Intimation
  upload/review → Assign Team → Plan upload/review → Conduct Audit → NCR upload/RCA
  upload → RCA review → Report upload → Tech Findings → Close → CDC upload →
  Certificate). Copied `StageAuditActionPanel.tsx`'s structure directly, including
  the hardened `isClientOnly` exclusion (a linked client can never trigger a
  CRM/Auditor/Tech/CDC-only panel, regardless of role-string quirks).
- **`RecordDetailView.tsx`** — extended `FILE_FIELD_UPLOAD_ROLE` with the 8
  renewal_clients__a fields, plus two new rule kinds (`'tech_only'`, `'cdc_only'`)
  that External Client never needed. This is the frontend hard floor matching
  migration 261's server-side gates.

`npx tsc --noEmit` clean on all three files.

## One decision worth your eyes: `showRcaReviewPanel` is Auditor-only, not `isAuditor || isCRM`

External Client's equivalent panel shows to both. Surveillance 1's doesn't, because
`review_surv_ncr_rca`'s RPC gate has no CRM bypass (your confirmed decision last
sprint) — showing CRM a working-looking Accept/Reject pair that always fails server-
side would be worse than not showing it. If you'd rather CRM see it (disabled, or
with an explanatory note) instead of nothing, say so.

## Side effect worth flagging: `cdc_report` hard floor now also applies to External Client

`FILE_FIELD_UPLOAD_ROLE` is keyed by field name only, and `cdc_report` is the field
name on **both** objects. External Client's CDC report never had this hard floor —
migration 243 deliberately left it Permission-Set-only. Adding `'cdc_only'` for
Surveillance 1 closes that same gap on External Client too, as a side effect, not a
separate ask. It's consistent with 243's shortcut being effectively superseded by
248's later finding (PS-only isn't reliable) — but it's a behavior change to a
different epic you didn't request this session. If External Client's CDC role
currently relies on non-CDC roles being able to upload for some workflow reason,
this would newly block that. Let me know if it needs to be scoped to
`renewal_clients__a` only (would need `isFileUploadAllowedForRole` to take an object
name/id, which it doesn't today).

## Still needed (manual, your side)

- **Page Layout**: place the fields listed in Sprint_2.md/Sprint_3.md field tables
  (Settings → Object Manager → Renewal Clients → Page Layout) — none of Sprints 1–3's
  new fields are visible anywhere until placed.
- **Permission Set config** — Sprint 5.
- Confirm Auditor/Tech Reviewer/CDC test accounts actually hold those custom roles
  before testing the Assign Team dropdowns / RCA review / CDC upload panels.

## Not done

- Suspension/Withdrawal — out of scope for this plan.
- No live testing this session (no DB/browser access) — this is code review-ready,
  not yet click-tested against a live record.

---

## Addendum — row-by-row audit against the SURV1 matrix, 2 gaps found and fixed

Re-checked every row (1–13, Certificate Issue) against what's actually built in
256–261 + this sprint's frontend. Every RPC gate, upload gate, and panel visibility
matches the matrix **except two**, both now fixed in the files above:

1. **Row 9, "surv audit report — Client: view only after tech review acceptance"**
   — never implemented. The original Sprint 3 plan called for the same
   status-conditional-hide mechanism `stage1_report`/`stage2_report` use, but it
   only got documented as a to-do, not built, and Sprint 4 missed it too. Fixed in
   `RecordDetailView.tsx`: `surveillance_audit_report` now hides from the linked
   client (shows "Available once the Tech Reviewer has reviewed the audit report")
   until `status__a` reaches `Surv_Tech_Findings_Given`. Built as its own
   `SURV_STATUS_ORDER` array rather than appended to the existing
   `STAGE_STATUS_ORDER` — `'Team_Assigned'` and `'CDC_Approved'` are real status
   values on **both** objects, so a shared array would have silently resolved
   Surveillance 1's rank for those names to External Client's position instead —
   accidentally harmless for this one check, but a landmine for the next.
2. **Row 3, "assign team — cdc: view"** — the read-only assigned-team strip only
   checked `isCRM || isAuditor || isTech`, leaving CDC unable to see who's assigned
   even though the matrix gives them view access on this row (External Client's
   equivalent strip never needed to include CDC, so it wasn't front-of-mind copying
   that template). Fixed in `RenewalActionPanel.tsx` — added `isCdc`.

`npx tsc --noEmit` re-run clean after both fixes.

Everything else checked out: soft-gate/hard-gate split matches the matrix's
upload column exactly per role, the Auditor-only RCA-accept gate (no CRM bypass)
matches row 8 exactly, Tech Reviewer's checklist-only upload matches row 11, CDC's
upload-is-the-approval matches row 12, and every "view"-only cell for a role that
has no corresponding RPC access is correctly *not* wired to any button in the
Action Panel (so no role sees a control that would just fail on click).
