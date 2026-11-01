# Summary upload work log

## Documentation rule

The user requested a record of everything done. Maintain this log alongside task work, recording meaningful findings, decisions, changes, checks, outcomes and remaining questions. Keep these states distinct: proposed, analysed, implemented locally, verified locally, applied to the live database, and deployed. Do not mark a proposal as a user-approved decision or a local fix as a live fix. Never copy credentials into documentation.

## 18 October 2026: storage analysis and certificate completion

- Reviewed the New Client, Initial Summary, Surveillance and Recertification table definitions, creation RPCs, summary parsers and upload paths.
- Added [the storage explanation and sprint plan](Client_Record_Storage_and_Bulk_Import.md), [read-only audit queries](Supabase_Read_Only_Record_Audit.sql) and [business questions](Business_Analyst_Questions.md).
- Implemented local Surveillance completion at Certificate Issued. Removed suspension/withdrawal steps/prompts from the active flow and disabled their upload controls. Local migration 297 blocks paused changes/uploads and prevents reopening a certificate-issued workflow. Historical records/files remain unchanged.
- Verification: 25 regression checks passed, TypeScript passed, production build passed. The audit queries were also exercised against isolated PostgreSQL fixtures. Local server root returned HTTP 200 after restart.
- These checks cover local code and isolated test data. No migrations were applied to the live database and no VPS deployment was performed.
- Earlier local rights/import changes and migration order are documented in [Sprint 10](../Renewal/Sprints/Sprint_10_QA_SummaryUpload.md).

## 18 October 2026: user-supplied live Supabase audit

Source: the user's pasted results of Queries 1–3. Query 2 was pasted several times; count it once. No direct live write or live creation test was performed.

| Finding | Observed result | Interpretation |
| --- | --- | --- |
| External Clients | 16 rows | Original client/Initial workflow rows |
| Initial Summaries | 14 rows, all linked | Summary count is lower than client count; reconciliation is pending |
| Surveillance | 12 rows, 2 unlinked | 10 have client links; do not invent links for the remaining 2 |
| Recertification | 2 rows, both linked | Both have null workflow status in the supplied result; cause not established |
| Broken/cross-tenant links | Zero reported | No such problems found by these audit queries |
| Surveillance email differs from original | 9 rows | Snapshot/override differences; not by itself proof of incorrect data |
| Multiple Surveillance rows per client | One client has 3, another has 2 | Cannot blindly choose the latest row as the target cycle |
| Company/body collision groups | 3 groups covering 10 rows | Requires review of the actual candidate values; this count alone does not prove the records are duplicates |
| Workflow tabs | Initial Summary, Surveillance Summary and Recertification Summary present | Existing Summary implementations can inform bulk design |
| Surveillance 2 | No separate workflow tab/object/discriminator shown | Do not claim a separate Surv 2 implementation |
| Recent local guards/import RPCs | Absent from the supplied schema audit | The local 291–297 changes are not reflected in that database snapshot; matching frontend deployment needs the migrations |

The schema also confirms that the original client's `client_user_id__a` is text, while Surveillance/Recertification use UUID. Creation/import code must respect the actual column types. The original client's `created_by` and `updated_by` are UUIDs; the audit workflow tables use text.

## 18 October 2026: bulk requirements clarified

User-confirmed:

- One spreadsheet row creates/updates one record, retaining its multiple standards and certificates together.
- Do not require Client IDs in the spreadsheet.
- Compare company names after removing whitespace, with standard numbers such as `9001` and `14001` rather than literal full `ISO ...` strings.
- Cover the workflows that already have Summary upload.
- Analyze the existing New Client from Summary button before coding. The bulk feature remains at the analysis stage.

Proposed, not yet approved or built:

- Scope matching by tenant and selected certification body.
- Use complete standard-number tokens and set comparisons rather than arbitrary numeric substring matches.
- Resolve duplicate candidates and multiple cycles in preview.
- Offer an explicit standards-extension choice for a company recorded with `9001` when the incoming row has `14001`. Do not automatically overwrite/extend or create another company solely from that mismatch.
- Retain retry protection and batch/row results in the eventual bulk writer.

## 18 October 2026: existing button review

- Traced `ClientSummaryTab` to `NewClientFromSummaryForm`, its shared parser, creation RPC and subsequent file attachment calls.
- Confirmed admin-only single-client creation, new ID on each call, and no existing-client matching/update branch.
- Ran the parser locally against the supplied workbook: 20 metadata fields, zero date fields, implied status `Application_Sent`. A synthetic additional client row was not processed.
- Reproduced a vertical-only format-detection issue: `Company name / Acme` followed by `Scope / Engineering` produces company value `Scope`.
- Identified partial-completion/retry risk: records are created before Storage upload and attachment append; a later failure leaves the records created.
- Recorded the evidence, limitations and recommendation in [the button review](New_Client_From_Summary_Review.md).
- No application or database code was changed during this analysis. The existing button was not executed against live data.

