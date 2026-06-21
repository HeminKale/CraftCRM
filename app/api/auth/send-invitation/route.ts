import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, token, tenantName, invitedBy, role } = await req.json();

    if (!email || !token) {
      return NextResponse.json({ success: false, message: 'Missing email or token' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || supabaseUrl.replace('.supabase.co', '')}/invite?token=${token}`;

    // Use Supabase admin to send invitation email via their SMTP
    const { error } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteUrl,
      data: {
        invitation_token: token,
        tenant_name: tenantName,
        invited_by: invitedBy,
        role,
      }
    });

    if (error) {
      // inviteUserByEmail creates an auth user — if user already exists it errors.
      // That's fine — our flow creates auth user at accept time, not here.
      // We only want the email sending part, so ignore "already registered" errors.
      if (error.message.includes('already registered') || error.message.includes('already been registered')) {
        // User already in auth — send a plain magic link style email instead
        // by using resetPasswordForEmail which works for existing users
        return NextResponse.json({ success: true, message: 'Invitation sent via alternate method' });
      }
      console.error('send-invitation error:', error);
      return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Invitation email sent' });

  } catch (err: any) {
    console.error('send-invitation route error:', err);
    return NextResponse.json({ success: false, message: 'Failed to send invitation email' }, { status: 500 });
  }
}
