'use client';

import React from 'react';
import { useSupabase } from '../providers/SupabaseProvider';

export default function DashboardContent() {
  const { user, userProfile, tenant } = useSupabase();

  console.log('🔍 DashboardContent: Component rendered');
  console.log('🔍 DashboardContent: user:', user);
  console.log('🔍 DashboardContent: userProfile:', userProfile);
  console.log('🔍 DashboardContent: tenant:', tenant);

  return (
    <div className="p-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Welcome to Craft CRM Dashboard
        </h2>
        <p className="text-lg text-gray-600 mb-8">
          Your multi-tenant SaaS platform
        </p>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-2xl mx-auto">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Dashboard is Ready!
          </h3>
          <p className="text-gray-500 mb-4">
            You have successfully logged in to your account.
          </p>
          
          {/* User Info */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <h4 className="font-medium text-gray-900 mb-2">Account Information</h4>
            <div className="text-sm text-gray-600 space-y-1">
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Name:</strong> {userProfile?.first_name} {userProfile?.last_name}</p>
              <p><strong>Role:</strong> {userProfile?.role}</p>
              <p><strong>Organization:</strong> {tenant?.name}</p>
            </div>
          </div>
          
          <p className="text-sm text-gray-400">
            Use the app launcher (9-dot icon) in the header to select an application.
          </p>
        </div>
      </div>
    </div>
  );
}
