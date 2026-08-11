# Surveillance 1 (Renewal) — Sprints 0 & 1: What Shipped

Covers **Sprint 0** (rename, email field, notification route) and **Sprint 1**
(team assignment + plan round backend), built together per this session's request.
Both follow [`00_Sprint_Plan.md`](00_Sprint_Plan.md) exactly — no scope changes,
one deliberate naming deviation flagged below.

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) (the plan) → **this doc**
> (what actually shipped, migration numbers, manual steps still needed).

Related: [`new-renewal-form.md`](../new-renewal-form.md), the External Client Stage
1/2 doc set (`../../New/S0_S1_S2.md` → `S6...md`) this plan's architecture is copied
from.

---

## 1. Sprint 0 — Rename, Email Field, Notification Route

**Migration:** [`256_renewal_email_and_notification.sql`](../../../../supabase/migrations/256_renewal_email_and_notification.sql)

- `create_renewal_client` gets a new optional `p_email TEXT DEFAULT NULL` param.
  When provided, it overrides the `email__a` copied from the linked external client
  (or is used outright when no client is linked at all). No new column — `email__a`
  already existed on `tenant.renewal_clients__a` since migration 221.
- No status/field-registration changes in this migration — it's a pure RPC-signature
  extension.

**Frontend:** [`NewRenewalForm.tsx`](../../../../app/commonfiles/core/components/custom/Renewal_Client/NewRenewalForm.tsx)

- Title: "New Renewal" → **"New Surveillance 1"**. Submit button: "Create Renewal" →
  **"Create Surveillance 1"**. (Grepped the rest of `app/` for both literal strings —
  no other component references them, so this was the only file to touch.)
- New **Email** field, always editable, auto-filled from the picked client's
  `email__a` the moment a client is selected — but only while the user hasn't typed
  into the box themselves (`emailTouched` flag), so a manual edit always wins and
  never gets silently overwritten by a later client-picker change.
- On submit: `create_renewal_client` now passes `p_email`. After the record (and
  optional letter) is created, if an email is present the form calls the new
  notification route with template `surveillance_intimation` and `{ companyName,
  hasLetter }` in `data`. **Non-blocking**: a failed or unconfigured send only shows
  a toast warning ("Record created, but the notification email was not sent") — it
  never fails record creation, same philosophy the file-upload step already used.

**New route:** [`app/api/notifications/send/route.ts`](../../../../app/api/notifications/send/route.ts)

- Generic `{ to, template, data }` shape, not a one-off "send intimation email"
  endpoint — every future "get email" checkpoint from the SURV1 rights matrix
  (Sprints 2–3: NCR sent, report sent, certificate issued, etc.) can register a new
  entry in the `TEMPLATES` map here instead of a new route.
- Uses **Resend's REST API directly via `fetch`** (`https://api.resend.com/emails`)
  — deliberately did **not** add the `resend` npm package (checked `package.json`,
  not currently a dependency); the REST call is a few lines and avoids a new
  dependency for what's a single POST.
- Always responds `200` with a `{ success, message }` body, even on failure — by
  design, since callers are expected to treat this as best-effort and never branch
  on HTTP status. Missing `RESEND_API_KEY` is treated as "not configured yet," not an
  error — the route works (and record creation succeeds) with zero email setup done.
- One template shipped: `surveillance_intimation`.

**`env.example`** — added `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` (default
`sales1@twe.co.in`) with a comment noting domain verification is required before
sends actually deliver.

### Still needed from your side (Sprint 0)

Nothing here is code — all stakeholder/ops setup, previously discussed:
1. Resend account + add the `twe.co.in` domain → verify via the SPF/DKIM DNS records
   Resend gives you.
2. Generate a `RESEND_API_KEY` in the Resend dashboard.
3. Set `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` in `.env.local` (dev) and your
   hosting provider's env vars (production).
4. Until step 1–3 are done, creating a Surveillance 1 record still works end-to-end —
   the email step just silently no-ops with a console warning server-side.

---

## 2. Sprint 1 — Backend: Team Assignment + Plan Round

**Migration:** [`257_surv_team_assignment_and_plan_round.sql`](../../../../supabase/migrations/257_surv_team_assignment_and_plan_round.sql)

**Part A — `surveillance_audit_date__a`: DATE → TEXT.** Converted now, matching
Stage 2's convention, so this object skips the DATE→TEXT rework Stage 1 needed later
(migration 238). `tenant.fields.type` updated to `'text'` alongside the column.

**Part B/C — New columns + field registration:**

| Column | Type | Registered in `tenant.fields`? |
|---|---|---|
| `auditor_id__a` | UUID → `system.users` | **No** — set only via `assign_surv_team`, same reasoning as External Client's equivalent (244): registering it would let generic field-edit access set an arbitrary user id, bypassing role validation |
| `tech_reviewer_id__a` | UUID → `system.users` | **No** — same reasoning |
| `team_assigned_date__a` | DATE | Yes |
| `surv_audit_plan__a` | JSONB (file) | Yes — `surv_audit_plan` |
| `surv_plan_sent_date__a` | DATE | Yes |
| `surv_plan_accepted_date__a` | DATE | Yes |
| `surv_plan_client_remarks__a` | TEXT | Yes |

