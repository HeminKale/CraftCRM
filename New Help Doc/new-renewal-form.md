# New Renewal Form

The New Renewal form creates a Renewal Client record. Unlike the New Client form, it does not parse an Excel file for field values — instead it copies key fields from an existing External Client record. Both the client link and the file upload are optional.

---

## Code Files

| File | Purpose |
|---|---|
| `app/commonfiles/core/components/custom/Renewal_Client/NewRenewalForm.tsx` | Main form — client picker, file selection, form submission |
| `app/commonfiles/core/components/custom/Renewal_Client/RenewalWorkflowBar.tsx` | Workflow status bar shown on the Renewal Client record detail |
| `app/commonfiles/core/components/custom/Renewal_Client/RenewalActionPanel.tsx` | Action panel for renewal workflow steps on the record detail |
| `app/commonfiles/core/components/Application/RecordDetailView.tsx` | Renders the Renewal Client record, hosts the workflow bar and action panel |
| `app/commonfiles/core/components/Application/CustomTabRenderer.tsx` | Routes custom tab names (e.g. `NewRenewalForm`) to the correct component |
| `app/commonfiles/core/providers/SupabaseProvider.tsx` | Provides `tenant` used to resolve tenant ID in `NewRenewalForm` |

---

## Migrations

| Migration | What it does |
|---|---|
| `011_runtime_audit_triggers.sql` | Defines `current_user_full_name()` — used by the RPC to resolve caller name for `created_by` / `updated_by` |
| `015_file_upload_system.sql` | Creates `tenant.attachments` table and storage bucket setup |
| `016_file_upload_rpc_functions.sql` | Defines `start_file_upload`, `finalize_file_upload`, `delete_file`, `get_record_attachments`, `get_file_download_url` RPCs |
| `116_complete_case_sensitivity_fix.sql` | Case sensitivity fixes for column references on object tables including `external_clients__a` |
| `221_renewal_clients.sql` | Creates `tenant.renewal_clients__a` table, all its fields, layout, and the first version of `create_renewal_client` RPC |
| `222_fix_create_renewal_client.sql` | Fixes column name casing in the RPC (mixed-case columns like `Company_name__a` require double-quoting) — this is the active version |
| `223_fix_renewal_field_names.sql` | Fixes field name mismatches on `renewal_clients__a` |
| `225_fix_renewal_client_created_by.sql` | Adds `created_by` and `updated_by` population to `create_renewal_client` using `current_user_full_name()` |

---

## How It Works

### Step 1 — Client picker (optional)

On mount, `NewRenewalForm` calls `get_tenant_objects` to find the `external_clients__a` object, then `get_object_records` to load all external client records (`NewRenewalForm.tsx:44-71`).

The picker shows each client as `"Company Name (Contact Person)"`. If no client is selected, the renewal record is created without a linked client — all copied fields will be null.

### Step 2 — Surveillance Intimation Letter upload (optional)

The user can optionally upload a file before submitting. This is stored in the `surveillance_intimation_letter__a` field on the renewal record. If not uploaded here, it can be added from the record detail view later.

### Step 3 — Record creation (`NewRenewalForm.tsx:84-89`)

On submit, calls `create_renewal_client(p_external_client_id)` RPC (latest definition in `222_fix_create_renewal_client.sql`, `created_by` fix in `225_fix_renewal_client_created_by.sql`). All record-building logic is inside the RPC — the frontend only passes the selected client ID (or null).

**Inside the RPC (`222_fix_create_renewal_client.sql:39-82`):**

1. Resolves caller identity via `auth.uid()` → looks up `system.users` for `tenant_id` and `role`
2. **Access check** — caller must be `admin` OR have a custom role containing `'crm'` (case-insensitive). Denied otherwise
3. If a client ID was passed, copies these fields from `external_clients__a`:
   - `name`, `Company_name__a`, `contactPerson__a`, `email__a`, `ISOStandard__a`, `client_user_id__a`
4. Inserts into `tenant.renewal_clients__a` with:
   - Copied client fields
   - `created_by` / `updated_by` = caller's full name via `current_user_full_name()` (`225_fix_renewal_client_created_by.sql`)
   - `created_at` / `updated_at` = now()

### Step 4 — Surveillance letter file attachment (`NewRenewalForm.tsx:94-138`)

If a file was selected:
1. Fetches field metadata via `get_tenant_fields` to find the `surveillance_intimation_letter` or `surveillance_intimation_letter__a` field ID
2. Runs the three-step file upload process (RPCs from `016_file_upload_rpc_functions.sql`) — see **File Upload Field** doc
3. If the field is not found or upload fails — shows a warning toast but does **not** fail the record creation. The file can be uploaded from the record later.

---

## Key Difference vs New Client Form

| Aspect | New Client Form | New Renewal Form |
|---|---|---|
| Data source | Excel file parsed by frontend | Copied from existing External Client by RPC |
| File required | Yes (Excel is the data source) | No (file is optional, separate from record data) |
| Bulk creation | Yes (ZIP of multiple Excel files) | No — always creates one record |
| Record creation RPC | `create_object_record` (`095_create_record_creation_rpc.sql`) | `create_renewal_client` (`222_fix_create_renewal_client.sql`) |
| `created_by` source | Frontend sends `user.id` in `recordData` | RPC resolves via `current_user_full_name()` (`011_runtime_audit_triggers.sql`) |
| `created_by` format stored | UUID (resolved to name at display time) | Display name text (stored directly) |
| Access control | Object-level permission in `create_object_record` | Role check inside `create_renewal_client` (requires CRM role) |
| Initial status | `Application_Sent` (hardcoded in frontend) | Set by RPC defaults |

---

## What Gets Created

| Field | Value |
|---|---|
| `name` | Copied from external client, fallback `'New Renewal'` |
| `company_name__a` | Copied from `Company_name__a` on external client |
| `contact_person__a` | Copied from `contactPerson__a` on external client |
| `email__a` | Copied from `email__a` on external client |
| `iso_standards__a` | Copied from `ISOStandard__a` on external client |
| `external_client_id__a` | FK to the linked external client |
| `client_user_id__a` | Copied from `client_user_id__a` on external client |
| `created_by` | Caller's full name resolved by `current_user_full_name()` inside the RPC |
| `updated_by` | Same as `created_by` on creation |
| `surveillance_intimation_letter__a` | File attachment (if uploaded) |

---

## Known Constraints

- The form **cannot** be submitted without the CRM role — `create_renewal_client` returns an access denied error and the frontend shows it as a toast
- Creating a renewal without linking a client is allowed — all copied fields will be null, only `name = 'New Renewal'`
- The surveillance letter field is located by name (`surveillance_intimation_letter` or `surveillance_intimation_letter__a`) — if the field is renamed in Object Manager, the upload step silently skips
- `created_by` stores the display name as text (not UUID), because the RPC uses `current_user_full_name()` directly — unlike New Client which stores UUID and resolves at display time
