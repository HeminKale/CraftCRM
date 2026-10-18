import { NextRequest, NextResponse } from 'next/server';
import { notificationUser } from '../../../server/notifications/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Acknowledge transactional database work. Never send browser-supplied content.
export async function POST(req: NextRequest) {
  const client = await notificationUser();
  if (!client) return NextResponse.json({ success: false }, { status: 401 });
  try {
    const { token } = await req.json();
    if (typeof token !== 'string' || !token || token.length > 512) return NextResponse.json({ success: false }, { status: 400 });
    const { data, error } = await client.rpc('check_invitation_notification', { p_token: token });
    if (error) return NextResponse.json({ success: false, message: 'Notification unavailable' }, { status: 403 });
    return NextResponse.json(data, { status: data?.success ? 202 : 409 });
  } catch { return NextResponse.json({ success: false }, { status: 400 }); }
}
