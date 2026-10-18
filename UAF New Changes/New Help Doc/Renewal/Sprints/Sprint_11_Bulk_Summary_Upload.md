# Sprint 11: admin bulk Summary uploads

Date: 18 October 2026. Status: completed locally and awaiting manual Supabase application/QA. No live deployment or SQL application was performed. Stop here until the user authorises the next sprint.

## Confirmed scope

- Add **Bulk Summary Upload**, **Bulk Surv 1 Summary Upload** and **Bulk Recert Summary Upload** to the respective existing Summary list tabs. Admin only in UI and database. Existing single-record uploads remain available.
- Source format: `UAF New Changes/SUmmary Bulk/sample bulk upload summary sheet.xlsx` and the adjacent extensionless reference. Header row followed by any number of client rows. The actual uploaded workbook supplies the values; do not substitute the text reference's different dates.
- Following the user's latest clarification, one row is split automatically: 9001/14001/45001 stay together in one record, and every other standard gets its own separate record. No Client ID column is required.
- Match company names case-insensitively with whitespace removed, within the caller's tenant and selected certification body. Compare complete standard numbers, excluding revision years. Store the merged ordinary set in canonical form such as `ISO 9001, ISO 14001`.
- Only 9001, 14001 and 45001 can be merged. Recognise aliases `9`, `14`, `45` and full forms such as `ISO9001:2015`, `9001, ISO 14001` or `9, 14, 45001`. Ignore revision years for identity. Append missing integrated standards and update other nonblank mapped fields. Do not erase pre-existing standards or replace populated values with blanks.
- Every other standard is isolated, not just 27001. Neither an incoming isolated standard nor an existing record containing non-integrated standards is an integrated merge target. Re-uploading the identical completed record part is idempotent. A genuinely different file/row containing an isolated standard creates a separate record under the user's rule.
- Multiple otherwise eligible records require explicit target selection in preview. Never silently choose a new audit cycle from its position/date. Surveillance/Recertification keep a real link to an External Client; creating a missing identity must not fabricate Initial approvals.

## Existing implementation reused

| Workflow | Mapping source | Existing API | Bulk treatment |
| --- | --- | --- | --- |
| Initial | `External_Client/summarySheetMapping.ts` | `create_client_from_summary`, `upsert_client_summary` | Reuse physical column names and summary mirrors. Add transactional validated bulk entry point instead of looping generic create/update. |
| Surveillance 1 | `Renewal_Client/surveilanceSheetMapping.ts` | Local `import_renewal_summary` (291), compatibility `upsert_renewal_from_summary` | Reuse atomic field/date/status importer inside each bulk row transaction. |
| Recertification | `Recertification_Client/recertSheetMapping.ts` | Local `import_recert_summary` (295), compatibility `upsert_recert_from_summary` | Same, with Recertification's own mapping/status order. |

The wide-only bulk parser must not call the existing single-record parser once per workbook. It must use date mappings across columns as well as metadata. Surface unsupported headings, formula-cache problems, conflicting aliases, invalid dates and duplicate rows before writing. Ambiguous `Recert ...` headings in a Type `Initial` row must not silently become Initial Stage 2 fields. Permit explicit column mapping or explicit exclusion in preview.

## Delivery sequence

1. Document requirements, existing API names, mapping coverage and matching examples.
2. Add pure row parsing/standard normalisation and matching helpers; verify against the supplied workbook.
3. Add admin-only server preview and transactional create/update, version checks and durable retry results. Keep the original bulk workbook admin-only; a multi-client workbook must not be attached to a client-visible individual audit pack.
4. Add the three buttons and a shared preview/apply UI. Show proposed action, target, merged standards, fields, ignored columns and row errors. Re-read conflicts on the server. Report partial failures honestly and retry completed rows without duplication.
5. Run parser/SQL/UI regression checks, TypeScript and production build. Update the work log and deployment prerequisites.

## Matching examples

| Existing | Incoming | Expected |
| --- | --- | --- |
| Acme / 14001 | A c m e / 9001 + 14001 | Same ordinary target; `ISO 9001, ISO 14001`; update other supplied fields |
| Acme / 9, 14 | Acme / 45001 | Same integrated target; `ISO 9001, ISO 14001, ISO 45001` |
| Acme / 9001 | Acme / 27001 | Separate record containing 27001 |
| Acme / 27001 only | Acme / 9001 | Separate ordinary record; do not modify the 27001 record |
| Acme / 27001 | Acme / 27001 | Separate import record per the user's rule; identical completed row retry is idempotent |
| Acme / 9001 | Acme / 9001 + 27001 + 22000 | Update the integrated record; create separate 27001 and 22000 records |
| Two ordinary Acme records | Acme / 9001 | Preview requires selection; no blind merge |
| Acme in another tenant/body | Acme | Not a matching target |

## Remaining business decisions

