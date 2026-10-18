# Sprint 13 local handoff

18 October 2026. **The no-response deadline/reminder/suspension path and shared DOCX personalisation with outgoing PDF support are implemented locally.** Scheduling and sending remain disabled by default and were not enabled. The actual DOCX artifact, real renderer/layout review and BA's Reject decision remain pending. No live migrations, emails, deployment or scheduling occurred. No later sprint is authorised.

## Confirmed policy

The user's follow-up resolves the earlier timing holds: use the **original intimation upload finalisation timestamp**, ignore provider outcomes for timing, preserve windows through replacement letters/email corrections, and use 30 then 10 calendar days at the same IST clock time. The further window starts when the second notice is created transactionally in the outbox. A late scheduler run grants the full further 10 days from that creation time; it does not immediately suspend an old upload. This issuance timestamp is explicit in the UI and audit.

Accept stops the process. Reject is **held for BA**: the user proposed sending a suspension letter directly but explicitly said to wait for confirmation. No immediate Reject letter/suspension is implemented. Late responses are recorded for CRM without advancing the workflow or restoring the External Client. Existing manual/historical suspension or changed/missing linked clients route to CRM review without overwriting their status.

The user confirmed **DOCX storage, personalisation, then PDF when sending**. The shared suspension letter is uploaded once in private Supabase Storage and personalised per company without changing that source. Only its converted PDF is attached to suspension emails. No actual file has been supplied or activated. Day 30 currently creates a software reminder with the original intimation attached; whether it should use the same letter is still unanswered. Final suspension creates a **blocked** letter job (`suspension_template_pending`) until an operator explicitly activates a validated shared DOCX. Do not enable live scheduling before reviewing the real letter/content/layout and this release gap.

## Complete migration execution list

Earlier supplied prerequisites (current repository copies), in order:

1. `291_fix_surveillance_summary_import.sql`
2. `292_surveillance_client_and_team_guards.sql`
3. `293_workflow_read_and_upload_fixes.sql`
4. `294_workflow_field_permissions.sql`
5. `295_recert_summary_import.sql`
6. `296_workflow_attachment_read_guards.sql`
7. `297_surveillance_ends_at_certificate.sql`
8. **Current revised** `298_admin_bulk_summary.sql`
9. `299_notification_outbox.sql` (Sprint 12)

Sprint 13 additions:

10. `300_nonresponse_policy_hold.sql` (initial evidence foundation)
11. `301_nonresponse_upload_deadlines.sql` (approved timing continuation)
12. `302_shared_suspension_docx.sql` (shared private/versioned DOCX support)
13. `303_suspension_pdf_delivery.sql` (PDF-only suspension payload guard)

All files are in `supabase/migrations`. No earlier migration was renamed or edited. Prerequisites through 290 remain. Reconcile actual live application state and any earlier 298 copy first; source builds do not apply SQL. Execute complete reviewed files in numeric order. Do not rerun 300/301/302 alone after 303: their earlier function definitions predate the latest wrappers. Replay in numeric order through 303. Local replay coverage checks this sequence and preserves existing cases/payloads.

No historical backfill occurs. Existing 300 cases stay held, including on replacement; new cases after 301 receive approved timing. Imported dates are not silently enrolled. [Read-only readiness SQL](Sprint_13_Readiness_Audit.sql) checks metadata, functions, grants and guards; post-301 aggregate queries are commented separately.

## Implemented behaviour

New Surveillance 1 intimation finalisation creates one tenant/workflow case with its round-1 outbox entry transactionally. Attachment-start/historical workflow dates do not start timing. Source/start/first deadline stay fixed through replacements. Missing/invalid email is ignored for automated action; correction does not reset dates. New notices use the current stored recipient. A recipient change after queueing blocks that notice for operator review instead of sending to the wrong address or redirecting a submitted payload.

At the first deadline, `process_nonresponse()` locks workflow/case and rechecks software response, checkpoint and linked entity. It atomically creates one logical round-2 reminder and the further deadline. The existing outbox supplies canonical source attachments, fenced leases, immutable payloads, stable provider idempotency and signed event evidence. Failure/bounce/delay/suppression does not pause either window. The further deadline is ten IST days after reminder creation, independently of delivery.

