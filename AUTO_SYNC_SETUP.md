# Auto-Sync Setup Guide

This guide explains how to set up the automatic daily calendar sync feature.

## Overview

The app now supports **automatic daily calendar sync** at 2 AM IST. This requires:

1. Admin to authorize with proper Google OAuth (to get refresh token)
2. The `dailyCalendarSync` Cloud Function deployed
3. Proper environment variables configured

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     AUTO-SYNC ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   2 AM IST                                                        │
│      │                                                            │
│      ▼                                                            │
│  ┌─────────────────┐    refresh_token    ┌──────────────────┐   │
│  │ Cloud Scheduler │ ─────────────────── │ dailyCalendarSync│   │
│  └─────────────────┘                     └────────┬─────────┘   │
│                                                   │              │
│                      ┌────────────────────────────┼──────────┐  │
│                      ▼                            ▼          ▼  │
│              ┌──────────────┐           ┌────────────────────┐  │
│              │ Google Sheets│           │ User's Calendar    │  │
│              │ (.xlsx file) │           │ (for each user)    │  │
│              └──────────────┘           └────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Configure Google Cloud OAuth

### 1.1 Add OAuth Redirect URI

Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and:

1. Click on your OAuth 2.0 Client ID
2. Under "Authorized redirect URIs", add:
   - `https://your-app-domain.vercel.app/oauth/callback`
   - `http://localhost:5173/oauth/callback` (for local testing)
3. Save the changes

### 1.2 Note Your Client Secret

Copy your **Client Secret** from the OAuth credentials page. You'll need it for the Cloud Functions.

## Step 2: Update Environment Variables

### 2.1 Frontend (.env.local)

Add/update these variables:

```bash
# Required for OAuth token exchange
VITE_GOOGLE_CLIENT_ID=your_client_id
VITE_GOOGLE_CLIENT_SECRET=your_client_secret

# Firebase project ID (already should exist)
VITE_FIREBASE_PROJECT_ID=your_project_id
```

### 2.2 Cloud Functions (functions/.env)

Add these variables to `functions/.env`:

```bash
# Google OAuth credentials for token refresh
VITE_GOOGLE_CLIENT_ID=your_client_id
VITE_GOOGLE_CLIENT_SECRET=your_client_secret
```

## Step 3: Deploy Cloud Functions

Deploy the updated Cloud Functions:

```bash
cd functions
firebase deploy --only functions
```

This will deploy:
- `manualSync` - Manual sync triggered from admin settings
- `exchangeOAuthCode` - OAuth token exchange for refresh tokens
- `dailyCalendarSync` - Scheduled daily sync at 2 AM IST

## Step 4: Admin Authorization

After deployment, the admin needs to authorize the app for auto-sync:

1. Log in to the app as admin
2. Go to **Settings** (gear icon)
3. Click **"🔑 Authorize"** under "Authorize Auto-Sync"
4. Complete the Google OAuth flow
5. You'll be redirected back to the app

This stores a **real refresh token** that the Cloud Function uses for daily sync.

## Step 5: Verify Setup

### Check Firestore

In Firebase Console → Firestore, check:

1. `config/adminUser` - Should have `oauthTokens.refreshToken`
2. `config/settings` - Should have `scheduleSheetId`

### Test Manual Sync

1. Go to Admin Settings
2. Click "Sync Now"
3. Should complete without errors

### Check Function Logs

After 2 AM IST (or next scheduled run):

```bash
firebase functions:log --only dailyCalendarSync
```

Look for:
- `🕐 Starting DAILY calendar sync`
- `✅ Access token refreshed successfully`
- `🎉 Daily sync complete!`

## Troubleshooting

### "No refresh token found"

**Cause**: Admin hasn't authorized with proper OAuth flow.

**Fix**: 
1. Go to Settings
2. Click "Authorize" button
3. Complete the OAuth flow with consent screen

### "Failed to refresh access token"

**Cause**: Google OAuth token expired or revoked.

**Fix**:
1. Go to https://myaccount.google.com/permissions
2. Remove access for the app
3. Re-authorize via Settings → Authorize

### "No redirect URI match"

**Cause**: OAuth redirect URI not configured properly.

**Fix**: Add `https://your-domain.com/oauth/callback` to Google Cloud Console OAuth redirect URIs.

### Function not running

**Cause**: Cloud Scheduler not enabled or function not deployed.

**Fix**:
```bash
# Enable Cloud Scheduler API
gcloud services enable cloudscheduler.googleapis.com

# Redeploy functions
firebase deploy --only functions
```

## Technical Details

### OAuth Flow

1. Admin clicks "Authorize" in Settings
2. App redirects to Google OAuth with `access_type=offline`
3. Google redirects back to `/oauth/callback` with auth code
4. Frontend calls `exchangeOAuthCode` Cloud Function
5. Cloud Function exchanges code for tokens (including refresh token)
6. Tokens stored in Firestore for `dailyCalendarSync` to use

### Token Storage

Tokens are stored in Firestore at `config/adminUser`:

```javascript
{
  userId: "admin_user_id",
  oauthTokens: {
    accessToken: "ya29...",       // Expires in 1 hour
    refreshToken: "1//0g...",     // Never expires (unless revoked)
    expiresAt: Timestamp
  }
}
```

### Daily Sync Process

1. **2:00 AM IST**: Cloud Scheduler triggers `dailyCalendarSync`
2. **Load config**: Read sheet ID and admin tokens from Firestore
3. **Refresh token**: Use refresh token to get new access token
4. **Fetch sheet**: Download .xlsx file from Google Drive
5. **Parse schedule**: Extract courses and events
6. **Update Firestore**: Store latest schedule data
7. **Sync calendars**: For each subscribed user, sync their calendar
8. **Log results**: Store sync log in `syncLogs` collection
