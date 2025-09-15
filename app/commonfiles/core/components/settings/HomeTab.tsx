'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import DataTable from '../DataTable';
import { useSupabase } from '../../providers/SupabaseProvider';
import UserManagement from './UserManagement';

interface HomeTabProps {
  user: any;
  userProfile: any;
  tenant: any;
}

const homeSections = [
  { id: 'profile', label: 'Profile Settings', icon: '👤' },
  { id: 'users_roles', label: 'Users & Roles', icon: '👥' },
  { id: 'permission_sets', label: 'Permission Sets', icon: '🔑' },
  { id: 'tab_settings', label: 'Tab Settings', icon: '📑' },
  { id: 'app_manager', label: 'App Manager', icon: '📱' },
  { id: 'system_settings', label: 'System Settings', icon: '⚙️' },
];

export default function HomeTab({ user, userProfile, tenant }: HomeTabProps) {
  const [selectedHomeSection, setSelectedHomeSection] = useState<'profile' | 'users_roles' | 'permission_sets' | 'tab_settings' | 'app_manager' | 'system_settings'>('profile');
  
  // Profile management state
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newProfile, setNewProfile] = useState({ name: '', description: '' });
  const [editingProfile, setEditingProfile] = useState<{ id: string; name: string; description: string } | null>(null);

  // Tab management state
  const [tabs, setTabs] = useState<Array<{ 
    id: string; 
    name?: string; 
    label?: string; 
    description?: string; 
    tab_description?: string;
    is_visible: boolean; 
    api_name: string | null;
    tab_type: 'object' | 'custom' | 'hybrid';
    object_id?: string;
    custom_component_path?: string;
    custom_route?: string;
    is_system_tab: boolean;
    source_label?: string;
  }>>([]);
  const [showCreateTabModal, setShowCreateTabModal] = useState(false);
  
  // Debug: Monitor tenant changes
  useEffect(() => {
    console.log('🔍 === Tenant State Changed ===');
    console.log('New tenant:', tenant);
    console.log('Tenant ID:', tenant?.id);
    console.log('Tenant ID type:', typeof tenant?.id);
    console.log('Tenant ID truthy:', !!tenant?.id);
  }, [tenant]);

  // Debug: Monitor showCreateTabModal state changes
  useEffect(() => {
    console.log('🔍 === showCreateTabModal State Changed ===');
    console.log('New value:', showCreateTabModal);
    console.log('Component should re-render now');
  }, [showCreateTabModal]);
  
  // Debug: Track component renders
  const renderCount = useRef(0);
  renderCount.current += 1;
  
  console.log('🔍 === HomeTab Component Rendered ===');
  console.log('Render count:', renderCount.current);
  console.log('Current showCreateTabModal:', showCreateTabModal);
  console.log('Current tenant ID:', tenant?.id);
  console.log('Tenant loaded:', !!tenant?.id);
  const [newTab, setNewTab] = useState({ 
    name: '', 
    label: '',
    description: '', 
    is_visible: true,
    tab_type: 'object' as 'object' | 'custom' | 'hybrid',
    object_id: '',
    custom_component_path: '',
    custom_route: ''
  });
  const [editingTab, setEditingTab] = useState<{ 
    id: string; 
    name: string; 
    description: string; 
    is_visible: boolean;
    tab_type: 'object' | 'custom' | 'hybrid';
    object_id?: string;
    custom_component_path?: string;
    custom_route?: string;
  } | null>(null);
  const [objects, setObjects] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [showObjectRecords, setShowObjectRecords] = useState(false);
  const [selectedObjectForRecords, setSelectedObjectForRecords] = useState<{ id: string; name: string } | null>(null);
  const [objectRecords, setObjectRecords] = useState<any[]>([]);
  const [appTabConfigs, setAppTabConfigs] = useState<{[key: string]: any[]}>({});
  const [selectedAppForTabConfig, setSelectedAppForTabConfig] = useState<any>(null);
  const [showAppTabConfigModal, setShowAppTabConfigModal] = useState(false);
  const [appTabOrder, setAppTabOrder] = useState<{[key: string]: string[]}>({});

  // User management state
  const [users, setUsers] = useState<Array<{ id: string; email: string; role: string; profile?: { id: string; name: string } }>>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', role: 'user', profile_id: null as string | null });
  const [editingUser, setEditingUser] = useState<{ id: string; email: string; role: string; profile_id: string | null } | null>(null);
  
  // App management state
  const [apps, setApps] = useState<Array<{ id: string; name: string; description: string; is_active: boolean; created_at: string }>>([]);
  const [showCreateApp, setShowCreateApp] = useState(false);
  const [newApp, setNewApp] = useState({ name: '', description: '', is_active: true });
  const [creatingApp, setCreatingApp] = useState(false);
  
  // App tab selection state
  const [showTabSelection, setShowTabSelection] = useState(false);
  const [selectedAppForTabs, setSelectedAppForTabs] = useState<{ id: string; name: string } | null>(null);
  const [appTabs, setAppTabs] = useState<Array<{ id: string; name: string; is_selected: boolean }>>([]);
  const [savingAppTabs, setSavingAppTabs] = useState(false);
  
  // App editing state
  const [showEditApp, setShowEditApp] = useState(false);
  const [editingApp, setEditingApp] = useState<{ id: string; name: string; description: string } | null>(null);
  const [savingApp, setSavingApp] = useState(false);

  // Add dropdown state for app actions
  const [openAppDropdown, setOpenAppDropdown] = useState<string | null>(null);

  const supabase = createClientComponentClient();



  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close if clicking on the dropdown itself
      const target = event.target as Element;
      if (target.closest('.app-dropdown-container')) {
        return;
      }
      
      if (openAppDropdown) {
        setOpenAppDropdown(null);
      }
    };
    
    // Add a small delay to prevent immediate closing
    const timeoutId = setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openAppDropdown]);

  useEffect(() => {
    console.log('🔍 === useEffect for loadData triggered ===');
    console.log('🔍 Tenant available:', !!tenant);
    console.log('🔍 Tenant ID:', tenant?.id);
    console.log('🔍 Tenant ID type:', typeof tenant?.id);
    console.log('🔍 Will call loadData:', !!tenant?.id);
    
    if (tenant?.id) {
      console.log('✅ Calling loadData with tenant ID:', tenant?.id);
    loadData();
    } else {
      console.log('❌ Skipping loadData - no tenant ID');
    }
  }, [tenant?.id]);

  // Monitor apps state changes



