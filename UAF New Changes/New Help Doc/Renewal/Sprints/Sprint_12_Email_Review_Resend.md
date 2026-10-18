# Sprint 12: email delivery review and Resend readiness

Date: 18 October 2026. Status: implemented and verified locally after the user's explicit Sprint 12 authorisation. Awaiting manual Supabase application, VPS/provider configuration and approved-recipient live QA. No production email has been sent. Sprint 13 remains unstarted and requires separate go-ahead.

## Review and implementation evidence

## Pre-code review — 18 October 2026

Sprint 12 authorised by the user. Verified workspace and `SummaryUpload`; existing dirty files retained. Git requires a command-local safe.directory override because the execution account differs from the repository owner; no global Git setting changed. No 299 exists at start.

| Path observed before changes | Behaviour / gaps |
| --- | --- |
| `NewRenewalForm` → `create_renewal_client` → optional start/Storage/finalize upload → browser POST `/api/notifications/send` | Browser email override, optional signed attachment; record transaction does not include notification. Closing browser/fetch failure loses mail. Creation with letter and a later replacement can send repeatedly. |
| `RecordDetailView.maybeSendRenewalUploadEmail` after `FileUploadField` completion | Surveillance intimation and four historical suspension/withdrawal mappings; Recert intimation mapping. Reads record email but server trusts request. Each callback/replacement sends afresh. Migration 297 must continue blocking the historical chain. |
| `NewRecertificationForm` → `create_recertification_client` → optional finalize → browser POST | Separate Recert template; creation sends no attachment, says letter is on record. Finalize result was not checked. Same lost-fetch/duplicate risks. |
| `UserManagement` → `invite_user` / `resend_invitation` → browser POST `/api/auth/send-invitation` | Custom invitation token, not Supabase Auth invite. Accept route creates Auth user separately. Email route trusts arbitrary browser email/token/labels. Manual share link fallback exists. |
| Existing Resend routes | REST POST `/emails`, server API key, hardcoded fallback sender `sales1@twe.co.in`. No caller auth, tenant binding, durable retries, timeout, idempotency or webhook. Workflow route fetches arbitrary attachment URL (SSRF risk), silently omits failed attachments, interpolates unescaped HTML, returns 200 on failure, exposes provider ID only to browser. |
| Existing database | `finalize_file_upload` writes canonical attachment metadata to the workflow record in the same transaction as status/date updates. Existing sent dates mean workflow/upload milestones, not proven provider acceptance or delivery. Summary imports assert historical dates; must remain mail-silent. |

Hosting recommendation: run the Next app and authenticated scheduled worker on the existing Hostinger VPS, send through Resend HTTPS. Hostinger is the host; Resend is the delivery provider. Self-hosted SMTP adds reputation/queue/bounce maintenance and Hostinger documents a five-email/minute VPS SMTP limit. A Hostinger mailbox may remain the reply-to address. No VPS/account/DNS state has been inspected or changed, and no delivery guarantee is claimed.

