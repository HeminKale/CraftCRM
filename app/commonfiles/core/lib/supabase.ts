import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Client-side Supabase client (for components)
export const createClientSupabaseClient = () => {
  return createClientComponentClient<Database>()
}

// Server-side Supabase client (for API routes)
export const createServerSupabaseClient = () => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Admin client for privileged operations
export const createAdminSupabaseClient = () => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

// Utility function to get tenant-aware client
export const getTenantAwareClient = () => {
  const supabase = createClientComponentClient<Database>()
  return supabase
} 