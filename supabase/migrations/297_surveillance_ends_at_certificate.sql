-- Surveillance ends at Certificate_Issued. Suspension and withdrawal are
-- paused pending business review. Keep historical values and read access.
-- Apply after 291-296. This migration does not rewrite existing records.

CREATE OR REPLACE FUNCTION public.guard_paused_surveillance_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _before JSONB := '{}'::jsonb;
  _after JSONB := to_jsonb(NEW);
  _key TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN _before := to_jsonb(OLD); END IF;
  IF _before->>'status__a'='Certificate_Issued' AND
     _after->>'status__a' IS DISTINCT FROM 'Certificate_Issued' THEN
    RAISE EXCEPTION 'This Surveillance workflow is complete at Certificate Issued.';
  END IF;
  IF _after->>'status__a' IS DISTINCT FROM _before->>'status__a' AND
     _after->>'status__a' IN (
       'Suspension_Intimation_Sent','Suspension_Decision_Uploaded','Suspension_Letter_Sent',
       'Withdrawal_Intimation_Sent','Withdrawal_Decision_Uploaded','Withdrawal_Letter_Sent'
     ) THEN
    RAISE EXCEPTION 'Surveillance ends at Certificate Issued. Suspension and withdrawal are on hold pending business review.';
  END IF;
  FOR _key IN SELECT jsonb_object_keys(_after) LOOP
    IF (_key LIKE 'surv_suspension_%' OR _key LIKE 'surv_withdrawal_%') AND
       _after->_key IS DISTINCT FROM _before->_key THEN
      -- Empty column defaults on a new ordinary Surveillance are valid.
      IF TG_OP = 'INSERT' AND coalesce(_after->>_key,'') IN ('','{}','[]','null') THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Suspension and withdrawal changes are on hold pending business review.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_paused_surveillance_changes() FROM PUBLIC;
DROP TRIGGER IF EXISTS paused_surveillance_changes_guard ON tenant.renewal_clients__a;
CREATE TRIGGER paused_surveillance_changes_guard
BEFORE INSERT OR UPDATE ON tenant.renewal_clients__a
FOR EACH ROW EXECUTE FUNCTION public.guard_paused_surveillance_changes();

-- Block start_file_upload through its attachment insert, even for an admin.
-- Record protection above also blocks older in-flight uploads from advancing
-- the old chain when finalized. Unrelated attachment uploads are unchanged.
CREATE OR REPLACE FUNCTION public.guard_paused_surveillance_upload()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenant.objects o JOIN tenant.fields f ON f.object_id=o.id
    WHERE o.id=NEW.object_id AND f.id=NEW.field_id
      AND o.name='renewal_clients__a'
      AND regexp_replace(f.name,'__a$','') IN (
        'surv_suspension_intimation','surv_suspension_decision','surv_suspension_letter',
        'surv_withdrawal_intimation','surv_withdrawal_decision','surv_withdrawal_letter'
      )
  ) THEN
    RAISE EXCEPTION 'Suspension and withdrawal uploads are on hold pending business review.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_paused_surveillance_upload() FROM PUBLIC;
DROP TRIGGER IF EXISTS paused_surveillance_upload_guard ON tenant.attachments;
CREATE TRIGGER paused_surveillance_upload_guard BEFORE INSERT ON tenant.attachments
FOR EACH ROW EXECUTE FUNCTION public.guard_paused_surveillance_upload();