## 18 October 2026: clarification of where the existing-format file is uploaded

- Checked the actual file-input entry points. Both let the user manually select an `.xlsx`/`.xls` file from their computer.
- New-client path: Client Summary list > New Client from Summary > Click to upload a Summary Excel sheet > preview > Create Client. Admin only.
- Existing-client path: Client Summary list > open an existing summary > Import Summary. CRM/admin, using `StageDateImport.tsx`.
- Both use `summarySheetMapping.ts`, which expects company metadata across a header/data pair and milestone dates in a vertical list. The file is supplied by the user; neither inspected upload component generates a template or fetches this workbook from another application.
- The checked source does not establish who originally prepares the business's summary workbooks or which exact files were historically uploaded. No live upload history was inspected.
- This clarification involved source inspection and documentation only, with no application-code or live-data changes.

## 18 October 2026: Sprint 11 completed locally

The user's newer requirements supersede the earlier proposal/analysis-stage entries above.

Confirmed latest requirements and boundaries:

- Add **Bulk Summary Upload**, **Bulk Surv 1 Summary Upload** and **Bulk Recert Summary Upload** to their existing Summary tabs, visible only to admin and enforced server-side.
- Current template folder is `UAF New Changes/SUmmary Bulk`.
- Compare whitespace-free company names and complete standard codes, including shorthand `9`, `14`, `45` and mixed `9001, ISO 14001` formatting.
- Only 9001/14001/45001 can be combined and extended. All other standards are separate. Automatically split mixed spreadsheet rows into the integrated group plus each separate standard. This replaces the earlier one-row/one-record rule and the earlier 27001-only exception.
- Prepare separate email and suspension sprint documents. The suspension requirement is now 30 days, second notice, then a further 10 days unanswered. Apply it to matrices with suspension: Surv 1/2; supplied Recert matrix has none. This does not revive the old compulsory post-certificate chain.
- **Complete one sprint, write its notes, and wait for explicit user go-ahead before starting the next sprint.** Sprint 12 and Sprint 13 are not started.

Files and implementation:

- Added shared `app/commonfiles/core/components/custom/BulkSummary/bulkSummaryMapping.ts` and `BulkSummaryUpload.tsx`, and embedded the admin-only entry button in the three existing Summary list components. Existing selected-record uploads remain unchanged by this sprint.
- Reused existing mapping dictionaries, physical API names and stage progressions. Bulk parsing reads milestone dates across columns, surfaces excluded/ambiguous headings, permits explicit column mapping, and validates date/alias/duplicate/formula-cache errors before writes.
- Added preview target selection, split-part field differences and standard/certificate pairing in original input order. Unpairable populated certificate lists block the row rather than guess. Existing duplicate client/audit candidates require explicit choice.
- Added only one migration for this sprint: `supabase/migrations/298_admin_bulk_summary.sql`. It contains admin-only preview/apply RPCs, strict server field validation, Initial Summary mirroring, existing atomic Surveillance/Recertification importer reuse, linked identity creation, record/version checks and bulk concurrency locks.
- Added private `tenant.bulk_summary_import_results` for source row/part data, before state, actor, timestamps and results. Idempotency includes tenant/app/workflow/file hash/worksheet/row/standard group. The same completed part returns its previous result; changed mappings require a corrected workbook.
- Source workbooks are uploaded once under an admin-only Storage prefix. Bulk requires a private bucket; full multi-client workbooks never go into individual client-visible packs. Private helper functions are explicitly revoked from public/anon/authenticated roles, while the two checked entry points are granted to authenticated callers.
- Added `tests/bulk-summary.test.cjs`, an admin-label regression in the existing QA suite and the `test:bulk-summary` npm command.
- Wrote [Sprint 11 notes](../Renewal/Sprints/Sprint_11_Bulk_Summary_Upload.md), [Sprint 12 plan](../Renewal/Sprints/Sprint_12_Email_Review_Resend.md), [Sprint 13 plan](../Renewal/Sprints/Sprint_13_Nonresponse_Suspension.md) and [manual migrations 291–298](Manual_Migrations_291_298.md). Updated the storage analysis, button review, question register, sprint index and deployment prerequisites to reflect the latest decisions.

Verification:

