#!/bin/bash

# Craft App VPS Update Script
# This script updates your VPS with the latest changes from GitHub

set -e  # Exit on any error

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
BRANCH="main"

echo -e "${BLUE}🔄 Starting Craft App VPS Update...${NC}"

# Check if VPS_HOST is set
if [ -z "$VPS_HOST" ]; then
    echo -e "${RED}❌ Error: Please set VPS_HOST variable in the script${NC}"
    echo "Edit this script and add your VPS IP address to VPS_HOST variable"
    exit 1
fi

echo -e "${BLUE}📋 Update Configuration:${NC}"
echo "VPS Host: $VPS_HOST"
echo "VPS User: $VPS_USER"
echo "VPS Path: $VPS_PATH"
echo "Branch: $BRANCH"
echo ""

echo -e "${YELLOW}⚠️  This will update your VPS with the latest changes from GitHub${NC}"
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Update cancelled."
    exit 1
fi

echo -e "${BLUE}🔄 Step 1: Pulling latest changes from GitHub...${NC}"

# Pull latest changes from GitHub
ssh $VPS_USER@$VPS_HOST << EOF
cd $VPS_PATH

# Pull latest changes
git fetch origin
git reset --hard origin/$BRANCH

echo "✅ Latest changes pulled from GitHub"
EOF

echo -e "${GREEN}✅ Repository updated successfully${NC}"

echo -e "${BLUE}🔧 Step 2: Updating dependencies and rebuilding...${NC}"

# Update dependencies and rebuild
ssh $VPS_USER@$VPS_HOST << 'EOF'
cd /var/www/craft-app

# Update Node.js dependencies
npm install --production

# Rebuild the Next.js application
npm run build

# Update Python dependencies for PDF service
cd services/pdf-service
source venv/bin/activate
pip install -r requirements.txt
deactivate

# Go back to project root
cd /var/www/craft-app

# Set proper permissions
chown -R www-data:www-data /var/www/craft-app
chmod -R 755 /var/www/craft-app

echo "✅ Dependencies updated and application rebuilt"
EOF

echo -e "${GREEN}✅ Dependencies updated successfully${NC}"

echo -e "${BLUE}🔄 Step 3: Restarting services...${NC}"

# Restart PM2 processes
ssh $VPS_USER@$VPS_HOST << 'EOF'
cd /var/www/craft-app

# Restart all PM2 processes
pm2 restart all

# Save PM2 configuration
pm2 save

echo "✅ Services restarted"
EOF

echo -e "${GREEN}✅ Services restarted successfully${NC}"

echo -e "${GREEN}🎉 Update completed successfully!${NC}"
echo ""
echo -e "${YELLOW}📝 What was updated:${NC}"
echo "✅ Latest code from GitHub"
echo "✅ Node.js dependencies"
echo "✅ Python dependencies"
echo "✅ Application rebuilt"
echo "✅ Services restarted"
echo ""
echo -e "${BLUE}🔍 To check status:${NC}"
echo "ssh $VPS_USER@$VPS_HOST 'pm2 status'"
echo ""
echo -e "${BLUE}📋 To view logs:${NC}"
echo "ssh $VPS_USER@$VPS_HOST 'pm2 logs'"
echo ""
echo -e "${GREEN}Your Craft App is now updated! 🚀${NC}"
