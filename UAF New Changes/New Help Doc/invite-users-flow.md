# Invite Users Flow (Setup → Roles and Users)

Craft CRM invites new users through a **custom token-based invitation system**, not Supabase Auth's built-in invite links directly. Supabase Auth is used only as the *email delivery mechanism* layered on top of our own `system.user_invitations` table — the token in our table, not the Supabase-generated one, is what actually gets validated and accepted.

---

## Are we using `supabase.auth.admin.inviteUserByEmail`?

**Yes, but only for sending the email — not for provisioning the account.**

`inviteUserByEmail` normally does two things in a stock Supabase app: (1) creates an `auth.users` row for the email in an unconfirmed/invited state, and (2) sends Supabase's invite email with a magic link that logs the user straight in.

We only want behavior (2). Our own `system.user_invitations` table is the source of truth for who was invited, what role/department they get, and which token is valid — so the actual `auth.users` account is **not** created at invite time. It's created later, at **accept** time, via `auth.admin.createUser()`.

Because of that split, `inviteUserByEmail`'s own generated link/token is discarded — we only use it to trigger Supabase's SMTP send. The `redirectTo` and `data` payload we pass point back to **our own** `/invite?token=...` link (using our token), not Supabase's.

If `inviteUserByEmail` errors with "already registered" (because an `auth.users` row for that email already exists from a prior invite/signup), we treat that as non-fatal — the email address already exists in `auth.users` but our own token flow still works, so we return success instead of blocking the invite.

---

## Why not just use Supabase's invite link end-to-end?

- We need multi-tenant fields (role, department, custom `tenant.roles` role) attached to the invite before the account exists — Supabase's invite doesn't model that.
- We need "pending / accepted / cancelled / expired" invitation lifecycle with Resend/Cancel actions in the UI — Supabase gives you a link, not a manageable record.
- We need RLS-scoped, tenant-isolated visibility into pending invitations (`get_pending_invitations`) — a custom table lets us enforce tenant isolation directly in SQL.
- PKCE isn't supported by `inviteUserByEmail` anyway (per Supabase docs) since the inviting browser and accepting browser differ — irrelevant to us either way since we don't use Supabase's generated link.

---

## Tables Used

### `system.user_invitations` (created in `138_user_invitations_table.sql`)

The single source of truth for an invitation, from creation to acceptance/cancellation/expiry.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | TEXT | Invitee email (constrained lowercase) |
| `first_name` / `last_name` | TEXT | Invitee name |
| `role` | TEXT | System role: `admin` or `user` |
| `department` | TEXT | Free-text department |
| `tenant_id` | UUID | FK → `system.tenants` — enforces multi-tenant isolation |
| `invitation_token` | TEXT | Unique random token (`encode(gen_random_bytes(32), 'hex')`) — the value embedded in `/invite?token=...` |
| `expires_at` | TIMESTAMPTZ | 7 days from creation/resend |
| `invited_by` | UUID | FK → `system.users` |
| `status` | TEXT | `pending` / `accepted` / `expired` / `cancelled` |
| `accepted_at` / `accepted_by` | — | Set by `accept_invitation` |
| `cancelled_at` / `cancelled_by` / `cancellation_reason` | — | Set by `cancel_invitation` |

### `system.users`

The invited person only gets a row here **after** they accept — `accept_invitation` inserts it, keyed to the real `auth.users.id` created via `auth.admin.createUser()`.

### `auth.users` (Supabase-managed)

Not touched at invite time. A real account is created only when the invite is accepted, via the service-role `auth.admin.createUser({ email, password, email_confirm: true })` call in `app/api/auth/accept-invitation/route.ts`.

---

## RPC Functions (all `SECURITY DEFINER`, defined in `138`, later fixed in `203`/`206`/`236`)

