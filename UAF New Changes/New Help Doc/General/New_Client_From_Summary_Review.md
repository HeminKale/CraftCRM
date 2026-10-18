# New Client from Summary: current behaviour and fit

Reviewed 18 October 2026, before coding the bulk importer. This is an analysis of current local source and a read-only parser reproduction. No records were created, files uploaded to Supabase, database migrations applied or application code changed for this review.

## What the existing button does

`External_Client/ClientSummaryTab.tsx` shows **New Client from Summary** in the Summary list to an admin (`userProfile.role === 'admin'`). Clicking opens `NewClientFromSummaryForm.tsx`.

1. Accepts `.xlsx` or `.xls` and reads the first worksheet.
2. Uses `summarySheetMapping.ts` to parse a company-information header/data pair and a vertical milestone list.
3. Shows recognised fields and a proposed Initial workflow status before creation.
4. Infers the status from the furthest recognised milestone. Defaults to `Application_Sent` when none is recognised. Missing application date is replaced with the current UTC date by `new Date().toISOString().split('T')[0]`.
5. Calls `create_client_from_summary` with External Client fields, summary fields and the selected app's certification body. Migration 252 checks admin membership in the supplied tenant, generates a new ID and inserts an External Client. The insert trigger creates the linked Initial Summary; the RPC then upserts summary-specific values.
6. Uploads the workbook separately and appends its reference to the Initial Summary's Audit Pack. It does not attach actual application/audit/certificate documents to the External Client.
7. Refreshes the Summary list after success.

This represents importing historical Initial workflow data. The normal approval RPC chain is not executed for the asserted milestone dates/status. The button does not create Surveillance or Recertification records. It does not perform company/standard matching or update an existing client.

The user's live audit confirms that the creation RPC and summary-creation trigger exist. The audit returned a function fingerprint, rather than its full definition; the detailed execution above is established from local source, not a live creation test.

## Fit with the requested bulk use case

| Requirement | Existing behaviour | Gap |
| --- | --- | --- |
| Create client from summary data | Creates External Client plus Initial Summary | Useful existing relationship and field mapping |
| One populated spreadsheet row creates/updates one client | Reads one company data row | No loop across client rows |
| Update an existing client | Always generates a fresh ID and inserts | No matching or update branch |
| Company match ignoring whitespace | No match performed | Add normalisation and scoped candidate lookup |
| Compare standard numbers and integrated records | Stores standards as text | Add token/set comparison and conflict handling |
| Support existing Summary workflows | Initial only | Bulk routing needed for Surveillance 1 and Recertification |
| Preview before writes | Supported for one client | Extend to every row with target/action/differences |
| Safe retry | No request/idempotency key | A retry can create another client |

## Read-only reproduction against the supplied workbook

Input: `Renewal/sample bulk upload summary sheet.xlsx`, `Sheet1!A1:AO2`.

Ran the actual current `parseSummaryWorkbookRows` locally through the project's TypeScript transpiler and `xlsx` reader, with the same worksheet conversion options as the button. No test database writes or production calls were made.

Results:

- 20 metadata fields recognised.
- Zero date-kind fields recognised from the wide header row.
- Calculated status: `Application_Sent`.
- A synthetic second client data row was not processed as another client.
- Therefore, for this sample the UI would default the missing application date to today and would not import the milestone dates shown across the spreadsheet columns.

Reason: `WIDE_TABLE_MAPPINGS` deliberately covers metadata only. Milestone dates are expected in the vertical list. Adding dates as columns in the wide table does not activate those mappings.

A second small parser reproduction used `[['Company name','Acme'],['Scope','Engineering']]`. The current parser treated the first row as a wide header and read `Scope` as the company name. This confirms an additional format-detection defect for vertical-only input. It was observed, not fixed, during this analysis.

## Failure handling and validation findings

- The database creation finishes before the Storage upload and audit-pack append. Failure at a later step leaves the created client/summary in place while the UI reports `Create failed`. Retrying can create a duplicate.
- The creation RPC has no company/standard duplicate check or import retry key.
- In migration 252, if the summary upsert returns `success = false` rather than raising an exception, the wrapper returns failure after the External Client insert instead of explicitly rolling it back. SQL exceptions are a separate case and roll back the failed statement/transaction as normal.
- Unknown spreadsheet headings are silently omitted by this parser. Invalid/blank recognised values are skipped. The create button does not require a valid company name if some other value is valid; it can use the placeholder `New Client`.
- The RPC constructs its insert from supplied JSON keys. A bulk API should validate its allowed fields server-side rather than accept the same arbitrary field payload.

## Recommendation and implementation status

Retain the existing single-client button as a separate path. Reuse verified field mappings and the External Client-to-Summary relationship. A bulk tab needs a row parser, matching preview, explicit create/update choices, conflict checks, server validation, transactions and retry protection.

Company name plus standards is a proposed matching strategy, not a guarantee of identity: the supplied live audit already shows three company/body collision groups and clients with multiple Surveillance records. A change from `9001` to `14001` must not silently erase `9001`. Extending the existing client's standards is a proposed explicit choice; it is not yet an approved automatic rule.

At the time of this review, bulk upload was not built. Subsequent work implements a separate bulk flow in [Sprint 11](../Renewal/Sprints/Sprint_11_Bulk_Summary_Upload.md). The existing single-client button/parser defects above remain unchanged. The latest grouping/splitting rules supersede the earlier optional-extension proposal. Follow the [work log](Summary_Upload_Work_Log.md) for current status.
