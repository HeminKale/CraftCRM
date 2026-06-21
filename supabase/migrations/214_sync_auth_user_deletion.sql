-- ================================
-- Migration 214: Sync auth.users deletion to system.users
--
-- When a user is deleted from Supabase auth (auth.users),
-- this trigger automatically removes them from system.users.
-- ================================

CREATE OR REPLACE FUNCTION system.on_auth_user_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM system.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_auth_user_deletion ON auth.users;

CREATE TRIGGER trg_sync_auth_user_deletion
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION system.on_auth_user_deleted();