- Bulk suite: **9 checks passed**, including shorthand parity between TypeScript/PostgreSQL, integrated append, separate standards, split-part retries, stale/multiple/cross-app targets, linked audit creation, bad input rollback, admin enforcement, source privacy and atomic rollback if summary upsert fails.
- Previous QA suite plus new button visibility check: **26 checks passed**.
- Final production build and its TypeScript validation passed. Existing Next configuration/cache warnings did not prevent the build.
- Final documentation check: 24 Markdown files checked, no broken relative links. Migration discovery confirmed exactly one file for each number 291–298 in `supabase/migrations`, with no duplicate number in that range.
- No live Supabase changes, customer emails or VPS deployment. Real admin workflow acceptance checks remain after the user's manual migrations.
- Final local-server check initially found a separate development process on port 3000 with stale/mismatched `.next` chunks after production build verification. Inspected process command lines, stopped only the two verified Next processes belonging to this workspace, verified the exact generated-output path before clearing `.next`, and restored `npm run dev` on 127.0.0.1:3000. This is Sprint 11 environment cleanup; it does not start Sprint 12 or change live data.
- After restoration, both `/` and `/dashboard` returned HTTP 200. This verifies local page serving, not authenticated bulk use against the still-unmigrated live database.

## 18 October 2026: Sprint 11 re-verification

User requested another verification pass and explicitly reserved approval of the next sprint. Only Sprint 11 was reviewed/fixed; Sprints 12 and 13 remain unstarted.

Corrections:

- Kept certificate numbers paired with their original standard while sorting the canonical standard list, including reverse-order integrated-only rows and split mixed rows.
- Changed source-file retries to download/hash the stored file after an upload error instead of depending on one Storage duplicate error code. Different bytes or a failed download prevent record application. An RPC response without explicit success is treated as failure.
- Extended the restrictive bulk-source Storage policy to anonymous callers as well as authenticated callers. Tested with a permissive legacy anonymous policy: bulk sources remain hidden while unrelated fixture objects retain their original access.
- Allowed matching to fall back to the record name when the company field is whitespace only.
- Copied linked original-client email/contact into newly created audit records when incoming cells are blank; explicit spreadsheet values override that audit copy. Newly created original identities retain supplied address, country, scope, employees and IAF code, with applicable summary mirrors. No Initial approval milestones are invented.
- Amended migration 298, without adding 299. Tested complete migration replay after imports: existing business/log counts remain intact and a completed part is returned without duplicate creation. Updated the manual migration handoff to require the current 298 copy, including rerunning it if an earlier copy was already applied. Replay does not retroactively repair previously imported values.

Verification results:

- `npm run test:bulk-summary`: **11 checks passed**.
- `npm run test:surveillance`: **29 checks passed**, including actual modal file-selection/preview/apply sequences with same-source retry, mismatched source and unconfirmed server result. **40 total checks passed**.
- `npm run build`: **passed**, including lint/type validation and all static pages. The first sandboxed attempt could not fetch the existing Google Inter font (`EACCES`); rerunning with network permission passed. Existing Next configuration and client-rendering warnings remain.
- `git diff --check`: passed. Rechecked 11 relevant Markdown documents: no broken relative links. Confirmed one migration file each for 291–298 and no 299.
- Isolated PostgreSQL fixtures and mocked React/Storage tests are not live Supabase acceptance tests. No live database changes, VPS deployment or customer emails were performed.
- Restored the local development server after the production build; `/` and `/dashboard` both returned HTTP 200. Confirmed the working branch remains `SummaryUpload`.

## 18 October 2026: Sprint 12 email review and Resend readiness

User explicitly authorised Sprint 12 only, including evaluation of Hostinger VPS email delivery. Reverified the workspace and `SummaryUpload` before changes; retained all existing uncommitted work. Git needed a command-local safe.directory exception for the differing execution/repository owner; no global setting, reset, checkout or branch switch was used. Inspected numbering: 299 was unused. No old migration was renamed or amended by Sprint 12.

Analysis before coding: traced Surveillance creation, finalised intimation uploads/replacements, Recert creation/uploads and custom invitation create/resend separately. Both existing Resend routes lacked request authentication/tenant binding and trusted browser destinations; the workflow route also fetched arbitrary attachment URLs and silently omitted failed attachments. Frontend fetch failure could lose notices, retries/callbacks could duplicate them, and provider IDs/events were not durably recorded. Existing sent dates were upload/status evidence. Findings and source paths are in [Sprint 12](../Renewal/Sprints/Sprint_12_Email_Review_Resend.md).

