# Troubleshooting: 401 Unauthorized & CORS Errors

## Current Status
- ✅ Updated code to use Google OAuth access tokens instead of Firebase ID tokens
- ✅ Configured Vite dev server with proper CORS headers
- 🔄 Need to verify Google Cloud Console configuration
- 🔄 Need to make the Google Sheet accessible

## Issue Analysis

### Issue 1: CORS Errors
The Cross-Origin-Opener-Policy errors are happening because Google OAuth requires specific browser policies. I've updated the Vite configuration to fix this.

### Issue 2: 401 Unauthorized on Sheet Access
The sheet is private and requires either:
1. **Option A**: OAuth with proper scopes (what we're doing)
2. **Option B**: Make the sheet publicly readable

## Step-by-Step Fix

### Step 1: Make the Google Sheet Accessible ⚠️ IMPORTANT

Your Google Sheet needs to be made **publicly readable** OR you need to grant access to the service.

**Option A - Quick Fix (Recommended for testing):**
1. Open your sheet: https://docs.google.com/spreadsheets/d/1glNcxkwh4XspG3sz3UYAsFGnLP_54rlvNBkjtcl9SGM/edit
2. Click the **Share** button (top right)
3. Change to **"Anyone with the link"** can **view**
4. Click **Done**

This will allow the CSV export fallback to work immediately without OAuth.

**Option B - OAuth with Sheets API (More secure, but complex):**
Keep the sheet private and rely on OAuth. But this requires that:
- The user logging in has access to the sheet in their Google account
- OR the sheet is in a shared drive accessible to `@iimranchi.ac.in` users

### Step 2: Verify Google Cloud Console Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Navigate to **APIs & Services** → **Credentials**
4. Find your OAuth 2.0 Client ID and verify:

**Authorized JavaScript origins should include:**
```
http://localhost:5173
```

**Authorized redirect URIs should include:**
```
http://localhost:5173
http://localhost:5173/__/auth/handler
```

### Step 3: Test Again

1. **Clear your browser cache completely** or use **Incognito/Private mode**
2. Navigate to `http://localhost:5173`
3. Click **Sign in with Google**
4. **Grant all permissions** when prompted, including:
   - View and manage your Google Calendar events
   - View your Google Sheets spreadsheets
5. Complete the login

### Step 4: Verify Access Token

Open browser console and check if there are still 401 errors. If you still see them:

1. Check the **Network tab** in DevTools
2. Find the failed request to Google Sheets
3. Look at the **Headers** section
4. Verify that `Authorization: Bearer <token>` is present

## Expected Behavior

After the fixes:
1. ✅ No CORS errors in console
2. ✅ Successful Google login
3. ✅ Access token successfully retrieved
4. ✅ Courses loaded from the sheet
5. ✅ Course selector appears

## Fallback: Using Public CSV Export

If OAuth continues to have issues, the app is designed to fall back to the public CSV export method. But this requires the sheet to be publicly accessible (Step 1, Option A).

The code in `sheetScraper.ts` line 37-40:
```typescript
// Fallback to public CSV export
const response = await axios.get(getPublicCSVURL());
const csvData = response.data;
return this.parseCSV(csvData);
```

## Common Issues

### "Failed to get Google access token"
- **Cause**: OAuth flow didn't complete successfully
- **Fix**: Check Google Cloud Console OAuth configuration (Step 2)

### "401 Unauthorized" on Sheet Access
- **Cause**: Sheet is private and OAuth scope not granted
- **Fix**: Make sheet public (Step 1, Option A) OR ensure logged-in user has access

### CORS Errors Persist
- **Cause**: Browser cache or configuration issue
- **Fix**: 
  1. Clear all browser data
  2. Use Incognito mode
  3. Try a different browser
  4. Verify Vite config was applied (restart dev server)

## Next Steps

1. **Immediately**: Make the Google Sheet public for testing (Step 1, Option A)
2. **Then**: Clear cache and test in Incognito mode
3. **If still failing**: Share the new console errors with me

## Technical Details

The key changes made:
- `App.tsx`: Now extracts OAuth access token using `GoogleAuthProvider.credentialFromResult()`
- `vite.config.ts`: Added CORS headers to allow OAuth popup flow
- All API calls now use the OAuth access token instead of Firebase ID token

---

**Current Status**: Server restarted with new configuration. Ready for testing after making sheet public.
