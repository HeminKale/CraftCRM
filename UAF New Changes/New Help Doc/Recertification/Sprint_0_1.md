# Recertification — Sprints 0 & 1: What Shipped

Covers **Sprint 0** (table + intimation) and **Sprint 1** (intake: application,
quotation, agreement) from [`00_Sprint_Plan.md`](00_Sprint_Plan.md). Built together
in the same session, retroactively documented here — this doc was written after
Sprint 3 was already underway, once the gap in per-sprint documentation was flagged.

> **Read order:** [`00_Sprint_Plan.md`](00_Sprint_Plan.md) (the plan) → **this doc**
> (Sprints 0-1) → [`Sprint_2.md`](Sprint_2.md) → [`Sprint_3.md`](Sprint_3.md).

Both sprints follow the plan doc exactly — no scope changes. Structurally this epic
copies Surveillance 1's Sprint 0/1 shape (`../Renewal/Sprints/Sprint_0_1.md`) with two
deliberate differences called out below: a required (not optional) client link, and
two hard upload gates shipped from day one instead of retrofitted later.

---

## 1. Sprint 0 — Table + Intimation

**Migration:** [`264_recertification_table_and_intimation.sql`](../../../supabase/migrations/264_recertification_table_and_intimation.sql)

**Part 1 — Table.** `tenant.recertification_clients__a` — `id`, `tenant_id`,
`external_client_id__a` (**UUID NOT NULL**, `REFERENCES tenant.external_clients__a(id)
ON DELETE RESTRICT`), `client_user_id__a` (copied from the linked external client for
RLS/auth parity), `name`, `company_name__a`, `contact_person__a`, `email__a`,
`iso_standards__a`, `status__a`, `recert_intimation_letter__a` (file),
`recert_intimation_sent_date__a`. Indexed on `tenant_id` and
`external_client_id__a`.

**Part 5 — `create_recertification_client(p_external_client_id UUID, p_email TEXT
DEFAULT NULL)`.** CRM/admin only. `p_external_client_id` is **required** — the RPC
explicitly rejects a NULL value with `'An External Client is required to create a
recertification record'`, unlike `create_renewal_client`'s optional link. Copies
`name`/`Company_name__a`/`contactPerson__a`/`email__a`/`ISOStandard__a`/
`client_user_id__a` from the linked `external_clients__a` row; `p_email` overrides the
copied email when provided (mirrors `create_renewal_client`'s final form from
migration 256).

**Parts 6-7 — `start_file_upload` / `finalize_file_upload` redefined.** Reproduced
261's (`start_file_upload`) and 262's (`finalize_file_upload`) full bodies verbatim —
confirmed those were still the latest redefinitions before extending — then added:
- `recert_intimation_letter` — **CRM-only hard gate in `start_file_upload` from day
  one.** Deliberate improvement over Surveillance 1, whose equivalent
  (`surveillance_intimation_letter`) had no hard gate until migration 261, three
  sprints after its own Sprint 0 — Recertification doesn't repeat that gap.
- `finalize_file_upload`: upload → `Recert_Intimation_Sent` + stamps
  `recert_intimation_sent_date__a`.

**Field/status registration:** one field set registered in `tenant.fields`
(`recert_intimation_letter`, `recert_intimation_sent_date`, plus the auto-populated
name/company/contact/email/iso fields), one `status__a` picklist value
(`Recert_Intimation_Sent`, display_order 1) — registered from day one, closing the
same kind of gap Surveillance 1 left open until its own migration 257 had to backfill
five missing values.

---

## 2. Sprint 1 — Intake: Application, Quotation, Agreement

**Migration:** [`265_recertification_intake.sql`](../../../supabase/migrations/265_recertification_intake.sql)

**New columns:** `recert_application_form__a` (file), `recert_application_sent_date__a`,
`recert_application_accepted_date__a`, `recert_quotation__a` (file),
`recert_quotation_received_date__a`, `recert_agreement__a` (file),
`recert_agreement_sent_date__a`, `recert_agreement_signed_date__a`,
`rejection_notes__a` (shared generic reject-notes field, matching the convention
already used on both prior objects). All registered in `tenant.fields`.

