-- Migration 046: Design Decision - No Automatic Tab Creation
-- Tabs are app-specific and should be created by users, not automatically

-- REASONING:
-- 1. tenant.tabs table requires app_id (NOT NULL constraint)
-- 2. Tabs are app-specific, not object-specific
-- 3. Users should choose which objects become tabs for which apps
-- 4. More flexible and user-controlled approach

-- IMPLEMENTATION:
-- - No automatic trigger needed
-- - Users create tabs via the Manage Tabs modal
-- - Tabs are created when users select objects for specific apps
-- - Better user experience and more control

-- NOTE: This migration documents the design decision
-- No database changes are made
