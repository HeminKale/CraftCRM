-- ================================
-- Migration 218: Fix stage/audit column types on external_clients__a
--
-- stage_one_audit_plan__a and Stage_two_audit_plan__a are text but must
-- be jsonb to work as file upload fields.
-- Also removes the bad column with a space in its name.
-- ================================

-- 1. Fix file columns: text → jsonb
ALTER TABLE tenant.external_clients__a
  ALTER COLUMN "stage_one_audit_plan__a"
    TYPE JSONB USING CASE
      WHEN "stage_one_audit_plan__a" IS NULL OR "stage_one_audit_plan__a" = '' THEN '[]'::jsonb
      ELSE "stage_one_audit_plan__a"::jsonb
    END;

ALTER TABLE tenant.external_clients__a
  ALTER COLUMN "Stage_two_audit_plan__a"
    TYPE JSONB USING CASE
      WHEN "Stage_two_audit_plan__a" IS NULL OR "Stage_two_audit_plan__a" = '' THEN '[]'::jsonb
      ELSE "Stage_two_audit_plan__a"::jsonb
    END;

-- 2. Drop the bad column with a space in its name (duplicate of stage_one_audit_plan__a)
ALTER TABLE tenant.external_clients__a
  DROP COLUMN IF EXISTS "Stage_one_audit Plan__a";
