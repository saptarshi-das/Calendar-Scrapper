import axios from 'axios';
import type { Course, ScheduleEvent, TimeSlot } from '../types';

const SHEET_ID = import.meta.env.VITE_SCHEDULE_SHEET_ID;
const GID = import.meta.env.VITE_SCHEDULE_SHEET_GID;

// Google Sheets API endpoint
const getSheetURL = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    return `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A1:Z100?key=${apiKey}`;
};

// Alternative: Use public CSV export (doesn't require API key)
const getPublicCSVURL = () => {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
};

export class SheetScraperService {
    /**
     * Fetch the raw sheet data from Google Sheets
     */
    static async fetchSheetData(accessToken?: string): Promise<any[][]> {
        try {
            // Try with API first if access token is available
            if (accessToken) {
                const response = await axios.get(
                    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A1:Z100`,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    }
                );
                return response.data.values || [];
            }

            // Fallback to public CSV export
            const response = await axios.get(getPublicCSVURL());
            const csvData = response.data;
            return this.parseCSV(csvData);
        } catch (error) {
            console.error('Error fetching sheet data:', error);
            throw new Error('Failed to fetch schedule data');
        }
    }

    /**
     * Parse CSV data into 2D array
     */
    static parseCSV(csvText: string): string[][] {
        const lines = csvText.split('\n');
        return lines.map(line => {
            // Simple CSV parsing (doesn't handle quoted commas)
            return line.split(',').map(cell => cell.trim());
        });
    }

    /**
     * Extract all unique courses from the sheet
     */
    static extractCourses(rawData: any[][]): Course[] {
        const coursesSet = new Set<string>();
        const courses: Course[] = [];

        // Skip header rows and iterate through schedule
        for (let i = 2; i < rawData.length; i++) {
            const row = rawData[i];

            // Check each time slot column (columns C onwards)
            for (let j = 2; j < row.length; j++) {
                const cell = row[j];
                if (cell && typeof cell === 'string') {
                    // Extract course codes (format: "Fintech-B (PT-1-2)")
                    // Pattern: CourseName-Section (Location)
                    const matches = cell.match(/([A-Z][A-Za-z&-]+)-([A-Z])\s*\(([^)]+)\)/g);

                    if (matches) {
                        matches.forEach(match => {
                            const courseMatch = match.match(/([A-Z][A-Za-z&-]+)-([A-Z])\s*\(([^)]+)\)/);
                            if (courseMatch) {
                                const [_, courseName, section, location] = courseMatch;
                                const code = `${courseName}-${section} (${location})`;

                                if (!coursesSet.has(code)) {
                                    coursesSet.add(code);
                                    courses.push({
                                        id: code.replace(/\s+/g, '-').toLowerCase(),
                                        code: code,
                                        name: courseName,
                                        section: section,
                                        location: location,
                                    });
                                }
                            }
                        });
                    }
                }
            }
        }

        return courses.sort((a, b) => a.code.localeCompare(b.code));
    }

    /**
     * Parse schedule events from raw sheet data
     */
    static parseScheduleEvents(rawData: any[][], selectedCourses: string[]): ScheduleEvent[] {
        const events: ScheduleEvent[] = [];

        if (!rawData || rawData.length < 3) return events;

        // Parse header to get time slots
        const timeSlots = this.parseTimeSlots(rawData);

        let currentWeek = 1;
        let currentDate = new Date();

        // Iterate through rows
        for (let i = 2; i < rawData.length; i++) {
            const row = rawData[i];

            // Column A: Week info
            if (row[0] && row[0].includes('Week')) {
                const weekMatch = row[0].match(/Week\s+(\d+)/);
                if (weekMatch) {
                    currentWeek = parseInt(weekMatch[1]);
                }
            }

            // Column A: Date
            const dateStr = row[0];
            if (dateStr && this.isValidDate(dateStr)) {
                currentDate = this.parseDate(dateStr);
            }

            // Column B: Day
            const day = row[1];

            if (day && this.isValidDay(day)) {
                // Iterate through time slot columns
                for (let j = 2; j < Math.min(row.length, timeSlots.length + 2); j++) {
                    const cell = row[j];
                    const timeSlot = timeSlots[j - 2];

                    if (cell && timeSlot) {
                        // Parse events from this cell
                        const cellEvents = this.parseCellEvents(
                            cell,
                            currentWeek,
                            day,
                            currentDate,
                            timeSlot,
                            selectedCourses
                        );
                        events.push(...cellEvents);
                    }
                }
            }
        }

        return events;
    }

    /**
     * Parse time slots from header row
     */
    static parseTimeSlots(rawData: any[][]): TimeSlot[] {
        const timeSlots: TimeSlot[] = [];

        // Assume row 1 contains time slot headers
        if (rawData.length > 1) {
            const headerRow = rawData[1];

            for (let i = 2; i < headerRow.length; i++) {
                const header = headerRow[i];
                if (header && typeof header === 'string') {
                    // Format: "9.00AM - 10.30AM"
                    const timeMatch = header.match(/(\d+\.\d+[AP]M)\s*-\s*(\d+\.\d+[AP]M)/);
                    if (timeMatch) {
                        timeSlots.push({
                            start: timeMatch[1].replace('.', ':'),
                            end: timeMatch[2].replace('.', ':'),
                        });
                    }
                }
            }
        }

        return timeSlots;
    }

    /**
     * Parse individual events from a cell
     */
    static parseCellEvents(
        cellValue: string,
        week: number,
        day: string,
        date: Date,
        timeSlot: TimeSlot,
        selectedCourses: string[]
    ): ScheduleEvent[] {
        const events: ScheduleEvent[] = [];

        // Check if cell is cancelled (red background would need HTML/Sheets API)
        const isRed = false; // Will be implemented with proper Sheets API

        // Split by line breaks to handle multiple entries
        const lines = cellValue.split('\n').filter(line => line.trim());

        for (const line of lines) {
            // Check for strikethrough (would need HTML parsing)
            const hasStrikethrough = false; // Will be implemented with proper Sheets API

            // Extract course code (format: "Fintech-B (PT-1-2)")
            const courseMatch = line.match(/([A-Z][A-Za-z&-]+)-([A-Z])\s*\(([^)]+)\)/);
            if (courseMatch) {
                const [_, courseName, section, location] = courseMatch;
                const courseCode = `${courseName}-${section} (${location})`;

                // Only include if user selected this course
                if (selectedCourses.includes(courseCode)) {
                    // Extract professor name (text after course code)
                    const professor = line.replace(/([A-Z][A-Za-z&-]+)-([A-Z])\s*\([^)]+\)/, '').trim();

                    const event: ScheduleEvent = {
                        id: `${courseCode}-${date.toISOString()}-${timeSlot.start}`,
                        courseCode,
                        courseName,
                        section,
                        location,
                        professor,
                        date,
                        timeSlot,
                        week,
                        day,
                        status: hasStrikethrough || isRed ? 'cancelled' : 'active',
                        isCancelled: hasStrikethrough || isRed,
                        isRed,
                        hasStrikethrough,
                    };

                    events.push(event);
                }
            }
        }

        return events;
    }

    /**
     * Helper functions
     */
    static isValidDate(dateStr: string): boolean {
        // Format: "29/12/2025"
        return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr);
    }

    static parseDate(dateStr: string): Date {
        // Format: "29/12/2025" -> Date object
        const [day, month, year] = dateStr.split('/').map(Number);
        return new Date(year, month - 1, day);
    }

    static isValidDay(day: string): boolean {
        const validDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return validDays.includes(day);
    }
}
