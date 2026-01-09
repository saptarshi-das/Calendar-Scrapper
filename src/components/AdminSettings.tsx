import { useState, useEffect } from 'react';
import { FirestoreService } from '../services/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface AdminSettingsProps {
    onClose: () => void;
}

export function AdminSettings({ onClose }: AdminSettingsProps) {
    const [sheetUrl, setSheetUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    useEffect(() => {
        loadCurrentUrl();
    }, []);

    const loadCurrentUrl = async () => {
        try {
            const url = await FirestoreService.getScheduleSheetUrl();
            if (url) {
                setSheetUrl(url);
            }
        } catch (error) {
            console.error('Error loading sheet URL:', error);
        }
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            setMessage(null);

            await FirestoreService.updateScheduleSheetUrl(sheetUrl);

            setMessage({
                type: 'success',
                text: '✅ Sheet URL updated! Use "Sync Now" to immediately update all calendars.',
            });
        } catch (error: any) {
            setMessage({
                type: 'error',
                text: `❌ Error: ${error.message}`,
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSyncNow = async () => {
        try {
            setSyncing(true);
            setMessage({
                type: 'info',
                text: '⏳ Syncing all calendars... This may take 1-2 minutes.',
            });

            const functions = getFunctions();
            const manualSync = httpsCallable(functions, 'manualSync');
            const result = await manualSync();

            const data = result.data as any;

            setMessage({
                type: 'success',
                text: `🎉 Sync complete! ${data.successCount} users synced, ${data.eventsTotal} events processed.`,
            });
        } catch (error: any) {
            console.error('Sync error:', error);
            setMessage({
                type: 'error',
                text: `❌ Sync failed: ${error.message}`,
            });
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        }}>
            <div style={{
                background: 'linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%)',
                padding: '2rem',
                borderRadius: '16px',
                maxWidth: '600px',
                width: '90%',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            }}>
                <h2 style={{
                    color: '#fff',
                    marginBottom: '1.5rem',
                    fontSize: '1.5rem',
                }}>
                    ⚙️ Admin Settings
                </h2>

                {/* Sheet URL Section */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{
                        color: '#b4b4c9',
                        display: 'block',
                        marginBottom: '0.5rem',
                        fontSize: '0.9rem',
                    }}>
                        Schedule Sheet URL
                    </label>
                    <input
                        type="text"
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.9rem',
                        }}
                    />
                    <p style={{
                        color: '#8888a0',
                        fontSize: '0.75rem',
                        marginTop: '0.5rem',
                    }}>
                        Paste the Google Sheets URL. After saving, click "Sync Now" to update all calendars immediately.
                    </p>
                </div>

                {/* Sync Now Section */}
                <div style={{
                    padding: '1rem',
                    background: 'rgba(102, 126, 234, 0.1)',
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                    border: '1px solid rgba(102, 126, 234, 0.2)',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        <div>
                            <h3 style={{
                                color: '#fff',
                                fontSize: '1rem',
                                marginBottom: '0.25rem',
                            }}>
                                🚀 Manual Sync
                            </h3>
                            <p style={{
                                color: '#8888a0',
                                fontSize: '0.75rem',
                            }}>
                                Immediately sync all users' calendars with the latest schedule
                            </p>
                        </div>
                        <button
                            onClick={handleSyncNow}
                            disabled={syncing}
                            style={{
                                padding: '10px 20px',
                                background: syncing
                                    ? 'rgba(255, 255, 255, 0.1)'
                                    : 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                cursor: syncing ? 'not-allowed' : 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
                        </button>
                    </div>
                </div>

                {/* Message */}
                {message && (
                    <div style={{
                        padding: '12px',
                        borderRadius: '8px',
                        marginBottom: '1rem',
                        background: message.type === 'success'
                            ? 'rgba(76, 175, 80, 0.1)'
                            : message.type === 'error'
                                ? 'rgba(244, 67, 54, 0.1)'
                                : 'rgba(33, 150, 243, 0.1)',
                        border: `1px solid ${message.type === 'success' ? '#4caf50' :
                                message.type === 'error' ? '#f44336' : '#2196f3'
                            }`,
                        color: message.type === 'success' ? '#4caf50' :
                            message.type === 'error' ? '#f44336' : '#2196f3',
                    }}>
                        {message.text}
                    </div>
                )}

                {/* Buttons */}
                <div style={{
                    display: 'flex',
                    gap: '1rem',
                    justifyContent: 'flex-end',
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '12px 24px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                        }}
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading || !sheetUrl}
                        style={{
                            padding: '12px 24px',
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            cursor: loading || !sheetUrl ? 'not-allowed' : 'pointer',
                            opacity: loading || !sheetUrl ? 0.5 : 1,
                            fontSize: '0.9rem',
                        }}
                    >
                        {loading ? 'Saving...' : 'Save URL'}
                    </button>
                </div>
            </div>
        </div>
    );
}
