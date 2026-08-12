-- ============================================================
-- Migration 282: certification_body__a column — schema only
--
-- Adds the "Certification Body" provenance column to the three client
-- objects that currently exist. This is the first object to carry the
-- field; the pattern is designed to be repeated on every future object,
-- see the reference doc for the full recipe:
--   UAF New Changes/New Help Doc/General/certification-body-app-scoping.md
--
-- Deliberately NOT registered in tenant.fields. Confirmed precedent
-- (migration 246, auditor_id__a/tech_reviewer_id__a): update_tenant_record
-- writes any column named in its JSONB payload with ZERO field-level
-- permission checking — can_edit in Permission Sets is enforced
-- client-side only for that RPC. Registering this column would let any
-- user with generic edit access on the object hand-edit it via the
-- standard Page Layout form, silently defeating the app-scoping this
-- field exists to enforce. Same treatment as created_by/updated_by:
-- a real physical column, automatically included in every record's
-- data by get_object_records_with_references (which reads
-- information_schema.columns directly, not tenant.fields), written
-- only by the record-creation RPCs, never exposed as an editable field.
-- ============================================================

ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS certification_body__a TEXT;

ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS certification_body__a TEXT;

ALTER TABLE tenant.recertification_clients__a
  ADD COLUMN IF NOT EXISTS certification_body__a TEXT;
