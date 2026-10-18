# Manual Supabase migration handoff

18 October 2026. All files listed below are saved in the repository's **`supabase/migrations`** folder. None has been applied to the live database by the assistant. Run complete files manually in Supabase SQL Editor in numeric order, one at a time, and check each result before the next.

The pre-existing migrations through 290 are prerequisites, not part of this new-file list. Do not rerun historical migrations blindly. The supplied live audit did not contain the new 291–297 import/guard functions/triggers; if you have applied any since that snapshot, reconcile that first instead of assuming the audit is current.

| Order | File | Purpose |
| --- | --- | --- |
| 1 | `291_fix_surveillance_summary_import.sql` | Atomic Surveillance summary import, correct physical field suffixes, exact-record preview and Summary Save compatibility |
| 2 | `292_surveillance_client_and_team_guards.sql` | Require linked client on new Surveillance, company naming, assigned-user RCA/upload/team checks and team visibility |
| 3 | `293_workflow_read_and_upload_fixes.sql` | Tenant/assignment/sharing record filtering and email-linked upload finalisation checks |
| 4 | `294_workflow_field_permissions.sql` | Field read/edit enforcement and protected generic workflow updates |
| 5 | `295_recert_summary_import.sql` | Atomic Recertification summary import with its own field/date/status mapping |
| 6 | `296_workflow_attachment_read_guards.sql` | Guard attachment reads/downloads/deletion and Storage access |
| 7 | `297_surveillance_ends_at_certificate.sql` | Certificate-issued Surveillance stays complete; pause the old mandatory post-certificate suspension chain and preserve history |
| 8 | `298_admin_bulk_summary.sql` | Sprint 11: admin bulk preview/apply, strict field allowlists, integrated-standard matching/splitting, audit/retry log and admin-only bulk source files |

291–297 belong to earlier local fixes in this conversation. **298 is the only new migration for Sprint 11.** If you already have copies of 291–297, use their current reviewed repository contents; the migration list does not require recreating older files. The local 293 upload finalisation helper includes the paused-field check that complements 297.

There is exactly one top-level file for each previously supplied number 291–298. Sprint 12 now adds the separate 299 listed below; 291–298 have not been renamed or changed by Sprint 12.

**Re-verification update:** use the current repository copy of **298_admin_bulk_summary.sql**, revised on 18 October 2026 for contact inheritance, whitespace-only company fallback and anonymous bulk-source protection. If you already ran an earlier copy of 298, rerun the complete updated file after its prerequisites. A local replay test verifies existing business records and import results are preserved. This does not repair previously imported data automatically. No additional migration number was introduced.

## Sprint 12 addition — execute after 291–298

| Order | File | Purpose |
| --- | --- | --- |
| 9 | `299_notification_outbox.sql` | Transactional workflow/invitation enqueue; private outbox, attempt/event/response audits; tenant-scoped history and acknowledgement RPCs; service-only leases/retries/webhook persistence; auditable intimation responses |

**Sprint 12 execution order was 291, 292, 293, 294, 295, 296, 297, current revised 298, then 299.** 291–298 were supplied previously; 299 is the only Sprint 12 addition. Sprint 13 now adds 300 below. No migration has been applied live by the assistant. Migration 299 is replay-tested locally; it does not backfill mail or start deadlines. See the [VPS/Resend runbook](Sprint_12_VPS_Email_Runbook.md) and [read-only schema checks](Sprint_12_Email_Readiness_Audit.sql). Earlier revised-298 instructions still apply.

## Sprint 13 addition — evidence holds only

This section describes the initial 300 foundation. The user's follow-up timing decisions now add **301** below; both files are required for the current code.

After the earlier supplied **291–299**, run the complete `supabase/migrations/300_nonresponse_policy_hold.sql` only through the normal reviewed manual release. **300 is the only Sprint 13 addition.** Full list is now **291, 292, 293, 294, 295, 296, 297, current revised 298, 299, 300**; prerequisites through 290 remain as before. No older migration was renamed or changed by Sprint 13.

300 adds tenant-bound Surveillance intimation evidence cases/audit, a checked history RPC and service-only evidence review. It keeps deadlines NULL and automation false, creates no historical backfill/mail, and leaves 297/299 safeguards in place. It does **not** implement enabled second notices or suspension. See [Sprint 13 policy gaps and deployment/manual QA handoff](Sprint_13_Local_Handoff.md) and [read-only readiness SQL](Sprint_13_Readiness_Audit.sql). No live migration/deployment/scheduling/email was performed.