Reviewed current official Hostinger/Resend sources. Recommend hosting the app and scheduled worker on the existing Hostinger VPS while using Resend HTTPS for outbound delivery. This reuses the present integration and supports authenticated delivery events/idempotency without operating an SMTP server. Hostinger mailbox can remain reply-to. No VPS/account/DNS configuration was inspected or changed. Additional rights-matrix email checkpoints are pending the user's forthcoming update; no unconfirmed trigger was invented.

Implemented locally:

- Added **299_notification_outbox.sql** only: transactional workflow/invitation enqueue, private outbox/attempt/event/software-response tables, tenant-scoped limited history/acknowledgements and service-only fenced worker operations. Historical imports are mail-silent, including actual 298/299 integration tests. 291–298 remain earlier supplied prerequisites.
- Creation alerts, round-1 intimation letters and replacement revisions have separate evidence. Never-submitted superseded work is cancelled; submitted evidence/payload is immutable. No second-notice timer or suspension chain was added.
- Replaced arbitrary direct sends with authenticated database acknowledgements. Removed workflow browser mail fetches/signed URLs and fixed unchecked Recert upload finalisation. Delivery recipient is the single validated stored record email, never an arbitrary browser address or extracted PDF text.
- Added a disabled-by-default secure worker, exact approved-recipient test mode, required sender/portal configuration, checked Storage attachments, escaped templates and a VPS scheduler script. Saved exact payloads before submission; used stable Resend idempotency keys, provider IDs, timeout/error classification, Retry-After/backoff, eight-claim limits, recoverable leases and an ambiguity cutoff before key expiry. Rechecked record recipients, invitation validity and unsent revisions immediately before submission.
- Added awaited raw-body Svix signature/timestamp verification, durable event-ID deduplication, recipient/provider correlation, unmatched-event reconciliation and failure/delivery timestamps that survive reordering. HTTP 503 on failed persistence permits webhook retry. No event or email reply becomes software acceptance.
- Added the record delivery panel showing upload/queue/provider acceptance/mail-server delivery/failure separately from actual software responses. Surveillance intimation actions now have actor/time/revision evidence and tightened null-safe identity checks. Existing other workflow action panels remain authoritative. deadline_start_at is constrained to NULL until business decisions B21–B24 are resolved.
- Added [VPS/provider runbook](Sprint_12_VPS_Email_Runbook.md), [targeted read-only SQL](Sprint_12_Email_Readiness_Audit.sql), and expanded the [complete migration handoff](Manual_Migrations_291_298.md). No live queries/writes, deployment, customer email or Sprint 13 work.

Verification: **29 Surveillance + 12 bulk + 18 notification checks = 59 passed**, using isolated PostgreSQL, mocked provider/Storage/HTTP/React and real local Svix signatures. Covered failures/retries, duplicate triggers, replacement races, wrong tenant/recipient, nullable identities, private grants, exact payloads, crash recovery, exhausted/expired retry windows, webhook forgery/replay/reordering, invitation rotation/cancellation and separate panel evidence. TypeScript and production build passed; existing Next configuration/cache/client-rendering warnings remain. The initially selected Svix major 2 needed Node 22 and asynchronous verification; corrected to Node-compatible **1.99.1** and awaited verification. A source-cleanup syntax error was fixed before final verification. These intermediate issues are not remaining failures.

Release state: implemented/verified locally only. Manual migrations, real sender-domain/DNS/provider setup, reverse proxy/scheduler configuration and approved-recipient live QA remain operator tasks. No live schema assumptions were made. Stop after Sprint 12 and wait for explicit Sprint 13 go-ahead.

Final handoff checks: production build and standalone TypeScript command passed on the final source; scheduler JavaScript syntax passed; git diff whitespace check passed; seven relevant Markdown documents have no broken relative links; exactly one migration file exists for each number 291–299. New server helpers are under `app/server/notifications` so the repository's generic ignored `lib/` directory rule cannot omit them from a future commit. The working branch remains SummaryUpload.

## Current next steps

Clarification on workflow scope: **New Client from Summary** is an Initial/External Client creation path and has not been extended into a Surveillance creation button. Surveillance 1 has its own `SurveilanceSummaryTab` and `SurveilanceImport` for updating a selected existing renewal record with Surveillance-specific mappings. Local fixes improve that import, but the supplied live audit lacks the new import RPCs. Neither that button nor the existing renewal schema distinguishes Surveillance 2; a separate Surv 2 workflow was not present in the supplied live metadata. This clarification is documentation only.