Official references checked at implementation time: [Hostinger VPS SMTP limits](https://www.hostinger.com/support/7854530-is-smtp-port-25-blocked-on-hostinger-vps/), [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [event meanings](https://resend.com/docs/webhooks/event-types), [retries/replays](https://resend.com/docs/webhooks/retries-and-replays), [errors](https://resend.com/docs/api-reference/errors).

Implementation boundary: preserve current creation/intimation paths, remove frontend sending dependency, and keep additional rights-matrix email steps pending the user's forthcoming update. Only intimation uploads currently supported; old suspension/withdrawal templates stay disabled. Creation alerts are separate from notice round 1. Replacement letters are revisions of round 1, never an invented second notice. Deadline start remains unset until the business rule is confirmed. Sprint 13 is not started.

- `app/api/notifications/send/route.ts` already calls Resend's `/emails` API. Resend is not a completely new integration.
- Trace Surveillance intimation delivery from new-record creation and later upload/replacement, and Recertification delivery separately. Identify sender settings, recipients, auth/tenant checks, response handling, retries and duplicate-send risks.
- Distinguish upload/finalisation success, provider request acceptance, delivery, bounce and client action inside the software. An email reply is not workflow acceptance/rejection.
- Determine whether provider IDs, event timestamps and delivery state are persisted. An arbitrary file-upload date is not adequate evidence of successful notice delivery.

## Deliverables and sequence

1. Record the actual current request/trigger paths, database evidence and gaps. Check invite email separately from workflow notifications.
2. Design a transactional outbox with a unique key per record/notice round, authenticated tenant-bound enqueue operations and a server worker. A failed frontend fetch must not lose a required notification.
3. Add persisted Resend message IDs and sent/delivery/failure events. Add authenticated webhook verification, retry/backoff and deduplication using the official Resend documentation at implementation time. Keep secrets server-side.
4. Define an auditable start timestamp for the 30-day software-response deadline. Confirm whether failed/bounced notices may start that deadline with the business analyst.
5. Test failed sends, retries, duplicate triggers, replacement uploads, wrong tenant/recipient and webhook replay using test recipients/mocks. Do not trigger live customer notices as a test.

Acceptance: traceable notice rounds, explicit delivery state, one logical notice per round, no lost/duplicate timer triggers, and no assumption that provider acceptance proves inbox delivery. Update the work log with observed versus proposed behaviour.

## Implemented locally

- Added `299_notification_outbox.sql`. Four private RLS-enabled tables store outbox, attempts, signed delivery/failure events and software intimation responses. Default PUBLIC/anon/authenticated table access and internal/worker function execution are revoked. Only the service role may claim, prepare, complete and ingest verified events. Browser acknowledgement/history RPCs enforce tenant/role/object/field/sharing access as applicable.
- Database triggers enqueue finalised intimation metadata changes in the same transaction. Deferred record-creation triggers exclude audited bulk creates; summary imports' record marker excludes historical updates. The actual 298 writer/importers were tested with 299 installed. Invitations enqueue on creation/token rotation and cancel pending work on cancellation/acceptance.
- Creation alerts and round-1 intimation letters are distinct notice kinds. A letter upload cancels an unsent creation alert; replacement letters use attachment UUID revisions within round 1. Duplicate finalisation/status callbacks do not create another delivery. Existing in-flight/accepted notices remain immutable and auditable; they cannot be recalled. No notice round 2 is exposed or scheduled.
- Replaced both arbitrary-send routes with authenticated acknowledgements of durable database work. Recipient/context come from the record or stored invitation; no browser destination, template or remote attachment URL is trusted. Removed frontend sending and signed attachment URL creation. Recertification now checks the finalise RPC success before claiming upload success.
- Added service-authenticated one-item worker, a VPS scheduler entry point, required sender configuration, HTTPS portal origin validation, escaped HTML and an explicit sending enable switch. Test mode requires approved exact recipients and never redirects customer mail. Storage downloads use checked canonical attachment ownership, with a 10 MB raw file cap. Required attachment failures retry instead of sending incomplete letters.
- Saved exact payload before the first provider request and used a stable Resend idempotency key for every retry. Rechecked recipient/invitation and current unsent revision after payload preparation, as well as at claim. PostgreSQL SKIP LOCKED, five-minute fenced leases, recoverable crashes, eight-claim limit, Retry-After and exponential backoff prevent concurrent uncontrolled resends. Unknown outcomes stop for review before the 24-hour provider-key window expires. This is durable at-least-once processing with bounded provider deduplication, not a claim of unlimited exactly-once network delivery.
- Added raw-body Svix webhook verification and persistent `svix-id` deduplication. Persisted unmatched events reconcile when a provider ID is saved after a raced response. Only exact provider ID/recipient matching changes notice state. Late/replayed sent/delivery events cannot erase bounce/failure evidence. Bounce/complaint/provider failure never causes automatic resend or software acceptance.
- Added the record delivery panel with separate upload/finalisation, queue, provider acceptance, mail-server delivery/failure and software response evidence. Existing workflow dates/statuses remain workflow milestones. The intimation response wrapper fixes nullable-identity authorisation and records actor/time/revision for actual Surveillance software Accept/Reject. Other workflow responses remain in their existing action panels; Recert has no separate intimation Accept/Reject action.
- Kept deadline_start_at constrained to NULL and preserved migration 297's terminal certificate/paused-chain behaviour. No timers, suspension tags/statuses/enforcement, inbound email processing or additional matrix email checkpoints were implemented.

## Verification and handoff

- `npm run test:surveillance`: **29 passed**.
- `npm run test:bulk-summary`: **12 passed**, including real 298/299 mail-silence integration.
- `npm run test:notifications`: **18 passed**. Covers provider failures/rate limits/timeouts, permanent and concurrent-idempotency errors, missing attachments, unapproved recipients, persistence failure, transactional rollback, tenant denial, private grants, immutable payloads, duplicate triggers, replacements during preparation, crash/lease recovery, exhaustion/horizon cutoff, reordered/replayed events, forged/altered/expired webhook signatures using real Svix, invitation rotation/cancellation, software actions, migration replay, and separate panel evidence. **59 automated checks total.** All provider calls are mocked; no email was sent.
- TypeScript and the final production build passed. Existing Next `experimental.appDir`, webpack cache and client-rendering warnings remain. An intermediate source cleanup syntax error was corrected before the final build. The first Svix install selected Node-22-only major 2; implementation/test review caught its asynchronous API and runtime incompatibility. Final dependency is Svix **1.99.1**, compatible with the project's Node baseline, with verification awaited.
- [Manual migration list](../../General/Manual_Migrations_291_298.md), [VPS/provider runbook](../../General/Sprint_12_VPS_Email_Runbook.md), [targeted read-only SQL](../../General/Sprint_12_Email_Readiness_Audit.sql), and [business questions B21–B24](../../General/Business_Analyst_Questions.md) form the handoff. Existing supplied 291–298 remain unchanged by this sprint; **299 is the only new migration**.

Remaining release gaps: current live schema/migration state, sender domain/DNS/provider account, reverse proxy/scheduler/environment secrets, approved-recipient end-to-end delivery, operator handling/retention of private audits, forthcoming rights-matrix trigger update, and the failed/bounced/replacement deadline rule. These are not represented as completed live work. No VPS deployment, live SQL application, customer email or Sprint 13 work was performed.
