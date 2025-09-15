#!/bin/bash

# Craft App VPS Deployment Script
# This script will completely replace your Hostinger VPS content with Craft 2_1

set -e  # Exit on any error

echo "🚀 Starting Craft App VPS Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VPS_USER="root"  # Change this to your VPS username
VPS_HOST="157.173.222.165"      # Your Hostinger VPS IP
VPS_PATH="/var/www/craft-app"  # Change this to your desired path
GITHUB_REPO="https://github.com/HeminKale/CraftCRM.git"
BRANCH="main"

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo "VPS Host: $VPS_HOST"
echo "VPS User: $VPS_USER"
echo "VPS Path: $VPS_PATH"
echo "GitHub Repo: $GITHUB_REPO"
echo "Branch: $BRANCH"
echo ""

# Check if VPS_HOST is set
if [ -z "$VPS_HOST" ]; then
    echo -e "${RED}❌ Error: Please set VPS_HOST variable in the script${NC}"
    echo "Edit this script and add your VPS IP address to VPS_HOST variable"
    exit 1
fi

echo -e "${YELLOW}⚠️  WARNING: This will COMPLETELY REPLACE all content on your VPS!${NC}"
echo -e "${RED}This script will:${NC}"
echo "- Stop ALL PM2 processes (including nexus-app and pdf-service)"
echo "- Stop Nginx service"
echo "- Delete /var/www/craft-app directory"
echo "- Clear /var/www/html/ completely"
echo "- Remove /root/Nexus directory and all backups"
echo "- Install fresh Craft App from GitHub"
echo "- Set up clean environment with only Craft App"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 1
fi

echo -e "${BLUE}🧹 Step 1: Cleaning existing VPS content...${NC}"

# Stop all services and completely clean VPS
ssh $VPS_USER@$VPS_HOST << 'EOF'
echo "🧹 COMPLETE VPS CLEANUP - Removing all existing content..."

# Stop ALL PM2 processes
if command -v pm2 &> /dev/null; then
    echo "Current PM2 processes:"
    pm2 list 2>/dev/null || echo "No PM2 processes found"
    
    # Stop and delete ALL PM2 processes
    pm2 delete all 2>/dev/null || true
    pm2 kill 2>/dev/null || true
    echo "✅ Stopped and deleted ALL PM2 processes"
else
    echo "PM2 not found - skipping PM2 cleanup"
fi

# Stop Nginx
systemctl stop nginx 2>/dev/null || echo "Nginx not running or not installed"

# Remove ALL existing application directories
rm -rf /var/www/craft-app
rm -rf /var/www/html/*
rm -rf /root/Nexus
rm -rf /root/Nexus_backup_*
rm -f /root/start-nexus.sh
rm -f /root/test_certificate.pdf
rm -f /root/vps_generate_certificate.py

echo "✅ COMPLETE cleanup finished - all existing content removed"
EOF

echo -e "${GREEN}✅ VPS cleaned successfully${NC}"

echo -e "${BLUE}🚀 Step 2: Cloning repository on VPS...${NC}"

# Clone the repository on VPS
ssh $VPS_USER@$VPS_HOST "git clone -b $BRANCH $GITHUB_REPO $VPS_PATH"

echo -e "${GREEN}✅ Repository cloned successfully${NC}"

echo -e "${BLUE}🔧 Step 3: Setting up VPS environment...${NC}"

# Run setup commands on VPS
ssh $VPS_USER@$VPS_HOST << 'EOF'
cd /var/www/craft-app

# Update system packages
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Python 3.9 and pip
apt-get install -y python3.9 python3.9-pip python3.9-venv

# Install PM2 for process management
npm install -g pm2

# Install Git if not already installed
apt-get install -y git

# Create .env.production file
cat > .env.production << 'ENVEOF'
# Production Environment Variables
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your_nextauth_secret_here
PDF_SERVICE_URL=http://localhost:8000
NODE_ENV=production
ENVEOF

# Install project dependencies
npm install --production

# Build the Next.js application
npm run build

# Set up Python virtual environment for PDF service
cd services/pdf-service
python3.9 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate

# Go back to project root
cd /var/www/craft-app

# Set proper permissions
chown -R www-data:www-data /var/www/craft-app
chmod -R 755 /var/www/craft-app

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'PM2EOF'
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
PM2EOF

# Start applications with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ VPS setup completed"
EOF

echo -e "${GREEN}✅ VPS environment setup completed${NC}"

echo -e "${BLUE}🌐 Step 4: Setting up Nginx reverse proxy...${NC}"

# Configure Nginx
ssh $VPS_USER@$VPS_HOST << 'EOF'
# Install Nginx
apt-get install -y nginx

# Create Nginx configuration
cat > /etc/nginx/sites-available/craft-app << 'NGINXEOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;  # Replace with your domain

    # Main Next.js application
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

    # PDF service API
    location /api/pdf/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXEOF

# Enable the site
ln -sf /etc/nginx/sites-available/craft-app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
nginx -t && systemctl reload nginx

echo "✅ Nginx configured"
EOF

echo -e "${GREEN}✅ Nginx configuration completed${NC}"

echo -e "${BLUE}🔒 Step 5: Setting up SSL with Let's Encrypt...${NC}"

# Install Certbot and get SSL certificate
ssh $VPS_USER@$VPS_HOST << 'EOF'
# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
# certbot --nginx -d your-domain.com -d www.your-domain.com

echo "✅ SSL setup ready (run certbot manually with your domain)"
EOF

echo -e "${GREEN}🎉 COMPLETE REPLACEMENT DEPLOYMENT SUCCESSFUL!${NC}"
echo ""
echo -e "${YELLOW}📝 What was replaced:${NC}"
echo "✅ ALL existing PM2 processes stopped and removed"
echo "✅ ALL existing application directories deleted"
echo "✅ Nexus app and all backups completely removed"
echo "✅ Clean VPS with only Craft App running"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Edit .env.production with your actual environment variables"
echo "2. Update Nginx configuration with your domain name"
echo "3. Run: certbot --nginx -d your-domain.com -d www.your-domain.com"
echo "4. Check application status: pm2 status"
echo "5. View logs: pm2 logs"
echo "6. To update from GitHub: git pull origin main && pm2 restart all"
echo ""
echo -e "${GREEN}Your VPS now runs ONLY Craft App! 🚀${NC}"
