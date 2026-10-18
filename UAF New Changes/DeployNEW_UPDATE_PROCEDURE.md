# VPS Update Procedure

## Overview
This document outlines the procedure for updating the Craft CRM application on the VPS with the latest changes from the GitHub repository.

## Prerequisites
- SSH access to the VPS
- Git repository access
- PM2 process manager running

## Inspection versus deployment

`ssh`, `cd`, `git status`, `git log`, and `git diff` inspect the checkout.
`git fetch origin main` downloads Git metadata without updating application files.
`git pull`, builds and restarts are deployment operations. A Git commit on disk
alone does not prove which compiled build is currently serving traffic.

Before an update, inspect `pm2 list` and `pm2 describe craft-app` (and the PDF
service) to confirm their actual script/cwd and names. Preserve untracked VPS
files such as `ecosystem.config.js` and `start-pdf-service.sh`; do not use
`git clean` or blindly overwrite them.

Record the currently deployed commit and preserve the matching build and PM2
configuration in a private backup before updating. For this branch, apply new
SQL migrations 291–298 in order before deploying the matching frontend, after
reviewing them and backing up the database. Source deployment does not apply SQL.

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
git fetch origin main
git diff --stat HEAD origin/main
# Review the fetched changes before running this deployment step:
git merge --ff-only origin/main
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
**Purpose**: Show source history. Confirm the running build and endpoints separately; Git history alone does not verify deployment.

**Expected Output**:
```
4064b97 (HEAD -> main, origin/main, origin/HEAD) Merge pull request #4 from HeminKale/Version_1
d2f949f Language added
9e79320 Merge pull request #3 from HeminKale/Version_1
0436c67 Add missing lib directory with supabase.ts, utils.ts, and emailService.ts
caa5105 Merge pull request #2 from HeminKale/Version_1
```

### 4.1. Install dependencies and build

```bash
npm ci --include=dev
npm run build
```

Run the build with no development server using the same `.next` directory.
Do not restart the production process unless the build succeeds. Arrange the
maintenance/release procedure before building into a directory used by a live
process; a successful build alone is not a zero-downtime deployment strategy.

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
git fetch origin main
git diff --stat HEAD origin/main
# Review the fetched changes before running this deployment step:
git merge --ff-only origin/main
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

Use the exact commit recorded before deployment, not `HEAD~1`: a pull can
advance multiple commits and a merge's parent is not necessarily the last
working deployment. Preserve all local/untracked service configuration.

After confirming the tracked tree is clean and the saved commit is correct,
restore the saved release/build and restart only the affected PM2 service.
If rebuilding from the saved source commit instead, the sequence is:

```bash
# Substitute the full, previously recorded working commit.
git switch --detach <previous-working-commit>
npm ci --include=dev
npm run build
# Run only after a successful build, using the actual confirmed process name.
pm2 restart craft-app
pm2 status
```

If PDF code/dependencies changed, restore its matching environment and restart
its specific process too. Verify HTTP endpoints and user flows after rollback.
Database changes require their own reviewed recovery plan; resetting source
files does not reverse migrations or data changes.

## Notes

- Whether changes go live depends on the actual PM2 start command/build. Do not assume automatic reload.
- PM2 manages the services and handles restarts
- Environment variables are preserved during updates
- Database migrations (if any) should be handled separately
# Sprint 12 local email handoff — 18 October 2026

Sprint 12 code is verified locally, not deployed. Keep sending disabled during migration/release preparation. Apply the previously supplied 291–298 (using current revised 298) before new **299_notification_outbox.sql**; no live SQL was applied by the assistant. Read [the complete migration list](New%20Help%20Doc/General/Manual_Migrations_291_298.md) and [Hostinger VPS/Resend runbook](New%20Help%20Doc/General/Sprint_12_VPS_Email_Runbook.md) before preparing the worker, signing secret, sender DNS and approved-recipient QA. The new route no longer supports arbitrary browser-supplied recipients/templates/attachment URLs. No suspension timers or old post-certificate chain are enabled. Sprint 13 requires separate go-ahead.
