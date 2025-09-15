'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface SelectedApp {
  id: string;
  name: string;
}

export function useCurrentApp() {
  const [selectedApp, setSelectedApp] = useState<SelectedApp | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  console.log('🔍 useCurrentApp hook initialized');

  // Load selected app from localStorage on mount
  useEffect(() => {
    const initializeApp = async () => {
      console.log('🔍 Initializing app selection...');
      try {
        const stored = localStorage.getItem('selected_app');
        console.log('🔍 Stored app from localStorage:', stored);
        
        if (stored) {
          const parsed = JSON.parse(stored);
          console.log('🔍 Parsed stored app:', parsed);
          setSelectedApp(parsed);
        } else {
          console.log('🔍 No stored app, fetching first active app...');
          // If no app is selected, get the first active app
          const { data: apps, error } = await supabase
            .from('tenant.apps')
            .select('id, name')
            .eq('is_active', true)
            .order('name');

          console.log('🔍 Apps from database:', apps);
          console.log('🔍 Apps error:', error);

          if (!error && apps && apps.length > 0) {
            const firstApp = apps[0];
            console.log('🔍 Setting first app as selected:', firstApp);
            setSelectedApp({ id: firstApp.id, name: firstApp.name });
            localStorage.setItem('selected_app', JSON.stringify({ id: firstApp.id, name: firstApp.name }));
          } else {
            console.log('🔍 No apps found in database');
          }
        }
      } catch (error) {
        console.error('Error loading selected app:', error);
      } finally {
        setLoading(false);
        console.log('🔍 useCurrentApp loading finished');
      }
    };

    initializeApp();
  }, [supabase]);

  // Update selected app and persist to localStorage
  const updateSelectedApp = (app: SelectedApp | null) => {
    console.log('🔍 Updating selected app:', app);
    setSelectedApp(app);
    if (app) {
      localStorage.setItem('selected_app', JSON.stringify(app));
    } else {
      localStorage.removeItem('selected_app');
    }
  };

  // Clear selected app
  const clearSelectedApp = () => {
    console.log('🔍 Clearing selected app');
    setSelectedApp(null);
    localStorage.removeItem('selected_app');
  };

  console.log('🔍 useCurrentApp state:', { selectedApp, loading });

  return {
    selectedApp,
    updateSelectedApp,
    clearSelectedApp,
    loading
  };
} 