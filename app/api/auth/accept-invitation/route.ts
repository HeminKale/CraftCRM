import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { token, password, first_name, last_name } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ success: false, message: 'Token and password are required' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ success: false, message: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var');
      return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }

    // Admin client — service role key, bypasses RLS
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Validate the invitation token first (before creating any auth account)
    const { data: validationData, error: validationError } = await adminSupabase
      .rpc('validate_invitation', { p_token: token });

    if (validationError) {
      return NextResponse.json({ success: false, message: validationError.message }, { status: 400 });
    }

    const validation = validationData?.[0];
    if (!validation?.valid) {
      return NextResponse.json({ success: false, message: validation?.message || 'Invalid invitation' }, { status: 400 });
    }

    const invitationEmail: string = validation.invitation.email;

    // 2. Create the Supabase auth account using service role (email already confirmed)
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: invitationEmail,
      password,
      email_confirm: true,  // skip email confirmation — they validated via token
      user_metadata: {
        first_name: first_name || validation.invitation.first_name || '',
        last_name:  last_name  || validation.invitation.last_name  || '',
      }
    });

    if (authError) {
      // Handle case where auth user already exists
      if (authError.message.includes('already registered')) {
        return NextResponse.json({ success: false, message: 'An account with this email already exists. Please sign in.' }, { status: 409 });
      }
      console.error('auth.admin.createUser error:', authError);
      return NextResponse.json({ success: false, message: authError.message }, { status: 400 });
    }

    const authUserId = authData.user.id;

    // 3. Create system.users row and mark invitation accepted
    const { data: acceptData, error: acceptError } = await adminSupabase
      .rpc('accept_invitation', {
        p_token:        token,
        p_auth_user_id: authUserId,
        p_first_name:   first_name || null,
        p_last_name:    last_name  || null,
      });

    if (acceptError) {
      // Roll back the auth user if system.users creation failed
      await adminSupabase.auth.admin.deleteUser(authUserId);
      console.error('accept_invitation RPC error:', acceptError);
      return NextResponse.json({ success: false, message: acceptError.message }, { status: 400 });
    }

    const result = acceptData?.[0];
    if (!result?.success) {
      // Roll back the auth user
      await adminSupabase.auth.admin.deleteUser(authUserId);
      return NextResponse.json({ success: false, message: result?.message || 'Failed to accept invitation' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Account created successfully. You can now sign in.' });

  } catch (err: any) {
    console.error('accept-invitation route error:', err);
    return NextResponse.json({ success: false, message: 'An unexpected error occurred' }, { status: 500 });
  }
}
