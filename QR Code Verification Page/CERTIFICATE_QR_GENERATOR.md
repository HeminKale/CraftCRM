# Certificate QR Code Generator

The Certificate QR Generator is a React component that creates scannable QR codes encoding certificate verification information. When scanned, the QR code opens a GitHub Pages verification page displaying the certificate details in a professional format.

---

## Code Files

| File | Purpose |
|---|---|
| `app/commonfiles/core/components/custom/CertificateQRGenerator.tsx` | Main QR code generator — form input, QR generation, JPEG download |
| `app/commonfiles/core/components/Application/CustomTabRenderer.tsx` | Dynamic component loader — routes tab names to components (includes `CertificateQRGenerator` in registry) |
| `UAF New Changes/QR Code Verification Page/certificate_verification.html` | Hosted on GitHub Pages — displays certificate info when QR is scanned |

---

## How It Works

### Step 1 — Form Input

User fills in a 2-column form with 7 fields (2 required):

| Field | Required | Type | Example |
|---|---|---|---|
| Certificate Number | ✅ Yes | Text | `AMER402307` |
| Company Name | ✅ Yes | Text | `Siyaq Altanmiyah Company` |
| Certificate Standard | ❌ No | Text | `ISO 14001:2015` |
| Certification Body | ❌ No | Select | Americo / BQSR / AQSR |
| Issue Date | ❌ No | Date | `2026-08-03` |
| Expiry Date | ❌ No | Date | `2027-08-02` |
| Accreditation Body | ❌ No | Text | `UAF` |

```tsx
// From CertificateQRGenerator.tsx, form state:
interface FormState {
  certificateNumber: string;
  companyName: string;
  certificateStandard: string;
  issueDate: string;
  expiryDate: string;
  certificationBody: string;      // Picklist: Americo, BQSR, AQSR
  accreditationBody: string;
}
```

### Step 2 — URL Encoding

On **Generate QR Code**, all form fields are URL-encoded as query parameters:

```
Base URL:
https://heminkale.github.io/certificate-verification/certificate_verification.html

Generated URL (example):
https://heminkale.github.io/certificate-verification/certificate_verification.html
  ?cert=AMER402307
  &company=Siyaq Altanmiyah Company For Engineering Consultancy
  &standard=ISO 14001:2015
  &issue=2026-08-03
  &expiry=2027-08-02
  &body=Americo
  &accreditation=UAF
```

This allows the verification page to display the exact data without needing a backend database.

### Step 3 — QR Code Generation

The `qrcode` npm package renders the URL onto an HTML5 `<canvas>` element:

```tsx
// CertificateQRGenerator.tsx:80-92
await QRCode.toCanvas(canvasRef.current, url, {
  width: 400,
  margin: 2,
  errorCorrectionLevel: 'H',  // High error correction for reliable scanning
});
```

**Why high error correction?** QR codes can recover from damage/dirt. High level allows up to ~30% data recovery.

### Step 4 — JPEG Download

Before exporting to JPEG, the canvas background is flattened to white (QR codes have no transparency):

```tsx
// CertificateQRGenerator.tsx:93-98
const ctx = canvasRef.current.getContext('2d');
if (ctx) {
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
}
setQrDataUrl(canvasRef.current.toDataURL('image/jpeg', 0.95));
```

Then saved as JPEG via browser download:

```tsx
const a = document.createElement('a');
a.href = qrDataUrl;
a.download = `${form.certificateNumber || 'certificate'}-qr.jpg`;
document.body.appendChild(a);
a.click();
```

### Step 5 — Scanning & Verification

1. User scans QR code with phone camera
2. Phone opens the URL in browser
3. GitHub Pages loads `certificate_verification.html`
4. JavaScript reads URL parameters and displays them:

```html
<!-- certificate_verification.html reads ?cert, ?company, ?standard, etc. -->
<script>
  function getUrlParameter(name) { /* ... */ }
  function populateCertInfo() {
    const certInfo = {
      'Certificate Number': getUrlParameter('cert'),
      'Company Name': getUrlParameter('company'),
      'Certificate Standard': getUrlParameter('standard'),
      'Issue Date': getUrlParameter('issue'),
      'Expiry Date': getUrlParameter('expiry'),
      'Certification Body': getUrlParameter('body'),
      'Accreditation Body': getUrlParameter('accreditation'),
    };
    // Render certInfo to DOM
  }
</script>
```

---

## Access Control

The component itself has no permission checks — it is only rendered when the tab is visible to the user (visibility is controlled via `tabs`/`app_tabs` records and role-based visibility rules).

QR code generation happens client-side only (no backend calls). The verification page is a static HTML file hosted on GitHub Pages — anyone with the QR code URL can view the certificate info.

---

## Known Constraints

- **Base URL is a placeholder** — must be updated once the verification page is published to GitHub Pages (see `GITHUB_PAGES_SETUP.md`)
- **Certification Body is hardcoded picklist** — Americo, BQSR, AQSR. Adding new bodies requires code change
- **URL length limit** — QR codes can encode ~2953 bytes. Very long company/scope names could hit this limit (rare)
- **No authentication on verification page** — anyone with the URL can view certificate data (by design — QR codes are public)
- **Date format depends on browser** — `<input type="date">` submits ISO format (YYYY-MM-DD), but verification page also handles DD/MM/YYYY from legacy soft copies

---

## Setting Up as a Tab