Upload location clarified: the configured custom tab is **Surveillance Summary**, component `SurveilanceSummaryTab` (the component name contains this spelling). Open that tab, select an existing record, then use **Import Summary Sheet**. The import control is restricted to CRM/admin. It is separate from the object tab labelled **Surveillance 1**. The user's Query 3 confirms that the custom tab is defined; it does not establish its app-tab assignment, the active app, role visibility or the live deployed frontend build.

- Sprint 12 is now authorised and completed locally. Hand off migration order 291–299, distinguishing prior 291–298 from new 299. Wait for the user's explicit go-ahead before starting Sprint 13.
- The user will run the new migrations manually. Keep manual live QA distinct from the local test results; record any resulting feedback before further changes.
- Keep unresolved business details in the question register. Before a future suspension sprint, finalise the affected entity/checkpoints, notice delivery evidence, late responses and restoration rights.

## 18 October 2026: Sprint 13 started — policy-held evidence foundation

The user authorised **Sprint 13 only** using the attached handoff. Verified workspace and `SummaryUpload` before coding; retained all pre-existing uncommitted work. Used only a command-local Git ownership exception; no reset, checkout, rename or global setting. No applicable `AGENTS.md` was found. Migration numbering was inspected and 300 was unused. All earlier migrations 291–299 remain unchanged by Sprint 13.

Read all requested Sprint 12/13, business-question, work-log, migration and readiness sources, plus current textual rights matrices. The [Sprint 13 notes](../Renewal/Sprints/Sprint_13_Nonresponse_Suspension.md) document the exact checkpoints/roles/current status/action paths and source/schema findings. Surveillance 1 intimation is the only confirmed timed checkpoint. Surv 2 is reserved; no separate implementation/discriminator is established. Recert has no suspension rows. No updated email-trigger matrix or promised letter template was located. No new checkpoints were inferred from view/upload rights.

Existing partial answers in the supplied notes confirm External Client status as the target entity, ignore missing email, and 30 + 10 days IST. They do not approve the start event, bounce/failure/delay/suppression treatment, replacement/email-correction effects, Reject/late-response/manual/restoration behaviour, exact clock/end-of-day boundary or letter content. Asked for clarification in-session and continued independent work. No reply was available at implementation time. B16/B21/B22 and new B25–B28 record the remaining decisions. Proposed defaults were not treated as approved.

Implemented locally:

- **300_nonresponse_policy_hold.sql** only: private RLS-protected tenant/workflow cases and evidence audit. New transactional Surveillance intimation notices enrol one case; source notice remains fixed across revisions. Existing notices, record-creation alerts, Recert and historical imports do not enrol cases. Case/evidence/audit changes roll back with notice creation or software response. No historical statuses/files are rewritten.
- Captured source/current notice/revision, upload/provider/mail-server/failure timestamps, actual software response/actor/time, workflow status, recipient/link/checkpoint holds, policy version, worker and outcome. Consecutive unchanged reviews do not add audit noise; real evidence changes remain auditable. Provider delivery is never software acceptance.
- Added a bounded service-only review RPC using workflow-first locks and `SKIP LOCKED`, transactional crash recovery and atomic response re-reading. It performs no network operations, sends no mail and changes no client status. Duplicate local review requests are safe. PGlite is single-connection; genuine multi-session concurrency verification remains outstanding.
- Added disabled-by-default evidence-only API/script. `NONRESPONSE_REVIEW_ENABLED` remains unset; no schedule was installed/enabled. There is no active suspension flag. Database constraints require automation=false and both deadlines=NULL; 299's round-1-only/NULL deadline-start and 297's certificate/old-chain safeguards remain intact.
- Extended record delivery history with IST review timestamps, explicit disabled/unstarted state, holds and the latest 20 audit changes with actor/worker/policy/outcome. History reuses existing tenant/object/field/sharing/linked-client checks. External Client status and audit progress are preserved; no false Suspended tag or invented restoration right.
- Added [Sprint 13 local handoff](Sprint_13_Local_Handoff.md), [read-only metadata/status/layout/guard SQL](Sprint_13_Readiness_Audit.sql), updated question/sprint registers and complete migration list. Earlier supplied files are 291–299; **300 is the only Sprint 13 addition**.

Verification: **29 Surveillance + 12 bulk-summary + 18 notification + 12 non-response = 71 automated checks passed**. Expanded the actual 298/299 bulk importer fixture to include 300; historical creates/updates/retries remain mail/case/audit silent. The fixture initially omitted the real intimation file column needed to install 300; added that fixture column and reran successfully. Readiness SQL executes against local metadata fixtures without changing notice/audit counts.

