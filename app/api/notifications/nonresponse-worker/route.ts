import { NextRequest, NextResponse } from 'next/server';
import { notificationAdmin, workerAuthorised } from '../../../server/notifications/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!workerAuthorised(req.headers.get('authorization'))) return NextResponse.json({ success: false }, { status: 401 });
  if (process.env.NONRESPONSE_AUTOMATION_ENABLED !== 'true') {
    return NextResponse.json({ success: false, message: 'Non-response scheduling is disabled' }, { status: 503 });
  }
  try {
    const { data, error } = await notificationAdmin().rpc('process_nonresponse');
    if (error || !data || typeof data.processed !== 'boolean') throw new Error('worker_unavailable');
    return NextResponse.json({ success: true, processed: data.processed, outcome: data.outcome });
  } catch {
    return NextResponse.json({ success: false, message: 'Non-response worker unavailable' }, { status: 503 });
  }
}
