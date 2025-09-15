'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface App {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
}

interface AppLauncherProps {
  onAppSelect?: (app: { id: string; name: string }) => void;
  tenantId: string;
}

export default function AppLauncher({ onAppSelect, tenantId }: AppLauncherProps) {
  const [showModal, setShowModal] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(false);
  const supabase = createClientComponentClient();

  console.log('🔍 AppLauncher rendered - tenantId:', tenantId);

  // Load active apps
  useEffect(() => {
    if (showModal) {
      fetchActiveApps();
    }
  }, [showModal]);

  const fetchActiveApps = async () => {
    console.log('🔍 Fetching active apps for tenant:', tenantId);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .schema('tenant')
        .from('apps')
        .select('*')
        .eq('is_active', true)
        .eq('tenant_id', tenantId)
        .order('name');
      
      console.log('🔍 Apps result:', data);
      console.log('🔍 Apps error:', error);
      
      if (error) throw error;
      setApps(data || []);
    } catch (err: any) {
      console.error('Error fetching apps:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAppSelect = (app: App) => {
    console.log('🔍 App selected:', app);
    // Store selected app in localStorage
    const selectedApp = { id: app.id, name: app.name };
    localStorage.setItem('selected_app', JSON.stringify(selectedApp));
    
    // Call the callback if provided
    if (onAppSelect) {
      onAppSelect(selectedApp);
    }
    
    setShowModal(false);
  };

  console.log('🔍 AppLauncher render - apps:', apps, 'loading:', loading);

  return (
    <div className="relative">
      {/* 9-dot App Launcher Icon */}
      <button
        onClick={() => {
          console.log('🔍 App launcher clicked');
          setShowModal(true);
        }}
        className="p-2 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="App Launcher"
      >
        <svg className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
        </svg>
      </button>

      {/* App Selection Modal */}
      {showModal && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-gray-600 bg-opacity-50 z-40"
            onClick={() => setShowModal(false)}
          />
          
          {/* Dropdown Modal */}
          <div className="absolute top-full left-0 mt-2 p-4 border w-96 shadow-lg rounded-md bg-white z-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">App Launcher</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-sm text-gray-500">Loading apps...</p>
              </div>
            ) : apps.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-gray-400 mb-3">
                  <svg className="mx-auto h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-medium text-gray-900 mb-1">No active applications</h3>
                <p className="text-xs text-gray-500">Create and activate applications to see them here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => handleAppSelect(app)}
                    className="p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all text-center group relative"
                    title={app.description || app.name}
                  >
                    <div className="flex flex-col items-center space-y-2">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                        <span className="text-blue-600 font-medium text-sm">
                          {app.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors text-sm">
                          {app.name}
                        </h4>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
} 