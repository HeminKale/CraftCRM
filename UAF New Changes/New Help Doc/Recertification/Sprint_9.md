# Recertification — Sprint 9: Client Access by Email + External Client Display Fix

**Status:** Built. `npx tsc --noEmit` clean. Migration 289 written — **not yet applied**.

Not planned sprint work — a direct port of the three fixes shipped for
Surveillance 1's own Sprint 9 (`Renewal/Sprints/Sprint_9.md`), after
confirming by direct code inspection that Recertification has the exact
same three root causes, being built on the same shared functions
(`create_*_client`, `start_file_upload`) and the same panel pattern
(`RecertificationActionPanel.tsx` mirrors `RenewalActionPanel.tsx`
throughout).

The underlying rights matrix (PS/RPC layer) was **not re-audited** here —
it's already independently verified (`rights-matrix-verification.md`,
18/18 rows, one bug found and fixed via migration 285). Sprint 9 is
orthogonal to that: it's about client *identification* and *display*, not
about which role can do what.

---

## 1. External Client raw-UUID display bug — same as Surveillance 1

`recertification_clients__a`'s `external_client_id` field was registered
`type = 'text'` in `264_recertification_table_and_intimation.sql` (line
84) — identical to `renewal_clients__a`'s bug fixed in migration 286. Any
non-`'reference'`-typed column is returned as-is by
`get_object_records_with_references`, so the field showed a raw UUID
instead of the company name.

**Fix (migration 289, part 0):** metadata-only — flips `type` to
`'reference'`, sets `reference_table = 'external_clients__a'`,
`reference_display_field = 'Company_name__a'`. No frontend change needed:
the generic bare-key-fallback fix already shipped in `RecordDetailView.tsx`
(`findFieldValue` / `getSmartFieldValue`, written while fixing this same
bug for Surveillance 1) applies to any object, not just Renewal — it
already picks this field up correctly once the metadata is in place.

---

## 2. Client recognition by Recertification's own Email

**Same fragility as Surveillance 1:** `create_recertification_client`
(migration 283, live body) copies `client_user_id__a` from the *selected*
External Client's own `client_user_id__a` at creation time — a column only
auto-set by a trigger (215) when the External Client record was inserted
by a self-signing-up client. When CRM/Admin creates the External Client
record on the client's behalf (the normal case), it has to be set by hand
and is easy to miss — silently breaking every client-facing action on the
record with no visible error.

**Fix (migration 289, parts 1–3):** the exact dual-check migration 287
introduced for Surveillance 1 — `client_user_id__a = auth.uid()` **OR**
case-insensitive `email__a` match — applied to Recertification's
client-facing write paths:

| RPC / gate | Live body reproduced from | Client action |
|---|---|---|
| `review_recert_agreement` | 265 | Accept & sign the client agreement |
| `review_recert_plan` | 266 | Accept/reject the recertification audit plan |
| `start_file_upload` — `recert_application_form` block | 287 (full body) | Client submits their own application |
| `start_file_upload` — `recert_ncr_rca` / `recert_evidences` block | 287 (full body) | Client uploads NCR root-cause response / evidences |

Not touched, deliberately: `review_recert_application` (CRM accepts the
client's application — not a client action) and `review_recert_ncr_rca` /
`review_recert_evidences` (Auditor accepts these — not a client action per
the rights matrix, rows 13–14).

**Frontend** (`RecertificationActionPanel.tsx`): added `currentUserEmail`
prop, threaded through from `RecordDetailView.tsx` (`user?.email`) —
mirrors `RenewalActionPanel.tsx` exactly. `isClientOnly` and
`isLinkedClient` now also true when
`lower(recordData['email__a']) === lower(currentUserEmail)`.

**Same gotcha as Surveillance 1 Sprint 9 applies here too:** the match is
on email string alone, no role check. If a CRM/Auditor/etc. login's own
email happens to be typed into a Recertification record's Email field
(e.g. for testing), that login will be treated as the client on that one
record and lose their normal role's buttons there.

---

## 3. Intimation letter re-upload doesn't email — worse than Surveillance 1's original bug

There was **no `RECERT_EMAIL_ON_UPLOAD_FIELDS` map at all** —
`maybeSendRenewalUploadEmail`'s `isRenewalObject` gate hardcoded the whole
mechanism to Renewal only, so it was a no-op for every Recertification
field, always. Recertification only ever got the one-time creation-flow
email from `NewRecertificationForm.tsx` (the `recertification_intimation`
template already exists and works there); any later, separate upload of
`recert_intimation_letter` sent nothing, silently.

**Fix (frontend only, no migration):**
- Added `RECERT_EMAIL_ON_UPLOAD_FIELDS = { recert_intimation_letter: 'recertification_intimation' }` in `RecordDetailView.tsx`, reusing the same template the creation-flow path already sends.
- Generalized `maybeSendRenewalUploadEmail` to check `isRenewalObject` **or** `isRecertObject` and pick the matching map, instead of hard-gating to Renewal only. Every other object/field is still a no-op, unchanged.

---

## What this does NOT change

- The rights matrix (who can view/upload/accept what) is untouched — this
  Sprint is entirely about *identifying* the client and *displaying* a
  linked record correctly, not about permissions.
- The upstream linkage gap itself (External Client records created without
  `client_user_id__a`) still exists and isn't repaired by this — Sprint 9
  works around it for reads (already covered tenant-wide by migration 288)
  and for these specific client-facing writes; it doesn't fix the data.
- No warning was added on the creation form for a missing
  `client_user_id__a`.
