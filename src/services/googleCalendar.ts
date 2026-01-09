/* eslint-disable @typescript-eslint/no-explicit-any */
import { ScheduleEvent } from '../types';

declare global {
    interface Window {
        gapi: any;
    }
}

export class GoogleCalendarService {
    private static DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
    private static SCOPES = 'https://www.googleapis.com/auth/calendar.events';

    /**
     * Initialize Google Calendar API
     */
    static async initializeGAPI(): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://apis.google.com/js/api.js';
            script.onload = () => {
                window.gapi.load('client', async () => {
                    try {
                        await window.gapi.client.init({
                            apiKey: import.meta.env.VITE_GOOGLE_API_KEY,
                            discoveryDocs: [this.DISCOVERY_DOC],
                        });
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            };
            script.onerror = reject;
            document.body.appendChild(script);
        });
    }

    /**
     * Authorize with Google Calendar using access token
     */
    static setAccessToken(token: string): void {
        if (window.gapi && window.gapi.client) {
            window.gapi.client.setToken({ access_token: token });
        }
    }

    /**
     * Create a calendar event
     */
    static async createEvent(
        event: ScheduleEvent,
        calendarId: string = 'primary'
    ): Promise<string> {
        try {
            const startDateTime = this.createDateTime(event.date, event.timeSlot.start);
            const endDateTime = this.createDateTime(event.date, event.timeSlot.end);

            const calendarEvent = {
                summary: `${event.courseName} - ${event.professor}`,
                description: `Course: ${event.courseCode}\nProfessor: ${event.professor}\nWeek: ${event.week}`,
                start: {
                    dateTime: startDateTime,
                    timeZone: 'Asia/Kolkata',
                },
                end: {
                    dateTime: endDateTime,
                    timeZone: 'Asia/Kolkata',
                },
                colorId: event.isCancelled ? '11' : '9', // Red for cancelled, blue for active
                extendedProperties: {
                    private: {
                        scheduleEventId: event.id,
                        courseCode: event.courseCode,
                        status: event.status,
                    },
                },
            };

            const response = await window.gapi.client.calendar.events.insert({
                calendarId: calendarId,
                resource: calendarEvent,
            });

            return response.result.id;
        } catch (error) {
            console.error('Error creating calendar event:', error);
            throw error;
        }
    }

    /**
     * Update an existing calendar event
     */
    static async updateEvent(
        eventId: string,
        event: ScheduleEvent,
        calendarId: string = 'primary'
    ): Promise<void> {
        try {
            const startDateTime = this.createDateTime(event.date, event.timeSlot.start);
            const endDateTime = this.createDateTime(event.date, event.timeSlot.end);

            const calendarEvent = {
                summary: `${event.courseName} - ${event.professor}`,
                description: `Course: ${event.courseCode}\nProfessor: ${event.professor}\nWeek: ${event.week}${event.isCancelled ? '\n\n⚠️ CLASS CANCELLED' : ''
                    }`,
                start: {
                    dateTime: startDateTime,
                    timeZone: 'Asia/Kolkata',
                },
                end: {
                    dateTime: endDateTime,
                    timeZone: 'Asia/Kolkata',
                },
                colorId: event.isCancelled ? '11' : '9',
                extendedProperties: {
                    private: {
                        scheduleEventId: event.id,
                        courseCode: event.courseCode,
                        status: event.status,
                    },
                },
            };

            await window.gapi.client.calendar.events.update({
                calendarId: calendarId,
                eventId: eventId,
                resource: calendarEvent,
            });
        } catch (error) {
            console.error('Error updating calendar event:', error);
            throw error;
        }
    }

    /**
     * Delete a calendar event
     */
    static async deleteEvent(
        eventId: string,
        calendarId: string = 'primary'
    ): Promise<void> {
        try {
            await window.gapi.client.calendar.events.delete({
                calendarId: calendarId,
                eventId: eventId,
            });
        } catch (error) {
            console.error('Error deleting calendar event:', error);
            throw error;
        }
    }

    /**
     * Get all events with our custom property
     */
    static async getScheduleEvents(calendarId: string = 'primary'): Promise<any[]> {
        try {
            const response = await window.gapi.client.calendar.events.list({
                calendarId: calendarId,
                privateExtendedProperty: 'scheduleEventId',
                maxResults: 2500,
                singleEvents: true,
                orderBy: 'startTime',
            });

            return response.result.items || [];
        } catch (error) {
            console.error('Error fetching calendar events:', error);
            return [];
        }
    }

    /**
     * Sync schedule events to Google Calendar
     */
    static async syncEvents(
        scheduleEvents: ScheduleEvent[],
        calendarId: string = 'primary'
    ): Promise<{ created: number; updated: number; deleted: number }> {
        const stats = { created: 0, updated: 0, deleted: 0 };

        try {
            // Get existing calendar events
            const existingEvents = await this.getScheduleEvents(calendarId);
            const existingEventsMap = new Map(
                existingEvents.map(e => [
                    e.extendedProperties?.private?.scheduleEventId,
                    e,
                ])
            );

            // Create map of new schedule events
            const scheduleEventsMap = new Map(
                scheduleEvents.map(e => [e.id, e])
            );

            // Create or update events
            for (const scheduleEvent of scheduleEvents) {
                const existingEvent = existingEventsMap.get(scheduleEvent.id);

                if (existingEvent) {
                    // Update existing event if status changed
                    const oldStatus = existingEvent.extendedProperties?.private?.status;
                    if (oldStatus !== scheduleEvent.status) {
                        await this.updateEvent(existingEvent.id, scheduleEvent, calendarId);
                        stats.updated++;
                    }
                } else {
                    // Create new event
                    const eventId = await this.createEvent(scheduleEvent, calendarId);
                    scheduleEvent.calendarEventId = eventId;
                    stats.created++;
                }
            }

            // Delete events that no longer exist in schedule
            for (const existingEvent of existingEvents) {
                const scheduleEventId = existingEvent.extendedProperties?.private?.scheduleEventId;
                if (scheduleEventId && !scheduleEventsMap.has(scheduleEventId)) {
                    await this.deleteEvent(existingEvent.id, calendarId);
                    stats.deleted++;
                }
            }

            return stats;
        } catch (error) {
            console.error('Error syncing events:', error);
            throw error;
        }
    }

    /**
     * Helper: Create ISO datetime string
     */
    private static createDateTime(date: Date, time: string): string {
        const [hours, minutes] = this.parseTime(time);
        const dateTime = new Date(date);
        dateTime.setHours(hours, minutes, 0, 0);
        return dateTime.toISOString();
    }

    /**
     * Helper: Parse time string to hours and minutes
     */
    private static parseTime(time: string): [number, number] {
        // Format: "9:00AM" or "2:30PM"
        const match = time.match(/(\d+):(\d+)(AM|PM)/i);
        if (!match) {
            throw new Error(`Invalid time format: ${time}`);
        }

        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3].toUpperCase();

        if (period === 'PM' && hours !== 12) {
            hours += 12;
        } else if (period === 'AM' && hours === 12) {
            hours = 0;
        }

        return [hours, minutes];
    }
}
