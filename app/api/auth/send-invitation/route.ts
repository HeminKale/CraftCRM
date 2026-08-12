import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============================================================
// Sends the invitation email — Resend REST API, same pattern as
// app/api/notifications/send/route.ts (fetch, not the `resend` npm
// package — kept dependency-free the same way that route already is).
//
// Was previously calling supabase.auth.admin.inviteUserByEmail(), which
// looked like a pure "send an email" call but actually provisions the
// auth.users row immediately as a side effect (documented Supabase Admin
// API behavior) — in an unconfirmed, no-password "invited" state, before
// the invitee has done anything. accept-invitation/route.ts then tried to
// auth.admin.createUser() the SAME email at accept time, assuming no
// account existed yet — which fails as "already registered" against the
// account this route had already silently created, dead-ending every
// first-time invite at the password-setup step (the pre-created account
// has no password, and this app's /invite page never implements Supabase's
// own separate invite-confirmation flow that would let them set one).
//
// Fixed by not touching auth.users here at all — this route now only ever
// sends an email containing the app's own custom /invite?token= link
// (system.user_invitations.invitation_token, unrelated to Supabase's own
// invite-token system). accept-invitation/route.ts remains the ONLY place
// that creates the auth.users row, exactly as its own migration 210
// header already claimed was the design.
//
// Non-blocking by design, matching /api/notifications/send: always
// responds 200 with a `success` flag. UserManagement.tsx already falls
// back to showing the invite link for manual sharing when this returns
// success:false — missing RESEND_API_KEY is the expected state until
// Resend is configured, not a hard failure.
// ============================================================

function buildInvitationEmail(data: {
  inviteUrl: string;
  tenantName: string;
  invitedBy: string;
  role: string;
}): { subject: string; html: string } {
  const roleLabel = data.role.charAt(0).toUpperCase() + data.role.slice(1);
  return {
    subject: `You're invited to join ${data.tenantName}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">You're Invited</h1>
        </div>
        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hello,</p>
          <p>You've been invited by <strong>${data.invitedBy}</strong> to join <strong>${data.tenantName}</strong>.</p>
          <p><strong>Role:</strong> ${roleLabel}</p>
          <p>Click below to set up your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.inviteUrl}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Accept Invitation
            </a>
          </div>
          <p style="font-size: 13px; color: #6b7280;">This invitation expires in 7 days. If the button doesn't work, copy this link:<br/>${data.inviteUrl}</p>
        </div>
      </div>
    `,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { email, token, tenantName, invitedBy, role } = await req.json();

    if (!email || !token) {
      return NextResponse.json({ success: false, message: 'Missing email or token' }, { status: 200 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_ADDRESS || 'sales1@twe.co.in';

    if (!apiKey) {
      // Soft-fail: Resend not configured yet — never blocks invitation
      // creation. UserManagement.tsx already shows the invite link for
      // manual sharing in this case.
      console.warn('send-invitation: RESEND_API_KEY not set, skipping send');
      return NextResponse.json({ success: false, message: 'Email not sent: Resend is not configured yet' }, { status: 200 });
    }

    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/invite?token=${token}`;
    const { subject, html } = buildInvitationEmail({
      inviteUrl,
      tenantName: tenantName || 'your organization',
      invitedBy: invitedBy || 'an administrator',
      role: role || 'user',
    });

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: email, subject, html }),
    });

    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error('send-invitation: Resend error', result);
      return NextResponse.json({ success: false, message: result?.message || 'Failed to send invitation email' }, { status: 200 });
    }

    return NextResponse.json({ success: true, message: 'Invitation email sent', id: result?.id });

  } catch (err: any) {
    console.error('send-invitation route error:', err);
    return NextResponse.json({ success: false, message: 'Failed to send invitation email' }, { status: 200 });
  }
}
