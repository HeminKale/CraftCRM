# Created By / Updated By Fields

`created_by` and `updated_by` are system fields that track who created or last modified a record. They appear on every object as read-only fields in the System Fields section of the record detail view, and can be added as columns in any record list.

---

## Code Files

| File | Purpose |
|---|---|
| `app/commonfiles/core/hooks/useUserMap.ts` | Shared hook — loads all users once and exposes UUID → name resolution |
| `app/commonfiles/core/components/Application/RecordDetailView.tsx` | Uses `useUserMap` + `resolveUserValue` inside `formatFieldValue` to display names in the system fields section |
| `app/commonfiles/core/components/Application/TabContent.tsx` | Uses `useUserMap` + `resolveUserValue` in `renderRow` to display names in record list columns |
| `app/commonfiles/core/components/custom/External_Client/NewClientForm.tsx` | Sets `created_by: user?.id` and `updated_by: user?.id` in `recordData` before calling `create_object_record` |
| `app/commonfiles/core/components/custom/Renewal_Client/NewRenewalForm.tsx` | Delegates to `create_renewal_client` RPC which resolves and stores the name directly |
| `app/commonfiles/core/components/Application/RecordForm.tsx` | Standard new-record form — sets `created_by` and `updated_by` to `currentUser.id` before submission |

---

## Migrations

| Migration | What it does |
|---|---|
| `003_jwt_setup_dynamic_objects.sql` | Original definition — `created_by`/`updated_by` as UUID columns referencing `system.users` |
| `011_runtime_audit_triggers.sql` | Defines `current_user_full_name()`, `audit_set_on_insert()`, `audit_set_on_update()` — correct name-based trigger functions |
| `128_fix_created_by_updated_by_fields.sql` | Converted field metadata type from `reference` to `text` across all objects |
| `129_fix_enhanced_function_skip_user_fields.sql` | Excluded `created_by`/`updated_by` from reference resolution in query functions |
| `130_add_missing_insert_triggers.sql` | Defines `audit_set_on_insert_safe()` — safer INSERT trigger with full name resolution and error handling |
| `225_fix_renewal_client_created_by.sql` | Added `created_by`/`updated_by` population to `create_renewal_client` RPC |

---

## How Values Are Stored

There are two paths depending on which form creates the record:

### Standard forms (RecordForm, NewClientForm)
The frontend sends `user.id` (a UUID) in the record data. The value is stored as a UUID in the DB column.

```ts
// RecordForm.tsx:354, NewClientForm.tsx:142
created_by: user?.id,
updated_by: user?.id,
```

### Renewal form (NewRenewalForm → create_renewal_client RPC)
The RPC resolves the caller's name server-side and stores the display name as text directly.

```sql
-- 225_fix_renewal_client_created_by.sql
_caller_name := COALESCE(public.current_user_full_name(), _caller_id::text);
INSERT INTO tenant.renewal_clients__a (..., created_by, updated_by, ...)
VALUES (..., _caller_name, _caller_name, ...);
```

`current_user_full_name()` (defined in `011_runtime_audit_triggers.sql`):
```sql
SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)
FROM system.users u WHERE u.id = auth.uid();
```

This means the DB can contain either a UUID or a name string in these columns depending on which path created or last updated the record. `resolveUserValue()` handles both cases.

---

## How Values Are Displayed — `useUserMap` hook

**File:** `app/commonfiles/core/hooks/useUserMap.ts`

### `useUserMap()`

Loads all users from `system.users` once on component mount. Returns a `Record<string, string>` mapping each user's UUID to their display name.

```ts
const userMap = useUserMap();
// e.g. { "2c83010d-...": "Hemin Kale", "820f7d61-...": "Hero Hero" }
```

**Query used (line 14-17):**
```ts
supabase.schema('system').from('users').select('id, first_name, last_name, email')
```

Name resolution priority: `first_name + last_name` → `email` if both name parts are blank.

> **Important:** `supabase.schema('system')` must be called on the client directly — not chained after `.from()` or `.select()`. The incorrect form `.from(...).select(...).schema(...)` throws `TypeError: schema is not a function`.

### `resolveUserValue(value, userMap)`

Resolves a single field value for display:

```ts
resolveUserValue("2c83010d-84b4-...", userMap) // → "Hemin Kale"
resolveUserValue("Hemin Kale", userMap)         // → "Hemin Kale" (already a name)
resolveUserValue(null, userMap)                 // → "-"
resolveUserValue("unknown-uuid", userMap)       // → "unknown-uuid" (UUID not in map, shown as-is)
```

Logic:
1. Null / empty → return `"-"`
2. Matches UUID pattern → look up in `userMap`, fallback to raw UUID if not found
3. Anything else (already a name) → return as-is

---

## Where Resolution Is Applied

### Record detail view — `RecordDetailView.tsx`

Inside `formatFieldValue()`:
```ts
if (fieldName === 'created_by' || fieldName === 'updated_by') {
  return resolveUserValue(value, userMap);
}
```
Called for both the editable fields section (line 1346) and the System Fields section (line 1408). Both pass `field.name` so the check fires correctly.

### Record list — `TabContent.tsx`

Inside `renderRow()` before the value reaches `UniversalFieldDisplay`:
```ts
const fieldValue = (fieldName === 'created_by' || fieldName === 'updated_by')
  ? resolveUserValue(rawValue, userMap)
  : rawValue;
```
`UniversalFieldDisplay` has no special handling for these field names — it renders whatever string it receives. Resolution must happen before the value is passed.

---

## Data State in DB (Historical Records)

Because the storage format changed over time, existing records may contain different value formats:

| Records created via | `created_by` stored as | `updated_by` stored as |
|---|---|---|
| Standard form (RecordForm) | UUID | UUID |
| NewClientForm | UUID (after fix in `NewClientForm.tsx:142`) | UUID |
| NewClientForm (before fix) | `null` | UUID |
| NewRenewalForm | Display name text | Display name text |
| Any record updated after creation | — | UUID (set by `system.set_updated_at()` trigger) |

`resolveUserValue()` handles all these cases — UUID is looked up, name text is passed through, null becomes `"-"`.

---

## Adding `created_by` / `updated_by` to a Record List

These are standard fields — add them as display columns in the record list configuration the same way as any other field. Resolution to display names happens automatically in `TabContent.tsx` via the `useUserMap` hook.

---

## Known Limitations

- `useUserMap` loads all tenant users on every component mount — for large tenants this could be a performance concern. There is no caching between components; `RecordDetailView` and `TabContent` each fetch independently.
- If a user is deleted from `system.users`, their UUID will not resolve and the raw UUID will be shown instead.
- The `updated_by` trigger on most object tables (`system.set_updated_at()` in `002_helper_functions_triggers.sql`) stores the raw UUID via `auth.uid()` — it does not use `current_user_full_name()`. Resolution to a display name happens at read time via `useUserMap`, not at write time.
