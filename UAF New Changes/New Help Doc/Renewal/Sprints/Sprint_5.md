# Surveillance 1 (Renewal) — Sprint 5: Permission Set Configuration

**Updated: now SQL, not a manual Settings walkthrough.** You asked "can we not do
PS using SQL" — yes, and it's safer than it first looked, once the live table was
confirmed (see below).

## What almost went wrong

Your `SELECT * FROM tenant.permission_set_fields` query returned rows shaped like
the *newer* generic permission schema (`permission_set_id`, `resource_type`,
`resource_id`...), but migration `001`'s original `permission_set_fields` table has
a completely different, older shape (`perm_set_id`, `field_id`). The live DB has
drifted from the migrations folder. Writing SQL against the wrong table would have
silently done nothing — the Permission Set screen would show no change and the
gates just wouldn't apply, with no error anywhere. Confirmed the real one by pulling
the actual live body of `get_my_effective_permissions()` (the RPC the frontend
calls at login) via `pg_get_functiondef()` — it joins **`tenant.permission_set_entries`**,
not `permission_set_fields`. That's what migration 263 writes to.

## Migration: `263_surv_permission_set_entries.sql`

Writes 12 field-level rules directly into `tenant.permission_set_entries`, matched
by tenant + Permission Set name + field name (not hardcoded UUIDs — safe to re-run,
and self-skips with a `RAISE NOTICE` if a name doesn't match anything in your
tenant, rather than erroring).

| Field | Denied role(s) | Note |
|---|---|---|
| `surveillance_intimation_letter` | Auditor, Tech reviewer, CDC | — |
| `surv_ncr` | Tech reviewer | **Corrected** — original plan draft wrongly said Client here; the actual blank cell in your matrix is Tech Reviewer |
| `surv_tech_findings_notes` | External Customer (Client) | — |
| `surv_tech_findings_file` | External Customer (Client) | — |
| `cdc_report` | External Customer, Auditor, Tech reviewer | full deny |
| `cdc_report` | CRM Office | **edit only** — stays view-only, defense-in-depth alongside migration 261's RPC hard block |
| `surveillance_certificates` | Auditor, Tech reviewer | — |

**One assumption, not confirmed by you directly:** "External Customer" is treated
as the Client role's Permission Set. Your tenant only has 6 Permission Sets total
(Hero, External Customer, CRM Office, Auditor, Tech reviewer, CDC) and no separate
"Renewal Client" one, so this is the only candidate — but say so if it's wrong;
it's a one-line fix in the migration.

## What's still manual (can't be SQL)

1. **Confirm the CDC custom role exists** and is assigned to a real user (Settings
   → User Management → Roles). The RPC gates in migrations 260/261 are inert
   without someone actually holding a role name matching `%cdc%` — this is a
   role-assignment decision, not a permission rule, so there's no safe SQL default
   to write on your behalf.
2. **Spot-check the `status__a` dropdown** on a real Renewal Clients record in edit
   mode — confirm all 13 Surveillance 1 statuses plus the 3 legacy ones appear,
   correctly labeled. This is just eyeballing that migrations 257/258/260's
   picklist inserts actually rendered correctly in the UI — not a config step.

Everything else from the original manual walkthrough (Settings → Permission Sets →
click through each role → find each field → toggle checkboxes) is now handled by
migration 263 instead.
