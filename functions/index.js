const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");
const { google } = require("googleapis");
const XLSX = require("xlsx");
const JSZip = require("jszip");

admin.initializeApp();

// Configuration - defaults (can be overridden by Firestore config)
const DEFAULT_SHEET_NAME = "Schedule";

/**
 * Fetch sheet data - handles both native Google Sheets and .xlsx files
 * For .xlsx files, uses Google Drive API to download and parse with SheetJS
 */
async function fetchSheetData(auth, spreadsheetId, sheetTabName) {
    const sheets = google.sheets({ version: "v4" });
    const drive = google.drive({ version: "v3", auth });

    // First, try the Google Sheets API (works for native Google Sheets)
    try {
        const response = await sheets.spreadsheets.values.get({
            auth,
            spreadsheetId,
            range: `${sheetTabName}!A1:Z200`,
        });
        console.log(`Successfully fetched data using Sheets API with tab '${sheetTabName}'`);
        return response.data.values || [];
    } catch (sheetsError) {
        console.log(`Sheets API failed for tab '${sheetTabName}': ${sheetsError.message}`);

        // Try without tab name
        try {
            const response = await sheets.spreadsheets.values.get({
                auth,
                spreadsheetId,
                range: `A1:Z200`,
            });
            console.log("Successfully fetched data using Sheets API without tab name");
            return response.data.values || [];
        } catch (noTabError) {
            // Check if this is an .xlsx file error
            if (noTabError.message.includes("not supported for this document") ||
                noTabError.message.includes("FAILED_PRECONDITION")) {
                console.log("Detected .xlsx file - switching to Google Drive API download...");

                // Use Google Drive API to download the .xlsx file
                try {
                    const fileResponse = await drive.files.get({
                        fileId: spreadsheetId,
                        alt: "media",
                    }, {
                        responseType: "arraybuffer",
                    });

                    console.log("Downloaded .xlsx file from Google Drive");

                    // Use JSZip to parse the xlsx file and extract style information from raw XML
                    const zip = await JSZip.loadAsync(fileResponse.data);

                    // Parse styles.xml to get font info
                    const stylesXml = await zip.file("xl/styles.xml")?.async("string");
                    const cancelledFontIds = new Set();
                    const cancelledStyleIds = new Set();

                    if (stylesXml) {
                        // Extract font definitions and find red/strikethrough fonts
                        const fontMatches = stylesXml.matchAll(/<font[^>]*>([\s\S]*?)<\/font>/gi);
                        let fontIndex = 0;
                        for (const match of fontMatches) {
                            const fontXml = match[1];
                            const isStrike = /<strike/i.test(fontXml);
                            const colorMatch = fontXml.match(/color[^>]*rgb=["']([A-Fa-f0-9]{6,8})["']/i);

                            let isRed = false;
                            if (colorMatch) {
                                // Color can be ARGB (8 chars) or RGB (6 chars)
                                // For ARGB like "FFFF0000", the last 6 chars are the RGB
                                const fullColor = colorMatch[1].toUpperCase();
                                const rgb = fullColor.length === 8 ? fullColor.slice(2) : fullColor;

                                // Check for red shades: FF0000, F60000, C00000, etc.
                                // Red has high R value (>C0), low G and B (<30)
                                if (rgb.length === 6) {
                                    const r = parseInt(rgb.slice(0, 2), 16);
                                    const g = parseInt(rgb.slice(2, 4), 16);
                                    const b = parseInt(rgb.slice(4, 6), 16);

                                    // Red: R > 200, G < 50, B < 50
                                    isRed = r > 200 && g < 50 && b < 50;
                                }
                            }

                            // Only mark as cancelled if BOTH strikethrough AND red
                            // (Based on the spreadsheet, cancelled courses have red text with strikethrough)
                            if (isStrike && isRed) {
                                cancelledFontIds.add(fontIndex);
                                console.log(`Font ${fontIndex} is cancelled: strike=${isStrike}, color=${colorMatch?.[1]}`);
                            }
                            fontIndex++;
                        }

                        // Extract cellXfs to map font IDs to style IDs
                        const cellXfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/i);
                        if (cellXfsMatch) {
                            const xfMatches = cellXfsMatch[1].matchAll(/<xf[^>]*>/gi);
                            let xfIndex = 0;
                            for (const xfMatch of xfMatches) {
                                const fontIdMatch = xfMatch[0].match(/fontId=["'](\d+)["']/i);
                                if (fontIdMatch) {
                                    const fontId = parseInt(fontIdMatch[1]);
                                    if (cancelledFontIds.has(fontId)) {
                                        cancelledStyleIds.add(xfIndex);
                                    }
                                }
                                xfIndex++;
                            }
                        }
                    }

                    console.log(`Cancelled fonts: ${cancelledFontIds.size}, Cancelled style IDs: ${cancelledStyleIds.size}`);

                    // Parse sheet XML to get cell style indices
                    const cellStyleIndices = {};
                    const sheetFiles = Object.keys(zip.files).filter(f => f.match(/xl\/worksheets\/sheet\d*\.xml/i));
                    const targetSheetFile = sheetFiles.find(f => f.includes("sheet1")) || sheetFiles[0];

                    if (targetSheetFile) {
                        const sheetXml = await zip.file(targetSheetFile)?.async("string");
                        if (sheetXml) {
                            // Parse each cell (c element) and extract style index (s attribute)
                            const cellMatches = sheetXml.matchAll(/<c\s+r=["']([A-Z]+\d+)["'][^>]*>/gi);
                            for (const match of cellMatches) {
                                const cellRef = match[1]; // e.g., "A1", "H9"
                                const styleMatch = match[0].match(/\s+s=["'](\d+)["']/i);
                                if (styleMatch) {
                                    const styleIndex = parseInt(styleMatch[1]);
                                    // Convert cell ref to row,col
                                    const decoded = XLSX.utils.decode_cell(cellRef);
                                    cellStyleIndices[`${decoded.r},${decoded.c}`] = styleIndex;
                                }
                            }
                        }
                    }

                    console.log(`Built style index map for ${Object.keys(cellStyleIndices).length} cells`);

                    // Build cancelled cells map
                    const cellStyles = {};
                    for (const [key, styleIndex] of Object.entries(cellStyleIndices)) {
                        if (cancelledStyleIds.has(styleIndex)) {
                            cellStyles[key] = { isCancelled: true };
                        }
                    }

                    console.log(`Found ${Object.keys(cellStyles).length} cells with cancelled styling`);

                    // Now parse with SheetJS for actual data
                    const workbook = XLSX.read(fileResponse.data, {
                        type: "buffer",
                        cellDates: false,
                        raw: false,
                        dateNF: "d/m/yyyy",
                    });

                    // Get the first sheet or the sheet with the specified name
                    let sheetName = workbook.SheetNames[0];
                    if (sheetTabName && workbook.SheetNames.includes(sheetTabName)) {
                        sheetName = sheetTabName;
                    }

                    console.log(`Parsing sheet: ${sheetName} (available sheets: ${workbook.SheetNames.join(", ")})`);

                    const worksheet = workbook.Sheets[sheetName];

                    // Convert to 2D array (same format as Sheets API returns)
                    // raw: false formats dates as strings, dateNF specifies the format
                    const rawData = XLSX.utils.sheet_to_json(worksheet, {
                        header: 1,  // Return as 2D array
                        defval: "", // Default value for empty cells
                        raw: false, // Format cells (dates become strings)
                        dateNF: "d/m/yyyy", // Date format to match what the parser expects
                    });

                    console.log(`Successfully parsed .xlsx file: ${rawData.length} rows`);

                    // Attach styles info to rawData for use in parsing
                    rawData._xlsxCellStyles = cellStyles;

                    return rawData;
                } catch (driveError) {
                    console.error("Failed to download/parse .xlsx file:", driveError.message);
                    throw new Error(`Unable to access .xlsx file. Make sure you have view access. Error: ${driveError.message}`);
                }
            } else {
                // Not an .xlsx file error, re-throw
                throw noTabError;
            }
        }
    }
}
/**
 * Safely convert a cell value to string
 * SheetJS may return numbers, dates, or other types
 */
function asString(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return String(value);
}


/**
 * Parse CSV data into 2D array
 * Handles quoted fields and escaped quotes
 */
function parseCSV(csvText) {
    const lines = csvText.split("\n");
    return lines.map((line) => {
        const cells = [];
        let currentCell = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === "\"") {
                if (inQuotes && nextChar === "\"") {
                    currentCell += "\"";
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === "," && !inQuotes) {
                cells.push(currentCell.trim());
                currentCell = "";
            } else {
                currentCell += char;
            }
        }
        cells.push(currentCell.trim());
        return cells;
    });
}

/**
 * Parse time slots from header row
 */
function parseTimeSlots(rawData) {
    const timeSlots = [];

    // Search for header row with time slots
    for (let rowIndex = 0; rowIndex < Math.min(rawData.length, 40); rowIndex++) {
        const row = rawData[rowIndex];
        const tempSlots = [];

        for (let i = 2; i < row.length; i++) {
            const header = asString(row[i]);
            if (header) {
                const timePattern = /(\d+[:.]\d+[AP]M)\s*-\s*(\d+[:.]\d+[AP]M)/g;
                let match;
                let lastMatch = null;

                while ((match = timePattern.exec(header)) !== null) {
                    lastMatch = match;
                }

                if (lastMatch) {
                    tempSlots.push({
                        start: lastMatch[1].replace(".", ":"),
                        end: lastMatch[2].replace(".", ":"),
                    });
                }
            }
        }

        if (tempSlots.length >= 5) {
            console.log(`Found ${tempSlots.length} time slots`);
            return tempSlots;
        }
    }

    console.warn("No valid time slot header row found!");
    return timeSlots;
}

/**
 * Check if string is a valid day
 */
function isValidDay(day) {
    const validDays = [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
        "Mon", "Tue", "Wed", "Thu", "Thurs", "Fri", "Sat", "Sun",
        "Tues", "Weds"  // Additional common abbreviations
    ];
    return validDays.some((d) => day && day.includes(d));
}

/**
 * Check if string is a valid date
 */
function isValidDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return false;
    const datePattern = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    return datePattern.test(dateStr);
}

/**
 * Parse date string to Date object
 * Format is D/M/YYYY (day/month/year)
 */
function parseDate(dateStr) {
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
        // Format is D/M/YYYY - day is first, month is second
        const day = parseInt(match[1]);
        const month = parseInt(match[2]) - 1; // Month is 0-indexed in JS
        const year = parseInt(match[3]);
        return new Date(year, month, day);
    }
    return new Date();
}

/**
 * Parse events from a cell
 * @param {boolean} isCancelled - Whether this cell is marked as cancelled (red/strikethrough)
 */
function parseCellEvents(cellValue, week, day, date, timeSlot, selectedCourses, professorCell = "", isCancelled = false) {
    const events = [];
    const lines = cellValue.split("\n").filter((line) => line.trim());
    const professorLines = professorCell.split("\n").filter((line) => line.trim());

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];

        // Try multi-section format first: CourseName-A (Location)
        let courseMatch = line.match(/([A-Z][A-Za-z0-9&-]+)-([A-Z])\s*\(([^)]+)\)/);
        let courseName, section, location, courseCode;

        if (courseMatch) {
            [, courseName, section, location] = courseMatch;
            courseCode = `${courseName}-${section}`;
        } else {
            // Try single-section format: CourseName (Location) - e.g., SHRM (PT-1-3), CSM (PT-1-2)
            const singleSectionMatch = line.match(/([A-Z][A-Za-z0-9&]+)\s*\(([^)]+)\)/);
            if (singleSectionMatch) {
                [, courseName, location] = singleSectionMatch;
                section = "1"; // Default section for single-section courses
                courseCode = courseName; // No section suffix for single-section courses
            }
        }

        if (courseCode && selectedCourses.includes(courseCode)) {
            const professor = professorLines[lineIndex] || professorLines[0] || "";

            const event = {
                id: `${courseCode}-${location}-${date.toISOString()}-${timeSlot.start}`,
                courseCode,
                courseName,
                section,
                location,
                professor: professor.trim(),
                date,
                timeSlot,
                week,
                day,
                status: isCancelled ? "cancelled" : "active",
                isCancelled: isCancelled,
                isRed: isCancelled,
                hasStrikethrough: isCancelled,
            };

            events.push(event);
        }
    }

    return events;
}

