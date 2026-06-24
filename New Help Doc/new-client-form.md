# New Client Form

The New Client form creates an External Client record by uploading a pre-formatted Excel application form. It supports single record creation (one Excel file) or bulk creation (multiple Excel files bundled in a ZIP).

---

## Code Files

| File | Purpose |
|---|---|
| `app/commonfiles/core/components/custom/External_Client/NewClientForm.tsx` | Main form — file parsing, record creation, file attachment upload |
| `app/commonfiles/core/components/custom/External_Client/ClientWorkflowBar.tsx` | Workflow status bar shown on the External Client record detail |
| `app/commonfiles/core/components/custom/External_Client/ReviewActionPanel.tsx` | Review actions panel on the External Client record detail |
| `app/commonfiles/core/components/custom/External_Client/ClientSummaryTab.tsx` | Summary tab rendered inside the External Client record |
| `app/commonfiles/core/components/custom/ClientSoftCopyGenerator.tsx` | Generates soft copy documents for a client |
| `app/commonfiles/core/components/custom/ClientDraftGenerator.tsx` | Draft generation for a client |
| `app/commonfiles/core/components/Application/RecordDetailView.tsx` | Renders the External Client record, hosts the workflow bar and action panel |
| `app/commonfiles/core/components/Application/CustomTabRenderer.tsx` | Routes custom tab names (e.g. `NewClientForm`) to the correct component |
| `app/commonfiles/core/providers/SupabaseProvider.tsx` | Provides `user` (auth user) used for `created_by` / `updated_by` |

---

## Migrations

| Migration | What it does |
|---|---|
| `003_jwt_setup_dynamic_objects.sql` | Initial `created_by` / `updated_by` columns as UUID references on object tables |
| `011_runtime_audit_triggers.sql` | Defines `current_user_full_name()`, `audit_set_on_insert()`, `audit_set_on_update()` — name-based audit triggers |
| `015_file_upload_system.sql` | Creates `tenant.attachments` table and storage bucket setup |
| `016_file_upload_rpc_functions.sql` | Defines `start_file_upload`, `finalize_file_upload`, `delete_file`, `get_record_attachments`, `get_file_download_url` RPCs |
| `095_create_record_creation_rpc.sql` | Defines `create_object_record` RPC — the generic record insert used by `NewClientForm` |
| `124_fix_created_by_updated_by_reference_metadata.sql` | Attempted fix for `created_by`/`updated_by` field metadata reference config |
| `128_fix_created_by_updated_by_fields.sql` | Converted `created_by`/`updated_by` field type from `reference` to `text` |
| `129_fix_enhanced_function_skip_user_fields.sql` | Updated query functions to skip `created_by`/`updated_by` during reference resolution |
| `130_add_missing_insert_triggers.sql` | Defines `audit_set_on_insert_safe()` — safer INSERT trigger with full error handling and name resolution |
| `211_file_upload_get_attachments.sql` | Updates/fixes `get_record_attachments` RPC |
| `213_external_client_review_rpcs.sql` | RPCs for review and approval actions on External Client records |
| `215_auto_set_client_user_id.sql` | Trigger that auto-sets `client_user_id__a` on External Client records |
| `216_quotation_upload_trigger.sql` | Trigger for quotation file upload on External Client |
| `217_fix_review_client_agreement.sql` | Fix for review client agreement RPC |
| `218_add_missing_external_client_columns.sql` | Adds missing columns to `external_clients__a` table |
| `218_fix_stage_audit_columns.sql` | Fixes audit column types on `external_clients__a` |
| `219_fix_file_field_type_mapping.sql` | Fixes `file`/`files` field type mapping in metadata |
| `220_client_summary_object.sql` | Creates the Client Summary object and its fields |
| `221_client_summary_list_rpc.sql` | RPC to list client summaries |
| `222_client_summary_audit_pack_rpc.sql` | RPC for client summary audit pack generation |

---

## How It Works

### Step 1 — File selection