New checks cover transactional rollback/deduplication, no backfill, hypothetical boundary ages before/exactly at/after 30/40 days while disabled, all persisted delivery states, replacements/corrected/missing recipients, foreign/missing linked client, aged Accept/Reject and duplicate actions in both review orderings, worker rollback/retry/duplicates, private grants/tenant/field/sharing denial, webhook replay/reordering, metadata SQL, migration replay, manual/historical client status preservation and 297 certificate guard. These do **not** claim enabled deadline transitions, production SMTP/Resend delivery, active suspension race safety or live permissions.

Sprint 13 remains partial. Still required: approved policy/template and live status metadata; transactional second-notice/final deadline transitions; approved External Client suspension status/enforcement/tag; late/manual/restoration handling; active boundary/provider/replacement tests; real multi-session response/scheduler races; separately approved manual live migration/configuration/deployment/QA. No live database migration, customer email, VPS deployment, DNS/provider setting or scheduling change was performed. No later sprint was started.

Final build/tooling verification: standalone `npm run type-check` passed, script syntax passed, whitespace checks passed, and the final **production build passed**, including type/lint checks and all 15 static pages. A normal initial build passed; a later shared-output build hit generated chunk/manifest prerender failures. Final verification used an ignored temporary file-based runner with `NODE_ENV=production` and only an in-memory `distDir` override to `build/sprint13-final`. No persistent Next configuration change was made. Next's automatically added isolated-type include was removed, restoring the original tsconfig. Existing appDir/cache/client-rendering/legacy-module warnings are not new release blockers.

Intermediate verification mistakes were corrected: a sandboxed fresh build could not fetch the existing Inter font; the retry used approved network access. An initial `node -e` build launcher propagated its eval arguments into forked workers and recursively launched builds; stopped only that verified process tree, confirmed no matching processes remained, and cleared only its checked generated output path. The file-based retry initially omitted the CLI's production environment and failed React prerendering; corrected that runner and reran to successful exit 0. These were temporary tooling attempts, not production configuration/code changes. No automatic approval rejection occurred. The local root returned HTTP 200 after the shared-output checks.

## 18 October 2026: Sprint 13 continuation after policy answers

The user replied to the pending clarification: (1) letter upload date starts timing; (2) that date is enough, do not gate on provider/email outcomes; (3) replacements/corrected emails do not restart it; (4) Reject should eventually send the suspension letter directly, **but wait for BA confirmation**; (5) yes to the clock-boundary question, interpreted and stated back as the same IST clock time; (6) CRM handles late responses. The template is a suspension letter uploaded once in Supabase, with company names/details personalised. Asked its format/path and whether day 30 uses the same letter. No artifact/path/format or further reply was available during implementation.

Reverified workspace and SummaryUpload, preserving all earlier dirty work. No applicable AGENTS.md appeared. 301 was unused. **Added 301_nonresponse_upload_deadlines.sql; did not edit/rename 291–300.** This continues Sprint 13, not a new sprint. Earlier initial policy-held notes above are historical; current behaviour is in [the handoff](Sprint_13_Local_Handoff.md).

Implemented:

- New cases start from transactional intimation finalisation (not attachment creation, provider evidence or historical workflow dates). First deadline is +30 calendar days at the same Asia/Kolkata clock time. Source/start/deadline remain fixed through replacements/email corrections. Cases from 300 are not silently promoted or backfilled.
- Bounded service-only process_nonresponse locks a due workflow/case, rechecks software responses/checkpoint/linked tenant, and atomically issues one logical second reminder with the original intimation and +10 IST days from its creation. A delayed worker grants the full further 10 days. Email/provider failure/delay/bounce/suppression does not change windows. Current record email is used for new notices; changed recipients on queued messages block for operator review without resetting dates or redirecting submitted payloads.
- At the further deadline, rechecks again and atomically sets the linked External Client to Suspended, saves prior status and suspension timestamp, and enqueues a separate final-letter job **blocked pending the actual shared template**. No letter rendering/personalisation/delivery is claimed. Surveillance checkpoint/history and 297's completed-certificate/old-chain safeguards remain. Recert and Surveillance 2 scope stay unchanged.
- Registered the semantic External Client status option without rewriting field type/layout. Guarded the suspension marker/status against fabricated generic create/edit and silent clearing by imports/other workflow updates. No new restoration right or login ban is introduced. Already manually/historically suspended/withdrawn clients or changed/missing links enter CRM review.
- Accept stops the automatic path. Reject enters BA hold and cancels unsubmitted reminder work; no direct Reject suspension or letter. Late responses after suspension are recorded for CRM, with duplicates denied and no workflow advancement/restoration. Reminder preparation acquires the workflow lock and rechecks response/case/recipient before provider submission; already submitted evidence cannot be recalled or erased.
- Added a private transition journal with policy/source/deadlines/actor/worker/outcome/prior status/letter evidence; added disabled-by-default deadline API/script using NONRESPONSE_AUTOMATION_ENABLED. Existing evidence-review and mail switches remain separate. The UI shows actual IST deadlines/notice/suspension, pending final letter, BA/CRM holds, detail tag and generic list status badge. Provider delivery remains separate from software actions.

