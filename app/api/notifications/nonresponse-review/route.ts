import { NextRequest, NextResponse } from 'next/server';
import { notificationAdmin, workerAuthorised } from '../../../server/notifications/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Evidence review only. There is deliberately no switch for starting deadlines,
// sending round 2, suspending, or restoring clients under an unapproved policy.
export async function POST(req: NextRequest) {
  if (!workerAuthorised(req.headers.get('authorization'))) return NextResponse.json({ success: false }, { status: 401 });
  if (process.env.NONRESPONSE_REVIEW_ENABLED !== 'true') {
    return NextResponse.json({ success: false, message: 'Non-response evidence review is disabled' }, { status: 503 });
  }
  try {
    const { data, error } = await notificationAdmin().rpc('review_nonresponse_evidence');
    if (error || !data || data.automation_enabled !== false) throw new Error('review_unavailable');
    return NextResponse.json({ success: true, processed: data.processed === true, automation_enabled: false });
  } catch {
    return NextResponse.json({ success: false, message: 'Non-response review unavailable' }, { status: 503 });
  }
}
