'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '../../core/providers/SupabaseProvider'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Eye, EyeOff, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function AuthPage() {
  const { user, loading } = useSupabase()
  const router = useRouter()
  const supabase = createClientComponentClient()

  const [isSignUp, setIsSignUp] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [selectedOrganization, setSelectedOrganization] = useState('')
  const [isNewOrganization, setIsNewOrganization] = useState(false)
  const [organizations, setOrganizations] = useState<Array<{id: string, name: string}>>([])
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showEmailConfirmation, setShowEmailConfirmation] = useState(false)
  const [showPasswordResetConfirmation, setShowPasswordResetConfirmation] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard')
    }
  }, [user, loading, router])

  // Debug log for state changes
  useEffect(() => {
    console.log('🔐 AuthPage state changed:', { isSignUp, isForgotPassword, showEmailConfirmation, showPasswordResetConfirmation })
  }, [isSignUp, isForgotPassword, showEmailConfirmation, showPasswordResetConfirmation])

  // Load existing organizations
  useEffect(() => {
    const loadOrganizations = async () => {
      try {
        const { data, error } = await supabase
          .rpc('get_tenants')
        
        if (error) {
          console.error('❌ Error loading organizations:', error)
        } else {
          console.log('✅ Organizations loaded:', data)
          setOrganizations(data || [])
        }
      } catch (error) {
        console.error('❌ Error loading organizations:', error)
      }
    }

    if (isSignUp) {
      loadOrganizations()
    }
  }, [isSignUp, supabase])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Please enter a valid email'
    }

    // For forgot password, only email validation is needed
    if (isForgotPassword) {
      setErrors(newErrors)
      return Object.keys(newErrors).length === 0
    }

    if (!password) {
      newErrors.password = 'Password is required'
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters'
    }

    if (isSignUp) {
      if (!firstName.trim()) {
        newErrors.firstName = 'First name is required'
      }
      if (!lastName.trim()) {
        newErrors.lastName = 'Last name is required'
      }
      if (isNewOrganization) {
        if (!companyName.trim()) {
          newErrors.companyName = 'Organization name is required'
        }
      } else {
        if (!selectedOrganization) {
          newErrors.organization = 'Please select an organization'
        }
      }
      if (password !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const createTenantAndUser = async (userId: string, userEmail: string) => {
    try {
      let tenantId: string

      if (isNewOrganization) {
        console.log('🔍 AuthPage: Creating new tenant:', companyName)
        const { data: tenant, error: tenantError } = await supabase
          .rpc('create_tenant', {
            tenant_name: companyName
          })

        if (tenantError) {
          console.error('❌ Error creating new tenant:', tenantError)
          throw new Error(`Failed to create new tenant: ${tenantError.message}`)
        }

        tenantId = tenant[0].id
        console.log('✅ New tenant created:', tenantId)
      } else {
        tenantId = selectedOrganization
        console.log('🔍 AuthPage: Using existing tenant:', tenantId)
      }

      console.log('🔍 AuthPage: Creating user profile...')
      const { error: userError } = await supabase
        .rpc('create_user', {
          p_user_id: userId,
          p_tenant_id: tenantId,
          p_user_email: userEmail,
          p_first_name: firstName,
          p_last_name: lastName,
          p_user_role: isNewOrganization ? 'admin' : 'user'
        })

      if (userError) {
        console.error('❌ Error creating user profile:', userError)
        throw new Error(`Failed to create user profile: ${userError.message}`)
      }

      console.log('✅ User profile created successfully')
      return true
    } catch (error) {
      console.error('❌ Error in createTenantAndUser:', error)
      return false
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('🔐 handleForgotPassword called with email:', email)
    setAuthLoading(true)
    setErrors({})

    console.log('🔐 Validating form...')
    if (!validateForm()) {
      console.log('❌ Form validation failed')
      setAuthLoading(false)
      return
    }
    console.log('✅ Form validation passed')

    try {
      console.log('🔐 Starting password reset for:', email)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`
      })
      
      if (error) {
        console.error('❌ Password reset error:', error)
        setErrors({ email: error.message })
        toast.error(error.message)
      } else {
        console.log('✅ Password reset email sent successfully')
        setShowPasswordResetConfirmation(true)
        toast.success('Password reset email sent! Please check your email.')
      }
    } catch (error) {
      console.error('❌ Unexpected error:', error)
      toast.error('An unexpected error occurred')
    } finally {
      console.log('🔐 Setting authLoading to false')
      setAuthLoading(false)
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('🔐 handleEmailAuth called')
    setAuthLoading(true)
    setErrors({})

    console.log('🔐 Validating form...')
    if (!validateForm()) {
      console.log('❌ Form validation failed')
      setAuthLoading(false)
      return
    }
    console.log('✅ Form validation passed')

    try {
      if (isSignUp) {
        console.log('🔐 Starting Sign Up process for:', email)
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        })
        
        if (error) {
          console.error('❌ Sign up error:', error)
          setErrors({ email: error.message })
          toast.error(error.message)
        } else if (data.user) {
          console.log('✅ User created, creating tenant and profile...')
          const success = await createTenantAndUser(data.user.id, email)
          if (success) {
            console.log('✅ Tenant and user created successfully')
            setShowEmailConfirmation(true)
            toast.success('Account created! Please check your email to confirm your account.')
          } else {
            console.log('✅ Auth user created, email sent for confirmation')
            setShowEmailConfirmation(true)
            toast.success('Account created! Please check your email to confirm your account.')
          }
        }
      } else {
        console.log('🔐 Starting Sign In process for:', email)
        console.log('🔐 Calling supabase.auth.signInWithPassword...')
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })
        
        console.log('🔐 Sign in result:', { data: !!data, error: !!error, user: data?.user?.id })
        
        if (error) {
          console.error('❌ Sign in error:', error)
          setErrors({ email: error.message })
          toast.error(error.message)
        } else {
          console.log('✅ Sign in successful, redirecting to dashboard...')
          console.log('🔐 User data:', data.user)
          router.push('/dashboard')
        }
      }
    } catch (error) {
      console.error('❌ Unexpected error:', error)
      toast.error('An unexpected error occurred')
    } finally {
      console.log('🔐 Setting authLoading to false')
      setAuthLoading(false)
    }
  }

  const clearErrors = (field: string) => {
    setErrors(prev => {
      const newErrors = { ...prev }
      delete newErrors[field]
      return newErrors
    })
  }

  return (
    <div className="w-screen h-screen flex">
      {/* Left: Login Form */}
      <div className="w-1/2 h-screen bg-white flex items-center justify-center">
        <div className="w-full max-w-md mx-auto p-8 flex flex-col justify-center">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {isForgotPassword ? 'Reset your password' : isSignUp ? 'Create your account' : 'Sign in to your account'}
            </h2>
          </div>

          {/* Email Confirmation Message */}
          {showEmailConfirmation && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md text-center">
              <div className="flex items-center justify-center mb-2">
                <svg className="w-6 h-6 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-blue-600 font-semibold">Check Your Email</span>
              </div>
              <p className="text-blue-700 text-sm">
                We've sent a confirmation link to <strong>{email}</strong>
              </p>
              <p className="text-blue-600 text-xs mt-1">
                Click the link in your email to activate your account
              </p>
              <button
                type="button"
                onClick={() => setShowEmailConfirmation(false)}
                className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Continue to Sign In
              </button>
            </div>
          )}

          {/* Password Reset Confirmation Message */}
          {showPasswordResetConfirmation && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md text-center">
              <div className="flex items-center justify-center mb-2">
                <svg className="w-6 h-6 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-green-600 font-semibold">Check Your Email</span>
              </div>
              <p className="text-green-700 text-sm">
                We've sent a password reset link to <strong>{email}</strong>
              </p>
              <p className="text-green-600 text-xs mt-1">
                Click the link in your email to reset your password
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordResetConfirmation(false)
                  setIsForgotPassword(false)
                }}
                className="mt-3 bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700 transition-colors"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {/* Email/Password Form */}
          {!showEmailConfirmation && !showPasswordResetConfirmation && (
            <form onSubmit={isForgotPassword ? handleForgotPassword : handleEmailAuth} className="mt-8 space-y-6">
              {/* Organization Selection (Sign Up only) */}
              {isSignUp && (
                <div>
                  <label htmlFor="organization" className="block text-sm font-medium text-gray-700 mb-1">
                    Organization
                  </label>
                  
                  <div className="relative">
                    <select
                      id="organization"
                      value={isNewOrganization ? 'new' : selectedOrganization}
                      onChange={(e) => {
                        const value = e.target.value
                        if (value === 'new') {
                          setIsNewOrganization(true)
                          setSelectedOrganization('')
                          setCompanyName('')
                          clearErrors('organization')
                          clearErrors('companyName')
                        } else {
                          setIsNewOrganization(false)
                          setSelectedOrganization(value)
                          setCompanyName('')
                          clearErrors('organization')
                          clearErrors('companyName')
                        }
                      }}
                      className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        (errors.organization || errors.companyName) ? 'border-red-500' : 'border-gray-300'
                      }`}
                    >
                      <option value="">Select an organization or create new</option>
                      <option value="new" className="font-semibold text-blue-600">
                        ➕ Create New Organization
                      </option>
                      <optgroup label="Existing Organizations">
                        {organizations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  {/* New Organization Input */}
                  {isNewOrganization && (
                    <div className="mt-3">
                      <input
                        type="text"
                        id="companyName"
                        value={companyName}
                        onChange={(e) => {
                          setCompanyName(e.target.value)
                          clearErrors('companyName')
                        }}
                        className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          errors.companyName ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="Enter new organization name"
                      />
                    </div>
                  )}

                  {/* Error Messages */}
                  {errors.organization && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <AlertCircle className="h-4 w-4 mr-1" />
                      {errors.organization}
                    </p>
                  )}
                  {errors.companyName && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <AlertCircle className="h-4 w-4 mr-1" />
                      {errors.companyName}
                    </p>
                  )}
                </div>
              )}

              {/* Name Fields (Sign Up only) */}
              {isSignUp && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                      First Name
                    </label>
                    <input
                      type="text"
                      id="firstName"
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value)
                        clearErrors('firstName')
                      }}
                      className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.firstName ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="First name"
                    />
                    {errors.firstName && (
                      <p className="mt-1 text-sm text-red-600 flex items-center">
                        <AlertCircle className="h-4 w-4 mr-1" />
                        {errors.firstName}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                      Last Name
                    </label>
                    <input
                      type="text"
                      id="lastName"
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value)
                        clearErrors('lastName')
                      }}
                      className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.lastName ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Last name"
                    />
                    {errors.lastName && (
                      <p className="mt-1 text-sm text-red-600 flex items-center">
                        <AlertCircle className="h-4 w-4 mr-1" />
                        {errors.lastName}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email address
                </label>
                <div className="relative">
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      clearErrors('email')
                    }}
                    className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      errors.email ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Enter your email"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600 flex items-center">
                    <AlertCircle className="h-4 w-4 mr-1" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password Field - Hidden for forgot password */}
              {!isForgotPassword && (
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        clearErrors('password')
                      }}
                      className={`w-full px-4 pr-10 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.password ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <AlertCircle className="h-4 w-4 mr-1" />
                      {errors.password}
                    </p>
                  )}
                </div>
              )}

              {/* Confirm Password Field (Sign Up only) */}
              {isSignUp && (
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      id="confirmPassword"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)
                        clearErrors('confirmPassword')
                      }}
                      className={`w-full px-4 pr-10 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Confirm your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p className="mt-1 text-sm text-red-600 flex items-center">
                      <AlertCircle className="h-4 w-4 mr-1" />
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              )}

              {/* Submit Button */}
              <div>
                <button
                  type="submit"
                  disabled={authLoading}
                  className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {authLoading 
                    ? (isForgotPassword ? 'Sending reset email...' : isSignUp ? 'Creating account...' : 'Signing in...') 
                    : (isForgotPassword ? 'Send Reset Email' : isSignUp ? 'Create Account' : 'Sign in')
                  }
                </button>
              </div>
            </form>
          )}

          {/* Forgot Password Link - Only show on sign in mode */}
          {!isSignUp && !isForgotPassword && !showEmailConfirmation && !showPasswordResetConfirmation && (
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => {
                  console.log('🔐 Forgot password clicked')
                  setIsForgotPassword(true)
                  setShowEmailConfirmation(false)
                  setShowPasswordResetConfirmation(false)
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                Forgot your password?
              </button>
            </div>
          )}

          {/* Footer Links */}
          {!showEmailConfirmation && !showPasswordResetConfirmation && (
            <div className="mt-6 text-center">
              {isForgotPassword ? (
                <p className="text-sm text-gray-600">
                  Remember your password?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(false)
                      setShowEmailConfirmation(false)
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    Sign in
                  </button>
                </p>
              ) : (
                <p className="text-sm text-gray-600">
                  {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(!isSignUp)
                      setShowEmailConfirmation(false)
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    {isSignUp ? 'Sign in' : 'Sign up'}
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Branding Section */}
      <div className="w-1/2 h-screen bg-[#0047AB] flex items-center justify-center">
        <span className="text-white text-5xl font-bold tracking-wide">
          Craft CRM
        </span>
      </div>
    </div>
  )
}


