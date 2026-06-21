'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  first_name: string;
  last_name: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string;
  settings: any;
  is_active: boolean;
}

interface SupabaseContextType {
  user: User | null;
  userProfile: UserProfile | null;
  tenant: Tenant | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SupabaseContext = createContext<SupabaseContextType | undefined>(undefined);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true); // Start with true
  const supabase = createClientComponentClient();

  useEffect(() => {
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        loadUserProfile(session.user);
      }
      setLoading(false);
    };

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          loadUserProfile(session.user);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setUserProfile(null);
          setTenant(null);
        } else if (event === 'INITIAL_SESSION' && session?.user) {
          setUser(session.user);
          loadUserProfile(session.user);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (user: User) => {
    try {
      let directProfile: any = null;
      let directError: any = null;
      try {
        const result = await supabase
          .schema('system')
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();
        directProfile = result.data;
        directError = result.error;
      } catch (error) {
        directError = error;
      }

      if (!directProfile && directError) {
        const { data: newProfile, error: createError } = await supabase
          .rpc('create_user', {
            p_user_id: user.id,
            p_tenant_id: '00000000-0000-0000-0000-000000000000',
            p_user_email: user.email || '',
            p_first_name: user.user_metadata?.first_name || 'User',
            p_last_name: user.user_metadata?.last_name || '',
            p_user_role: 'user'
          });
        if (!createError && newProfile && newProfile.length > 0) {
          setUserProfile(newProfile[0]);
        }
      }

      if (directProfile) {
        setUserProfile(directProfile);
        try {
          const { data: tenantData, error: tenantError } = await supabase
            .schema('system')
            .from('tenants')
            .select('*')
            .eq('id', directProfile.tenant_id)
            .single();
          if (!tenantError && tenantData) setTenant(tenantData);
        } catch (tenErr) {
          console.error('Tenant load failed:', tenErr);
        }
      }

      // Background RPC refresh (non-blocking)
      (async () => {
        try {
          const { data, error } = await supabase.rpc('get_user_profile', { p_user_id: user.id });
          if (!error && data && data.length > 0) {
            setUserProfile(data[0]);
          }
        } catch (e) {
          // silent
        }
      })();
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
      } else {
        setUser(null);
        setUserProfile(null);
        setTenant(null);
      }
    } catch (error) {
      console.error('Error in signOut:', error);
    }
  };

  const value = { user, userProfile, tenant, loading, signOut };

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (context === undefined) {
    throw new Error('useSupabase must be used within a SupabaseProvider');
  }
  return context;
} 