| Function | Purpose |
|---|---|
| `invite_user(p_email, p_first_name, p_last_name, p_role, p_department)` | Creates the `system.user_invitations` row + token. Does **not** send email or accept a custom role id (`tenant.roles`) yet — known gap, see below. |
| `validate_invitation(p_token)` | Looks up the invitation by token, checks expiry/status, returns invite details as JSONB. Called by `/invite` page before showing the "set password" step. Was accidentally dropped from later migrations until `236_fix_invitation_validation_and_rls.sql` restored it. |
| `accept_invitation(p_token, p_auth_user_id, p_first_name, p_last_name)` | Creates the `system.users` row using the **already-created** `auth.users.id` passed in, marks the invitation `accepted`. (Reworked in `210_fix_accept_invitation.sql` — the original version generated its own UUID and never created a real auth account, so invited users couldn't sign in.) |
| `cancel_invitation(p_invitation_id, p_reason)` | Admin-only. Marks invitation `cancelled`. |
| `resend_invitation(p_invitation_id)` | Admin-only. Rotates `invitation_token`, extends `expires_at` by 7 days, returns the `new_token` so the frontend can re-send the email with a fresh link. |
| `get_pending_invitations(p_tenant_id)` | Tenant-scoped list of pending invitations, joined to inviter's email, for the "Pending Invitations" table in the UI. |

RLS on `system.user_invitations` originally checked `auth.jwt()->'app_metadata'->>'tenant_id'`, a claim this app never populates (tenant_id is resolved by querying `system.users` client-side instead). `236_fix_invitation_validation_and_rls.sql` rewrote all 4 policies (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) to resolve `tenant_id` via a `system.users` lookup, matching the pattern used for `tenant.roles`.

---

## End-to-End Flow

1. **Admin clicks "Invite User"** in Setup → Roles and Users ([UserManagement.tsx](../../app/commonfiles/core/components/settings/UserManagement.tsx)) and submits the invite form.
2. **`handleInviteUser`** calls the `invite_user` RPC → row inserted into `system.user_invitations` with status `pending` and a fresh token.
3. Frontend does a follow-up `SELECT` on `system.user_invitations` to fetch that token, and builds the link `${origin}/invite?token=...`.
4. Frontend calls `POST /api/auth/send-invitation` ([route.ts](../../app/api/auth/send-invitation/route.ts)) with `{ email, token, tenantName, invitedBy, role }`. That route uses the **service-role** Supabase client to call `auth.admin.inviteUserByEmail(email, { redirectTo: ourInviteLink, data: {...} })`, which sends Supabase's transactional email pointing at our `/invite?token=...` URL.
5. Invite modal shows a success message ("Invitation email sent!" or a fallback if the send failed) plus the raw link as a manual-share backup, and the admin's "Pending Invitations" table (`get_pending_invitations`) lists it.
6. **Invitee opens `/invite?token=...`** ([app/invite/page.tsx](../../app/invite/page.tsx)). Page calls `validate_invitation(token)` to confirm it's still pending and unexpired, then shows a "set your password" form.
7. Form submits to `POST /api/auth/accept-invitation` ([route.ts](../../app/api/auth/accept-invitation/route.ts)), which:
   - Re-validates the token server-side.
   - Creates the real `auth.users` account via `adminSupabase.auth.admin.createUser({ email, password, email_confirm: true })`.
   - Calls `accept_invitation(token, authUserId, first_name, last_name)` to insert the `system.users` row and mark the invitation `accepted`.
   - Rolls back (`auth.admin.deleteUser`) if the `system.users` insert fails, so we never leave an orphaned auth account.
8. **Resend/Cancel** in the pending table call `resend_invitation` / `cancel_invitation`. Resend now also re-triggers `send-invitation` with the rotated token so the invitee gets a fresh email instead of a silently-updated link.

---

## Known Gap (not yet fixed)

`invite_user`'s signature (`p_email, p_first_name, p_last_name, p_role, p_department`) has no `p_custom_role_id` parameter, even though the invite form has a "Role" dropdown backed by `tenant.roles` (from `207_add_custom_roles.sql`). The selection is captured in frontend state but silently dropped — it's never sent to the RPC. Fixing this requires a migration adding the parameter and assigning `tenant.roles` on `system.users` at insert time in `accept_invitation`.
