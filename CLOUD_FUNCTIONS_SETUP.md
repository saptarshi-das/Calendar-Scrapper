# ☁️ Cloud Functions Setup Guide

This guide will help you set up the daily automated sync for the Calendar Scrapper application.

## Overview

The cloud function runs daily at 11:00 PM IST to:
1. **Admin Account**: Scrapes the Google Sheet and updates Firestore
2. **All Users**: Syncs any changes to their Google Calendars

## Option 1: Google Cloud Functions (Recommended)

### Prerequisites
- Google Cloud Project
- Firebase project with Firestore enabled
- gcloud CLI installed

### Setup Steps

1. **Initialize Cloud Functions**
   ```bash
   cd Calendar-Scrapper
   mkdir functions
   cd functions
   npm init -y
   npm install firebase-admin firebase-functions googleapis axios
   ```

2. **Create the Cloud Function** (see `functions/index.ts` below)

3. **Deploy**
   ```bash
   gcloud functions deploy dailyScheduleSync \
     --runtime nodejs20 \
     --trigger-topic daily-sync \
     --entry-point scheduledSync \
     --region asia-south1
   ```

4. **Set up Cloud Scheduler**
   ```bash
   gcloud scheduler jobs create pubsub daily-schedule-sync \
     --schedule="0 23 * * *" \
     --time-zone="Asia/Kolkata" \
     --topic=daily-sync \
     --message-body='{"action":"sync"}'
   ```

## Option 2: Vercel Serverless Functions

### Setup Steps

1. **Create API Route**: `api/cron/daily-sync.ts`

2. **Add Vercel Cron Job** in `vercel.json`:
   ```json
   {
     "crons": [{
       "path": "/api/cron/daily-sync",
       "schedule": "0 23 * * *"
     }]
   }
   ```

3. **Deploy to Vercel**
   ```bash
   vercel --prod
   ```

## Option 3: GitHub Actions (Free)

Create `.github/workflows/daily-sync.yml`:

```yaml
name: Daily Schedule Sync
on:
  schedule:
    - cron: '30 17 * * *'  # 11:00 PM IST = 17:30 UTC
  workflow_dispatch:  # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm run sync
        env:
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
```

## Environment Variables

All options require these environment variables:

```env
# Firebase Admin SDK
FIREBASE_SERVICE_ACCOUNT=<base64-encoded-service-account-json>

# Google APIs
GOOGLE_API_KEY=<your-google-api-key>
GOOGLE_SHEETS_ID=1jis4IowMXM72jJUlz3Yanv2YBu7ilcvU

# Admin User
ADMIN_EMAIL=saptarshi.dasi21@iimranchi.ac.in
```

## Testing

Test the cloud function locally:

```bash
# Google Cloud Functions
npm run serve

# Then trigger manually
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"action":"sync"}'
```

## Monitoring

### Google Cloud Functions
```bash
gcloud functions logs read dailyScheduleSync --limit=50
```

### Check Firestore
Go to Firebase Console → Firestore → Check `schedule` collection for `lastUpdated` timestamp

## Troubleshooting

### Function Times Out
- Increase timeout: `--timeout=540s`
- Process users in batches

### Quota Exceeded
- Google Sheets API: 100 requests/100 seconds
- Google Calendar API: 1M requests/day
- Solution: Implement exponential backoff

### Authentication Errors
- Verify Firebase Admin SDK credentials
- Check service account permissions
- Ensure Google Calendar API is enabled

## Cost Estimate

### Google Cloud Functions
- Monthly executions: 30 (daily)
- Duration: ~30 seconds per run
- **Cost**: ~$0 (within free tier)

### Vercel
- Cron jobs: Free on Pro plan
- **Cost**: Included in Vercel Pro ($20/month)

### GitHub Actions
- **Cost**: Free for public repositories

---

**Recommendation**: Use Google Cloud Functions for best integration with Firebase/Firestore.
