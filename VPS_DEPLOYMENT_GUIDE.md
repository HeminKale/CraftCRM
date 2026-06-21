# CraftCRM — VPS Deployment Guide

## Prerequisites

- Hostinger VPS (or any Ubuntu 22.04 VPS) with root SSH access
- Supabase project (database + storage)
- Domain name (optional but recommended for SSL)
- GitHub repository: `https://github.com/HeminKale/CraftCRM.git`

---

## 1. Environment Variables

Create `.env.production` (copy from `env.example` and fill in real values):

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # Required for invitation flow

# App URL (used for invitation links)
NEXT_PUBLIC_APP_URL=https://your-domain.com

# NextAuth (generate a random secret: openssl rand -base64 32)
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your_nextauth_secret

# PDF Service
PDF_SERVICE_URL=http://localhost:8000

# Environment
NODE_ENV=production
PORT=3000
```

> **SUPABASE_SERVICE_ROLE_KEY is critical** — without it, the invitation accept flow (`/api/auth/accept-invitation`) will fail silently.

---

## 2. Supabase Setup

### Run all migrations in order

Open Supabase SQL editor and run each file from `supabase/migrations/` in numerical order:

```
001_core_schema_rls.sql
002_helper_functions_triggers.sql
...
215_auto_set_client_user_id.sql
216_quotation_upload_trigger.sql
```

> If a migration fails with `ERROR: 42P13: cannot change return type`, run `DROP FUNCTION IF EXISTS public.function_name(args);` first, then re-run the migration.

### Create Supabase Storage bucket

1. Go to Supabase Dashboard → Storage → New Bucket
2. Name: `tenant-uploads`
3. Set to **Private** (no public access)
4. Add an RLS policy to allow authenticated users to upload/read their own tenant's files

### Supabase Auth settings

- Enable **Email** provider
- Set **Site URL** to your domain: `https://your-domain.com`
- Add **Redirect URLs**: `https://your-domain.com/auth/callback`
- Adjust **Rate limits** under Auth → Rate Limits if needed (default is 3 sign-ups/hour per IP)

---

## 3. VPS Installation

### Step 1: Prepare the server

```bash
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install dependencies
apt install -y curl wget git nginx certbot python3-certbot-nginx

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Python 3.9 (for PDF service)
apt-get install -y python3.9 python3.9-pip python3.9-venv

# Install PM2
npm install -g pm2
```

### Step 2: Clone the repository

```bash
mkdir -p /var/www/craft-app
cd /var/www/craft-app
git clone https://github.com/HeminKale/CraftCRM.git .
```

### Step 3: Configure environment

```bash
cp env.example .env.production
nano .env.production
# Fill in all values from section 1 above
```

### Step 4: Install dependencies and build

```bash
# Install all Node dependencies (includes signature_pad, xlsx, etc.)
npm install

# Build the Next.js app
npm run build

# Set up Python PDF service
cd services/pdf-service
python3.9 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ../..
```

### Step 5: Process management with PM2

```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'craft-app',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/craft-app',
      env_file: '/var/www/craft-app/.env.production',
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
      env: { PORT: 8000 }
    }
  ]
};
EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Step 6: Nginx configuration

```bash
cat > /etc/nginx/sites-available/craft-app << 'EOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Increase body size for file uploads (application forms, signatures)
    client_max_body_size 50M;

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
        proxy_read_timeout 120s;
    }

    location /api/pdf/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
EOF

ln -sf /etc/nginx/sites-available/craft-app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### Step 7: SSL certificate

```bash
certbot --nginx -d your-domain.com -d www.your-domain.com
# Follow prompts — certbot will auto-configure Nginx for HTTPS
certbot renew --dry-run  # Test auto-renewal
```

---

## 4. Firewall

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
ufw status
```

---

## 5. Updating the app

After pushing changes to GitHub:

```bash
./update-vps.sh
# OR manually:
ssh root@YOUR_VPS_IP
cd /var/www/craft-app
git pull origin main
npm install          # in case new packages were added (e.g. signature_pad)
npm run build
pm2 restart craft-app
```

---

## 6. Key packages installed by `npm install`

These are automatically installed — no manual steps needed:

| Package | Purpose |
|---|---|
| `@supabase/supabase-js` | Database + auth + storage client |
| `@supabase/auth-helpers-nextjs` | Next.js auth helpers |
| `signature_pad` | Digital signature canvas (client agreement signing) |
| `xlsx` | Excel file parsing (New Client form extraction) |
| `jszip` | ZIP file handling |
| `react-hook-form` | Form state management |
| `react-hot-toast` | Toast notifications |
| `lucide-react` | Icons |
| `react-dnd` | Drag-and-drop (page layout editor) |

---

## 7. Monitoring and logs

```bash
# Check running processes
pm2 status

# View live logs
pm2 logs craft-app
pm2 logs pdf-service

# Restart individual services
pm2 restart craft-app
pm2 restart pdf-service

# Nginx logs
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log

# System resources
htop
df -h   # disk space
```

---

## 8. Troubleshooting

### App won't start
```bash
pm2 logs craft-app --lines 50
# Most common cause: missing .env.production or wrong SUPABASE_SERVICE_ROLE_KEY
```

### File uploads failing
- Confirm `tenant-uploads` bucket exists in Supabase Storage
- Confirm bucket is set to **Private**
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in `.env.production`

### Invitation links not working
- Confirm `NEXT_PUBLIC_APP_URL` matches your actual domain
- Confirm Supabase Redirect URLs include `https://your-domain.com/auth/callback`

### Signature pad not rendering
- Run `npm install` again — `signature_pad` must be present in `node_modules`
- Check browser console for `signature_pad` import errors

### Database errors after deployment
- Run any new migrations from `supabase/migrations/` that haven't been applied yet
- Check migration numbers — they're sequential; gaps indicate unapplied migrations

### Port already in use
```bash
sudo lsof -i :3000
sudo kill -9 <PID>
pm2 restart craft-app
```

---

## 9. Backup

```bash
# Run the included backup script
chmod +x backup-vps.sh
./backup-vps.sh

# Or manual backup
ssh root@YOUR_VPS_IP "tar -czf /tmp/craft-backup-$(date +%Y%m%d).tar.gz /var/www/craft-app --exclude node_modules --exclude .next"
scp root@YOUR_VPS_IP:/tmp/craft-backup-*.tar.gz ./backups/
```

---

## 10. Post-deployment checklist

- [ ] All migrations run in Supabase (001 through 216)
- [ ] `tenant-uploads` storage bucket created and set to private
- [ ] `.env.production` filled with real Supabase credentials
- [ ] `NEXT_PUBLIC_APP_URL` set to actual domain
- [ ] Supabase Auth Site URL and Redirect URLs updated to production domain
- [ ] SSL certificate installed
- [ ] Firewall configured
- [ ] PM2 processes running (`pm2 status`)
- [ ] Test sign-up flow works
- [ ] Test invitation flow works (copy link from UI, open in browser)
- [ ] Test file upload on External Client record
- [ ] Test digital signature on agreement
