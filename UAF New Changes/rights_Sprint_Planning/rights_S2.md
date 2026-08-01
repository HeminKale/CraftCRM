# Sprint 2 — Permission Set Configuration

## Status: Ready to execute — no blockers left

Sprint 1 is applied and the CDC role exists, so all three items below are
unblocked. Item 3 was conditional on your Sprint 3 answer — you said yes, so
it's no longer conditional either. All three can be configured in the same
Settings session, in any order.

Everything here is Settings UI work, not code and not SQL — RPCs in this app
have zero Permission Set awareness (confirmed uniformly across the codebase,
see `RPC for file fields.md`), so field-visibility rules can only be
expressed through PS, never through a migration. Do this after Sprint 1's
migrations are confirmed applied (item 3 below depends on the CDC role
existing).

## 1. `stage1_ncr` — hide from Client entirely (row 9)

- **Client / External Client role:** `can_read = false`
- Everyone else: unchanged

Already flagged in the doc as something you're doing manually — listed here
so this sprint doc is a complete checklist, not because it's new.

## 2. `cdc_report` — CRM view-only, everyone else hidden (row 24)

- **CRM Office:** `can_edit = false`, `can_read = true` (view only)
- **Auditor / Tech Reviewer / External Client:** `can_read = false`
- **CDC role:** leave unrestricted (default deny-list access already gives it
  full read/edit)

Also already flagged in the doc — included for completeness.

## 3. `stage1_tech_findings_file` / `stage2_tech_findings_file` — Tech-Reviewer-only upload (rows 14, 23)

**New recommendation, not yet in the doc's PS checklist.** The doc lists this
as an open "design gap" (item 4) needing a decision between PS and RPC. Per
the standing preference — PS whenever it can express the rule — it can:
this is the exact same shape as item 2 above (one role edits, others view),
already solved by PS for `cdc_report`. No RPC hard block needed; this
mirrors 243's choice to keep the CDC gate soft (PS closes the everyday UI
path, a hard block only guards against someone calling the RPC directly,
which wasn't asked for here either).

Recommended config, both fields:
- **Tech Reviewer:** leave unrestricted (`can_read = true`, `can_edit = true`)
- **CRM Office / Auditor:** `can_edit = false`, `can_read = true` (view only,
  matches image's "CRM/Auditor view")
- **External Client:** `can_read = false` (image gives Client no role at all
  on this row)

**Confirmed 2026-08-01 (Sprint 3, Q3) — approved, no longer conditional.**
Go ahead and configure this alongside items 1 and 2.

---

## Manual steps — do these now in Settings → Permission Sets

For each of the 4 fields below, this app's PS model is deny-list (unrestricted
by default), so you're only setting explicit restrictions, not opening
anything up:

| Field | Role | `can_read` | `can_edit` |
|---|---|---|---|
| `stage1_ncr` | Client / External Client | `false` | — |
| `cdc_report` | CRM Office | `true` | `false` |
| `cdc_report` | Auditor / Tech Reviewer / External Client | `false` | — |
| `cdc_report` | CDC | leave unrestricted (default) | leave unrestricted |
| `stage1_tech_findings_file` | Tech Reviewer | leave unrestricted | leave unrestricted |
| `stage1_tech_findings_file` | CRM Office / Auditor | `true` | `false` |
| `stage1_tech_findings_file` | External Client | `false` | — |
| `stage2_tech_findings_file` | *(same 3 rows as `stage1_tech_findings_file` above)* | | |

Steps:
1. Configure all rows above in Settings → Permission Sets (any order).
2. Spot-check with one real login per role (Client, CRM, Auditor, Tech
   Reviewer, CDC) on a record that has data in these fields — confirm each
   role sees/edits exactly what the table above says. PS changes take effect
   immediately, no deploy or migration needed.
3. Tell me once done and I'll mark this sprint's rows in
   `S6_rights_matrix_verification.md` (9, 14, 23, 24) as fully resolved
   rather than "pending PS config."

## Correction — found, fixed, and verified 2026-08-01

Ran the config, but checking the actual DB against this table surfaced two
bugs: several `permission_set_entries` rows were wrong or missing (fixed
Auditor's incorrect block on `cdc_report`/`stage1_ncr`, added the missing
CRM Office/Tech reviewer/External Customer rows), and — more importantly —
`auditor@craftcrm.test` and `tech@craftcrm.test` had zero rows in
`tenant.user_permission_sets`, meaning they currently bypassed every
restriction entirely (confirmed via `_check_permission`'s "no sets → full
access" fallback). Root cause and general fix now documented in
`New Help Doc/permission-sets.md` under "Role → Permission Set
auto-assignment (and a real gotcha)".

Fix applied as
[`supabase/migrations/245_fix_stage_rights_permission_sets.sql`](../../supabase/migrations/245_fix_stage_rights_permission_sets.sql)
(promoted from a one-off script into the numbered migration series by the
stakeholder) — **re-verified against the live DB, all 11 expected rows now
correct, both affected users now show their Permission Set attached.**

**Still open:** no user currently holds the CDC role at all (last check had
zero rows with `role_name = 'CDC'`) — the CDC upload gate (243) remains
functionally untestable until someone is actually assigned that role. Not
blocking anything else in this plan.

## Sprint 2 outcome

- [x] `stage1_ncr` Client `can_read=false` configured (verified)
- [x] `cdc_report` PS rows configured (verified, after 245's fix)
- [x] `stage1_tech_findings_file` / `stage2_tech_findings_file` PS rows
      configured (verified, after 245's fix)
- [x] User-level Permission Set attachment gap fixed for
      `auditor@craftcrm.test` / `tech@craftcrm.test` (245)
- [ ] Spot-check per-role visibility in the actual app UI (not yet reported)
- [ ] Assign a real user to the CDC role (separate, non-blocking)