Verification: **29 Surveillance + 12 bulk-summary + 18 notification + 27 non-response = 86 passed**. Actual 298/299/300/301 historical imports remain mail/case/audit silent. New enabled boundary checks cover before/exact/after both windows, IST year/server-timezone handling, provider failures, replacements/corrections/missing email, Accept/Reject, response after claim and before preparation, already-submitted immutable evidence, aged/late/duplicate software actions, rollback/retry/duplicate work, tenant/grant/recipient denial, status metadata/guard checks, missing/changed links, manual history, certificate completion and replay. A text-fragment assertion in the initial hold-panel test was updated to compare rendered text after dates became dynamic; product behaviour was correct. PGlite is single-connection: real multi-session locking remains release QA, not claimed by local Promise concurrency.

TypeScript and final production build passed (all 15 static pages plus the new deadline API). Used the previously corrected temporary file-based production runner and isolated build/sprint13-final output, with font network access permitted. Existing appDir/client-rendering/legacy-module warnings remain. Removed only Next's generated isolated-type include from tsconfig, preserving project configuration. New scripts pass syntax validation.

Current complete migration order: earlier supplied **291, 292, 293, 294, 295, 296, 297, revised 298, 299**, then Sprint 13 **300 and 301**. Updated current handoff, migration list, question register, sprint index, read-only readiness SQL and Sprint 13 notes. Do not rerun 300 alone after 301's newer function definitions.

Remaining: actual shared suspension-letter format/path/artifact and personalisation/delivery; clarify whether day 30 uses it too; BA decision on direct-Reject handling; explicit restoration workflow/rights beyond CRM ownership of late responses; real multi-session/live metadata/provider/manual release QA. No timing/provider/replacement business blocker remains. No live migrations, customer email, scheduling, VPS deployment or provider/DNS change was performed. All live enablement flags remain untouched/off by default. No further sprint was started.

## 18 October 2026: shared suspension DOCX support

The user answered the pending format question: **DOCX**. Continued only Sprint 13. The actual letter file/location/content and whether the day-30 notice should use it were not supplied. Did not author an invented suspension letter or claim visual QA of an unavailable artifact.

