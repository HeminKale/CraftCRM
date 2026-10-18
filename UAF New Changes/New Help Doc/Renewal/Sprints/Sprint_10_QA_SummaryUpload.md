# SummaryUpload QA fixes — 18 October 2026

Status: implemented on `SummaryUpload`; tested locally. Migrations 291–297
have NOT been applied to the live database and no VPS deployment was performed.
Apply them in numeric order before deploying this frontend. Existing migrations
through 290 are prerequisites; do not rerun all historical migrations blindly.

## Confirmed requirements

- A blank matrix cell means no view, edit, upload or acceptance for that row/role.
- Auditor/Tech Reviewer actions are restricted to the person assigned to the record.
- NCR RCA approval belongs to the assigned Auditor, with the existing admin override.
- Rejection behavior is unchanged and outside this QA pass.
- Following the subsequent stakeholder instruction, Surveillance ends at Certificate
  Issued. Suspension/withdrawal actions are paused pending business review. Historical
  values/files remain; the independent workflow is not implemented yet. See
  [the storage and bulk-import analysis](../../General/Client_Record_Storage_and_Bulk_Import.md)
  and [business questions](../../General/Business_Analyst_Questions.md).

## Client selection and creation

The Surveillance form now requires a client. Its picker has a search input and
`Create New Client` button above the independently scrolling results, so both
remain visible while browsing. Search matches company/contact labels and email,
case-insensitively. Client loading includes pages beyond the original first 100.

`Create New Client` opens the existing `NewClientForm` in single-client mode:
upload the same Excel/PDF application form, parse it with the existing mappings,
create an External Client, and attach its application form through the existing
upload RPCs. ZIP bulk creation remains available in the standalone New Client
flow, but is disabled in this single-client selection flow.

On success the created client is immediately selected, its email is filled in,
and the Surveillance form retains its selected intimation letter. Cancel returns
without creating a Surveillance record. This does not extract client details
from the intimation PDF; it reuses the normal New Client application workflow.

The creation RPC also requires the client link and uses the company name for
the new record's name, falling back to the source client's name. Existing
unlinked records are not automatically repaired or assigned to guessed clients.

## What Surveillance summary import does

### 1. Select and preview

CRM/admin can select an `.xlsx` or `.xls` file from a Surveillance record's Summary
tab. It reads only the FIRST worksheet and updates that selected record, not a
new record or a separate summary table.

It supports a wide metadata header row with values on the next row, followed by
vertical label/value rows. A standalone vertical list is also supported. Vertical
values use column B, falling back to C if B is empty. At least two known metadata
headers are needed to identify a wide table, preventing `Company Name | Acme`
from being mistaken for a header row.

Labels are trimmed, matched case-insensitively and normalized for repeated spaces.
Unrecognized labels are ignored. Blank cells preserve current values; importing
blank cells does not clear fields. Invalid checkpoint dates appear as skipped in
the preview and are not imported. ISO dates, day-first `DD/MM/YYYY` / `DD-MM-YYYY`,
and the existing textual date formats are supported. Impossible dates are rejected.

The preview reads the exact selected record's current status. Selecting a file
does not save anything. Apply is disabled until there is a recognized nonblank
value. The server rechecks authorization and current status on Apply.

### 2. Update recognized metadata

Nonblank recognized values overwrite those fields on this Surveillance record:

| Group | Recognized spreadsheet labels |
|---|---|
| Identity | Company name, standard, certificate no, country, address, scope, IAF code, no of empl |
| Audit details | Total mandays / surv mandays / surveillance 1 mandays, surv audit date |
| Team reference names | Auditor team, surv auditor, surv LA, surv Tech reviewer, surv CDC |
| Other reference data | Director name, application reviewer / application reviewer name / appl reviewr name, food category, SOA date |
| Findings text | Surv tech review findings |

The source of truth is `surveilanceSheetMapping.ts`. These reference-name fields
do NOT assign real users: importing an Auditor or Tech Reviewer's name does not
change `auditor_id__a` or `tech_reviewer_id__a`. Team assignment remains a separate
CRM/admin action. Original-certification labels such as `Auditor Stg 1`, `Auditor
Stg 2`, generic `Tech Reviewer` and generic `Lead Auditor` are not mapped to this
surveillance visit's team.

### 3. Import checkpoint dates and optionally advance status

| Spreadsheet checkpoint | Stored date | Implied status |
|---|---|---|
| Surveillance intimation letter | intimation_sent_date__a | Intimation_Sent |
| Acceptance by client / intimation acceptance | intimation_accepted_date__a | Intimation_Accepted |
| Assign team / team assigned | team_assigned_date__a | Team_Assigned |
| Surv audit plan | surv_plan_sent_date__a | Surv_Plan_Sent |
| Surv plan accept | surv_plan_accepted_date__a | Surv_Plan_Accepted |
| Surv NCR | surv_ncr_sent_date__a | Surv_NCR_Sent |
| Surv NCR RCA | surv_ncr_rca_uploaded_date__a | Surv_NCR_RCA_Uploaded |
| Surv NCR RCA acceptance | surv_auditor_accepted_date__a | Surv_Auditor_Accepted |
| Surv audit report | surv_report_sent_date__a | Surv_Report_Sent |
| Surv tech findings | surv_tech_findings_date__a | Surv_Tech_Findings_Given |
| Surv closed | surv_closed_date__a | Surv_Closed |
| CDC | cdc_date__a | CDC_Approved |
| Certificate issue | certificates_sent_date__a | Certificate_Issued |

