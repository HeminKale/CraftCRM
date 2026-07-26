# Summary Excel Import — Field Analysis (pre-implementation)

This is an **analysis document, not an implementation record**. Nothing described
here as "new field" or "proposed" has been built. It maps every column found in a
real sample summary sheet (`Untitled spreadsheet (3).xlsx`, supplied 2026-07-26)
against the two objects that already exist — `tenant.external_clients__a` and
`tenant.client_summary__a` — so we can decide field-by-field what's reusable,
what needs a new column, and what's genuinely ambiguous before writing any
migration or touching `StageDateImport.tsx`.

> **Confirmed 2026-07-26 (stakeholder decision):** going forward, the sheet's
> layout will be standardized so **every** field — the ones currently in the
> wide table (§2) and the ones already in the vertical list (§3) — follows the
> same one-row-per-field, label-in-column-A/value-in-column-B shape. That
> removes the header-row-detection problem described in §1 below entirely: the
> parser only ever needs the one reader it already has, just with a bigger
> label dictionary. §1 is kept as-written for the record (it explains why the
> *original* sample file, as a wide table, couldn't be read by the current
> parser) — it no longer describes a blocking problem now that the input
> format itself is changing. See **§5a "Resolved decisions"** for the full set
> of field-mapping and behavior decisions made in this conversation.

