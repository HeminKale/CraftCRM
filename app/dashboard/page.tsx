'use client';

import React from 'react';
import { useSupabase } from '../commonfiles/core/providers/SupabaseProvider';
import { useRouter } from 'next/navigation';
import Layout from '../commonfiles/core/components/Layout';
import DashboardContent from '../commonfiles/core/components/DashboardContent';

export default function Dashboard() {
  const { user, loading } = useSupabase();
  const router = useRouter();

  console.log('🔍 Dashboard Page: Component rendered');
  console.log('🔍 Dashboard Page: user:', user);
  console.log('🔍 Dashboard Page: loading:', loading);

  React.useEffect(() => {
    console.log('🔍 Dashboard Page: useEffect triggered');
    if (!loading && !user) {
      console.log('🔍 Dashboard Page: No user, redirecting to /');
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading) {
    console.log('🔍 Dashboard Page: Showing loading state');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  console.log('🔍 Dashboard Page: Rendering Layout with mode="dashboard"');
  return (
    <Layout mode="dashboard">
      <DashboardContent />
    </Layout>
  );
} 