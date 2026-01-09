import React from 'react';
import type { User, ScheduleEvent } from '../types';
import './Dashboard.css';

interface DashboardProps {
    user: User;
    selectedCourses: string[];
    scheduleEvents: ScheduleEvent[];
    onLogout: () => void;
    onResync: () => void;
    onEditCourses: () => void;
    onOpenSettings?: () => void;
    onToggleSync?: () => void;
    loading?: boolean;
    isAdmin?: boolean;
    syncEnabled?: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({
    user,
    selectedCourses,
    scheduleEvents,
    onLogout,
    onResync,
    onEditCourses,
    onOpenSettings,
    onToggleSync,
    loading,
    isAdmin,
    syncEnabled = true,
}) => {
    const activeEvents = scheduleEvents.filter(e => !e.isCancelled);
    const cancelledEvents = scheduleEvents.filter(e => e.isCancelled);
    const upcomingEvents = activeEvents.filter(e => e.date >= new Date()).slice(0, 5);

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('en-IN', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        }).format(date);
    };

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div className="header-content">
                    <div className="user-info">
                        {user.photoURL && (
                            <img src={user.photoURL} alt={user.displayName || 'User'} className="user-avatar" />
                        )}
                        <div>
                            <h1 className="welcome-text">Welcome, {user.displayName?.split(' ')[0] || 'Student'}!</h1>
                            <p className="user-email">{user.email}</p>
                        </div>
                    </div>

                    <div className="header-actions">
                        {isAdmin && onOpenSettings && (
                            <button className="btn btn-secondary" onClick={onOpenSettings}>
                                ⚙️ Settings
                            </button>
                        )}
                        <button className="btn btn-secondary" onClick={onEditCourses}>
                            Edit Courses
                        </button>
                        <button className="btn btn-secondary" onClick={onLogout}>
                            Logout
                        </button>
                    </div>
                </div>
            </header>

            <main className="dashboard-main container">
                {/* Stats Section */}
                <div className="stats-grid">
                    <div className="stat-card glass-card">
                        <div className="stat-icon">📚</div>
                        <div className="stat-info">
                            <h3 className="stat-value">{selectedCourses.length}</h3>
                            <p className="stat-label">Enrolled Courses</p>
                        </div>
                    </div>

                    <div className="stat-card glass-card">
                        <div className="stat-icon">📅</div>
                        <div className="stat-info">
                            <h3 className="stat-value">{activeEvents.length}</h3>
                            <p className="stat-label">Scheduled Classes</p>
                        </div>
                    </div>

                    <div className="stat-card glass-card">
                        <div className="stat-icon">❌</div>
                        <div className="stat-info">
                            <h3 className="stat-value">{cancelledEvents.length}</h3>
                            <p className="stat-label">Cancelled Classes</p>
                        </div>
                    </div>

                    <div className="stat-card glass-card">
                        <div className="stat-icon">🔄</div>
                        <div className="stat-info">
                            <h3 className="stat-value">Daily</h3>
                            <p className="stat-label">Auto-Sync</p>
                        </div>
                    </div>
                </div>

                {/* Sync Actions */}
                <div className="sync-section glass-card">
                    <div className="sync-header">
                        <div>
                            <h2>Calendar Sync</h2>
                            <p className="sync-subtitle">
                                {syncEnabled
                                    ? 'Your schedule is automatically synced daily at 2:00 AM IST'
                                    : '⚠️ Auto-sync is disabled. You will not receive calendar updates.'}
                            </p>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={onResync}
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <div className="spinner-small"></div>
                                    Syncing...
                                </>
                            ) : (
                                <>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                        <path
                                            d="M1 4v6h6M23 20v-6h-6"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                        <path
                                            d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    Sync Now
                                </>
                            )}
                        </button>
                    </div>

                    <div className="sync-status">
                        <div className="status-indicator">
                            <div className={`status-dot ${syncEnabled ? '' : 'status-dot-inactive'}`}></div>
                            <span>{syncEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled'}</span>
                        </div>

                        {onToggleSync && (
                            <button
                                className={`btn ${syncEnabled ? 'btn-secondary' : 'btn-primary'}`}
                                onClick={onToggleSync}
                                disabled={loading}
                                style={{ marginLeft: 'auto', fontSize: '0.875rem' }}
                            >
                                {syncEnabled ? '🔕 Unsubscribe' : '🔔 Resubscribe'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Upcoming Classes */}
                <div className="upcoming-section">
                    <h2>Upcoming Classes</h2>

                    {upcomingEvents.length > 0 ? (
                        <div className="events-list">
                            {upcomingEvents.map((event) => (
                                <div key={event.id} className="event-card glass-card">
                                    <div className="event-header">
                                        <div className="event-course">
                                            <h3>{event.courseName}-{event.section}</h3>
                                            <span className="badge badge-info">{event.courseCode}</span>
                                        </div>
                                        <span className="event-date">{formatDate(event.date)}</span>
                                    </div>

                                    <div className="event-details">
                                        <div className="event-detail">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                                                <path
                                                    d="M12 6v6l4 2"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                />
                                            </svg>
                                            <span>{event.timeSlot.start} - {event.timeSlot.end}</span>
                                        </div>

                                        <div className="event-detail">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                <path
                                                    d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                                <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                                            </svg>
                                            <span>{event.professor}</span>
                                        </div>

                                        <div className="event-detail">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                            <span>{event.location}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state glass-card">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M9 11l3 3L22 4"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                <path
                                    d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                            <p>No upcoming classes found</p>
                        </div>
                    )}
                </div>

                {/* Selected Courses */}
                <div className="courses-section">
                    <h2>Your Enrolled Courses</h2>

                    <div className="courses-list">
                        {selectedCourses.map((courseCode) => (
                            <div key={courseCode} className="course-badge glass-card">
                                <span>{courseCode}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Dashboard;
