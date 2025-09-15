#!/bin/bash

# Craft App VPS Inspection Script
# This script inspects your current VPS content before deployment

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

echo -e "${BLUE}🔍 Starting VPS Inspection...${NC}"

# Check if VPS_HOST is set
if [ -z "$VPS_HOST" ]; then
    echo -e "${RED}❌ Error: Please set VPS_HOST variable in the script${NC}"
    echo "Edit this script and add your VPS IP address to VPS_HOST variable"
    exit 1
fi

echo -e "${BLUE}📋 Inspection Configuration:${NC}"
echo "VPS Host: $VPS_HOST"
echo "VPS User: $VPS_USER"
echo ""

echo -e "${BLUE}🔍 Inspecting VPS content...${NC}"

# Inspect VPS content
ssh $VPS_USER@$VPS_HOST << 'EOF'
echo "==================== SYSTEM INFO ===================="
echo "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
echo "Uptime: $(uptime -p)"
echo "Disk Usage: $(df -h / | tail -1 | awk '{print $3 " used of " $2 " (" $5 " full)"}')"
echo ""

echo "==================== ROOT DIRECTORY ===================="
echo "Contents of / (root filesystem):"
ls -la /
echo ""

echo "==================== HOME DIRECTORY ===================="
echo "Contents of /root:"
ls -la /root/
echo ""

echo "==================== WEB DIRECTORIES ===================="
echo "Contents of /var/www (if exists):"
if [ -d "/var/www" ]; then
    ls -la /var/www/
    echo ""
    echo "Detailed structure of /var/www:"
    find /var/www -type d -maxdepth 3 2>/dev/null || echo "No subdirectories found"
else
    echo "/var/www does not exist"
fi
echo ""

echo "Contents of /var/www/html (if exists):"
if [ -d "/var/www/html" ]; then
    ls -la /var/www/html/
else
    echo "/var/www/html does not exist"
fi
echo ""

echo "==================== NEXUS DIRECTORY ===================="
echo "Checking for nexus directory in /root:"
if [ -d "/root/nexus" ]; then
    echo "✅ Found nexus directory in /root"
    ls -la /root/nexus/
    echo ""
    echo "Size of nexus directory:"
    du -sh /root/nexus/
else
    echo "❌ No nexus directory found in /root"
fi
echo ""

echo "Checking for nexus in other common locations:"
find / -name "nexus" -type d -maxdepth 3 2>/dev/null || echo "No other nexus directories found"
echo ""

echo "==================== RUNNING SERVICES ===================="
echo "PM2 processes (if PM2 is installed):"
if command -v pm2 &> /dev/null; then
    pm2 list 2>/dev/null || echo "No PM2 processes running"
else
    echo "PM2 not installed"
fi
echo ""

echo "Nginx status:"
if command -v nginx &> /dev/null; then
    systemctl status nginx --no-pager -l || echo "Nginx not running or error checking status"
else
    echo "Nginx not installed"
fi
echo ""

echo "Active services on port 80 and 443:"
netstat -tlnp | grep -E ':80|:443' || echo "No services on port 80/443"
echo ""

echo "==================== INSTALLED SOFTWARE ===================="
echo "Node.js version (if installed):"
node --version 2>/dev/null || echo "Node.js not installed"
echo ""

echo "Python versions:"
python3 --version 2>/dev/null || echo "Python3 not installed"
python --version 2>/dev/null || echo "Python not installed"
echo ""

echo "Docker (if installed):"
docker --version 2>/dev/null || echo "Docker not installed"
echo ""

echo "==================== NGINX CONFIGURATION ===================="
if [ -d "/etc/nginx" ]; then
    echo "Nginx sites enabled:"
    ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "No sites-enabled directory"
    echo ""
    echo "Nginx sites available:"
    ls -la /etc/nginx/sites-available/ 2>/dev/null || echo "No sites-available directory"
else
    echo "No Nginx configuration directory found"
fi
echo ""

echo "==================== PROCESS LIST ===================="
echo "Top processes by CPU usage:"
ps aux --sort=-%cpu | head -10
echo ""

echo "==================== SUMMARY ===================="
echo "✅ VPS inspection completed"
echo "Review the output above to understand your current VPS setup"
echo "Pay special attention to:"
echo "- Existing web directories (/var/www)"
echo "- Nexus directory location"
echo "- Running services"
echo "- Installed software"
EOF

echo -e "${GREEN}✅ VPS inspection completed!${NC}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Review the output above carefully"
echo "2. Note any important directories or services"
echo "3. If you found important content, run backup-vps.sh first"
echo "4. Then modify deploy-to-vps.sh if needed to preserve important directories"
echo ""
echo -e "${BLUE}💡 Important Notes:${NC}"
echo "- If nexus directory exists, it will NOT be touched by the deployment"
echo "- Only /var/www/craft-app and /var/www/html/* will be affected"
echo "- Your nexus application should remain safe"
echo ""
echo -e "${GREEN}Ready for next step! 🚀${NC}"