Added only **302_shared_suspension_docx.sql** in this continuation; 291–301 remain unchanged. It adds the private notification-templates Storage bucket (without silently changing an existing bucket's privacy), restrictive browser/anonymous policies, tenant/version/path/SHA-256-bound registration inactive by default, explicit trusted-operator activation, bounded final-letter release, pinned file lookup and final payload eligibility checks. Old/pinned payloads retain their source version across template activation changes. Wrong recipients move to review without starving later letters. No actual source file was uploaded, registered or activated; configuration tests use isolated fixtures only.

Added server-side DOCX personalisation using the existing JSZip dependency. Required company_name and optional contact/date/reference tokens are replaced across formatting runs and headers/footers; values are XML-escaped and source/styles/media are preserved. The shared file is never overwritten. Streamed expanded-size bounds, ZIP/package/path checks and macro/external-reference/token validation fail closed. Worker checks the stored template hash and current tenant/recipient/status, persists generated DOCX bytes in the private outbox payload before sending, and reuses exact bytes/body/idempotency on retry. Missing, changed or unsupported templates cannot send incomplete letters. No public template URL or arbitrary attachment URL is accepted.

Final verification is **92 checks passed**: 29 Surveillance + 12 real bulk integration through 302 + 18 notifications + 33 non-response/DOCX. Includes private registration/default inactivity/activation, version/hash pinning, wrong-tenant/path/recipient denial, restrictive Storage despite permissive legacy policy, split tokens, XML escaping, source/style/media preservation, macros/external/unsafe-path/expanded-size rejection and mocked rendering/provider retry persistence. PGlite remains single-connection; actual multi-session locks are still release QA. DOCX fixtures are synthetic in-memory ZIPs, not a delivered or visually verified real letter.

Intermediate tests caught and corrected a generated SQL dollar-quote replacement/PLpgSQL alias ambiguity, TypeScript compatibility with the repository's target, a stream error/end ordering issue in the expanded-size bound, and a cross-VM object-prototype assertion. All final suites pass after corrections. No extra npm dependency was installed. Standalone TypeScript and final production build passed; the generated isolated-type include was removed and Next/TypeScript project configuration is unchanged. Script syntax, links and migration numbering are checked separately.

Updated handoff with DOCX placeholders, versioned private path, lowercase hash, inactive registration/explicit activation, approved-recipient pilot and mandatory actual-file content/layout review. Current complete order is previously supplied **291–299**, then Sprint 13 **300, 301, 302**. Replay through 302; do not restore old 300/301 wrappers alone after it. Readiness SQL includes the new private registry/functions and commented aggregate Storage checks.

Still needed for release: actual DOCX token placement/content and visual review/registration/activation; decision whether day 30 uses the same letter; BA on direct-Reject; explicit restoration workflow beyond CRM ownership of late responses; real multi-session/schema/Storage/provider acceptance and separately authorised manual live migration/deployment/configuration. Runtime DOCX support and the no-response path are implemented locally; real-template QA/live release are not complete. No real customer mail, live SQL, template upload/activation, scheduler enablement, DNS/provider change, VPS deployment or further sprint was performed.

## 18 October 2026: preserve DOCX source and send personalised PDF

User clarified: **Stored in Docx, edit it and while sending send in PDF.** Updated only Sprint 13 suspension delivery. The shared private Supabase source remains DOCX; the worker verifies/personalises a copy, converts it locally through headless LibreOffice, validates the PDF and persists/sends only `suspension-RECORD_ID.pdf` with `application/pdf`. Retries reuse the immutable PDF without another download/conversion. There is no DOCX fallback or external conversion API.

Added `app/server/notifications/suspensionPdf.ts`: unique temporary directory and office profile per job, shell-free execution, 60-second process timeout, bounded output, cleanup on success/failure, 10 MB PDF ceiling and parsing/page checks. Missing renderer or bad conversion records a bounded retry error and sends nothing. Docker runner now includes Writer and common fonts; bare VPS/actual template fonts and optional server-only SUSPENSION_LIBREOFFICE_PATH are documented. No global software was installed and the Docker image was not built/deployed. LibreOffice is absent on this workstation, so actual engine output/layout is not claimed.

Added only `303_suspension_pdf_delivery.sql`; earlier migrations remain unchanged. It wraps payload preparation with the existing workflow/case/outbox lock order and PDF metadata/signature checks. Older saved DOCX payloads are held for review without rewriting possibly submitted bytes/history. Worker validation also covers saved/returned payloads and parses final PDF bytes before sending. No historical backfill or automatic payload conversion occurs. Complete order is earlier 291–299, then Sprint 13 300–303; replay through 303, not older wrappers alone.

**95 local checks passed:** 29 Surveillance, 12 actual bulk-summary integrations through 303, 18 notifications and 36 non-response/DOCX/PDF checks. Conversion tests mock office output and cover personalised DOCX input, PDF MIME/filename/bytes, immutable retry, isolated concurrent profiles, cleanup, timeout options, missing/malformed/empty/oversized output, conversion failure, saved DOCX denial, SQL guard/replay/private wrapper grants and preserved submission history. All provider requests are mocked. Two initial fixture mistakes (profile URL extraction and pdf-lib's automatic default page) were corrected; final suites pass. Standalone TypeScript and isolated production build passed. Only Next's generated isolated-build type include was removed from tsconfig; unrelated work was preserved.

Updated handoff, migration list, BA answer log, sprint index/notes and readiness SQL. Remaining release gaps: actual DOCX/token/content, real LibreOffice/Docker conversion with template fonts and visual PDF QA, registration/activation, day-30 wording, BA Reject decision, restoration rights and live/multi-session release QA. No live SQL, customer email, template activation, scheduling, deployment, provider/DNS change or later sprint was performed.

## 1 November 2026: business-sheet corrections to Surv 1 summary upload

Real workbook `Sur summary.xlsx` exposed three problems. Parser/mapping only; no SQL or migration change.

- **Bulk:** removed the Type-column check (`Initial` blocked every Surv 1 row) and stopped mapping `total mandays` onto `surv_mandays__a` (8 vs 3 are different figures; it raised a conflict). Mapped `surv tech review` to the Tech Findings date.
- **Individual:** wide-sheet date headings are now read (previously zero dates parsed, so records kept workflow "today" dates). Re-upload to correct already-imported records.
- Tests added in `surveillance-qa.test.cjs` and `bulk-summary.test.cjs`; 29 + 12 pass, `tsc` clean. Not click-tested on live Supabase.
- Docs updated: `Sprint_11_Bulk_Summary_Upload.md`, `Sprint_7.md` (§12.3 superseded, new §13).
