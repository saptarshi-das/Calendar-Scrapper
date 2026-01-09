import React, { useState } from 'react';
import type { ScheduleEvent } from '../types';
import './CalendarPreview.css';

interface CalendarPreviewProps {
    events: ScheduleEvent[];
    onConfirm: () => void;
    onCancel: () => void;
    loading?: boolean;
}

const CalendarPreview: React.FC<CalendarPreviewProps> = ({
    events,
    onConfirm,
    onCancel,
    loading,
}) => {
    const [viewMode, setViewMode] = useState<'list' | 'week'>('list');

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('en-IN', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        }).format(date);
    };

    const formatTime = (time: string) => {
        return time;
    };

    // Group events by date
    const eventsByDate = events.reduce((acc, event) => {
        const dateKey = event.date.toDateString();
        if (!acc[dateKey]) {
            acc[dateKey] = [];
        }
        acc[dateKey].push(event);
        return acc;
    }, {} as Record<string, ScheduleEvent[]>);

    const sortedDates = Object.keys(eventsByDate).sort(
        (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    const activeEvents = events.filter(e => !e.isCancelled);
    const cancelledEvents = events.filter(e => e.isCancelled);

    return (
        <div className="calendar-preview">
            <div className="preview-header">
                <div>
                    <h2>📅 Calendar Preview</h2>
                    <p className="preview-subtitle">
                        Review how your classes will appear in Google Calendar
                    </p>
                </div>
            </div>

            {/* Stats */}
            <div className="preview-stats">
                <div className="stat-item">
                    <span className="stat-number">{events.length}</span>
                    <span className="stat-label">Total Events</span>
                </div>
                <div className="stat-item">
                    <span className="stat-number">{activeEvents.length}</span>
                    <span className="stat-label">Active Classes</span>
                </div>
                <div className="stat-item">
                    <span className="stat-number">{cancelledEvents.length}</span>
                    <span className="stat-label">Cancelled</span>
                </div>
                <div className="stat-item">
                    <span className="stat-number">{sortedDates.length}</span>
                    <span className="stat-label">Total Days</span>
                </div>
            </div>

            {/* View Mode Toggle */}
            <div className="view-toggle">
                <button
                    className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                    onClick={() => setViewMode('list')}
                >
                    📋 List View
                </button>
                <button
                    className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
                    onClick={() => setViewMode('week')}
                >
                    📅 Day View
                </button>
            </div>

            {/* Events Display */}
            <div className="preview-content glass-card">
                {viewMode === 'list' ? (
                    <div className="events-list-preview">
                        {events.slice(0, 10).map((event, index) => (
                            <div
                                key={event.id}
                                className={`preview-event-card ${event.isCancelled ? 'cancelled' : ''
                                    }`}
                            >
                                <div className="event-indicator">
                                    <div
                                        className="event-color"
                                        style={{
                                            background: event.isCancelled
                                                ? 'var(--cancelled-color)'
                                                : '#667eea',
                                        }}
                                    ></div>
                                </div>

                                <div className="event-content">
                                    <div className="event-title-row">
                                        <h4>{event.courseName}</h4>
                                        {event.isCancelled && (
                                            <span className="badge badge-error">Cancelled</span>
                                        )}
                                    </div>

                                    <div className="event-details-row">
                                        <span className="event-time">
                                            🕐 {formatTime(event.timeSlot.start)} -{' '}
                                            {formatTime(event.timeSlot.end)}
                                        </span>
                                        <span className="event-date">
                                            📅 {event.day}, {formatDate(event.date)}
                                        </span>
                                    </div>

                                    <div className="event-meta">
                                        <span>👨‍🏫 {event.professor}</span>
                                        <span className="course-code">{event.courseCode}</span>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {events.length > 10 && (
                            <div className="more-events">
                                <p>+ {events.length - 10} more events will be added</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="day-view">
                        {sortedDates.slice(0, 7).map(dateKey => (
                            <div key={dateKey} className="day-section">
                                <h3 className="day-header">{formatDate(new Date(dateKey))}</h3>
                                <div className="day-events">
                                    {eventsByDate[dateKey].map(event => (
                                        <div
                                            key={event.id}
                                            className={`day-event ${event.isCancelled ? 'cancelled' : ''
                                                }`}
                                        >
                                            <div className="event-time-badge">
                                                {formatTime(event.timeSlot.start)}
                                            </div>
                                            <div className="event-info">
                                                <strong>{event.courseName}</strong>
                                                <span>{event.professor}</span>
                                            </div>
                                            {event.isCancelled && (
                                                <span className="cancel-badge">✕</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {sortedDates.length > 7 && (
                            <div className="more-days">
                                <p>+ {sortedDates.length - 7} more days</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Important Notice */}
            <div className="preview-notice glass-card">
                <div className="notice-icon">ℹ️</div>
                <div className="notice-content">
                    <h4>What happens next?</h4>
                    <ul>
                        <li>
                            ✅ After confirmation, these events will be added to your Google
                            Calendar
                        </li>
                        <li>
                            🔄 Your calendar will automatically update daily with any schedule
                            changes
                        </li>
                        <li>
                            ❌ Cancelled classes will be marked in red and updated
                            automatically
                        </li>
                        <li>
                            ⚙️ You can edit your course selection anytime from the dashboard
                        </li>
                    </ul>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="preview-actions">
                <button className="btn btn-secondary btn-large" onClick={onCancel}>
                    ← Go Back
                </button>
                <button
                    className="btn btn-primary btn-large"
                    onClick={onConfirm}
                    disabled={loading}
                >
                    {loading ? (
                        <>
                            <div className="spinner-small"></div>
                            Adding to Calendar...
                        </>
                    ) : (
                        <>
                            Confirm & Add to Calendar
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

export default CalendarPreview;