useEffect(() => {
 
}, [apps]);
  // Debug modal data when it opens
  useEffect(() => {
   
    
    if (showAppTabConfigModal && selectedAppForTabConfig) {
      
    }
  }, [showAppTabConfigModal, selectedAppForTabConfig, tabs, appTabConfigs]);

  const loadData = async () => {
    console.log('🔄 === loadData Function Called ===');
    console.log('🔄 Tenant available:', !!tenant);
    console.log('🔄 Tenant ID:', tenant?.id);
    console.log('🔄 Tenant ID type:', typeof tenant?.id);
    console.log('🔄 Tenant ID truthy:', !!tenant?.id);
    
    // Guard clause: don't proceed without tenant ID
    if (!tenant?.id) {
      console.log('❌ loadData: No tenant ID available, skipping data load');
      return;
    }

    try {
      console.log('🔄 Starting data load with tenant ID:', tenant?.id);
      
      const results = await Promise.all([
        fetchProfiles().catch(err => ({ error: 'fetchProfiles', details: err })),
        fetchTabs().catch(err => ({ error: 'fetchTabs', details: err })),
        fetchApps().catch(err => ({ error: 'fetchApps', details: err })),
        fetchUsers().catch(err => ({ error: 'fetchUsers', details: err })),
        fetchAppTabConfigs().catch(err => ({ error: 'fetchAppTabConfigs', details: err })),

        (() => {
          console.log('🔍 === Calling fetchObjects from loadData ===');
          console.log('🔍 Tenant ID when calling fetchObjects:', tenant?.id);
          return fetchObjects().catch(err => ({ error: 'fetchObjects', details: err }));
        })()
      ]);
      
      // Check for any errors
      const errors = results.filter(r => r && r.error);
      if (errors.length > 0) {
        console.error('❌ Data loading errors:', errors);
      } else {
        console.log('✅ All data loaded successfully');
      }
    } catch (error) {
      console.error('❌ Error in loadData:', error);
    }
  };

  // Profile management handlers
  const handleCreateProfile = async () => {
    if (!newProfile.name.trim()) {
      return;
    }
  
    try {
      const { data, error } = await supabase
    .schema('tenant')
        .from('profiles')
        .insert([{ name: newProfile.name, description: newProfile.description, tenant_id: tenant?.id }])
        .select();

      if (error) throw error;

      setProfiles([...profiles, data[0]]);
      setShowCreateProfile(false);
      setNewProfile({ name: '', description: '' });
    } catch (err: any) {
      console.error('Error creating profile:', err);
    }
  };

  const handleEditProfile = (profile: { id: string; name: string; description: string }) => {
    setEditingProfile(profile);
    setNewProfile({ name: profile.name, description: profile.description });
    setShowCreateProfile(true);
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm('Are you sure you want to delete this profile?')) return;

    try {
      const { error } = await supabase
    .schema('tenant')
        .from('profiles')
        .delete()
        .eq('id', profileId);

      if (error) throw error;

      setProfiles(profiles.filter(p => p.id !== profileId));
    } catch (err: any) {
      console.error('Error deleting profile:', err);
    }
  };

  const handleSaveProfileEdit = async () => {
    if (!editingProfile) return;

    try {
      const { error } = await supabase
            .schema('tenant')
        .from('profiles')
        .update({ name: newProfile.name, description: newProfile.description })
        .eq('id', editingProfile.id);

      if (error) throw error;

      setProfiles(profiles.map(p => 
        p.id === editingProfile.id 
          ? { ...p, name: newProfile.name, description: newProfile.description }
          : p
      ));
      setShowCreateProfile(false);
      setEditingProfile(null);
      setNewProfile({ name: '', description: '' });
    } catch (err: any) {
      console.error('Error updating profile:', err);
    }
  };

  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase
        .schema('tenant')
        .from('profiles')
        .select('*')
            .eq('tenant_id', tenant?.id)
            .order('name');
          
      if (error) {
        // If profiles table doesn't exist yet, set empty array
        if (error.code === '42P01') { // relation does not exist
          console.warn('Profiles table not found, setting empty profiles array');
          setProfiles([]);
            return;
          }
        throw error;
      }
      setProfiles(data || []);
    } catch (err: any) {
      console.error('Error fetching profiles:', err);
      setProfiles([]); // Set empty array on any error
    }
  };

  const fetchTabs = async () => {
    try {
      console.log('🔍 === Fetching Tabs for Settings ===');
      console.log('Tenant ID:', tenant?.id);
      
      // Use the new comprehensive bridge function for Tab Settings
      const { data, error } = await supabase
        .rpc('get_tenant_tabs_for_settings', { p_tenant_id: tenant?.id });

      if (error) {
        console.error('❌ Error fetching tabs for settings:', error);
        throw error;
      }
      
      console.log('✅ Tabs fetched successfully for settings:', data);
      console.log('Number of tabs:', data?.length || 0);
      
      // Transform the data to match our interface - now much simpler!
      const transformedTabs = (data || []).map(tab => ({
        ...tab,
        // The new RPC function already provides these columns:
        name: tab.label || 'Unnamed Tab',
        description: tab.description || 'No description',
        api_name: tab.api_name || '-'
      }));
      
      console.log('✅ Transformed tabs for settings:', transformedTabs);
      setTabs(transformedTabs);
    } catch (err: any) {
      console.error('❌ Exception in fetchTabs:', err);
    }
  };

  const fetchApps = async () => {
    try {
      console.log('📱 === FETCHING APPS FROM RPC ===');
      console.log('Calling RPC function: get_apps');
      console.log('Parameter tenant_id:', tenant?.id);
      
      // Use bridge function instead of direct table access
      const { data, error } = await supabase
        .rpc('get_apps', { p_tenant_id: tenant?.id });

      if (error) {
        console.error('❌ Error calling get_apps RPC:', error);
        throw error;
      }

      console.log('✅ Apps fetched from RPC get_apps:');
      console.log('Total apps:', data?.length || 0);
      console.log('Apps data:', data);
      if (data && data.length > 0) {
        console.log('Sample app structure:', data[0]);
        console.log('App columns:', Object.keys(data[0] || {}));
      }

      setApps(data || []);
      console.log('✅ Apps state updated:', data || []);
    } catch (err: any) {
      console.error('❌ Error fetching apps:', err);
    }
  };

  const fetchUsers = async () => {
    try {
      // First get users from system schema
      const { data: systemUsers, error: systemError } = await supabase
        .schema('system')
        .from('users')
            .select(`
              id,
          email,
          role,
          first_name,
          last_name,
          tenant_id
        `)
        .eq('tenant_id', tenant?.id)
        .order('email');

      if (systemError) throw systemError;

      // Then get profiles from tenant schema (if available)
      let profiles = [];
      try {
        const { data: profilesData, error: profilesError } = await supabase
          .schema('tenant')
          .from('profiles')
          .select('*')
            .eq('tenant_id', tenant?.id);
          
        if (!profilesError && profilesData) {
          profiles = profilesData;
        }
      } catch (profilesErr) {
        // Profiles table might not exist yet, continue with empty profiles
        console.warn('Could not fetch profiles:', profilesErr);
      }

      // Transform the data to match our interface
      const transformedUsers = (systemUsers || []).map((user: any) => {
        // Find matching profile by role or create a default one
        let userProfile = undefined;
        
        if (profiles.length > 0) {
          // Try to match by role first
          userProfile = profiles.find(p => 
            p.name.toLowerCase().includes(user.role?.toLowerCase() || '') ||
            p.name.toLowerCase().includes('user')
          );
          
          // If no match, use first available profile
          if (!userProfile && profiles.length > 0) {
            userProfile = profiles[0];
          }
        }
        
            return {
          id: user.id,
          email: user.email,
          role: user.role,
          first_name: user.first_name,
          last_name: user.last_name,
          profile: userProfile || undefined
            };
          });
          
      setUsers(transformedUsers);
    } catch (err: any) {
      console.error('Error fetching users:', err);
    }
  };

  const handleCreateApp = async () => {
    if (!newApp.name.trim()) {
      return;
    }

    setCreatingApp(true);

    try {
      // Debug JWT and authentication info
      const session = await supabase.auth.getSession();
      const user = await supabase.auth.getUser();
      
      
      const { data, error } = await supabase
            .schema('tenant')
            .from('apps')
            .insert([{
              name: newApp.name,
              description: newApp.description,
              is_active: newApp.is_active,
              tenant_id: tenant?.id
            }])
            .select();
          
      if (error) throw error;

      setApps([...apps, data[0]]);
      setShowCreateApp(false);
      setNewApp({ name: '', description: '', is_active: true });
    } catch (err: any) {
      console.error('Error creating app:', err);
    } finally {
      setCreatingApp(false);
    }
  };

  const handleToggleAppStatus = async (appId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .schema('tenant')
        .from('apps')
        .update({ is_active: !currentStatus })
        .eq('id', appId);

      if (error) throw error;

      setApps(apps.map(app => 
        app.id === appId ? { ...app, is_active: !currentStatus } : app
      ));
    } catch (err: any) {
      console.error('Error updating app status:', err);
    }
  };

  const handleDeleteApp = async (appId: string, appName: string) => {
    if (!confirm(`Are you sure you want to delete "${appName}"?`)) return;

    try {
      const { error } = await supabase
        .schema('tenant')
        .from('apps')
        .delete()
        .eq('id', appId);

      if (error) throw error;

      setApps(apps.filter(app => app.id !== appId));
    } catch (err: any) {
      console.error('Error deleting app:', err);
    }
  };

  const handleAppClick = async (app: { id: string; name: string }) => {
    setSelectedAppForTabs(app);
    
    try {
      // Fetch available tabs for this app
      const { data, error } = await supabase
        .schema('tenant')
        .from('app_tabs')
        .select(`
          tab_id,
          tabs!inner(id, name)
        `)
        .eq('app_id', app.id)
        .eq('tenant_id', tenant?.id);

      if (error) throw error;

      // Transform to match our interface
      const availableTabs = tabs.map(tab => ({
        id: tab.id,
        name: tab.name,
        is_selected: data?.some(at => at.tab_id === tab.id) || false
      }));

      setAppTabs(availableTabs);
      setShowTabSelection(true);
    } catch (err: any) {
      console.error('Error loading app tabs:', err);
    }
  };

  const handleTabToggle = (tabId: string) => {
    setAppTabs(appTabs.map(tab => 
      tab.id === tabId ? { ...tab, is_selected: !tab.is_selected } : tab
    ));
  };

  const handleSaveAppTabs = async () => {
    if (!selectedAppForTabs) return;

    setSavingAppTabs(true);

    try {
      // Get selected tab IDs
      const selectedTabIds = appTabs
        .filter(tab => tab.is_selected)
        .map(tab => tab.id);

      // Delete existing app tabs
            const { error: deleteError } = await supabase
              .schema('tenant')
              .from('app_tabs')
              .delete()
        .eq('app_id', selectedAppForTabs.id)
              .eq('tenant_id', tenant?.id);
            
      if (deleteError) throw deleteError;

      // Insert new app tabs
      if (selectedTabIds.length > 0) {
        const appTabsToInsert = selectedTabIds.map(tabId => ({
          app_id: selectedAppForTabs.id,
          tab_id: tabId,
          tenant_id: tenant?.id
            }));
        
            const { error: insertError } = await supabase
              .schema('tenant')
              .from('app_tabs')
          .insert(appTabsToInsert);

        if (insertError) throw insertError;
      }

      setShowTabSelection(false);
      setSelectedAppForTabs(null);
    } catch (err: any) {
      console.error('Error saving app tabs:', err);
    } finally {
      setSavingAppTabs(false);
    }
  };

  const handleEditApp = (app: { id: string; name: string; description: string }) => {
    setEditingApp(app);
    setNewApp({ name: app.name, description: app.description, is_active: true });
    setShowEditApp(true);
  };

  const handleSaveAppEdit = async () => {
    if (!editingApp) return;

    setSavingApp(true);

    try {
      const { error } = await supabase
        .schema('tenant')
        .from('apps')
        .update({ 
          name: newApp.name, 
          description: newApp.description 
        })
        .eq('id', editingApp.id);

      if (error) throw error;

      setApps(apps.map(app => 
        app.id === editingApp.id 
          ? { ...app, name: newApp.name, description: newApp.description }
          : app
      ));
      setShowEditApp(false);
      setEditingApp(null);
      setNewApp({ name: '', description: '', is_active: true });
    } catch (err: any) {
      console.error('Error updating app:', err);
    } finally {
      setSavingApp(false);
    }
  };

  // Tab management handlers
  const fetchObjects = async () => {
    console.log('🔍 === fetchObjects Function Called ===');
    console.log('Current tenant?.id:', tenant?.id);
    console.log('Tenant type:', typeof tenant?.id);
    
    try {
      console.log('🔍 Calling RPC function: get_tenant_objects');
      console.log('🔍 Parameter: tenant_id =', tenant?.id);
      
      // Use the RPC function instead of direct table access
      const { data, error } = await supabase.rpc('get_tenant_objects', {
        p_tenant_id: tenant?.id
      });
      
      console.log('🔍 RPC response:');
      console.log('Data:', data);
      console.log('Error:', error);
      console.log('Data length:', data?.length || 0);
      console.log('Data type:', typeof data);
      console.log('Is array:', Array.isArray(data));
      
      if (error) {
        console.error('❌ Error calling get_tenant_objects:', error);
        console.error('❌ Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw error;
      }
      
      console.log('✅ Setting objects state with:', data || []);
      setObjects(data || []);
      
    } catch (err: any) {
      console.error('❌ Exception in fetchObjects:', err);
      console.error('❌ Exception type:', typeof err);
      console.error('❌ Exception message:', err?.message);
    }
  };

  const handleCreateTab = async () => {
    if (!newTab.name.trim()) return;
    
    try {
      console.log('🔍 === Creating Tab ===');
      console.log('Tab data to insert:', {
        label: newTab.name,  // Use name as label
        tab_type: newTab.tab_type,
        object_id: newTab.object_id || null,
        custom_component_path: newTab.custom_component_path || null,
        custom_route: newTab.custom_route || null,
        tenant_id: tenant?.id,
        is_active: true,
        order_index: 0
      });
      
      const { data, error } = await supabase
        .schema('tenant')
        .from('tabs')
        .insert([{
          label: newTab.name,  // Use name as label (matches DB schema)
          tab_type: newTab.tab_type,
          object_id: newTab.object_id || null,
          custom_component_path: newTab.custom_component_path || null,
          custom_route: newTab.custom_route || null,
          tenant_id: tenant?.id,
          is_active: true,
          order_index: 0
        }])
        .select();

      if (error) {
        console.error('❌ Error creating tab:', error);
        throw error;
      }
      
      console.log('✅ Tab created successfully:', data[0]);
      setTabs([...tabs, data[0]]);
      setShowCreateTabModal(false);
      setNewTab({ 
        name: '', 
        label: '',
        description: '', 
        is_visible: true,
        tab_type: 'object',
        object_id: '',
        custom_component_path: '',
        custom_route: ''
      });
    } catch (err: any) {
      console.error('❌ Exception creating tab:', err);
    }
  };

  const handleEditTab = (tab: any) => {
    setEditingTab(tab);
    setNewTab({
      name: tab.name,
      label: tab.label || '',
      description: tab.description || '',
      is_visible: tab.is_visible,
      tab_type: tab.tab_type || 'object',
      object_id: tab.object_id || '',
      custom_component_path: tab.custom_component_path || '',
      custom_route: tab.custom_route || ''
    });
    setShowCreateTabModal(true);
  };

  const handleToggleTabVisibility = async (tab: any) => {
    try {
      const { error } = await supabase
        .schema('tenant')
        .from('tabs')
        .update({ is_visible: !tab.is_visible })
        .eq('id', tab.id);

      if (error) throw error;
      
      setTabs(tabs.map(t => 
        t.id === tab.id ? { ...t, is_visible: !t.is_visible } : t
      ));
    } catch (err: any) {
      console.error('Error toggling tab visibility:', err);
    }
  };

  const handleDeleteTab = async (tab: any) => {
    if (!confirm('Are you sure you want to delete this tab?')) return;
    
    try {
      const { error } = await supabase
        .schema('tenant')
        .from('tabs')
        .delete()
        .eq('id', tab.id);

      if (error) throw error;

      setTabs(tabs.filter(t => t.id !== tab.id));
    } catch (err: any) {
      console.error('Error deleting tab:', err);
    }
  };

  const handleViewObjectRecords = async (tab: any) => {
    if (tab.object_id) {
      setSelectedObjectForRecords({ id: tab.object_id, name: tab.name });
      setShowObjectRecords(true);
      
      try {
        const { data, error } = await supabase
          .schema('tenant')
          .from('objects')
          .select('*')
          .eq('id', tab.object_id)
          .single();

        if (error) throw error;
        
        // Fetch records from the object's table - only read safe columns to avoid autonumber issues
        const { data: records, error: recordsError } = await supabase
          .schema('tenant')
          .from(data.table_name)
          .select('id, name, created_at, updated_at, is_active, tenant_id')  // ← Only safe columns, no autonumber
          .limit(100);

        if (recordsError) throw recordsError;
        
        setObjectRecords(records || []);
      } catch (err: any) {
        console.error('Error fetching object records:', err);
        setObjectRecords([]);
      }
    }
  };

  // Enhanced App Tab Management - Fetch from tenant.tabs and load existing states
  const fetchAppTabConfigs = async () => {
    try {
      console.log('🔍 === fetchAppTabConfigs Debug ===');
      console.log('Fetching all available tabs and existing app-tab relationships...');
      console.log('Tenant ID:', tenant?.id);
      console.log('Current apps state:', apps);
      console.log('Current appTabConfigs state:', appTabConfigs);
      
      // Fetch all available tabs using bridge function
      console.log('📋 === FETCHING FROM tenant.tabs (via bridge function) ===');
      const { data: allTabs, error: tabsError } = await supabase
        .rpc('get_tenant_tabs', { p_tenant_id: tenant?.id });

      if (tabsError) {
        console.error('❌ Error fetching tabs via bridge function:', tabsError);
        return;
      }

      console.log('✅ Tabs fetched from tenant.tabs:');
      console.log('Total tabs:', allTabs?.length || 0);
      console.log('Tabs data:', allTabs);
      if (allTabs && allTabs.length > 0) {
        console.log('Sample tab structure:', allTabs[0]);
        console.log('Tab columns:', Object.keys(allTabs[0] || {}));
      }

      // Fetch existing app-tab relationships using bridge function
      console.log('📋 === FETCHING FROM tenant.app_tabs (via bridge function) ===');
      console.log('Calling RPC function: get_tenant_app_tabs');
      console.log('Parameter tenant_id:', tenant?.id);
      
      const { data: existingAppTabs, error: appTabsError } = await supabase
        .rpc('get_tenant_app_tabs', { p_tenant_id: tenant?.id });

      console.log('Raw app-tabs query result via bridge function:', { data: existingAppTabs, error: appTabsError });
      
      if (appTabsError) {
        console.error('❌ Error fetching app-tabs:', appTabsError);
        console.error('Error details:', {
          message: appTabsError.message,
          details: appTabsError.details,
          hint: appTabsError.hint,
          code: appTabsError.code
        });
        return;
      }

      console.log('✅ App-tabs relationships fetched from tenant.app_tabs:');
      console.log('Total relationships:', existingAppTabs?.length || 0);
      console.log('App-tabs data:', existingAppTabs);
      if (existingAppTabs && existingAppTabs.length > 0) {
        console.log('Sample relationship structure:', existingAppTabs[0]);
        console.log('Relationship columns:', Object.keys(existingAppTabs[0] || {}));
      }

      // Process the tabs data with existing states
      console.log('🔄 === PROCESSING DATA ===');
      console.log('Processing for apps:', apps);
      
      const processedConfigs: { [key: string]: any[] } = {};
      const processedOrder: { [key: string]: any[] } = {};

      // For each app, create tab configurations with existing states
      apps.forEach((app, appIndex) => {
        console.log(`📱 Processing app ${appIndex + 1}:`, app);
        
        const appTabs = allTabs.map((tab, tabIndex) => {
          // Find existing relationship for this app-tab combination
          const existingRel = existingAppTabs?.find(at => 
            at.app_id === app.id && at.tab_id === tab.id
          );

          const processedTab = {
            id: existingRel?.id || tab.id, // Use existing ID if available
            app_id: app.id,
            tab_id: tab.id,
            tab_order: existingRel?.tab_order || 1,
            is_visible: existingRel?.is_visible ?? false, // Use existing state or default to false
            tenant_id: tenant?.id,
            created_at: existingRel?.created_at || new Date().toISOString(),
            updated_at: existingRel?.updated_at || new Date().toISOString(),
            app_name: app.name,
            app_description: app.description,
            tab_label: tab.label,
            tab_description: tab.label // Use label as description
          };

          console.log(`  📋 Tab ${tabIndex + 1}:`, {
            tabId: tab.id,
            tabLabel: tab.label,
            existingRelFound: !!existingRel,
            existingRelId: existingRel?.id,
            existingIsVisible: existingRel?.is_visible,
            finalIsVisible: processedTab.is_visible,
            finalTabOrder: processedTab.tab_order
          });

          return processedTab;
        });

        processedConfigs[app.id] = appTabs;
        processedOrder[app.id] = appTabs;
        
        console.log(`✅ App ${app.name} processed:`, {
          appId: app.id,
          totalTabs: appTabs.length,
          visibleTabs: appTabs.filter(t => t.is_visible).length,
          hiddenTabs: appTabs.filter(t => !t.is_visible).length
        });
      });

      console.log('📊 === FINAL PROCESSED DATA ===');
      console.log('Processed configs:', processedConfigs);
      console.log('Processed order:', processedOrder);
      
      // Log detailed breakdown for each app
      Object.keys(processedConfigs).forEach(appId => {
        const appConfig = processedConfigs[appId];
        const app = apps.find(a => a.id === appId);
        console.log(`📱 App "${app?.name}" (${appId}) configuration:`, {
          totalTabs: appConfig.length,
          visibleTabs: appConfig.filter(t => t.is_visible).map(t => t.tab_label),
          hiddenTabs: appConfig.filter(t => !t.is_visible).map(t => t.tab_label),
          tabOrder: appConfig.map(t => ({ tab: t.tab_label, order: t.tab_order }))
        });
      });

      setAppTabConfigs(processedConfigs);
      setAppTabOrder(processedOrder);
      
      console.log('✅ State updated - appTabConfigs:', processedConfigs);
      console.log('✅ State updated - appTabOrder:', processedOrder);
      
    } catch (err: any) {
      console.error('❌ Exception in fetchAppTabConfigs:', err);
    }
  };

  const handleAppTabConfig = async (app: any) => {
    console.log('🎯 === MODAL OPENING ===');
    console.log('App selected for tab config:', app);
    console.log('Current appTabConfigs state before refresh:', appTabConfigs);
    
    setSelectedAppForTabConfig(app);
    setShowAppTabConfigModal(true);
    
    console.log('Modal state set to true, now refreshing data...');
    
    // Always refresh data when modal opens to ensure fresh state
      await fetchAppTabConfigs();
    
    console.log('✅ Data refresh completed for modal');
  };

  const handleTabVisibilityToggle = async (appId: string, tabId: string, isVisible: boolean) => {
    try {
      console.log('🔍 === Checkbox Click Debug ===');
      console.log('appId:', appId);
      console.log('tabId:', tabId);
      console.log('isVisible:', isVisible);
      console.log('tenant?.id:', tenant?.id);
      
      // Update local state immediately for better UX
      setAppTabConfigs(prev => ({
        ...prev,
        [appId]: prev[appId]?.map(tab => 
          tab.tab_id === tabId 
            ? { ...tab, is_visible: isVisible }
            : tab
        ) || []
      }));
      
      // Use bridge function to persist changes
      const { data, error } = await supabase
        .rpc('update_tab_visibility', {
          p_app_id: appId,
          p_tab_id: tabId,
          p_is_visible: isVisible,
          p_tenant_id: tenant?.id
        });

      console.log('RPC Response:', { data, error });

      if (error) throw error;
      
      // Check if the operation was successful
      if (data && data.success) {
        console.log('✅ Tab visibility updated successfully');
      } else {
        throw new Error(data?.message || 'Failed to update tab visibility');
      }
    } catch (err: any) {
      console.error('❌ Error updating tab visibility:', err);
      // Revert local state on error
      await fetchAppTabConfigs();
    }
  };

  const handleTabOrderChange = async (appId: string, tabIds: string[]) => {
    try {
      // Update tab order for each tab
      const updates = tabIds.map((tabId, index) => ({
        app_id: appId,
        tab_id: tabId,
        tab_order: index + 1,
        tenant_id: tenant?.id
      }));

      // Use RPC function instead of direct table access to bypass RLS
      const { data, error } = await supabase
        .rpc('bulk_update_tab_visibility', {
          p_updates: updates,
          p_tenant_id: tenant?.id
        });

      if (error) throw error;
      
      // Check if the operation was successful
      if (data && data.success) {
        console.log('✅ Tab order updated successfully');
        // Update local state
        await fetchAppTabConfigs();
      } else {
        throw new Error(data?.message || 'Failed to update tab order');
      }
    } catch (err: any) {
      console.error('Error updating tab order:', err);
    }
  };

  const handleBulkTabOperation = async (appId: string, operation: 'show_all' | 'hide_all' | 'reset_order' | 'save_custom', updates?: any[]) => {
    try {
      console.log('🔄 === BULK OPERATION START ===');
      console.log('Operation:', operation);
      console.log('App ID:', appId);
      console.log('Updates provided:', !!updates);
      
      let upsertUpdates: any[] = [];
      
      if (operation === 'show_all') {
        const isVisible = true;
        upsertUpdates = (appTabConfigs[appId] || []).map(appTab => ({
          app_id: appId,
          tab_id: appTab.tab_id,
          is_visible: isVisible,
          tenant_id: tenant?.id
        }));
        console.log('📋 Show All: Created', upsertUpdates.length, 'updates');
      } else if (operation === 'hide_all') {
        const isVisible = false;
        upsertUpdates = (appTabConfigs[appId] || []).map(appTab => ({
          app_id: appId,
          tab_id: appTab.tab_id,
          is_visible: isVisible,
          tenant_id: tenant?.id
        }));
        console.log('📋 Hide All: Created', upsertUpdates.length, 'updates');
      } else if (operation === 'reset_order') {
        upsertUpdates = (appTabConfigs[appId] || []).map((appTab, index) => ({
          app_id: appId,
          tab_id: appTab.tab_id,
          tab_order: index + 1,
          tenant_id: tenant?.id
        }));
        console.log('📋 Reset Order: Created', upsertUpdates.length, 'updates');
      } else if (operation === 'save_custom') {
        upsertUpdates = updates || [];
        console.log('📋 Save Custom: Using', upsertUpdates.length, 'provided updates');
      }

      console.log('📊 Final upsert data:', upsertUpdates);
      console.log('🚀 Calling database upsert...');
      console.log('RPC function: bulk_update_tab_visibility');
      console.log('Parameters:', {
        p_updates: upsertUpdates,
        p_tenant_id: tenant?.id
      });

      // Use RPC function instead of direct table access to bypass RLS
      const { data, error } = await supabase
        .rpc('bulk_update_tab_visibility', {
          p_updates: upsertUpdates,
          p_tenant_id: tenant?.id
        });

      if (error) {
        console.error('❌ RPC call error:', error);
        console.error('Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw error;
      }

      console.log('✅ RPC call successful!');
      console.log('📊 RPC Response:', data);
      console.log('📊 Rows processed:', data?.total_processed || 0);
      console.log('📊 Success count:', data?.success_count || 0);
      console.log('📊 Error count:', data?.error_count || 0);
      
      await fetchAppTabConfigs();
    } catch (err: any) {
      console.error('❌ Error in bulk operation:', err);
      throw err;
    }
  };

  return (
    <div className="p-6">
      {/* 30/70 Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        {/* 30% sidebar tabs */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg border">
            <div className="p-2">
              <nav className="space-y-1">
                {homeSections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setSelectedHomeSection(section.id as any)}
                    className={`w-full text-left px-4 py-3 rounded-md ${
                      selectedHomeSection === section.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span>{section.icon}</span>
                      <span className="font-medium">{section.label}</span>
                    </div>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* 70% content */}
        <div className="lg:col-span-7">
          <div className="bg-white rounded-lg border">
            <div className="p-6">
              {/* Profile Settings Section */}
              {selectedHomeSection === 'profile' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">Profile Settings</h2>
                    <button
                      onClick={() => setShowCreateProfile(true)}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
                    >
                      + Create Profile
                    </button>
                  </div>

                  <DataTable
                    data={profiles}
                    searchKeys={['name', 'description']}
                    renderHeader={() => (
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    )}
                    renderRow={(profile: any) => (
                      <tr key={profile.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {profile.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {profile.description}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEditProfile(profile)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteProfile(profile.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  />

                  {/* Create/Edit Profile Modal */}
                  {showCreateProfile && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-96">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">
                          {editingProfile ? 'Edit Profile' : 'Create New Profile'}
                        </h3>
                        <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Name</label>
                            <input
                              type="text"
                              value={newProfile.name}
                              onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Description</label>
                            <textarea
                              value={newProfile.description}
                              onChange={(e) => setNewProfile({ ...newProfile, description: e.target.value })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              rows={3}
                            />
                          </div>
                        </div>
                        <div className="mt-6 flex justify-end space-x-3">
                          <button
                            onClick={() => {
                              setShowCreateProfile(false);
                              setEditingProfile(null);
                              setNewProfile({ name: '', description: '' });
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={editingProfile ? handleSaveProfileEdit : handleCreateProfile}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                          >
                            {editingProfile ? 'Save Changes' : 'Create Profile'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                    </div>
                  )}

              {/* Users & Roles Section */}
              {selectedHomeSection === 'users_roles' && (
                <UserManagement tenant={tenant} />
              )}

              {/* Permission Sets Section */}
              {selectedHomeSection === 'permission_sets' && (
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Permission Sets</h2>
                  <p className="text-gray-600">Permission set management functionality will be implemented here.</p>
                </div>
              )}

              {/* Tab Settings Section */}
              {selectedHomeSection === 'tab_settings' && (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-semibold text-gray-900">Tab Settings</h2>
      <div className="flex space-x-3">
        <button
          onClick={() => {
            console.log('🔍 === Create Tab Button Clicked ===');
            console.log('Current showCreateTabModal state:', showCreateTabModal);
            setShowCreateTabModal(true);
            console.log('showCreateTabModal set to true');
            console.log('Modal should now be visible');
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Create Tab
        </button>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Refresh
        </button>
      </div>
    </div>

    {/* Tab Settings DataTable */}
    <DataTable
      title="Navigation Tabs"
      data={tabs}
      searchPlaceholder="Search tabs..."
      searchKeys={['name', 'api_name', 'description', 'source_label']}
      emptyMessage="No tabs found. Create your first tab to get started."
      noSearchResultsMessage="No tabs found matching your search."
      renderHeader={() => (
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Tab Name
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Type
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Source
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            API Name
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Description
          </th>
          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Status
          </th>
          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
            Actions
          </th>
        </tr>
      )}
      renderRow={(tab) => (
        <tr key={tab.id} className="hover:bg-gray-50">
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="flex items-center">
              <span className="text-sm font-medium text-gray-900">{tab.name}</span>
              {tab.is_system_tab && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                  System
                </span>
              )}
            </div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              tab.tab_type === 'object' ? 'bg-green-100 text-green-800' :
              tab.tab_type === 'custom' ? 'bg-purple-100 text-purple-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {tab.tab_type === 'object' ? 'Object' : 
               tab.tab_type === 'custom' ? 'Custom' : 'Hybrid'}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            {tab.source_label || '-'}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            {tab.api_name}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
            {tab.description || '-'}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-center">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              tab.is_visible ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {tab.is_visible ? 'Visible' : 'Hidden'}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
            <div className="flex justify-center space-x-2">
              <button
                onClick={() => handleEditTab(tab)}
                className="text-indigo-600 hover:text-indigo-900"
                title="Edit Tab"
              >
                ⚙️
              </button>
              <button
                onClick={() => handleToggleTabVisibility(tab)}
                className={`${
                  tab.is_visible ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'
                }`}
                title={tab.is_visible ? 'Hide Tab' : 'Show Tab'}
              >
                {tab.is_visible ? '👁️' : '👁️'}
              </button>
              {tab.tab_type === 'object' && (
                <button
                  onClick={() => handleViewObjectRecords(tab)}
                  className="text-blue-600 hover:text-blue-900"
                  title="View Records"
                >
                  👁️
                </button>
              )}
              {!tab.is_system_tab && (
                <button
                  onClick={() => handleDeleteTab(tab)}
                  className="text-red-600 hover:text-red-900"
                  title="Delete Tab"
                >
                  🗑️
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    />

    {/* Create/Edit Tab Modal - MOVED INSIDE Tab Settings Section */}
    {(() => {
      console.log('🔍 === Modal Render Check (Inside Tab Settings) ===');
      console.log('showCreateTabModal value:', showCreateTabModal);
      console.log('showCreateTabModal type:', typeof showCreateTabModal);
      console.log('showCreateTabModal === true:', showCreateTabModal === true);
      console.log('showCreateTabModal == true:', showCreateTabModal == true);
      console.log('Boolean(showCreateTabModal):', Boolean(showCreateTabModal));
      return null;
    })()}
    {showCreateTabModal && (
      <>
        {(() => {
          console.log('🎯 === Create Tab Modal Rendering (Inside Tab Settings) ===');
          console.log('showCreateTabModal is true, rendering modal');
          console.log('Modal content should be visible now');
          console.log('Modal JSX is executing!');
          return null;
        })()}
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-4/5 max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {editingTab ? 'Edit Tab' : 'Create New Tab'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateTabModal(false);
                  setEditingTab(null);
                  setNewTab({ 
                    name: '', 
                    label: '',
                    description: '', 
                    is_visible: true,
                    tab_type: 'object',
                    object_id: '',
                    custom_component_path: '',
                    custom_route: ''
                  });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Tab Name</label>
                <input
                  type="text"
                  value={newTab.name}
                  onChange={(e) => setNewTab({ ...newTab, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter tab name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={newTab.description}
                  onChange={(e) => setNewTab({ ...newTab, description: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  rows={2}
                  placeholder="Enter tab description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Tab Type</label>
                <select
                  value={newTab.tab_type}
                  onChange={(e) => setNewTab({ ...newTab, tab_type: e.target.value as 'object' | 'custom' | 'hybrid' })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="object">Object Tab (Display Object Records)</option>
                  <option value="custom">Custom Tab (Custom Component)</option>
                  <option value="hybrid">Hybrid Tab (Object + Custom)</option>
                </select>
              </div>

              {newTab.tab_type === 'object' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Select Object</label>
                  {(() => {
                    console.log('🔍 === Objects State in Modal ===');
                    console.log('objects array:', objects);
                    console.log('objects length:', objects.length);
                    console.log('objects type:', typeof objects);
                    return null;
                  })()}
                  <select
                    value={newTab.object_id}
                    onChange={(e) => setNewTab({ ...newTab, object_id: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select an object</option>
                    {objects.map(obj => (
                      <option key={obj.id} value={obj.id}>{obj.name}</option>
                    ))}
                  </select>
                  <div className="mt-1 text-xs text-gray-500">
                    Available objects: {objects.length} found
                  </div>
                </div>
              )}

              {newTab.tab_type === 'custom' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Custom Component Path</label>
                    <input
                      type="text"
                      value={newTab.custom_component_path}
                      onChange={(e) => setNewTab({ ...newTab, custom_component_path: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., /custom/my-component"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Custom Route</label>
                    <input
                      type="text"
                      value={newTab.custom_route}
                      onChange={(e) => setNewTab({ ...newTab, custom_route: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., /custom-tab"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_visible"
                  checked={newTab.is_visible}
                  onChange={(e) => setNewTab({ ...newTab, is_visible: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_visible" className="ml-2 block text-sm text-gray-900">
                  Tab is visible by default
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateTabModal(false);
                  setEditingTab(null);
                  setNewTab({ 
                    name: '', 
                    label: '',
                    description: '', 
                    is_visible: true,
                    tab_type: 'object',
                    object_id: '',
                    custom_component_path: '',
                    custom_route: ''
                  });
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTab}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                {editingTab ? 'Update Tab' : 'Create Tab'}
              </button>
            </div>
          </div>
        </div>
      </>
    )}
  </div>
)}

              {/* App Manager Section */}
              {selectedHomeSection === 'app_manager' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">App Manager</h2>
                    <button
                      onClick={() => setShowCreateApp(true)}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      + Create App
                    </button>
                  </div>

                  <DataTable
                    data={apps}
                    searchPlaceholder="Search applications..."
                    searchKeys={['name', 'description']}
                    emptyMessage="No applications yet."
                    noSearchResultsMessage="No applications found matching your search."
                    renderHeader={() => (
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">App</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tabs</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      </tr>
                    )}
                    renderRow={(app: any) => (
                      
                      <tr key={app.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{app.name}</div>
                              <div className="text-sm text-gray-500">{app.description}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            app.is_active 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {app.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600">
                            {appTabConfigs[app.id]?.filter((config: any) => config.is_visible).length || 0} / {tabs.length} visible
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(app.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="relative">
                            <button
                              onClick={() => {
                               
                                const newState = openAppDropdown === app.id ? null : app.id;
                               
                                setOpenAppDropdown(newState);
                              }}
                              className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
                            >
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>
                            
                            {/* Dropdown Menu */}
                            {openAppDropdown === app.id && (
                              <div className="app-dropdown-container absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200">
                                <div className="py-1">
                            <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleAppTabConfig(app);
                                      setOpenAppDropdown(null);
                                    }}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    Manage Tabs
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleToggleAppStatus(app.id, app.is_active);
                                      setOpenAppDropdown(null);
                                    }}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              {app.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                                    onClick={() => {
                                      handleEditApp(app);
                                      setOpenAppDropdown(null);
                                    }}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleDeleteApp(app.id, app.name);
                                      setOpenAppDropdown(null);
                                    }}
                                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                            >
                              Delete
                            </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  />

                  {/* Show Create App button when no apps exist */}
                  {apps.length === 0 && (
                    <div className="text-center py-12">
                      <div className="text-gray-500 mb-4">No apps created yet</div>
                      <button
                        onClick={() => setShowCreateApp(true)}
                        className="bg-blue-600 text-white px-6 py-3 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        + Create Your First App
                      </button>
                    </div>
                  )}

                  {/* Floating Create App button when apps exist */}
                  {apps.length > 0 && (
                    <div className="fixed bottom-6 right-6 z-40">
                      <button
                        onClick={() => setShowCreateApp(true)}
                        className="bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 transition-all duration-200 hover:scale-110"
                        title="Create New App"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Create App Modal */}
                  {showCreateApp && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-96">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Create New App</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Name</label>
                            <input
                              type="text"
                              value={newApp.name}
                              onChange={(e) => setNewApp({ ...newApp, name: e.target.value })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Description</label>
                            <textarea
                              value={newApp.description}
                              onChange={(e) => setNewApp({ ...newApp, description: e.target.value })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              rows={3}
                            />
                          </div>
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              checked={newApp.is_active}
                              onChange={(e) => setNewApp({ ...newApp, is_active: e.target.checked })}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <label className="ml-2 text-sm text-gray-700">Active</label>
                          </div>
                        </div>
                        <div className="mt-6 flex justify-end space-x-3">
                          <button
                            onClick={() => setShowCreateApp(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleCreateApp}
                            disabled={creatingApp}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                          >
                            {creatingApp ? 'Creating...' : 'Create App'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Edit App Modal */}
                  {showEditApp && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-96">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Edit App</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Name</label>
                                      <input
                              type="text"
                              value={newApp.name}
                              onChange={(e) => setNewApp({ ...newApp, name: e.target.value })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                      />
                                    </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Description</label>
                            <textarea
                              value={newApp.description}
                              onChange={(e) => setNewApp({ ...newApp, description: e.target.value })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              rows={3}
                                      />
                                    </div>
                                    </div>
                        <div className="mt-6 flex justify-end space-x-3">
                          <button
                            onClick={() => {
                              setShowEditApp(false);
                              setEditingApp(null);
                              setNewApp({ name: '', description: '', is_active: true });
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveAppEdit}
                            disabled={savingApp}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingApp ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                </div>
              )}

                  {/* Tab Selection Modal */}
                  {showTabSelection && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-4/5 max-w-4xl max-h-[80vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-medium text-gray-900">
                            Configure Tabs for {selectedAppForTabs?.name}
                          </h3>
                          <button
                            onClick={() => setShowTabSelection(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-1 gap-4">
                          {appTabs.map((tab) => (
                            <div
                              key={tab.id}
                              className="flex items-center justify-between p-3 border border-gray-200 rounded-md"
                            >
                              <span className="text-sm font-medium text-gray-900">{tab.name}</span>
                                      <input
                                        type="checkbox"
                                checked={tab.is_selected}
                                onChange={() => handleTabToggle(tab.id)}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                      />
                                    </div>
                          ))}
                                  </div>

                        <div className="mt-6 flex justify-end space-x-3">
                          <button
                            onClick={() => setShowTabSelection(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveAppTabs}
                            disabled={savingAppTabs}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingAppTabs ? 'Saving...' : 'Save Configuration'}
                          </button>
                            </div>
                          </div>
                    </div>
                  )}

                  

                  {/* App Tab Configuration Modal */}
                  {showAppTabConfigModal && selectedAppForTabConfig && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-4/5 max-w-4xl max-h-[80vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-medium text-gray-900">
                            Tab Configuration for {selectedAppForTabConfig.name}
                          </h3>
                          <button
                            onClick={() => {
                              setShowAppTabConfigModal(false);
                              setSelectedAppForTabConfig(null);
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Bulk Operations */}
                        <div className="mb-6 flex gap-2">
                          <button
                            onClick={() => handleBulkTabOperation(selectedAppForTabConfig.id, 'show_all')}
                            className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
                          >
                            Show All Tabs
                          </button>
                          <button
                            onClick={() => handleBulkTabOperation(selectedAppForTabConfig.id, 'hide_all')}
                            className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                          >
                            Hide All Tabs
                          </button>
                          <button
                            onClick={() => handleBulkTabOperation(selectedAppForTabConfig.id, 'reset_order')}
                            className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
                          >
                            Reset Order
                          </button>
                        </div>

                        {/* Tabs Configuration Table */}
                        {(() => {
                          console.log('🎯 === MODAL RENDERING TABLE ===');
                          console.log('selectedAppForTabConfig:', selectedAppForTabConfig);
                          console.log('appTabConfigs for this app:', appTabConfigs[selectedAppForTabConfig.id]);
                          console.log('Total tabs to render:', appTabConfigs[selectedAppForTabConfig.id]?.length || 0);
                          
                          if (appTabConfigs[selectedAppForTabConfig.id]) {
                            console.log('Tab visibility breakdown:');
                            appTabConfigs[selectedAppForTabConfig.id].forEach((tab, idx) => {
                              console.log(`  Tab ${idx + 1}: ${tab.tab_label} - Visible: ${tab.is_visible}`);
                            });
                          }
                          
                          return null;
                        })()}
                        
                        {/* Loading State */}
                        {!appTabConfigs[selectedAppForTabConfig.id] && (
                          <div className="text-center py-8">
                            <div className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-500">
                              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Loading tab configuration...
                            </div>
                          </div>
                        )}
                        
                        {/* Tabs Table - Only show when data is loaded */}
                        {appTabConfigs[selectedAppForTabConfig.id] && (
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Tab Name
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Description
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Visible
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Order
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {appTabConfigs[selectedAppForTabConfig.id]?.map((appTab, index) => {
                                const isVisible = appTab?.is_visible ?? false;
                                const tabOrder = appTab?.tab_order ?? index + 1;
                                
                                return (
                                  <tr key={appTab.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                      {appTab.tab_label || 'Unknown Tab'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      {appTab.tab_description || 'No description'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <input
                                        type="checkbox"
                                        checked={isVisible}
                                        data-tab-id={appTab.tab_id}
                                        onChange={(e) => handleTabVisibilityToggle(selectedAppForTabConfig.id, appTab.tab_id, e.target.checked)}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                      />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {tabOrder}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => {
                                            const newOrder = Math.max(1, tabOrder - 1);
                                            handleTabOrderChange(selectedAppForTabConfig.id, [appTab.tab_id]);
                                          }}
                                          className="text-blue-600 hover:text-blue-900"
                                          disabled={tabOrder <= 1}
                                        >
                                          ↑
                                        </button>
                                        <button
                                          onClick={() => {
                                            const newOrder = tabOrder + 1;
                                            handleTabOrderChange(selectedAppForTabConfig.id, [appTab.tab_id]);
                                          }}
                                          className="text-blue-600 hover:text-blue-900"
                                        >
                                          ↓
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        )}

                        <div className="mt-6 flex justify-end gap-3">
                          <button
                            onClick={async () => {
                              try {
                                console.log('💾 === SAVE BUTTON CLICKED ===');
                                console.log('App ID:', selectedAppForTabConfig.id);
                                console.log('App Name:', selectedAppForTabConfig.name);
                                console.log('Total tabs found:', appTabConfigs[selectedAppForTabConfig.id]?.length || 0);
                                
                                // Collect all checkbox states from the modal
                                const updates = (appTabConfigs[selectedAppForTabConfig.id] || []).map((appTab, index) => {
                                  const checkbox = document.querySelector(`input[data-tab-id="${appTab.tab_id}"]`) as HTMLInputElement;
                                  const isVisible = checkbox ? checkbox.checked : false;
                                  
                                  console.log(`📋 Tab ${index + 1}:`, {
                                    tabId: appTab.tab_id,
                                    tabName: appTab.tab_label || 'Unknown Tab',
                                    checkboxFound: !!checkbox,
                                    isChecked: isVisible,
                                    willSave: isVisible
                                  });
                                  
                                  return {
                                    app_id: selectedAppForTabConfig.id,
                                    tab_id: appTab.tab_id,
                                    tab_order: index + 1,
                                    is_visible: isVisible,
                                    tenant_id: tenant?.id
                                  };
                                });
                                
                                console.log('📊 === FINAL DATA TO SAVE ===');
                                console.log('Total updates:', updates.length);
                                console.log('Checked tabs:', updates.filter(u => u.is_visible).length);
                                console.log('Unchecked tabs:', updates.filter(u => !u.is_visible).length);
                                console.log('Full updates array:', updates);
                                
                                // Use bulk operation to save all changes
                                console.log('🚀 Calling handleBulkTabOperation...');
                                await handleBulkTabOperation(selectedAppForTabConfig.id, 'save_custom', updates);
                                
                                console.log('✅ Tab configurations saved successfully!');
                                
                                // Close modal
                                setShowAppTabConfigModal(false);
                                setSelectedAppForTabConfig(null);
                                
                              } catch (error) {
                                console.error('❌ Error saving tab configurations:', error);
                                alert('Error saving changes. Please try again.');
                              }
                            }}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                          >
                            Save & Close
                          </button>
                          <button
                            onClick={() => {
                              setShowAppTabConfigModal(false);
                              setSelectedAppForTabConfig(null);
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Object Records Modal */}
                  {showObjectRecords && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-white rounded-lg p-6 w-4/5 max-w-6xl max-h-[80vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-medium text-gray-900">
                            Records for {selectedObjectForRecords?.name}
                          </h3>
                          <button
                            onClick={() => setShowObjectRecords(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                  </div>

                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                {objectRecords.length > 0 && Object.keys(objectRecords[0]).map(key => (
                                  <th key={key} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {objectRecords.map((record, index) => (
                                <tr key={index}>
                                  {Object.values(record).map((value, valueIndex) => (
                                    <td key={valueIndex} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                  </div>

                        <div className="mt-6 flex justify-end">
                          <button
                            onClick={() => setShowObjectRecords(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* System Settings Section */}
              {selectedHomeSection === 'system_settings' && (
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">System Settings</h2>
                  <div className="bg-gray-50 rounded-lg p-6">
                    <p className="text-gray-600">System settings will be implemented here.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
