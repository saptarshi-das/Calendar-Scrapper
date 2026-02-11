// Debug script to test combined section parsing
const testData = [
    ['Week', 'Days', '12.15PM', '12.30PM - 2.00PM'],
    ['1', 'Sat', '', ''],
    ['14/2/2026', 'Sat', '', 'SA-A and B (PT-2-4)']
];

const selectedCourses = ['SA-B'];

console.log('=== Testing Course Extraction ===');
const coursesSet = new Set();
const courses = [];

// Simulate course extraction
for (let i = 2; i < testData.length; i++) {
    const row = testData[i];
    for (let j = 2; j < row.length; j++) {
        const cell = row[j];
        if (cell && typeof cell === 'string') {
            console.log(`\nProcessing cell: "${cell}"`);

            // Check for combined section
            const combinedSectionMatches = cell.match(/([A-Z][A-Za-z0-9\&-]+)-([A-Z])\s+and\s+([A-Z])\s*\(([^)]+)\)/gi);
            if (combinedSectionMatches) {
                console.log('Found combined section!');
                combinedSectionMatches.forEach(match => {
                    const courseMatch = match.match(/([A-Z][A-Za-z0-9\&-]+)-([A-Z])\s+and\s+([A-Z])\s*\(([^)]+)\)/i);
                    if (courseMatch) {
                        const [, courseName, firstSection, secondSection] = courseMatch;
                        const firstCode = `${courseName}-${firstSection}`;
                        const secondCode = `${courseName}-${secondSection}`;

                        console.log(`  Creating courses: ${firstCode}, ${secondCode}`);

                        if (!coursesSet.has(firstCode)) {
                            coursesSet.add(firstCode);
                            courses.push({ code: firstCode });
                        }
                        if (!coursesSet.has(secondCode)) {
                            coursesSet.add(secondCode);
                            courses.push({ code: secondCode });
                        }
                    }
                });
            }
        }
    }
}

console.log('\n=== Extracted Courses ===');
console.log(courses);

console.log('\n=== Testing Event Parsing ===');
console.log('Selected courses:', selectedCourses);

const line = 'SA-A and B (PT-2-4)';
const combinedSectionMatch = line.match(/([A-Z][A-Za-z0-9\&-]+)-([A-Z])\s+and\s+([A-Z])\s*\(([^)]+)\)/i);

if (combinedSectionMatch) {
    const [, baseCourseName, firstSection, secondSection, combinedLocation] = combinedSectionMatch;
    const firstCode = `${baseCourseName}-${firstSection}`;
    const secondCode = `${baseCourseName}-${secondSection}`;

    console.log(`Found pattern: ${baseCourseName}-${firstSection} and ${secondSection} (${combinedLocation})`);
    console.log(`Checking if selected courses includes ${firstCode}:`, selectedCourses.includes(firstCode));
    console.log(`Checking if selected courses includes ${secondCode}:`, selectedCourses.includes(secondCode));

    if (selectedCourses.includes(firstCode) || selectedCourses.includes(secondCode)) {
        console.log('✓ Would create event!');
    } else {
        console.log('✗ Would NOT create event - course not selected');
    }
}
