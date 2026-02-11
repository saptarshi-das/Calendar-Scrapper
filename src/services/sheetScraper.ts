import axios from 'axios';
import type { Course, ScheduleEvent, TimeSlot } from '../types';

const SHEET_ID = import.meta.env.VITE_SCHEDULE_SHEET_ID;
const GID = import.meta.env.VITE_SCHEDULE_SHEET_GID;

// Alternative: Use public CSV export via Google Visualization API (works better with public sheets)
const getPublicCSVURL = () => {
    // Using gviz/tq endpoint which is more reliable for public sheets
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
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
     * Properly handles quoted fields and escaped quotes
     */
    static parseCSV(csvText: string): string[][] {
        const lines = csvText.split('\n');
        return lines.map(line => {
            const cells: string[] = [];
            let currentCell = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = line[i + 1];

                if (char === '"') {
                    if (inQuotes && nextChar === '"') {
                        // Escaped quote
                        currentCell += '"';
                        i++; // Skip next quote
                    } else {
                        // Toggle quote state
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    // End of cell
                    cells.push(currentCell.trim());
                    currentCell = '';
                } else {
                    currentCell += char;
                }
            }

            // Add last cell
            cells.push(currentCell.trim());

            return cells;
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
                    // **NEW: Match combined section courses: CourseName-A and B (Location)**
                    // This detects patterns like "SA-A and B (PT-2-4)" and creates separate entries for SA-A and SA-B
                    const combinedSectionMatches = cell.match(/([A-Z][A-Za-z0-9\&-]+)-([A-Z])\s+and\s+([A-Z])\s*\(([^)]+)\)/gi);
                    if (combinedSectionMatches) {
                        combinedSectionMatches.forEach(match => {
                            const courseMatch = match.match(/([A-Z][A-Za-z0-9\&-]+)-([A-Z])\s+and\s+([A-Z])\s*\(([^)]+)\)/i);
                            if (courseMatch) {
                                const [, courseName, firstSection, secondSection] = courseMatch;

                                // Create entry for first section (e.g., SA-A)
                                const firstCode = `${courseName}-${firstSection}`;
                                if (!coursesSet.has(firstCode)) {
                                    coursesSet.add(firstCode);
                                    courses.push({
                                        id: firstCode.replace(/\s+/g, '-').toLowerCase(),
                                        code: firstCode,
                                        name: courseName,
                                        section: firstSection,
                                        location: '',
                                    });
                                }

                                // Create entry for second section (e.g., SA-B)
                                const secondCode = `${courseName}-${secondSection}`;
                                if (!coursesSet.has(secondCode)) {
                                    coursesSet.add(secondCode);
                                    courses.push({
                                        id: secondCode.replace(/\s+/g, '-').toLowerCase(),
                                        code: secondCode,
                                        name: courseName,
                                        section: secondSection,
                                        location: '',
                                    });
                                }
                            }
                        });
                    }

                    // Match multi-section courses: CourseName-A (Location)
                    const multiSectionMatches = cell.match(/([A-Z][A-Za-z0-9&-]+)-([A-Z])\s*\(([^)]+)\)/g);
                    if (multiSectionMatches) {
                        multiSectionMatches.forEach(match => {
                            const courseMatch = match.match(/([A-Z][A-Za-z0-9&-]+)-([A-Z])\s*\(([^)]+)\)/);
                            if (courseMatch) {
                                const [, courseName, section] = courseMatch;
                                const code = `${courseName}-${section}`;

                                if (!coursesSet.has(code)) {
                                    coursesSet.add(code);
                                    courses.push({
                                        id: code.replace(/\s+/g, '-').toLowerCase(),
                                        code: code,
                                        name: courseName,
                                        section: section,
                                        location: '',
                                    });
                                }
                            }
                        });
                    }

                    // Match single-section courses: CourseName (Location) - e.g., SHRM, CSM, I4TS
                    const singleSectionMatches = cell.match(/\b([A-Z][A-Za-z0-9&]+)\s*\(([^)]+)\)/g);
                    if (singleSectionMatches) {
                        singleSectionMatches.forEach(match => {
                            // Skip if this looks like a multi-section course (has -X before the parenthesis)
                            if (/-[A-Z]\s*\(/.test(match)) return;

                            const singleMatch = match.match(/\b([A-Z][A-Za-z0-9&]+)\s*\(([^)]+)\)/);
                            if (singleMatch) {
                                const [, courseName] = singleMatch;
                                const code = courseName; // No section suffix

                                if (!coursesSet.has(code)) {
                                    coursesSet.add(code);
                                    courses.push({
                                        id: code.replace(/\s+/g, '-').toLowerCase(),
                                        code: code,
                                        name: courseName,
                                        section: '1', // Default section for single-section courses
                                        location: '',
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

        console.log('=== PARSING SCHEDULE EVENTS ===');
        console.log('Raw data rows:', rawData.length);
        console.log('Selected courses:', selectedCourses);

        if (!rawData || rawData.length < 3) {
            console.warn('Not enough data rows');
            return events;
        }

        // Parse header to get time slots
        const timeSlots = this.parseTimeSlots(rawData);
        console.log('Parsed time slots:', timeSlots);

        if (timeSlots.length === 0) {
            console.error('No time slots found!');
        }

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
                    console.log(`Found week ${currentWeek} at row ${i}`);
                }
            }

            // Column A: Date
            const dateStr = row[0];
            if (dateStr && this.isValidDate(dateStr)) {
                currentDate = this.parseDate(dateStr);
                console.log(`Found date ${dateStr} -> ${currentDate.toDateString()} at row ${i}`);
            }

            // Column B: Day
            const day = row[1];

            if (day && this.isValidDay(day)) {
                console.log(`Processing day ${day} at row ${i}, date: ${currentDate.toDateString()}`);

                // Each day has 4 rows:
                // Row i:   First set of courses
                // Row i+1: Professors for first set
                // Row i+2: Second set of courses  
                // Row i+3: Professors for second set

                // Process first pair of course/professor rows (rows i and i+1)
                const firstCourseRow = row;
                const firstProfRow = i + 1 < rawData.length ? rawData[i + 1] : [];

                for (let j = 2; j < Math.min(firstCourseRow.length, timeSlots.length + 2); j++) {
                    const cell = firstCourseRow[j];
                    const professorCell = firstProfRow[j] || '';
                    const timeSlot = timeSlots[j - 2];

                    if (cell && timeSlot) {
                        console.log(`  Row ${i} Col ${j}:`, cell.substring(0, 50));
                        const cellEvents = this.parseCellEvents(
                            cell,
                            currentWeek,
                            day,
                            currentDate,
                            timeSlot,
                            selectedCourses,
                            professorCell
                        );
                        if (cellEvents.length > 0) {
                            console.log(`    Found ${cellEvents.length} events (first set)`);
                        }
                        events.push(...cellEvents);
                    }
                }

                // Process second pair of course/professor rows (rows i+2 and i+3)
                const secondCourseRow = i + 2 < rawData.length ? rawData[i + 2] : [];
                const secondProfRow = i + 3 < rawData.length ? rawData[i + 3] : [];

                for (let j = 2; j < Math.min(secondCourseRow.length, timeSlots.length + 2); j++) {
                    const cell = secondCourseRow[j];
                    const professorCell = secondProfRow[j] || '';
                    const timeSlot = timeSlots[j - 2];

                    if (cell && timeSlot) {
                        console.log(`  Row ${i + 2} Col ${j}:`, cell.substring(0, 50));
                        const cellEvents = this.parseCellEvents(
                            cell,
                            currentWeek,
                            day,
                            currentDate,
                            timeSlot,
                            selectedCourses,
                            professorCell
                        );
                        if (cellEvents.length > 0) {
                            console.log(`    Found ${cellEvents.length} events (second set)`);
                        }
                        events.push(...cellEvents);
                    }
                }
            }
        }

        console.log(`Total events extracted: ${events.length}`);
        console.log('=== END PARSING ===');
        return events;
    }

    /**
     * Parse time slots from header row
     * Searches for a row with clean time slot format since headers appear multiple times in the sheet
     */
    static parseTimeSlots(rawData: any[][]): TimeSlot[] {
        const timeSlots: TimeSlot[] = [];

        console.log('Parsing time slots...');

        // Search through the first few rows to find a header row with time information
        for (let rowIndex = 0; rowIndex < Math.min(rawData.length, 40); rowIndex++) {
            const row = rawData[rowIndex];
            const tempSlots: TimeSlot[] = [];

            // Check if this row has time slot headers (starts from column 2)
            for (let i = 2; i < row.length; i++) {
                const header = row[i];
                if (header && typeof header === 'string') {
                    // Format: "9.00AM - 10.30AM" or "9:00AM - 10:30AM"
                    // Some headers may have extra text like "Term 6 Schedule - Dec 29 - Jan 4 10.45AM - 12.15PM"
                    // Extract the LAST occurrence of time pattern in the string
                    const timePattern = /(\d+[:.]\d+[AP]M)\s*-\s*(\d+[:.]\d+[AP]M)/g;
                    let match;
                    let lastMatch = null;

                    // Find all matches and keep the last one (in case of multiple times in one cell)
                    while ((match = timePattern.exec(header)) !== null) {
                        lastMatch = match;
                    }

                    if (lastMatch) {
                        tempSlots.push({
                            start: lastMatch[1].replace('.', ':'),
                            end: lastMatch[2].replace('.', ':'),
                        });
                        console.log(`  Column ${i}: "${header}" -> ${lastMatch[1]} - ${lastMatch[2]}`);
                    }
                }
            }

            // If we found a good set of time slots (at least 5), use this row
            if (tempSlots.length >= 5) {
                console.log(`Found ${tempSlots.length} time slots in row ${rowIndex}`);
                return tempSlots;
            }
        }

        console.warn('No valid time slot header row found!');
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
        selectedCourses: string[],
        professorCell: string = '' // Professor name from the next row
    ): ScheduleEvent[] {
        const events: ScheduleEvent[] = [];

        // Check if cell is cancelled (red background would need HTML/Sheets API)
        const isRed = false; // Will be implemented with proper Sheets API

        // Split by line breaks to handle multiple entries
        const lines = cellValue.split('\n').filter(line => line.trim());
        const professorLines = professorCell.split('\n').filter(line => line.trim());

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            // Check for strikethrough (would need HTML parsing)
            const hasStrikethrough = false; // Will be implemented with proper Sheets API

            // **NEW: First try combined section format: CourseName-A and B (Location)**
            // This detects patterns like "SA-A and B (PT-2-4)" and matches for users who selected SA-A or SA-B
            const combinedSectionMatch = line.match(/([A-Z][A-Za-z0-9\&-]+)-([A-Z])\s+and\s+([A-Z])\s*\(([^)]+)\)/i);

            if (combinedSectionMatch) {
                const [, baseCourseName, firstSection, secondSection, combinedLocation] = combinedSectionMatch;

                // Check if user selected either section
                const firstCode = `${baseCourseName}-${firstSection}`;
                const secondCode = `${baseCourseName}-${secondSection}`;

                let matchedCode: string | undefined;
                let matchedSection: string | undefined;

                if (selectedCourses.includes(firstCode)) {
                    matchedCode = firstCode;
                    matchedSection = firstSection;
                } else if (selectedCourses.includes(secondCode)) {
                    matchedCode = secondCode;
                    matchedSection = secondSection;
                }

                // If user selected either section, create the event
                if (matchedCode && matchedSection) {
                    const professor = professorLines[lineIndex] || professorLines[0] || '';
                    const event: ScheduleEvent = {
                        id: `${matchedCode}-${combinedLocation}-${date.toISOString()}-${timeSlot.start}`,
                        courseCode: matchedCode,
                        courseName: baseCourseName,
                        section: matchedSection,
                        location: combinedLocation,
                        professor: professor.trim(),
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
                    continue; // Skip to next line since we handled this one
                }
            }

            // Try multi-section format first: CourseName-A (Location)
            let courseMatch = line.match(/([A-Z][A-Za-z0-9&-]+)-([A-Z])\s*\(([^)]+)\)/);
            let courseName: string | undefined;
            let section: string | undefined;
            let location: string | undefined;
            let courseCode: string | undefined;

            if (courseMatch) {
                [, courseName, section, location] = courseMatch;
                courseCode = `${courseName}-${section}`;
            } else {
                // Try single-section format: CourseName (Location) - e.g., SHRM (PT-1-3), CSM (PT-1-2)
                const singleSectionMatch = line.match(/([A-Z][A-Za-z0-9&]+)\s*\(([^)]+)\)/);
                if (singleSectionMatch) {
                    [, courseName, location] = singleSectionMatch;
                    section = '1'; // Default section for single-section courses
                    courseCode = courseName; // No section suffix for single-section courses
                }
            }

            // Only include if user selected this course
            if (courseCode && courseName && section && location && selectedCourses.includes(courseCode)) {
                // Get professor from corresponding line in professorCell
                const professor = professorLines[lineIndex] || professorLines[0] || '';

                const event: ScheduleEvent = {
                    id: `${courseCode}-${location}-${date.toISOString()}-${timeSlot.start}`,
                    courseCode,
                    courseName,
                    section,
                    location, // Store the specific location for this event
                    professor: professor.trim(),
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
        const validDays = [
            'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
            'Mon', 'Tue', 'Wed', 'Thu', 'Thurs', 'Fri', 'Sat', 'Sun',
            'Tues', 'Weds'
        ];
        return validDays.some(d => day && day.includes(d));
    }
}
