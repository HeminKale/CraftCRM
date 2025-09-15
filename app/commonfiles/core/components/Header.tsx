'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '../providers/SupabaseProvider';
import AppLauncher from './AppLauncher';

interface HeaderProps {
  mode?: 'dashboard' | 'settings' | 'app';
  selectedApp?: { id: string; name: string } | null;
  onAppSelect?: (app: { id: string; name: string }) => void;
  visibleTabs?: Array<{ 
    id: string; 
    label: string; 
    tabType?: string; 
    objectId?: string; 
  }>;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
}

export default function Header({ 
  mode = 'app',
  selectedApp, 
  onAppSelect, 
  visibleTabs = [], 
  activeTab, 
  onTabChange 
}: HeaderProps) {
  const { user, userProfile, tenant, signOut } = useSupabase();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const router = useRouter();

  // 🔍 ADD DEBUG LOGS HERE
  console.log('🔍 Header: Component rendered');
  console.log('🔍 Header: mode:', mode);
  console.log('🔍 Header: selectedApp:', selectedApp);
  console.log('🔍 Header: visibleTabs:', visibleTabs);
  console.log('🔍 Header: visibleTabs length:', visibleTabs?.length);
  console.log('🔍 Header: activeTab:', activeTab);
  console.log('🔍 Header: user:', user);
  console.log('🔍 Header: tenant:', tenant);
  
  // 🔍 ADD DEBUG LOGS FOR TAB RENDERING
  if (selectedApp && visibleTabs && visibleTabs.length > 0) {
    console.log('🔍 Header: Tab visibility check:', {
      hasVisibleTabs: true,
      visibleTabsLength: visibleTabs.length,
      visibleTabsData: visibleTabs
    });
    console.log('🔍 Header: Rendering tab buttons - visibleTabs:', visibleTabs);
    visibleTabs.forEach((tab, index) => {
      console.log(`🔍 Header: Tab ${index + 1}:`, tab);
    });
  }

  const handleSettingsClick = () => {
    console.log('🔍 Header: Settings clicked - navigating to settings');
    // Reset app selection and navigate to settings
    if (onAppSelect) {
      onAppSelect(null as any); // Reset app selection
    }
    router.push('/settings');
  };

  const handleSignOut = async () => {
    try {
      console.log('🔍 Header: Sign out clicked');
      await signOut();
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const renderNavigation = () => {
    console.log('🔍 Header: renderNavigation called with mode:', mode);
    
    // If an app is selected, show app navigation regardless of mode
    if (selectedApp) {
      console.log('🔍 Header: Rendering app navigation for:', selectedApp.name);
      // App view navigation
      return (
        <div className="flex items-center space-x-3">
          <span className="text-lg font-semibold text-gray-900">
            {selectedApp.name}
          </span>
          {visibleTabs && visibleTabs.length > 0 && (
            <div className="flex items-center space-x-1">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`px-2 py-1 rounded-md text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
    
    if (mode === 'dashboard') {
      console.log('🔍 Header: Rendering dashboard navigation');
      return (
        <div className="flex items-center space-x-3">
          <span className="text-lg font-semibold text-gray-900">Dashboard</span>
        </div>
      );
    } else {
      console.log('🔍 Header: Rendering settings navigation');
      // Settings view navigation
      return (
        <div className="flex items-center space-x-3">
          <span className="text-lg font-semibold text-gray-900">Settings</span>
          <div className="flex items-center space-x-1">
            <button className="px-2 py-1 rounded-md text-sm font-medium bg-blue-100 text-blue-700 border border-blue-200">
              Home
            </button>
            <button className="px-2 py-1 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100">
              Object Manager
            </button>
          </div>
        </div>
      );
    }
  };

  console.log('🔍 Header: About to render header with mode:', mode);
  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      {/* Row 1: Company Name + Settings + Avatar */}
      <div className="px-4 py-1">
        <div className="flex items-center justify-between">
          {/* Left Side - Company Name */}
          <div className="flex items-center">
            <h1 className="text-lg font-bold text-gray-900">
              Company Name
            </h1>
          </div>

          {/* Right Side - Settings + Avatar */}
          <div className="flex items-center space-x-2">
            {/* Settings Icon */}
            <button
              onClick={handleSettingsClick}
              className="p-2 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Settings"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* User Avatar with Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {userProfile?.first_name?.[0] || user?.email?.[0] || 'U'}
                  </span>
                </div>
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  <div className="py-1">
                    <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-100">
                      <div className="font-medium">{userProfile?.first_name || 'User'}</div>
                      <div className="text-gray-500">{user?.email}</div>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: App Launcher + Navigation */}
      <div className="px-4 py-1 border-t border-gray-100">
        <div className="flex items-center space-x-4">
          {/* App Launcher */}
          <AppLauncher 
            onAppSelect={onAppSelect}
            tenantId={tenant?.id}
          />
          {renderNavigation()}
        </div>
      </div>
    </div>
  );
}
