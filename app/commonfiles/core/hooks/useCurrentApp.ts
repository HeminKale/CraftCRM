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

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const stored = localStorage.getItem('selected_app');
        if (stored) {
          setSelectedApp(JSON.parse(stored));
        } else {
          const { data: apps, error } = await supabase
            .from('tenant.apps')
            .select('id, name')
            .eq('is_active', true)
            .order('name');

          if (!error && apps && apps.length > 0) {
            const firstApp = apps[0];
            setSelectedApp({ id: firstApp.id, name: firstApp.name });
            localStorage.setItem('selected_app', JSON.stringify({ id: firstApp.id, name: firstApp.name }));
          }
        }
      } catch (error) {
        console.error('Error loading selected app:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeApp();
  }, [supabase]);

  const updateSelectedApp = (app: SelectedApp | null) => {
    setSelectedApp(app);
    if (app) {
      localStorage.setItem('selected_app', JSON.stringify(app));
    } else {
      localStorage.removeItem('selected_app');
    }
  };

  const clearSelectedApp = () => {
    setSelectedApp(null);
    localStorage.removeItem('selected_app');
  };

  return {
    selectedApp,
    updateSelectedApp,
    clearSelectedApp,
    loading
  };
}
