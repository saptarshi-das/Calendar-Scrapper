import { db } from '../firebase';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    updateDoc,
    serverTimestamp,
} from 'firebase/firestore';
import type { Course, ScheduleEvent, UserCourseSelection } from '../types';

const ADMIN_EMAIL = 'saptarshi.dasi21@iimranchi.ac.in';

export class FirestoreService {
    /**
     * Check if user is admin (can scrape sheet)
     */
    static isAdmin(email: string): boolean {
        return email === ADMIN_EMAIL;
    }

    /**
     * Store scraped schedule data (admin only)
     */
    static async storeScheduleData(
        courses: Course[],
        events: ScheduleEvent[]
    ): Promise<void> {
        try {
            // Store courses
            const coursesRef = doc(db, 'schedule', 'courses');
            await setDoc(coursesRef, {
                courses,
                lastUpdated: serverTimestamp(),
            });

            // Store all schedule events
            const eventsRef = doc(db, 'schedule', 'events');
            await setDoc(eventsRef, {
                events: events.map(e => ({
                    ...e,
                    date: e.date.toISOString(),
                })),
                lastUpdated: serverTimestamp(),
            });

            console.log('Schedule data stored successfully');
        } catch (error) {
            console.error('Error storing schedule data:', error);
            throw error;
        }
    }

    /**
     * Get all available courses from Firestore
     */
    static async getCourses(): Promise<Course[]> {
        try {
            const coursesRef = doc(db, 'schedule', 'courses');
            const coursesDoc = await getDoc(coursesRef);

            if (coursesDoc.exists()) {
                return coursesDoc.data().courses || [];
            }

            return [];
        } catch (error) {
            console.error('Error fetching courses:', error);
            throw error;
        }
    }

    /**
     * Get all schedule events from Firestore
     */
    static async getAllScheduleEvents(): Promise<ScheduleEvent[]> {
        try {
            const eventsRef = doc(db, 'schedule', 'events');
            const eventsDoc = await getDoc(eventsRef);

            if (eventsDoc.exists()) {
                const events = eventsDoc.data().events || [];
                // Convert date strings back to Date objects
                return events.map((e: any) => ({
                    ...e,
                    date: new Date(e.date),
                }));
            }

            return [];
        } catch (error) {
            console.error('Error fetching schedule events:', error);
            throw error;
        }
    }

    /**
     * Get schedule events for specific courses
     */
    static async getScheduleEventsForCourses(
        courseCodes: string[]
    ): Promise<ScheduleEvent[]> {
        try {
            const allEvents = await this.getAllScheduleEvents();
            return allEvents.filter(event =>
                courseCodes.includes(event.courseCode)
            );
        } catch (error) {
            console.error('Error fetching course events:', error);
            throw error;
        }
    }

    /**
     * Save user's course selection
     */
    static async saveUserCourseSelection(
        userId: string,
        email: string,
        selectedCourses: string[]
    ): Promise<void> {
        try {
            const userRef = doc(db, 'users', userId);
            await setDoc(
                userRef,
                {
                    email,
                    selectedCourses,
                    lastSyncedAt: serverTimestamp(),
                    syncEnabled: true,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );

            console.log('User course selection saved');
        } catch (error) {
            console.error('Error saving course selection:', error);
            throw error;
        }
    }

    /**
     * Get user's course selection
     */
    static async getUserCourseSelection(
        userId: string
    ): Promise<UserCourseSelection | null> {
        try {
            const userRef = doc(db, 'users', userId);
            const userDoc = await getDoc(userRef);

            if (userDoc.exists()) {
                const data = userDoc.data();
                return {
                    userId,
                    selectedCourses: data.selectedCourses || [],
                    lastSyncedAt: data.lastSyncedAt?.toDate() || new Date(),
                    calendarId: data.calendarId,
                };
            }

            return null;
        } catch (error) {
            console.error('Error fetching user selection:', error);
            throw error;
        }
    }

    /**
     * Mark user's calendar as synced
     */
    static async markUserAsSynced(
        userId: string,
        calendarEventIds: Record<string, string>
    ): Promise<void> {
        try {
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                calendarEventIds,
                lastSyncedAt: serverTimestamp(),
                initialSyncComplete: true,
            });

            console.log('User marked as synced');
        } catch (error) {
            console.error('Error marking user as synced:', error);
            throw error;
        }
    }

    /**
     * Get all users who need calendar updates (for cloud function)
     */
    static async getAllSyncEnabledUsers(): Promise<any[]> {
        try {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('syncEnabled', '==', true));
            const querySnapshot = await getDocs(q);

            return querySnapshot.docs.map(doc => ({
                userId: doc.id,
                ...doc.data(),
            }));
        } catch (error) {
            console.error('Error fetching sync-enabled users:', error);
            throw error;
        }
    }

    /**
     * Get last schedule update time
     */
    static async getLastScheduleUpdateTime(): Promise<Date | null> {
        try {
            const eventsRef = doc(db, 'schedule', 'events');
            const eventsDoc = await getDoc(eventsRef);

            if (eventsDoc.exists()) {
                const lastUpdated = eventsDoc.data().lastUpdated;
                return lastUpdated?.toDate() || null;
            }

            return null;
        } catch (error) {
            console.error('Error fetching last update time:', error);
            return null;
        }
    }
}
