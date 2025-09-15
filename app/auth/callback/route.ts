import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type')

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    
    try {
      if (type === 'recovery') {
        // Handle password recovery
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        
        if (error) {
          console.error('❌ Password recovery error:', error)
          return NextResponse.redirect(`${requestUrl.origin}/auth?error=recovery_failed`)
        }
        
        // Redirect to password reset page
        return NextResponse.redirect(`${requestUrl.origin}/reset-password`)
      } else {
        // Handle email confirmation
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        
        if (error) {
          console.error('❌ Email confirmation error:', error)
          return NextResponse.redirect(`${requestUrl.origin}/auth?error=confirmation_failed`)
        }
        
        // Redirect to dashboard after successful confirmation
        return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
      }
    } catch (error) {
      console.error('❌ Auth callback error:', error)
      return NextResponse.redirect(`${requestUrl.origin}/auth?error=callback_failed`)
    }
  }

  // If no code, redirect to auth page
  return NextResponse.redirect(`${requestUrl.origin}/auth`)
}
