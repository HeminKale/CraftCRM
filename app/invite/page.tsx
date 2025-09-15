'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';

interface InvitationData {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  tenant_id: string;
  expires_at: string;
  tenant_name: string;
}

export default function InvitePage() {
  const [token, setToken] = useState('');
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: ''
  });
  const [step, setStep] = useState<'token' | 'setup' | 'success'>('token');

  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClientComponentClient();

  // Check if token is provided in URL
  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (urlToken) {
      setToken(urlToken);
      validateInvitation(urlToken);
    }
  }, [searchParams]);

  const validateInvitation = async (invitationToken: string) => {
    if (!invitationToken.trim()) {
      toast.error('Please enter an invitation token');
      return;
    }

    try {
      setValidating(true);
      const { data, error } = await supabase
        .rpc('validate_invitation', { p_token: invitationToken.trim() });
      
      if (error) {
        console.error('Error validating invitation:', error);
        toast.error(error.message || 'Failed to validate invitation');
        return;
      }
      
      if (data?.[0]?.valid) {
        setInvitation(data[0].invitation);
        setFormData(prev => ({
          ...prev,
          first_name: data[0].invitation.first_name || '',
          last_name: data[0].invitation.last_name || ''
        }));
        setStep('setup');
        toast.success('Invitation is valid! Please complete your account setup.');
      } else {
        toast.error(data?.[0]?.message || 'Invalid invitation token');
      }
    } catch (err) {
      console.error('Error validating invitation:', err);
      toast.error('Failed to validate invitation');
    } finally {
      setValidating(false);
    }
  };

  const handleAcceptInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!invitation) {
      toast.error('No invitation found');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('accept_invitation', {
          p_token: token,
          p_password: formData.password,
          p_first_name: formData.first_name.trim() || null,
          p_last_name: formData.last_name.trim() || null
        });
      
      if (error) {
        console.error('Error accepting invitation:', error);
        toast.error(error.message || 'Failed to accept invitation');
        return;
      }
      
      if (data?.[0]?.success) {
        toast.success('Account created successfully! You can now sign in.');
        setStep('success');
        
        // Auto-redirect to login after 3 seconds
        setTimeout(() => {
          router.push('/');
        }, 3000);
      } else {
        toast.error(data?.[0]?.message || 'Failed to accept invitation');
      }
    } catch (err) {
      console.error('Error accepting invitation:', err);
      toast.error('Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateInvitation(token);
  };

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">Welcome to {invitation?.tenant_name}!</h2>
            <p className="mt-2 text-sm text-gray-600">
              Your account has been created successfully. You can now sign in with your email and password.
            </p>
            <div className="mt-4">
              <button
                onClick={() => router.push('/')}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Go to Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
              <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Complete Your Account Setup
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              You've been invited to join <span className="font-medium text-blue-600">{invitation?.tenant_name}</span>
            </p>
            <p className="mt-1 text-center text-sm text-gray-500">
              Email: {invitation?.email}
            </p>
          </div>
          
          <form className="mt-8 space-y-6" onSubmit={handleAcceptInvitation}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="first_name" className="block text-sm font-medium text-gray-700">
                    First Name
                  </label>
                  <input
                    id="first_name"
                    name="first_name"
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData({...formData, first_name: e.target.value})}
                    className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label htmlFor="last_name" className="block text-sm font-medium text-gray-700">
                    Last Name
                  </label>
                  <input
                    id="last_name"
                    name="last_name"
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData({...formData, last_name: e.target.value})}
                    className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                    placeholder="Last name"
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="Create a password"
                />
              </div>
              
              <div>
                <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700">
                  Confirm Password
                </label>
                <input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  required
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="Confirm your password"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setStep('token')}
                className="text-sm text-blue-600 hover:text-blue-500"
              >
                ← Back to token entry
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
            <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Accept Your Invitation
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your invitation token to join your organization
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleTokenSubmit}>
          <div>
            <label htmlFor="token" className="sr-only">
              Invitation Token
            </label>
            <input
              id="token"
              name="token"
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
              placeholder="Enter your invitation token"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={validating}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {validating ? 'Validating...' : 'Validate Invitation'}
            </button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="text-sm text-blue-600 hover:text-blue-500"
            >
              ← Back to sign in
            </button>
          </div>
        </form>

        <div className="text-center">
          <p className="text-xs text-gray-500">
            Need help? Contact your organization administrator
          </p>
        </div>
      </div>
    </div>
  );
}

