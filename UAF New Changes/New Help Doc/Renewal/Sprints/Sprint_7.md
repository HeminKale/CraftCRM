# Surveillance 1 (Renewal) — Sprint 7: Summary Excel Import & Auto-Creation

**Status:** Planning → Build → QA  
**Scope:** Summary sheet import, auto-create-on-intimation, New Client pattern reuse  
**Sprint dependencies:** Sprints 0–6 complete; External Client's summary import (migrations 241, 251, 252) live as reference

---

## Overview

Mirror External Client's Summary import workflow for Surveillance 1:

1. **Auto-create renewal record** when intimation letter is uploaded (not on summary import)
   - Record created with client `name` only; all other fields blank
   - Status set to `Intimation_Sent` (or handled by finalize_file_upload)
2. **Add 15 metadata fields** to `renewal_clients__a` (schema)
3. **Build SurveilanceImport.tsx** component (Excel parser + importer, reuses External Client's mapping patterns)
4. **Extend finalize_file_upload** to auto-create the renewal record on intimation upload
5. **Summary tab** (you'll create the UI; this sprint provides the component)

**Key principle:** Follow External Client's implementation exactly — don't invent new patterns.

---

## Part A — Schema Migration (271_surv_metadata_fields.sql)

Add 15 new columns to `tenant.renewal_clients__a`:

| Column | Type | Display Order | Notes |
|---|---|---|---|
| `certificate_no__a` | TEXT | 38 | Multi-value, newline-separated (like ISOStandard__a) |
| `country__a` | TEXT | 39 | — |
| `scope__a` | TEXT | 40 | Already exists? Check; if not, add |
| `iaf_code__a` | TEXT | 41 | International Accreditation Forum code |
| `no_of_employees__a` | TEXT | 42 | Numeric as text (matches External Client pattern) |
| `surv_mandays__a` | TEXT | 43 | Single field (not stage-split) |
| `auditor_name__a` | TEXT | 44 | Text name; separate from auditor_id__a UUID |
| `tech_reviewer_name__a` | TEXT | 45 | Text name; separate from tech_reviewer_id__a UUID |
| `director_name__a` | TEXT | 46 | — |
| `auditor_team__a` | TEXT | 47 | Distinct from auditor_name__a |
| `application_reviewer__a` | TEXT | 48 | — |
| `lead_auditor__a` | TEXT | 49 | — |
| `food_category__a` | TEXT | 50 | Standard-specific (ISO 22000 FSMS), often blank |
| `soa_date__a` | TEXT | 51 | Standard-specific (ISO 27001 SOA); TEXT not DATE (manual, no status implication) |
| `surv_audit_pack__a` | JSONB DEFAULT '{}'::jsonb | 52 | File field — stores the uploaded summary sheet itself |

**Notes:**
- `scope__a` — verify it doesn't already exist on renewal_clients__a; migration 221 didn't register it. If it's already a column but not in tenant.fields, just register it.
- `auditor_name__a` / `tech_reviewer_name__a` — **separate from** the UUID fields (`auditor_id__a`, `tech_reviewer_id__a`). Both can exist and be independently writable (text for summary import, UUID for RPC assignment).
- `surv_audit_pack__a` — matches External Client's `audit_pack__a` pattern for file attachment.

**Migration structure (same as 241):**
1. ALTER TABLE ADD COLUMN
2. Update tenant.fields registration per tenant (DO block)
3. Register status__a picklist values (likely already done in 257–260; cross-check)

---

## Part B — Auto-create on Intimation Upload

**Current behavior:** intimation letter upload → `finalize_file_upload` → status auto-advances to `Intimation_Sent` (if not already there).

**New behavior:** if no renewal record exists for this external client yet → auto-create one before the upload proceeds.

**How External Client does it:** `create_object_record` is called from the frontend when the first application form is uploaded. But that requires the record to already exist as a choice.

**Surveillance 1 is different:** when the CRM uploads the intimation letter, they might not have created the renewal record yet. So:

**Option A (Recommended):** Extend `finalize_file_upload` to include an auto-create branch:
```sql
IF p_object_name = 'renewal_clients__a' 
   AND p_file_field = 'surveillance_intimation_letter'
   AND (SELECT id FROM tenant.renewal_clients__a WHERE id = p_record_id) IS NULL
THEN
  -- Insert a minimal renewal record (tenant_id, external_client_id, name, status)
  -- Get external_client_id from... context? (problem: finalize_file_upload doesn't know it yet)
END IF;
```

**Problem:** finalize_file_upload is called with `(p_record_id, p_object_name, p_file_field, ...)` but doesn't know which external client this renewal record should link to. The renewal record hasn't been created yet.

**Actual solution (per External Client):** The renewal record **must exist first**. The user creates it in the UI (a "New Surveillance 1" button → picks external client → creates blank renewal record → then uploads intimation letter).

**But you said:** "create the record with name of the client selected and keep everything blank just when summary is uploaded all fields on record would get there respective values."

So the flow should be:
1. User picks an External Client
2. "New Surveillance 1" button creates the renewal record (name only, everything blank, status = `Intimation_Sent` or `Team_Assigned`?)
3. User uploads intimation letter (finalize_file_upload doesn't need to auto-create)
4. User uploads summary sheet → SurveilanceImport overwrites blank fields with summary data, updates status

**Question for you:** When is the renewal record created?
- **Option A:** Manually, via a "New Surveillance 1" form (like New Client's form)
- **Option B:** Auto-created when the first file (intimation letter) is uploaded
- **Option C:** Auto-created when the summary sheet is first uploaded

**Assumption for this sprint:** Option A — provide a "New Surveillance 1 Form" component that you wire into the Surveillance tab. Matches External Client's flow exactly.

---

## Part C — SurveilanceImport.tsx Component

**Location:** `app/commonfiles/core/components/custom/Renewal_Client/SurveilanceImport.tsx` (new file)

**Inputs:**
- `renewalId`: UUID (the renewal record to import into)
- `isCrmOrAdmin`: boolean (gate the component visibility)
- `onImported?`: callback

**Outputs:**
- Parse Excel sheet (wide table + vertical date list)
- Preview the changes (show parsed rows, computed status)
- Apply: update renewal record + attach file + compute status

**Reuse from External Client:**
- `summarySheetMapping.ts` — can this be extended, or does Surveillance 1 need its own?

**Surveillance 1–specific mappings:**

| Excel Label | renewal_clients__a column | kind |
|---|---|---|
| surveillance intimation letter | (file upload, not date) | file |
| surv audit plan | surv_audit_plan__a | file |
| surv plan accept | surv_plan_accepted_date__a | date |
| surv ncr | surv_ncr__a | file |
| surv ncr rca | surv_ncr_rca__a | file |
| surv ncr rca acceptance | surv_auditor_accepted_date__a | date |
| surv audit report | surveillance_audit_report__a | file |
| surv tech review findings | surv_tech_findings_file__a | file |
| surv tech review checklist | (same as findings, bundled) | file |
| cdc report | cdc_report__a | file |
| surveillance certificates | surveillance_certificates__a | files |
| — | certificates_sent_date__a | date |
| — | cdc_date__a | date |
| — | surv_tech_findings_notes__a | text |

Plus all wide-table metadata (company name, auditor name, etc.).

**Status progression for Surveillance 1 (13 statuses):**
```
Intimation_Sent (1)
  ↓ (intimation_accepted_date__a)
Intimation_Accepted (2)
  ↓ (team_assigned_date__a)
Team_Assigned (3)
  ↓ (surv_plan_sent_date__a)
Surv_Plan_Sent (4)
  ↓ (surv_plan_accepted_date__a)
Surv_Plan_Accepted (5)
  ↓ (surv_ncr_sent_date__a)
Surv_NCR_Sent (6) [implied; not explicit in migrations 257–260]
  ↓ (surv_ncr_rca_uploaded_date__a)
Surv_NCR_RCA_Uploaded (7) [implied]
  ↓ (surv_auditor_accepted_date__a)
Surv_Auditor_Accepted (8)
  ↓ (surv_report_sent_date__a)
Surv_Report_Sent (9)
  ↓ (surv_tech_findings_date__a)
Surv_Tech_Findings_Given (10)
  ↓ (surv_closed_date__a)
Surv_Closed (11)
  ↓ (cdc_date__a)
CDC_Approved (12)
  ↓ (certificates_sent_date__a)
Certificate_Issued (13)
```

**Note:** Statuses 6/7 above are inferred from the workflow but may not have explicit picklist entries yet. Cross-check migrations 257–260 before writing the progression array.

---

## Part D — RPC Extension: upsert_renewal_from_summary (272_surv_summary_rpcs.sql)

> ⚠️ **The code snippet below is the original planning-stage draft, written
> before the actual RPC signatures were verified.** §11 documents 3 real
> bugs found in the code that was built from this plan (wrong param names on
> `update_tenant_record`, a `url` key nothing reads, an unresolved object-name
> string passed where a UUID was required) — all fixed in the shipped files.
> Don't copy from this snippet or Part F's below — read §11 for what's
> actually live, or read the files themselves.

**Like External Client's `upsert_client_summary`**, but for renewal_clients__a.

Called by SurveilanceImport.tsx's `apply()` method to update the record with parsed summary data.

**Signature:**
```sql
CREATE OR REPLACE FUNCTION public.upsert_renewal_from_summary(
  p_record_id UUID,
  p_data JSONB  -- parsed summary fields: {certificate_no__a, country__a, auditor_name__a, ...}
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE tenant.renewal_clients__a
  SET
    certificate_no__a = COALESCE((p_data->>'certificate_no__a'), certificate_no__a),
    country__a = COALESCE((p_data->>'country__a'), country__a),
    -- ... all 15 fields
    surv_audit_pack__a = ... (handle file attachment separately; see Part E)
  WHERE id = p_record_id AND tenant_id = current_tenant_id();
  
  RETURN QUERY SELECT true, 'Updated'::TEXT;
END $$;
```

**OR:** Reuse `update_tenant_record` (like External Client may do) if it already handles the dynamic update logic.

---

## Part E — File Attachment: append_renewal_audit_pack_entry (NEW)

**Matches External Client's `append_audit_pack_entry` RPC.**

Called by SurveilanceImport.tsx's `apply()` after the record is updated, to attach the uploaded sheet.

**Signature:**
```sql
CREATE OR REPLACE FUNCTION public.append_renewal_audit_pack_entry(
  p_record_id UUID,
  p_file_json JSONB  -- {name, url, size, ...}
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE tenant.renewal_clients__a
  SET surv_audit_pack__a = 
    CASE 
      WHEN surv_audit_pack__a = '{}'::jsonb THEN jsonb_build_array(p_file_json)
      ELSE surv_audit_pack__a || jsonb_build_array(p_file_json)
    END
  WHERE id = p_record_id;
  
  RETURN QUERY SELECT true, 'Attached'::TEXT;
END $$;
```

---

## Part F — SurveilanceImport Component: apply() Logic

In `SurveilanceImport.tsx`'s `apply()` method:

```typescript
const apply = async () => {
  if (!rows || !tenant?.id) return;
  setApplying(true);
  try {
    const valid = rows.filter(r => r.value !== null);

    // 1. Build update JSONB (text fields)
    const updateData = {};
    valid.forEach(row => {
      if (row.mapping.extColumn) {
        updateData[row.mapping.extColumn] = row.value;
      }
    });

    // 2. Call upsert_renewal_from_summary
    const { error: updateErr } = await supabase.rpc('upsert_renewal_from_summary', {
      p_record_id: renewalId,
      p_data: updateData,
    });
    if (updateErr) throw updateErr;

    // 3. Compute new status and advance it
    const presentColumns = new Set(
      valid.filter(r => r.mapping.kind === 'date').map(r => r.mapping.extColumn)
    );
    const statusIdx = SURV_STAGE_PROGRESSION.findIndex(s => s.column === currentStatus);
    let newStatusIdx = -1;
    SURV_STAGE_PROGRESSION.forEach((s, i) => {
      if (presentColumns.has(s.column)) newStatusIdx = i;
    });
    const newStatus = newStatusIdx > statusIdx ? SURV_STAGE_PROGRESSION[newStatusIdx].status : currentStatus;

    if (newStatus !== currentStatus) {
      const { error: statusErr } = await supabase.rpc('update_tenant_record', {
        p_object_name: 'renewal_clients__a',
        p_record_id: renewalId,
        p_data: { status__a: newStatus },
      });
      if (statusErr) throw statusErr;
    }

    // 4. Attach the uploaded file
    const storageResult = await supabase.storage
      .from('tenant-uploads')
      .upload(`${tenant.id}/renewal_summary_${renewalId}_${Date.now()}.xlsx`, pendingFile);
    
    if (storageResult.error) throw storageResult.error;

    const { error: attachErr } = await supabase.rpc('append_renewal_audit_pack_entry', {
      p_record_id: renewalId,
      p_file_json: {
        name: pendingFile.name,
        url: storageResult.data.path,
        size: pendingFile.size,
        uploadedAt: new Date().toISOString(),
      },
    });
    if (attachErr) throw attachErr;

    toast.success('Summary imported');
    onImported?.();
    reset();
  } catch (err: any) {
    toast.error('Import failed: ' + err.message);
  } finally {
    setApplying(false);
  }
};
```

---

## Part G — Mapping: Extend summarySheetMapping.ts

**Option 1 (Simpler):** Create a new file `surveilanceSheetMapping.ts` with Surveillance 1–specific mappings, following the exact same structure as External Client's.

**Option 2 (Coupled):** Extend `summarySheetMapping.ts` with a conditional branch for Surveillance 1 (messier, but one file).

**Recommendation:** Option 1 — new file, cleaner separation.

**File:** `app/commonfiles/core/components/custom/Renewal_Client/surveilanceSheetMapping.ts`

Contains:
- `FIELD_MAPPINGS_SURV` — label → {extColumn?, summaryColumn?, kind}
- `WIDE_TABLE_MAPPINGS_SURV` — metadata columns only
- `SURV_STAGE_PROGRESSION` — column → status (13 statuses)
- Shared helpers: `parseFlexibleDate`, `formatIso`, `parseSummaryWorkbookRows` (reuse from External Client if possible, or duplicate)

---

## Part H — "New Surveillance 1 Form" Component (Optional for Sprint 7, or user-built)

**If you want the full auto-create workflow:**

Create `NewSurveilanceForm.tsx` (similar to `NewClientForm.tsx`):
1. Pick an external client from dropdown
2. Click "Create Surveillance 1 Record"
3. RPC: `create_renewal_client(p_external_client_id)` with empty p_email (no email override needed yet)
4. Redirect to the new renewal record
5. User then uploads intimation letter or summary sheet

**Status on creation:** `Intimation_Sent`? Or `Team_Assigned`? Confirm per your workflow.

---

## Summary Tab Component (You'll Build)

This sprint provides:
- SurveilanceImport.tsx ✅
- surveilanceSheetMapping.ts ✅
- upsert_renewal_from_summary RPC ✅
- append_renewal_audit_pack_entry RPC ✅

You wire this into a Summary tab similar to External Client's `ClientSummaryTab.tsx`.

**Expected structure:**
```tsx
export default function SurveilanceSummaryTab({ renewalId }: { renewalId: string }) {
  return (
    <div>
      <SurveilanceImport renewalId={renewalId} isCrmOrAdmin={isCrmOrAdmin} />
      {/* Display current summary data */}
      <SummaryDetails renewalId={renewalId} />
    </div>
  );
}
```

---

## Manual Steps (Post-Build, Pre-QA)

1. **Apply migration 265** (schema + field registration)
2. **Verify fields in Object Manager** — all 15 new fields should appear
3. **Add 15 fields to Page Layout** (Settings → Object Manager → Renewal Clients → Page Layout) — same step External Client requires
4. **Create a test renewal record** manually
5. **Upload test summary CSV** (wide table + vertical dates) via SurveilanceImport
6. **Verify:**
   - All metadata fields populated (including blanks)
   - Status advanced to furthest checkpoint
   - File attached to surv_audit_pack__a
   - Renewal record data matches input CSV

---

## Cross-Epic Checklist (Per Recertification Plan)

- [ ] `upsert_renewal_from_summary` body verified against live `update_tenant_record` behavior (avoid silent field drops)
- [ ] `finalize_file_upload` **NOT** extended — Surveillance 1's file uploads already handled correctly
- [ ] No changes to External Client code or migrations

---

## Outstanding Questions

1. **Status on renewal creation:** When `create_renewal_client` is called (with or without a summary), what should `status__a` be set to?
   - `Intimation_Sent`?
   - `Team_Assigned`?
   - Something else?

2. **Scope field:** Does renewal_clients__a already have a `scope__a` column (added in 221 but not registered in tenant.fields)? Or is it missing entirely?

3. **File attachment:** When SurveilanceImport uploads the summary sheet, should it:
   - Overwrite the entire `surv_audit_pack__a` (replace mode)?
   - Append to it (array of sheets)?
   - Match External Client's behavior exactly?

---

## Files to Create / Modify

| File | Type | Status |
|---|---|---|
| `supabase/migrations/271_surv_metadata_fields.sql` | Migration | ✅ Written, ✅ Applied |
| `app/commonfiles/core/components/custom/Renewal_Client/SurveilanceImport.tsx` | Component | ✅ Written (3 bugs fixed post-write — see §11) |
| `app/commonfiles/core/components/custom/Renewal_Client/surveilanceSheetMapping.ts` | Mapping | ✅ Written |
| `supabase/migrations/272_surv_summary_rpcs.sql` | Migration | ✅ Written, ✅ Applied |
| `app/commonfiles/core/components/custom/Renewal_Client/SurveilanceSummaryTab.tsx` | Component | ✅ Written — see §11 |

---

## Effort Estimate

- **Schema (271):** 1–2 hours (straightforward field additions)
- **Mapping (surveilanceSheetMapping.ts):** 1–2 hours (copy External Client's pattern, adapt labels)
- **SurveilanceImport.tsx:** 3–4 hours (copy StageDateImport, adapt field names)
- **RPCs (272):** 1–2 hours (straightforward update + file append)
- **Summary tab (§11):** 2–3 hours (copy ClientSummaryTab.tsx's structure)
- **Manual testing:** 1–2 hours
- **Total:** ~10–15 hours

---

## §11 — Summary Tab built + 3 bugs found and fixed (addendum, same session)

Follow-up to the user's question: "First check if you have already built this [a
Surveillance 1 Summary tab, like Client Summary] if not then we need to." Checked
first — confirmed not built (Sprint 7 above only added fields + an importer, no
separate tab component). Clarified the architecture via a direct question before
building, since New Client's `client_summary__a` is a genuinely **separate table**
(auto-created via `AFTER INSERT` trigger, own RPCs), which Surveillance 1 does not
have and was never planned to have.

**Confirmed choice: same table, new UI only.** Keep all fields on
`renewal_clients__a` (as Sprint 7 already built) — no new table, no trigger, no
new "get_all_renewal_summaries"-style RPC. `SurveilanceSummaryTab.tsx` is purely a
different-shaped *view* over the same data, mirroring `ClientSummaryTab.tsx`'s
list/detail structure and visual style.

**Built:** `SurveilanceSummaryTab.tsx` — `SummaryList` (searchable table, all
Surveillance 1 records) + `SummaryDetail` (single record, edit/save, Summary
Sheets file list with download) + a root component that switches between them
based on whether `recordId` is passed, exactly matching `ClientSummaryTab.tsx`'s
three-part shape. Company/contact/metadata fields are editable; all 13 workflow
checkpoint dates are shown but **read-only** (deliberately, unlike
`ClientSummaryTab.tsx`'s equivalent rows) — those dates are RPC-owned and tied to
`status__a`; letting them be hand-edited here risked silently desyncing status
from what the record's own action panel believes happened.

### Three real bugs found and fixed while wiring this up

Found by tracing the actual RPC signatures against what `SurveilanceImport.tsx`
was calling, rather than assuming the first draft was correct:

1. **`get_object_records_with_references` needs a UUID, not an object name.**
   `SurveilanceImport.tsx` was calling it with
   `p_object_id: 'renewal_clients__a'` (a string constant) — the RPC's real
   parameter is `p_object_id UUID`. This would have failed on every call with a
   Postgres type-cast error. Fixed by resolving the real object UUID once via
   `get_tenant_objects` (same pattern `NewRenewalForm.tsx` already uses
   correctly), stored in a `renewalObjectId` state var, reused by both
   `SurveilanceImport.tsx` and the new `SurveilanceSummaryTab.tsx`.

2. **`update_tenant_record`'s real signature is completely different from what
   was called.** Called as `(p_object_name, p_record_id, p_data)`; the actual,
   latest-defined (migration 231) signature is
   `(p_table_name, p_record_id, p_tenant_id, p_update_data)` — different
   parameter names *and* a required `p_tenant_id` that was missing entirely.
   PostgREST does strict named-parameter matching, so this would have failed
   every date-field update and every status advance inside `apply()`. Fixed
   both call sites.

3. **File-attachment shape used a `url` key that nothing downstream reads.**
   `append_renewal_audit_pack_entry`'s caller stored
   `{name, url: uploadData.path, size, uploadedAt}` — but every download
   button in this app (see `FileUploadField.tsx`, `ClientSummaryTab.tsx`'s
   `downloadAudit`) expects `{bucket, path}` and signs a fresh URL on demand;
   there is no persisted `url` anywhere else in the codebase. Fixed to store
   `{name, bucket, path, size, uploadedAt}`, matching the shape
   `SurveilanceSummaryTab.tsx`'s own `downloadAudit` (copied verbatim from
   `ClientSummaryTab.tsx`) expects.

None of these three had been exercised yet (no live test of `SurveilanceImport`'s
`apply()` had happened since Sprint 7 shipped) — caught by re-deriving each RPC's
actual signature from its migration file instead of trusting the original
first-draft call sites.

**Not yet done:** wiring `SurveilanceSummaryTab.tsx` into an actual tab
(user's explicit "I will create tab later") — same division of labor as
`SurveilanceImport.tsx`'s original handoff. `npx tsc --noEmit` not run this
session (no local Node/TS toolchain check performed) — recommend running it
before wiring the tab in, given three signature bugs were just found by
inspection alone.

---

## §12 — Mapping re-verified against the real sample sheet, 4 more bugs found and fixed (addendum, same session)

User asked directly: "have we made mapping correct for each of summary field? Do
you want to look at summary sheet again?" — good call. Re-checked every column
in the actual sample (`Surv 1 SUmmary.csv`, not just the rights-matrix labels
§11 and earlier sections were built against) line-by-line against
`surveilanceSheetMapping.ts`. Found and fixed four real problems.

### 1. `ADDRESS` was silently corrupting `company_name__a` — confirmed bug, not a judgment call

`'address'` was mapped to `extColumn: 'company_name__a'` — there was no address
column on `renewal_clients__a` at all, so importing a sheet with an ADDRESS
value would have overwritten the company name with the address text on every
import, silently. **Fixed:** new `address__a` column (migration 275), mapping
corrected.

### 2. Two distinct team-column sets in the sheet, only one was being read

The sheet has `Auditor Stg 1` / `Auditor Stg 2` / `Tech Reviewer` / `lead
auditor` (the client's **original certification** team — historical) **and
separately** `surv audit date` / `surv auditor` / `surv LA` / `surv Tech
reviewer` / `surv CDC` (**this surveillance visit's own** team). The mapping had
been pulling the historical Stage-1 columns into `auditor_name__a` /
`tech_reviewer_name__a` — the wrong source — and never read the `surv `-prefixed
columns at all. `surv CDC` had no field to hold it even if it had been read.

Confirmed via direct question, user's answer: **"Yes, use the surv_prefixed
columns and do not touch the other flows like new client etc."** — i.e. keep
this scoped to Surveillance 1's own mapping file only, consistent with the
standing "Do NOT edit new client flow" rule.

**Fixed:**
- `surv auditor` → `auditor_name__a`, `surv LA` → `lead_auditor__a`, `surv Tech
  reviewer` → `tech_reviewer_name__a` (source swapped)
- `Auditor Stg 1`/`Auditor Stg 2`/generic `Tech Reviewer`/generic `lead
  auditor` are no longer recognized by this file at all — not a silent no-op,
  genuinely absent from the dictionary, same treatment External Client gives
  its own restated wide-table columns (§9b there)
- `surv audit date` now maps to the existing (migration 221) TEXT column
  `surveillance_audit_date__a` — that column existed since the very first
  Renewal migration but nothing ever imported into it until now
- New column `cdc_name__a` (migration 275) + mapping from `surv CDC`

### 3. `total mandays` vs `Surveillance 1 mandays` — confirmed same figure

User confirmed: same value. Added `'total mandays'` as an additional label
pointing at the same `surv_mandays__a` column — no new field.

### 4. Three vertical-list labels didn't match the real sheet's actual text

| Sheet's real label | Old coded label | Effect before fix |
|---|---|---|
| `acceptance by client` | `intimation acceptance` | Row silently skipped every import |
| `assign team` | `team assigned` | Row silently skipped every import |
| `surv  ncr RCA acceptance` *(double space)* | `surv ncr rca acceptance` *(single space)* | Row silently skipped every import |

**Fixed:** the real observed labels are now the primary dictionary keys; the
old guessed labels are kept as additive aliases (same convention already used
elsewhere in this file for typo/relabel variants). Also added a
`normalizeLabel()` helper that collapses any run of whitespace to a single
space before every dictionary lookup, in both the wide-table and vertical
passes — cheap insurance against the *next* stray double-space typo, not just
this one.

### Migration 275 — `275_surv_address_cdc_name_fields.sql`

Two new columns only: `address__a`, `cdc_name__a`. Registered at
`display_order` 65/66, **not** 53/54 — Sprint 8's plan (§ suspension/withdrawal,
`00_Sprint_Plan.md`) already reserves 53–64 for its own 12 fields, and that
sprint hasn't shipped yet; used 65/66 to avoid a collision once it does.

### Also updated

- `SurveilanceSummaryTab.tsx`'s `ROWS` array — added Address and CDC Name rows
  (§11's list was written before these two fields existed).
- Both fixes are scoped entirely to Surveillance 1's own files
  (`surveilanceSheetMapping.ts`, `SurveilanceSummaryTab.tsx`, this new
  migration) — no External Client code or migrations touched, per the
  standing "Do NOT edit new client flow" constraint and this session's direct
  confirmation.

**Still not applied:** migration 275 has been written but not run — same
manual-deploy step every migration in this repo needs.

