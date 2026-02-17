# ⚡ Quick Start Guide

**Get your Calendar Scraper running in 15 minutes!**

## Prerequisites Check

Before starting, make sure you have:
- [ ] Google account with `@iimranchi.ac.in` email
- [ ] Node.js installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] Git installed (`git --version`)

## Step 1: Firebase Setup (5 minutes)

1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Enter name: "Calendar-Scrapper"
4. Click through the setup (disable Analytics if you want)
5. Once created, click the web icon `</>` to add a web app
6. Copy the `firebaseConfig` object

## Step 2: Enable Services (3 minutes)

### In Firebase Console:
1. Click "Authentication" → "Get Started"  
2. Enable "Google" sign-in provider
3. Click "Firestore Database" → "Create database"
4. Choose "Start in production mode"
5. Select location: `asia-south1`

### In Google Cloud Console:
1. Go to https://console.cloud.google.com/
2. Select your Firebase project from dropdown
3. Go to "APIs & Services" → "Library"
4. Search and enable:
   - ✅ Google Sheets API
   - ✅ Google Calendar API

## Step 3: Get Credentials (5 minutes)

### OAuth Client ID:
1. Go to "APIs & Services" → "Credentials"  
2. Click "Create Credentials" → "OAuth 2.0 Client ID"
3. Configure consent screen (if needed):
   - User Type: **Internal**
   - App name: "Calendar Scraper"
   - Add `iimranchi.ac.in` to authorized domains
4. Create OAuth Client:
   - Type: **Web application**
   - Authorized JavaScript origins: `http://localhost:5173`
   - Authorized redirect URIs: `http://localhost:5173`
5. **Copy the Client ID**

### API Key:
1. Click "Create Credentials" → "API key"
2. **Copy the API key**
3. (Optional) Restrict it to Google Sheets API + Google Calendar API

## Step 4: Configure Your App (2 minutes)

1. Open your project folder
2. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

3. Edit `.env.local` and fill in:
   ```env
   # From firebaseConfig:
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abc123

   # From Google Cloud:
   VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=AIza...

   # Sheet info (already set):
   VITE_SCHEDULE_SHEET_ID=1jis4IowMXM72jJUlz3Yanv2YBu7ilcvU
   VITE_SCHEDULE_SHEET_GID=752189081

   # Domain (already set):
   VITE_ALLOWED_DOMAIN=@iimranchi.ac.in
   ```

## Step 5: Run the App! 🚀

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser!

## First-Time User Flow

### If you're the admin (saptarshi.dasi21@iimranchi.ac.in):

1. Click "Sign in with Google"
2. Select your IIM Ranchi account
3. You'll see "Admin" badge appear
4. The app will scrape the Google Sheet (takes ~10 seconds)
5. Select your enrolled courses
6. Click "Continue to Sync"
7. Review the calendar preview
8. Click "Confirm & Add to Calendar"
9. ✅ Done! Your calendar is synced

### If you're a regular user:

1. Click "Sign in with Google"
2. Select your IIM Ranchi account  
3. Courses load from Firestore (instant!)
4. Select your enrolled courses
5. Click "Continue to Sync"
6. Review the calendar preview
7. Click "Confirm & Add to Calendar"
8. ✅ Done! Your calendar is synced

## Troubleshooting

### "Only @iimranchi.ac.in accounts are allowed"
- Make sure you're logging in with your school email
- Check VITE_ALLOWED_DOMAIN in .env.local

### "Failed to load courses"
- Verify Google Sheets API is enabled
- Check the sheet ID in .env.local
- Make sure the sheet is public or accessible to your domain

### "OAuth error: redirect_uri_mismatch"
- Add `http://localhost:5173` to authorized JavaScript origins in Google Cloud Console
- Also add it to authorized redirect URIs

### "Permission denied" in Firestore
- Check Firestore security rules (see SETUP_GUIDE.md)
- Verify you're logging in with @iimranchi.ac.in email

### Nothing happens after clicking "Confirm"
- Open browser console (F12) to see errors
- Check if Google Calendar API is enabled
- Verify you granted calendar permissions

## What's Next?

Once it works locally:

1. **Set up Firestore security rules** → See SETUP_GUIDE.md
2. **Deploy to production** → Vercel (frontend) + Google Cloud Functions (backend)  
3. **Set up daily automation** → See CLOUD_FUNCTIONS_SETUP.md

## Need Help?

1. Check the full setup guide: `SETUP_GUIDE.md`
2. Review the project summary: `PROJECT_SUMMARY.md`
3. Look at the cloud functions guide: `CLOUD_FUNCTIONS_SETUP.md`
4. Check browser console for errors (F12)
5. Check Firebase Console → Functions → Logs

---

**Happy Scheduling! 📅**
