# Surveillance 1 (Renewal) — Sprint 2: What Shipped

Covers **Sprint 2** (NCR + RCA + RCA Acceptance backend) from
[`00_Sprint_Plan.md`](00_Sprint_Plan.md).

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) (the plan) →
> [`Sprint_0_1.md`](Sprint_0_1.md) (Sprints 0-1) → **this doc**.

**Confirmed before starting:** migrations 256 and 257 have been run as-is against the
live database (per your message). This migration was written against 257's actual
`finalize_file_upload` body (reproduced verbatim below the new blocks), not a stale
copy — checked no file between 257 and this one touches that function.

---

## Migration: `258_surv_ncr_rca.sql`

**Part A/B — New columns + field registration:**

| Column | Type | Registered? |
|---|---|---|
| `surv_ncr__a` | JSONB (file) | Yes — `surv_ncr` |
| `surv_ncr_sent_date__a` | DATE | Yes |
| `surv_ncr_rca__a` | JSONB (file) | Yes — `surv_ncr_rca` |
| `surv_ncr_rca_uploaded_date__a` | DATE | Yes |
| `surv_auditor_accepted_date__a` | DATE | Yes |
| `surv_rca_rejection_notes__a` | TEXT | Yes |

**Part C — `status__a` picklist**: added `Surv_NCR_Sent` (6), `Surv_NCR_RCA_Uploaded`
(7), `Surv_Auditor_Accepted` (8) — sits below the legacy values (90/91/99) registered
in 257, no display-order collision.

**Part D — `review_surv_ncr_rca(p_record_id, p_action, p_notes)` (new RPC):**
`accept` → `Surv_Auditor_Accepted` + stamp `surv_auditor_accepted_date__a` + clear
`surv_rca_rejection_notes__a`. `reject` → stays `Surv_NCR_Sent` + stores `p_notes` in
`surv_rca_rejection_notes__a`.

**Part E — `finalize_file_upload` redefined**, adding:
- `surv_ncr` upload — CRM/Auditor/admin soft gate → `Surv_NCR_Sent` + stamps
  `surv_ncr_sent_date__a`.
- `surv_ncr_rca` upload — **linked client or admin only** (no CRM/Auditor branch at
  all, matching External Client's `stage1_ncr_rca` gate exactly) → `Surv_NCR_RCA_Uploaded`
  + stamps `surv_ncr_rca_uploaded_date__a` + clears `surv_rca_rejection_notes__a` on
  every (re-)upload, not just on accept.

---

## Two decisions made beyond a literal reading of the plan doc

Both are additions in the direction of tighter/more consistent gating, not scope
changes — flagging both so you can push back before Sprint 4 wires up the UI around
them.

**1. `review_surv_ncr_rca` is gated to the *specific* assigned auditor, not any
Auditor-role holder.** The plan doc said "Auditor/admin only" without spelling out
assignment-specificity. But Sprint 1 already built `assign_surv_team` +
`auditor_id__a` specifically so a particular person is on the hook for a particular
record — if accept/reject stayed open to *any* Auditor, that assignment would do
nothing here. Mirrors what migration 244 retrofitted onto External Client's
equivalent gate; built in from the start here instead. **No CRM bypass** either way —
that part matches the plan doc's explicit "deliberately not widened to CRM" note.

**2. `surv_ncr_rca` upload clears `surv_rca_rejection_notes__a` on every upload, not
just on accept.** The plan's field-reference table didn't call this out explicitly,
but it's the same remarks-clearing shape Sprint 1 already applied to the plan round
(upload → accept/reject-with-notes → re-upload) — applying it here for consistency
rather than leaving a stale rejection reason visible after the client's revised RCA
lands.

If either of these is wrong for how your team actually wants this to work (e.g., you
want CRM able to reassign/cover for an absent auditor on RCA review), it's a small,
isolated fix in this one migration — say so and I'll redo Part D.

---

## Verified against source before writing

- Read `257_surv_team_assignment_and_plan_round.sql` in full and reproduced its
  `finalize_file_upload` body exactly (not from memory/summary) before adding the two
  new blocks — confirmed the DECLAREd `_is_crm_or_auditor` etc. variables and existing
  External Client blocks are untouched.
- Confirmed `258` doesn't collide with any existing migration filename.
- `review_surv_ncr_rca` follows `review_stage1_ncr_rca`'s exact shape (accept/reject
  branches, RETURN QUERY messages) with only the CRM-bypass line removed, per the
  SURV1 rights matrix.

## Not done in this sprint (by design)

- Frontend (`RenewalActionPanel.tsx` NCR upload/RCA review prompts) — **Sprint 4**.
- Permission Set change hiding `surv_ncr` from the Client role entirely — **Sprint 5**
  (this sprint only gates the *upload/accept* RPCs; visibility is a separate layer,
  per this app's two-layer access model).
- No live DB execution this session — migration file only, same as 256/257 before you
  ran them.

---

## Next

**Sprint 3** (Audit Report, Tech Review, Checklist, CDC, Certificate Issue) is next —
same "backend can run ahead of Sprint 4's UI" pattern. Say the word and I'll continue.
