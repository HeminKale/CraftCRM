# Craft App VPS Deployment Guide

This guide will help you completely replace your Hostinger VPS content with the Craft 2_1 project.

## Prerequisites

- Hostinger VPS with root access
- Your VPS IP address
- Domain name (optional but recommended)
- Supabase project credentials

## Quick Deployment (Recommended)

### Method 1: Automated Script

1. **Edit the deployment script:**
   ```bash
   # Open deploy-to-vps.sh and update these variables:
   VPS_USER="root"  # Your VPS username
   VPS_HOST="YOUR_VPS_IP"  # Your VPS IP address
   VPS_PATH="/var/www/craft-app"  # Desired installation path
   ```

2. **Make the script executable and run:**
   ```bash
   chmod +x deploy-to-vps.sh
   ./deploy-to-vps.sh
   ```

### Method 2: Docker Deployment

1. **Set up environment variables:**
   ```bash
   cp env.example .env.production
   # Edit .env.production with your actual values
   ```

2. **Deploy with Docker:**
   ```bash
   # Upload files to VPS
   scp -r . root@YOUR_VPS_IP:/var/www/craft-app/
   
   # SSH into VPS and run
   ssh root@YOUR_VPS_IP
   cd /var/www/craft-app
   docker-compose up -d
   ```

## Manual Step-by-Step Deployment

### Step 1: Prepare Your VPS

```bash
# Connect to your VPS
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y curl wget git nginx certbot python3-certbot-nginx

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Python 3.9
apt-get install -y python3.9 python3.9-pip python3.9-venv

# Install PM2 for process management
npm install -g pm2
```

### Step 2: Upload Your Project

```bash
# From your local machine
scp -r C:\Users\hemin\OneDrive\Desktop\Craft\ 2_1\* root@YOUR_VPS_IP:/var/www/craft-app/
```

### Step 3: Configure Environment

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP
cd /var/www/craft-app

# Create production environment file
nano .env.production
```

Add your environment variables:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your_nextauth_secret
PDF_SERVICE_URL=http://localhost:8000
NODE_ENV=production
```

### Step 4: Install Dependencies and Build

```bash
# Install Node.js dependencies
npm install --production

# Build the Next.js application
npm run build

# Set up Python PDF service
cd services/pdf-service
python3.9 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ../..
```

### Step 5: Configure Process Management

```bash
# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'craft-app',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/craft-app',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'pdf-service',
      script: 'main.py',
      cwd: '/var/www/craft-app/services/pdf-service',
      interpreter: '/var/www/craft-app/services/pdf-service/venv/bin/python',
      env: {
        PORT: 8000
      }
    }
  ]
};
EOF

# Start applications
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Step 6: Configure Nginx

```bash
# Create Nginx configuration
cat > /etc/nginx/sites-available/craft-app << 'EOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/pdf/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/craft-app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
nginx -t && systemctl reload nginx
```

### Step 7: Set up SSL (Optional but Recommended)

```bash
# Get SSL certificate
certbot --nginx -d your-domain.com -d www.your-domain.com

# Test auto-renewal
certbot renew --dry-run
```

## Post-Deployment Configuration

### 1. Database Setup

If you're using Supabase (recommended):
1. Create a new Supabase project
2. Run the migration files from `supabase/migrations/`
3. Update your environment variables

### 2. Domain Configuration

1. Point your domain to your VPS IP address
2. Update Nginx configuration with your domain
3. Get SSL certificate

### 3. Monitoring

```bash
# Check application status
pm2 status

# View logs
pm2 logs

# Restart applications
pm2 restart all

# Monitor system resources
htop
```

## Troubleshooting

### Common Issues

1. **Port already in use:**
   ```bash
   sudo lsof -i :3000
   sudo kill -9 PID
   ```

2. **Permission issues:**
   ```bash
   sudo chown -R www-data:www-data /var/www/craft-app
   sudo chmod -R 755 /var/www/craft-app
   ```

3. **Nginx configuration errors:**
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. **Application not starting:**
   ```bash
   pm2 logs craft-app
   pm2 logs pdf-service
   ```

### Log Locations

- Application logs: `pm2 logs`
- Nginx logs: `/var/log/nginx/error.log`
- System logs: `journalctl -u nginx`

## Security Considerations

1. **Firewall setup:**
   ```bash
   ufw allow 22
   ufw allow 80
   ufw allow 443
   ufw enable
   ```

2. **Regular updates:**
   ```bash
   apt update && apt upgrade -y
   npm update
   ```

3. **Backup strategy:**
   ```bash
   # Create backup script
   tar -czf craft-app-backup-$(date +%Y%m%d).tar.gz /var/www/craft-app
   ```

## Performance Optimization

1. **Enable Nginx caching**
2. **Set up CDN for static assets**
3. **Configure database connection pooling**
4. **Monitor and optimize memory usage**

## Support

If you encounter any issues:
1. Check the logs first
2. Verify all environment variables
3. Ensure all services are running
4. Check firewall and port configurations

Your Craft App should now be running on your VPS! 🚀