### Database Setup

Create two records via Settings UI or SQL:

#### 1. Create `tabs` record:

```sql
INSERT INTO tabs (
  id,
  name,
  description,
  tab_type,
  custom_component_path,
  tenant_id,
  is_active,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'Certificate QR Generator',
  'Generate QR codes for certificate verification',
  'custom',
  'CertificateQRGenerator',  -- Must match component registry key
  'your-tenant-id',
  true,
  NOW(),
  NOW()
);
```

#### 2. Create `app_tabs` association:

```sql
INSERT INTO app_tabs (
  id,
  app_id,
  tab_id,
  tab_order,
  tenant_id,
  is_visible,
  is_active,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'your-app-id',           -- ID from apps table (e.g., Client App)
  'tab-id-from-above',     -- ID from tabs table
  3,                        -- Order position (adjust as needed)
  'your-tenant-id',
  true,
  true,
  NOW(),
  NOW()
);
```

### UI Setup

Alternatively, create from Settings → Home → Tab Settings:
1. Click **+ New Tab**
2. Fill in:
   - **Name**: "Certificate QR Generator"
   - **Type**: "custom"
   - **Component Path**: "CertificateQRGenerator"
3. Add to app and set visibility
4. Save

---

## Component Registration

The component is already registered in the code:

| File | Change |
|---|---|
| `CertificateQRGenerator.tsx` | Component definition (lines 1-273) |
| `CustomTabRenderer.tsx` | Import (line 18) + registry entry (line 75) |

No additional changes needed — just create the tab/app_tabs DB rows.

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `qrcode` | ^1.5.4 | QR code generation to canvas |
| `@types/qrcode` | ^1.5.6 | TypeScript types |
| `react-hot-toast` | ^2.5.2 | Toast notifications (success/error) |
| `lucide-react` | ^0.294.0 | Icons (QrCode, Download, RotateCcw) |

All already installed in `package.json`.

---

## Customization

### Changing Certification Body Options

Edit `CertificateQRGenerator.tsx` line 14:

```tsx
// BEFORE:
const CERTIFICATION_BODY_OPTIONS = ['Americo', 'BQSR', 'AQSR'] as const;

// AFTER (example):
const CERTIFICATION_BODY_OPTIONS = ['Americo', 'BQSR', 'AQSR', 'My Cert Body'] as const;
```

### Changing QR Code Size

Edit `CertificateQRGenerator.tsx` line 83:

```tsx
// BEFORE:
width: 400,

// AFTER (larger):
width: 600,
```

### Changing Verification Page Base URL

Edit `CertificateQRGenerator.tsx` line 12 (once GitHub Pages is live):

```tsx
// PLACEHOLDER:
const VERIFICATION_PAGE_BASE_URL = 'https://YOUR_USERNAME.github.io/YOUR_REPO/certificate_verification.html';

// ACTUAL (example):
const VERIFICATION_PAGE_BASE_URL = 'https://heminkale.github.io/certificate-verification/certificate_verification.html';
```

---

## Troubleshooting

### QR Code Not Generating
- Check browser console (F12) for errors
- Verify Certificate Number and Company Name are not empty
- Ensure `canvasRef` is properly attached to the DOM

### JPEG Download Fails
- Browser may block download if called outside user interaction
- Try using `handleDownload` callback instead of direct trigger
- Check browser's download permissions

### Verification Page Shows No Data
- Scan QR code and check the full URL in browser address bar
- Ensure all URL parameters are present (check for proper encoding)
- Verify `certificate_verification.html` is correctly deployed to GitHub Pages

### "Cannot read property 'getContext'" Error
- Canvas element may not be mounted yet
- Add null check before calling `getContext`

---

## Testing Checklist

- [ ] Form fills without errors
- [ ] "Generate QR Code" button works with required fields only
- [ ] QR code renders on canvas in preview area
- [ ] "Download JPEG" button downloads a `.jpg` file
- [ ] QR code is scannable with phone camera or QR app
- [ ] Scanned URL opens verification page with correct data
- [ ] All dates format correctly (e.g., "March 08, 2026")
- [ ] "Reset" clears form and preview
- [ ] Tab renders in app after `app_tabs` record is created
- [ ] Works on mobile (responsive 2-column → 1-column layout)

---

## Performance Notes

- **QR Generation**: ~50-100ms for typical data
- **Canvas Rendering**: Instant
- **JPEG Encoding**: ~20-50ms
- **GitHub Pages Load**: <1s (CDN cached)
- **File Size**: QR JPEG ~5-10 KB, verification page HTML ~8 KB

No database calls — all operations are client-side.

---

## Security Notes

- QR codes are **public** — anyone with the QR can scan it
- Verification page shows **only what's in the QR code** — no backend secrets
- No authentication required on verification page (by design)
- HTTPS used for GitHub Pages (encrypted in transit)
- No personal data beyond certificate metadata is stored

---

## Related Documentation

- [GITHUB_PAGES_SETUP.md](GITHUB_PAGES_SETUP.md) — Step-by-step GitHub Pages setup
- [../New Help Doc/new-client-form.md](../New Help Doc/new-client-form.md) — Similar component (NewClientForm)
- [CUSTOM_TABS_IMPLEMENTATION_GUIDE.md](../../Craft App - Copy/CUSTOM_TABS_IMPLEMENTATION_GUIDE.md) — Tab registration guide