The highest populated valid checkpoint can move the status FORWARD, never
backwards. This is an explicit historical-data import operation: it can fill
dates and advance past missing intermediate checkpoints without invoking the
individual acceptance RPCs. It is not evidence that the corresponding approval
or file upload happened inside the app. Normal interactive approvals remain
restricted to their assigned roles; CRM/admin importing historical data is a
separate, authorized operation.

The record is locked and its status reread inside the import transaction, so
an out-of-date preview cannot rewind a newer status. Suspension/withdrawal and
unknown future statuses are preserved. Existing legacy plan/completion statuses
are recognized conservatively. No suspension or withdrawal date is imported.

### 4. Store the original spreadsheet

The original spreadsheet is uploaded to private `tenant-uploads` storage and
appended to `surv_audit_pack__a` with its filename, bucket, path, size and timestamp.
Existing audit-pack entries are retained. The file extension remains `.xls` or
`.xlsx` as selected. Downloads use fresh signed URLs rather than stored public URLs.

Metadata, dates, status and the file's audit-pack entry commit in ONE database
transaction. Invalid fields, invalid dates or permission failures roll back all
those database changes. Storage bytes are uploaded before the transaction;
a definite database rejection attempts to remove the unused upload. On an
ambiguous network failure the bytes are retained, since the database might
already have committed. A retry can therefore create another spreadsheet entry.

### What it does not do

- It does not create a client, create another Surveillance record, or edit the
  linked External Client's original data.
- It does not parse PDFs/ZIPs or import multiple worksheets/records.
- It does not assign actual team users, send emails, execute review actions,
  upload certificate/NCR/plan/report documents from spreadsheet cells, or clear
  existing values from blank cells. Checklist-file cells are not file uploads.
- It does not validate that every earlier checkpoint exists or that all supplied
  dates are chronologically consistent; it is a historical import tool.

## Permission and workflow fixes

The dedicated RCA RPC already denied clients. The generic update API could
previously write approval status directly. Protected status changes now require
the workflow action or authorized import; a record trigger additionally guards
RCA approval and team assignment, including direct inserts/updates.

Client team identities/dates are removed from both record-read APIs and their
team checkpoint is hidden in the progress bars. Unassigned Auditors/Tech Reviewers
no longer see action buttons or access those workflow records. Upload initiation
also checks the actual assigned user.

Permission-map lookups now normalize the `__a` suffix. Email-linked clients are
recognized consistently by UI checks and upload finalization. Configured field
read denies remove raw values from API responses; edit denies are checked on the
server. Tenant and sharing filters are applied before pagination. Generic saves
cannot change identity/audit fields, workflow statuses, files or action-owned dates.

Client audit reports are withheld until Tech Review in record responses,
attachment lists and download checks. Restrictive authenticated Storage read, update and delete
policies prevent signing, overwriting or deleting a protected file through a
different API path. Finalization rechecks the current assignee, so an upload
started before a team reassignment cannot bypass the new assignment. Previously issued signed
URLs expire on their original schedule; this does not revoke already issued URLs.

Recertification summary import has the same atomic import, suffix normalization,
authorization and status-preservation safeguards, using its own metadata and
19-stage dictionaries. Its existing historical checklist-date mapping is retained.

## Migrations and verification

| Migration | Purpose |
|---|---|
| 291 | Surveillance atomic import, exact-record preview and compatible Summary Save RPC |
| 292 | Client naming, assigned-user upload/RCA/team guards and team visibility |
| 293 | Tenant/assignment/sharing read filtering and email-linked finalization |
| 294 | Field read/edit enforcement and protected generic updates |
| 295 | Equivalent atomic Recertification summary import |
| 296 | Attachment/download/Storage read/write/delete guards |
| 297 | Surveillance certificate is terminal; pause suspension/withdrawal changes and uploads |

Run `npm run test:surveillance`, `npm run type-check`, and `npm run build`.
Verification on 18 October 2026: 25 regression checks passed, TypeScript passed,
and a clean production build passed. The dev server was stopped during the build
to avoid concurrent writes to the same `.next` output.
The regression suite uses an isolated PGlite PostgreSQL instance and mocked React
flows. It never connects to the live database, sends real mail or uploads real
client files. Manual QA after applying the migrations should use disposable
records and real CRM, client, assigned/unassigned Auditor, Tech Reviewer and
admin logins. The existing PDF application parser still needs a representative
real-world PDF sample for document-specific parsing QA.
