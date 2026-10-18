# Invite users ? current implementation

This describes the source on `SummaryUpload`, not an assertion that every SQL
migration or environment value has been applied to production.

## Components

- `app/commonfiles/core/components/settings/UserManagement.tsx`: invitation UI,
  role selection, pending-invitation list, resend and cancel.
- `supabase/migrations/270_fix_invite_custom_role.sql`: custom-role support in
  `invite_user` and `accept_invitation`.
- `app/api/auth/send-invitation/route.ts`: sends an email through Resend's REST API.
- `app/invite/page.tsx` and `app/api/auth/accept-invitation/route.ts`: token
  validation, password setup and account acceptance.

## Flow

1. Admin enters the person's details and selected custom role.
2. The UI calls `invite_user`, including `p_custom_role_id`. The database records
   the invitation/token and validates that the selected role belongs to the tenant.
3. The UI calls `/api/auth/send-invitation` with the recipient and token. This
   endpoint sends a Resend email containing the application's `/invite?token=...`
   link. It does NOT call Supabase `inviteUserByEmail` and does not create an
   `auth.users` account at invitation-send time.
4. The invitee follows the link, the invitation is validated, and they choose a
   password. The acceptance endpoint creates the Auth account and completes the
   application's invitation acceptance, including the selected custom role.
5. Resend rotates/reissues the application's invitation token and sends its new
   link. Cancel invalidates the invitation through the existing cancellation RPC.

Resend configuration uses `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, and
`NEXT_PUBLIC_APP_URL`. The application URL must identify the intended frontend so
emailed invitation links are complete. Check actual environment configuration
separately; this documentation does not establish that mail is configured live.

Mail failures are reported with `success:false` in an HTTP 200 response. The UI
can show the invitation link for manual sharing; callers must inspect `success`
rather than treating HTTP 200 as proof of delivery.

The earlier account-creation collision and silently dropped custom-role selection
are fixed in the current source/migration 270. They are historical issues, not
current instructions to reintroduce Supabase's invitation-email flow. Verify the
live function signature and perform a disposable invitation test before claiming
the production invitation flow is verified.
# Sprint 12 update — 18 October 2026

Local implementation now queues invitation email transactionally when an invitation is created or its token rotates. `/api/auth/send-invitation` authenticates the caller, checks the stored tenant invitation, and acknowledges its outbox entry; it ignores browser-supplied email/labels and does not call Resend directly. Provider delivery is performed by the protected server worker and recorded separately from invitation acceptance. Manual sharing remains available. Supabase Auth account creation still occurs only through the existing acceptance flow. Read the [Sprint 12 runbook](Sprint_12_VPS_Email_Runbook.md) before future migration/configuration/deployment; nothing has been deployed or sent live by this sprint.
