# Certification Body — App-Scoped Records

How a record "knows" which app (Americo / BQSR / AQSR / any future
certification body app) it was created under, and how each app's tabs are
made to show only their own records. Built first on the three client
objects (External Client, Surveillance 1, Recertification); designed to be
copy-pasted onto every future object.

---

## The underlying platform pieces (already existed, just newly relied on)

| Piece | File | Role |
|---|---|---|
| Apps table | `tenant.apps` | One row per certification body app (Americo, BQSR, AQSR, ...) |
| 9-dot launcher | `app/commonfiles/core/components/AppLauncher.tsx` | User picks an app; writes `{id, name}` to `localStorage['selected_app']` |
| Current-app hook | `app/commonfiles/core/hooks/useCurrentApp.ts` | `useCurrentApp().selectedApp` — every component's read access to "which app is active right now" |
| Tab↔App bridge | `tenant.app_tabs` (`UNIQUE(app_id, object_id)`) | The same object can have a separate tab per app — confirmed this is intentional, not incidental |
| Tab visibility | `app/commonfiles/core/components/Layout.tsx` | Already filters which tabs render by `appTab.app_id === selectedApp.id` — the record-level filtering below is the same idea one level down |

**Certification Body simply reuses `selectedApp`** — the exact value already driving which tabs a user sees — both to stamp new records and to filter list views.

---

## Design decisions (locked in, apply these to every future object)

1. **Value stored: plain text, copied at creation time** (e.g. `"Americo"`), not a UUID FK to `tenant.apps`. Matches how every other field on these tables works (`company_name__a`, `contact_person__a`, etc.) — no joins needed on read.
2. **Admin is scoped too** — Admin only sees the currently-selected app's records, same as Admin only sees that app's tabs already. No bypass.
3. **No auto-backfill** — pre-existing records get `certification_body__a = NULL` and simply won't appear once a list view starts filtering. Backfill is manual, per-record, at your own pace — not safely inferable after the fact.

---

## Why the column is deliberately NOT registered in `tenant.fields`

**`update_tenant_record` writes any column named in its JSONB payload with
zero field-level permission checking** — Permission Sets' `can_edit` is
enforced client-side only for that RPC (same gap migration 246 found and
worked around for `auditor_id__a`/`tech_reviewer_id__a`). If
`certification_body__a` were a normal registered field, any user with
generic edit access could open the record's Page Layout and hand-edit it,
silently defeating the whole filter.

So: **real physical column, never registered in `tenant.fields`.** It still
appears in every record's JSON automatically — `get_object_records_with_references`
builds its output from `information_schema.columns`, not from `tenant.fields`
— but no UI anywhere offers it as an editable field. Same treatment as
`created_by`/`updated_by`.

---

## Recipe: adding this to a new object

### 1. Schema
```sql
ALTER TABLE tenant.<your_object>__a
  ADD COLUMN IF NOT EXISTS certification_body__a TEXT;
```
Do **not** add a `tenant.fields` row for it.

### 2. Write path — pick whichever your object's creation flow uses