**Part D — `status__a` picklist backfill.** Registered the five statuses that were
already live but never in `tenant.picklist_values` (`Intimation_Sent`,
`Intimation_Accepted`, plus the two legacy `Audit_Plan_*` values), added the new
`Team_Assigned` / `Surv_Plan_Sent` / `Surv_Plan_Accepted` values in display order, and
kept `Renewal_Complete` registered as a legacy/retired value (display_order 99) so
existing records created before this epic still resolve to a labeled dropdown entry
instead of a blank one. Closes the picklist-registration gap from day one, instead of
the way Stage 1 didn't close it until migration 237.

**Part E — `assign_surv_team(p_record_id, p_auditor_id, p_tech_reviewer_id)`.**
CRM/admin only. Only fires when the record is at `Intimation_Accepted` (mirrors
External Client's "only right after `Client_Agreement_Signed`" checkpoint gate).
Validates both chosen users actually hold the Auditor / Tech Reviewer custom role
before assigning — a bad direct RPC call can't put a Tech Reviewer in the auditor
slot. Reuses the existing `get_tenant_users_by_role_pattern` RPC (live since
migration 244/247) for populating the picklists — no new lookup RPC needed, as
planned.

**Part F — `review_surv_plan(p_record_id, p_action, p_notes)`.** Linked
client/admin only. `accept` → `Surv_Plan_Accepted` + stamp date + clear remarks.
`reject` → **stays** `Surv_Plan_Sent` + stores `p_notes` in
`surv_plan_client_remarks__a` (no step-back, matching the plan's reject-in-place
design for this checkpoint).

**Part G — `finalize_file_upload` redefined**, reproducing the current live body
(confirmed against migration 255, the most recent redefinition, not an older
snapshot) and adding one new block: `surv_audit_plan` upload by CRM/Auditor/admin →
`Surv_Plan_Sent` + stamps `surv_plan_sent_date__a` + **clears
`surv_plan_client_remarks__a` on every upload, not just on accept** — the 238
remarks-clearing bug-fix built in from the start, as planned, instead of hit later.

### Deliberate deviation — flagging, not hiding

**`surv_audit_plan__a` is a *new* column, not a rename of the original
`surveillance_audit_plan__a`** (which has existed since migration 221 and is bound to
the original `review_surveillance_audit_plan` RPC and the `Audit_Plan_Sent` /
`Audit_Plan_Accepted` statuses). Reasoning: the original pair predates the
team-assignment gate and the remarks-clear-on-reupload fix, and reusing it in place
risked breaking anything that might already reference the old field/status names.
Shipped as a fresh pair instead — **the old
`surveillance_audit_plan__a`/`review_surveillance_audit_plan`/`complete_renewal` path
is left fully intact and functional, just unused by the new flow going forward**,
same "don't delete, just stop wiring it up" convention already used elsewhere in this
app for superseded fields. Net effect: the object now carries two parallel
plan-upload fields until a future cleanup sprint (not in this plan) decides whether
to retire the old one. If this isn't the right call, it's a one-migration reversal —
worth a quick confirmation before Sprint 4 places `surv_audit_plan` on the Page
Layout.

### Not done in this sprint (by design, per the plan doc)

- **Frontend**: `RenewalActionPanel.tsx` (Assign Team prompt, Plan upload/review UI)
  and `RenewalWorkflowBar.tsx` (new stages) are **Sprint 4** — this session shipped
  backend only, as scoped.
- **Page Layout placement** of the 5 new registered fields — also Sprint 4.
- Auditor / Tech Reviewer role existence was **not verified live** this session (no
  DB read access in this pass) — confirm real users hold those custom roles before
  testing `assign_surv_team`, per the plan's Sprint 1 prerequisite.

---

## 3. Migration numbering

Applied as `256` and `257`, verified against the actual latest file in
`supabase/migrations/` at the time of writing
(`255_remove_stage2_evidences_upload_date.sql`) — not assumed from the sprint-plan
doc's "256 is next-free" note, which was written a session earlier and could have
drifted. Re-verify the head again before writing Sprint 2's migration, same caution
the plan doc already calls out.

---

## 4. Verification done this session

- `npx tsc --noEmit` — no errors reported against `NewRenewalForm.tsx` or the new
  `app/api/notifications/send/route.ts`.
- Cross-checked `finalize_file_upload`'s base body against every migration that has
  redefined it since 221 (233, 234, 237, 238, 243, 249, 253, 255) by reading 255 in
  full — confirmed it's the live authoritative version, not stale, before extending
  it in 257.
- Confirmed `create_renewal_client` has not been redefined by anything after
  migration 225 before extending it in 256.
- **Not done**: no live database access this session, so none of this was executed
  against Supabase — these are migration files ready to run, not confirmed-applied
  changes. Standard for this repo (migrations are applied by hand, see
  `DeployNEW_UPDATE_PROCEDURE.md`).

---

## 5. Suggested next step

**Sprint 2** (NCR + RCA + RCA acceptance) is next in the plan and has no frontend
dependency on Sprint 4 completing first — same "backend sprints can run ahead of the
UI" pattern this session used for Sprints 0–1. Alternatively, if you'd rather see the
UI catch up before going further into the backend chain, Sprint 4's Action
Panel/Workflow Bar work only needs Sprints 1–3's RPCs to exist (not be wired into a
UI yet) to start on the Team Assignment + Plan Round portion of it.
