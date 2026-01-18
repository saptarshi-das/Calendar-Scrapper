import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';
import { GoogleOAuthService } from '../services/googleOAuth';
import { FirestoreService } from '../services/firestore';
import './LoginPage.css';

/**
 * OAuth Callback Component
 * Handles the redirect back from Google OAuth
 * Exchanges the auth code for tokens and stores them
 */
const OAuthCallback: React.FC = () => {
    const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        handleCallback();
    }, []);

    const handleCallback = async () => {
        try {
            setStatus('processing');

            // Exchange the authorization code for tokens
            const tokens = await GoogleOAuthService.handleOAuthCallback();

            if (!tokens) {
                throw new Error('Failed to get tokens from OAuth callback');
            }

            console.log('✅ Got OAuth tokens with refresh token!');

            // Create a Google credential from the access token
            // This lets us sign in to Firebase with the same account
            const credential = GoogleAuthProvider.credential(null, tokens.accessToken);
            const result = await signInWithCredential(auth, credential);

            if (!result.user) {
                throw new Error('Failed to sign in with Google credential');
            }

            // Verify domain
            const allowedDomain = import.meta.env.VITE_ALLOWED_DOMAIN;
            if (!result.user.email?.endsWith(allowedDomain)) {
                throw new Error(`Only ${allowedDomain} accounts are allowed`);
            }

            // Save OAuth tokens for calendar sync
            if (FirestoreService.isAdmin(result.user.email || '')) {
                // Admin: Save to both config/adminUser (for sheet access) and users collection (for calendar)
                await FirestoreService.saveAdminOAuthTokens(
                    result.user.uid,
                    tokens.accessToken,
                    tokens.refreshToken,
                    tokens.expiresAt
                );
                console.log('✅ Admin OAuth tokens saved for Cloud Function - includes refresh token!');
            } else {
                // Regular user: Save to users collection for calendar sync
                await FirestoreService.saveUserOAuthTokens(
                    result.user.uid,
                    tokens.accessToken,
                    tokens.refreshToken,
                    tokens.expiresAt
                );
                console.log('✅ User OAuth tokens saved for calendar sync!');
            }

            // Store access token in sessionStorage for immediate use
            sessionStorage.setItem('google_access_token', tokens.accessToken);

            setStatus('success');

            // Redirect to home after a short delay
            setTimeout(() => {
                navigate('/', { replace: true });
            }, 1500);

        } catch (err: any) {
            console.error('OAuth callback error:', err);
            setError(err.message || 'Failed to complete authentication');
            setStatus('error');
        }
    };

    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-card glass-card">
                    <div className="login-header">
                        <div className="logo-container">
                            {status === 'processing' && (
                                <div className="spinner" style={{ width: '48px', height: '48px' }}></div>
                            )}
                            {status === 'success' && (
                                <div style={{ fontSize: '48px' }}>✅</div>
                            )}
                            {status === 'error' && (
                                <div style={{ fontSize: '48px' }}>❌</div>
                            )}
                        </div>

                        <h1 className="login-title">
                            {status === 'processing' && 'Completing Sign In...'}
                            {status === 'success' && 'Success!'}
                            {status === 'error' && 'Authentication Failed'}
                        </h1>

                        <p className="login-subtitle">
                            {status === 'processing' && 'Please wait while we finish setting up your account'}
                            {status === 'success' && 'Redirecting you to the app...'}
                            {status === 'error' && error}
                        </p>
                    </div>

                    {status === 'error' && (
                        <button
                            className="btn btn-primary login-button"
                            onClick={() => navigate('/', { replace: true })}
                        >
                            Go Back to Login
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OAuthCallback;
