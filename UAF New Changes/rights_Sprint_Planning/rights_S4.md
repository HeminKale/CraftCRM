# Sprint 4 — Auditor/Tech Reviewer Page Layout field (2026-08-01)

Not part of the original S6 backlog — a new ask that came up after Sprint 2:
place `auditor_id__a`/`tech_reviewer_id__a` (added in 244, deliberately
unregistered) on the Page Layout as an editable, name-based picklist, with
the selection actually driving who's authorized for accept/reject/close/
findings on that record.

## What was built

**[`supabase/migrations/246_user_lookup_field_type_stage_team.sql`](../../supabase/migrations/246_user_lookup_field_type_stage_team.sql)** — three parts:

1. **Enforcement trigger** on `tenant.external_clients__a`
   (`trg_validate_stage_team_role_match`) — rejects any write to
   `auditor_id__a`/`tech_reviewer_id__a` unless the new value is a user who
   actually holds the matching role. This isn't optional defense-in-depth —
   tracing `update_tenant_record` (231) showed it writes any column named in
   its JSONB payload with **zero field-level permission checking**;
   Permission Sets' `can_edit` is enforced client-side only for that RPC. The
   trigger is the only real server-side guard available for these two
   columns, and it covers every write path (Page Layout, `assign_stage_team`,
   a direct RPC call).
2. **New field type `user_lookup`** + `tenant.fields.lookup_role_pattern`
   column. Registered both fields with `lookup_role_pattern = 'auditor'` /
   `'tech'` — reuses the existing `get_tenant_users_by_role_pattern` RPC
   (already built for the Assign Team panel) to populate the picklist with
   names, filtered to the matching role.
3. **`get_tenant_fields` / `get_fields_metadata` redefined** to also return
   `lookup_role_pattern`, so the frontend actually receives it.

**Frontend — [`RecordDetailView.tsx`](../../app/commonfiles/core/components/Application/RecordDetailView.tsx):**
- `FieldMetadata` interface: added `lookup_role_pattern`.
- `formatFieldValue`: `user_lookup` fields now resolve their stored UUID to
  a name via the existing `userMap` (same mechanism already used for
  `created_by`/`updated_by`/`record_owner__a`) — no new fetch needed for
  view-mode display.
- The reference-options loading effect now also covers `user_lookup`
  fields, calling `get_tenant_users_by_role_pattern` instead of
  `get_reference_options`.
- The edit-mode dropdown renderer (previously `reference`-only) now also
  handles `user_lookup` — same `<select>`, same `referenceOptions` state,
  just a different data source.
- `npx tsc --noEmit` run clean after these edits.

## A second bug found and fixed while testing

Saving an external client record threw `Error: Rendered more hooks than
during the previous render` pointing at
[`StageAuditActionPanel.tsx`](../../app/commonfiles/core/components/custom/External_Client/StageAuditActionPanel.tsx)'s
`useEffect` (the one fetching Auditor/Tech Reviewer options). Pre-existing
bug from the earlier session that added the Assign Team panel — not
introduced by 246 — but it only actually surfaced once a real record had
both `auditor_id__a` and `tech_reviewer_id__a` set, which flips
`anyVisible`/`showAssignedTeamInfo` across renders.

Root cause: the component had an early `if (!anyVisible) { ... return null; }`
sitting **before** that `useEffect` call. Whenever `anyVisible` was false,
the effect got skipped entirely — a textbook Rules-of-Hooks violation (hook
count must be identical on every render, regardless of any condition).
Fixed by moving the early return to after the `useEffect`, so the hook
always fires unconditionally. `npx tsc --noEmit` clean after the fix.

## A third bug found and fixed — view mode showed raw UUIDs, not names

After saving, the Page Layout showed the assigned Auditor/Tech Reviewer as
raw UUIDs instead of names — but the edit-mode dropdown correctly showed
names. The two paths use different data sources: edit mode resolves names
via `get_tenant_users_by_role_pattern` (a `SECURITY DEFINER` RPC), view mode
resolves via `useUserMap`'s direct `system.users` table select, relying on
that table's RLS policy (`auth.jwt()->>'tenant_id'`). Every other
user-lookup in this app resolves the caller's tenant through a
`SECURITY DEFINER` function keyed off `auth.uid()` instead — `useUserMap`
was the one place still on the JWT-claim path, and it was silently
returning zero rows for real sessions (no error, just an empty result, so
`resolveUserValue` fell back to displaying the raw UUID).

This almost certainly also silently affected `created_by`/`updated_by`/
`record_owner__a` display before now — just less visible, tucked into the
collapsed "System Fields" section.

Fixed with [`supabase/migrations/247_tenant_user_directory_rpc.sql`](../../supabase/migrations/247_tenant_user_directory_rpc.sql)
(`get_tenant_user_directory()`, `SECURITY DEFINER`, resolves tenant via
`auth.uid()`) and switched
[`useUserMap.ts`](../../app/commonfiles/core/hooks/useUserMap.ts) to call it
instead of the raw table select. Deliberately not reused
`get_tenant_users_by_role_pattern` for this — that one INNER JOINs
`tenant.roles`, which would exclude any user with no `custom_role_id` (e.g.
the tenant admin), and `useUserMap` needs to resolve *any* user.
`npx tsc --noEmit` clean.

**Manual step:** apply `247_tenant_user_directory_rpc.sql`, then hard-refresh
the record page and confirm the Assigned Auditor/Tech Reviewer names display
correctly after save.

## A bug found along the way — not fixed, flagged only

Registered these two fields **with** the `__a` suffix already in the name
(`auditor_id__a`, not bare `auditor_id`) — deliberately breaking from
migration 242's convention. Traced the actual save path
(`mapDisplayNameToApiName` → `update_tenant_record`) and found **nothing
ever re-adds `__a` to a bare `tenant.fields.name` before the dynamic
`UPDATE ... SET <name> = ...` runs.** A bare-registered field would try to
write a column that doesn't exist and error out.

This means **242's 12 bare-named fields likely have this same bug** —
untested until someone actually edits one of those fields through the
generic Page Layout form (they're currently only ever written by their
owning RPCs, so the bug has stayed latent). Not fixed here — out of scope
for this ask, and worth confirming with a real edit-and-save test before
deciding whether it needs a fix (rename the 12 `tenant.fields.name` rows to
include `__a`, or fix `mapDisplayNameToApiName` to always resolve to the
actual column — either works, the former is less code).

## Manual steps

1. Apply `246_user_lookup_field_type_stage_team.sql` (same SQL-editor
   workflow as every migration this session).
2. Verify the trigger: try setting `auditor_id__a` to a non-Auditor user's
   id directly via SQL — should raise
   `auditor_id__a must reference a user holding the Auditor role`.
3. Place the two new fields ("Assigned Auditor", "Assigned Tech Reviewer")
   on the Page Layout yourself, as planned.
4. Spot-check: as CRM, edit a record at `Client_Agreement_Signed` or later,
   pick an Auditor/Tech Reviewer from the new dropdowns, save, then confirm
   that user (and only that user) can now accept/reject/close/submit
   findings on that record — same check already enforced by 244's RPCs, now
   also reachable through this field instead of only through the Assign
   Team panel.
5. Decide whether to test-and-possibly-fix the 242 bare-name bug noted
   above — not blocking this feature, but worth knowing before relying on
   generic editing for those 12 fields.
