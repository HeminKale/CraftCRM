# Recertification — Sprint 3: What Shipped

Covers **Sprint 3** (NCR + RCA + Evidences — the Stage-2-shaped round) from
[`00_Sprint_Plan.md`](00_Sprint_Plan.md).

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) (the plan) →
> [`Sprint_0_1.md`](Sprint_0_1.md) → [`Sprint_2.md`](Sprint_2.md) → **this doc**.

**Confirmed before starting:** migrations 264, 265, and 266 had already been run
against the live database (you confirmed after the fact, RLS deliberately skipped for
`recertification_clients__a` — see `00_Sprint_Plan.md`'s status header). This
migration was written against 266's actual `start_file_upload`/`finalize_file_upload`
bodies (reproduced verbatim below the new blocks), not a stale copy — confirmed no
file between 266 and this one touches either function.

Per the plan doc's precedent table, this sprint is structurally closer to External
Client's Stage 2 than to Surveillance 1 — Surveillance 1 has no evidences round at
all. The NCR/RCA half mirrors `surv_ncr`/`surv_ncr_rca`/`review_surv_ncr_rca`
(258/259); the evidences half mirrors `stage2_evidences`/`review_stage2_evidences`
(234).

---

## Migration: [`267_recertification_ncr_rca_evidences.sql`](../../../supabase/migrations/267_recertification_ncr_rca_evidences.sql)

**New columns:**

| Column | Type | Registered? |
|---|---|---|
| `recert_ncr__a` | JSONB (file) | Yes — `recert_ncr` |
| `recert_ncr_sent_date__a` | DATE | Yes |
| `recert_ncr_rca__a` | JSONB (file) | Yes — `recert_ncr_rca` |
| `recert_ncr_rca_uploaded_date__a` | DATE | Yes |
| `recert_auditor_accepted_date__a` | DATE | Yes |
| `recert_rca_rejection_notes__a` | TEXT | Yes |
| `recert_evidences__a` | JSONB, default `'[]'` (**files**, plural) | Yes — `recert_evidences`, type `files` |
| `recert_evidences_uploaded_date__a` | DATE | Yes |
| `recert_evidences_accepted_date__a` | DATE | Yes |
| `recert_evidences_rejection_notes__a` | TEXT | Yes |

`recert_evidences__a` defaults to `'[]'::jsonb`, not `'{}'` — matches
`stage2_evidences__a`'s shape (234) exactly: an array `finalize_file_upload` appends
to via `jsonb` concatenation (`COALESCE(col, '[]'::jsonb) || new_file::jsonb`), not a
single-object slot like every other file field in this epic.

**`status__a` picklist:** `Recert_NCR_Sent` (10), `Recert_NCR_RCA_Uploaded` (11),
`Recert_Auditor_Accepted` (12), `Recert_Evidences_Uploaded` (13),
`Recert_Evidences_Accepted` (14) — continues directly from Sprint 2's 7-9, no
collision.

**`review_recert_ncr_rca(p_record_id, p_action, p_notes)`.** Auditor/admin only —
deliberately **not** widened to CRM (matches row 12's CRM-view-only rule in the rights
matrix). Further restricted to the **specific auditor assigned** via
`assign_recert_team` (admin bypasses; no CRM bypass either way). `accept` →
`Recert_Auditor_Accepted` + stamp date + clear `recert_rca_rejection_notes__a`.
`reject` → stays `Recert_NCR_Sent` + stores `p_notes`, client re-uploads RCA.

**`review_recert_evidences(p_record_id, p_action, p_notes)`.** Auditor/admin,
specific-assigned-auditor (same restriction as above), mirrors
`review_stage2_evidences` (234) with 258's assignment-specificity improvement layered
on top. `accept` → `Recert_Evidences_Accepted` + stamp date + clear
`recert_evidences_rejection_notes__a`. `reject` → back to `Recert_Auditor_Accepted`
(client re-uploads evidences only — RCA itself isn't reopened) + stores `p_notes`.

**`start_file_upload` redefined**, adding:
- `recert_ncr` — CRM-or-Auditor hard gate.
- `recert_ncr_rca`, `recert_evidences` — Client-only hard gates (linked client or
  admin).

**`finalize_file_upload` redefined**, adding, each with a **re-upload status guard
built in from day one** (same convention Sprint 2 already applied to
`recert_audit_plan` — not waiting for a follow-up migration the way Surveillance 1's
262 had to):
- `recert_ncr` upload (CRM/Auditor/admin) → `Recert_NCR_Sent` + stamps
  `recert_ncr_sent_date__a`. Guard: `status__a IN ('Recert_Plan_Accepted',
  'Recert_NCR_Sent')`.
- `recert_ncr_rca` upload (linked client or admin only) → `Recert_NCR_RCA_Uploaded` +
  stamps `recert_ncr_rca_uploaded_date__a`. Guard: `status__a IN ('Recert_NCR_Sent',
  'Recert_NCR_RCA_Uploaded')`. **Does not clear `recert_rca_rejection_notes__a`** —
  see decision #2 below.
- `recert_evidences` upload (linked client or admin only) → `Recert_Evidences_Uploaded`
  + stamps `recert_evidences_uploaded_date__a`. Guard: `status__a IN
  ('Recert_Auditor_Accepted', 'Recert_Evidences_Uploaded')`. Same "don't clear
  rejection notes on upload" convention applied for symmetry with the RCA block.

---

## Two decisions made per the plan doc's explicit spec (not independently added)

Both were called out directly in `00_Sprint_Plan.md`'s Sprint 3 section, not
inferred — flagging here so the reasoning is visible in one place alongside what
shipped.

**1. Both review RPCs are gated to the *specific* assigned auditor, not any
Auditor-role holder.** Sprint 2 already built `assign_recert_team` +
`auditor_id__a` specifically so a particular person is on the hook for a particular
record — if accept/reject stayed open to *any* Auditor, that assignment would do
nothing at either checkpoint. Mirrors migration 258's improvement over 234's plain
"any Auditor role" check, applied here to *both* the RCA and evidences checkpoints
(258 only did it for RCA at the time — Surveillance 1 never got an evidences round to
apply it to).

**2. `recert_ncr_rca` and `recert_evidences` uploads do NOT clear their
rejection-notes fields.** Only each RPC's `accept` branch does. This matches the
*corrected* behavior from Surveillance 1's migration 259, which had to **revert** an
unintended deviation — 258 originally cleared `surv_rca_rejection_notes__a` on every
`surv_ncr_rca` upload, which turned out to not match the actual live behavior of
`finalize_file_upload` for External Client's `stage1_ncr_rca` (verified against the
live function body, not the module-header comment describing the general
convention). Recertification ships the corrected behavior the first time instead of
needing a follow-up fix.

---

## Verified against source before writing

- Read `266_recertification_team_and_plan.sql` in full and reproduced its
  `start_file_upload`/`finalize_file_upload` bodies exactly (extracted via `sed` from
  the live file, not retyped from memory) before adding the three new blocks to each.
- Diffed the reproduced bodies (comments-stripped) against 266's — confirmed pure
  additions only, zero drift in any prior block (External Client, Surveillance 1,
  Recertification Sprints 0-2 all untouched).
- Confirmed `267` doesn't collide with any existing migration filename.
- Confirmed function-delimiter balance (`$$` count) and `DECLARE`/`BEGIN`/`END`
  structure across all four functions defined/redefined in this migration.

## Not done in this sprint (by design)

- Frontend (`RecertificationActionPanel.tsx` NCR upload, RCA/evidences review
  prompts) — **Sprint 5**.
- Permission Set entry hiding `recert_ncr`/`recert_ncr_rca`/`recert_evidences` from
  the Tech Reviewer role — **Sprint 6** (this sprint only gates the *upload/accept*
  RPCs; visibility is a separate layer, per this app's two-layer access model — see
  [[project_rpc_vs_permission_sets_craftcrm]] in memory for why).
- Not yet run against the live database or QA'd as of writing this doc — confirm with
  you before Sprint 4 builds on top of it.

---

## Next

**Sprint 4** (Audit Report, Tech Review, Checklist, CDC, Certificate Issue) is next —
the last backend sprint before Sprint 5's frontend build.
