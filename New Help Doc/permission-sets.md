# Permission Sets

Permission Sets control what each user can see and do in CraftCRM. By assigning one or more Permission Sets to a user, you can restrict access to specific apps, tabs, objects, and fields without changing their overall role.

---

## Code Architecture Overview

| Layer | File | Responsibility |
|---|---|---|
| UI — settings page | `app/commonfiles/core/components/settings/PermissionSets.tsx` | Create/edit/delete sets, configure per-resource rules via checkboxes |
| Frontend context | `app/commonfiles/core/providers/PermissionsProvider.tsx` | Loads effective permissions at login, exposes `can()` hook |
| Record view enforcement | `app/commonfiles/core/components/Application/RecordDetailView.tsx` | Passes `readOnly` and hides controls based on `can()` |
| File upload field | `app/commonfiles/core/components/Application/FileUploadField.tsx` | Respects `readOnly` / `disabled` props; renders upload/delete conditionally |
| DB schema | `app/commonfiles/core/types/database.ts` | Tables: `tenant.permission_sets`, `tenant.user_permission_sets`, `tenant.permission_set_entries` |
| DB migrations | `supabase/migrations/208_permission_set_entries.sql` | RPC definitions for CRUD on sets and entries |
| DB enforcement | `supabase/migrations/209_enforce_permissions_in_rpcs.sql` | Patches `get_object_records`, `get_tenant_fields`, `get_fields_metadata` to filter by permissions server-side |

---

## How Permission Sets Work

When a user has no Permission Sets assigned, they have full access (same as an admin). Once you assign even one set, CraftCRM enforces only what that set explicitly allows or denies.

If a user has multiple Permission Sets, their effective permissions are the **union** of all sets — access granted by any one set is honoured.

### `can()` function — `PermissionsProvider.tsx:56-90`

```
can(action, type, resourceId) → boolean
```

| State of `entries` | Result |
|---|---|
| `null` (not loaded yet) | `true` — optimistic, prevents flash of hidden content |
| `[]` (admin or no sets assigned) | `true` — full access |
| Entries exist, but none for this resource **type** | `true` — not restricted |
| Resource **type** has entries but this resource ID is not listed — type is `app` or `tab` | `false` — allowlist: must be explicitly checked |
| Resource **type** has entries but this resource ID is not listed — type is `object` or `field` | `true` — deny list: accessible unless explicitly denied |
| Resource ID found in entries | Returns the specific flag: `can_read`, `can_edit`, `can_create`, `can_delete` |

Permissions are loaded once at login via the RPC `get_my_effective_permissions`, which UNIONs all sets assigned to the user.

---

## Access Rules by Resource Type

| Resource | Logic | Unchecked means… |
|---|---|---|
| **Apps** | Allowlist | Hidden from the user |
| **Tabs** | Allowlist | Hidden from the user |
| **Objects** | Deny list | Accessible (no restriction) |
| **Fields** | Deny list | Accessible (no restriction) |

Apps and Tabs must be explicitly checked to be visible. Objects and Fields are accessible by default — you only configure them to restrict something.

### Where the allowlist check lives — `PermissionsProvider.tsx:79`
```ts
if (type === 'app' || type === 'tab') return false;
// Objects and fields not listed → allow by default
return true;
```

---

## Permission Flags

Each resource can have up to four flags:

| Flag | DB column | What it controls |
|---|---|---|
| **Read** | `can_read` | Can the user see this resource / view its data? |
| **Edit** | `can_edit` | Can the user modify data? |
| **Create** | `can_create` | Can the user create new records? (objects only) |
| **Delete** | `can_delete` | Can the user delete records? (objects only) |

Fields only support Read and Edit. In `PermissionSets.tsx:404-409`, Create and Delete columns for field rows render `—` (disabled, non-interactive).

---

## Managing Permission Sets

Navigate to **Settings → Permission Sets**.

### Creating a set

1. Click **+ New** in the left panel.
2. Enter a name (required) and an optional description.
3. Click **Save**.

Calls RPC: `create_permission_set(p_tenant_id, p_name, p_description)` — admin-only, defined in `208_permission_set_entries.sql`.

### Configuring rules

1. Select a set from the left panel.
2. Use the **Apps**, **Tabs**, or **Objects & Fields** tabs to find the resource.
3. Check or uncheck the permission flags. Changes save instantly.

Each checkbox toggle calls RPC: `upsert_permission_entry(p_perm_set_id, p_resource_type, p_resource_id, p_can_read, p_can_edit, p_can_create, p_can_delete)` — `PermissionSets.tsx:183`.