The user uploads either:
- A single `.xlsx` / `.xls` file — one client record
- A `.zip` file containing multiple Excel files — one record per Excel file (bulk)

**Code path — `NewClientForm.tsx:80-127`:**
- Single Excel → `parseExcel()` called directly
- ZIP → `JSZip.loadAsync()` extracts all `.xlsx`/`.xls` entries, `parseExcel()` called for each

### Step 2 — Excel parsing (`NewClientForm.tsx:46-64`)

`parseExcel()` reads the first sheet of the Excel file. It expects rows in two-column format:

| Column A (label) | Column B (value) |
|---|---|
| Company Name | Acme Corp |
| Address | 123 Main St |
| ... | ... |

The label in column A is matched **case-insensitively** against a hardcoded map (`LABEL_TO_COLUMN`, line 11-26):

| Excel label | DB column |
|---|---|
| Company Name / Company | `Company_name__a` |
| Address | `Adddress__a` |
| Country | `country__a` |
| Scope | `scope__a` |
| ISO Standard / ISO | `ISOStandard__a` |
| Total No of Employees / Employees | `totalNumberOfEmployees__a` |
| Contact Person / Contact | `contactPerson__a` |
| Email | `email__a` |
| Employee | `employee__a` |

Any label not in this map is silently ignored. If `Company_name__a` is found, `name` is also set to the same value automatically (line 60).

### Step 3 — Record creation (`NewClientForm.tsx:136-186`)

On submit, the form:
1. Fetches all field metadata via `get_tenant_fields` to find the `application_Form` field ID
2. Calls `createRecord()` for each parsed entry

`createRecord()` builds `recordData` and calls `create_object_record` RPC (defined in `095_create_record_creation_rpc.sql`):

```ts
const recordData = {
  ...entry.fields,         // all parsed Excel columns
  Date__a:    date,        // today's date (auto-set, read-only in UI)
  status__a:  'Application_Sent',  // hardcoded initial status
  name:       entry.fields['name'] || entry.fields['Company_name__a'] || 'New Client',
  created_by: user?.id,   // logged-in user UUID
  updated_by: user?.id,
};
```

### Step 4 — Application form file attachment

After the record is created, the Excel file itself is attached to the `application_Form` field on the record using the three-step file upload process (RPCs defined in `016_file_upload_rpc_functions.sql`). See **File Upload Field** doc for full detail.

### Bulk mode

When a ZIP is uploaded with N Excel files:
- All N records are created sequentially
- Failures are counted individually — partial success is reported with a warning toast
- `toast.success('N clients created')` or `toast('X created, Y failed')` depending on result

---

## Access Control

The form component itself has no permission check — it is only rendered when the tab/button that hosts it is visible to the user. Role enforcement is inside `create_object_record` RPC (object-level `can_create` permission).

`created_by` is set from `user.id` (the Supabase auth user, from `SupabaseProvider.tsx`) — no role or profile dependency.

---

## What Gets Created

| Field | Value |
|---|---|
| `name` | Company name from Excel, fallback `'New Client'` |
| `Company_name__a` | From Excel |
| `status__a` | `Application_Sent` (hardcoded) |
| `Date__a` | Today's date |
| `created_by` | Logged-in user UUID (resolved to name at display time via `userMap` in `RecordDetailView.tsx`) |
| `updated_by` | Logged-in user UUID (resolved to name at display time) |
| `application_Form` | Excel file attached as file upload attachment |
| All other Excel columns | Mapped fields from `LABEL_TO_COLUMN` |

---

## Known Constraints

- Excel column mapping is hardcoded in `LABEL_TO_COLUMN` (`NewClientForm.tsx:11-26`) — adding a new Excel field requires a code change
- The `application_Form` field must exist on the object by that exact name — if not found, the file upload step is silently skipped
- Records are always created with `status__a = 'Application_Sent'` — there is no way to set a different initial status from this form
- Bulk upload processes records sequentially, not in parallel
