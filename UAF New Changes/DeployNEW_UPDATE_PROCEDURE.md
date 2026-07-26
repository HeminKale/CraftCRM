# VPS Update Procedure

## Overview
This document outlines the procedure for updating the Craft CRM application on the VPS with the latest changes from the GitHub repository.

## Prerequisites
- SSH access to the VPS
- Git repository access
- PM2 process manager running

## Update Commands

### 1. Connect to VPS
```bash
ssh root@157.173.222.165
```

### 2. Navigate to Application Directory
```bash
cd /var/www/craft-app
```
**Purpose**: Navigate to the main application directory on the VPS where the Craft CRM application is deployed.

### 3. Pull Latest Changes
```bash
git pull origin main
```
**Purpose**: Download and merge the latest changes from the main branch of the GitHub repository.

**What it does**:
- Fetches new commits from GitHub
- Merges them into the local VPS code
- Updates application files with latest changes

**Expected Output**:
```
remote: Enumerating objects: 24, done.
remote: Counting objects: 100% (24/24), done.
remote: Compressing objects: 100% (3/3), done.
remote: Total 13 (delta 8), reused 12 (delta 8), pack-reused 0 (from 0)
Unpacking objects: 100% (13/13), 3.79 KiB | 204.00 KiB/s, done.
From https://github.com/HeminKale/CraftCRM
 * branch            main       -> FETCH_HEAD
   9e79320..4064b97  main       -> origin/main
Updating 9e79320..4064b97
Fast-forward
 app/api/pdf/generate-softcopy/route.ts            |  3 ++-
 services/pdf-service/rise/generate_certificate.py | 68 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++------------
 services/pdf-service/rise/generate_softCopy.py    | 66 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++----------
 3 files changed, 114 insertions(+), 23 deletions(-)
```

### 4. Verify Deployment
```bash
git log --oneline -5
```
**Purpose**: Show the last 5 commits in a compact format to verify the deployment.

**Expected Output**:
```
4064b97 (HEAD -> main, origin/main, origin/HEAD) Merge pull request #4 from HeminKale/Version_1
d2f949f Language added
9e79320 Merge pull request #3 from HeminKale/Version_1
0436c67 Add missing lib directory with supabase.ts, utils.ts, and emailService.ts
caa5105 Merge pull request #2 from HeminKale/Version_1
```

npm run build

## Post-Deployment Steps

### 1. Restart Services (if needed)
```bash
# Restart PDF service to ensure changes take effect
pm2 restart pdf-service

# Restart Next.js application
pm2 restart craft-app

# Check service status
pm2 status
```

### 2. Test Endpoints
```bash
# Test health endpoint
curl http://localhost:8000/health

# Test softcopy generation
curl -X POST http://localhost:8000/generate-softcopy \
  -H "x-internal-token: 123" \
  -F "data={\"Company Name\":\"Test Company\",\"Address\":\"Test Address\",\"ISO Standard\":\"ISO 9001\",\"Scope\":\"Test Scope\",\"Certificate Number\":\"CERT-2024-001\"}" \
  --output /tmp/test_softcopy.pdf

# Check if file was generated
ls -la /tmp/test_softcopy.pdf
```

## What Gets Updated

### Files Typically Updated:
- `app/api/pdf/generate-softcopy/route.ts` - API route improvements
- `services/pdf-service/rise/generate_certificate.py` - Certificate generation logic
- `services/pdf-service/rise/generate_softCopy.py` - Soft copy generation logic
- `services/pdf-service/main.py` - Main PDF service application

### Common Updates Include:
- Bug fixes
- New features
- Language support additions
- Performance improvements
- Error handling enhancements

## Troubleshooting

### If git pull fails:
```bash
# Check git status
git status

# Check for conflicts
git diff

# If there are local changes, stash them
git stash

# Try pull again
git pull origin main
```

### If services don't restart:
```bash
# Check PM2 logs
pm2 logs pdf-service --lines 20
pm2 logs craft-app --lines 20

# Restart all services
pm2 restart all
```

### If endpoints fail:
```bash
# Check if services are running
pm2 status

# Check port usage
netstat -tlnp | grep :8000
netstat -tlnp | grep :3000
```

## Best Practices

1. **Always test locally** before deploying to VPS
2. **Check git status** before pulling to avoid conflicts
3. **Monitor logs** after deployment to ensure everything works
4. **Test critical endpoints** after each deployment
5. **Keep backups** of working versions before major updates

## Rollback Procedure

If deployment causes issues:

```bash
# Check previous commit
git log --oneline -10

# Rollback to previous commit
git reset --hard HEAD~1

# Restart services
pm2 restart all
```

## Notes

- The VPS automatically picks up most changes without restart
- PM2 manages the services and handles restarts
- Environment variables are preserved during updates
- Database migrations (if any) should be handled separately