## Sprint 13 continuation — approved upload timing

Apply **`301_nonresponse_upload_deadlines.sql` after 300**, using the complete reviewed repository file. Full current order is **291, 292, 293, 294, 295, 296, 297, current revised 298, 299, 300, 301**. Earlier supplied prerequisites are 291–299; Sprint 13 additions are **300 and 301**. No previous file was renamed/edited by this continuation. No file was applied live by the assistant.

301 implements original upload +30 IST days, one transactional second reminder, then +10 IST days from reminder creation and linked External Client `Suspended` status. Provider outcomes and replacements do not change windows. It preserves 297's old-chain/certificate safeguards, holds Reject for BA, records late responses for CRM without restoring, and creates a blocked final-letter job pending the actual shared template. Historical cases/imports are not silently promoted/enrolled. Scheduling stays disabled unless the separate server-only `NONRESPONSE_AUTOMATION_ENABLED` flag is explicitly enabled during a later approved release.

Do not rerun 300 alone after 301: it contains the initial function definitions. Reconcile live application history first, then apply in order. Complete configuration, artifact and multi-session QA gaps are in [the current Sprint 13 handoff](Sprint_13_Local_Handoff.md).

## Sprint 13 DOCX continuation

After the user confirmed DOCX, added **`302_shared_suspension_docx.sql`**. Full current order: **291, 292, 293, 294, 295, 296, 297, revised 298, 299, 300, 301, 302**. Previously supplied prerequisites are **291–299**; Sprint 13 additions are **300, 301, 302**. No old migration was renamed/edited by the DOCX continuation. None was applied live by the assistant.

302 supplies a private Storage bucket and tenant/version/hash-bound template registration (inactive by default), explicit activation, one-item blocked-letter release, pinned template lookup and final-letter eligibility/payload checks. The actual file is still absent; nothing was registered/activated/sent. Existing outbox retries/leases/idempotency are reused. Source templates are preserved and generated DOCX attachments are persisted privately. Do not rerun 300/301 alone after 302; replay through 302 in numeric order. See [the DOCX preparation and release handoff](Sprint_13_Local_Handoff.md).

## Sprint 13 PDF delivery continuation

The user clarified **store/edit DOCX, send PDF**. Apply **`303_suspension_pdf_delivery.sql` after 302**. Complete current order: **291, 292, 293, 294, 295, 296, 297, revised 298, 299, 300, 301, 302, 303**. Earlier supplied prerequisites are **291–299**; Sprint 13 additions are **300–303**. No earlier file was changed by this continuation and no SQL was applied live.

303 adds a PDF-only suspension payload gate while preserving 302's eligibility checks and lock order. The worker personalises a temporary DOCX, converts it locally with LibreOffice and persists/sends only PDF. Earlier immutable DOCX payloads go to review without rewriting bytes or provider submission history. Registration/activation/source Storage remain DOCX; this migration never converts or backfills historical jobs. Replay through 303 in order; do not restore older 300/301/302 definitions alone. See [renderer prerequisites, errors and real-template QA](Sprint_13_Local_Handoff.md).

Deploy the matching code after manual database application, initially with sending disabled. Enabling the worker later can send queued records, so inspect the queue and use only approved test recipients before any authorised production release. Existing workflow sent-date columns remain upload/status milestones; new outbox events carry delivery evidence.

## Release notes

- Apply the database prerequisites before using/deploying the matching frontend. Deploying source code does not execute these SQL files.
- Bulk upload requires the existing `tenant-uploads` bucket to be private. The bulk preview rejects a missing/public bucket; this sprint does not silently change its privacy setting.
- Migration 298 builds on 291/295 and preserves the existing single-record Summary APIs. It does not enqueue mail, schedule timers or implement automatic suspension.
- Migration 297 continues to hold the old linear chain. Sprint 13's 300 adds policy-held evidence only; enabling the 30-day plus 10-day transitions will require confirmed rules and a reviewed follow-up migration. Do not omit 297 merely to reactivate the old, different behaviour.
- Back up/review the database before applying these access-control changes. After application, use disposable test records to verify admin bulk imports and denied non-admin calls; no real customer mail is needed for bulk QA.

## Local validation

Bulk tests use isolated PGlite PostgreSQL tables, actual summary trigger/upsert bodies and the new import/guard migrations. Existing QA tests cover the previous rights/import changes. Final check results are recorded in [the work log](Summary_Upload_Work_Log.md) and [Sprint 11](../Renewal/Sprints/Sprint_11_Bulk_Summary_Upload.md), separate from live verification.
