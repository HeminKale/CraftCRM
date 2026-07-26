-- ================================
-- Migration 240: clientAgreement__c is a single file, not multiple
--
-- Discovered live (2026-07-25) while debugging why a signed agreement PDF
-- disappeared from the record's file list: tenant.fields registered
-- clientAgreement__c as type 'files' (plural/multiple), not 'file'. Nothing
-- about the actual workflow wants history — CRM uploads one agreement, the
-- client signs it, done. Every piece of code that touches this field
-- (ReviewActionPanel.tsx's `entry = parsed[0]`, the "replace" language used
-- when the signing fix shipped) assumed single-file semantics that the field
-- metadata never actually had.
--
-- Consequences of the 'files' mistype, both real bugs:
--   1. finalize_file_upload's 'files' branch always APPENDS
--      (`COALESCE(col,'[]') || new`) — every re-upload piled onto the array
--      instead of replacing it. A record could accumulate any number of old
--      agreement files with no way to tell which one is "current".
--   2. delete_file's 'files' branch does `COALESCE(col,'[]') - attachment_id`
--      to remove an entry — but the jsonb `-` operator only removes a
--      top-level array element that is itself a plain string equal to the
--      operand. Our array holds JSON *objects*, so this match never fires:
--      "deleting" a file soft-deletes its tenant.attachments row (hiding it
--      from get_record_attachments / the file list) but never actually
--      removes it from the column's array. Deleted entries silently persist
--      forever. (This half of the bug isn't specific to clientAgreement__c —
--      it affects any 'files'-type field, e.g. stage2_evidences — but this
--      migration only touches clientAgreement__c; the general delete_file
--      bug is left as a known follow-up.)
--
-- Part A converts the field's registered type. Part B cleans up every
-- existing record: for any clientAgreement__c__a currently holding an array,
-- collapse it down to whichever entry still has a live (non-deleted)
-- tenant.attachments row, picking the most recently uploaded if more than
-- one qualifies (shouldn't happen post-fix, but existing data predates it).
-- Records with no still-live entry get NULL, matching the empty state of a
-- normal unattached 'file' field. No tenant.attachments rows are touched —
-- already-deleted rows stay deleted, already-live rows stay live.
-- ================================

-- ── Part A: field type ──────────────────────────────────────────────
UPDATE tenant.fields f
SET type = 'file'
FROM tenant.objects o
WHERE f.object_id = o.id
  AND o.name = 'external_clients__a'
  AND f.name = 'clientAgreement__c'
  AND f.type = 'files';

-- ── Part B: collapse existing arrays to their single live entry ────
UPDATE tenant.external_clients__a ec
SET "clientAgreement__c__a" = sub.new_value,
    updated_at = NOW()
FROM (
  SELECT
    ec2.id AS record_id,
    (
      SELECT elem
      FROM jsonb_array_elements(ec2."clientAgreement__c__a") AS elem
      JOIN tenant.attachments a
        ON a.id = (elem->>'id')::uuid
       AND a.deleted_at IS NULL
      ORDER BY (elem->>'uploaded_at')::timestamptz DESC NULLS LAST
      LIMIT 1
    ) AS new_value
  FROM tenant.external_clients__a ec2
  WHERE jsonb_typeof(ec2."clientAgreement__c__a") = 'array'
) sub
WHERE ec.id = sub.record_id;
