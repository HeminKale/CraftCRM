# Custom Tab Creation

How to add a **Custom Tab (Custom Component)** in CraftCRM's "Create New Tab"
dialog, and — the step people forget — how to actually make the component it
points to load. This applies to any object (External Client, Renewal /
Surveillance 1, Recertification, or any future one).

---

## Code Architecture Overview

| Layer | File | Responsibility |
|---|---|---|
| UI — create/edit dialog | Object Manager → tab settings → "Create New Tab" | Collects Tab Name, Description, Tab Type, Custom Component Path, Custom Route, visibility |
| DB schema | `tenant.tabs` | Stores `tab_type = 'custom'` and `custom_component_path` (added in `supabase/migrations/030_enhance_tabs_schema.sql`) |
| Renderer | `app/commonfiles/core/components/Application/CustomTabRenderer.tsx` | Looks up the component by name and renders it |
| Actual components | `app/commonfiles/core/components/custom/**` | The React components themselves |

---

## How the "Custom Component Path" field actually works

`CustomTabRenderer.tsx` does **not** do a dynamic file-system import of the
path you type. It takes only the **last segment** of whatever you enter:

```ts
const componentName = componentPath.split('/').pop()?.trim();
const Component = componentRegistry[componentName];
```

`componentRegistry` is a hardcoded lookup object at the top of that file,
built from static imports:

```ts
import SurveilanceSummaryTab from '../custom/Renewal_Client/SurveilanceSummaryTab';
...
const componentRegistry: { [key: string]: React.ComponentType<any> } = {
  ...
  'SurveilanceSummaryTab': SurveilanceSummaryTab,
  ...
};
```

**This means: the component must already exist as a file AND be manually
registered here before any tab pointing to it will work.** If it isn't
registered, the tab shows a "Component '<name>' not found in registry" error
the moment someone opens it — the dialog itself will happily save a tab
pointing at a component that doesn't exist yet.

The full path you type in the dialog (e.g.
`/custom/Renewal_Client/SurveilanceSummaryTab`) only needs to end in the
correct registry key — the leading folders are cosmetic/for-humans, but use
the real file path for consistency with every existing entry.

---

## Steps to add a new custom tab component

1. **Build the component** under `app/commonfiles/core/components/custom/<Object>/YourComponent.tsx`.
   It receives these props automatically from `CustomTabRenderer`:
   `tabId, tabLabel, recordId, objectId, recordData, tenantId, selectedRecordIds, onSuccess, onCancel`.
   Most summary/detail tabs only need `recordId` (present when opened from a
   specific record) — see `SurveilanceSummaryTab.tsx` / `RecertificationSummaryTab.tsx`
   for the pattern (list mode when no `recordId`, detail mode when one is passed).

2. **Register it in `CustomTabRenderer.tsx`**:
   - Add a static import at the top.
   - Add a `'ComponentName': ComponentName` entry to `componentRegistry`.

3. **Run `npx tsc --noEmit`** to confirm the new import compiles clean.

4. **Create the tab** via Object Manager → the object → tabs → "Create New Tab":
   - **Tab Type:** `Custom Tab (Custom Component)`
   - **Custom Component Path:** `/custom/<Object>/YourComponent` (must end
     with the exact registry key from step 2)
   - **Custom Route:** any unique non-empty value, e.g. `/custom/your-tab-slug`
     — not matched against the registry, just needs to be distinct
   - **Tab is visible by default:** check unless you want it hidden until a
     Permission Set grants access

5. **Open the tab and confirm it renders** — if you see the registry error,
   step 2 was skipped or the name doesn't match exactly (case-sensitive).

---

## Known component paths (already registered)

| Object | Component | Path to type in the dialog |
|---|---|---|
| External Client | `ClientSummaryTab` | `/custom/External_Client/ClientSummaryTab` |
| External Client | `NewClientForm` | `/custom/External_Client/NewClientForm` |
| Renewal / Surveillance 1 | `NewRenewalForm` | `/custom/Renewal_Client/NewRenewalForm` |
| Renewal / Surveillance 1 | `SurveilanceSummaryTab` | `/custom/Renewal_Client/SurveilanceSummaryTab` |
| Recertification | `NewRecertificationForm` | `/custom/Recertification_Client/NewRecertificationForm` |
| Recertification | `RecertificationSummaryTab` | `/custom/Recertification_Client/RecertificationSummaryTab` |

*(Plus several generic/legacy ones not tied to a specific object:
`CertificateGeneratorTab`, `certificateSoftCopy`, `softCopyGeneratorExcel`,
`CustomButtonTab`, `ClientDraftGenerator`, `ClientSoftCopyGenerator`,
`ClientPrintableGenerator`, `CertificateQRGenerator`, `YourCustomComponent`.)*

---

## Real incident this doc exists because of

`SurveilanceSummaryTab.tsx` was built in Surveillance 1 Sprint 7 but never
added to `componentRegistry` — an easy step to miss since the component
compiles and works standalone, and the dialog itself gives no warning that
the path won't resolve. Caught only when the tab was actually created and
threw the registry error. Fixed by registering it (see
`Sprint_7.md` / `Sprint_8.md` for the Surveillance 1 build history this
belongs to). `RecertificationSummaryTab.tsx` did **not** repeat this mistake
— it was registered in the same commit it was built.
