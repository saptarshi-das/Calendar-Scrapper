import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { google } from 'googleapis';

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

const ADMIN_EMAIL = 'saptarshi.dasi21@iimranchi.ac.in';
const SHEET_ID = '1jis4IowMXM72jJUlz3Yanv2YBu7ilcvU';
const GID = '752189081';

/**
 * Scheduled function that runs daily at 11:00 PM IST
 */
export const scheduledSync = functions.pubsub
    .schedule('0 23 * * *')
    .timeZone('Asia/Kolkata')
    .onRun(async (context) => {
        console.log('Starting daily schedule sync...');

        try {
            // Step 1: Scrape Google Sheet (Admin only)
            await scrapeAndStoreSchedule();

            // Step 2: Update all users' calendars
            await syncAllUsersCalendars();

            console.log('Daily sync completed successfully');
            return null;
        } catch (error) {
            console.error('Error in daily sync:', error);
            throw error;
        }
    });

/**
 * Scrape Google Sheet and store in Firestore
 */
async function scrapeAndStoreSchedule() {
    try {
        console.log('Scraping Google Sheet...');

        // Fetch CSV data
        const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
        const response = await axios.get(csvUrl);
        const rawData = parseCSV(response.data);

        // Extract courses and events
        const courses = extractCourses(rawData);
        const events = parseScheduleEvents(rawData, courses.map(c => c.code));

        // Store in Firestore
        await db.collection('schedule').doc('courses').set({
            courses,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection('schedule').doc('events').set({
            events: events.map(e => ({
                ...e,
                date: e.date.toISOString(),
            })),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Stored ${courses.length} courses and ${events.length} events`);
    } catch (error) {
        console.error('Error scraping schedule:', error);
        throw error;
    }
}

/**
 * Sync calendars for all users
 */
async function syncAllUsersCalendars() {
    try {
        console.log('Syncing all users calendars...');

        // Get all users with sync enabled
        const usersSnapshot = await db
            .collection('users')
            .where('syncEnabled', '==', true)
            .get();

        console.log(`Found ${usersSnapshot.size} users to sync`);

        // Get schedule events from Firestore
        const eventsDoc = await db.collection('schedule').doc('events').get();
        const allEvents = eventsDoc.data()?.events || [];

        // Process each user
        const syncPromises = usersSnapshot.docs.map(async (userDoc) => {
            const userData = userDoc.data();
            const userId = userDoc.id;

            try {
                // Filter events for user's selected courses
                const userEvents = allEvents
                    .filter((e: any) => userData.selectedCourses.includes(e.courseCode))
                    .map((e: any) => ({
                        ...e,
                        date: new Date(e.date),
                    }));

                // Sync to user's Google Calendar
                await syncUserCalendar(userId, userData, userEvents);

                console.log(`Synced calendar for user: ${userData.email}`);
            } catch (error) {
                console.error(`Error syncing calendar for user ${userId}:`, error);
            }
        });

        await Promise.all(syncPromises);
        console.log('All users synced successfully');
    } catch (error) {
        console.error('Error syncing users:', error);
        throw error;
    }
}

/**
 * Sync calendar for a single user
 */
async function syncUserCalendar(userId: string, userData: any, events: any[]) {
    // Get user's refresh token from Firestore
    const refreshToken = userData.refreshToken;
    if (!refreshToken) {
        console.log(`No refresh token for user ${userId}, skipping...`);
        return;
    }

    // Initialize Google Calendar API with user's credentials
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get existing calendar events
    const existingEvents = await calendar.events.list({
        calendarId: 'primary',
        privateExtendedProperty: 'appName=calendar-scrapper',
        maxResults: 2500,
    });

    const existingEventsMap = new Map(
        existingEvents.data.items?.map(e => [
            e.extendedProperties?.private?.scheduleEventId,
            e,
        ]) || []
    );

    let created = 0;
    let updated = 0;
    let deleted = 0;

    // Create or update events
    for (const event of events) {
        const existingEvent = existingEventsMap.get(event.id);

        const calendarEvent = {
            summary: `${event.courseName} - ${event.professor}`,
            description: `Course: ${event.courseCode}\nProfessor: ${event.professor}\nWeek: ${event.week}${event.isCancelled ? '\n\n⚠️ CLASS CANCELLED' : ''
                }`,
            start: {
                dateTime: createDateTime(event.date, event.timeSlot.start),
                timeZone: 'Asia/Kolkata',
            },
            end: {
                dateTime: createDateTime(event.date, event.timeSlot.end),
                timeZone: 'Asia/Kolkata',
            },
            colorId: event.isCancelled ? '11' : '9',
            extendedProperties: {
                private: {
                    scheduleEventId: event.id,
                    courseCode: event.courseCode,
                    status: event.status,
                    appName: 'calendar-scrapper',
                },
            },
        };

        if (existingEvent) {
            // Update if status changed
            if (existingEvent.extendedProperties?.private?.status !== event.status) {
                await calendar.events.update({
                    calendarId: 'primary',
                    eventId: existingEvent.id!,
                    requestBody: calendarEvent,
                });
                updated++;
            }
        } else {
            // Create new event
            await calendar.events.insert({
                calendarId: 'primary',
                requestBody: calendarEvent,
            });
            created++;
        }

        existingEventsMap.delete(event.id);
    }

    // Delete events that no longer exist
    for (const [, existingEvent] of existingEventsMap) {
        if (existingEvent.id) {
            await calendar.events.delete({
                calendarId: 'primary',
                eventId: existingEvent.id,
            });
            deleted++;
        }
    }

    console.log(
        `User ${userData.email}: Created ${created}, Updated ${updated}, Deleted ${deleted}`
    );

    // Update last synced timestamp
    await db.collection('users').doc(userId).update({
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Helper Functions
 */

function parseCSV(csvText: string): string[][] {
    const lines = csvText.split('\n');
    return lines.map(line => line.split(',').map(cell => cell.trim()));
}

function extractCourses(rawData: string[][]): any[] {
    const coursesSet = new Set<string>();
    const courses: any[] = [];

    for (let i = 2; i < rawData.length; i++) {
        const row = rawData[i];
        for (let j = 2; j < row.length; j++) {
            const cell = row[j];
            if (cell) {
                const matches = cell.match(/([A-Z&-]+)\s*\(([^)]+)\)/g);
                if (matches) {
                    matches.forEach(match => {
                        const courseMatch = match.match(/([A-Z&-]+)\s*\(([^)]+)\)/);
                        if (courseMatch) {
                            const [_, courseName, section] = courseMatch;
                            const code = `${courseName} (${section})`;
                            if (!coursesSet.has(code)) {
                                coursesSet.add(code);
                                courses.push({
                                    id: code.replace(/\s+/g, '-').toLowerCase(),
                                    code,
                                    name: courseName,
                                    section,
                                });
                            }
                        }
                    });
                }
            }
        }
    }

    return courses;
}

function parseScheduleEvents(rawData: string[][], courseCodes: string[]): any[] {
    // Similar to frontend implementation
    // (Implementation details omitted for brevity - copy from sheetScraper.ts)
    return [];
}

function createDateTime(date: Date, time: string): string {
    const [hours, minutes] = parseTime(time);
    const dateTime = new Date(date);
    dateTime.setHours(hours, minutes, 0, 0);
    return dateTime.toISOString();
}

function parseTime(time: string): [number, number] {
    const match = time.match(/(\d+):(\d+)(AM|PM)/i);
    if (!match) throw new Error(`Invalid time format: ${time}`);

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    else if (period === 'AM' && hours === 12) hours = 0;

    return [hours, minutes];
}
