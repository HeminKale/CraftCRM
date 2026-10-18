import { NextRequest, NextResponse } from 'next/server';
import { notificationAdmin, workerAuthorised } from '../../../server/notifications/server';
import { deliveryConfig, deliverOne } from '../../../server/notifications/delivery';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!workerAuthorised(req.headers.get('authorization'))) return NextResponse.json({ success: false }, { status: 401 });
  try {
    const config = deliveryConfig(); // Fail closed before claiming work.
    const processed = await deliverOne(notificationAdmin(), config);
    return NextResponse.json({ success: true, processed });
  } catch {
    return NextResponse.json({ success: false, message: 'Worker unavailable; check configuration and notification audit' }, { status: 503 });
  }
}