Related: **new-client-form.md**, **S0_S1_S2.md**, **S3.md**, **S4.md**, **S5.md**
(the existing vertical-date importer this sheet's bottom section already matches).

---

## 1. The sample file has two structurally different sections

This is the single most important finding — **the current importer
(`StageDateImport.tsx`, built for S5's vertical date list) cannot parse this file
correctly as-is**, because only *part* of it matches the two-column label/value
shape it expects.

### Section A — a wide table (rows 0–1): one header row, one data row

```
Row 0 (header): COMPANY NAME | Standard | Certificate no | Country | Reg date | type |
                 ADDRESS | SCOPE | IAF Code | No of empl | total mandays | Stg 1 manday |
                 stg 2 manday | Auditor Stg 1 | Auditor Stg 2 | Tech Reviewer |
                 Director name | Surveillance 1 mandays | Recert mandays | auditor team |
                 application reviewer name | lead auditor | Food category | SOA Date
Row 1 (data):   ALIEDAD GENERAL CONSTRUCTION IMPORT & EXPORT | ISO 9001:2015 / ISO
                 14001:2015 / ISO 45001:2018 | AMER30929 / AMER30930 / AMER30931 |
                 Iraq | 13 August 2025 | Initial | ... (etc.)
```

This is a normal spreadsheet table — column headers across row 0, one client's
values across row 1. `StageDateImport.tsx`'s current parser assumes every row is
an independent `[label, value]` pair (column A = label, column B = value), which
does not apply here at all — row 0 would be misread as `label="COMPANY NAME",
value="Standard"`, and every other header/value pair in that row would be
silently dropped since the parser only ever looks at columns A and B.

**A revised parser needs a dedicated header-row + single-data-row reader for this
section**, structurally different from the vertical-list reader below.

### Section B — the vertical label/value list (rows 6–22)

This is exactly the format `StageDateImport.tsx` already handles, and the labels
are an exact match to the 17 items from Sprint 5's reference-dates checklist:
`registration date`, `cdc date`, `tech review 2 date`, `stage 2 NCR closure
date`, `stage 2 audit RCA accept date`, `stage 2 audit date`, `stage 2 plan
accept date`, `stage 2 plan sent date`, `tech review 1 date`, `Stage 1 NCR RCA
acceptance date`, `stage 1 audit date`, `stage 1 plan accept date`, `stage 1
plan sent date`, `client agreement`, `quotation`, `application review`,
`application`. No changes needed here — this part already works, verified live
against a real record (see S5.md's follow-up testing in this same conversation).

### Rows in between (2, 4, 5 blank; row 3 a document-control footer)

Row 3 reads `"Issue no 3, rev 0 , 01/01/2024"` — a controlled-document
issue/revision footer baked into the template, not client data. The existing
parser already tolerates this correctly by accident (it silently ignores any
row whose column-A text doesn't match a known label), but a revised parser
needs to keep doing that deliberately, not by accident, once it's also scanning
for a header row.

---

## 2. Section A field mapping — wide table → object fields

| Excel column | → `external_clients__a` | → `client_summary__a` | Status |
|---|---|---|---|
| COMPANY NAME | `Company_name__a` | `company_name__a` | ✅ both exist |
| Standard | `ISOStandard__a` | `iso_standards__a` | ✅ both exist |
| Certificate no | — | — | ❌ **no home on either object.** A `certificateNumber__a` field exists, but on an unrelated "Draft"/certificate-generation object, not reachable from here without cross-object logic |
| Country | `country__a` | — | ⚠️ exists on External Client only; `client_summary__a` has no country column at all |
| Reg date | ⚠️ see **Open Question 1** | — | Possibly distinct from "registration date" in Section B — see below |
| type | — | — | ❌ new field (e.g. Initial / Surveillance / Recertification) |
| ADDRESS | `Adddress__a` (yes, the live column has that typo — pre-existing, not introduced here) | `address__a` | ✅ both exist |
| SCOPE | `scope__a` | `scope__a` | ✅ both exist |
| IAF Code | — | — | ❌ new field (IAF = International Accreditation Forum classification code) |
| No of empl | `totalNumberOfEmployees__a` | — | ⚠️ External Client only |
| total mandays | — | — | ❌ new field |
| Stg 1 manday | — | — | ❌ new field |
| stg 2 manday | — | — | ❌ new field |
| Auditor Stg 1 | — | `stage1_auditor__a` | ✅ Summary only |
| Auditor Stg 2 | — | `stage2_auditor__a` | ✅ Summary only |
| Tech Reviewer | — | ⚠️ see **Open Question 2** | Summary has *two* fields (`stage1_tech_reviewer__a`, `stage2_tech_reviewer__a`); sheet has *one* column |
| Director name | — | — | ❌ new field |
| Surveillance 1 mandays | — | — | ❌ new field — see **Open Question 3** (scope creep into Surveillance/Recert cycles) |
| Recert mandays | — | — | ❌ new field — same note |
| auditor team | — | — | ❌ new field, possibly redundant with Auditor Stg 1/Stg 2 — see Open Question 4 |
| application reviewer name | — | `application_reviewer__a` | ✅ Summary only |
| lead auditor | — | — | ❌ new field, possibly redundant with Auditor Stg 1 or auditor team — see Open Question 4 |
| Food category | — | — | ❌ new field, standard-specific (FSMS/ISO 22000) — likely blank for most clients |
| SOA Date | — | — | ❌ new field, standard-specific (ISO 27001 Statement of Applicability) — likely blank for most clients |

**Tally:** of 24 wide-table columns, 9 already have a home on at least one
object, 1 exists only as an unrelated object's field, and **14 have nowhere to
go today** without a schema change.

---

## 3. Section B field mapping — vertical list → `external_clients__a`

Unchanged from what's already implemented and verified in `StageDateImport.tsx`.
Restated here for completeness, since this doc is meant to be the single
reference for the whole sheet:

| Excel label | `external_clients__a` column | Notes |
|---|---|---|
| application | `Date__a` | |
| application review | `Application_Accpeted_Date__a` | |
| quotation | `Quotation_Received_Date__a` | |
| client agreement | `Client_Agreement_Signed_Date__a` | |
| stage 1 plan sent date | `Stage_one_plan_Sent_Date__a` | |
| stage 1 plan accept date | `stage1_plan_accepted_date__a` | |
| stage 1 audit date | `stage1_audit_date__a` | TEXT, manual, no status implication |
| Stage 1 NCR RCA acceptance date | `stage1_auditor_accepted_date__a` | |
| tech review 1 date | `stage1_tech_final_accepted_date__a` | |
| stage 2 plan sent date | `stage2_plan_sent_date__a` | |
| stage 2 plan accept date | `stage2_plan_accepted_date__a` | |
| stage 2 audit date | `stage2_audit_date__a` | TEXT, manual, no status implication |
| stage 2 audit RCA accept date | `stage2_auditor_accepted_date__a` | |
| stage 2 NCR closure date | `stage2_evidences_accepted_date__a` | |
| tech review 2 date | `stage2_tech_findings_date__a` | |
| cdc date | `cdc_date__a` | |
| registration date | `stage2_registration_date__a` | Special-cased via `set_stage2_registration_date` RPC (also sets `status__a`), not a raw column write |

None of these currently write to `client_summary__a` at all — **resolved in
§5a: they will, going forward, be mirrored to both objects.**

---

## 4. Data-shape complications worth flagging before building anything

- **Multi-value cells, positionally paired.** The sample row's `Standard` column
  holds three newline-separated values (`ISO 9001:2015` / `ISO 14001:2015` /
  `ISO 45001:2018`), and `Certificate no` holds three newline-separated values
  in the same order (`AMER30929` / `AMER30930` / `AMER30931`) — i.e. certificate
  #1 belongs to standard #1, etc. `Auditor Stg 1` and `Auditor Stg 2` similarly
  hold two newline-separated names each in this sample. Storing these as raw
  text blobs (matching how `ISOStandard__a`/`iso_standards__a` already store
  multi-standard text today) is the simplest option and requires no schema
  change beyond adding the missing columns — but it means the *positional
  pairing* between standard and certificate number is only implicit, held
  together by matching line order in two separate text fields, not by any
  actual data relationship. A properly structured model (e.g. a related
  "Certifications" child list, one row per standard+number+dates) would capture
  this correctly but is a materially bigger change — new object, new RPCs, new
  UI — not a field-mapping exercise.
- **"Reg date" (13 August 2025) vs. "registration date" (26 May 2026) are not
  the same value in this sample** — over nine months apart for the same
  (fictional) client. They cannot both mean "when this ISO cycle's
  registration completed." See Open Question 1.
- **`type: "Initial"`** suggests this same template is reused for other audit
  types (Surveillance, Recertification), which the app's current Stage 1/2
  workflow doesn't model at all — see Open Question 3. If true, the vertical
  Section B list (all of which is Stage 1/2-specific) may not even apply to a
  Surveillance-type row, and this importer would eventually need to branch on
  `type` rather than assume every uploaded sheet is an initial-certification
  cycle.

---

## 5. Open questions — original list (kept for record)

1. What is "Reg date" (wide table) actually recording, vs. "registration date"
   (vertical list)? — **Resolved, see 5a.**
2. "Tech Reviewer" is one column but two fields exist. — **Resolved, see 5a.**
3. Does this template cover Surveillance/Recertification too? — **Deferred,
   see 5a — out of scope until the Renewal Client flow is discussed.**
4. `auditor team` / `lead auditor` / `Auditor Stg 1`/`Auditor Stg 2` overlap? —
   **Resolved, see 5a — all created as distinct fields.**
5. Should the dates also write to `client_summary__a`? — **Resolved, see 5a —
   yes, both objects stay in sync.**
6. Where do the 14 homeless wide-table columns go? — **Resolved, see 5a — per
   the field-parity policy, created on both objects except the deferred
   Surveillance/Recert-specific ones.**
7. Multi-value cells: raw text blob or structured child list? — **Resolved —
   raw text blob, no structured child object.** Not revisited; still the
   simplest option and nothing in this conversation changed that.

## 5a. Resolved decisions (2026-07-26)

**General field-parity policy (governs everything below):** any field created
for this feature is created in **`tenant.fields` (so it's visible in Object
Manager) on both `external_clients__a` and `client_summary__a`**, unless
explicitly noted otherwise. All `external_clients__a` fields remain manually
editable through the normal record edit form, gated by permission sets like
every other field — the summary sheet is an *additional* way to set them, not
the only way, and either can override the other (last write wins, no locking).

**Registration date.** `stage2_registration_date__a` stays exactly as-is —
untouched, still the RPC-only internal column `set_stage2_registration_date`
owns, still never registered in `tenant.fields`. A **separate, new** field is
created instead: `registration_date` (label "Registration Date", type `date`)
on both objects. Reasoning: `stage2_registration_date__a` had no existing
label to reuse (confirmed — it was never registered at all), and keeping the
RPC's internal column untouched avoids any risk to the existing Stage 2 tail
behavior. **Status sync:** whenever `registration_date__a` is set — by hand
through the edit form, or via summary-sheet import — `status__a` also advances
to `Client_Registered` if it isn't already there or further along (same
forward-only rule `StageDateImport.tsx` already uses for the other dates).
Implementation note carried forward to the build step: this now means *two*
columns can each independently push status to `Client_Registered`
(`stage2_registration_date__a` via the existing RPC, `registration_date__a` via
this new path) and they are **not** kept in sync with each other — a record
could show two different dates for what reads as the same real-world event.
Worth a one-line mention in whichever UI shows both, so nobody assumes they're
the same value. Recommended implementation approach: a database trigger on
`external_clients__a` watching `registration_date__a` (or `stage1_audit_date__a`-
style manual fields generally), rather than duplicating "if this field changes,
also touch status__a" logic in every frontend save path (`RecordDetailView`'s
generic save *and* `StageDateImport`'s importer) — confirm this approach at
implementation time rather than assuming here.

**Tech Reviewer.** The Excel's single "Tech Reviewer" column maps to
`stage1_tech_reviewer` only. `stage2_tech_reviewer` is still created on
`external_clients__a` for parity with `client_summary__a` (which already has
both), just not populated by this column.

**Auditor Stg 1 / Auditor Stg 2.** Unambiguous 1:1 mapping — create
`stage1_auditor` and `stage2_auditor` on `external_clients__a`, matching
`client_summary__a`'s existing fields and labels exactly ("Stage 1 Auditor" /
"Stage 2 Auditor").

**`auditor team` / `lead auditor`.** Created as distinct new fields on both
objects, not collapsed into the Auditor Stg 1/2 pair — no deduplication.

**Surveillance/Recertification scope** (`type`, `Surveillance 1 mandays`,
`Recert mandays`). **Deferred entirely.** Not created, not mapped, ignored by
the importer for now. Revisit when the Renewal Client flow is discussed
specifically — these columns may belong there instead of here.

**Section B (the date list) now also writes to `client_summary__a`.** Today
`StageDateImport.tsx` only touches `external_clients__a`. Going forward every
value it writes is mirrored to both objects. `client_summary__a`'s existing
date columns are coarser (one `stage1_date__a`, one `stage2_date__a`, one
`ncr_closure_date__a`, no per-checkpoint granularity) — the per-checkpoint
`external_clients__a` columns stay as the detailed record; `client_summary__a`
receives the same values into whichever of its existing coarser columns is the
closest match (e.g. `tech review 1 date` → `external_clients__a
.stage1_tech_final_accepted_date__a` **and** `client_summary__a.stage1_date__a`).
Exact per-field target-column pairing to be finalized at implementation time
alongside the new-fields migration.

---

## 6a. New fields to create (both objects unless noted) — proposed names

| Excel column | Field name | Label | Type | Notes |
|---|---|---|---|---|
| Certificate no | `certificate_no` | Certificate No | text | multi-value, newline-separated, positionally paired with Standard |
| Country *(Summary only — already exists on External Client as `country__a`)* | `country` | Country | text | |
| type | — | — | **deferred**, not created |
| IAF Code | `iaf_code` | IAF Code | text | |
| No of empl *(Summary only — already exists on External Client as `totalNumberOfEmployees__a`)* | `no_of_employees` | Total Number of Employees | text | match External Client's existing label for consistency |
| total mandays | `total_mandays` | Total Mandays | text | matches existing convention of storing numeric-looking fields as text (e.g. `totalNumberOfEmployees__a`) |
| Stg 1 manday | `stage1_manday` | Stage 1 Manday | text | |
| stg 2 manday | `stage2_manday` | Stage 2 Manday | text | |
| Auditor Stg 1 *(External Client only — already exists on Summary)* | `stage1_auditor` | Stage 1 Auditor | text | mirrors `client_summary__a` |
| Auditor Stg 2 *(External Client only — already exists on Summary)* | `stage2_auditor` | Stage 2 Auditor | text | mirrors `client_summary__a` |
| Tech Reviewer *(External Client only — already exists on Summary)* | `stage1_tech_reviewer` | Stage 1 Tech Reviewer | text | Excel maps here only |
| — *(External Client only, parity — not populated by this Excel)* | `stage2_tech_reviewer` | Stage 2 Tech Reviewer | text | mirrors `client_summary__a`, no Excel source column yet |
| Director name | `director_name` | Director Name | text | |
| Surveillance 1 mandays | — | — | **deferred**, not created |
| Recert mandays | — | — | **deferred**, not created |
| auditor team | `auditor_team` | Auditor Team | text | distinct from Auditor Stg 1/2, no dedup |
| lead auditor | `lead_auditor` | Lead Auditor | text | distinct from Auditor Team, no dedup |
| Food category | `food_category` | Food Category | text | standard-specific, likely blank for non-food clients |
| SOA Date | `soa_date` | SOA Date | text | standard-specific (ISO 27001), TEXT not DATE — same reasoning as `stage1_audit_date__a`, likely blank for most clients |
| registration date *(new field, separate from `stage2_registration_date__a`)* | `registration_date` | Registration Date | date | see §5a — auto-advances `status__a` to `Client_Registered` |

That's **17 new field registrations** (some appearing on only one object where
the other already has it, most on both) across two tables, plus the
`registration_date__a` column addition and its status-sync behavior.

---

## 6. Implemented (2026-07-26)

All three original requests, plus §5a/§6a's field plan, are now built:

1. **Button consolidated.** "Upload Audit Pack" is gone. `ClientSummaryTab.tsx`'s
   `handleAuditUpload`, its `fileInputRef`, and the `uploading` state were
   removed entirely — the existing-files display (`auditFiles` / `downloadAudit`)
   stayed, since viewing/downloading previously-uploaded files is still needed.
2. **Renamed to "Import Summary."** `StageDateImport.tsx`'s button label.
3. **The uploaded sheet is stored as an attachment.** `StageDateImport`'s
   `apply()` now does this as its last step (after both objects are updated),
   reusing the exact same Storage-path convention and `append_audit_pack_entry`
   RPC the old button used — no new backend needed, confirmed correct in §6a's
   original read of the code.

**Migration `241_summary_excel_import_fields.sql`:**
- 16 new fields on `external_clients__a`, 13 new fields on `client_summary__a`
  (per §6a's table, plus `application_reviewer` — a field-parity gap in the
  original §6a table, caught and fixed before writing the migration: Summary
  already had it, External Client didn't, and it was missed in the first pass).
- `registration_date__a` — the genuinely new, separate column confirmed in §5a.
- A trigger, `tenant.sync_status_on_registration_date`, BEFORE INSERT OR
  UPDATE on `external_clients__a`: whenever `registration_date__a` is newly
  set or changed to non-null, `status__a` is forced to `Client_Registered` —
  covers every write path uniformly (manual edit, Summary import, anything
  future) rather than duplicating the check in each one. One real bug caught
  before this ever got applied: the first draft referenced `OLD` unconditionally,
  which is unassigned during `INSERT` — fixed with a `TG_OP = 'INSERT'` guard.
- `get_client_summary`, `get_all_client_summaries`, and `upsert_client_summary`
  redefined (full bodies reproduced, not diffed, per this repo's convention)
  to include the 13 new Summary columns. **This was a gap the original §6a
  plan missed entirely** — those three RPCs have explicit, hardcoded column
  lists, not `SELECT *`. Without extending them, `upsert_client_summary` would
  have silently dropped every new field written through it (no error — the
  JSONB keys just wouldn't match anything in the `UPDATE ... SET` clause), and
  even a successful write would never have been readable back out.

**`StageDateImport.tsx`** now uses one unified `FIELD_MAPPINGS` table (label →
`{extColumn?, summaryColumn?, kind}`) instead of a single flat map, since the
combined sheet now covers both date-typed and free-text fields — company
name, standard, certificate no, mandays, auditor/reviewer names, director
name, food category, SOA date all pass through as trimmed text, no date
parsing attempted. `registration date` is no longer special-cased through
`set_stage2_registration_date` — it's now a plain column write like
everything else, added as the last entry in `STAGE_PROGRESSION` (Client
Registered being the terminal stage), with the DB trigger doing the actual
enforcement server-side regardless of what the frontend's preview computes.
Every field with a `summaryColumn` is also written to `client_summary__a` via
`upsert_client_summary` in the same `apply()` call.

**`ClientSummaryTab.tsx`'s `ROWS` array** — the hardcoded table driving the
Summary detail page's manual-edit view — extended with the 13 new fields, so
they're visible and hand-editable there too, not just importable. Unlike
External Client (fully generic, `RecordDetailView` + Page Layout driven),
Summary's detail page is bespoke; new columns don't show up there just from
being registered in `tenant.fields`.

**Permissions:** no new permission code was needed. Every field above is a
normal `tenant.fields` row, so Permission Sets' field-level `can_read`/
`can_edit` (permission-sets.md) already covers it automatically, and every
write goes through `update_tenant_record` / `upsert_client_summary`, so
Sharing Policy's row-level ownership checks (sharing-policy.md) already apply
too — confirmed via `permission-sets.md` before writing any code, not assumed.

### Judgment calls made without a blocking question — flagging for review

- **`client_summary__a` target-column choices for "tech review 1/2 date."**
  Mapped to `stage1_date__a` / `stage2_date__a` (reinterpreting "Stage N
  Date" as "stage N fully complete," not "stage N audit conducted") rather
  than "stage 1/2 audit date," which has no Summary target at all. This is
  the more natural rollup-sheet reading but wasn't explicitly confirmed —
  worth a look if Summary's "Stage 1 Date" / "Stage 2 Date" columns don't
  read the way you expect after testing.
- **Several vertical dates have no `client_summary__a` target at all**
  ("application review," "stage 1 plan accept date," "stage 1 audit date,"
  "Stage 1 NCR RCA acceptance date," "stage 2 plan accept date," "stage 2
  audit date," "stage 2 audit RCA accept date," "cdc date") — Summary's
  schema is simply too coarse for these; they only ever write to
  `external_clients__a`.

---

## 7. Still outstanding

- **Migration 241 has not been applied.** Same as every migration in this
  repo — needs to go through the normal Supabase deploy path before any of
  this is live.
- **New fields aren't on any Page Layout yet.** Registering a field and
  placing it on a layout section are two separate steps (same gap hit twice
  already this epic, for `cdc_report`/`stage2_audit_date` in Sprint 5). Once
  241 is applied, the 16 new `external_clients__a` fields need placing via
  Object Manager → Page Layout before they're visible on the actual record
  page — they're already reachable in Object Manager's Fields tab and
  Permission Sets immediately, just not on the record detail view.
- **Live testing** — this hasn't been run against a real record yet the way
  the original date-only importer was (that pass caught the timezone bug).
  Given the scope increase (two RPCs redefined, a new trigger, 29 new
  columns across two tables), a live pass matters more here, not less.

---

## 8. Manual deployment steps

Nothing below can be done by the assistant directly — no service-role key is
available locally, so migrations can only be written, never applied, and
Page Layout placement is a live-UI action. All three steps are needed before
"Import Summary" is actually usable end-to-end.

### Step 1 — Apply the migration

Run the full contents of
[`supabase/migrations/241_summary_excel_import_fields.sql`](../../supabase/migrations/241_summary_excel_import_fields.sql)
through your normal Supabase deploy path (SQL editor, CLI, whichever you used
for 237–240). It's one file — the `DO` block, the trigger, and the three
redefined RPCs all need to run together, in the order they appear in the
file.

### Step 2 — Verify it applied correctly

```sql
-- External Client: expect 16 rows (registration_date .. soa_date)
SELECT name, label, type
FROM tenant.fields
WHERE object_id = '62803c4d-9430-4d19-a487-4370d52e062a'
  AND display_order BETWEEN 139 AND 154
ORDER BY display_order;

-- Client Summary: expect 13 rows
SELECT f.name, f.label, f.type
FROM tenant.fields f
JOIN tenant.objects o ON o.id = f.object_id
WHERE o.name = 'client_summary__a'
  AND f.display_order BETWEEN 30 AND 42
ORDER BY f.display_order;

-- Trigger exists
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgname = 'trg_sync_status_on_registration_date';

-- RPCs return the new columns (should not error, and should include e.g. certificate_no__a)
SELECT * FROM get_all_client_summaries() LIMIT 1;
```

### Step 3 — Place the 16 new External Client fields on Page Layout

Registering a field and putting it on the record page are two separate
steps — same gap hit twice already this epic (`cdc_report`/`stage2_audit_date`
in Sprint 5). Until this step is done, the 16 new fields exist and are
already governed by Permission Sets, but are invisible on the actual record.

1. Settings → Object Manager → External Clients → Page Layout.
2. **Add Section** → name it (e.g. "Certification & Audit Team") → type
   "Fields Only".
3. Click each of the 16 new fields in the field pool (avoid the search box —
   see S5.md's flagged bug: it crashes on a null `button_type`. Click
   directly in the unfiltered list instead) → assign to the new section.
4. **Save Layout**.

Client Summary needs no equivalent step — its detail page is the hardcoded
`ROWS` array in `ClientSummaryTab.tsx`, already extended to include all 13
new fields directly in code.

### Step 4 — Manual smoke test, once Steps 1–3 are done

- Open any External Client record's Summary tab → "Import Summary" should be
  visible (CRM/admin only) where "Upload Audit Pack" used to be.
- Upload a sheet with a mix of the new text fields (e.g. Company Name,
  Standard, Auditor Stg 1) and a few dates, including `registration date`.
  Confirm the preview shows correct values for both kinds, correctly flags
  any deliberately-broken cell (e.g. `#REF!`), and shows the status-advance
  line if applicable.
- Apply → confirm: the sheet itself appears under "Audit Pack Files"; the new
  values show on the External Client record's detail page (in the new Page
  Layout section from Step 3) and on the Summary tab's own table; if
  `registration date` was included, `status__a` reads `Client_Registered` on
  the External Client record.
- Manually edit one of the new fields directly on the External Client record
  (not via import) — confirm the write succeeds and, if it's
  `registration_date__a`, confirm `status__a` advances even without going
  through the importer (proves the trigger, not frontend logic, is what's
  actually enforcing this).
