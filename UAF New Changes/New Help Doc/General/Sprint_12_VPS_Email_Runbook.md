# Sprint 12 local handoff: Hostinger VPS and Resend

Sprint 13 follow-up: upload-based deadline/reminder/suspension transitions are implemented locally in 301 and private shared DOCX support in 302, with live scheduling off. The actual letter's content/layout/activation and BA's Reject decision remain pending. See [the current Sprint 13 handoff](Sprint_13_Local_Handoff.md). The Sprint 12 implementation record below describes its earlier handoff state.

18 October 2026. Implementation is local. These are future operator instructions, not a record of deployed changes. No live database, DNS, VPS, provider settings or customer mail has been changed. Sprint 13 remains unstarted.

Use the existing Hostinger VPS for the Next app and scheduled worker, with Resend as the outbound provider over HTTPS. An existing Hostinger mailbox can receive replies through `RESEND_REPLY_TO`. No new SMTP server is needed. The email destination always comes from the workflow record's `email__a` or the invitation's stored email. A PDF's internal text is not parsed for a different recipient. When application-form and letter addresses disagree, correct/confirm the record first.

## Database and release order

Use the complete [migration handoff](Manual_Migrations_291_298.md). Earlier supplied 291–298 remain prerequisites; current revised 298 is required. **299_notification_outbox.sql is the only Sprint 12 addition.** Apply nothing automatically. Deploy matching application code only after manual database review/application. Migration 299 adds no historical sends, timers, suspension statuses or enforcement.

For schema evidence before application, use [read-only readiness SQL](Sprint_12_Email_Readiness_Audit.sql). PostgreSQL checks were run in isolated fixtures; live Supabase metadata, grants, Storage access and account delivery have not been validated.

## Server configuration

Keep these in the server's existing protected environment configuration; never commit values, expose them as NEXT_PUBLIC variables, paste them into chat or put worker credentials in a process command line:

| Setting | Purpose |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only worker/database/Storage access; existing `NEXT_PUBLIC_SUPABASE_URL` identifies the project |
| `RESEND_API_KEY` | Sending key for the verified sender domain |
| `RESEND_FROM_ADDRESS` | Required single sender email address; no hardcoded fallback; verify its domain in Resend first |
| `RESEND_REPLY_TO` | Optional monitored reply mailbox; replies do not update workflow responses |
| `RESEND_WEBHOOK_SECRET` | Signing secret for this webhook endpoint, separate from API/worker keys |
| `NOTIFICATION_WORKER_SECRET` | Random secret of at least 32 characters, shared only by app and scheduler |
| `EMAIL_APP_URL` | Canonical HTTPS origin, e.g. `https://portal.example.com`; no path/query/credentials; falls back to NEXT_PUBLIC_APP_URL |
| `EMAIL_DELIVERY_ENABLED` | Must equal `true` to submit any mail; absent/false means fail closed |
| `EMAIL_DELIVERY_MODE` | Defaults to `test`; `live` must be explicitly set by the operator during an authorised release |
| `EMAIL_TEST_RECIPIENTS` | In test mode, explicit comma-separated approved addresses. No redirection of customer messages. |
| `NOTIFICATION_APP_ORIGIN` | Scheduler's app origin; defaults to `http://127.0.0.1:3000`; HTTPS also supported |

Confirm the provider account's sender-domain verification, SPF/DKIM and existing DMARC/DNS alignment, sending quota and region, monitored reply mailbox, and public HTTPS reverse proxy. Do not create a second SPF record or replace existing mailbox MX records blindly. Account/domain readiness is an operator check, not inferred from local environment files.

## Scheduler preparation

Repository entry point: `scripts/notification-worker.mjs` (Node 18+). It submits one bounded POST to `/api/notifications/worker`, with the bearer secret in the request header. It never prints the secret or response body. One request claims at most one item. The secure route checks configuration before claiming; anonymous/browser calls are denied. The worker and invitation routes do not create Supabase Auth users.

On the VPS, prepare a systemd oneshot service using the deployment's actual absolute directory:

```ini
[Unit]
Description=Certification notification outbox worker
After=network-online.target

[Service]
Type=oneshot
User=YOUR_EXISTING_APP_SERVICE_USER
WorkingDirectory=/YOUR/EXISTING/APP/DIRECTORY
EnvironmentFile=/YOUR/PROTECTED/notification-worker.env
ExecStart=/usr/bin/node /YOUR/EXISTING/APP/DIRECTORY/scripts/notification-worker.mjs
NoNewPrivileges=true
```

