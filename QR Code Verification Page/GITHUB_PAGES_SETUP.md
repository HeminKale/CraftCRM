# GitHub Pages Setup for Certificate Verification Page

## Step 1: Create a New GitHub Repository

1. Go to [github.com](https://github.com)
2. Click the **+** icon (top right) → **New repository**
3. Fill in:
   - **Repository name**: `certificate-verification` (or your preferred name)
   - **Description**: "Certificate QR Code Verification Page"
   - **Visibility**: Public (required for GitHub Pages)
   - Leave other options as default
4. Click **Create repository**

## Step 2: Upload the Verification HTML File

### Option A: Web Upload (Easiest)

1. In your new repository, click **Add file** → **Upload files**
2. Drag and drop (or browse) `certificate_verification.html` from:
   ```
   C:\Users\hemin\OneDrive\Desktop\Craft 2_2\UAF New Changes\QR Code Verification Page\certificate_verification.html
   ```
3. In the "Commit message" field, type: `Add certificate verification page`
4. Click **Commit changes**

### Option B: Git Command Line

```bash
# Clone the repository (replace YOUR_USERNAME)
git clone https://github.com/YOUR_USERNAME/certificate-verification.git
cd certificate-verification

# Copy the HTML file
cp "C:\Users\hemin\OneDrive\Desktop\Craft 2_2\UAF New Changes\QR Code Verification Page\certificate_verification.html" .

# Commit and push
git add certificate_verification.html
git commit -m "Add certificate verification page"
git push origin main
```

## Step 3: Enable GitHub Pages

1. In your repository, go to **Settings** (top right)
2. In the left sidebar, click **Pages**
3. Under "Build and deployment":
   - **Source**: Select `Deploy from a branch`
   - **Branch**: Select `main` and folder `/root`
   - Click **Save**
4. Wait 1-2 minutes for GitHub to build your site
5. You'll see a green checkmark with your live URL:
   ```
   https://YOUR_USERNAME.github.io/certificate-verification/certificate_verification.html
   ```

## Step 4: Get Your Verification URL

Your GitHub Pages URL will be:
```
https://YOUR_USERNAME.github.io/certificate-verification/certificate_verification.html
```

**Example** (if your GitHub username is `heminkale`):
```
https://heminkale.github.io/certificate-verification/certificate_verification.html
```

## Step 5: Update the Component

Update the placeholder in `CertificateQRGenerator.tsx`:

```tsx
// Line 11 — BEFORE (placeholder):
const VERIFICATION_PAGE_BASE_URL = 'https://YOUR_USERNAME.github.io/YOUR_REPO/certificate_verification.html';

// AFTER (your actual URL):
const VERIFICATION_PAGE_BASE_URL = 'https://heminkale.github.io/certificate-verification/certificate_verification.html';
```

Replace `heminkale` and `certificate-verification` with your actual username and repo name.

## Step 6: Test the QR Code

1. Start your Craft app locally
2. Open the **Certificate QR Generator** tab
3. Fill in sample data and click **Generate QR Code**
4. Scan the QR code with your phone (or use a QR scanner)
5. Verify that it opens your GitHub Pages verification page correctly

---

## Troubleshooting

### "404 Not Found" when scanning QR code
- ✅ Check the URL in `VERIFICATION_PAGE_BASE_URL` matches your actual repo
- ✅ Verify GitHub Pages is enabled in Settings → Pages
- ✅ Wait 2-3 minutes after enabling Pages (GitHub needs time to build)

### "Page works but no data shows"
- ✅ The URL should have query parameters like `?cert=AMER402307&company=...`
- ✅ Check your browser console (F12) for JavaScript errors
- ✅ Verify the QR code is encoding correctly (check the generated URL before scanning)

### GitHub Pages not showing green checkmark
- ✅ Check Settings → Pages → Source is set to `Deploy from a branch`
- ✅ Make sure branch is `main` (not `master`)
- ✅ Folder should be `/root` (not `/docs`)

---

## File Structure on GitHub

After setup, your repository should look like:
```
certificate-verification/
├── certificate_verification.html
├── README.md (optional)
└── .gitignore (optional)
```

That's it! Your QR codes will now link to a live verification page. 🎉