At the further deadline, it rechecks again and atomically sets only the linked External Client's `status__a` to **`Suspended`**, saves its previous status privately, sets the non-response suspension marker and creates one blocked suspension-letter job (round 3, distinct kind). Surveillance checkpoint and audit/certificate history remain intact. Manual/suspension/withdrawal history is not reclassified. The External Client Suspended picklist option is registered without changing field type/layout or granting generic restoration. Database guards prevent generic edits/imports/other workflow updates from clearing automatic suspension or fabricating its marker. No login ban or restoration permission is invented.

Private evidence snapshots and a transition journal record source, policy, dates, response actor/action, worker, outcome, prior client status and letter result. Unchanged evidence reviews are deduplicated. The original snapshot table retains its legacy `policy_hold` outcome column; its JSON contains current stage, and the transition journal records actual business transitions.

The record panel shows actual upload/deadline/notice/suspension dates in IST and separates delivery from software response. Suspended External Clients have a record tag; visible status columns in generic lists render a Suspended badge. Recertification, a future Surveillance 2 model, restoration and the old mandatory post-certificate chain remain outside this implementation. Migration 297 stays installed.

## Concurrency and recovery

Business writers lock workflow, then case, then required client/outbox rows. Responses use the same workflow lock. The bounded scheduler uses `FOR UPDATE SKIP LOCKED`, case state and unique logical notice indexes. Crashes roll back notice/state/audit together. No network calls occur in those transactions.

Reminder payload preparation rechecks response/checkpoint/case/recipient. A response after claim but before preparation cancels an unsubmitted reminder. Already submitted requests cannot be recalled; their provider evidence remains. Local tests cover both serialization orders and rollback, but PGlite is single-connection: real multi-session locking/race QA remains a release requirement.

Late responses stay CRM submissions without workflow advancement or automatic restoration; duplicates return already-recorded. Reject is terminal for this automatic path pending BA; replacements cannot rearm it.

## Configuration and manual release preparation

`POST /api/notifications/nonresponse-worker` requires the existing server-only `NOTIFICATION_WORKER_SECRET`. It touches no database unless **`NONRESPONSE_AUTOMATION_ENABLED=true`**. Leave that unset/false. `node scripts/nonresponse-worker.mjs` is the future optional operator entry point: one bounded request, checked HTTPS/loopback origin, timeout, no redirect and no credential/customer-data logging. No cron/timer/service was installed or enabled.

The separate evidence-only API/script stays gated by `NONRESPONSE_REVIEW_ENABLED`; it cannot issue notices or change status. Mail sending remains separately gated by `EMAIL_DELIVERY_ENABLED` and exact approved-recipient test mode. Reuse [Sprint 12 provider/configuration instructions](Sprint_12_VPS_Email_Runbook.md). Neither evidence-review nor sending flags activate the deadline worker.

Before release: manually review/apply 291–303 in order; obtain and visually review the actual DOCX and converted PDF and approve day-30 content; register/test its version as below; keep Reject on BA hold; inspect old cases/queue; use only disposable approved test recipients; verify live metadata/grants/Storage and multi-session locking; deploy matching code through normal release approval. Keep live switches off until those gaps are reviewed. This handoff is preparation, not deployment approval.

## Shared DOCX template preparation

302 creates the private `notification-templates` bucket if absent; it does not change an existing bucket's privacy setting. Browser/anonymous access is denied even under a permissive legacy Storage policy. Upload through the trusted Supabase operator interface, not a client browser API. Use a new immutable version path for each file: **`TENANT_UUID/suspension/VERSION.docx`**. Only one template is active per tenant and serves all that tenant's companies.

Use **`{{company_name}}`** wherever the company name must change, including headers/footers. This placeholder is required. Optional supported tokens are `{{contact_name}}`, `{{record_id}}`, `{{letter_reference}}`, `{{suspension_date}}`, `{{intimation_upload_date}}` and `{{response_deadline}}`. Dates render in IST. Word may split tokens across formatting runs; the renderer supports that. No hardcoded existing company name is guessed/replaced. Once the actual file is supplied, prepare its token positions and visually review all pages before activation; long replacement names may change line/page wrapping.

The source must be a normal `.docx`, at most 2 MB, with embedded images and no macros, embedded executable objects, external relationships or unresolved/unknown tokens. Expanded parts are bounded to 5 MB each and 20 MB total. Header/footer/style/image XML is preserved except token text. A personalised DOCX exists only in an isolated temporary directory during conversion; only the final PDF goes into the private immutable email payload, never back over the shared source. These are runtime structural tests, not a claim of visual validation of the missing real letter.

