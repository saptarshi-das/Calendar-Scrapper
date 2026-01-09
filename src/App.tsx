import { useState, useEffect } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged, type User as FirebaseUser, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import LoginPage from './components/LoginPage';
import CourseSelector from './components/CourseSelector';
import CalendarPreview from './components/CalendarPreview';
import Dashboard from './components/Dashboard';
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

        // Check if user has existing selection
        const userSelection = await FirestoreService.getUserCourseSelection(firebaseUser.uid);

        if (userSelection && userSelection.selectedCourses.length > 0) {
          // User has already set up, go to dashboard
          setSelectedCourses(userSelection.selectedCourses);
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

      // If admin, scrape and save to Firestore
      if (FirestoreService.isAdmin(firebaseUser.email || '')) {
        // Use the Google OAuth access token, not Firebase ID token
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
        // Regular user, load from Firestore
        const firestoreCourses = await FirestoreService.getCourses();
        setCourses(firestoreCourses);
      }

      setAppState('select-courses');
    } catch (err) {
      console.error('Error loading courses:', err);
      setError('Failed to load courses from schedule');
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

      const result = await signInWithPopup(auth, googleProvider);

      // Get the Google OAuth access token from credentials
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;

      if (accessToken) {
        setGoogleAccessToken(accessToken);
        // Initialize Google Calendar API with the access token
        await GoogleCalendarService.initializeGAPI();
        GoogleCalendarService.setAccessToken(accessToken);
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

      // Filter out cancelled events - we don't want them in the calendar
      const activeEvents = previewEvents.filter(e => !e.isCancelled);
      console.log(`Syncing ${activeEvents.length} active events (${previewEvents.length - activeEvents.length} cancelled events excluded)`);

      // Sync to Google Calendar
      const syncStats = await GoogleCalendarService.syncEvents(activeEvents);
      console.log('Initial sync completed:', syncStats);

      // Save user preferences to Firestore
      await FirestoreService.saveUserCourseSelection(
        user.uid,
        user.email,
        selectedCourses
      );

      // Mark as synced with calendar event IDs
      const calendarEventIds: Record<string, string> = {};
      activeEvents.forEach(event => {
        if (event.calendarEventId) {
          calendarEventIds[event.id] = event.calendarEventId;
        }
      });
      await FirestoreService.markUserAsSynced(user.uid, calendarEventIds);

      setScheduleEvents(activeEvents);
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

      // Filter out cancelled events - we don't want them in the calendar
      const activeEvents = events.filter(e => !e.isCancelled);
      setScheduleEvents(activeEvents);

      // Re-sync to calendar
      if (googleAccessToken) {
        GoogleCalendarService.setAccessToken(googleAccessToken);
        const syncStats = await GoogleCalendarService.syncEvents(activeEvents);
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
              <h1 className="header-title">Course Schedule Sync</h1>
              {isAdmin && (
                <span className="admin-badge badge badge-warning">Admin</span>
              )}
            </div>
            <button className="btn btn-secondary" onClick={handleLogout}>
              Logout
            </button>
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
      </div>
    );
  }

  if (appState === 'preview') {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <h1 className="header-title">Course Schedule Sync</h1>
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
      <Dashboard
        user={user!}
        selectedCourses={selectedCourses}
        scheduleEvents={scheduleEvents}
        onLogout={handleLogout}
        onResync={handleResync}
        onEditCourses={() => setAppState('select-courses')}
        loading={loading}
        isAdmin={isAdmin}
      />
    );
  }

  return null;
}

export default App;
