# Record Sharing Policy

Record Sharing Policy controls which records each user can read and edit within an object. Without a sharing policy, every user who has access to an object can see and edit every record in it. Once a policy is configured, CraftCRM enforces row-level filtering so users only see the records they are permitted to see.

Sharing Policy is independent of Permission Sets. Permission Sets control whether a user can access an object at all. Sharing Policy controls which rows inside that object the user can see once they are in.

---

## Migration History (run order matters)

| Migration | Status | What it does |
|---|---|---|
| `226_record_sharing_policy.sql` | **Required — run first** | Creates `object_sharing_policies` and `sharing_overrides` tables, `_resolve_sharing_mode()` helper, CRUD RPCs. Everything else depends on this. |
| `227_enforce_edit_mode_on_update.sql` | Superseded by 230 | First version of edit enforcement — used `created_by`. Overwritten by 230. Safe to have run it. |
| `228_backfill_created_by_to_uuid.sql` | **Skip** | Was going to backfill `created_by` name → UUID. Superseded by 229 which handles `record_owner__a` directly and is the correct approach. Do not run. |
| `229_record_owner_field.sql` | **Required — run second** | Adds `record_owner__a` column to all `__a` tables, seeds field metadata, updates insert trigger, backfills existing records. |
| `230_sharing_filter_on_record_owner.sql` | **Required — run third** | Replaces `tenant.get_object_records` and `update_tenant_record` to filter/check on `record_owner__a` instead of `created_by`. |

---

## Code Architecture

| Layer | File | Responsibility |
|---|---|---|
| Tables + RPCs | `supabase/migrations/226_record_sharing_policy.sql` | `object_sharing_policies`, `sharing_overrides` tables, RLS policies, `_resolve_sharing_mode()`, CRUD RPCs |
| Row read filtering | `tenant.get_object_records` (redefined in `230_sharing_filter_on_record_owner.sql:18`) | Applies `WHERE` clause on `record_owner__a` based on resolved mode |
| Write enforcement | `public.update_tenant_record` (redefined in `230_sharing_filter_on_record_owner.sql:148`) | Checks `record_owner__a` before allowing UPDATE |
| Mode resolution | `public._resolve_sharing_mode()` (`226_record_sharing_policy.sql:99`) | Resolves effective read/edit mode per caller — admin bypass, baseline fallback, override merging |
| Record Owner field | `supabase/migrations/229_record_owner_field.sql` | Column, metadata, trigger, backfill |
| Object Manager UI | `app/commonfiles/core/components/settings/ObjectSharingPanel.tsx` | Per-object baseline config inside Object Manager → Sharing tab |
| Settings UI | `app/commonfiles/core/components/settings/SharingOverrides.tsx` | Cross-object view with searchable object list + override table |
| Object Manager wiring | `app/commonfiles/core/components/settings/ObjectManagerTab.tsx` | Adds `sharing` tab to `objectDetailSections`, renders `ObjectSharingPanel` |
| Settings wiring | `app/commonfiles/core/components/settings/HomeTab.tsx` | Adds `sharing_overrides` to `homeSections`, renders `<SharingOverrides>` |
| Record detail display | `app/commonfiles/core/components/Application/RecordDetailView.tsx` | Renders `record_owner__a` as editable user picker in system fields section |
| UUID → name resolution | `app/commonfiles/core/hooks/useUserMap.ts` | `useUserMap()` hook + `resolveUserValue()` — used by RecordDetailView and TabContent |

---

## The `record_owner__a` Field

### Why it exists

Sharing policy needs a dedicated ownership field separate from `created_by`.

- `created_by` is an **audit field** — it records who first created the record and must never change. It stores the creator's display name as text.
- `record_owner__a` is the **ownership field** — it starts as the creator's UUID and can be reassigned to any other tenant user from the record UI.

Sharing filters always run against `record_owner__a`. `created_by` is never used for filtering.

### What it stores

A UUID string (e.g. `"2c83010d-84b4-4005-980c-5f05c8f07c09"`). The UI resolves this to a display name via `useUserMap()` — the same mechanism used for `created_by` and `updated_by`.

### How it is set

