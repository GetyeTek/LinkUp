import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './PrivacySecurityOverlay.css';

const PrivacySecurityOverlay = ({ isActive, onClose, initialTarget = null }) => {
    const { sessionUser, user: userProfile } = usePlatform();
    const isInitialPassword = initialTarget === 'password';
    
    // Check Telegram Identity Status
    const isTelegramLinked = !!(userProfile?.registered_with_telegram && userProfile?.telegram_id);
    const telegramHandle = userProfile?.telegram_username ? `@${userProfile.telegram_username}` : null;
    const linkedPhone = userProfile?.phone || null;
    
    // Check if user has an existing email/password identity or a synthetic Telegram placeholder
    const isSyntheticEmail = sessionUser?.email?.endsWith('@linkup.invalid');
    const providers = sessionUser?.app_metadata?.providers || [];
    const initialHasPassword = !isSyntheticEmail && (providers.includes('email') || sessionUser?.app_metadata?.provider === 'email');
    const [hasPassword, setHasPassword] = useState(initialHasPassword);

    // Reconcile with ground-truth database status
    useEffect(() => {
        if (isActive && sessionUser?.id) {
            supabase.rpc('user_has_password')
                .then(({ data, error }) => {
                    if (!error && typeof data === 'boolean') {
                        setHasPassword(!isSyntheticEmail && data);
                    }
                })
                .catch(() => {});
        }
    }, [isActive, sessionUser?.id, isSyntheticEmail]);

    // Password Modal States
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(isInitialPassword);

    useEffect(() => {
        if (isActive) {
            if (initialTarget === 'password') {
                handleOpenPasswordModal();
            } else if (initialTarget === 'telegram') {
                const timer = setTimeout(() => {
                    const tgEl = document.getElementById('pso-telegram-card');
                    if (tgEl) {
                        tgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        tgEl.classList.add('pso-card-spotlight');
                        setTimeout(() => tgEl.classList.remove('pso-card-spotlight'), 3200);
                    }
                }, 200);
                return () => clearTimeout(timer);
            }
        }
    }, [isActive, initialTarget]);
    const [realEmail, setRealEmail] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    
    // Academic Privacy State (Persisted to Database)
    const [showOnLeaderboard, setShowOnLeaderboard] = useState(userProfile?.show_on_leaderboard !== false);
    const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);

    useEffect(() => {
        if (userProfile?.show_on_leaderboard !== undefined) {
            setShowOnLeaderboard(userProfile.show_on_leaderboard !== false);
        }
    }, [userProfile?.show_on_leaderboard]);

    const handleToggleLeaderboard = async () => {
        if (isUpdatingPrivacy || !sessionUser?.id) return;
        const nextVal = !showOnLeaderboard;
        setShowOnLeaderboard(nextVal);
        if (userProfile) userProfile.show_on_leaderboard = nextVal;
        setIsUpdatingPrivacy(true);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ show_on_leaderboard: nextVal })
                .eq('id', sessionUser.id);
            if (error) throw error;
        } catch (err) {
            console.error('Failed to update leaderboard visibility:', err);
            setShowOnLeaderboard(!nextVal);
            if (userProfile) userProfile.show_on_leaderboard = !nextVal;
        } finally {
            setIsUpdatingPrivacy(false);
        }
    };
    
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState(null); // { type: 'error' | 'success', text: string }



    if (!isActive) return null;

    const resetForm = () => {
        setRealEmail('');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setStatusMsg(null);
        setShowCurrent(false);
        setShowNew(false);
        setShowConfirm(false);
    };

    const handleOpenPasswordModal = () => {
        resetForm();
        setIsPasswordModalOpen(true);
    };

    const handleClosePasswordModal = () => {
        if (!loading) {
            setIsPasswordModalOpen(false);
            resetForm();
        }
    };

    const handleSubmitPassword = async (e) => {
        e.preventDefault();
        setStatusMsg(null);

        if (isSyntheticEmail) {
            const cleanEmail = realEmail.toLowerCase().trim();
            if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.endsWith('@linkup.invalid')) {
                setStatusMsg({ type: 'error', text: 'Please enter a valid personal email address.' });
                return;
            }
        }

        if (newPassword.length < 6) {
            setStatusMsg({ type: 'error', text: 'New password must be at least 6 characters.' });
            return;
        }

        if (newPassword !== confirmPassword) {
            setStatusMsg({ type: 'error', text: 'New passwords do not match.' });
            return;
        }

        setLoading(true);

        try {
            // 1. If user already has a password, re-authenticate to prevent library-desk session hijacking
            if (hasPassword) {
                if (!currentPassword) {
                    setStatusMsg({ type: 'error', text: 'Please enter your current password.' });
                    setLoading(false);
                    return;
                }

                const { error: authCheckError } = await supabase.auth.signInWithPassword({
                    email: sessionUser.email,
                    password: currentPassword
                });

                if (authCheckError) {
                    throw new Error('Current password verification failed. Check your password and try again.');
                }
            }

            // 2. Commit new password (and real email if synthetic) to Supabase Auth
            const updatePayload = { password: newPassword };
            if (isSyntheticEmail) {
                updatePayload.email = realEmail.toLowerCase().trim();
            }

            const { error: updateError } = await supabase.auth.updateUser(updatePayload);

            if (updateError) throw updateError;

            setHasPassword(true);

            setStatusMsg({ 
                type: 'success', 
                text: hasPassword 
                    ? 'Password successfully updated!' 
                    : isSyntheticEmail
                    ? 'Verification link sent! Please check your email inbox and tap the confirmation link to activate your new email. Once verified, you can sign in directly using this email and password.'
                    : 'Password set! You can now sign in using your email and this password.' 
            });

            setTimeout(() => {
                handleClosePasswordModal();
            }, 2500);

        } catch (err) {
            setStatusMsg({ type: 'error', text: err.message || 'Failed to update credentials.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="pso-overlay" onClick={onClose}>
            <div className="pso-dialog-card" onClick={e => e.stopPropagation()}>
                <header className="pso-header" style={{ justifyContent: 'flex-start', gap: '1.25rem' }}>
                    <button className="icon-button" onClick={onClose} style={{ marginLeft: '-0.5rem' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h2>Privacy & Security</h2>
                </header>

                <div className="pso-body">
                    {/* 1. Academic Privacy Section */}
                    <div className="pso-section">
                        <span className="pso-section-title">Academic Privacy</span>
                        
                        <div className="pso-card" onClick={handleToggleLeaderboard} style={{ cursor: isUpdatingPrivacy ? 'wait' : 'pointer' }}>
                            <div className="pso-card-info">
                                <div className="pso-icon-box" style={{ background: 'rgba(241, 196, 15, 0.1)', color: 'var(--linkoin-gold, #f1c40f)' }}>
                                    <i className="fas fa-trophy"></i>
                                </div>
                                <div className="pso-text-group">
                                    <h4>Campus Leaderboard</h4>
                                    <span className="pso-inline-meta">
                                        {showOnLeaderboard ? 'Listed on Ladder' : 'Hidden from Rankings'}
                                    </span>
                                </div>
                            </div>
                            <div 
                                className={`toggle-switch ${showOnLeaderboard ? 'on' : 'off'}`}
                                role="switch"
                                aria-checked={showOnLeaderboard}
                            ></div>
                        </div>
                        <p className="pso-section-hint">
                            Controls whether your study streak and score are displayed on the Observatory campus leaderboard.
                        </p>
                    </div>

                    {/* 2. Identity & Verification Section */}
                    <div className="pso-section">
                        <span className="pso-section-title">Identity & Verification</span>
                        
                        <div className="pso-card" id="pso-telegram-card">
                            <div className="pso-card-info">
                                <div className="pso-icon-box" style={{ background: 'rgba(41, 169, 234, 0.12)', color: '#29A9EA' }}>
                                    <i className="fab fa-telegram-plane"></i>
                                </div>
                                <div className="pso-text-group">
                                    <h4>Telegram Identity</h4>
                                    <span className="pso-inline-meta">
                                        {isTelegramLinked 
                                            ? `${telegramHandle || 'Scholar'}${linkedPhone ? ` (${linkedPhone})` : ''}` 
                                            : (linkedPhone ? `Unverified (${linkedPhone})` : 'Not Linked')}
                                    </span>
                                </div>
                            </div>
                            {isTelegramLinked ? (
                                <div className="pso-badge-verified">
                                    <i className="fas fa-check-circle"></i> Linked
                                </div>
                            ) : (
                                <button 
                                    onClick={async () => {
                                        setIsUpdatingPrivacy(true);
                                        try {
                                            const { data, error } = await supabase.rpc('generate_telegram_link_token');
                                            if (error || !data) throw new Error("Could not generate secure link.");
                                            window.open(`https://t.me/linkupregistrationbot?start=link_${data}`, '_blank', 'noopener,noreferrer');
                                        } catch (err) {
                                            setStatusMsg({ type: 'error', text: err.message || "Failed to initiate verification." });
                                        } finally {
                                            setIsUpdatingPrivacy(false);
                                        }
                                    }}
                                    disabled={isUpdatingPrivacy}
                                    className="pso-action-btn pso-tg-btn"
                                >
                                    {isUpdatingPrivacy ? <i className="fas fa-circle-notch fa-spin"></i> : <>Verify <i className="fas fa-arrow-up-right-from-square" style={{ fontSize: '0.72rem', marginLeft: '4px' }}></i></>}
                                </button>
                            )}
                        </div>
                        <p className="pso-section-hint">
                            Used for instant 1-tap browser authentication and account recovery protection.
                        </p>
                    </div>

                    {/* 3. Account Security Section */}
                    <div className="pso-section">
                        <span className="pso-section-title">Account Security</span>
                        
                        <div className="pso-card">
                            <div className="pso-card-info">
                                <div className="pso-icon-box">
                                    <i className="fas fa-key"></i>
                                </div>
                                <div className="pso-text-group">
                                    <h4>Account Password</h4>
                                    <span className="pso-inline-meta">
                                        {hasPassword ? 'Protected' : (isSyntheticEmail ? 'No Email Linked' : 'Not Configured')}
                                    </span>
                                </div>
                            </div>
                            <button className="pso-action-btn" onClick={handleOpenPasswordModal}>
                                {hasPassword ? 'Change' : 'Set Up'}
                            </button>
                        </div>
                        <p className="pso-section-hint">
                            Configure standard email and password credentials to sign in directly without third-party popups.
                        </p>
                    </div>
                </div>
            </div>

            {/* Password Management Modal */}
            {isPasswordModalOpen && (
                <div className="pso-modal-overlay" onClick={handleClosePasswordModal}>
                    <div className="pso-modal-card" onClick={e => e.stopPropagation()}>
                        <div className="pso-modal-header">
                            <h3>{hasPassword ? 'Change Password' : (isSyntheticEmail ? 'Set Email & Password' : 'Create Account Password')}</h3>
                            <button className="icon-button" onClick={handleClosePasswordModal} disabled={loading} style={{ width: '32px', height: '32px' }}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        {!hasPassword && (
                            <div className="pso-badge-oauth">
                                <i className={`fas ${isSyntheticEmail ? 'fa-paper-plane' : 'fa-link'}`}></i>
                                <span>{isSyntheticEmail ? 'Telegram Session • No Email Linked' : `Linked to ${sessionUser?.email || 'Account'}`}</span>
                            </div>
                        )}

                        <div className="pso-alert-box info" style={{ background: 'rgba(66, 215, 184, 0.08)', border: '1px solid rgba(66, 215, 184, 0.25)', color: 'var(--accent-teal)', marginBottom: '4px' }}>
                            <i className="fas fa-lightbulb" style={{ marginRight: '6px' }}></i>
                            Choose a secure password and be sure to remember it!
                        </div>

                        {statusMsg && (
                            <div className={`pso-alert-box ${statusMsg.type}`}>
                                <i className={`fas ${statusMsg.type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} style={{ marginRight: '6px' }}></i>
                                {statusMsg.text}
                            </div>
                        )}

                        <form onSubmit={handleSubmitPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {isSyntheticEmail && (
                                <div className="pso-field-group">
                                    <label>Personal Email Address</label>
                                    <div className="pso-input-wrapper">
                                        <input 
                                            type="email" 
                                            className="pso-input"
                                            placeholder="Enter your email (e.g. alex@gmail.com)"
                                            value={realEmail}
                                            onChange={e => setRealEmail(e.target.value)}
                                            disabled={loading}
                                            required
                                            style={{ paddingRight: '14px' }}
                                        />
                                    </div>
                                    <span className="pso-field-hint">
                                        Required so you can sign in directly using email and password.
                                    </span>
                                </div>
                            )}

                            {hasPassword && (
                                <div className="pso-field-group">
                                    <label>Current Password</label>
                                    <div className="pso-input-wrapper">
                                        <input 
                                            type={showCurrent ? "text" : "password"} 
                                            className="pso-input"
                                            placeholder="Enter current password"
                                            value={currentPassword}
                                            onChange={e => setCurrentPassword(e.target.value)}
                                            disabled={loading}
                                            required
                                        />
                                        <button 
                                            type="button" 
                                            className="pso-eye-btn" 
                                            onClick={() => setShowCurrent(!showCurrent)}
                                            tabIndex={-1}
                                        >
                                            <i className={`fas ${showCurrent ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="pso-field-group">
                                <label>{hasPassword ? 'New Password' : 'Password'}</label>
                                <div className="pso-input-wrapper">
                                    <input 
                                        type={showNew ? "text" : "password"} 
                                        className="pso-input"
                                        placeholder="Minimum 6 characters"
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        disabled={loading}
                                        required
                                    />
                                    <button 
                                        type="button" 
                                        className="pso-eye-btn" 
                                        onClick={() => setShowNew(!showNew)}
                                        tabIndex={-1}
                                    >
                                        <i className={`fas ${showNew ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                    </button>
                                </div>
                            </div>

                            <div className="pso-field-group">
                                <label>Confirm Password</label>
                                <div className="pso-input-wrapper">
                                    <input 
                                        type={showConfirm ? "text" : "password"} 
                                        className="pso-input"
                                        placeholder="Repeat password"
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        disabled={loading}
                                        required
                                    />
                                    <button 
                                        type="button" 
                                        className="pso-eye-btn" 
                                        onClick={() => setShowConfirm(!showConfirm)}
                                        tabIndex={-1}
                                    >
                                        <i className={`fas ${showConfirm ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                    </button>
                                </div>
                            </div>

                            <div className="pso-modal-footer">
                                <button type="button" className="pso-btn-cancel" onClick={handleClosePasswordModal} disabled={loading}>
                                    Cancel
                                </button>
                                <button type="submit" className="pso-btn-submit" disabled={loading || !newPassword || !confirmPassword || (isSyntheticEmail && !realEmail.trim())}>
                                    {loading ? <i className="fas fa-circle-notch fa-spin"></i> : (hasPassword ? 'Update Password' : (isSyntheticEmail ? 'Link Email & Set Password' : 'Set Password'))}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PrivacySecurityOverlay;