'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Header from './Header';
import TabContent from './Application/TabContent';
import { useCurrentApp } from '../hooks/useCurrentApp';
import { useSupabase } from '../providers/SupabaseProvider';


interface LayoutProps {
  children: React.ReactNode;
  mode?: 'dashboard' | 'settings' | 'app';
}

interface TabEntry {
  id: string;
  label: string;
  tabType?: string;
  objectId?: string;
  customComponentPath?: string;
  customRoute?: string;
}

export default function Layout({ children, mode = 'app' }: LayoutProps) {
  const [visibleTabs, setVisibleTabs] = useState<TabEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const { selectedApp, updateSelectedApp, loading: appLoading } = useCurrentApp();
  const { tenant } = useSupabase();
  const supabase = createClientComponentClient();
  
  // Handle URL parameters for child record navigation
  const [childRecordParams, setChildRecordParams] = useState<{
    objectId?: string;
    recordId?: string;
    objectLabel?: string;
    fromRelatedList?: string;
  } | null>(null);

  // Function to clear child record parameters
  const clearChildRecordParams = () => {
    setChildRecordParams(null);
  };

  // Check for URL parameters on component mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const objectId = urlParams.get('objectId');
      const recordId = urlParams.get('recordId');
      const objectLabel = urlParams.get('objectLabel');
      const fromRelatedList = urlParams.get('fromRelatedList');
      
      if (objectId && recordId && objectLabel) {
        console.log('🔗 Found child record navigation parameters:', {
          objectId,
          recordId,
          objectLabel,
          fromRelatedList
        });
        
        setChildRecordParams({
          objectId,
          recordId,
          objectLabel,
          fromRelatedList: fromRelatedList || undefined
        });
        
        // Clear URL parameters to avoid confusion
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, []);

  // Fetch tabs for selected app
  useEffect(() => {
    const fetchTabs = async () => {
      if (!selectedApp) {
        setVisibleTabs([]);
        setActiveTab('');
        return;
      }

      try {
        // Use the bridge function to get app tabs
        const { data: appTabs, error } = await supabase
          .rpc('get_tenant_app_tabs', {
            p_tenant_id: tenant?.id || '00000000-0000-0000-0000-000000000000'
          });

        if (!error && appTabs) {
          // Filter tabs for the current app
          const appTabsForCurrentApp = appTabs.filter(
            (appTab: any) => appTab.app_id === selectedApp.id && appTab.is_visible
          );
          
          // Get tab details - now using the JOINed data from RPC
          const tabDetails = appTabsForCurrentApp.map((appTab: any) => ({
            id: appTab.tab_id,
            label: appTab.tab_label || 'Unnamed Tab', // Fallback if label is null
            tabType: appTab.tab_type || 'object', // Add tab type
            objectId: appTab.object_id || null, // Add object ID
            customComponentPath: appTab.custom_component_path || null, // Add custom component path
            customRoute: appTab.custom_route || null // Add custom route
          }));

          setVisibleTabs(tabDetails);
          
          // Handle child record navigation
          if (childRecordParams && childRecordParams.objectId) {
            // Find the tab that contains the child object
            const childObjectTab = tabDetails.find(tab => tab.objectId === childRecordParams.objectId);
            if (childObjectTab) {
              console.log('🔗 Found child object tab:', childObjectTab);
              setActiveTab(childObjectTab.id);
            } else {
              console.log('⚠️ Child object tab not found, using first tab');
              if (tabDetails.length > 0) {
                setActiveTab(tabDetails[0].id);
              }
            }
          } else if (tabDetails.length > 0 && !activeTab) {
            setActiveTab(tabDetails[0].id);
          }
        }
      } catch (err) {
        console.error('Error fetching tabs:', err);
        setVisibleTabs([]);
      }
    };

    fetchTabs();
  }, [selectedApp, supabase]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
  };

  // Render main content based on view state
  const renderMainContent = () => {
    // If an app is selected, show app view regardless of mode
    if (selectedApp) {
      // Wait for app selection to load before rendering
      if (appLoading) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading application...</p>
            </div>
          </div>
        );
      }
      
      // If app is selected but has no tabs, show no tabs message
      if (visibleTabs.length === 0) {
        console.log('🔍 Layout: Rendering no tabs message');
        return (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="text-gray-400 mb-4">
                <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {selectedApp.name}
              </h2>
              <p className="text-gray-500 mb-4">
                No tabs are configured for this application.
              </p>
              <p className="text-sm text-gray-400">
                Go to Settings → App Manager to configure tabs for this app.
              </p>
            </div>
          </div>
        );
      }
      
      // If app is selected and has tabs, show app view with tab content
      return (
        <div className="flex-1">
          {/* Tab Content Area */}
          <div className="p-6">
            {activeTab ? (
              (() => {
                const currentTab = visibleTabs.find(tab => tab.id === activeTab);
                
                return (
                  <TabContent
                    tabId={activeTab}
                    tabType={currentTab?.tabType || 'object'}
                    objectId={currentTab?.objectId}
                    tabLabel={currentTab?.label || 'Unknown Tab'}
                    customComponentPath={currentTab?.customComponentPath}
                    customRoute={currentTab?.customRoute}
                    childRecordParams={childRecordParams}
                    onChildRecordProcessed={clearChildRecordParams}
                  />
                );
              })()
            ) : (
              <div className="text-center text-gray-500">
                Select a tab to view its content
              </div>
            )}
          </div>
        </div>
      );
    }
    
    // Dashboard mode - show content directly (only when no app is selected)
    if (mode === 'dashboard') {
      return children;
    }
    
    // Wait for app selection to load before rendering
    if (appLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading application...</p>
          </div>
        </div>
      );
    }
    
    // If no app is selected, show children (settings content)
    if (!selectedApp) {
      return children;
    }
  };
  return (
    <div className="min-h-screen bg-gray-50">
      {/* SHARED HEADER - Company Name + Settings + Avatar + Navigation */}
      <Header
        mode={mode}
        selectedApp={selectedApp}
        onAppSelect={updateSelectedApp}
        visibleTabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Main Content */}
      <main className="flex-1">
        {renderMainContent()}
      </main>
    </div>
  );
} 