| When | What happens |
|---|---|
| New record created | Insert trigger (`audit_set_on_insert_safe`, updated in `229`) sets `record_owner__a = auth.uid()::text` |
| User saves a record in edit mode | User can change the owner by selecting any tenant user from the dropdown — saved via `update_tenant_record` |
| Existing records (backfill in `229`) | UUID copied from `created_by` if it was already a UUID; if `created_by` was a name, looked up in `system.users` by full name or email |

### How it displays in the UI (`RecordDetailView.tsx`)

`record_owner__a` appears in the **System Fields** section at the bottom of a record. Unlike the other system fields (`created_at`, `created_by` etc.) which are always read-only, `record_owner__a` is editable:

- **View mode** — shows the owner's name (UUID resolved by `resolveUserValue()` in `useUserMap.ts`)
- **Edit mode** — shows a dropdown of all users in the tenant (`Object.entries(userMap)` from `useUserMap()`). Select any user to reassign ownership.

---

## Database Tables

### `tenant.object_sharing_policies`
One row per object. Stores the baseline mode that applies to every user on that object.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | FK to `system.tenants` |
| `object_id` | UUID | FK to `tenant.objects` — UNIQUE (one policy per object) |
| `read_mode` | TEXT | `'all'` / `'owner'` / `'role_peers'` |
| `edit_mode` | TEXT | `'all'` / `'owner'` / `'role_peers'` |

If no row exists for an object, effective mode is `'all'` — no breaking change to existing behaviour.

### `tenant.sharing_overrides`
Zero or more rows per object. Each row targets a specific role or permission set and overrides the baseline for matching users.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | FK to `system.tenants` |
| `object_id` | UUID | FK to `tenant.objects` |
| `role_id` | UUID | FK to `tenant.roles` — NULL if targeting a permission set |
| `perm_set_id` | UUID | FK to `tenant.permission_sets` — NULL if targeting a role |
| `read_mode` | TEXT | Override read mode |
| `edit_mode` | TEXT | Override edit mode |
| `custom_formula` | TEXT | Reserved for Phase 3 — stored but not evaluated yet |
| `priority` | INTEGER | Higher number wins when multiple overrides match the same user |

A `CHECK` constraint (`one_target`) ensures exactly one of `role_id` or `perm_set_id` is set per row.

---

## Sharing Modes

| Mode | What it means |
|---|---|
| `all` | User sees / edits every record on this object |
| `owner` | User sees / edits only records where `record_owner__a` = their UUID |
| `role_peers` | User sees / edits records where `record_owner__a` belongs to any user with the same `custom_role_id` |

**Fallback for `role_peers`:** If the caller has no `custom_role_id` set in `system.users`, they fall back to `owner` behaviour (`230_sharing_filter_on_record_owner.sql:60`).

---

## How Mode Resolution Works — `_resolve_sharing_mode()`

`public._resolve_sharing_mode(p_object_id, p_tenant_id)` is called on every record fetch and every save. Returns `(effective_read_mode, effective_edit_mode)`.

**Resolution order (`226_record_sharing_policy.sql:99-183`):**

```
1. Caller is admin → return ('all', 'all') — admin bypasses everything
2. Look up baseline in tenant.object_sharing_policies
3. No baseline row → return ('all', 'all') — safe default, no policy = full access
4. Scan tenant.sharing_overrides for rows matching caller's role_id OR any perm_set_id
5. Track most permissive mode across all matching overrides:
     Mode rank:  all (3)  >  role_peers (2)  >  owner (1)
6. Return most permissive of (override, baseline) independently for read and edit
```

Overrides can only **expand** access, never restrict it beyond the baseline.

---

## How Filtering Is Enforced

### Read — `tenant.get_object_records` (`230_sharing_filter_on_record_owner.sql:18`)

Calls `_resolve_sharing_mode()` and injects a dynamic WHERE clause:

```sql
-- owner mode
AND t.record_owner__a = '<caller_uuid>'

-- role_peers mode
AND t.record_owner__a IN (
  SELECT su2.id::text FROM system.users su2
  WHERE su2.custom_role_id = '<caller_custom_role_id>'
)

-- all mode — no extra clause
```

Has a safe fallback: if `record_owner__a` column doesn't exist on a table (edge case), falls back to filtering on `created_by`.

