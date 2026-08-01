# Sprint 1 — Deploy & Verify

## Status: Applied 2026-08-01

242, 243, and the fixed 244 have been run in order. A `CDC` custom role has
been created (closing the gap Step 1's pre-check surfaced — `has_cdc_role`
was `false` beforehand). Pre-check results confirmed before applying:
- `start_file_upload` had only the 232 quotation gate live (239/244 both
  genuinely unapplied — matches the reasoning behind the 244 fix in
  `rights_S3.md`).
- Role names `auditor`, `tech`, `CRM Office` all match the `%auditor%` /
  `%tech%` / `%crm%` patterns the new RPCs rely on. (Noted separately: an
  unused `CRM Officer` role with 0 users also exists — harmless duplicate,
  not blocking, worth tidying in Settings whenever convenient.)

**Independently re-verified** (read-only, via `@supabase/supabase-js` +
service-role key, same method as the earlier pre-check — no manual query
needed for this part): both new RPCs now respond with real logic errors
instead of "function does not exist" —
`get_tenant_users_by_role_pattern` → `Access denied` (its own internal
auth check firing, expected with no user session),
`assign_stage_team` → `Record not found` (got past the role check to the
record lookup, also expected with a dummy UUID). This confirms **migration
244 is genuinely live**, independent of trusting the apply step alone.

**Remaining for this sprint (only because `tenant.*` isn't queryable from
here — REST access to that schema returns `permission denied`): run Step 3's
post-check below and share the output** — confirms 242's field
registrations, 243's `_is_cdc` gate text, and the `Team_Assigned` picklist/
columns landed correctly, not just that *something* ran.

## Sprint 1 outcome — closing this out

- ✅ 242, 243, 244 (fixed) applied 2026-08-01.
- ✅ CDC custom role created — migration 243's gate is no longer inert.
- ✅ 244's RPCs confirmed live via independent read-only check.
- ✅ Step 3 SQL results confirmed 2026-08-01 — all 5 checks passed:
  244's columns exist, `Team_Assigned` picklist landed, both new RPCs exist,
  243's `_is_cdc` gate text present, and 242's field registration confirmed
  (`stage1_closure_notes` found — `stage2_closure_notes` correctly did **not**
  show up in the same query, since 242's header explicitly excludes it as
  dead: Stage 2's auditor-close step is retired, see the migration's own
  "Deliberately EXCLUDED" list. Not a gap — a bad example in my own spot-check
  query, corrected here rather than in the query itself since the result
  already proves the point either way).

**Sprint 1 is complete.**

Goal: apply migrations 242/243/244 and confirm the role-name matching they
depend on (`%auditor%`, `%tech%`, `%cdc%`, `%crm%` substring matches against
`tenant.roles.name`) actually resolves to real users. Run everything below in
the Supabase SQL editor for this project.

## Step 1 — Pre-check (run this first, before applying anything)

This confirms current state and — more importantly — surfaces the actual
role names in the tenant so we can catch a naming mismatch **before** 244
goes live and silently locks out an Auditor/Tech Reviewer/CDC user whose
role name doesn't contain the expected substring.

```sql
-- 1a. Every role name currently in use, and how many users hold each
SELECT r.name AS role_name, r.tenant_id, count(su.id) AS user_count
FROM tenant.roles r
LEFT JOIN system.users su ON su.custom_role_id = r.id
GROUP BY r.name, r.tenant_id
ORDER BY r.tenant_id, r.name;

-- 1b. Sanity check: does every expected pattern match at least one role?
SELECT
  bool_or(lower(name) LIKE '%auditor%') AS has_auditor_role,
  bool_or(lower(name) LIKE '%tech%')    AS has_tech_role,
  bool_or(lower(name) LIKE '%cdc%')     AS has_cdc_role,
  bool_or(lower(name) LIKE '%crm%')     AS has_crm_role
FROM tenant.roles;

-- 1c. Confirm 244 genuinely isn't applied yet (should return 0 rows)
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'tenant' AND table_name = 'external_clients__a'
  AND column_name IN ('auditor_id__a','tech_reviewer_id__a');

-- 1d. Confirm no Team_Assigned picklist value yet (should return 0 rows)
SELECT tenant_id, value, label, display_order
FROM tenant.picklist_values WHERE value = 'Team_Assigned';
```

