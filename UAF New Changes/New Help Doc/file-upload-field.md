# File Upload Field

CraftCRM supports file attachments on any object through two dedicated field types. These fields are created in Object Manager and rendered using the `FileUploadField` component everywhere a record is displayed or edited.

---

## Code Architecture

| Layer | File | Responsibility |
|---|---|---|
| Field type definition | `app/commonfiles/core/components/settings/ObjectManagerTab.tsx:111-112` | Exposes `file` and `files` as selectable types when creating a field |
| Field creation RPC | `create_tenant_field` | Creates the field metadata row in `tenant.fields`; backend adds `__a` suffix |
| UI component | `app/commonfiles/core/components/Application/FileUploadField.tsx` | Renders the upload zone, file list, download, and delete |
| Attachment RPCs | `start_file_upload`, `finalize_file_upload`, `delete_file`, `get_record_attachments`, `get_file_download_url` | All file operations go through RPCs, not direct table access |
| Storage | Supabase Storage — bucket `tenant-uploads` | Physical file bytes |
| Attachment metadata | `tenant.attachments` table | Stores filename, mime type, byte size, storage path, uploader |
| Permission enforcement | `RecordDetailView.tsx:1336` | Passes `readOnly={!isEditing || !can('edit', 'field', field.id)}` to the component |

---

## Creating a File Upload Field (Object Manager)

1. Go to **Settings → Object Manager**
2. Select the object
3. Go to the **Fields** tab and click **Create Field**
4. Set the **Label** and **API Name**
5. For **Type**, choose:
   - **File Upload (Single)** — `type: 'file'` — only one file at a time; uploading a new file replaces the existing one
   - **File Upload (Multiple)** — `type: 'files'` — multiple files can be attached simultaneously
6. Set section, width, visibility as needed
7. Click **Create Field**

The RPC `create_tenant_field` is called with `p_type: 'file'` or `p_type: 'files'` (`ObjectManagerTab.tsx:567-584`). No `reference_table` or special options are needed — file fields have no extra configuration beyond the standard field properties.

---

## How File Upload Works at Runtime

Every upload goes through three steps (`FileUploadField.tsx:87-157`):

### Step 1 — `start_file_upload` RPC
Creates an attachment record in `tenant.attachments` with status pending, and returns:
- `attachment_id` — UUID of the new attachment row
- `storage_path` — the path where bytes should be uploaded in Supabase Storage
- `bucket` — the storage bucket name

### Step 2 — Storage upload
The file bytes are uploaded directly from the browser to Supabase Storage using the `storage_path` returned in step 1. Uses `upsert: true` so re-uploading the same path overwrites the file.

### Step 3 — `finalize_file_upload` RPC
Marks the attachment as complete, updates the record's column with the file metadata (filename, size, mime type). Only after this step does the file appear on the record.

**If step 2 or 3 fails**, the attachment record remains in a pending/incomplete state. The file will not appear on the record.

---

## How File Download Works (`FileUploadField.tsx:180-226`)

1. Calls `get_file_download_url` RPC — returns a signed URL valid for 300 seconds
2. Falls back to `supabase.storage.createSignedUrl()` directly if the RPC fails
3. Fetches the file as a blob and triggers a browser download
4. The downloaded filename is prefixed with the company name: `<CompanyName>_<original_filename>`

---

## How File Delete Works (`FileUploadField.tsx:159-178`)

1. Deletes the file bytes from Supabase Storage via `supabase.storage.remove()`
2. Calls `delete_file` RPC to soft-delete the attachment record

---

## Permission Behaviour

File upload fields respect field-level permissions set in Permission Sets:

| Permission state | What the user sees |
|---|---|
| `can_read = false` | Field not returned by server at all — does not appear on record |
| `can_read = true`, `can_edit = false` | Files visible and downloadable; upload and delete buttons hidden |
| `can_read = true`, `can_edit = true`, not in edit mode | Upload and delete buttons hidden |
| `can_read = true`, `can_edit = true`, in edit mode | Full access — upload, download, delete |
| `recordId = null` (new unsaved record) | Upload blocked regardless of permissions; amber warning shown |

The `readOnly` prop is set at `RecordDetailView.tsx:1336`:
```ts
readOnly={!isEditing || !can('edit', 'field', field.id)}
```

`canUpload` inside the component (`FileUploadField.tsx:228`):
```ts
const canUpload = !readOnly && !disabled && !!recordId;
```

---

## `file` vs `files` type

| | `file` (Single) | `files` (Multiple) |
|---|---|---|
| How many attachments | One at a time | Unlimited |
| Upload behaviour | New upload replaces old | Files accumulate |
| `multiple` prop passed | `false` | `true` |
| Use case | Application form, signed document | Supporting documents, evidence files |

Both types use the same `FileUploadField` component — the only difference is the `multiple` prop (`RecordDetailView.tsx:1074` and `1335`).

---

## File Upload in Custom Forms (New Client / New Renewal)

Custom forms that create records programmatically (not through the standard edit form) must implement the three-step upload themselves. Both `NewClientForm` and `NewRenewalForm` do this directly:

- **NewClientForm** (`NewClientForm.tsx:159-182`) — attaches the Excel application form to the `application_Form` field immediately after record creation
- **NewRenewalForm** (`NewRenewalForm.tsx:94-138`) — attaches the surveillance intimation letter to `surveillance_intimation_letter__a` after record creation; upload failure is non-fatal

In both cases, if the target field ID cannot be found via `get_tenant_fields`, the file upload step is silently skipped and the user is shown a warning toast.
