const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const { google } = require("googleapis");

admin.initializeApp();

// Configuration - defaults (can be overridden by Firestore config)
const DEFAULT_SHEET_NAME = "Schedule";

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
            const header = row[i];
            if (header && typeof header === "string") {
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
    const validDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
        "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
 */
function parseDate(dateStr) {
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
        const month = parseInt(match[1]) - 1;
        const day = parseInt(match[2]);
        const year = parseInt(match[3]);
        return new Date(year, month, day);
    }
    return new Date();
}

/**
 * Parse events from a cell
 */
function parseCellEvents(cellValue, week, day, date, timeSlot, selectedCourses, professorCell = "") {
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
                status: "active",
                isCancelled: false,
                isRed: false,
                hasStrikethrough: false,
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
            const cell = row[j];
            if (cell && typeof cell === "string") {
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

    return courses;
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

    let currentWeek = 1;
    let currentDate = new Date();

    for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];

        // Check for week info
        if (row[0] && row[0].includes("Week")) {
            const weekMatch = row[0].match(/Week\s+(\d+)/);
            if (weekMatch) {
                currentWeek = parseInt(weekMatch[1]);
            }
        }

        // Check for date
        const dateStr = row[0];
        if (dateStr && isValidDate(dateStr)) {
            currentDate = parseDate(dateStr);
        }

        // Check for day
        const day = row[1];
        if (day && isValidDay(day)) {
            // Process all 4 rows for this day
            const firstCourseRow = row;
            const firstProfRow = i + 1 < rawData.length ? rawData[i + 1] : [];
            const secondCourseRow = i + 2 < rawData.length ? rawData[i + 2] : [];
            const secondProfRow = i + 3 < rawData.length ? rawData[i + 3] : [];

            // First set of courses
            for (let j = 2; j < Math.min(firstCourseRow.length, timeSlots.length + 2); j++) {
                const cell = firstCourseRow[j];
                const professorCell = firstProfRow[j] || "";
                const timeSlot = timeSlots[j - 2];

                if (cell && timeSlot) {
                    const cellEvents = parseCellEvents(
                        cell,
                        currentWeek,
                        day,
                        currentDate,
                        timeSlot,
                        selectedCourses,
                        professorCell,
                    );
                    events.push(...cellEvents);
                }
            }

            // Second set of courses
            for (let j = 2; j < Math.min(secondCourseRow.length, timeSlots.length + 2); j++) {
                const cell = secondCourseRow[j];
                const professorCell = secondProfRow[j] || "";
                const timeSlot = timeSlots[j - 2];

                if (cell && timeSlot) {
                    const cellEvents = parseCellEvents(
                        cell,
                        currentWeek,
                        day,
                        currentDate,
                        timeSlot,
                        selectedCourses,
                        professorCell,
                    );
                    events.push(...cellEvents);
                }
            }
        }
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

        // Use user's dedicated calendar or fall back to 'primary'
        const calendarId = user.calendarId || "primary";
        console.log(`   Using calendar: ${calendarId}`);

        // Get existing events created by this app
        const now = new Date();
        const threeMonthsFromNow = new Date();
        threeMonthsFromNow.setMonth(now.getMonth() + 3);

        const existingEventsRes = await calendar.events.list({
            auth,
            calendarId: calendarId,
            timeMin: now.toISOString(),
            timeMax: threeMonthsFromNow.toISOString(),
            privateExtendedProperty: [`appCreated=true`],
            maxResults: 2500,
        });

        const existingEvents = existingEventsRes.data.items || [];
        const existingEventsMap = new Map();
        existingEvents.forEach((e) => {
            const scheduleId = e.extendedProperties?.private?.scheduleEventId;
            if (scheduleId) {
                existingEventsMap.set(scheduleId, e);
            }
        });

        // Create map of new events
        const newEventsMap = new Map(userEvents.map((e) => [e.id, e]));

        let created = 0;
        let deleted = 0;

        // Add new events
        // Add new events (in batches to avoid rate limits but improve speed)
        const eventsToCreate = userEvents.filter(event => !existingEventsMap.has(event.id));
        const BATCH_SIZE = 5;

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

        // Delete events that no longer exist
        // Delete events that no longer exist (in batches)
        const eventsToDelete = existingEvents.filter(existingEvent => {
            const scheduleId = existingEvent.extendedProperties?.private?.scheduleEventId;
            return scheduleId && !newEventsMap.has(scheduleId);
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

        return { created, deleted };
    } catch (error) {
        console.error("Error syncing calendar:", error);
        throw error;
    }
}

/**
 * Create ISO datetime string for calendar event
 */
function createDateTime(date, time) {
    const timeMatch = time.match(/(\d+):(\d+)(AM|PM)/);
    if (!timeMatch) return new Date().toISOString();

    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const period = timeMatch[3];

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    const dateTime = new Date(date);
    dateTime.setHours(hours, minutes, 0, 0);
    return dateTime.toISOString();
}

/**
 * Main scheduled function - runs daily at 2 AM IST
 */
exports.dailyCalendarSync = onSchedule({
    schedule: "0 2 * * *",
    timeZone: "Asia/Kolkata",
    memory: "512MiB",
    timeoutSeconds: 540,
    retryCount: 2,
}, async (event) => {
    console.log("🚀 Starting daily calendar sync");

    try {
        const db = admin.firestore();

        // 1. Load sheet ID from configuration
        console.log("📋 Loading sheet configuration...");
        const configDoc = await db.collection("config").doc("settings").get();

        if (!configDoc.exists) {
            throw new Error("Configuration not found. Please set the sheet URL in the admin panel.");
        }

        const config = configDoc.data();
        const CURRENT_SHEET_ID = config.scheduleSheetId;
        const sheetTabName = config.sheetTabName || DEFAULT_SHEET_NAME;
        const sheetGid = config.sheetGid; // GID for .xlsx file support

        if (!CURRENT_SHEET_ID) {
            throw new Error("Sheet ID not configured. Please set it in the admin panel.");
        }

        console.log(`📋 Using sheet ID: ${CURRENT_SHEET_ID}, tab: ${sheetTabName}, GID: ${sheetGid}`);

        // 2. Get admin user's OAuth token from Firestore
        console.log("🔐 Loading admin credentials...");
        const adminConfigDoc = await db.collection("config").doc("adminUser").get();

        if (!adminConfigDoc.exists) {
            throw new Error("Admin user not configured. Please log in to the app as admin first.");
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

            // Update stored token
            await db.collection("config").doc("adminUser").update({
                "oauthTokens.accessToken": accessToken,
                "oauthTokens.expiresAt": new Date(credentials.expiry_date),
            });
        }

        // 3. Fetch restricted sheet using admin's OAuth token and dynamic sheet ID
        console.log("📊 Fetching restricted sheet data...");

        const sheets = google.sheets({ version: "v4" });
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        // Try to get data - use sheetTabName if available
        // For .xlsx files, spreadsheets.get() doesn't work, so we use fallbacks
        let response;
        try {
            response = await sheets.spreadsheets.values.get({
                auth,
                spreadsheetId: CURRENT_SHEET_ID,
                range: `${sheetTabName}!A1:Z200`,
            });
        } catch (rangeError) {
            console.log(`Sheet tab '${sheetTabName}' not found, trying without tab name...`);

            // Fallback 1: Try without sheet name (gets first sheet by default)
            // This works for both native sheets and .xlsx files
            try {
                response = await sheets.spreadsheets.values.get({
                    auth,
                    spreadsheetId: CURRENT_SHEET_ID,
                    range: `A1:Z200`,
                });
                console.log("Successfully fetched data using default sheet");
            } catch (defaultError) {
                console.error("Failed to fetch with default range:", defaultError.message);

                // Fallback 2: Try with 'Sheet1' which is common default
                try {
                    response = await sheets.spreadsheets.values.get({
                        auth,
                        spreadsheetId: CURRENT_SHEET_ID,
                        range: `Sheet1!A1:Z200`,
                    });
                    console.log("Successfully fetched data using 'Sheet1'");
                } catch (sheet1Error) {
                    // If this is an .xlsx file, provide helpful error
                    throw new Error(
                        `Unable to read sheet. If this is an .xlsx file, try opening it in Google Sheets and note the exact tab name, then configure sheetTabName in settings. Error: ${defaultError.message}`
                    );
                }
            }
        }

        const rawData = response.data.values || [];
        console.log(`📊 Fetched ${rawData.length} rows from restricted sheet`);

        // 2. Extract courses
        const courses = extractCourses(rawData);
        console.log(`📚 Found ${courses.length} unique courses`);

        // 3. Parse ALL events (for all courses)
        const allCourses = courses.map((c) => c.code);
        const events = parseScheduleEvents(rawData, allCourses);
        console.log(`📅 Parsed ${events.length} total events`);

        // 4. Update Firestore
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

        // 5. Get all synced users
        const usersSnapshot = await db.collection("users")
            .where("isSynced", "==", true)
            .get();
        console.log(`👥 Found ${usersSnapshot.size} synced users`);

        // 6. Sync each user's calendar
        let successCount = 0;
        let errorCount = 0;

        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            try {
                // Check if token needs refresh
                let accessToken = userData.oauthTokens?.accessToken;
                const expiresAt = userData.oauthTokens?.expiresAt?.toDate();

                if (!accessToken || (expiresAt && expiresAt < new Date())) {
                    console.log(`🔄 Refreshing token for ${userData.email}`);
                    accessToken = await refreshOAuthToken(
                        userDoc.id,
                        userData.oauthTokens?.refreshToken,
                    );
                }

                // Sync calendar
                const stats = await syncUserCalendar(userData, events, accessToken);
                console.log(`✅ ${userData.email}: +${stats.created} events, -${stats.deleted} events`);
                successCount++;
            } catch (error) {
                console.error(`❌ Failed to sync ${userData.email}:`, error.message);
                errorCount++;
            }
        }

        console.log(`🎉 Sync complete: ${successCount} success, ${errorCount} errors`);

        return {
            success: true,
            usersProcessed: usersSnapshot.size,
            successCount,
            errorCount,
            eventsTotal: events.length,
        };
    } catch (error) {
        console.error("💥 Daily sync failed:", error);
        throw error;
    }
});

