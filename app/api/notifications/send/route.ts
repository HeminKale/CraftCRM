import { NextRequest, NextResponse } from 'next/server';
import { notificationUser } from '../../../server/notifications/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Acknowledge transactional database work. Never send browser-supplied content.
export async function POST(req: NextRequest) {
  const client = await notificationUser();
  if (!client) return NextResponse.json({ success: false }, { status: 401 });
  try {
    const { objectName, recordId } = await req.json();
    if (!['renewal_clients__a', 'recertification_clients__a'].includes(objectName) || !/^[a-f0-9-]{36}$/i.test(recordId || '')) {
      return NextResponse.json({ success: false, message: 'Record reference required' }, { status: 400 });
    }
    const { data, error } = await client.rpc('check_record_notification', { p_object: objectName, p_record: recordId });
    if (error) return NextResponse.json({ success: false, message: 'Notification unavailable' }, { status: 403 });
    return NextResponse.json(data, { status: data?.success ? 202 : 409 });
  } catch { return NextResponse.json({ success: false }, { status: 400 }); }
}
