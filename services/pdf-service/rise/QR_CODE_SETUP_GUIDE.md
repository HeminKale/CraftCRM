# QR Code Setup Guide - No Domain Required! 🚀

## 🎯 **What We've Created:**

1. **Complete HTML Verification Page** (`certificate_verification.html`)
2. **Updated QR Code Generation** (uses temporary working URL)
3. **Professional Design** (mobile-friendly, beautiful UI)

## 🆓 **Free Hosting Options (Choose One):**

### **Option 1: GitHub Pages (Recommended)**
1. **Create GitHub Account** (if you don't have one)
2. **Create New Repository** named `certificate-verification`
3. **Upload** `certificate_verification.html` to the repository
4. **Enable GitHub Pages** in repository settings
5. **Your URL will be**: `https://yourusername.github.io/certificate-verification/certificate_verification.html`

### **Option 2: Netlify (Easiest)**
1. **Go to** [netlify.com](https://netlify.com)
2. **Sign up** with GitHub (free)
3. **Drag and drop** `certificate_verification.html` to Netlify
4. **Get instant URL** like `https://random-name-123.netlify.app`

### **Option 3: HTML Preview (Immediate Testing)**
1. **Upload** `certificate_verification.html` to GitHub
2. **Use HTML Preview**: `https://htmlpreview.github.io/?https://github.com/yourusername/certificate-verification/blob/main/certificate_verification.html`

## 🔧 **How to Update Your QR Code URL:**

Once you have your hosted page, update this line in `generate_softCopy.py`:

```python
# Change this line:
base_url = "https://htmlpreview.github.io/"

# To your actual URL:
base_url = "https://yourusername.github.io/certificate-verification/certificate_verification.html"
```

## 📱 **How It Works:**

1. **User scans QR code** on your PDF
2. **Phone opens browser** with URL like:
   ```
   https://yoururl.com/?cert=CERT-001&company=ABC%20Company&standard=ISO%209001:2015&issue=2024-01-15&expiry=2027-01-15
   ```
3. **Page automatically reads** the URL parameters
4. **Displays professional** certificate information
5. **Works on all devices** (mobile, tablet, desktop)

## 🎨 **Features of Your Verification Page:**

- ✅ **Professional Design** with BQSR World branding
- ✅ **Mobile-First** responsive layout
- ✅ **Automatic Data Reading** from QR code
- ✅ **Beautiful UI** with gradients and shadows
- ✅ **Date Formatting** for better readability
- ✅ **Error Handling** for missing data
- ✅ **Professional Footer** with contact information

## 🧪 **Testing Your QR Code:**

1. **Generate a PDF** with your updated code
2. **Scan the QR code** with your phone
3. **Verify** that it opens the verification page
4. **Check** that all certificate data is displayed correctly

## 🚀 **Next Steps:**

1. **Choose a hosting option** (GitHub Pages recommended)
2. **Upload the HTML file**
3. **Update the base_url** in your Python code
4. **Test with a sample PDF**
5. **Enjoy professional QR code verification!**

## 💡 **Pro Tips:**

- **GitHub Pages** is completely free and reliable
- **Netlify** gives you a custom subdomain
- **HTML Preview** works immediately for testing
- **All options** are mobile-friendly and professional

## 🆘 **Need Help?**

If you run into any issues:
1. **Check the console** in your browser for errors
2. **Verify** the HTML file uploaded correctly
3. **Test** the URL directly in your browser
4. **Ensure** the QR code is generating the correct URL format

---

**You now have a complete, professional QR code verification system that works without needing your own domain!** 🎉
