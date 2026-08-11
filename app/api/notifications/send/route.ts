import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============================================================
// Generic transactional-email route (Resend).
//
// Part of Surveillance 1 (Renewal) Sprint 0 — see
// UAF New Changes/New Help Doc/Renewal/Sprints/00_Sprint_Plan.md.
//
// Deliberately generic ({ to, template, data }) rather than a one-off
// "send intimation email" endpoint — every future "get email" checkpoint
// in the Surveillance 1 rights matrix (Sprints 1-3) can add a template here
// instead of a new route. Mirrors send-invitation's shape (service-role
// context, no client-side API key exposure) but is NOT Auth-specific —
// this sends to arbitrary addresses, not just system.users accounts.
//
// Callers are expected to treat failures as non-blocking (toast warning
// only) — this route always responds 200 with a `success` flag, never a
// 4xx/5xx that would make a caller's generic error handling look scarier
// than it should for what is, by design, a best-effort notification.
// ============================================================

type TemplateBuilder = (data: Record<string, any>) => { subject: string; html: string };

const TEMPLATES: Record<string, TemplateBuilder> = {
  surveillance_intimation: (data) => {
    const company = data.companyName || 'your organization';
    return {
      subject: `Surveillance Audit Intimation — ${company}`,
      html: `
        <p>Dear ${data.contactPerson || 'Sir/Madam'},</p>
        <p>This is to inform you that a surveillance audit record has been created for
        <strong>${company}</strong>. ${data.hasLetter
          ? 'The surveillance intimation letter has been attached to your record.'
          : 'The surveillance intimation letter will follow shortly.'}</p>
        <p>Please log in to your portal to review and respond.</p>
        <p>Regards,<br/>TWE Surveillance Team</p>
      `,
    };
  },

  // Recertification Sprint 0 — see
  // UAF New Changes/New Help Doc/Recertification/00_Sprint_Plan.md
  recertification_intimation: (data) => {
    const company = data.companyName || 'your organization';
    return {
      subject: `Recertification Audit Intimation — ${company}`,
      html: `
        <p>Dear ${data.contactPerson || 'Sir/Madam'},</p>
        <p>This is to inform you that a recertification audit record has been created for
        <strong>${company}</strong>. ${data.hasLetter
          ? 'The recertification intimation letter has been attached to your record.'
          : 'The recertification intimation letter will follow shortly.'}</p>
        <p>Please log in to your portal to review and respond.</p>
        <p>Regards,<br/>TWE Recertification Team</p>
      `,
    };
  },
};

export async function POST(req: NextRequest) {
  try {
    const { to, template, data } = await req.json();

    if (!to || !template) {
      return NextResponse.json({ success: false, message: 'Missing to or template' }, { status: 200 });
    }

    const build = TEMPLATES[template];
    if (!build) {
      return NextResponse.json({ success: false, message: `Unknown template: ${template}` }, { status: 200 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_ADDRESS || 'sales1@twe.co.in';

    if (!apiKey) {
      // Soft-fail: Resend not configured yet — never blocks the caller's flow.
      console.warn('notifications/send: RESEND_API_KEY not set, skipping send');
      return NextResponse.json({ success: false, message: 'Email not sent: Resend is not configured yet' }, { status: 200 });
    }

    const { subject, html } = build(data || {});

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error('notifications/send: Resend error', result);
      return NextResponse.json({ success: false, message: result?.message || 'Failed to send email' }, { status: 200 });
    }

    return NextResponse.json({ success: true, message: 'Email sent', id: result?.id });

  } catch (err: any) {
    console.error('notifications/send route error:', err);
    return NextResponse.json({ success: false, message: 'Failed to send email' }, { status: 200 });
  }
}