Also run the `start_file_upload` gate-check query in
[`rights_S3.md`](rights_S3.md) Q1 — it confirms whether 239 already landed
on its own before 244 (fixed) goes in.

**Send me the output of 1a and 1b before applying.** If `has_cdc_role` comes
back false, migration 243's gate will be inert (matches "Still open" item 2
in the doc) until a CDC role is created in Settings → User Management — worth
knowing before, not after, applying.

## Step 2 — Apply the three migrations

No interdependency between them, but apply in numeric order for a clean
audit trail. Each file is self-contained — open it and run its full contents
as-is in the SQL editor:

1. [`supabase/migrations/242_register_remaining_stage_notes_and_dates.sql`](../../supabase/migrations/242_register_remaining_stage_notes_and_dates.sql)
2. [`supabase/migrations/243_cdc_role_upload_gate.sql`](../../supabase/migrations/243_cdc_role_upload_gate.sql)
3. [`supabase/migrations/244_assign_stage_team.sql`](../../supabase/migrations/244_assign_stage_team.sql) —
   **fixed during this sprint, see [`rights_S3.md`](rights_S3.md) Q1**: this
   file originally redefined `start_file_upload` by copying migration 235's
   body, which predates 239's `clientAgreement__c` gate — applying it as
   originally written would have silently deleted that gate. Now carries
   239's gate forward, so **239 does not need to be applied separately.**

## Step 3 — Post-check

```sql
-- 3a. 244 columns landed
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'tenant' AND table_name = 'external_clients__a'
  AND column_name IN ('auditor_id__a','tech_reviewer_id__a');

-- 3b. Team_Assigned picklist value inserted for every tenant
SELECT tenant_id, value, label, display_order
FROM tenant.picklist_values WHERE value = 'Team_Assigned';

-- 3c. New RPCs exist
SELECT proname FROM pg_proc WHERE proname IN
  ('get_tenant_users_by_role_pattern', 'assign_stage_team');

-- 3d. 243's CDC gate landed in finalize_file_upload
SELECT prosrc ILIKE '%_is_cdc%' AS has_cdc_gate
FROM pg_proc WHERE proname = 'finalize_file_upload';

-- 3e. 242 registered fields (spot check two of the twelve — NOT
-- stage2_closure_notes, which 242 deliberately excludes as dead)
SELECT name FROM tenant.fields
WHERE name IN ('stage1_closure_notes', 'stage2_evidences_rejection_notes');
```

**Send me the output of 3a–3e** and I'll confirm the migrations landed clean
before you or anyone starts using the new Assign Team / CDC upload flows in
the app.

---

## Manual steps after this sprint (not SQL — do these in the app UI)

1. **Confirm the CDC custom role exists** (Settings → User Management) and is
   assigned to whoever actually handles CDC review. If 1b showed
   `has_cdc_role = false`, create it now — migration 243's gate is inert
   without a real user carrying a role name matching `%cdc%`.
2. **Confirm Auditor/Tech Reviewer role names** are correctly spelled/named —
   same reasoning, `get_tenant_users_by_role_pattern('auditor')` /
   `('tech')` only finds users whose `tenant.roles.name` contains those
   substrings (case-insensitive).
3. **Smoke-test the Assign Team flow** on one real (or test) record: CRM
   opens a record at `Client_Agreement_Signed`, uses the new Assign Team
   prompt in `StageAuditActionPanel.tsx`, picks an Auditor and Tech Reviewer
   from the live picklists, confirms status moves to `Team_Assigned`, and
   confirms the Stage 1 audit plan upload is blocked until that assignment
   exists.
4. **Smoke-test the CDC upload gate**: have a non-CDC user (CRM or Tech
   Reviewer) upload to `cdc_report` and confirm `status__a` does **not**
   advance to `CDC_Approved`; then have the CDC-role user upload and confirm
   it does.

Do not proceed to Sprint 2 until Step 3's queries confirm all three
migrations landed — Sprint 2's PS rules assume the CDC role and the new
columns/RPCs already exist.
