-- ============================================================
-- Migration 281: Add missing created_by / updated_by columns
--                 to tenant.renewal_clients__a
--
-- Bug: tenant.renewal_clients__a was created in migration 221 without
-- created_by/updated_by columns. Migration 225 (later redefined again in
-- 256) rewrote create_renewal_client() to INSERT into those two columns
-- anyway, without ever adding them to the table. Every call to
-- create_renewal_client() has been failing with:
--   column "created_by" of relation "renewal_clients__a" does not exist
--
-- Fix: add the two columns. Matches the type/convention Recertification's
-- own table already uses (migration 264: `created_by TEXT, updated_by TEXT`,
-- storing the caller's resolved display name, not a UUID — see
-- create_renewal_client()'s `_caller_name` variable).
--
-- No tenant.fields registration needed — Recertification's identical
-- columns were never registered there either (confirmed: migration 264
-- has no tenant.fields INSERT for created_by/updated_by); these are
-- internal bookkeeping columns, not user-facing fields.
-- ============================================================

ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;
