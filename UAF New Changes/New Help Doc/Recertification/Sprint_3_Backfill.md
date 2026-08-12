# Recertification — Sprint 3 Backfill (migration 276)

Not a new sprint — a repair. Filed alongside [`Sprint_3.md`](Sprint_3.md), which
documents what `267_recertification_ncr_rca_evidences.sql` was *supposed* to ship.
This doc covers what actually landed live, what didn't, why, and the fix.

---

## What was found

Verifying migration 269's permission-set entries against the live DB (2026-08-12),
one expected row was missing: `recert_ncr` / Tech reviewer. Diagnosing further:

- `SELECT ... FROM tenant.fields WHERE name = 'recert_ncr'` → **0 rows.**
- Checked all 10 field names 267 registers → **all 10 missing**, not a partial set.
- Checked all 10 physical columns 267's `ALTER TABLE` adds → **confirmed missing**
  (not yet re-verified live at time of writing this doc, but zero-of-ten on the
  metadata side plus 267's single-transaction shape makes a full-file rollback the
  only explanation that fits — see reasoning below).

## Root cause

267 was pasted/run as one multi-statement script. Postgres treats a whole batch of
semicolon-separated statements submitted together as **one implicit transaction**
unless it contains explicit `BEGIN`/`COMMIT`. If *anything* later in that same paste
failed — most likely a transcription slip somewhere in the ~500-line reproduced
`start_file_upload`/`finalize_file_upload` bodies, the exact risk this epic's own
"hard-won lesson" flags — everything earlier in the same batch rolls back too: the
`ALTER TABLE` columns, both field/status DO blocks, and the two
`review_recert_ncr_rca`/`review_recert_evidences` RPCs.

Zero-of-ten landing (not some-of-ten) is the tell — a row-level issue would leave a
partial set; a whole-transaction rollback leaves nothing.

## Why 268 wasn't also affected

Checked [`Sprint_4.md`](Sprint_4.md)'s own "verified against source" section: it
says 268's `start_file_upload`/`finalize_file_upload` bodies were built by
`sed`-extracting 267's bodies **out of the migration file on disk**, not by querying
the live database. So 268's copies of those two functions already contain Sprint 3's
gates as code, independent of whether 267 itself ever committed — and 268's own field
registrations (`recert_cdc_report`, `recert_certificates`) were confirmed present via
the same 269 diagnostic, proving 268's whole file *did* commit successfully.

**Practical effect before this backfill:** file uploads and reviews for the NCR / RCA
/ Evidences round were completely non-functional — the fields didn't exist for the
frontend to offer, and `review_recert_ncr_rca`/`review_recert_evidences` didn't exist
to call. Every other checkpoint (Sprints 0, 1, 2, 4) was unaffected.

## The fix — `276_recert_sprint3_backfill.sql`

Copies 267's `ALTER TABLE`, both DO blocks, and both RPCs **verbatim** — all
idempotent techniques (`ADD COLUMN IF NOT EXISTS`, `INSERT ... ON CONFLICT DO
NOTHING`, `EXISTS`-checked picklist upsert, `DROP FUNCTION IF EXISTS` + `CREATE`),
safe to run regardless of current partial state.

**Deliberately excludes `start_file_upload`/`finalize_file_upload`.** Re-running
267's copies of those two functions here would be a **regression** — 267's versions
only go up through Sprint 3, missing Sprint 4's gates that 268 already added live and
that are confirmed working right now. Left untouched on purpose.

## Manual steps

1. Run `276_recert_sprint3_backfill.sql`.
2. Re-verify: the four diagnostics from this session (physical columns, RPC
   existence, `pg_get_functiondef` containing Sprint 3 markers, picklist values) —
   all four should now come back populated/true.
3. Re-run `269_recertification_permission_set_entries.sql` (also fully idempotent) —
   it will now find `recert_ncr` and add the one row it skipped last time. No need
   for the earlier one-off manual patch.
4. Smoke test: as CRM/Auditor, upload an NCR file on a test record at the
   `Recert_Plan_Accepted` checkpoint; confirm status advances to `Recert_NCR_Sent`
   and the file appears. As the linked client, upload an RCA response; confirm
   `Recert_NCR_RCA_Uploaded`. As the *specifically assigned* auditor, call accept/
   reject on the RCA and then on evidences; confirm both RPCs now resolve instead of
   erroring "function does not exist."

## Lesson for the rest of this epic

Confirming a migration "ran without error" isn't the same as confirming *everything
in it* landed — a large multi-statement file can partially execute and roll back as
one unit with no visible partial-success signal beyond what a later, unrelated
verification (269's diagnostic here) happens to catch. Worth spot-checking each
already-"run" migration's actual field/column footprint at least once, not just
trusting "I ran it" + no error message shown to the user at the time.
