import { useState, useEffect } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged, type User as FirebaseUser, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import LoginPage from './components/LoginPage';
import CourseSelector from './components/CourseSelector';
import CalendarPreview from './components/CalendarPreview';
import Dashboard from './components/Dashboard';
import { AdminSettings } from './components/AdminSettings';
import type { Course, User, ScheduleEvent } from './types';
import { SheetScraperService } from './services/sheetScraper';
import { GoogleCalendarService } from './services/googleCalendar';
import { FirestoreService } from './services/firestore';
import './index.css';
import './App.css';

type AppState = 'loading' | 'login' | 'select-courses' | 'preview' | 'dashboard';

function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [previewEvents, setPreviewEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Check if user is from allowed domain
        const allowedDomain = import.meta.env.VITE_ALLOWED_DOMAIN;
        if (!firebaseUser.email?.endsWith(allowedDomain)) {
          await signOut(auth);
          setError(`Only ${allowedDomain} accounts are allowed`);
          setAppState('login');
          return;
        }

        const userData: User = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        };
        setUser(userData);
        setIsAdmin(FirestoreService.isAdmin(firebaseUser.email || ''));

        // Check for access token from OAuth callback
        const storedToken = sessionStorage.getItem('google_access_token');
        if (storedToken) {
          setGoogleAccessToken(storedToken);
          await GoogleCalendarService.initializeGAPI();
          GoogleCalendarService.setAccessToken(storedToken);
        }

        // Check if user has existing selection
        const userSelection = await FirestoreService.getUserCourseSelection(firebaseUser.uid);

        if (userSelection && userSelection.selectedCourses.length > 0) {
          // User has already set up, go to dashboard
          setSelectedCourses(userSelection.selectedCourses);

          // Check sync subscription status
          const isSubscribed = await FirestoreService.isUserSubscribed(firebaseUser.uid);
          setSyncEnabled(isSubscribed);

          // Check if user has connected their Google Calendar
          const hasCalendarConnected = await FirestoreService.hasUserConnectedCalendar(firebaseUser.uid);
          setCalendarConnected(hasCalendarConnected);

          await loadDashboardData(userSelection.selectedCourses);
        } else {
          // New user, load courses for selection
          // Note: On auth state change, we don't have the access token yet
          // User will need to provide it via login button or we'll use CSV fallback
          await loadCourses(firebaseUser);
        }
      } else {
        setUser(null);
        setAppState('login');
      }
    });

    return () => unsubscribe();
  }, []);

  const loadCourses = async (firebaseUser: FirebaseUser, accessToken?: string) => {
    try {
      setLoading(true);

      // First try to load from Firestore (works for both admin and regular users)
      const firestoreCourses = await FirestoreService.getCourses();

      if (firestoreCourses.length > 0) {
        // Data exists in Firestore, use it
        setCourses(firestoreCourses);
      } else if (FirestoreService.isAdmin(firebaseUser.email || '')) {
        // Firestore is empty and user is admin - do initial scrape from frontend
        // NOTE: This frontend scraper CANNOT detect cancelled classes (strikethrough/red)
        // Admin should run "Sync Now" from Settings after login for full detection
        console.warn('⚠️ Initial scrape from frontend - cancelled classes will NOT be detected. Use Settings > Sync Now for full detection.');

        const rawData = await SheetScraperService.fetchSheetData(accessToken || googleAccessToken || undefined);
        const extractedCourses = SheetScraperService.extractCourses(rawData);
        const allEvents = SheetScraperService.parseScheduleEvents(
          rawData,
          extractedCourses.map(c => c.code)
        );

        // Store in Firestore
        await FirestoreService.storeScheduleData(extractedCourses, allEvents);
        setCourses(extractedCourses);
      } else {
        // Regular user, no data in Firestore - show error
        throw new Error('No schedule data available. Please ask admin to sync first.');
      }

      setAppState('select-courses');
    } catch (err: any) {
      console.error('Error loading courses:', err);
      setError(err.message || 'Failed to load courses from schedule');
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async (courseCodes: string[]) => {
    try {
      setLoading(true);

      // Load events for selected courses from Firestore
      const events = await FirestoreService.getScheduleEventsForCourses(courseCodes);
      setScheduleEvents(events);
      setAppState('dashboard');
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load schedule data');
      setAppState('select-courses');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if this should be an admin OAuth flow
      // We'll check if the user wants to enable auto-sync (admin feature)
      // For now, we'll use the standard Firebase popup for all users
      // Admin can use the "Authorize for Auto-Sync" button in settings

      const result = await signInWithPopup(auth, googleProvider);

      // Get the Google OAuth access token from credentials
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;

      if (accessToken) {
        setGoogleAccessToken(accessToken);
        sessionStorage.setItem('google_access_token', accessToken);

        // Initialize Google Calendar API with the access token
        await GoogleCalendarService.initializeGAPI();
        GoogleCalendarService.setAccessToken(accessToken);

        // For regular login, we don't have a refresh token (Firebase doesn't provide it)
        // Admin will need to use "Authorize for Auto-Sync" to get a proper refresh token
        if (result.user && FirestoreService.isAdmin(result.user.email || '')) {
          console.log('ℹ️ Admin logged in. For auto-sync to work, use "Authorize for Auto-Sync" in Settings.');
        }
      } else {
        throw new Error('Failed to get Google access token. Please try again.');
      }

    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAppState('login');
      setSelectedCourses([]);
      setScheduleEvents([]);
      setPreviewEvents([]);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleCourseSelectionContinue = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!user) return;

      // Get events for selected courses from Firestore
      const events = await FirestoreService.getScheduleEventsForCourses(selectedCourses);
      setPreviewEvents(events);

      // Move to preview
      setAppState('preview');

    } catch (err: any) {
      console.error('Error loading preview:', err);
      setError(err.message || 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewConfirm = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!user) return;

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;

      if (!googleAccessToken) {
        throw new Error('No access token available. Please log in again.');
      }

      // Initialize Google Calendar API
      await GoogleCalendarService.initializeGAPI();
      GoogleCalendarService.setAccessToken(googleAccessToken);

      // Get or create the dedicated classes calendar
      const calendarId = await GoogleCalendarService.getOrCreateClassesCalendar();
      console.log('Using calendar:', calendarId);

      // Filter out cancelled events - we don't want them in the calendar
      const activeEvents = previewEvents.filter(e => !e.isCancelled);
      console.log(`Syncing ${activeEvents.length} active events (${previewEvents.length - activeEvents.length} cancelled events excluded)`);

      // Sync to Google Calendar (using dedicated calendar)
      const syncStats = await GoogleCalendarService.syncEvents(activeEvents, calendarId);
      console.log('Initial sync completed:', syncStats);

      // Save user preferences to Firestore (including calendar ID)
      await FirestoreService.saveUserCourseSelection(
        user.uid,
        user.email,
        selectedCourses,
        calendarId
      );

      // Mark as synced with calendar event IDs
      const calendarEventIds: Record<string, string> = {};
      activeEvents.forEach(event => {
        if (event.calendarEventId) {
          calendarEventIds[event.id] = event.calendarEventId;
        }
      });
      await FirestoreService.markUserAsSynced(user.uid, calendarEventIds);

      // Store ALL events (including cancelled) for Dashboard to display
      setScheduleEvents(previewEvents);
      setAppState('dashboard');

    } catch (err: any) {
      console.error('Sync error:', err);
      setError(err.message || 'Failed to sync calendar');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewCancel = () => {
    setAppState('select-courses');
    setPreviewEvents([]);
  };

  const handleResync = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!user) return;

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;

      // If admin, re-scrape and update Firestore
      if (isAdmin) {
        const rawData = await SheetScraperService.fetchSheetData(googleAccessToken || undefined);
        const extractedCourses = SheetScraperService.extractCourses(rawData);
        const allEvents = SheetScraperService.parseScheduleEvents(
          rawData,
          extractedCourses.map(c => c.code)
        );

        await FirestoreService.storeScheduleData(extractedCourses, allEvents);
      }

      // Reload events from Firestore
      const events = await FirestoreService.getScheduleEventsForCourses(selectedCourses);

      // Store ALL events for Dashboard (Dashboard will separate active/cancelled)
      setScheduleEvents(events);

      // Filter out cancelled events - we don't want them in the calendar
      const activeEvents = events.filter(e => !e.isCancelled);

      // Re-sync to calendar
      if (googleAccessToken) {
        await GoogleCalendarService.initializeGAPI();
        GoogleCalendarService.setAccessToken(googleAccessToken);

        // Get or create the dedicated classes calendar
        const calendarId = await GoogleCalendarService.getOrCreateClassesCalendar();

        const syncStats = await GoogleCalendarService.syncEvents(activeEvents, calendarId);
        console.log('Re-sync completed:', syncStats);
        console.log(`${syncStats.deleted} cancelled events removed from calendar`);
      } else {
        throw new Error('No access token available. Please log in again.');
      }

    } catch (err: any) {
      console.error('Re-sync error:', err);
      setError(err.message || 'Failed to re-sync calendar');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSync = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      if (syncEnabled) {
        // Unsubscribe
        await FirestoreService.unsubscribeFromSync(user.uid);
        setSyncEnabled(false);
        console.log('User unsubscribed from auto-sync');
      } else {
        // Resubscribe
        await FirestoreService.resubscribeToSync(user.uid);
        setSyncEnabled(true);
        console.log('User resubscribed to auto-sync');
      }
    } catch (err: any) {
      console.error('Error toggling sync:', err);
      setError(err.message || 'Failed to update sync preferences');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCalendar = async () => {
    try {
      setConnectingCalendar(true);
      setError(null);

      // Import the OAuth service
      const { GoogleOAuthService } = await import('./services/googleOAuth');

      // Start the OAuth flow - this will redirect to Google
      // After authorization, user will be redirected back to /oauth/callback
      // The callback handler will save the tokens and redirect back here
      await GoogleOAuthService.startOAuthFlow();

      // Note: The page will redirect, so we won't reach this point
      // The success state will be set after the callback
    } catch (err: any) {
      console.error('Error connecting calendar:', err);
      setError(err.message || 'Failed to connect Google Calendar');
      setConnectingCalendar(false);
    }
  };

  if (appState === 'loading') {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (appState === 'login') {
    return (
      <>
        <LoginPage onLogin={handleLogin} loading={loading} />
        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}
      </>
    );
  }

  if (appState === 'select-courses') {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <div>
              <h1 className="header-title">Calendar Scrapper</h1>
              {isAdmin && (
                <span className="admin-badge badge badge-warning">Admin</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {isAdmin && (
                <button className="btn btn-secondary" onClick={() => setShowSettings(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  ⚙️ Settings
                </button>
              )}
              <button className="btn btn-secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="app-main">
          <CourseSelector
            courses={courses}
            selectedCourses={selectedCourses}
            onSelectionChange={setSelectedCourses}
            onContinue={handleCourseSelectionContinue}
            loading={loading}
          />
        </main>

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        {showSettings && isAdmin && (
          <AdminSettings onClose={() => setShowSettings(false)} />
        )}


      </div>
    );
  }

  if (appState === 'preview') {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <h1 className="header-title">Calendar Scrapper</h1>
            <button className="btn btn-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <main className="app-main">
          <CalendarPreview
            events={previewEvents}
            onConfirm={handlePreviewConfirm}
            onCancel={handlePreviewCancel}
            loading={loading}
          />
        </main>

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}


      </div>
    );
  }

  if (appState === 'dashboard') {
    return (
      <>
        <Dashboard
          user={user!}
          selectedCourses={selectedCourses}
          scheduleEvents={scheduleEvents}
          onLogout={handleLogout}
          onResync={handleResync}
          onEditCourses={() => setAppState('select-courses')}
          onOpenSettings={() => setShowSettings(true)}
          onToggleSync={handleToggleSync}
          onConnectCalendar={handleConnectCalendar}
          loading={loading}
          isAdmin={isAdmin}
          syncEnabled={syncEnabled}
          calendarConnected={calendarConnected}
          connectingCalendar={connectingCalendar}
        />

        {showSettings && isAdmin && (
          <AdminSettings onClose={() => setShowSettings(false)} />
        )}
      </>
    );
  }

  return null;
}

export default App;