The scheduler environment file needs only `EMAIL_DELIVERY_ENABLED`, `NOTIFICATION_WORKER_SECRET`, and `NOTIFICATION_APP_ORIGIN`. Provider/database secrets stay in the app environment. Restrict environment-file permissions to the service user/root. Prepare a paired timer with `OnBootSec=1min`, `OnUnitActiveSec=15s`, `AccuracySec=1s`, and `[Install] WantedBy=timers.target`. The service name in the timer must match the chosen oneshot unit. Installing/enabling/restarting is a future deployment action. None was done here.

This rate gives roughly four queue attempts per minute and avoids aggressive provider traffic. Review queue age/quota and adjust only after measuring approved test traffic. Multiple workers use SKIP LOCKED and fenced five-minute leases. Missing configuration returns 503 without claiming; the scheduler logs a generic failure. Monitor the timer/service and database queue rather than treating an HTTP 200 as proof of delivery.

## Verified webhook setup

In the Resend dashboard, register the public HTTPS `/api/notifications/webhook` endpoint for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.failed`, `email.complained`, and `email.suppressed`. Open/click events are optional and never constitute acceptance. Use that endpoint's signing secret. Preserve raw request bodies and the `svix-id`, `svix-timestamp`, and `svix-signature` headers through the reverse proxy. Svix 1.99.1 is used for compatibility with the project's Node 18+ baseline; verification is awaited.

The handler verifies the exact raw body and signature/timestamp before any write. It acknowledges only after durable persistence, returns 503 on database failure so the provider can retry, and deduplicates by `svix-id`. Unmatched provider IDs are retained for send-response race reconciliation. Matching requires the stored provider ID and exact normalised single recipient. Event arrival order does not erase delivery/failure timestamps or turn a bounced notice back into success. A database failure or provider acceptance is not a software response.

## Recovery and audit

- `queued` means durable work exists; `sending` is a leased attempt; `retry` has a future due time. Provider acceptance means the API accepted the request. `delivered` means the recipient mail server accepted it, not that the person read it. Bounce, failed, complained, delayed and suppressed remain explicit.
- Retry transport errors, timeout/unknown result, HTTP 408/429/5xx and Resend concurrent-idempotency 409. Permanent errors (including different-payload 409) stop. Backoff starts at 30 seconds and doubles to a one-hour cap; a longer Retry-After is honoured up to 24 hours. At most eight claims; ambiguous requests older than 23 hours go to `review` before Resend's 24-hour idempotency expires. Never blindly requeue an uncertain notice under a new key.
- Exact sender/recipient/body/attachment bytes are saved before the first provider request. Retries use the same `craft-notice/<outbox UUID>` key and pinned payload. A required attachment download failure does not produce a misleading attachment-free notice. The 10 MB raw attachment cap bounds payload storage, though account/API total message limits must also be respected.
- Missing/invalid email yields a blocked audit row. Changed/deleted records, rotated/expired/cancelled invitations are rechecked at claim; stale destinations are blocked. Correct the business record first. No automatic guessing or recipient fallback occurs. There is no operator requeue UI in Sprint 12; authorised manual recovery must inspect recipient, first_request_at, provider state/events and attempts before any queue write. For an unsent blocked intimation, uploading a corrected replacement creates a new revision from the current record email. Existing uncertain/accepted mail is never modified.
- Replacement letters retain round 1, use attachment UUID revisions, and cancel only superseded work that has not been submitted. Already submitted/in-flight messages cannot be recalled. A creation alert waits two minutes, and an intimation upload cancels an unsent creation alert; if creation was already sent, the later letter is a distinct delivery. Neither creates notice round 2 or starts a deadline.
- Audit tables store recipients, invitation tokens, immutable payloads and signed event details privately. Normal users cannot select or mutate them. The history RPC returns only limited delivery/response evidence, scoped by tenant, object permission, sharing and linked client/CRM/admin. Retention/access/export policy is still a business/operations decision.
- Failed/bounced notices do not start any deadline here. `deadline_start_at` is constrained to NULL. Software intimation Accept/Reject has its own actor/time/revision audit; existing workflow action panels remain authoritative for other responses. No inbound email processing, suspension timing or status automation was added.

After manual migration/deployment approval, use disposable records with an explicitly approved test recipient. Confirm enqueue after finalisation, provider acceptance, signed delivered/bounce events, rotation/cancellation, wrong tenant denial and replacement history. Review any pre-release queued records before enabling delivery. Local mocks do not prove live mailbox delivery. Rights-matrix additions and deadline rules remain pending the user's update.
