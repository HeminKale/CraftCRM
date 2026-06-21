'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from './SupabaseProvider';

interface PermissionEntry {
  resource_type: string;
  resource_id: string;
  can_read: boolean;
  can_edit: boolean;
  can_create: boolean;
  can_delete: boolean;
}

interface PermissionsContextType {
  loaded: boolean;
  // Returns true if the current user can perform action on a resource.
  // Admins and users with no permission sets always return true.
  can: (action: 'read' | 'edit' | 'create' | 'delete', type: 'app' | 'tab' | 'object' | 'field', resourceId: string) => boolean;
  reload: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType>({
  loaded: false,
  can: () => true,
  reload: async () => {},
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClientComponentClient();
  const { user, userProfile } = useSupabase();

  // null = not loaded yet, [] = admin / no sets (full access), entries = restricted
  const [entries, setEntries] = useState<PermissionEntry[] | null>(null);

  const load = async () => {
    if (!user) { setEntries([]); return; }
    try {
      const { data, error } = await supabase.rpc('get_my_effective_permissions');
      // Empty array means admin or no sets → full access
      setEntries(error ? [] : (data || []));
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    if (user) {
      load();
    } else {
      setEntries(null);
    }
  }, [user?.id, userProfile?.role]);

  const can = (
    action: 'read' | 'edit' | 'create' | 'delete',
    type: 'app' | 'tab' | 'object' | 'field',
    resourceId: string
  ): boolean => {
    // Not loaded yet → optimistic allow (prevents flash of hidden content)
    if (entries === null) return true;

    // Empty entries = admin or no sets assigned → full access
    if (entries.length === 0) return true;

    // Check if any entries exist for this resource type
    const typeEntries = entries.filter(e => e.resource_type === type);

    // No entries configured for this resource type → not restricted
    if (typeEntries.length === 0) return true;

    // Find the specific entry for this resource
    const entry = typeEntries.find(e => e.resource_id === resourceId);

    if (!entry) {
      // Apps and tabs work as allowlists: if the type has entries but this
      // resource isn't listed, it's not permitted.
      if (type === 'app' || type === 'tab') return false;
      // Objects and fields not listed → allow by default
      return true;
    }

    switch (action) {
      case 'read':   return entry.can_read;
      case 'edit':   return entry.can_edit;
      case 'create': return entry.can_create;
      case 'delete': return entry.can_delete;
    }
  };

  return (
    <PermissionsContext.Provider value={{ loaded: entries !== null, can, reload: load }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
