# 🚀 Complete Setup Instructions

## Phase 1: Firebase & Google Cloud Setup

### 1.1 Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Name: "Calendar Scrapper" (or your choice)
4. Enable Google Analytics (optional)
5. Create project

### 1.2 Enable Firestore

1. In Firebase Console, go to "Firestore Database"
2. Click "Create database"
3. Start in **production mode**
4. Choose location: `asia-south1` (Mumbai)
5. Click "Enable"

### 1.3 Set Firestore Security Rules

Go to Firestore → Rules and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Schedule data - readable by all authenticated users
    match /schedule/{document} {
      allow read: if request.auth != null && 
                     request.auth.token.email.matches('.*@iimranchi.ac.in$');
      allow write: if request.auth != null && 
                      request.auth.token.email == 'saptarshi.dasi21@iimranchi.ac.in';
    }
    
    // User data - users can only read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && 
                           request.auth.uid == userId &&
                           request.auth.token.email.matches('.*@iimranchi.ac.in$');
    }
  }
}
```

### 1.4 Enable Google Authentication

1. Go to Firebase Console → Authentication
2. Click "Get started"
3. Click "Google" sign-in method
4. Enable it
5. Add authorized domains: `localhost`, your deployment domain
6. Save

### 1.5 Get Firebase Config

1. Go to Project Settings (gear icon)
2. Scroll to "Your apps"
3. Click web icon (`</>`)
4. Register app name: "Calendar Scrapper Web"
5. Copy the Firebase configuration object

## Phase 2: Google Cloud Console Setup

### 2.1 Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Go to "APIs & Services" → "Library"
4. Enable these APIs:
   - **Google Sheets API**
   - **Google Calendar API**
   - **Google Identity**

### 2.2 Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client ID"
3. Configure consent screen if prompted:
   - User Type: **Internal**
   - App name: "Calendar Scrapper"
   - User support email: your email
   - Authorized domains: `iimranchi.ac.in`
4. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: "Calendar Scrapper Web Client"
   - Authorized JavaScript origins:
     - `http://localhost:5173`
     - Your deployment URL (e.g., `https://your-app.vercel.app`)
   - Authorized redirect URIs:
     - `http://localhost:5173`
     - Your deployment URL
5. Click "Create"
6. **Copy Client ID** - you'll need this

### 2.3 Create API Key

1. Click "Create Credentials" → "API key"
2. Copy the API key
3. Click "Edit API key"
4. Application restrictions: **None** (or set HTTP referrers for production)
5. API restrictions: 
   - Restrict key → Select:
     - Google Sheets API
     - Google Calendar API
6. Save

## Phase 3: Local Development Setup

### 3.1 Clone & Install

```bash
cd "/Users/saptarshi/Desktop/Coding Projects/Calendar Scrapper/Calendar-Scrapper"
npm install
```

### 3.2 Create Environment File

Create `.env.local` and add:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=<your-firebase-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<your-project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<your-project-id>
VITE_FIREBASE_STORAGE_BUCKET=<your-project-id>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=<your-sender-id>
VITE_FIREBASE_APP_ID=<your-app-id>

# Google API Configuration
VITE_GOOGLE_CLIENT_ID=<your-oauth-client-id>.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=<your-google-api-key>

# Google Sheets Configuration
VITE_SCHEDULE_SHEET_ID=1glNcxkwh4XspG3sz3UYAsFGnLP_54rlvNBkjtcl9SGM
VITE_SCHEDULE_SHEET_GID=0

# Domain Restriction
VITE_ALLOWED_DOMAIN=@iimranchi.ac.in
```

### 3.3 Test Locally

```bash
npm run dev
```

Open http://localhost:5173

## Phase 4: Deploy to Production

### Option A: Vercel (Recommended)

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   vercel --prod
   ```

4. **Add Environment Variables**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add all variables from `.env.local`

5. **Add OAuth Redirect**
   - Copy your Vercel URL (e.g., `https://calendar-scrapper.vercel.app`)
   - Add to Google Cloud Console → OAuth 2.0 Authorized redirect URIs
   - Add to Firebase Console → Authentication → Authorized domains

### Option B: Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Choose your project
# Public directory: dist
# Single-page app: Yes
# GitHub deploys: No

npm run build
firebase deploy --only hosting
```

## Phase 5: Set Up Cloud Functions (Daily Sync)

### 5.1 Create Service Account

1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Create Service Account:
   - Name: "calendar-scrapper-sync"
   - Role: "Firebase Admin"
3. Create Key → JSON
4. Download the JSON file

### 5.2 Initialize Functions

```bash
cd functions-template
npm init -y
npm install firebase-admin firebase-functions googleapis axios
```

### 5.3 Deploy Function

```bash
# Set up gcloud CLI
gcloud init

# Deploy function
gcloud functions deploy dailyScheduleSync \
  --runtime nodejs20 \
  --trigger-topic daily-sync \
  --entry-point scheduledSync \
  --region asia-south1 \
  --set-env-vars GOOGLE_APPLICATION_CREDENTIALS=service-account.json

# Create Cloud Scheduler job
gcloud scheduler jobs create pubsub daily-schedule-sync \
  --schedule="0 23 * * *" \
  --time-zone="Asia/Kolkata" \
  --topic=daily-sync \
  --message-body='{"action":"sync"}'
```

## Phase 6: Testing & Verification

### 6.1 Test Admin Access

1. Login with `saptarshi.dasi21@iimranchi.ac.in`
2. Verify "Admin" badge appears
3. Select courses → Preview → Confirm
4. Check Firestore for:
   - `schedule/courses` document
   - `schedule/events` document
   - `users/{userId}` document

### 6.2 Test Regular User

1. Login with a different `@iimranchi.ac.in` account
2. Verify courses are loaded from Firestore
3. Select courses → Preview → Confirm
4. Check Google Calendar for events

### 6.3 Test Daily Sync

```bash
# Trigger manually
gcloud scheduler jobs run daily-schedule-sync

# Check logs
gcloud functions logs read dailyScheduleSync --limit=50
```

## Security Checklist

- [ ] Firestore security rules are set correctly
- [ ] OAuth restricted to `@iimranchi.ac.in` domain
- [ ] API keys restricted to your domains
- [ ] Service account has minimal permissions
- [ ] Environment variables not committed to Git
- [ ] `.env.local` in `.gitignore`

## Troubleshooting

### "Permission Denied" in Firestore
- Check Firestore security rules
- Verify email domain matches

### "OAuth Error: redirect_uri_mismatch  "
- Add your URL to Google Cloud Console → OAuth authorized redirects
- Add to Firebase Console → Authorized domains

### Calendar Events Not Syncing
- Check Cloud Function logs
- Verify Google Calendar API is enabled
- Check user refresh token in Firestore

### Admin Can't Scrape Sheet
- Verify email is exactly `saptarshi.dasi21@iimranchi.ac.in`
- Check Google Sheets API is enabled
- Verify sheet ID is correct

## Next Steps

1. Monitor the first week of automated syncs
2. Add error notifications (email/Slack)
3. Create admin dashboard for monitoring
4. Implement better cancellation detection with Sheets API

## Support

For issues, check:
1. Firebase Console → Functions → Logs
2. Browser Console → Network tab
3. Firestore → Recent activity

---

**Created by**: Saptarshi Das  
**Version**: 1.0  
**Last Updated**: 2026-01-09
