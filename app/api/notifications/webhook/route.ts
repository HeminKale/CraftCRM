import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { notificationAdmin } from '../../../server/notifications/server';
import { rpc } from '../../../server/notifications/delivery';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const supported = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.complained', 'email.suppressed', 'email.opened', 'email.clicked']);

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ success: false }, { status: 503 });
  let event: any;
  const id = req.headers.get('svix-id') || '';
  try {
    if (Number(req.headers.get('content-length')) > 512 * 1024) throw new Error('oversize');
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 512 * 1024) throw new Error('oversize');
    event = await new Webhook(secret).verify(raw, {
      'svix-id': id, 'svix-timestamp': req.headers.get('svix-timestamp') || '',
      'svix-signature': req.headers.get('svix-signature') || '',
    });
  } catch { return NextResponse.json({ success: false }, { status: 400 }); }
  if (!supported.has(event?.type)) return NextResponse.json({ success: true });
  const recipients = event.data?.to;
  if (!id || typeof event.data?.email_id !== 'string' || !Array.isArray(recipients) || !recipients.length ||
    recipients.some(e => typeof e !== 'string') || !Number.isFinite(Date.parse(event.created_at))) {
    return NextResponse.json({ success: false }, { status: 400 });
  }
  try {
    await rpc(notificationAdmin(), 'record_resend_event', {
      p_event_id: id, p_provider: event.data.email_id, p_type: event.type,
      p_occurred: event.created_at, p_recipients: recipients.map(e => e.trim().toLowerCase()), p_details: event,
    });
    return NextResponse.json({ success: true });
  } catch { return NextResponse.json({ success: false }, { status: 503 }); }
}