No separate Surveillance 2 implementation is added. A future cycle discriminator/backfill remains separate work. Conflicting date labels and historical approval assertions remain visible in the preview and question register. Suspension/email automation belongs to Sprints 12 and 13, not this bulk writer.

## Implemented locally

- Added shared `BulkSummaryUpload.tsx` modal and `bulkSummaryMapping.ts` parser, used by all three existing Summary list tabs. The outer component renders no button for a non-admin; the two public bulk RPCs independently enforce admin role and tenant/app ownership.
- Mapping dictionaries are reused for physical API names, kinds, summary mirrors and stage ordering. The generated server allowlist is parity-checked against those dictionaries. Legacy single-record parsers/uploads are unchanged by this sprint.
- Added migration `298_admin_bulk_summary.sql` after existing local 291–297. It stores retry/audit results in private `tenant.bulk_summary_import_results`. Private helpers validate data, match records, merge standards and update Initial summaries atomically. Existing atomic Surveillance/Recertification import RPCs are used inside each row transaction.
- The UI validates Type against the current button's workflow, dates, conflicting aliases, repeated company/group rows and formula-cache errors. It supports worksheet selection and explicit column remapping. Populated excluded columns require acknowledgement; ambiguous Recert-labelled dates are not silently assigned to Initial Stage 2.
- The preview shows each resulting standard group, create/update target, linked original client, current/proposed values and errors. Multiple eligible candidates or a legacy blank certification body need an explicit selection. Each selected part commits separately; failed/unselected parts are reported without claiming total success.
- The supplied source workbook is stored once by SHA-256 file identity in the private `tenant-uploads` bucket. A restrictive Storage policy reserves bulk sources for tenant admins. The complete multi-client workbook is not attached to a client-visible record pack.
- Storage upload precedes the row transactions. If all selected parts fail, the private source can remain for retry; it is not automatically deleted after an uncertain outcome. No automatic cleanup/retention job is included in this sprint.
- Idempotency key: tenant + app + workflow + file hash + worksheet + Excel row number + standard group. Same completed part returns the previous result; changed mappings for that completed part require a corrected workbook. Source bytes are hashed in the browser; the SQL verifies the source path/object, not the workbook's binary contents.
- Updates recheck fingerprints and locks. A per-company/body advisory lock serialises competing bulk requests. Conflicting changes or newly found matches cause an error and require refreshed preview.
- For new Surveillance/Recertification records, create/link a real original client identity. It has no fabricated Initial application date/status or approvals. Existing original-client and Initial Summary standards are extended together; other audit metadata updates stay on that selected audit record.
- Certificate numbers are paired to standard numbers in the original listed order, then reordered together into canonical standard order, including integrated-only rows. If populated certificate counts cannot be paired when splitting, the row is blocked for correction. Other supplied metadata/dates are copied to each resulting part for review.
- Limits: 10 MB workbook, at most 150 columns starting at A1, and 500 resulting record parts. Identical/repeated company+group rows must be combined to avoid conflicting within-batch updates. Different cycles with the same name still require manual target selection.

## Validation and release state

Re-verification: `npm run test:bulk-summary` passed 11 checks; `npm run test:surveillance` passed 29 checks (40 total), including full modal upload/preview/apply checks. These are isolated database/parser tests and mocked component checks, not live Supabase/browser acceptance tests. Production build and documentation checks are recorded in the work log.

## Re-verification corrections, 18 October 2026

- Fixed certificate ordering so reverse-listed standards retain their correct certificate after normalisation and splitting.
- Source upload retries now download and hash the stored workbook after an upload error. Only identical bytes allow record application; different or unreadable sources block it. A missing positive RPC success result is also treated as failure.
- Applied the restrictive bulk-source Storage policy to both anonymous and authenticated roles, so a permissive legacy anonymous policy cannot expose these workbooks. The granted policy helper returns only an access boolean; private import helpers remain revoked.
- Matching now falls back to the record name if the company field contains only whitespace.
- New Surveillance/Recertification records inherit contact/email from their linked original client when the spreadsheet leaves these blank. Explicit spreadsheet values override the new audit copy. New original identities also retain supplied address, country, scope, employee count and IAF code, with the applicable Initial Summary mirrors.
- Added regression coverage for these cases and for rerunning the complete updated migration 298 after imports. The replay test preserves existing records/results and returns an already-completed part without creating duplicates.
- These changes amend **298**, with no migration 299. If an earlier copy of 298 was already applied, run the complete updated 298; this replaces functions/policy without deleting import results. It does not retrospectively repair data imported with an older version.

Sprint 12 and Sprint 13 remain unstarted, pending the user's explicit go-ahead.

This is local implementation; no SQL has been applied to Supabase, no customer mail has been sent and no VPS build has been deployed. Use the [manual migration handoff](../../General/Manual_Migrations_291_298.md). Sprint 12 email work and Sprint 13 suspension implementation are planned only. The user requires a go-ahead before each next sprint.