### Write — `public.update_tenant_record` (`230_sharing_filter_on_record_owner.sql:148`)

Before running the UPDATE:
1. Resolves `effective_edit_mode` via `_resolve_sharing_mode()`
2. Fetches `record_owner__a` from the record being updated
3. For `owner` mode: blocks if `record_owner__a ≠ caller UUID`
4. For `role_peers` mode: blocks if the record owner doesn't share the caller's `custom_role_id`
5. For `all` mode: no check, proceeds normally

Error message on block: `"Access denied: you can only edit your own records"` or `"Access denied: you can only edit records within your role group"`.

---

## RPCs (all admin-only)

| RPC | Signature | What it does |
|---|---|---|
| `get_object_sharing_policy` | `(p_object_id UUID)` | Returns baseline `read_mode` / `edit_mode` for one object |
| `upsert_object_sharing_policy` | `(p_object_id, p_tenant_id, p_read_mode, p_edit_mode)` | Insert or update baseline policy |
| `get_sharing_overrides` | `(p_object_id UUID)` | Returns all overrides with resolved role / perm-set names |
| `upsert_sharing_override` | `(p_object_id, p_tenant_id, p_override_id, p_role_id, p_perm_set_id, p_read_mode, p_edit_mode, p_custom_formula, p_priority)` | Create (`p_override_id = NULL`) or update one override |
| `delete_sharing_override` | `(p_override_id UUID)` | Delete one override |

---

## UI — Where to Configure

### Option 1: Object Manager → Sharing tab
**Path:** Settings → Object Manager → select an object → Sharing tab

File: `app/commonfiles/core/components/settings/ObjectSharingPanel.tsx`

- Radio buttons for `read_mode` and `edit_mode` baseline with plain-English descriptions
- Info banner when no policy is saved yet (default = `all`)
- Amber note when `role_peers` is selected explaining the custom role dependency
- Admin-only save button

### Option 2: Settings → Sharing Overrides
**Path:** Settings → Sharing Overrides

File: `app/commonfiles/core/components/settings/SharingOverrides.tsx`

Two-panel layout:
- **Left panel** — searchable scrollable object list. Filters by label or API name. Selected object highlighted with blue left border.
- **Right panel** — baseline policy (read/edit dropdowns + save) and overrides table (target badge, mode badges, priority, formula indicator, edit/delete).

**+ Add override** modal lets you: choose Role or Permission Set → pick target → set read/edit modes → set priority → optionally fill the custom formula placeholder.

---

## Phase 3 — Custom Formula (Not Yet Active)

The `custom_formula` column exists on `tenant.sharing_overrides` and the UI shows a placeholder textarea (amber dashed panel). The value is saved to the DB but **not evaluated** — it has no effect on filtering today.

Intended syntax: `record.<field> = user.<field>`

Example: `record.country__a = user.country__a` — user can only see records where the country field matches their own.

Phase 3 will require a migration that parses this expression and injects it as an additional dynamic `WHERE` clause inside `tenant.get_object_records`.

---

## Interaction with Permission Sets

| System | Controls |
|---|---|
| Permission Sets | Whether the user can access the object at all |
| Sharing Policy | Which specific rows inside the object the user can see and edit |

Both checks stack. Permission Sets run first via `_check_permission('object', p_object_id, 'read')` in `public.get_object_records` (`209_enforce_permissions_in_rpcs.sql:99`). If that passes, sharing filtering is applied by `tenant.get_object_records`.

---

## Known Constraints

| Constraint | Detail |
|---|---|
| Delete not yet enforced | No working delete RPC exists yet (bulk delete in `TabContent.tsx` is a TODO stub). When it is built, it must call `_resolve_sharing_mode()` and check `record_owner__a`. |
| `role_peers` requires custom role assignment | Users with no `custom_role_id` in `system.users` fall back to `owner` mode. Assign roles in Settings → Users & Roles. |
| Custom formula stored but not evaluated | See Phase 3 above. |
| Existing records without `record_owner__a` | Migration 229 backfill covers all `__a` tables. Records where `created_by` was a name that doesn't match any `system.users` entry will have `record_owner__a = NULL` and will be invisible to non-admin users under `owner` / `role_peers` mode. Admin can manually set the owner from the record detail view. |
