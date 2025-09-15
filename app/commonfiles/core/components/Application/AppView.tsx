'use client';

import React from 'react';

interface AppViewProps {
  selectedApp: { id: string; name: string };
  visibleTabs: Array<{ id: string; label: string }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function AppView({ selectedApp, visibleTabs, activeTab, onTabChange }: AppViewProps) {
  return (
    <div className="flex-1">
      {/* App Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">{selectedApp.name}</h1>
        <p className="text-sm text-gray-500">Application Dashboard</p>
      </div>

      {/* Tab Content Area */}
      <div className="p-6">
        {activeTab ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {visibleTabs.find(tab => tab.id === activeTab)?.label || 'Unknown Tab'}
              </h2>
              <p className="text-sm text-gray-500">
                Content for this tab will be implemented next
              </p>
            </div>
            
            {/* Placeholder for tab content */}
            <div className="bg-gray-50 rounded-lg p-8 text-center">
              <div className="text-gray-400 mb-4">
                <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Tab Content Coming Soon
              </h3>
              <p className="text-sm text-gray-500">
                This area will display the content for the selected tab.
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-500">
            Select a tab to view its content
          </div>
        )}
      </div>
    </div>
  );
}