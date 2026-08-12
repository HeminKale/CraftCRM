# Recertification — Sprint 6: What Shipped

Covers **Sprint 6** (Permission Set Entries, SQL) from
[`00_Sprint_Plan.md`](00_Sprint_Plan.md).

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) →
> [`Sprint_0_1.md`](Sprint_0_1.md) → [`Sprint_2.md`](Sprint_2.md) →
> [`Sprint_3.md`](Sprint_3.md) → [`Sprint_4.md`](Sprint_4.md) →
> [`Sprint_5.md`](Sprint_5.md) → **this doc**.

**Confirmed before starting:** read `263_surv_permission_set_entries.sql`
(Surveillance 1's equivalent) in full before writing anything, to copy both its
*technique* (direct `INSERT ... ON CONFLICT`, not the `upsert_permission_entry`
RPC) and — more importantly — its *scope discipline* (which rows get PS entries
and which don't). That second part required re-deriving the deny list from
scratch rather than trusting the earlier draft sitting in `00_Sprint_Plan.md`'s
Sprint 6 section — see "Correction made while writing this" below.

---

## Migration: [`269_recertification_permission_set_entries.sql`](../../../supabase/migrations/269_recertification_permission_set_entries.sql)

Same technique as 263: resolve each Permission Set by tenant + exact name
(`CRM Office`, `Auditor`, `Tech reviewer`, `CDC`, `External Customer`), resolve
each field by object + name, direct `INSERT` into `tenant.permission_set_entries`
with `ON CONFLICT ... DO UPDATE`. Not `public.upsert_permission_entry` — that RPC
requires `auth.uid()` to resolve to an admin, which is `NULL` in a migration
context. Safe to re-run; a tenant missing one of the five Permission Sets gets a
silent skip-with-`RAISE NOTICE` for that row, not a failed migration.

**18 entries across 10 fields:**

| Field | Denied for | Notes |
|---|---|---|
| `recert_intimation_letter` | Auditor, Tech reviewer | CDC stays **view** — this epic's matrix differs from Surveillance 1's own intimation row, which also denies CDC. Not copied forward. |
| `recert_application_form` | Auditor, Tech reviewer | |
| `recert_quotation` | Auditor, Tech reviewer | |
| `recert_agreement` | Auditor, Tech reviewer | |
| `recert_audit_plan` | Tech reviewer only | Auditor uploads this field, stays visible to them |
| `recert_ncr` | Tech reviewer only | Matches `surv_ncr`'s precedent exactly |
| `recert_tech_findings_notes` | External Customer (Client) | Matches `surv_tech_findings_notes` exactly |
| `recert_tech_findings_file` | External Customer (Client) | Matches `surv_tech_findings_file` exactly |
| `recert_cdc_report` | External Customer, Auditor, Tech reviewer | + CRM gets an explicit `can_read=true, can_edit=false` (view-only) entry — matches `cdc_report`'s exact 4-row pattern |
| `recert_certificates` | Auditor, Tech reviewer | Matches `surveillance_certificates` exactly |

---

## Correction made while writing this — the earlier draft was wrong in scope, not just in two rows

`00_Sprint_Plan.md`'s Sprint 6 section already had a "reconciled against the
matrix" deny-list draft from an earlier session (which itself had corrected two
wrong rows from an even earlier, undated preview). Re-deriving from source this
session found that draft was **still too broad** — it included several rows that
don't belong in a PS-entries migration at all, for reasons the earlier draft
didn't work through:

1. **`auditor_id__a`/`tech_reviewer_id__a` (assign-team row), listed as "deny
   Client"** — these columns aren't registered in `tenant.fields` at all
   (deliberate Sprint 2 decision, so a bad direct RPC call can't set an
   arbitrary user id via generic field-edit access). There is nothing for a PS
   entry to target. Dropped.
2. **`recert_plan_client_remarks__a`, listed as "deny CRM, Auditor, Tech
   reviewer"** — this is backwards. CRM and Auditor need to *read* this field:
   it's the client's rejection reason, and `RecertificationActionPanel.tsx`
   displays it directly (from `recordData`, not through `can()`) to drive its
   own "Revise Audit Plan" prompt. Denying PS read here wouldn't even hide it
   from that panel — `project_rpc_vs_permission_sets_craftcrm`'s point 1 is
   explicit that workflow-action panels bypass Permission Sets entirely — it
   would just create an inconsistent gap between the ActionPanel and the
   generic Page Layout renderer. Surveillance 1's 263 never restricted
   `surv_plan_client_remarks__a` either — zero precedent for hiding
   reject-reason fields. Dropped.
3. **`recert_rca_rejection_notes__a`, listed as "deny Client"** — same
   reasoning in reverse: the client needs to see *why* their RCA was rejected
   to revise it. `showRcaUploadPrompt` in the Action Panel displays this
   directly. `surv_rca_rejection_notes__a` got zero PS entries in 263 either.
   Dropped.
4. **`recert_ncr_rca` and `recert_evidences`**, both correctly already dropped
   from the deny list two sessions ago (the "Tech reviewer" denial on both was
   the original wrong-row correction) — reconfirmed this session: neither field
   has *any* blank cell in the matrix (every role has at least "view"). No entry
   at all, not even a partial one.
5. **Rows 3, 6, 9, 12, and the "close" half of row 15** (Application acceptance,
   Signed client agreement, Recert plan accept, NCR+RCA acceptance, Tech
   findings close) have no distinct content field for a blank cell to mean
   anything — the blank cells there mean "no accept/close button for this
   role," which is already enforced by each RPC's own role check
   (`review_recert_application`, `review_recert_agreement`, `review_recert_plan`,
   `review_recert_ncr_rca`, `close_recert_audit` — none has a wrong-role
   bypass). Surveillance 1's 263 set this exact precedent: zero PS entries
   exist for its own equivalent accept-only rows even though some of those
   rows also have blank cells for some roles.

Net effect: the migration actually written is **narrower** than the plan doc's
own draft, not broader — every dropped row was dropped because including it
would have been either a no-op (unregistered field) or actively wrong (hiding a
field CRM/Auditor/the client need to read to do their job). `00_Sprint_Plan.md`'s
Sprint 6 deny-list table has been updated to match what actually shipped.

---

## Verified against source before writing

- Read `263_surv_permission_set_entries.sql` in full — copied its exact SQL
  shape (upsert technique, `RAISE NOTICE`-and-skip resilience, comment style)
  and, more importantly, extracted its *scope discipline* by checking which
  Surveillance 1 rows got entries and which didn't, then applied the same
  discipline to Recertification's own matrix rather than transcribing the
  matrix's blank cells literally.
- Re-confirmed all 10 target field names against the actual `INSERT INTO
  tenant.fields` lines in migrations 264/265/266/267/268 (grepped directly,
  not retyped from the plan doc's field-reference table).
- Checked `project_rpc_vs_permission_sets_craftcrm` memory before deciding to
  drop the three remarks/notes-field entries — confirmed action panels bypass
  Permission Sets entirely, which is what made denying those fields actively
  wrong rather than merely redundant.
- Confirmed `269` doesn't collide with any existing migration filename.
- Confirmed `DO $$ ... END $$;` balance and counted 18 `VALUES` rows against
  the intended 10-field/18-row total before finalizing.

## Not done in this sprint (by design)

- Confirming CDC/Auditor/Tech reviewer roles exist and are assigned to real
  users — not new work, should already be true from Surveillance 1's rollout,
  but **the CDC role specifically is a known open blocker** (invite-user flow
  needs fixing before a CDC user can be created — see `00_Sprint_Plan.md`'s
  status header). This migration's `recert_cdc_report` entries are correct and
  ready regardless; they just can't be live-tested for the CDC role until that
  blocker clears.
- QA / live walkthrough with real logins — **Sprint 7**, the last sprint in
  this plan.

---

## Next

**Sprint 7** (QA) is next — the last sprint in the plan. Full chain walk with 5
real logins (CRM, Auditor, Tech Reviewer, CDC, External Client), confirming none
of Sprints 0-6 touched External Client's or Surveillance 1's tables, RPCs, or
components (the cross-epic safety checklist has been applied at every sprint
along the way, not deferred to this final check), and a closing "what shipped"
doc for the whole epic.
