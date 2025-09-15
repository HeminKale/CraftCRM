-- Migration 047: Update Modal Data Source (Frontend Changes)
-- This migration documents the frontend changes made to HomeTab.tsx

-- CHANGES MADE TO: app/commonfiles/core/components/settings/HomeTab.tsx

-- 1. Updated fetchAppTabConfigs function to fetch from tenant.tabs and load existing states
--    - Changed from RPC call to direct table queries
--    - Now shows ALL available tabs for ALL apps
--    - Loads existing checkbox states from tenant.app_tabs
--    - Consistent tab count across all apps
--    - Persists user selections between modal sessions

-- 2. Updated handleTabVisibilityToggle function
--    - Added immediate local state update for better UX
--    - Added error handling with state reversion
--    - Maintains RPC call for persistence

-- 3. Modal now displays:
--    - All available tabs from tenant.tabs
--    - Consistent row count (5 tabs) for all apps
--    - Proper checkbox states for each app-tab combination

-- BENEFITS:
-- - All apps now show the same number of tabs
-- - Users can see and select from all available tabs
-- - Consistent user experience across all apps
-- - Better performance (direct table query vs RPC)

-- NOTE: This is a frontend-only migration
-- No database schema changes required
-- The changes are already applied to the codebase
