# Surveillance 1 (Renewal) — Sprint 8: Suspension & Withdrawal Chain

**Status:** Built. `npx tsc --noEmit` clean. Migrations written, **not yet applied**.

Un-defers the six rights-matrix rows after Certificate Issue — suspension
intimation → decision → letter, withdrawal intimation → decision → letter.
Fully specified and confirmed in `00_Sprint_Plan.md`'s Sprint 8 section before
any code was written; this doc records what actually shipped from that plan.

---

## Confirmed shape (recap)

Every one of the six rows is a plain file/document field — **the act of
uploading it is the entire action**, same pattern already used for
`cdc_report` and `surveillance_certificates`. No accept/reject step, no new
custom RPC — only `finalize_file_upload` / `start_file_upload` extensions.

**Sequencing — strictly linear, confirmed:**

| Field | Requires `status__a =` |
|---|---|
| `surv_suspension_intimation` | `Certificate_Issued` |
| `surv_suspension_decision` | `Suspension_Intimation_Sent` |
| `surv_suspension_letter` | `Suspension_Decision_Uploaded` |
| `surv_withdrawal_intimation` | `Suspension_Letter_Sent` |
| `surv_withdrawal_decision` | `Withdrawal_Intimation_Sent` |
| `surv_withdrawal_letter` | `Withdrawal_Decision_Uploaded` |

**Roles:** CRM uploads the 4 intimation/letter fields (Client gets view +
email); CDC uploads the 2 decision fields (CRM gets view-only, no email,
Client has zero access); Auditor/Tech Reviewer have zero access to all 6 rows.

---

## Migrations (written, not applied)

| # | File | What it does |
|---|---|---|
| 277 | `277_surv_suspension_withdrawal_schema.sql` | 12 new columns (6 file, 6 date), registered in `tenant.fields` at display_order 53–64; 6 new `status__a` picklist values at display_order 14–19 |
| 278 | `278_surv_suspension_withdrawal_start_upload.sql` | Extends `start_file_upload` — 6 new hard-block role gates (CRM-only ×4, CDC-only ×2) + exact-prior-status sequencing gate on each |
| 279 | `279_surv_suspension_withdrawal_finalize_upload.sql` | Extends `finalize_file_upload` — 6 new soft-gate auto-advance blocks, re-upload guards on the first 5 (terminal `surv_withdrawal_letter` unguarded, same reasoning as `surveillance_certificates`) |
| 280 | `280_surv_suspension_withdrawal_permission_sets.sql` | Permission Set entries — Auditor/Tech reviewer denied on all 12 fields; Client denied on the 2 decision fields; CDC denied on the 4 intimation/letter fields; CRM view-only (not edit) on the 2 decision fields |

### Cross-epic safety — verified before writing 278/279, not assumed

