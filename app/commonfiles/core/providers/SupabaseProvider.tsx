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
      console.log('🔍 SupabaseProvider: Getting initial session...');
      const { data: { session } } = await supabase.auth.getSession();
      console.log('🔍 SupabaseProvider: Session result:', session);
      console.log('🔍 SupabaseProvider: Session user:', session?.user);
      console.log('🔍 SupabaseProvider: Session access_token:', session?.access_token ? 'exists' : 'missing');
      
      if (session?.user) {
        console.log('🔍 SupabaseProvider: Found user in session:', session.user.id);
        setUser(session.user);
        // Do not block UI on profile load
        loadUserProfile(session.user);
      } else {
        console.log('🔍 SupabaseProvider: No session found');
      }
      setLoading(false);
    };

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔍 SupabaseProvider: Auth state change:', event, session);
        console.log('🔍 SupabaseProvider: Session user in auth state change:', session?.user);
        
        if (event === 'SIGNED_IN' && session?.user) {
          console.log('🔍 SupabaseProvider: User signed in:', session.user.id);
          setUser(session.user);
          // Do not block UI on profile load
          loadUserProfile(session.user);
        } else if (event === 'SIGNED_OUT') {
          console.log('🔍 SupabaseProvider: User signed out');
          setUser(null);
          setUserProfile(null);
          setTenant(null);
        } else if (event === 'INITIAL_SESSION') {
          console.log('🔍 SupabaseProvider: Initial session event');
          if (session?.user) {
            console.log('🔍 SupabaseProvider: Found user in initial session:', session.user.id);
            setUser(session.user);
            // Do not block UI on profile load
            loadUserProfile(session.user);
          } else {
            console.log('🔍 SupabaseProvider: No user in initial session');
          }
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (user: User) => {
    try {
      console.log('🔍 SupabaseProvider: Loading user profile for:', user.id);

      // 1) Direct-first to avoid any RPC latency blocking sign-in
      console.log('🔁 AuthFlow: [Profile] Direct system.users query START', { userId: user.id });
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
        console.error('Direct users query failed:', error);
        directError = error;
      }

      console.log('🔁 AuthFlow: [Profile] Direct system.users query END', { ok: !!directProfile, directError });

      if (!directProfile && directError) {
        console.log('🔁 AuthFlow: [Profile] Creating default via RPC create_user START');
        const { data: newProfile, error: createError } = await supabase
          .rpc('create_user', {
            p_user_id: user.id,
            p_tenant_id: '00000000-0000-0000-0000-000000000000',
            p_user_email: user.email || '',
            p_first_name: user.user_metadata?.first_name || 'User',
            p_last_name: user.user_metadata?.last_name || '',
            p_user_role: 'user'
          });
        console.log('🔁 AuthFlow: [Profile] Creating default via RPC create_user END', { ok: Array.isArray(newProfile) && newProfile.length > 0, createError });
        if (!createError && newProfile && newProfile.length > 0) {
          setUserProfile(newProfile[0]);
          console.log('🔁 AuthFlow: [Profile] setUserProfile (created)');
        }
      }

      if (directProfile) {
        setUserProfile(directProfile);
        console.log('🔁 AuthFlow: [Profile] setUserProfile (direct)', { tenantId: directProfile.tenant_id });
        console.log('🔁 AuthFlow: [Tenant] Fetch START', { tenantId: directProfile.tenant_id });
        try {
          const { data: tenantData, error: tenantError } = await supabase
            .schema('system')
            .from('tenants')
            .select('*')
            .eq('id', directProfile.tenant_id)
            .single();
          console.log('🔁 AuthFlow: [Tenant] Fetch END', { ok: !!tenantData, tenantError });
          if (!tenantError && tenantData) setTenant(tenantData);
        } catch (tenErr) {
          console.error('Tenant load failed:', tenErr);
        }
      }

      // 2) Background RPC refresh (non-blocking). If it succeeds, it can overwrite profile.
      console.log('🔁 AuthFlow: [Profile] Background RPC get_user_profile START');
      (async () => {
        try {
          const { data, error } = await supabase.rpc('get_user_profile', { p_user_id: user.id });
          console.log('🔁 AuthFlow: [Profile] Background RPC get_user_profile END', {
            hasData: Array.isArray(data) && data.length > 0,
            error
          });
          if (!error && data && data.length > 0) {
            setUserProfile(data[0]);
            console.log('🔁 AuthFlow: [Profile] setUserProfile (background RPC)');
          }
        } catch (e) {
          console.error('RPC background fetch failed:', e);
        }
      })();

      if (!directProfile && !directError) {
        console.log('🔁 AuthFlow: [Profile] No user profile found after direct attempt');
      }

      console.log('🔁 AuthFlow: [Flow] loadUserProfile COMPLETE');
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
    }
  };

  const signOut = async () => {
    try {
      console.log('🔍 SupabaseProvider: Signing out...');
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
      } else {
        console.log('🔍 SupabaseProvider: Sign out successful');
        // Clear all state immediately
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