/**
 * Manual sync function - callable by admin from frontend
 * Same logic as daily sync but triggered on demand
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

    console.log("🚀 Starting MANUAL calendar sync (triggered by admin)");

    try {
        const db = admin.firestore();

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

        const sheets = google.sheets({ version: "v4" });
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        // Try to get data - use sheetTabName if available
        // For .xlsx files, spreadsheets.get() doesn't work, so we use fallbacks
        let response;
        try {
            response = await sheets.spreadsheets.values.get({
                auth,
                spreadsheetId: CURRENT_SHEET_ID,
                range: `${sheetTabName}!A1:Z200`,
            });
        } catch (rangeError) {
            console.log(`Sheet tab '${sheetTabName}' not found, trying without tab name...`);

            // Fallback 1: Try without sheet name (gets first sheet by default)
            // This works for both native sheets and .xlsx files
            try {
                response = await sheets.spreadsheets.values.get({
                    auth,
                    spreadsheetId: CURRENT_SHEET_ID,
                    range: `A1:Z200`,
                });
                console.log("Successfully fetched data using default sheet");
            } catch (defaultError) {
                console.error("Failed to fetch with default range:", defaultError.message);

                // Fallback 2: Try with 'Sheet1' which is common default
                try {
                    response = await sheets.spreadsheets.values.get({
                        auth,
                        spreadsheetId: CURRENT_SHEET_ID,
                        range: `Sheet1!A1:Z200`,
                    });
                    console.log("Successfully fetched data using 'Sheet1'");
                } catch (sheet1Error) {
                    // If this is an .xlsx file, provide helpful error
                    throw new Error(
                        `Unable to read sheet. If this is an .xlsx file, try opening it in Google Sheets and note the exact tab name, then configure sheetTabName in settings. Error: ${defaultError.message}`
                    );
                }
            }
        }

        const rawData = response.data.values || [];
        console.log(`📊 Fetched ${rawData.length} rows from restricted sheet`);

        // 4. Extract courses and events
        const courses = extractCourses(rawData);
        console.log(`📚 Found ${courses.length} unique courses`);

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

                if (!userAccessToken || (userExpiresAt && userExpiresAt < new Date())) {
                    console.log(`🔄 Refreshing token for ${userData.email}`);
                    userAccessToken = await refreshOAuthToken(
                        userDoc.id,
                        userData.oauthTokens?.refreshToken,
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