`finalize_file_upload` / `start_file_upload` are shared functions across
External Client, Surveillance 1, *and* Recertification. Before extending
either, read the **actual live body** via the most recent redefinition —
which turned out to be migration **268** (Recertification's Sprint 4), not
Surveillance 1's own last touch at 261/260. Reproducing from 261/260 instead
of 268 would have silently reverted Recertification's Sprint 2–4 blocks the
moment 278/279 ran. Both migrations reproduce 268's full body verbatim, with
only the 6 new Surveillance-1-scoped blocks added — External Client's and
Recertification's blocks are byte-identical to what's already live.

---

## Frontend changes (all Surveillance-1-scoped; External Client untouched)

**`app/api/notifications/send/route.ts`** — 4 new templates:
`surveillance_suspension_intimation`, `surveillance_suspension_letter`,
`surveillance_withdrawal_intimation`, `surveillance_withdrawal_letter`. Same
generic route Sprint 0 built — no new endpoint.

**`FileUploadField.tsx`** — additive change. `onUploadComplete` now optionally
receives `{fieldName, bucket, path, filename}` for the last successfully
uploaded file. Every existing 0-arg caller (`() => ...`) across every other
object still works unchanged — this was the one genuinely new piece of
plumbing the plan flagged as non-trivial, not a copy-paste from Sprint 3.

**`RecordDetailView.tsx`**:
- `RENEWAL_FILE_FIELD_UPLOAD_ROLE` extended with the 6 new fields (4×
  `crm_only`, 2× `cdc_only`)
- New `RENEWAL_EMAIL_ON_UPLOAD_FIELDS` map — the 4 fields whose upload
  triggers an email
- New `maybeSendRenewalUploadEmail()` handler: no-ops unless the object is
  Renewal *and* the field is one of the 4 email-triggering fields; reads
  `recordData.email__a` (already stored on every renewal record, no extra
  lookup), signs a URL for the just-uploaded file
  (`supabase.storage.createSignedUrl` — **not** a stored `.url` key, matching
  the fix already applied to `NewRenewalForm.tsx`), and POSTs to
  `/api/notifications/send`. Failure is a toast warning only, never blocks
  the upload that already succeeded.
- Wired into both `FileUploadField` call sites in this file (the generic
  `renderEditableField` path and the primary Page-Layout-driven path) —
  `fieldName={field.name}` passed to each so `UploadedFileInfo` is populated.

**`RenewalActionPanel.tsx`** — 6 new instructional banners (no buttons, no RPC
calls from this panel — same shape as the existing CDC/Certificate banners),
color-coded (yellow = suspension, red = withdrawal, blue = the two decision
uploads) so the workflow bar and action panel visually agree on severity.
Also removed the now-inaccurate "Final Step" badge from Issue Certificate
(the chain continues past it as of this sprint) — moved to Withdrawal Letter,
the new actual terminal checkpoint.

**`RenewalWorkflowBar.tsx`** — `STAGES` extended from 13 to 19 entries. No
logic changes needed — both places that reference stage count already used
`STAGES.length` dynamically, not a hardcoded 13.

---

## Bug fixed in passing (pre-existing, from Sprint 7)

Running `npx tsc --noEmit` as a final check (not just eyeballing the diff)
surfaced a real, pre-existing type error in `surveilanceSheetMapping.ts`:
the `FieldMapping` interface declared `kind: 'date' | 'text'`, but the
`'surv tech review checklist'` entry used `kind: 'file'` — a type mismatch
that had been sitting there since Sprint 7/§12's mapping fixes, never caught
because `tsc` hadn't been run since. Fixed by adding `'file'` to the
interface's union (the runtime behavior was already correct — the parser
already special-cased `kind === 'file'` to skip parsing; only the type
declaration was wrong).

---

## Manual steps still needed (yours)

1. **Apply migrations 277–280**, in order.
2. **Place the 12 new fields on Page Layout** (Object Manager → Renewal
   Clients → Page Layout) — same step every prior sprint needed.
3. **Verify `surveillance_intimation_letter` is viewable on the record** —
   flagged in the original Sprint 8 plan as a low-risk verification step
   (registered since migration 221, almost certainly already on Page Layout
   from before this epic renamed "Renewal" to "Surveillance 1"). Confirm
   rather than assume: check Page Layout placement and that no Permission
   Set entry denies Client `can_read`.
4. **Manual QA walk**, one record through all 6 checkpoints with real CRM/CDC
   logins:
   - CRM can upload suspension intimation only at `Certificate_Issued`;
     wrong status/role denied
   - Client receives the suspension-intimation email with the file attached
   - CDC can upload the suspension decision; CRM can view (not edit) it;
     Client cannot see it; no email fires
   - Same two patterns repeat for suspension letter, then all three
     withdrawal rows
   - Workflow bar renders all 19 stages correctly, current stage centered

---

## Explicitly out of scope for this sprint

- **Repeat suspension cycles** (suspended → reinstated → suspended again) —
  this sprint models one pass through Suspension → Withdrawal as a terminal
  chain, not a loop, per the original plan.
- **Recertification's own Suspension/Withdrawal** — Recertification's rights
  matrix has no such rows at all (confirmed in migration 273's own header
  comment); nothing to build there.
