# 🚀 Craft App VPS Deployment - Ready to Deploy!

Your Craft App is now ready for VPS deployment from the **main** branch on GitHub.

## ✅ What's Ready

- ✅ **GitHub Repository**: `https://github.com/HeminKale/CraftCRM.git`
- ✅ **Default Branch**: `main` (contains all your Craft 2_1 code)
- ✅ **Deployment Scripts**: Configured for main branch
- ✅ **Environment Setup**: Production-ready configuration

## 🚀 Quick Deployment Steps

### Step 1: Configure VPS Details
Edit `inspect-vps.sh`, `backup-vps.sh`, and `deploy-to-vps.sh` and update:
```bash
VPS_HOST="YOUR_VPS_IP_ADDRESS"  # Replace with your Hostinger VPS IP
VPS_USER="root"                 # Your VPS username (usually 'root')
VPS_PATH="/var/www/craft-app"   # Installation path (can be changed)
```

### Step 2: Inspect Current VPS Content (Recommended)
```bash
# Make inspection script executable
chmod +x inspect-vps.sh

# Check what currently exists on your VPS
./inspect-vps.sh
```

### Step 3: Backup Existing Content (Recommended)
```bash
# Make backup script executable
chmod +x backup-vps.sh

# Create backup of existing VPS content
./backup-vps.sh
```

### Step 4: Run Deployment
```bash
# Make script executable
chmod +x deploy-to-vps.sh

# Run deployment (selective replacement - preserves important directories)
./deploy-to-vps.sh
```

## 📋 What the Deployment Does

### 🧹 Selective Cleanup Phase:
1. **Inspects** existing content (preserves nexus and other important directories)
2. **Stops** only craft-app and pdf-service PM2 processes (preserves others)
3. **Stops** Nginx service temporarily
4. **Deletes** only /var/www/craft-app directory
5. **Removes** only craft-app related files from /var/www/html/

### 🚀 Fresh Installation Phase:
6. **Clones** your repository from GitHub main branch
7. **Installs** Node.js 18, Python 3.9, PM2, Nginx
8. **Sets up** environment variables
9. **Installs** dependencies and builds the app
10. **Configures** PM2 for process management
11. **Sets up** Nginx reverse proxy
12. **Prepares** SSL certificate setup

## 🔧 Post-Deployment Configuration

After deployment, you'll need to:

1. **Update Environment Variables**:
   ```bash
   ssh root@YOUR_VPS_IP
   nano /var/www/craft-app/.env.production
   ```
   Add your actual:
   - Supabase URL and keys
   - NextAuth secret
   - Domain name

2. **Configure Domain**:
   ```bash
   # Update Nginx config with your domain
   nano /etc/nginx/sites-available/craft-app
   # Replace 'your-domain.com' with your actual domain
   ```

3. **Get SSL Certificate**:
   ```bash
   certbot --nginx -d your-domain.com -d www.your-domain.com
   ```

## 🔄 Future Updates

To update your VPS with new changes:

1. **Push changes to GitHub**:
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. **Update VPS**:
   ```bash
   ./update-vps.sh
   ```

## 📊 Monitoring

Check your application status:
```bash
# Check PM2 status
ssh root@YOUR_VPS_IP "pm2 status"

# View logs
ssh root@YOUR_VPS_IP "pm2 logs"

# Restart services
ssh root@YOUR_VPS_IP "pm2 restart all"
```

## 🆘 Troubleshooting

If you encounter issues:

1. **Check logs**: `pm2 logs`
2. **Verify services**: `pm2 status`
3. **Check Nginx**: `nginx -t && systemctl reload nginx`
4. **Review environment**: Check `.env.production` file

## 🎯 Ready to Deploy!

Your Craft App is now ready for VPS deployment. Just update the `VPS_HOST` variable in `deploy-to-vps.sh` with your Hostinger VPS IP address and run the script!

**Repository**: https://github.com/HeminKale/CraftCRM.git  
**Branch**: main  
**Status**: Ready for deployment! 🚀
