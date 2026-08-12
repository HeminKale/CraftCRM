# Recertification — Sprint 2: What Shipped

Covers **Sprint 2** (Team Assignment + Audit Plan) from
[`00_Sprint_Plan.md`](00_Sprint_Plan.md).

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) (the plan) →
> [`Sprint_0_1.md`](Sprint_0_1.md) (Sprints 0-1) → **this doc**.

**Confirmed before starting:** migrations 264 and 265 had already been run against
the live database by the time this migration was written (you confirmed after the
fact — see [`00_Sprint_Plan.md`](00_Sprint_Plan.md)'s status header). This migration
was written against 265's actual `start_file_upload`/`finalize_file_upload` bodies
(reproduced verbatim below the new blocks), not a stale copy — confirmed no file
between 265 and this one touches either function.

---

## Migration: [`266_recertification_team_and_plan.sql`](../../../supabase/migrations/266_recertification_team_and_plan.sql)

**New columns:**

| Column | Type | Registered in `tenant.fields`? |
|---|---|---|
| `auditor_id__a` | UUID → `system.users` | **No** — set only via `assign_recert_team`, same reasoning as both prior epics: registering it would let generic field-edit access set an arbitrary user id, bypassing role validation |
| `tech_reviewer_id__a` | UUID → `system.users` | **No** — same reasoning |
| `recert_team_assigned_date__a` | DATE | Yes |
| `recert_audit_plan__a` | JSONB (file) | Yes — `recert_audit_plan` |
| `recert_plan_sent_date__a` | DATE | Yes |
| `recert_plan_accepted_date__a` | DATE | Yes |
| `recert_plan_client_remarks__a` | TEXT | Yes |

**`status__a` picklist:** `Recert_Team_Assigned` (7), `Recert_Plan_Sent` (8),
`Recert_Plan_Accepted` (9) — continues directly from Sprint 1's 2-6, no collision.

**`assign_recert_team(p_record_id, p_auditor_id, p_tech_reviewer_id)`.** CRM/admin
only. Only fires when the record is at `Recert_Agreement_Signed` — mirrors both prior
epics' "team assigned right after the client's final intake step" checkpoint
placement. Validates both chosen users actually hold the Auditor / Tech Reviewer
custom role before assigning (a bad direct RPC call can't put a Tech Reviewer in the
auditor slot). Reuses the existing `get_tenant_users_by_role_pattern` RPC — no new
lookup RPC needed, as planned.

**`review_recert_plan(p_record_id, p_action, p_notes)`.** Linked client/admin only.
`accept` → `Recert_Plan_Accepted` + stamp date + clear
`recert_plan_client_remarks__a`. `reject` → **stays** `Recert_Plan_Sent` + stores
`p_notes` (no step-back, matching the plan's reject-in-place design for this
checkpoint, same as Surveillance 1's `review_surv_plan`).

**`start_file_upload` redefined**, adding:
- Team-must-be-assigned-first gate on `recert_audit_plan` (mirrors migration 244's
  `stage_one_audit_plan` gate and 261's `surv_audit_plan` gate) — blocks the upload
  entirely with `'Assign an Auditor and a Tech Reviewer before uploading the
  recertification audit plan'` if either `auditor_id__a` or `tech_reviewer_id__a` is
  NULL.
- CRM-or-Auditor hard gate on `recert_audit_plan`.

**`finalize_file_upload` redefined**, adding:
- `recert_audit_plan` upload by CRM/Auditor/admin → `Recert_Plan_Sent` + stamps
  `recert_plan_sent_date__a` + clears `recert_plan_client_remarks__a` on every
  (re-)upload, not just on accept.
- **Re-upload status guard shipped from day one**: `WHERE status__a IN
  ('Recert_Team_Assigned', 'Recert_Plan_Sent')`. This is the one deliberate
  improvement over Surveillance 1's own Sprint 1 (257), which shipped
  `surv_audit_plan`'s equivalent block *without* this guard and needed a dedicated
  follow-up migration (262) to add it after a self-critique review found four
  unguarded upload blocks that could silently rewind `status__a` on a late
  re-upload. Recertification's `recert_audit_plan` doesn't repeat that gap.

---

## Decision made beyond a literal reading of the plan doc

**None this sprint** — Sprint 2 followed the plan doc's RPC/gate/guard spec exactly,
including the guard-from-day-one instruction the plan itself called out explicitly
(`00_Sprint_Plan.md`, Sprint 2 section: "including the re-upload status guard from day
one — not retrofitted like Surveillance 1 needed migration 262 for").

---

## Verified against source before writing

- Read `265_recertification_intake.sql` in full and reproduced its
  `start_file_upload`/`finalize_file_upload` bodies exactly (not from memory/summary)
  before adding the new blocks.
- Diffed the reproduced bodies (comments-stripped) against 265's — confirmed pure
  additions only, zero drift in External Client's, Surveillance 1's, or
  Recertification's own Sprint 0/1 blocks.
- Confirmed `266` doesn't collide with any existing migration filename at time of
  writing (`265_recertification_intake.sql` was the latest file in
  `supabase/migrations/`).

## Not done in this sprint (by design)

- Frontend (`RecertificationActionPanel.tsx` Assign Team prompt, Plan upload/review
  UI) — **Sprint 5**.
- Page Layout placement of the 5 newly-registered fields — also Sprint 5/your side.
- Auditor / Tech Reviewer role existence was not verified live before writing this
  migration — confirm real users hold those custom roles before testing
  `assign_recert_team`, per the plan's Sprint 2 prerequisite. (Should already be true
  if Surveillance 1's rollout is live, since both epics reuse the same roles.)

---

## Next

**Sprint 3** (NCR + RCA + Evidences) — see [`Sprint_3.md`](Sprint_3.md).
