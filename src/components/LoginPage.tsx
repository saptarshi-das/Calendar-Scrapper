import React from 'react';
import './LoginPage.css';

interface LoginPageProps {
    onLogin: () => void;
    loading?: boolean;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, loading }) => {
    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-card glass-card">
                    <div className="login-header">
                        <div className="logo-container">
                            <svg
                                className="logo-icon"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path
                                    d="M8 2V5M16 2V5M3.5 9.09H20.5M21 8.5V17C21 20 19.5 22 16 22H8C4.5 22 3 20 3 17V8.5C3 5.5 4.5 3.5 8 3.5H16C19.5 3.5 21 5.5 21 8.5Z"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeMiterlimit="10"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                <path
                                    d="M15.6947 13.7H15.7037M15.6947 16.7H15.7037M11.9955 13.7H12.0045M11.9955 16.7H12.0045M8.29431 13.7H8.30329M8.29431 16.7H8.30329"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </div>

                        <h1 className="login-title">Calendar Scraper</h1>
                        <p className="login-subtitle">
                            Automatically sync your course schedule to Google Calendar
                        </p>
                    </div>

                    <div className="login-features">
                        <div className="feature-item">
                            <div className="feature-icon">📅</div>
                            <div>
                                <h3>Auto-Sync</h3>
                                <p>Daily schedule updates to your calendar</p>
                            </div>
                        </div>

                        <div className="feature-item">
                            <div className="feature-icon">🔔</div>
                            <div>
                                <h3>Cancellation Alerts</h3>
                                <p>Get notified when classes are cancelled</p>
                            </div>
                        </div>

                        <div className="feature-item">
                            <div className="feature-icon">✅</div>
                            <div>
                                <h3>Select Courses</h3>
                                <p>Choose only your enrolled courses</p>
                            </div>
                        </div>
                    </div>

                    <p className="made-by-text">
                        Made by Group 8
                    </p>

                    <button
                        className="btn btn-primary login-button"
                        onClick={onLogin}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div className="spinner-small"></div>
                                Signing in...
                            </>
                        ) : (
                            <>
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 48 48"
                                    fill="currentColor"
                                >
                                    <path
                                        fill="#EA4335"
                                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                                    />
                                    <path
                                        fill="#4285F4"
                                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                                    />
                                    <path
                                        fill="#FBBC05"
                                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                                    />
                                    <path
                                        fill="#34A853"
                                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                                    />
                                </svg>
                                Sign in with Google
                            </>
                        )}
                    </button>

                    <p className="login-footer">
                        Only @iimranchi.ac.in accounts can sign in
                    </p>
                </div>
            </div>

        </div>
    );
};

export default LoginPage;
