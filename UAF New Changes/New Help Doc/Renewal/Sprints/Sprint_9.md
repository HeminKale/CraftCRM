# Surveillance 1 (Renewal) — Sprint 9: Client Access by Email + External Client Display Fix

**Status:** Built. `npx tsc --noEmit` clean. Migrations 286, 287, and 288 — **all three applied**.

Two independent fixes, both surfaced during live testing of the Sprint 0–8
chain (not planned sprint work):

1. The **External Client** field on a Surveillance 1 record showed a raw
   UUID instead of the company name.
2. Client access (Accept intimation, Accept plan, upload NCR RCA) was
   gated entirely on the linked External Client's own `client_user_id__a`
   — which silently breaks whenever CRM/Admin creates the External Client
   record without also setting that column by hand (see `[[project_uaf_surveillance_sprint8]]`-adjacent
   findings from the lifecycle audit). Client recognition is now also
   matched against the Surveillance 1 record's **own** Email field.

---

## 1. External Client raw-UUID display bug

**Root cause, two layers:**

- `external_client_id` was registered as `type = 'text'` back in
  `221_renewal_clients.sql`, even though the underlying column
  (`external_client_id__a`) is a UUID FK to `external_clients__a(id)`. Any
  non-`'reference'`-typed column is returned as-is by
  `get_object_records_with_references` — raw UUID, no resolution.
- Fixing the metadata alone (migration 286: flip `type` to `'reference'`,
  set `reference_table`/`reference_display_field`) **exposed a second,
  previously-latent frontend bug**: `get_object_records_with_references`
  stores a resolved reference field's display value under the field's
  **bare** name (no `__a`), but `RecordDetailView.tsx`'s field-metadata
  correction step (`correctedFieldData`) unconditionally appends `__a` to
  every non-system field's name. Its two value-lookup helpers
  (`findFieldValue` — main detail view; `getSmartFieldValue` — related-list
  tables) only ever tried the exact name or a name **with** `__a` added —
  never stripped one off — so a reference field's resolved value fell
  through to `undefined` and the field rendered blank/raw instead of the
  label. Nothing exercised this path before, because the only other live
  tenant-table reference field (`account_id` → `Account` on the demo
  Contact object) was never actually used in a real workflow.

**Fix:**

| # | File | What it does |
|---|---|---|
| 286 | `286_fix_renewal_external_client_reference_display.sql` | Metadata-only: flips `external_client_id`'s `type` to `'reference'`, sets `reference_table = 'external_clients__a'`, `reference_display_field = 'Company_name__a'` |
| — | `RecordDetailView.tsx` (`findFieldValue`, `getSmartFieldValue`) | Both helpers now fall back to stripping a trailing `__a` and checking the bare key when every other lookup variant misses — additive, only fires when the suffixed lookup already failed |

This second fix is general — it un-blocks **any** field converted to
`type = 'reference'` going forward, not just this one.

---

## 2. Client recognition by Surveillance 1's own Email

**Problem traced during live lifecycle testing:** Accept/upload buttons
depend on `renewal_clients__a.client_user_id__a`, which is only ever
copied from the **selected External Client's own** `client_user_id__a` at
record-creation time (`256_renewal_email_and_notification.sql`). That
column on `external_clients__a` is only auto-set by a trigger
(`215_auto_set_client_user_id.sql`) when the External Client record was
inserted by a user who themselves holds the External Client role
(self-signup). When CRM/Admin creates the External Client record on the
client's behalf — the normal case — it has to be set by hand and is easy
to miss, silently breaking Accept for that client with no visible error.

**Decision (this turn):** rather than chase the upstream linkage every
time, let a client also be recognized directly against the **Surveillance
1 record's own `email__a` field** — the email actually typed on that
Surveillance 1 record, independent of the External Client record. In
practice both emails are expected to match the same person, so this is
purely additive: a superset of who's allowed in, never narrower. Scoped
to Surveillance 1 only per this turn's instruction — Recertification /
External Client keep the client_user_id__a-only check for now.

**Migration 287** (`287_surv_client_access_by_email.sql`) reproduces the
full live body of each affected RPC verbatim, adding one OR-condition —
case-insensitive match between the caller's `system.users.email` and the
record's `email__a` — to the existing `client_user_id__a` check:

| RPC | Live body reproduced from | What changed |
|---|---|---|
| `review_surveillance_intimation` | 221 | Accept/reject intimation |
| `review_surv_plan` | 257 | Accept/reject audit plan |
| `start_file_upload` (surv_ncr_rca block only) | 278 | Client's NCR RCA upload |

**Frontend** (`RenewalActionPanel.tsx`): added `currentUserEmail` prop,
threaded through from `RecordDetailView.tsx` (`user?.email`). `isClientOnly`
and `isLinkedClient` now also true when
`lower(recordData['email__a']) === lower(currentUserEmail)`, mirroring the
RPC-side change so the Accept/upload buttons actually appear for a client
recognized this way — server-side gates alone would leave the UI hidden
even though the RPC would allow the call.

---

## 3. Migration 288 — the read-side gap the write-side fix exposed

Migrations 213/237/248/264/278/etc. already gate every **write** action
(accept/reject/upload) on "only the linked client may act on their own
record" — but nothing gated **reads**. `get_object_records_with_references`
(the single function both `TabContent.tsx`'s list view and
`RecordDetailView.tsx`'s detail view call for `external_clients__a`,
`renewal_clients__a`, and `recertification_clients__a`) had no filter tied
to the caller's identity at all — a logged-in External Client could browse
every client's record in the tenant, not just their own.

**288** (`288_client_scoped_record_list_read.sql`) closes this, reusing the
exact dual-check 287 introduced (`client_user_id__a = auth.uid()` OR
`lower(email__a) = lower(caller's email)`), applied this time to the
**read** path and extended to all three client objects for consistency —
not just Surveillance 1. A record only fails to appear for a caller whose
own custom role is External Client; Admin, CRM Office, Auditor, Tech
Reviewer, and CDC are completely untouched by this WHERE fragment,
regardless of what's in any record's `email__a`.

**Important distinction from the Sprint 9 §2 gotcha:** 288's scoping keys
off the *caller's own role* (only restricts someone logged in as External
Client) — it will never cause a CRM/Admin login to lose visibility of
records, even if that CRM user's own email happens to match a record's
`email__a`. The §2 gotcha (a CRM login flipping into "client" treatment in
the Action Panel) is a separate, frontend-only effect of 287's identity
check and is unaffected by 288.

---

## What this does NOT change

- Recertification and External Client's own **write-side** client-review
  RPCs (accept/reject) are untouched — still `client_user_id__a`-only. 288
  only changed the shared **read** function, which does apply the
  dual-check to all three objects.
- The upstream linkage gap itself (External Client records created without
  `client_user_id__a`) still exists and isn't repaired by any of this —
  Sprint 9 works around it for reads and for Surveillance 1's client-facing
  writes, it doesn't fix the data.
- No warning was added on the creation form for a missing
  `client_user_id__a` (previously discussed, not requested this turn).
