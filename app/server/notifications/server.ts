import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';

export function notificationAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('notification_database_unconfigured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(25000) }) },
  });
}

export async function notificationUser() {
  const client = createRouteHandlerClient({ cookies });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : client;
}

export function workerAuthorised(header: string | null, secret = process.env.NOTIFICATION_WORKER_SECRET) {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
