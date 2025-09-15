'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface CustomComponentProps {
  tabId?: string;
  tabLabel?: string;
  recordId?: string; // The current record ID when button is clicked
  buttonData?: any; // The button configuration data
  [key: string]: any; // Allow additional props
}

export default function YourCustomComponent(props: CustomComponentProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClientComponentClient();

  // You can access the current record and button data
  const { recordId, buttonData, tabId, tabLabel } = props;

  console.log('🔘 YourCustomComponent: Component loaded with props:', props);

  const handleAction = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🔘 YourCustomComponent: Starting custom action');
      console.log('🔘 YourCustomComponent: Record ID:', recordId);
      console.log('🔘 YourCustomComponent: Button data:', buttonData);

      // Your custom logic here
      // Example: API call, data processing, etc.
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setResult({
        success: true,
        message: 'Custom action completed successfully!',
        timestamp: new Date().toISOString(),
        data: {
          recordId,
          buttonName: buttonData?.name,
          customData: 'Your custom result data here'
        }
      });

    } catch (err) {
      console.error('❌ YourCustomComponent: Error in custom action:', err);
      setError('Failed to execute custom action');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Your Custom Component
        </h2>
        <p className="text-gray-600">
          This is your custom component loaded via button action.
        </p>
      </div>

      {/* Display current context */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Context Information:</h3>
        <div className="text-sm text-gray-600 space-y-1">
          <p><strong>Record ID:</strong> {recordId || 'Not available'}</p>
          <p><strong>Button Name:</strong> {buttonData?.name || 'Not available'}</p>
          <p><strong>Tab ID:</strong> {tabId || 'Not available'}</p>
          <p><strong>Tab Label:</strong> {tabLabel || 'Not available'}</p>
        </div>
      </div>

      {/* Action Button */}
      <div className="mb-6">
        <button
          onClick={handleAction}
          disabled={loading}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            loading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {loading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Processing...
            </div>
          ) : (
            'Execute Custom Action'
          )}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-green-800">Success</h3>
              <div className="mt-2 text-sm text-green-700">
                <p>{result.message}</p>
                {result.timestamp && (
                  <p className="text-xs text-green-600 mt-1">
                    Completed at: {new Date(result.timestamp).toLocaleString()}
                  </p>
                )}
                {result.data && (
                  <div className="mt-2 p-2 bg-green-100 rounded text-xs">
                    <pre>{JSON.stringify(result.data, null, 2)}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Content Area */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-sm font-medium text-blue-800 mb-2">Custom Content Area</h3>
        <p className="text-sm text-blue-700">
          This is where you can add your custom UI, forms, data displays, or any other functionality.
          You have access to the current record data and button configuration.
        </p>
      </div>
    </div>
  );
}