For objects, click **▶** to expand and see its fields. Fields are loaded lazily via `get_tenant_fields(p_object_id, p_tenant_id)` — `PermissionSets.tsx:133`.

### Editing or deleting a set

- Edit calls RPC: `update_permission_set(p_perm_set_id, p_name, p_description)`
- Delete calls RPC: `delete_permission_set(p_perm_set_id)` — cascades and removes all its rules

---

## Field-Level Permissions and File Upload Fields

### How `RecordDetailView.tsx` enforces field permissions

**Layout rendering path — line 1329 (inside page layout blocks):**
```tsx
<FileUploadField
  readOnly={!isEditing || !can('edit', 'field', field.id)}
  ...
/>
```
For non-file fields, line 1339 gates the editable input entirely:
```tsx
isEditing && can('edit', 'field', field.id)
  ? renderEditableField(field, fieldValue)
  : <div className="opacity-60 cursor-not-allowed">...</div>
```

**`renderEditableField()` path — line 1067:**
The file/files type is handled inside `renderEditableField` but **without `readOnly` or permission props**. This path is currently unreachable for file fields in the layout because line 1329 intercepts them first. It is a latent gap — if `renderEditableField` is called from a new location for file fields, permissions would not be enforced.

### `FileUploadField.tsx` — what props control behaviour

- `readOnly` or `disabled` → hides upload button and delete button; files remain visible and downloadable
- `canUpload` (line 228): `!readOnly && !disabled && !!recordId`
- Delete button (line 255): rendered only when `!readOnly && !disabled`
- `recordId === null` → upload blocked regardless of permissions; amber warning shown: *"Save the record first to enable file uploads."*

### Behaviour matrix

| Field permission state | What the user sees |
|---|---|
| **`can_read = false`** | Field hidden entirely — excluded server-side by `get_tenant_fields` (migration 209, line 189-198); data never reaches the client |
| **`can_read = true`, `can_edit = false`** | Field visible; existing files viewable and downloadable; upload button and delete button hidden |
| **`can_read = true`, `can_edit = true`**, not in edit mode | Upload and delete buttons hidden (`!isEditing` makes `readOnly=true`) |
| **`can_read = true`, `can_edit = true`**, in edit mode | Full access — upload, download, delete |
| Any state, `recordId = null` (new unsaved record) | Upload blocked; amber warning shown |

### Server-side enforcement — `209_enforce_permissions_in_rpcs.sql:189-198`

```sql
-- Exclude field if there is an explicit can_read=false entry for it
AND NOT EXISTS (
  SELECT 1 FROM tenant.permission_set_entries e
  WHERE e.resource_type = 'field'
    AND e.resource_id = f.id
    AND e.can_read = false
)
```

This runs inside `get_tenant_fields` and `get_fields_metadata`. The field is stripped from API responses before the client ever sees it.

---

## Common Scenarios

**Hide a tab from a group of users**
Add the tab to the Permission Set, leave **Visible** unchecked. Assign the set to the relevant users. The tab is filtered in `Header.tsx` and `Layout.tsx` via `can('read', 'tab', tab.id)`.

**Make a sensitive field read-only**
Expand the object in Objects & Fields, find the field, uncheck **Edit**, keep **Read** checked. `RecordDetailView.tsx:1339` will render the field as a static display value.

**Completely hide a field**
Uncheck **Read** on the field. The field is excluded from `get_tenant_fields` server-side and never rendered.

**Allow users to view records but not create or delete**
On the object row, check **Read** only, leave **Create** and **Delete** unchecked. The **New** and **Delete** buttons are gated via `can('create', 'object', objectId)` and `can('delete', 'object', objectId)` in `RecordDetailView.tsx:1619`.

---

## Notes for Admins and Developers

- Admins (`userProfile.role === 'admin'`) are never restricted. `get_my_effective_permissions` returns an empty array for admins, and `can()` returns `true` when `entries.length === 0`.
- Permissions are loaded once at login. If you change a user's sets, they need to refresh their browser (`reload()` in `PermissionsProvider.tsx:40` can also be called programmatically).
- The `can_read` flag on a field is enforced **server-side** in `get_tenant_fields` and `get_fields_metadata`. The data never reaches the client — it is not just a UI hide.
- The `_check_permission(resource_type, resource_id, action)` helper function in migration 209 is available for server-side permission checks inside other RPCs.