**(a) Object created through the generic `create_object_record` / `create_client_from_summary`-style RPC** (any RPC that accepts a flat `p_record_data`/`p_ext_data` JSONB and inserts whatever keys it's given — this is the common case for most objects):
No RPC change needed. In the frontend "New Record" form:
```tsx
import { useCurrentApp } from '<path-to>/hooks/useCurrentApp';
...
const { selectedApp } = useCurrentApp();
...
const recordData = {
  ...otherFields,
  certification_body__a: selectedApp?.name || '',
};
```

**(b) Object created through a bespoke RPC** (like `create_renewal_client` / `create_recertification_client` — a hand-written function with a fixed column list in its `INSERT`):
Add an additive `p_certification_body TEXT DEFAULT NULL` parameter, reproduce the function's current live body in full (find it via the highest-numbered `CREATE OR REPLACE FUNCTION` — don't assume the object's own last migration is current), add the one new column + value to the `INSERT`. Frontend passes `selectedApp?.name || null` as the new param.

### 3. Read path — the list-view filter

`get_object_records_with_references` (the function `TabContent.tsx` actually
calls for every object's list view — **not** `tenant.get_object_records`,
which is a different, older function with its own unrelated owner/role_peers
sharing filter) already got an additive `p_certification_body TEXT DEFAULT NULL`
param (migration 284). It:
- checks whether the target table actually has a `certification_body__a` column
- if the param is passed **and** the column exists, adds `WHERE certification_body__a = <value>`
- otherwise behaves exactly as before

So a brand-new object gets filtering **for free** the moment its list-view
call site passes `p_certification_body: selectedApp?.name || null` — no
further RPC change needed, ever, regardless of how many future objects
adopt this column.

---

## What's built (this pass)

| # | Migration | What |
|---|---|---|
| 282 | `282_certification_body_schema.sql` | Adds the column to `external_clients__a`, `renewal_clients__a`, `recertification_clients__a` |
| 283 | `283_certification_body_create_rpcs.sql` | Extends `create_renewal_client` and `create_recertification_client` (additive param) |
| 284 | `284_certification_body_list_filter.sql` | Extends `get_object_records_with_references` (tenant + public bridge) with the additive filter param |

**Frontend, write side:**
- `NewClientForm.tsx` (External Client direct create)
- `NewClientFromSummaryForm.tsx` (External Client admin-only "from Summary" create — a second, separate creation path, same generic-JSONB pattern)
- `NewRenewalForm.tsx`
- `NewRecertificationForm.tsx`

**Frontend, read side:**
- `TabContent.tsx` — both call sites that fetch an object's records (the main list-view fetch, and the bulk-button selected-records fetch)

`npx tsc --noEmit` clean after every step.

---

## Explicitly not covered by this pass — follow-ups if you want them filtered too

- **Summary-style secondary list views** (`SurveilanceSummaryTab.tsx`,
  `RecertificationSummaryTab.tsx` in their list mode) call
  `get_object_records_with_references` directly themselves, not through
  `TabContent.tsx`. They'll need `p_certification_body` added to their own
  call sites the same way, if you want them app-scoped too — not done here
  since it wasn't asked for and those files weren't otherwise touched this
  pass.
- **Single-record detail fetches** (`RecordDetailView.tsx` opening one known
  record by ID) were deliberately left unfiltered — if a user already has a
  direct link to a specific record, they should be able to open it
  regardless of which app is currently selected in the 9-dot switcher.
  App-scoping is a *list/browse*-time concept, not a record-access gate.

---

## Separate finding, not fixed — flagging for its own review

While reading `get_object_records_with_references` to add the filter
(migration 129's body, still current), noticed its generated SQL has **no
`tenant_id` WHERE clause at all** — neither the `tenant.` function (which
doesn't even take a `p_tenant_id` param) nor its `public` bridge (which
takes `p_tenant_id` but never uses it beyond passing through). The object
lookup itself (`SELECT o.name FROM tenant.objects WHERE o.id = p_object_id`)
also has no tenant filter. Whether this is actually exploitable depends on
whether Postgres RLS on the underlying `tenant.*` tables still applies
inside a `SECURITY DEFINER` function owned by a role with `BYPASSRLS` (a
Supabase-default-role question, not something I verified). This is a
pre-existing issue, unrelated to certification-body scoping, found only
because this migration touched the same function — flagging rather than
fixing, since a change to core tenant isolation deserves its own dedicated
review and testing pass, not a drive-by fix bundled into this feature.

---

## Manual steps still needed (yours)

1. **Apply migrations 282–284**, in order (after 281, the `created_by`/`updated_by` column fix).
2. Optionally backfill `certification_body__a` on existing records, per-object, at your own pace.
3. Decide whether to extend the Summary-tab list views and follow the same recipe above if so.
4. Consider a dedicated look at the tenant-isolation gap flagged above.