/**
 * Extract all unique courses from sheet
 */
function extractCourses(rawData) {
    const coursesSet = new Set();
    const courses = [];

    for (let i = 2; i < rawData.length; i++) {
        const row = rawData[i];
        for (let j = 2; j < row.length; j++) {
            const cell = asString(row[j]);
            if (cell) {
                // Match multi-section courses: CourseName-A (Location)
                const multiSectionMatches = cell.match(/([A-Z][A-Za-z0-9&-]+)-([A-Z])\s*\(([^)]+)\)/g);
                if (multiSectionMatches) {
                    multiSectionMatches.forEach((match) => {
                        const courseMatch = match.match(/([A-Z][A-Za-z0-9&-]+)-([A-Z])\s*\(([^)]+)\)/);
                        if (courseMatch) {
                            const [, courseName, section] = courseMatch;
                            const code = `${courseName}-${section}`;

                            if (!coursesSet.has(code)) {
                                coursesSet.add(code);
                                courses.push({
                                    id: code.replace(/\s+/g, "-").toLowerCase(),
                                    code: code,
                                    name: courseName,
                                    section: section,
                                    location: "",
                                });
                            }
                        }
                    });
                }

                // Match single-section courses: CourseName (Location) - e.g., SHRM, CSM, I4TS
                // Only match if it's NOT already a multi-section format
                const singleSectionMatches = cell.match(/\b([A-Z][A-Za-z0-9&]+)\s*\(([^)]+)\)/g);
                if (singleSectionMatches) {
                    singleSectionMatches.forEach((match) => {
                        // Skip if this looks like a multi-section course (has -X before the parenthesis)
                        if (/-[A-Z]\s*\(/.test(match)) return;

                        const singleMatch = match.match(/\b([A-Z][A-Za-z0-9&]+)\s*\(([^)]+)\)/);
                        if (singleMatch) {
                            const [, courseName] = singleMatch;
                            const code = courseName; // No section suffix

                            if (!coursesSet.has(code)) {
                                coursesSet.add(code);
                                courses.push({
                                    id: code.replace(/\s+/g, "-").toLowerCase(),
                                    code: code,
                                    name: courseName,
                                    section: "1", // Default section
                                    location: "",
                                });
                            }
                        }
                    });
                }
            }
        }
    }

    // Sort courses alphabetically by code
    return courses.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Parse schedule events from raw data
 */
