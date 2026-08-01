'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

// Returns a map of user UUID → display name ("First Last" or email fallback).
// Loaded once per component mount from system.users.
export function useUserMap(): Record<string, string> {
  const supabase = createClientComponentClient();
  const [userMap, setUserMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      // Was a direct `.schema('system').from('users').select(...)`, relying
      // on system.users' RLS policy (auth.jwt()->>'tenant_id'). Every other
      // user-lookup in this app resolves the caller's tenant via a
      // SECURITY DEFINER RPC (auth.uid() -> system.users.tenant_id) instead
      // of a JWT claim — switched to match (migration 247,
      // get_tenant_user_directory), since the JWT-claim path was silently
      // returning zero rows for real sessions (auditor_id__a/
      // tech_reviewer_id__a showed as raw UUIDs instead of names).
      const { data, error } = await supabase.rpc('get_tenant_user_directory');
      if (error) {
        console.error('useUserMap: failed to load tenant user directory', error);
        return;
      }
      if (data) {
        const map: Record<string, string> = {};
        for (const u of data) {
          const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email;
          map[u.id] = name;
        }
        setUserMap(map);
      }
    };
    load();
  }, []);

  return userMap;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves a value for created_by / updated_by fields.
// If the stored value is a UUID, looks it up in userMap.
// If it is already a name (older records stored by trigger), returns as-is.
export function resolveUserValue(value: any, userMap: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '-';
  const str = String(value);
  if (UUID_PATTERN.test(str)) return userMap[str] || str;
  return str;
}
