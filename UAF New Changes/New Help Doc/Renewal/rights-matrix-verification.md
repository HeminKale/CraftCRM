# Surveillance 1 (Renewal) — Rights Matrix Verification

Row-by-row audit of the SURV 1 rights matrix against the actual live code —
not the plan docs, the real RPC bodies and Permission Set migrations. Done
by reading `start_file_upload` (migration 278, the current live body),
every accept/assign RPC, and the Permission Set migrations (263, 280)
directly, then cross-checking each cell.

---

## The three-layer enforcement model

Every cell in the matrix is enforced by one or more of these, never by
guesswork:

1. **RPC hard gates** — `start_file_upload` role-checks each file field by
   name; separate RPCs (`assign_surv_team`, `review_surveillance_intimation`,
   `review_surv_plan`, `review_surv_ncr_rca`, `submit_surv_tech_findings`,
   `close_surv_audit`) gate every accept/assign action. Several go further
   than "has the role" — they bind to the *specific* `auditor_id__a`/
   `tech_reviewer_id__a` assigned on that exact record, not any user with
   the role. This layer is server-side and unbypassable, the authoritative
   control for every action.

2. **Permission Set `can_read`** — server-side field visibility
   (`get_tenant_fields`/`get_fields_metadata`, migration 209). A field with
   an explicit `can_read = false` entry for a role is excluded from the API
   response entirely — never reaches the browser. **Fields/objects are
   deny-list**: no entry at all means fully accessible by default. This is
   why most role/field combinations have zero PS entries — they don't need
   one, the default already matches what the matrix wants.

3. **Permission Set `can_edit`** (client-side) + a **hardcoded per-object
   role map** in `RecordDetailView.tsx` (`RENEWAL_FILE_FIELD_UPLOAD_ROLE`)
   — for file fields, the upload input's `readOnly` state requires BOTH
   `can('edit', 'field', field.id)` to be true AND the field's entry in
   the hardcoded map to allow the caller's role. Two independent checks,
   neither alone sufficient, on top of the RPC gate.

**Unchecked in the Permission Sets UI ≠ denied.** It means "no explicit
entry" — which, for objects/fields, defaults to full access. Only an
explicit `can_read = false` entry actually blocks anything. This tripped up
a UI reading during this verification (CRM Office showing all-unchecked on
`recertification_clients__a` looked alarming until traced back to the
deny-list default — see the sibling doc in the Recertification folder for
that exact walkthrough).

---

## Full matrix, verified

| Row | Matrix | RPC enforcement | PS enforcement |
|---|---|---|---|
| Surveillance intimation letter | Client view/email, CRM upload, rest blank | `start_file_upload`: CRM-only | Auditor/Tech/CDC denied (263) |
| Acceptance by client | Client accept only | `review_surveillance_intimation`: linked-client-only | — (action only, no distinct field) |
| Assign team | CRM upload, Auditor/Tech/CDC view, Client blank | `assign_surv_team`: CRM-only, validates chosen users hold the role, requires prior status `Intimation_Accepted` | Client blank by construction — `auditor_id__a`/`tech_reviewer_id__a` deliberately never registered in `tenant.fields` |
| Surv audit plan | Client/Tech/CDC view, CRM/Auditor upload | Team-assigned-first gate + CRM-or-Auditor upload gate | none needed |
| Surv plan accept | Client accept, Tech reviewer blank, rest view | `review_surv_plan`: linked-client-only | none needed (action-only blank, field itself stays visible) |
| Surv NCR | Client/CDC view, CRM/Auditor upload, Tech blank | CRM-or-Auditor upload gate | **Tech reviewer denied** (263 — corrected a wrong "Client" assumption from an earlier draft) |
| Surv NCR RCA | Client upload, rest view | Linked-client-only upload gate | none needed |
| Surv NCR RCA acceptance | Auditor accept, rest view | `review_surv_ncr_rca`: gated to the **specific assigned auditor** | none needed |
| Surv audit report | CRM/Auditor upload, Tech accept/findings, Client conditional | `submit_surv_tech_findings`/`close_surv_audit`: assigned-tech/assigned-auditor only | Client's "view only after tech acceptance" is a frontend status-lock (`isStageReportLockedForClient`, unlocks at `Surv_Tech_Findings_Given`) — status-conditional rules can't be expressed by static PS |
| Tech review findings | Client blank, Tech write, Auditor view/close | `submit_surv_tech_findings` + `close_surv_audit` | **Client denied** (`surv_tech_findings_notes`, 263) |
| Tech review checklist | Client blank, Tech upload | `start_file_upload`: Tech-only | **Client denied** (`surv_tech_findings_file`, 263) |
| CDC | Client/Auditor/Tech blank, CDC upload | `start_file_upload`: CDC-only | **Client + Auditor + Tech denied**, CRM view-only can_edit=false (263) |
| Certificate issue | Auditor/Tech blank, CRM upload | `start_file_upload`: CRM-only | **Auditor + Tech denied** (263) |
| Suspension intimation | Client view/email, CRM upload | `start_file_upload`: CRM-only, requires `Certificate_Issued` | Auditor+Tech denied, CDC denied (280) |
| Suspension decision | CRM view, CDC upload | `start_file_upload`: CDC-only, requires `Suspension_Intimation_Sent` | Auditor+Tech denied, Client denied, CRM view-only (280) |
| Suspension letter | Client view/email, CRM upload | `start_file_upload`: CRM-only, requires `Suspension_Decision_Uploaded` | Auditor+Tech denied, CDC denied (280) |
| Withdrawal intimation | Client view/email, CRM upload | `start_file_upload`: CRM-only, requires `Suspension_Letter_Sent` | Auditor+Tech denied, CDC denied (280) |
| Withdrawal decision | CRM view, CDC upload | `start_file_upload`: CDC-only, requires `Withdrawal_Intimation_Sent` | Auditor+Tech denied, Client denied, CRM view-only (280) |
| Withdrawal letter | Client view/email, CRM upload | `start_file_upload`: CRM-only, requires `Withdrawal_Decision_Uploaded` | Auditor+Tech denied, CDC denied (280) |

**Result: every row matches. No discrepancies found on the Surveillance 1
side** (unlike Recertification, where one was found and fixed — see the
sibling doc).

---

## Migrations behind this

| # | What |
|---|---|
| 261 | Original `start_file_upload` hard gates, Sprint 1–3 fields |
| 263 | Permission Set entries — Sprint 5 |
| 278 | `start_file_upload` extended — Sprint 8 (suspension/withdrawal, 6 new gates + sequencing) |
| 280 | Permission Set entries — Sprint 8 |

All already accounted for in `Sprints/Sprint_5.md`–`Sprint_8.md`. This doc
is the cross-check pass confirming the shipped code actually matches the
matrix image, not a new build.

---

## Why this matters going forward

Any new field/row added to this matrix should be verified the same way —
don't assume a PS entry is missing just because a checkbox looks unchecked
in the Settings UI; check whether the deny-list default already covers it,
and only write an entry for genuinely blank cells. Read the actual live RPC
body (highest-numbered `CREATE OR REPLACE FUNCTION`, not the object's own
last-touched migration — shared functions drift across epics) before
assuming what's enforced.
