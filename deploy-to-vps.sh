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
VPS_HOST=""      # Add your VPS IP address here
VPS_PATH="/var/www/craft-app"  # Change this to your desired path
LOCAL_PATH="$(pwd)"

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo "VPS Host: $VPS_HOST"
echo "VPS User: $VPS_USER"
echo "VPS Path: $VPS_PATH"
echo "Local Path: $LOCAL_PATH"
echo ""

# Check if VPS_HOST is set
if [ -z "$VPS_HOST" ]; then
    echo -e "${RED}❌ Error: Please set VPS_HOST variable in the script${NC}"
    echo "Edit this script and add your VPS IP address to VPS_HOST variable"
    exit 1
fi

echo -e "${YELLOW}⚠️  WARNING: This will completely replace all content on your VPS!${NC}"
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 1
fi

echo -e "${BLUE}🔧 Step 1: Preparing local environment...${NC}"

# Create .env.production file
cat > .env.production << EOF
# Production Environment Variables
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your_nextauth_secret_here
PDF_SERVICE_URL=http://localhost:8000
NODE_ENV=production
EOF

echo -e "${GREEN}✅ Created .env.production file${NC}"

# Build the Next.js application
echo -e "${BLUE}🔨 Step 2: Building Next.js application...${NC}"
npm run build

echo -e "${GREEN}✅ Next.js build completed${NC}"

echo -e "${BLUE}🚀 Step 3: Uploading files to VPS...${NC}"

# Create the directory structure on VPS
ssh $VPS_USER@$VPS_HOST "mkdir -p $VPS_PATH && rm -rf $VPS_PATH/*"

# Upload all files except node_modules and .next
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude '.env.local' \
    --exclude 'tsconfig.tsbuildinfo' \
    $LOCAL_PATH/ $VPS_USER@$VPS_HOST:$VPS_PATH/

echo -e "${GREEN}✅ Files uploaded successfully${NC}"

echo -e "${BLUE}🔧 Step 4: Setting up VPS environment...${NC}"

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

# Install project dependencies
npm install --production

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

echo -e "${BLUE}🌐 Step 5: Setting up Nginx reverse proxy...${NC}"

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

echo -e "${BLUE}🔒 Step 6: Setting up SSL with Let's Encrypt...${NC}"

# Install Certbot and get SSL certificate
ssh $VPS_USER@$VPS_HOST << 'EOF'
# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
# certbot --nginx -d your-domain.com -d www.your-domain.com

echo "✅ SSL setup ready (run certbot manually with your domain)"
EOF

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Edit .env.production with your actual environment variables"
echo "2. Update Nginx configuration with your domain name"
echo "3. Run: certbot --nginx -d your-domain.com -d www.your-domain.com"
echo "4. Check application status: pm2 status"
echo "5. View logs: pm2 logs"
echo ""
echo -e "${GREEN}Your Craft App is now running on your VPS! 🚀${NC}"
