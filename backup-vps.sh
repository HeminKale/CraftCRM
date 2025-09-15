#!/bin/bash

# Craft App VPS Backup Script
# This script creates a backup of your current VPS content before deployment

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
BACKUP_PATH="/var/backups/craft-app-$(date +%Y%m%d-%H%M%S)"

echo -e "${BLUE}💾 Starting VPS Backup...${NC}"

# Check if VPS_HOST is set
if [ -z "$VPS_HOST" ]; then
    echo -e "${RED}❌ Error: Please set VPS_HOST variable in the script${NC}"
    echo "Edit this script and add your VPS IP address to VPS_HOST variable"
    exit 1
fi

echo -e "${BLUE}📋 Backup Configuration:${NC}"
echo "VPS Host: $VPS_HOST"
echo "VPS User: $VPS_USER"
echo "Backup Path: $BACKUP_PATH"
echo ""

echo -e "${BLUE}💾 Creating backup of current VPS content...${NC}"

# Create backup on VPS
ssh $VPS_USER@$VPS_HOST << EOF
# Create backup directory
mkdir -p $BACKUP_PATH

# Backup current web content
if [ -d "/var/www" ]; then
    echo "Backing up /var/www..."
    cp -r /var/www $BACKUP_PATH/
fi

# Backup Nginx configuration
if [ -d "/etc/nginx" ]; then
    echo "Backing up Nginx configuration..."
    cp -r /etc/nginx $BACKUP_PATH/
fi

# Backup PM2 configuration
if [ -d "/root/.pm2" ]; then
    echo "Backing up PM2 configuration..."
    cp -r /root/.pm2 $BACKUP_PATH/
fi

# Create backup info file
cat > $BACKUP_PATH/backup_info.txt << 'BACKUPEOF'
Craft App VPS Backup
Created: $(date)
Contents:
- /var/www (web files)
- /etc/nginx (nginx config)
- /root/.pm2 (PM2 config)

To restore this backup:
1. Stop services: pm2 delete all && systemctl stop nginx
2. Restore files: cp -r $BACKUP_PATH/var/www /var/ && cp -r $BACKUP_PATH/etc/nginx /etc/
3. Restart services: systemctl start nginx && pm2 resurrect
BACKUPEOF

echo "✅ Backup created at: $BACKUP_PATH"
echo "Backup size: \$(du -sh $BACKUP_PATH | cut -f1)"
EOF

echo -e "${GREEN}✅ Backup completed successfully!${NC}"
echo ""
echo -e "${YELLOW}📝 Backup Information:${NC}"
echo "Backup Location: $BACKUP_PATH"
echo "To restore later: Use the backup_info.txt file for instructions"
echo ""
echo -e "${BLUE}💡 Next Steps:${NC}"
echo "1. Your current VPS content is now backed up"
echo "2. You can safely run deploy-to-vps.sh"
echo "3. If needed, you can restore from the backup"
echo ""
echo -e "${GREEN}Your VPS is backed up and ready for deployment! 🚀${NC}"