**`status__a` picklist:** `Recert_Application_Sent` (2), `Recert_Application_Accepted`
(3), `Recert_Quotation_Received` (4), `Recert_Agreement_Sent` (5),
`Recert_Agreement_Signed` (6).

**`review_recert_application(p_record_id, p_action, p_notes)`.** CRM/admin only.
`accept` → `Recert_Application_Accepted` + stamp date + clear `rejection_notes__a`.
`reject` → **stays** `Recert_Application_Sent` + stores `p_notes` — deliberately does
**not** reset to NULL the way New Client's from-scratch application reject does; this
record already has a linked client, so there's no "unlinked" state to fall back to.

**`review_recert_agreement(p_record_id, p_action, p_notes)`.** Linked client/admin
only. `accept` → `Recert_Agreement_Signed` + stamp date + clear `rejection_notes__a`.
`reject` → steps back to `Recert_Quotation_Received` + stores `p_notes`.

**`start_file_upload` / `finalize_file_upload` redefined**, reproducing 264's bodies
verbatim (confirmed 264 was still the latest redefinition), adding:
- `recert_application_form` — **Client-only hard gate.** Deliberately different from
  the intimation letter's CRM-only pattern — the client submits their own
  application, confirmed to match how New Client's form actually works today (not
  assumed).
- `recert_quotation`, `recert_agreement` — CRM-only hard gates.
- `finalize_file_upload`: each upload auto-advances status and stamps its date
  (`Recert_Application_Sent`, `Recert_Quotation_Received`, `Recert_Agreement_Sent`
  respectively). **No re-upload status guards were added in this sprint** — matches
  Surveillance 1's own Sprint 1 (257), which also shipped without them; Surveillance 1
  needed a later follow-up (262) to add guards. This gap has not been retrofitted for
  Recertification's intake fields either — flagging it here since it's a known,
  accepted gap, not an oversight.

---

## 3. Frontend

**`NewRecertificationForm.tsx`** (own file, does not touch `NewRenewalForm.tsx` or
`NewClientForm.tsx`) — registered in `CustomTabRenderer.tsx`'s component registry.

- Client picker is **required**, not optional (differs from `NewRenewalForm.tsx`) —
  enforced both in the form and at the RPC level (`create_recertification_client`
  rejects a NULL `p_external_client_id`).
- Email field pre-fills from the selected client but stays editable, same
  touched-flag pattern as `NewRenewalForm.tsx`.
- Optional intimation letter upload at creation time, via the same
  `start_file_upload`/`finalize_file_upload` flow later uploads from the record view
  use — the hard CRM-only gate applies equally both places.
- Non-blocking email notification via `/api/notifications/send` with the new
  `recertification_intimation` template (added alongside the existing
  `surveillance_intimation` template, same file, same generic `{ to, template, data }`
  route from Surveillance 1's Sprint 0).

---

## 4. Verified against source before writing

- Reproduced 261's `start_file_upload` and 262's `finalize_file_upload` bodies in
  264 — confirmed those were the latest redefinitions of each at the time (nothing
  between 261/262 and 264 touches either function).
- Reproduced 264's bodies of both functions in 265 — confirmed no file between 264
  and 265 touches them.
- Diffed reproduced bodies against source (comments-stripped) to confirm External
  Client's and Surveillance 1's code paths are untouched — done for both hops.

## 5. Not done in these sprints (by design)

- Frontend beyond the creation form — `RecertificationActionPanel.tsx` and
  `RecertificationWorkflowBar.tsx` are **Sprint 5**.
- Page Layout placement of the new fields — your side, needed before any of this is
  visible in the record UI.
- Permission Set entries — **Sprint 6**.
- Re-upload status guards on the Sprint 1 intake fields (see Sprint 1 section above)
  — not scoped to any sprint yet; flag if you want this closed sooner than
  Surveillance 1 closed its equivalent gap.

---

## 6. Next

**Sprint 2** (Team Assignment + Audit Plan) — see [`Sprint_2.md`](Sprint_2.md).