function parseScheduleEvents(rawData, selectedCourses) {
    const events = [];
    const timeSlots = parseTimeSlots(rawData);

    if (timeSlots.length === 0) {
        console.error("No time slots found!");
        return events;
    }

    // Get cell styles from .xlsx parsing (if available)
    const cellStyles = rawData._xlsxCellStyles || {};
    const hasCellStyles = Object.keys(cellStyles).length > 0;
    if (hasCellStyles) {
        console.log("Using cell styles to detect cancelled courses");
    }

    // Helper function to check if a cell is cancelled
    const isCellCancelled = (rowIndex, colIndex) => {
        const key = `${rowIndex},${colIndex}`;
        return cellStyles[key]?.isCancelled || false;
    };

    let currentWeek = 1;
    let currentDate = new Date();

    for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];

        // Check for week info - use asString for safe string conversion
        const cell0 = asString(row[0]);
        if (cell0 && cell0.includes("Week")) {
            const weekMatch = cell0.match(/Week\s+(\d+)/);
            if (weekMatch) {
                currentWeek = parseInt(weekMatch[1]);
            }
        }

        // Check for date
        if (cell0 && isValidDate(cell0)) {
            currentDate = parseDate(cell0);
            console.log(`Found date ${cell0} -> ${currentDate.toDateString()} at row ${i}`);
        }

        // Check for day - use asString for safe string conversion
        const day = asString(row[1]);
        if (day && isValidDay(day)) {
            console.log(`Processing day ${day} at row ${i}, date: ${currentDate.toDateString()}`);
            // Process all 4 rows for this day
            const firstCourseRow = row;
            const firstProfRow = i + 1 < rawData.length ? rawData[i + 1] : [];
            const secondCourseRow = i + 2 < rawData.length ? rawData[i + 2] : [];
            const secondProfRow = i + 3 < rawData.length ? rawData[i + 3] : [];

            // First set of courses
            for (let j = 2; j < Math.min(firstCourseRow.length, timeSlots.length + 2); j++) {
                const cell = asString(firstCourseRow[j]);
                const professorCell = asString(firstProfRow[j]);
                const timeSlot = timeSlots[j - 2];

                // Check if this cell is cancelled (red/strikethrough)
                const isCancelled = isCellCancelled(i, j);

                if (cell && timeSlot) {
                    const cellEvents = parseCellEvents(
                        cell,
                        currentWeek,
                        day,
                        currentDate,
                        timeSlot,
                        selectedCourses,
                        professorCell,
                        isCancelled,
                    );
                    events.push(...cellEvents);
                }
            }

            // Second set of courses (row i+2)
            for (let j = 2; j < Math.min(secondCourseRow.length, timeSlots.length + 2); j++) {
                const cell = asString(secondCourseRow[j]);
                const professorCell = asString(secondProfRow[j]);
                const timeSlot = timeSlots[j - 2];

                // Check if this cell is cancelled (red/strikethrough)
                const isCancelled = isCellCancelled(i + 2, j);

                if (cell && timeSlot) {
                    const cellEvents = parseCellEvents(
                        cell,
                        currentWeek,
                        day,
                        currentDate,
                        timeSlot,
                        selectedCourses,
                        professorCell,
                        isCancelled,
                    );
                    events.push(...cellEvents);
                }
            }
        }
    }

    // Log cancelled events count
    const cancelledEvents = events.filter(e => e.isCancelled);
    if (cancelledEvents.length > 0) {
        console.log(`Found ${cancelledEvents.length} cancelled events out of ${events.length} total`);
    }

    return events;
}

/**
 * Refresh OAuth token if expired
 */
async function refreshOAuthToken(userId, refreshToken) {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.VITE_GOOGLE_CLIENT_ID,
            process.env.VITE_GOOGLE_CLIENT_SECRET,
        );

        oauth2Client.setCredentials({
            refresh_token: refreshToken,
        });

        const { credentials } = await oauth2Client.refreshAccessToken();

        // Store new token in Firestore
        const db = admin.firestore();
        await db.collection("users").doc(userId).update({
            "oauthTokens.accessToken": credentials.access_token,
            "oauthTokens.expiresAt": new Date(credentials.expiry_date),
        });

        return credentials.access_token;
    } catch (error) {
        console.error("Failed to refresh token:", error);
        throw error;
    }
}

/**
 * Sync events to user's Google Calendar
 */
