'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface CustomButtonTabProps {
  // Add any props you need
}

interface ButtonAction {
  id: string;
  name: string;
  api_name: string;
  button_type: 'object' | 'custom';
  is_active: boolean;
  label?: string;
}

export default function CustomButtonTab(props: CustomButtonTabProps) {
  const [buttons, setButtons] = useState<ButtonAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedButton, setSelectedButton] = useState<ButtonAction | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClientComponentClient();

  useEffect(() => {
    console.log('🔘 CustomButtonTab: Component mounted, calling loadButtons');
    loadButtons();
  }, []);

  const loadButtons = async () => {
    try {
      console.log('🔘 CustomButtonTab: Starting loadButtons function');
      setLoading(true);
      
      // Get tenant_id from JWT
      console.log('🔘 CustomButtonTab: Getting user from auth');
      const { data: { user } } = await supabase.auth.getUser();
      console.log('🔘 CustomButtonTab: User data:', user);
      
      if (!user) {
        console.error('🔘 CustomButtonTab: User not authenticated');
        setError('User not authenticated');
        return;
      }

      // Get tenant_id from user metadata or JWT
      const tenant_id = user.user_metadata?.tenant_id;
      console.log('🔘 CustomButtonTab: Tenant ID from user metadata:', tenant_id);
      
      if (!tenant_id) {
        console.error('🔘 CustomButtonTab: Tenant ID not found in user metadata');
        setError('Tenant ID not found');
        return;
      }

             // Load buttons from your button__a table
       console.log('🔘 CustomButtonTab: Querying button__a table for tenant:', tenant_id);
       const { data, error } = await supabase
         .from('tenant.button__a')
         .select('*')
         .eq('tenant_id', tenant_id)
         .eq('is_active', true);

      console.log('🔘 CustomButtonTab: Query result - data:', data, 'error:', error);
      
      if (error) {
        console.error('🔘 CustomButtonTab: Error loading buttons:', error);
        setError('Failed to load buttons');
        return;
      }

             // Transform data to match our interface
       console.log('🔘 CustomButtonTab: Raw button data:', data);
       const transformedButtons = data?.map(btn => ({
         id: btn.id,
         name: btn.name,
         api_name: btn.api_name || btn.name, // Use name as fallback for api_name
         button_type: btn.button_type__a, // Use button_type__a from database
         is_active: btn.is_active,
         label: btn.label__a || btn.name // Use label__a or fallback to name
       })) || [];
      
      console.log('🔘 CustomButtonTab: Transformed buttons:', transformedButtons);
      setButtons(transformedButtons);
    } catch (err) {
      console.error('🔘 CustomButtonTab: Error loading buttons:', err);
      setError('Failed to load buttons');
    } finally {
      console.log('🔘 CustomButtonTab: loadButtons completed, setting loading to false');
      setLoading(false);
    }
  };

  const executeButton = async (button: ButtonAction) => {
    console.log('🔘 CustomButtonTab: executeButton called with button:', button);
    try {
      setExecuting(true);
      setError(null);
      setResult(null);
      setSelectedButton(button);
      console.log('🔘 CustomButtonTab: Set executing state to true');

      // Handle different button types
      console.log('🔘 CustomButtonTab: Button type:', button.button_type);
      switch (button.button_type) {
        case 'object':
          console.log('🔘 CustomButtonTab: Executing object button');
          await executeObjectButton(button);
          break;
        case 'custom':
          console.log('🔘 CustomButtonTab: Executing custom button');
          await executeCustomButton(button);
          break;
        default:
          console.error('🔘 CustomButtonTab: Unknown button type:', button.button_type);
          setError('Unknown button type');
      }
    } catch (err) {
      console.error('🔘 CustomButtonTab: Error executing button:', err);
      setError('Failed to execute button action');
    } finally {
      console.log('🔘 CustomButtonTab: Setting executing to false');
      setExecuting(false);
    }
  };

  const executeObjectButton = async (button: ButtonAction) => {
    console.log('🔘 CustomButtonTab: executeObjectButton called with:', button);
    // Example: Execute object-specific actions
    // This could trigger workflows, create records, etc.
    
    // Simulate API call
    console.log('🔘 CustomButtonTab: Simulating API call for object button');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = {
      success: true,
      message: `Object button "${button.name}" executed successfully`,
      timestamp: new Date().toISOString(),
      action: button.api_name
    };
    console.log('🔘 CustomButtonTab: Object button result:', result);
    setResult(result);
  };

  const executeCustomButton = async (button: ButtonAction) => {
    console.log('🔘 CustomButtonTab: executeCustomButton called with:', button);
    // Example: Execute custom actions
    // This could call external APIs, generate reports, etc.
    
    // Simulate API call
    console.log('🔘 CustomButtonTab: Simulating API call for custom button');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const result = {
      success: true,
      message: `Custom button "${button.name}" executed successfully`,
      timestamp: new Date().toISOString(),
      action: button.api_name,
      customData: {
        generated: true,
        processed: Math.floor(Math.random() * 100) + 1
      }
    };
    console.log('🔘 CustomButtonTab: Custom button result:', result);
    setResult(result);
  };

  console.log('🔘 CustomButtonTab: Render state - loading:', loading, 'error:', error, 'buttons count:', buttons.length, 'executing:', executing);
  
  if (loading) {
    console.log('🔘 CustomButtonTab: Rendering loading state');
    return (
      <div className="p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Loading custom buttons...</span>
        </div>
      </div>
    );
  }

  if (error) {
    console.log('🔘 CustomButtonTab: Rendering error state');
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
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
              <div className="mt-4">
                <button
                  onClick={loadButtons}
                  className="bg-red-100 text-red-800 px-3 py-2 rounded-md text-sm font-medium hover:bg-red-200"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  console.log('🔘 CustomButtonTab: Rendering main content');
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Custom Buttons</h2>
        <p className="text-gray-600">Execute custom actions and workflows</p>
      </div>

             {/* Buttons Grid */}
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
         {buttons.map((button) => (
          <div
            key={button.id}
            className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900">{button.name}</h3>
              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                button.button_type === 'object' 
                  ? 'bg-blue-100 text-blue-800' 
                  : 'bg-purple-100 text-purple-800'
              }`}>
                {button.button_type}
              </span>
            </div>
            
            {button.label && button.label !== button.name && (
              <p className="text-sm text-gray-600 mb-4">{button.label}</p>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-mono">{button.api_name}</span>
                             <button
                 onClick={() => {
                   console.log('🔘 CustomButtonTab: Execute button clicked for:', button);
                   executeButton(button);
                 }}
                 disabled={executing}
                 className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                   executing && selectedButton?.id === button.id
                     ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                     : 'bg-blue-600 text-white hover:bg-blue-700'
                 }`}
               >
                {executing && selectedButton?.id === button.id ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Executing...
                  </div>
                ) : (
                  'Execute'
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* No Buttons State */}
      {buttons.length === 0 && (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No custom buttons</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get started by creating custom buttons in the Object Manager.
          </p>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div className="mt-6">
          <div className={`border rounded-lg p-4 ${
            result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex">
              <div className="flex-shrink-0">
                {result.success ? (
                  <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <h3 className={`text-sm font-medium ${
                  result.success ? 'text-green-800' : 'text-red-800'
                }`}>
                  {result.success ? 'Success' : 'Error'}
                </h3>
                <div className="mt-2 text-sm text-gray-700">
                  <p>{result.message}</p>
                  {result.timestamp && (
                    <p className="text-xs text-gray-500 mt-1">
                      Executed at: {new Date(result.timestamp).toLocaleString()}
                    </p>
                  )}
                  {result.customData && (
                    <div className="mt-2 p-2 bg-gray-100 rounded text-xs">
                      <pre>{JSON.stringify(result.customData, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