Calculate the source file's lowercase SHA-256 locally and register it through a trusted service-role/SQL operator with `configure_suspension_docx(tenant_uuid, storage_path, lowercase_sha256, false)`. The function validates tenant prefix, private bucket, object presence/size and immutable version/hash. Registration defaults to **inactive**. Never place service credentials in browser code or a command line. After reviewing the actual letter and approved-recipient QA, explicit activation uses the same function with its final argument `true`; no activation occurred here.

Only an enabled existing mail worker releases one unsubmitted blocked letter for an active tenant template. It pins template ID/hash, checks current recipient/link/status, downloads from the canonical private path, verifies bytes, personalises the DOCX, converts it locally to PDF, and persists the PDF attachment before sending. Wrong-recipient work moves to review without starving later jobs. Retries reuse saved PDF/body/bytes and Resend idempotency keys without rerendering; template replacement cannot change a pinned/submitted job. A bad/missing/changed/unsupported template or conversion failure sends no incomplete letter and records an explicit retry/review error. Late software responses do not auto-restore the suspended client.

## Local PDF renderer requirement

The mail worker host needs LibreOffice Writer and the fonts used by the letter. The production Docker runner now installs `libreoffice-writer`, `font-dejavu` and `font-liberation` ([Alpine Writer package](https://pkgs.alpinelinux.org/package/v3.23/community/x86_64/libreoffice-writer), [Alpine fonts](https://wiki.alpinelinux.org/wiki/Fonts)). A bare VPS must supply LibreOffice and the actual template fonts separately. Optional server-only `SUSPENSION_LIBREOFFICE_PATH` is the executable path, not a shell command; otherwise the worker uses `libreoffice` on Linux or `soffice.exe` on Windows. No remote conversion service is used. The old Python `/convert` endpoint is unimplemented and is not used.

Each job uses a unique temporary directory and office profile, no shell, a 60-second process timeout, bounded process output, and cleanup after success/failure. Generated PDFs must be at most 10 MB, parse successfully and contain at least one page. The attachment is named `suspension-RECORD_ID.pdf` with `application/pdf` MIME type. There is no DOCX fallback. Missing renderer or conversion failure records `suspension_pdf_conversion_failed` for bounded retry; the suspension status/timers are not changed by conversion outcome.

303 validates PDF attachment metadata/signature before payload persistence; the worker also parses PDF bytes before sending, including saved payloads returned by persistence. Older immutable DOCX payloads are blocked (`suspension_pdf_required`) and retained for operator review; they are never rewritten or resent as a new PDF under a possibly submitted provider idempotency key. Inspect provider evidence and use a separately reviewed recovery procedure. Applying 303 does not rewrite or scan historical payloads.

LibreOffice is absent on the development workstation. Conversion-boundary tests simulate office output; actual LibreOffice/Docker conversion, exact template fonts and visual comparison of every PDF page remain release QA. This is required for letterhead, page wrapping and long company names.

## Verification and remaining gaps

**95 local checks passed:** 29 Surveillance, 12 actual bulk-summary checks through 303, 18 notifications and 36 non-response/DOCX/PDF checks. Enabled boundaries, IST/year rollover, provider-failure independence, replacements/corrections, Accept/Reject, late/duplicate responses, claim/prepare races, rollback, tenant/recipient/grant denial, historical imports, certificate/manual-suspension guards, changed links, replay, private template activation/version pinning, unsafe/bounded ZIP rejection, split Word tokens, escaping and immutable PDF retries are covered. PDF tests cover isolated profiles/files, cleanup, process bounds, invalid/missing/empty/oversized output, conversion failure and saved DOCX rejection. All provider calls and office conversion processes are mocked. TypeScript and the production build passed. Build output is isolated and ignored; its temporary generated-type include was removed after build completion.

Pending: actual shared DOCX artifact/token placement/content and real LibreOffice/Docker conversion, fonts, PDF visual QA/registration/activation; whether day 30 uses that same letter; BA's direct-Reject decision; explicit restoration rights/workflow (CRM owns late handling, no automatic restore); actual multi-session lock QA and all live migration/provider/deployment/end-to-end checks. DOCX storage/PDF outgoing formats, runtime personalisation/conversion support, provider-delivery timing and replacement-reset policy are resolved. See [Sprint 13 notes](../Renewal/Sprints/Sprint_13_Nonresponse_Suspension.md) and [work log](Summary_Upload_Work_Log.md).
