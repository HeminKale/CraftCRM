'use client';

import React, { useState, useEffect } from 'react';
import { useSupabase } from '../commonfiles/core/providers/SupabaseProvider';
import { useRouter } from 'next/navigation';
import HomeTab from '../commonfiles/core/components/settings/HomeTab';
import ObjectManagerTab from '../commonfiles/core/components/settings/ObjectManagerTab';
import Layout from '../commonfiles/core/components/Layout';

type SettingsTab = 'home' | 'objects';

export default function SettingsPage() {
  const { user, userProfile, tenant, loading, signOut } = useSupabase();
  const [activeTab, setActiveTab] = useState<SettingsTab>('home');
  const [pageLoading, setPageLoading] = useState(true);
  const router = useRouter();

  console.log('🔍 Settings Page: Component rendered');
  console.log('🔍 Settings Page: user:', user);
  console.log('🔍 Settings Page: loading:', loading);
  console.log('🔍 Settings Page: activeTab:', activeTab);

  useEffect(() => {
    console.log('🔍 Settings Page: useEffect triggered');
    if (!loading) {
      if (!user) {
        console.log('🔍 Settings Page: No user, redirecting to /');
        // Redirect to login if not authenticated
        window.location.href = '/';
        return;
      }
      console.log('🔍 Settings Page: User authenticated, setting pageLoading to false');
      setPageLoading(false);
    }
  }, [user, loading]);

  const handleSignOut = async () => {
    try {
      console.log('🔍 Settings Page: Sign out clicked');
      await signOut();
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (loading || pageLoading) {
    console.log('🔍 Settings Page: Showing loading state');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  console.log('🔍 Settings Page: Rendering Layout with mode="settings"');
  return (
    <Layout mode="settings">
      <div className="p-6">
        {/* Settings Content */}
        <div className="space-y-6">
          {/* Tab Navigation */}
          <div className="flex space-x-4 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('home')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                activeTab === 'home'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => setActiveTab('objects')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                activeTab === 'objects'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Objects
            </button>
          </div>

          {/* Settings Content */}
          {activeTab === 'home' && <HomeTab user={user} userProfile={userProfile} tenant={tenant} />}
          {activeTab === 'objects' && <ObjectManagerTab user={user} userProfile={userProfile} tenant={tenant} />}
        </div>
      </div>
    </Layout>
  );
}