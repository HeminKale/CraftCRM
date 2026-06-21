-- ================================
-- Migration 218: Add missing columns to external_clients__a
--
-- Fields exist in tenant.fields but columns were never added to the table.
-- ================================

ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS "Stage_one_plan_Sent_Date__a"   DATE,
  ADD COLUMN IF NOT EXISTS "Stage_one_Audit_Done_on__a"    DATE,
  ADD COLUMN IF NOT EXISTS "Report_Sent_Date__a"           DATE,
  ADD COLUMN IF NOT EXISTS "stage_one_audit_plan__a"       JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "Stage_two_audit_plan__a"       JSONB DEFAULT '[]'::jsonb;
