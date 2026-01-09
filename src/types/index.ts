export interface User {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
}

export interface Course {
    id: string;
    code: string; // e.g., "LETV (PT-1-2)"
    name: string; // e.g., "LETV"
    section: string; // e.g., "PT-1-2"
    professor?: string;
}

export interface TimeSlot {
    start: string; // "9:00 AM"
    end: string; // "10:30 AM"
}

export interface ScheduleEvent {
    id: string;
    courseCode: string;
    courseName: string;
    professor: string;
    date: Date;
    timeSlot: TimeSlot;
    week: number;
    day: string; // "Mon", "Tue", etc.
    status: 'active' | 'cancelled' | 'rescheduled';
    isCancelled: boolean;
    isRed: boolean; // Red cell indicator
    hasStrikethrough: boolean;
    calendarEventId?: string; // Google Calendar Event ID
}

export interface UserCourseSelection {
    userId: string;
    selectedCourses: string[]; // Array of course codes
    lastSyncedAt: Date;
    calendarId?: string; // User's Google Calendar ID
}

export interface SyncLog {
    userId: string;
    syncedAt: Date;
    eventsCreated: number;
    eventsUpdated: number;
    eventsDeleted: number;
    status: 'success' | 'error';
    errorMessage?: string;
}

export interface SheetData {
    week: number;
    day: string;
    date: string;
    events: ScheduleEvent[];
}
