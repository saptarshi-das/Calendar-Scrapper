import React, { useState } from 'react';
import type { Course } from '../types';
import './CourseSelector.css';

interface CourseSelectorProps {
    courses: Course[];
    selectedCourses: string[];
    onSelectionChange: (selectedCourses: string[]) => void;
    onContinue: () => void;
    loading?: boolean;
}

const CourseSelector: React.FC<CourseSelectorProps> = ({
    courses,
    selectedCourses,
    onSelectionChange,
    onContinue,
    loading,
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredCourses = courses.filter(course =>
        course.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleToggleCourse = (courseCode: string) => {
        if (selectedCourses.includes(courseCode)) {
            onSelectionChange(selectedCourses.filter(c => c !== courseCode));
        } else {
            onSelectionChange([...selectedCourses, courseCode]);
        }
    };

    const handleSelectAll = () => {
        onSelectionChange(filteredCourses.map(c => c.code));
    };

    const handleDeselectAll = () => {
        onSelectionChange([]);
    };

    return (
        <div className="course-selector">
            <div className="selector-header">
                <h2>Select Your Courses</h2>
                <p className="selector-subtitle">
                    Choose the courses you're enrolled in to sync to your calendar
                </p>
            </div>

            <div className="selector-controls">
                <div className="search-box">
                    <svg
                        className="search-icon"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                    >
                        <circle cx="11" cy="11" r="8" strokeWidth="2" />
                        <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <input
                        type="text"
                        className="input search-input"
                        placeholder="Search courses..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="selection-actions">
                    <button className="btn btn-secondary btn-small" onClick={handleSelectAll}>
                        Select All
                    </button>
                    <button className="btn btn-secondary btn-small" onClick={handleDeselectAll}>
                        Deselect All
                    </button>
                </div>
            </div>

            <div className="selected-count">
                <span className="badge badge-info">
                    {selectedCourses.length} of {courses.length} selected
                </span>
            </div>

            <div className="courses-grid">
                {filteredCourses.map((course) => (
                    <div
                        key={course.id}
                        className={`course-card ${selectedCourses.includes(course.code) ? 'selected' : ''
                            }`}
                        onClick={() => handleToggleCourse(course.code)}
                    >
                        <div className="course-checkbox">
                            <input
                                type="checkbox"
                                checked={selectedCourses.includes(course.code)}
                                onChange={() => { }}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>

                        <div className="course-info">
                            <h3 className="course-name">{course.name}</h3>
                            <p className="course-section">{course.section}</p>
                            <p className="course-code">{course.code}</p>
                        </div>

                        <div className="course-check-icon">
                            {selectedCourses.includes(course.code) && (
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M9 12l2 2 4-4"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <circle
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    />
                                </svg>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {filteredCourses.length === 0 && (
                <div className="no-results">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                        <path
                            d="M8 15s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                    <p>No courses found matching "{searchQuery}"</p>
                </div>
            )}

            <div className="selector-footer">
                <button
                    className="btn btn-primary btn-large"
                    onClick={onContinue}
                    disabled={selectedCourses.length === 0 || loading}
                >
                    {loading ? (
                        <>
                            <div className="spinner-small"></div>
                            Syncing to Calendar...
                        </>
                    ) : (
                        <>
                            Continue to Sync
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M5 12h14M12 5l7 7-7 7"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default CourseSelector;
