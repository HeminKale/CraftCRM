'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { Loader2, AlertCircle, FileCode } from 'lucide-react';

// Import all custom components statically
import CertificateGeneratorTab from '../custom/CertificateGeneratorTab';
import CertificateSoftCopy from '../custom/certificateSoftCopy';
import softCopyGeneratorExcel from '../custom/softCopyGeneratorExcel';
import CustomButtonTab from '../custom/CustomButtonTab';
import ClientDraftGenerator from '../custom/ClientDraftGenerator';
import ClientSoftCopyGenerator from '../custom/ClientSoftCopyGenerator';
import ClientPrintableGenerator from '../custom/ClientPrintableGenerator';
import YourCustomComponent from '../custom/component'; // Add your component import

interface CustomTabRendererProps {
  componentPath: string;
  tabId: string;
  tabLabel: string;
  recordId?: string;
  objectId?: string;
  recordData?: any;
  tenantId?: string;
  selectedRecordIds?: string[];
}

interface CustomComponentProps {
  tabId: string;
  tabLabel: string;
  [key: string]: any;
}

export default function CustomTabRenderer({ 
  componentPath, 
  tabId, 
  tabLabel,
  recordId,
  objectId,
  recordData,
  tenantId,
  selectedRecordIds
}: CustomTabRendererProps) {
  const [CustomComponent, setCustomComponent] = useState<React.ComponentType<CustomComponentProps> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCustomComponent = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('🔍 Loading custom component:', componentPath);
        const componentName = componentPath.split('/').pop()?.trim();
        
        // Component registry - map component names to actual components
        const componentRegistry: { [key: string]: React.ComponentType<any> } = {
          'CertificateGeneratorTab': CertificateGeneratorTab,
          'certificateSoftCopy': CertificateSoftCopy,
          'softCopyGeneratorExcel': softCopyGeneratorExcel,
          'CustomButtonTab': CustomButtonTab,
          'ClientDraftGenerator': ClientDraftGenerator,
          'ClientSoftCopyGenerator': ClientSoftCopyGenerator,
          'ClientPrintableGenerator': ClientPrintableGenerator,
          'YourCustomComponent': YourCustomComponent, // Add your component to registry
          // Add more components here as needed
        };
        
        console.log('🔍 Available components:', Object.keys(componentRegistry));
        console.log('🔍 Looking for component:', componentName);
        
        const Component = componentRegistry[componentName];
        
        if (!Component) {
          throw new Error(`Component '${componentName}' not found in registry. Available: ${Object.keys(componentRegistry).join(', ')}`);
        }
        
        console.log('✅ Component found in registry:', componentName);
        
        if (typeof Component === 'function') {
          setCustomComponent(() => Component);
          console.log('✅ Component set successfully');
        } else {
          throw new Error('Component is not a valid React component');
        }
      } catch (err) {
        console.error('❌ Failed to load custom component:', err);
        setError(err instanceof Error ? err.message : 'Failed to load component');
      } finally {
        setLoading(false);
      }
    };

    if (componentPath) {
      console.log('🚀 Starting component load for:', componentPath);
      loadCustomComponent();
    }
  }, [componentPath]);

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center py-8">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">Loading custom component...</p>
          <p className="text-sm text-gray-400 mt-2">{componentPath}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center py-8 text-red-600">
          <AlertCircle className="mx-auto h-12 w-12 mb-4" />
          <h3 className="text-lg font-medium text-red-900 mb-2">Component Load Error</h3>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-left">
            <p className="text-xs text-red-700 font-mono">
              <strong>Path:</strong> {componentPath}
            </p>
            <p className="text-xs text-red-700 mt-2">
              <strong>Tab ID:</strong> {tabId}
            </p>
            <p className="text-xs text-red-700 mt-1">
              <strong>Tab Label:</strong> {tabLabel}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render the custom component
  if (CustomComponent) {
    return (
      <Suspense fallback={
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center py-8">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600">Rendering custom component...</p>
          </div>
        </div>
      }>
        <CustomComponent 
          tabId={tabId} 
          tabLabel={tabLabel}
          recordId={recordId}
          objectId={objectId}
          recordData={recordData}
          tenantId={tenantId}
          selectedRecordIds={selectedRecordIds}
        />
        {(() => {
          console.log('🔍 === CUSTOM TAB RENDERER PROPS ===');
          console.log('🔍 tabId:', tabId);
          console.log('🔍 recordId:', recordId);
          console.log('🔍 objectId:', objectId);
          console.log('🔍 recordData:', recordData);
          console.log('🔍 recordData is array:', Array.isArray(recordData));
          console.log('🔍 recordData length:', recordData?.length);
          console.log('🔍 selectedRecordIds:', selectedRecordIds);
          console.log('🔍 selectedRecordIds length:', selectedRecordIds?.length);
          console.log('🔍 tenantId:', tenantId);
          return null;
        })()}
      </Suspense>
    );
  }

  // Fallback state
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="text-center py-8 text-gray-500">
        <FileCode className="mx-auto h-12 w-12 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Custom Tab Ready</h3>
        <p className="text-sm text-gray-500">
          Custom component loaded successfully.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Component: {componentPath}
        </p>
      </div>
    </div>
  );
}