async function syncUserCalendar(user, allEvents, accessToken) {
    try {
        // Filter events for user's courses and exclude cancelled
        const userEvents = allEvents.filter((event) =>
            user.selectedCourses &&
            user.selectedCourses.includes(event.courseCode) &&
            !event.isCancelled,
        );

        // Initialize Google Calendar API
        const calendar = google.calendar({ version: "v3" });
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        // Find the correct calendar ID - either stored ID or find by name
        let calendarId = user.calendarId;

        // If no calendar ID stored, or if stored calendar doesn't exist, find MBA calendar
        if (!calendarId) {
            // No calendar ID stored - need to search for MBA calendar
            const calendarList = await calendar.calendarList.list({ auth });
            const mbaCalendar = calendarList.data.items?.find(
                cal => cal.summary?.toLowerCase().includes('mba') &&
                    cal.summary?.toLowerCase().includes('term')
            );

            if (mbaCalendar) {
                calendarId = mbaCalendar.id;
                console.log(`   Found MBA calendar: ${mbaCalendar.summary} (${calendarId})`);

                // Update the stored calendar ID in Firestore
                const db = admin.firestore();
                await db.collection("users").doc(user.uid || user.id).update({
                    calendarId: calendarId,
                });
            } else {
                throw new Error("No 'MBA term' calendar found. Please add events from the app first to create the calendar.");
            }
        }

        // Try to verify the stored calendar exists
        try {
            await calendar.calendars.get({ auth, calendarId });
        } catch (calendarError) {
            console.log(`   Stored calendar ${calendarId} not found, searching for MBA calendar...`);

            // Search for the calendar by name
            const calendarList = await calendar.calendarList.list({ auth });
            const mbaCalendar = calendarList.data.items?.find(
                cal => cal.summary?.toLowerCase().includes('mba') &&
                    cal.summary?.toLowerCase().includes('term')
            );

            if (mbaCalendar) {
                calendarId = mbaCalendar.id;
                console.log(`   Found MBA calendar: ${mbaCalendar.summary} (${calendarId})`);

                // Update the stored calendar ID in Firestore
                const db = admin.firestore();
                await db.collection("users").doc(user.uid || user.id).update({
                    calendarId: calendarId,
                });
            } else {
                // No MBA calendar found - user needs to set up calendar first via frontend
                throw new Error("No 'MBA term' calendar found. Please add events from the app first to create the calendar.");
            }
        }

        console.log(`   Using calendar: ${calendarId}`);

        // Get existing events created by this app
        // Look at ALL events from term start to 3 months from now
        // This ensures we can clean up old wrong events
        const termStart = new Date('2025-12-29');  // Start of Term 6
        const threeMonthsFromNow = new Date();
        threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

        const existingEventsRes = await calendar.events.list({
            auth,
            calendarId: calendarId,
            timeMin: termStart.toISOString(),
            timeMax: threeMonthsFromNow.toISOString(),
            // NOTE: Don't filter by appCreated - frontend events don't have this marker
            // We'll match by summary (title) + date + time instead
            maxResults: 2500,
        });

        const existingEvents = existingEventsRes.data.items || [];
        console.log(`   Found ${existingEvents.length} existing calendar events`);

        // Build two maps for existing events:
        // 1. By full scheduleEventId (for exact match)
        // 2. By base key (courseCode-date-time) for detecting location changes
        const existingEventsMap = new Map();
        const existingEventsByBaseKey = new Map();
        const existingEventsBySummaryKey = new Map();  // Fallback: match by title+date+time

        existingEvents.forEach((e) => {
            const scheduleId = e.extendedProperties?.private?.scheduleEventId;
            const courseCode = e.extendedProperties?.private?.courseCode;
            if (scheduleId) {
                existingEventsMap.set(scheduleId, e);

                // Extract base key from the event (courseCode + date + time, excluding location)
                // Use local date/time from Google Calendar event (already in correct timezone)
                if (courseCode && e.start?.dateTime) {
                    const eventDate = new Date(e.start.dateTime);
                    // Use local date parts to create consistent key
                    const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
                    const timeStr = `${eventDate.getHours()}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
                    const baseKey = `${courseCode}-${dateStr}-${timeStr}`;
                    existingEventsByBaseKey.set(baseKey, e);
                    console.log(`   Existing event baseKey: ${baseKey}, location: ${e.location || 'N/A'}`);
                }
            }

            // Also create a fallback key using the event summary (title) + date + time
            // This helps match events even if courseCode extended property is missing
            if (e.start?.dateTime && e.summary) {
                const eventDate = new Date(e.start.dateTime);
                const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
                const timeStr = `${eventDate.getHours()}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
                const summaryKey = `${e.summary}-${dateStr}-${timeStr}`;
                existingEventsBySummaryKey.set(summaryKey, e);
            }
        });

        // Create map of new events with base key for comparison
        const newEventsMap = new Map(userEvents.map((e) => [e.id, e]));
        const newEventsByBaseKey = new Map();
        userEvents.forEach((e) => {
            const eventDate = new Date(e.date);
            const [hours, minutes] = parseTimeForKey(e.timeSlot.start);
            // Use local date parts to create consistent key
            const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
            const timeStr = `${hours}:${String(minutes).padStart(2, '0')}`;
            const baseKey = `${e.courseCode}-${dateStr}-${timeStr}`;
            newEventsByBaseKey.set(baseKey, e);
        });

        let created = 0;
        let updated = 0;
        let deleted = 0;

        const BATCH_SIZE = 5;

        // Process events: create new ones and update existing ones with changed details
        const eventsToCreate = [];
        const eventsToUpdate = [];

        for (const event of userEvents) {
            const exactMatch = existingEventsMap.get(event.id);
            if (exactMatch) {
                // Exact match exists - check if we need to update any details
                if (exactMatch.location !== event.location ||
                    !exactMatch.description?.includes(event.professor)) {
                    eventsToUpdate.push({ existing: exactMatch, new: event });
                    console.log(`   Will update (exact match, details changed): ${event.courseCode} - ${event.location}`);
                }
            } else {
                // No exact match - check if there's an event with same base key but different location
                const eventDate = new Date(event.date);
                const [hours, minutes] = parseTimeForKey(event.timeSlot.start);
                const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
                const timeStr = `${hours}:${String(minutes).padStart(2, '0')}`;
                const baseKey = `${event.courseCode}-${dateStr}-${timeStr}`;

                const baseMatch = existingEventsByBaseKey.get(baseKey);
                if (baseMatch) {
                    // Location changed - update the existing event
                    eventsToUpdate.push({ existing: baseMatch, new: event });
                    console.log(`   Will update (location changed): ${event.courseCode} from ${baseMatch.location} to ${event.location}`);
                } else {
                    // Try fallback: match by summary (title) + date + time
                    const summaryKey = `${event.courseName}-${event.section}-${dateStr}-${timeStr}`;
                    const summaryMatch = existingEventsBySummaryKey.get(summaryKey);
                    if (summaryMatch) {
                        eventsToUpdate.push({ existing: summaryMatch, new: event });
                        console.log(`   Will update (fallback match by title): ${event.courseCode} from ${summaryMatch.location} to ${event.location}`);
                    } else {
                        // Truly new event
                        eventsToCreate.push(event);
                        console.log(`   Will create new: ${event.courseCode} - ${event.location} (baseKey: ${baseKey})`);
                    }
                }
            }
        }

        console.log(`   Events to create: ${eventsToCreate.length}, Events to update: ${eventsToUpdate.length}`);

        // Create new events in batches
        for (let i = 0; i < eventsToCreate.length; i += BATCH_SIZE) {
            const batch = eventsToCreate.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (event) => {
                try {
                    await calendar.events.insert({
                        auth,
                        calendarId: calendarId,
                        resource: {
                            summary: `${event.courseName}-${event.section}`,
                            location: event.location,
                            description: `Professor: ${event.professor}\nLocation: ${event.location}\nWeek: ${event.week}`,
                            start: {
                                dateTime: createDateTime(event.date, event.timeSlot.start),
                                timeZone: "Asia/Kolkata",
                            },
                            end: {
                                dateTime: createDateTime(event.date, event.timeSlot.end),
                                timeZone: "Asia/Kolkata",
                            },
                            colorId: "9",
                            reminders: {
                                useDefault: false,
                                overrides: [
                                    { method: "popup", minutes: 10 },
                                ],
                            },
                            extendedProperties: {
                                private: {
                                    scheduleEventId: event.id,
                                    courseCode: event.courseCode,
                                    appCreated: "true",
                                },
                            },
                        },
                    });
                    created++;
                } catch (err) {
                    console.error(`Failed to create event ${event.id}:`, err.message);
                }
            }));
        }

        // Update events with changed details (location, professor, etc.) in batches
        for (let i = 0; i < eventsToUpdate.length; i += BATCH_SIZE) {
            const batch = eventsToUpdate.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async ({ existing, new: event }) => {
                try {
                    await calendar.events.update({
                        auth,
                        calendarId: calendarId,
                        eventId: existing.id,
                        resource: {
                            summary: `${event.courseName}-${event.section}`,
                            location: event.location,
                            description: `Professor: ${event.professor}\nLocation: ${event.location}\nWeek: ${event.week}`,
                            start: {
                                dateTime: createDateTime(event.date, event.timeSlot.start),
                                timeZone: "Asia/Kolkata",
                            },
                            end: {
                                dateTime: createDateTime(event.date, event.timeSlot.end),
                                timeZone: "Asia/Kolkata",
                            },
                            colorId: "9",
                            reminders: {
                                useDefault: false,
                                overrides: [
                                    { method: "popup", minutes: 10 },
                                ],
                            },
                            extendedProperties: {
                                private: {
                                    scheduleEventId: event.id,
                                    courseCode: event.courseCode,
                                    appCreated: "true",
                                },
                            },
                        },
                    });
                    updated++;
                    console.log(`Updated event: ${event.courseCode} - location: ${event.location}`);
                } catch (err) {
                    console.error(`Failed to update event ${event.id}:`, err.message);
                }
            }));
        }

        // Delete events that no longer exist in schedule
        // Build set of base keys from new events to avoid deleting events that just got their location changed
        const newBaseKeys = new Set();
        userEvents.forEach((e) => {
            const eventDate = new Date(e.date);
            const [hours, minutes] = parseTimeForKey(e.timeSlot.start);
            const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
            const timeStr = `${hours}:${String(minutes).padStart(2, '0')}`;
            const baseKey = `${e.courseCode}-${dateStr}-${timeStr}`;
            newBaseKeys.add(baseKey);
        });

        const eventsToDelete = existingEvents.filter(existingEvent => {
            const scheduleId = existingEvent.extendedProperties?.private?.scheduleEventId;
            const courseCode = existingEvent.extendedProperties?.private?.courseCode;

            // 1. Check if this event matches a new event by scheduleId
            if (scheduleId && newEventsMap.has(scheduleId)) {
                return false;  // Exact match, keep it
            }

            // 2. Check if this event matches a new event by base key (courseCode-date-time)
            if (courseCode && existingEvent.start?.dateTime) {
                const eventDate = new Date(existingEvent.start.dateTime);
                const dateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
                const timeStr = `${eventDate.getHours()}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
                const baseKey = `${courseCode}-${dateStr}-${timeStr}`;

                if (newBaseKeys.has(baseKey)) {
                    return false;  // Base key match, keep it (will be updated if needed)
                }
            }

            // 3. Check if this event is for a course the user still has selected
            // If the courseCode doesn't match any of user's selected courses, delete it
            if (courseCode && !user.selectedCourses?.includes(courseCode)) {
                console.log(`   Will delete: ${existingEvent.summary} - course not selected`);
                return true;  // Course not selected anymore, delete
            }

            // 4. If we have a scheduleId but it's not in new events, delete it
            // This means the schedule changed and this event no longer exists
            if (scheduleId) {
                console.log(`   Will delete: ${existingEvent.summary} - not in schedule anymore`);
                return true;
            }

            // 5. If event has appCreated=true but no scheduleId, it's an orphan - delete it
            return true;
        });

        for (let i = 0; i < eventsToDelete.length; i += BATCH_SIZE) {
            const batch = eventsToDelete.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (existingEvent) => {
                try {
                    await calendar.events.delete({
                        auth,
                        calendarId: calendarId,
                        eventId: existingEvent.id,
                    });
                    deleted++;
                } catch (err) {
                    console.error(`Failed to delete event ${existingEvent.id}:`, err.message);
                }
            }));
        }

        return { created, updated, deleted };
    } catch (error) {
        console.error("Error syncing calendar:", error);
        throw error;
    }
}

/**
 * Create ISO datetime string for calendar event
 * Returns local datetime string (without Z) so Google Calendar uses the timeZone field
 */
function createDateTime(date, time) {
    const timeMatch = time.match(/(\d+):(\d+)(AM|PM)/i);
    if (!timeMatch) {
        console.error(`❌ createDateTime: Invalid time format "${time}" - falling back to current time!`);
        // Return current time in IST format
        const now = new Date();
        return formatLocalDateTime(now);
    }

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const period = timeMatch[3].toUpperCase();

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    // Create date object from the input date
    const inputDate = new Date(date);

    // Build the datetime string in local format (no Z suffix)
    // This allows Google Calendar to interpret it using the timeZone field we provide
    const year = inputDate.getFullYear();
    const month = String(inputDate.getMonth() + 1).padStart(2, '0');
    const day = String(inputDate.getDate()).padStart(2, '0');
    const hourStr = String(hours).padStart(2, '0');
    const minuteStr = String(minutes).padStart(2, '0');

    // Return ISO 8601 format WITHOUT timezone suffix
    // Google Calendar will interpret this using the timeZone: "Asia/Kolkata" we specify
    return `${year}-${month}-${day}T${hourStr}:${minuteStr}:00`;
}

/**
 * Helper to format date as local ISO string
 */
function formatLocalDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}

/**
 * Parse time string to hours and minutes for generating consistent base keys
 * Returns [hours, minutes] in 24-hour format
 */
function parseTimeForKey(time) {
    const timeMatch = time.match(/(\d+):(\d+)(AM|PM)/);
    if (!timeMatch) return [0, 0];

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const period = timeMatch[3];

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    return [hours, minutes];
}


/**
 * Manual sync function - callable by admin from frontend
 * Same logic as daily sync but triggered on demand
 * Rate limited: Max 10 calls per hour, 50 per day
 */
exports.manualSync = onCall({
    memory: "512MiB",
    timeoutSeconds: 540,
}, async (request) => {
    // Verify admin email
    const adminEmail = "saptarshi.dasi21@iimranchi.ac.in";
    if (!request.auth || request.auth.token.email !== adminEmail) {
        throw new Error("Unauthorized: Only admin can trigger manual sync");
    }

    // Rate limiting check
    const db = admin.firestore();
    const rateLimitRef = db.collection("rateLimits").doc("manualSync");
    const rateLimitDoc = await rateLimitRef.get();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    if (rateLimitDoc.exists) {
        const data = rateLimitDoc.data();
        const calls = data.calls || [];

        // Filter calls within the last hour and day
        const callsLastHour = calls.filter(c => new Date(c) > oneHourAgo);
        const callsLastDay = calls.filter(c => new Date(c) > oneDayAgo);

        if (callsLastHour.length >= 10) {
            throw new Error("Rate limit exceeded: Maximum 10 syncs per hour. Please wait.");
        }
        if (callsLastDay.length >= 50) {
            throw new Error("Rate limit exceeded: Maximum 50 syncs per day. Please wait until tomorrow.");
        }
    }

    // Log this call for rate limiting (reuse existing variables)
    const existingCalls = rateLimitDoc.exists ? (rateLimitDoc.data().calls || []) : [];
    const recentCalls = existingCalls.filter(c => new Date(c) > oneDayAgo);
    await rateLimitRef.set({ calls: [...recentCalls, now.toISOString()] });

    console.log("🚀 Starting MANUAL calendar sync (triggered by admin)");

    try {

        // 1. Load sheet ID from configuration
        console.log("📋 Loading sheet configuration...");
        const configDoc = await db.collection("config").doc("settings").get();

        if (!configDoc.exists) {
            throw new Error("Configuration not found. Please set the sheet URL in settings.");
        }

        const config = configDoc.data();
        const CURRENT_SHEET_ID = config.scheduleSheetId;
        const sheetTabName = config.sheetTabName || DEFAULT_SHEET_NAME;
        const sheetGid = config.sheetGid; // GID for .xlsx file support

        if (!CURRENT_SHEET_ID) {
            throw new Error("Sheet ID not configured. Please set it in settings.");
        }

        console.log(`📋 Using sheet ID: ${CURRENT_SHEET_ID}, tab: ${sheetTabName}, GID: ${sheetGid}`);

        // 2. Get admin user's OAuth token
        console.log("🔐 Loading admin credentials...");
        const adminConfigDoc = await db.collection("config").doc("adminUser").get();

        if (!adminConfigDoc.exists) {
            throw new Error("Admin user not configured. Please log in first.");
        }

        const adminConfig = adminConfigDoc.data();
        let accessToken = adminConfig.oauthTokens?.accessToken;
        const refreshToken = adminConfig.oauthTokens?.refreshToken;
        const expiresAt = adminConfig.oauthTokens?.expiresAt?.toDate();

        // Refresh token if expired
        if (!accessToken || (expiresAt && expiresAt < new Date())) {
            console.log("🔄 Refreshing admin token...");
            const oauth2Client = new google.auth.OAuth2(
                process.env.VITE_GOOGLE_CLIENT_ID,
                process.env.VITE_GOOGLE_CLIENT_SECRET,
            );

            oauth2Client.setCredentials({
                refresh_token: refreshToken,
            });

            const { credentials } = await oauth2Client.refreshAccessToken();
            accessToken = credentials.access_token;

            await db.collection("config").doc("adminUser").update({
                "oauthTokens.accessToken": accessToken,
                "oauthTokens.expiresAt": new Date(credentials.expiry_date),
            });
        }

        // 3. Fetch restricted sheet
        console.log("📊 Fetching restricted sheet data...");

        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        // Use the unified fetchSheetData function that handles both native sheets and .xlsx files
        const rawData = await fetchSheetData(auth, CURRENT_SHEET_ID, sheetTabName);
        console.log(`📊 Fetched ${rawData.length} rows from sheet`);

        // 4. Extract courses and events
        const courses = extractCourses(rawData);
        console.log(`📚 Found ${courses.length} unique courses`);
        console.log(`📚 Course codes: ${courses.map(c => c.code).join(', ')}`);

        const allCourses = courses.map((c) => c.code);
        const events = parseScheduleEvents(rawData, allCourses);
        console.log(`📅 Parsed ${events.length} total events`);

        // 5. Update Firestore
        await db.collection("schedule").doc("courses").set({
            courses,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection("schedule").doc("events").set({
            events: events.map((e) => ({
                ...e,
                date: e.date.toISOString(),
            })),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("💾 Updated Firestore");

        // 6. Sync all users' calendars
        const usersSnapshot = await db.collection("users")
            .where("isSynced", "==", true)
            .get();
        console.log(`👥 Found ${usersSnapshot.size} synced users`);

        let successCount = 0;
        let errorCount = 0;

        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            try {
                let userAccessToken = userData.oauthTokens?.accessToken;
                const userExpiresAt = userData.oauthTokens?.expiresAt?.toDate();
                const userRefreshToken = userData.oauthTokens?.refreshToken;

                // Check if user has connected their calendar (has refresh token)
                if (!userRefreshToken) {
                    console.log(`⏭️ Skipping ${userData.email} - no refresh token (needs to click Connect Calendar)`);
                    continue;
                }

                if (!userAccessToken || (userExpiresAt && userExpiresAt < new Date())) {
                    console.log(`🔄 Refreshing token for ${userData.email}`);
                    userAccessToken = await refreshOAuthToken(
                        userDoc.id,
                        userRefreshToken,
                    );
                }

                const stats = await syncUserCalendar(userData, events, userAccessToken);
                console.log(`✅ ${userData.email}: +${stats.created} events, -${stats.deleted} events`);
                successCount++;
            } catch (error) {
                console.error(`❌ Failed to sync ${userData.email}:`, error.message);
                errorCount++;
            }
        }

        console.log(`🎉 Manual sync complete: ${successCount} success, ${errorCount} errors`);

        return {
            success: true,
            message: `Synced ${successCount} users successfully`,
            usersProcessed: usersSnapshot.size,
            successCount,
            errorCount,
            eventsTotal: events.length,
            coursesTotal: courses.length,
        };
    } catch (error) {
        console.error("💥 Manual sync failed:", error);
        throw new Error(error.message || "Sync failed");
    }
});

/**
 * Exchange OAuth authorization code for tokens
 * This is needed because Firebase Auth doesn't provide Google OAuth refresh tokens
 * The frontend sends the auth code, and we exchange it for access + refresh tokens
 * Rate limited: Max 20 calls per hour per IP
 */
exports.exchangeOAuthCode = onRequest({
    cors: true,
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (req, res) => {
    // Only allow POST
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    // Rate limiting by IP
    const clientIp = req.headers["x-forwarded-for"] || req.connection.remoteAddress || "unknown";
    const ipHash = Buffer.from(clientIp).toString("base64").slice(0, 20); // Hash IP for privacy

    const db = admin.firestore();
    const rateLimitRef = db.collection("rateLimits").doc(`oauth_${ipHash}`);
    const rateLimitDoc = await rateLimitRef.get();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (rateLimitDoc.exists) {
        const data = rateLimitDoc.data();
        const calls = (data.calls || []).filter(c => new Date(c) > oneHourAgo);

        if (calls.length >= 20) {
            res.status(429).json({ error: "Rate limit exceeded: Too many requests. Please wait an hour." });
            return;
        }

        // Update rate limit record
        await rateLimitRef.set({ calls: [...calls, now.toISOString()] });
    } else {
        // Create new rate limit record
        await rateLimitRef.set({ calls: [now.toISOString()] });
    }

    try {
        const { code, codeVerifier, redirectUri } = req.body;

        if (!code || !codeVerifier || !redirectUri) {
            res.status(400).json({ error: "Missing required parameters: code, codeVerifier, redirectUri" });
            return;
        }

        console.log("🔐 Exchanging OAuth code for tokens...");

        // Exchange the authorization code for tokens
        const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
            code,
            client_id: process.env.VITE_GOOGLE_CLIENT_ID,
            client_secret: process.env.VITE_GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
        });

        const tokens = tokenResponse.data;

        if (!tokens.refresh_token) {
            console.warn("⚠️ No refresh token received - user may have already authorized this app");
        } else {
            console.log("✅ Got refresh token!");
        }

        // Get user email from the access token
        const userInfoResponse = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const email = userInfoResponse.data.email;
        console.log(`✅ OAuth exchange successful for ${email}`);

        res.json({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
            email: email,
        });

    } catch (error) {
        console.error("❌ OAuth code exchange failed:", error.response?.data || error.message);
        res.status(500).json({
            error: error.response?.data?.error_description || error.message || "Failed to exchange OAuth code",
        });
    }
});

/**
 * Daily Calendar Sync - Runs automatically at 2 AM IST (8:30 PM UTC previous day)
 * This function:
 * 1. Uses admin's refresh token to get a fresh access token
 * 2. Scrapes the .xlsx schedule from Google Drive
 * 3. Updates Firestore with latest schedule data
 * 4. Syncs all subscribed users' calendars
 */
exports.dailyCalendarSync = onSchedule({
    schedule: "0 2 * * *", // 2:00 AM IST
    timeZone: "Asia/Kolkata",
    memory: "512MiB",
    timeoutSeconds: 540,
}, async (event) => {
    console.log("🕐 Starting DAILY calendar sync at", new Date().toISOString());

    try {
        const db = admin.firestore();

        // 1. Load sheet configuration
        console.log("📋 Loading sheet configuration...");
        const configDoc = await db.collection("config").doc("settings").get();

        if (!configDoc.exists) {
            console.error("❌ Configuration not found");
            return;
        }

        const config = configDoc.data();
        const CURRENT_SHEET_ID = config.scheduleSheetId;
        const sheetTabName = config.sheetTabName || DEFAULT_SHEET_NAME;

        if (!CURRENT_SHEET_ID) {
            console.error("❌ Sheet ID not configured");
            return;
        }

        console.log(`📋 Using sheet ID: ${CURRENT_SHEET_ID}, tab: ${sheetTabName}`);

        // 2. Get admin user's OAuth tokens
        console.log("🔐 Loading admin credentials...");
        const adminConfigDoc = await db.collection("config").doc("adminUser").get();

        if (!adminConfigDoc.exists) {
            console.error("❌ Admin user not configured. Admin needs to log in first.");
            return;
        }

        const adminConfig = adminConfigDoc.data();
        const refreshToken = adminConfig.oauthTokens?.refreshToken;

        if (!refreshToken) {
            console.error("❌ No refresh token found for admin. Admin needs to re-authenticate.");
            return;
        }

        // 3. Use refresh token to get new access token
        console.log("🔄 Refreshing admin access token...");
        const oauth2Client = new google.auth.OAuth2(
            process.env.VITE_GOOGLE_CLIENT_ID,
            process.env.VITE_GOOGLE_CLIENT_SECRET,
        );

        oauth2Client.setCredentials({
            refresh_token: refreshToken,
        });

        let accessToken;
        try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            accessToken = credentials.access_token;

            // Store the new access token
            await db.collection("config").doc("adminUser").update({
                "oauthTokens.accessToken": accessToken,
                "oauthTokens.expiresAt": new Date(credentials.expiry_date),
            });
            console.log("✅ Access token refreshed successfully");
        } catch (refreshError) {
            console.error("❌ Failed to refresh access token:", refreshError.message);
            console.error("   Admin needs to re-authenticate via the app");
            return;
        }

        // 4. Fetch the sheet data
        console.log("📊 Fetching sheet data...");
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const rawData = await fetchSheetData(auth, CURRENT_SHEET_ID, sheetTabName);
        console.log(`📊 Fetched ${rawData.length} rows from sheet`);

        // 5. Extract courses and events
        const courses = extractCourses(rawData);
        console.log(`📚 Found ${courses.length} unique courses`);

        const allCourses = courses.map((c) => c.code);
        const events = parseScheduleEvents(rawData, allCourses);
        console.log(`📅 Parsed ${events.length} total events`);

        // 6. Update Firestore
        await db.collection("schedule").doc("courses").set({
            courses,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection("schedule").doc("events").set({
            events: events.map((e) => ({
                ...e,
                date: e.date.toISOString(),
            })),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("💾 Updated Firestore with latest schedule");

        // 7. Sync all subscribed users' calendars
        const usersSnapshot = await db.collection("users")
            .where("isSynced", "==", true)
            .where("syncEnabled", "!=", false)
            .get();
        console.log(`👥 Found ${usersSnapshot.size} users to sync`);

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            try {
                // Try to get/refresh user's access token
                let userAccessToken = userData.oauthTokens?.accessToken;
                const userRefreshToken = userData.oauthTokens?.refreshToken;
                const userExpiresAt = userData.oauthTokens?.expiresAt?.toDate();

                // Check if we need to refresh the token
                if (!userAccessToken || (userExpiresAt && userExpiresAt < new Date())) {
                    if (!userRefreshToken) {
                        console.log(`⚠️ No refresh token for ${userData.email} - skipping`);
                        errorCount++;
                        errors.push({ email: userData.email, error: "No refresh token" });
                        continue;
                    }

                    console.log(`🔄 Refreshing token for ${userData.email}`);
                    try {
                        userAccessToken = await refreshOAuthToken(userDoc.id, userRefreshToken);
                    } catch (tokenError) {
                        console.error(`❌ Token refresh failed for ${userData.email}:`, tokenError.message);
                        // Mark user as needing re-authentication
                        await db.collection("users").doc(userDoc.id).update({
                            needsReauth: true,
                            lastAuthError: tokenError.message,
                        });
                        errorCount++;
                        errors.push({ email: userData.email, error: tokenError.message });
                        continue;
                    }
                }

                // Sync the user's calendar
                const stats = await syncUserCalendar(userData, events, userAccessToken);
                console.log(`✅ ${userData.email}: +${stats.created} events, -${stats.deleted} events`);
                successCount++;

            } catch (error) {
                console.error(`❌ Failed to sync ${userData.email}:`, error.message);
                errorCount++;
                errors.push({ email: userData.email, error: error.message });
            }
        }

        console.log("═══════════════════════════════════════════════════");
        console.log(`🎉 Daily sync complete!`);
        console.log(`   📊 Events: ${events.length} total`);
        console.log(`   👥 Users: ${successCount} success, ${errorCount} failed`);
        console.log("═══════════════════════════════════════════════════");

    } catch (error) {
        console.error("💥 Daily sync failed:", error);
    }
});

/**
 * Connect Calendar and Sync - Called when user clicks "Connect Calendar"
 * 1. Saves user's OAuth tokens
 * 2. Cleans up ALL old app-created calendar events
 * 3. Syncs fresh events immediately
 */
exports.connectCalendarAndSync = onCall({
    memory: "512MiB",
    timeoutSeconds: 300,
}, async (request) => {
    const db = admin.firestore();

    // Verify authentication
    if (!request.auth) {
        throw new Error("Authentication required");
    }

    const userId = request.auth.uid;
    const userEmail = request.auth.token.email || "";

    // Get tokens from request
    const { accessToken, refreshToken, expiresAt } = request.data;

    if (!accessToken || !refreshToken) {
        throw new Error("Missing OAuth tokens");
    }

    console.log(`🔗 Connect Calendar request from ${userEmail}`);

    try {
        // 1. Save OAuth tokens to user document
        const userRef = db.collection("users").doc(userId);
        await userRef.set({
            oauthTokens: {
                accessToken,
                refreshToken,
                expiresAt: new Date(expiresAt),
            },
            calendarConnected: true,
            calendarConnectedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log(`✅ Saved OAuth tokens for ${userEmail}`);

        // 2. Get user's calendar ID and selected courses
        const userDoc = await userRef.get();
        const userData = userDoc.data();

        if (!userData?.selectedCourses || userData.selectedCourses.length === 0) {
            throw new Error("No courses selected. Please select courses first.");
        }

        const calendarId = userData.calendarId || "primary";
        console.log(`📅 Using calendar: ${calendarId}`);

        // 3. Initialize Google Calendar API
        const calendar = google.calendar({ version: "v3" });
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        // 4. Delete ALL existing app-created events
        console.log(`🧹 Cleaning up old events...`);
        let deletedCount = 0;
        let pageToken = null;

        do {
            const existingEvents = await calendar.events.list({
                auth,
                calendarId: calendarId,
                privateExtendedProperty: "appCreated=true",
                maxResults: 250,
                pageToken: pageToken,
            });

            const events = existingEvents.data.items || [];

            // Delete events in batches
            for (const event of events) {
                try {
                    await calendar.events.delete({
                        auth,
                        calendarId: calendarId,
                        eventId: event.id,
                    });
                    deletedCount++;
                } catch (deleteError) {
                    console.warn(`Failed to delete event ${event.id}:`, deleteError.message);
                }
            }

            pageToken = existingEvents.data.nextPageToken;
        } while (pageToken);

        console.log(`🧹 Deleted ${deletedCount} old events`);

        // 5. Get fresh events from Firestore
        const eventsDoc = await db.collection("schedule").doc("events").get();
        if (!eventsDoc.exists) {
            throw new Error("No schedule data available. Admin needs to sync first.");
        }

        const allEvents = (eventsDoc.data()?.events || []).map((e) => ({
            ...e,
            date: new Date(e.date),
        }));

        // Filter events for user's courses and exclude cancelled
        const userEvents = allEvents.filter((event) =>
            userData.selectedCourses.includes(event.courseCode) &&
            !event.isCancelled
        );

        console.log(`📊 Found ${userEvents.length} events for user's courses`);

        // 6. Create fresh calendar events
        let createdCount = 0;
        const BATCH_SIZE = 10;

        for (let i = 0; i < userEvents.length; i += BATCH_SIZE) {
            const batch = userEvents.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (event) => {
                try {
                    await calendar.events.insert({
                        auth,
                        calendarId: calendarId,
                        resource: {
                            summary: `${event.courseName}-${event.section}`,
                            location: event.location,
                            description: `Professor: ${event.professor}\nLocation: ${event.location}\nWeek: ${event.week}`,
                            start: {
                                dateTime: createDateTime(event.date, event.timeSlot.start),
                                timeZone: "Asia/Kolkata",
                            },
                            end: {
                                dateTime: createDateTime(event.date, event.timeSlot.end),
                                timeZone: "Asia/Kolkata",
                            },
                            colorId: "9",
                            reminders: {
                                useDefault: false,
                                overrides: [
                                    { method: "popup", minutes: 10 },
                                ],
                            },
                            extendedProperties: {
                                private: {
                                    scheduleEventId: event.id,
                                    courseCode: event.courseCode,
                                    appCreated: "true",
                                },
                            },
                        },
                    });
                    createdCount++;
                } catch (createError) {
                    console.error(`Failed to create event:`, createError.message);
                }
            }));
        }

        console.log(`✅ Created ${createdCount} fresh events`);
        console.log(`🎉 Calendar connected successfully for ${userEmail}!`);

        return {
            success: true,
            message: `Calendar connected! Cleaned ${deletedCount} old events and added ${createdCount} fresh events.`,
            stats: {
                deleted: deletedCount,
                created: createdCount,
            },
        };

    } catch (error) {
        console.error(`❌ Connect Calendar failed for ${userEmail}:`, error.message);
        throw new Error(`Failed to connect calendar: ${error.message}`);
    }
});
