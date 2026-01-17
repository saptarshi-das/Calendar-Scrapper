/**
 * Google OAuth Service
 * Handles direct Google OAuth flow to get refresh tokens
 * (Firebase Auth doesn't provide refresh tokens)
 */

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const REDIRECT_URI = `${window.location.origin}/oauth/callback`;

// Scopes needed for the app
const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export class GoogleOAuthService {
    /**
     * Generate a random state for CSRF protection
     */
    private static generateState(): string {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Generate code verifier for PKCE
     */
    private static generateCodeVerifier(): string {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return this.base64URLEncode(array);
    }

    /**
     * Generate code challenge from verifier (SHA-256)
     */
    private static async generateCodeChallenge(verifier: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return this.base64URLEncode(new Uint8Array(digest));
    }

    /**
     * Base64 URL encode
     */
    private static base64URLEncode(buffer: Uint8Array): string {
        const base64 = btoa(String.fromCharCode(...buffer));
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    /**
     * Start OAuth flow - redirects to Google
     * Uses PKCE for security
     */
    static async startOAuthFlow(): Promise<void> {
        const state = this.generateState();
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);

        // Store state and code verifier in sessionStorage for callback
        sessionStorage.setItem('oauth_state', state);
        sessionStorage.setItem('oauth_code_verifier', codeVerifier);

        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: SCOPES,
            access_type: 'offline', // This is the key - requests refresh token
            prompt: 'consent', // Force consent to ensure we get refresh token
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            // Restrict to IIM Ranchi domain
            hd: 'iimranchi.ac.in',
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
        window.location.href = authUrl;
    }

    /**
     * Handle OAuth callback - exchange code for tokens
     * This should be called from the callback page
     */
    static async handleOAuthCallback(): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        email: string;
    } | null> {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');

        if (error) {
            throw new Error(`OAuth error: ${error}`);
        }

        if (!code || !state) {
            return null; // Not a callback
        }

        // Verify state
        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            throw new Error('Invalid OAuth state - possible CSRF attack');
        }

        // Get code verifier
        const codeVerifier = sessionStorage.getItem('oauth_code_verifier');
        if (!codeVerifier) {
            throw new Error('Missing code verifier');
        }

        // Clean up sessionStorage
        sessionStorage.removeItem('oauth_state');
        sessionStorage.removeItem('oauth_code_verifier');

        // Get the Cloud Functions URL
        // In production: https://us-central1-{project-id}.cloudfunctions.net/exchangeOAuthCode
        // You may need to set VITE_FUNCTIONS_URL in your .env file
        const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
        const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL ||
            `https://us-central1-${projectId}.cloudfunctions.net`;

        // Exchange code for tokens using the Cloud Function
        const response = await fetch(
            `${functionsUrl}/exchangeOAuthCode`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    code,
                    codeVerifier,
                    redirectUri: REDIRECT_URI,
                }),
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to exchange OAuth code');
        }

        const tokens = await response.json();

        return {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
            email: tokens.email,
        };
    }

    /**
     * Check if current page is OAuth callback
     */
    static isOAuthCallback(): boolean {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('code') && urlParams.has('state');
    }

    /**
     * Get the redirect URI for configuration
     */
    static getRedirectUri(): string {
        return REDIRECT_URI;
    }
}
