import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './PrivacySecurityOverlay.css';

const PrivacySecurityOverlay = ({ isActive, onClose }) => {
    const { sessionUser, user: userProfile } = usePlatform();
    
    // Check Telegram Identity Status
    const isTelegramLinked = !!(userProfile?.registered_with_telegram || userProfile?.telegram_id);
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
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [realEmail, setRealEmail] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    
    // Academic Privacy UI State (Pure UI)
    const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);
    
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
                    ? 'Credentials set! Check your inbox to verify your email, then you can log in with your email and password.'
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
        <div className="pso-overlay">
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
                    
                    <div className="pso-card" onClick={() => setShowOnLeaderboard(!showOnLeaderboard)} style={{ cursor: 'pointer' }}>
                        <div className="pso-card-info">
                            <div className="pso-icon-box" style={{ background: 'rgba(241, 196, 15, 0.1)', color: 'var(--linkoin-gold, #f1c40f)' }}>
                                <i className="fas fa-trophy"></i>
                            </div>
                            <div className="pso-text-group">
                                <h4>Campus Leaderboard Visibility</h4>
                                <p>
                                    {showOnLeaderboard 
                                        ? 'Your rank and brain score appear on the Observatory ladder'
                                        : 'Hidden from the campus ladder and peer rankings'}
                                </p>
                            </div>
                        </div>
                        <div 
                            className={`toggle-switch ${showOnLeaderboard ? 'on' : 'off'}`}
                            role="switch"
                            aria-checked={showOnLeaderboard}
                        ></div>
                    </div>
                </div>

                {/* 2. Identity & Verification Section */}
                <div className="pso-section">
                    <span className="pso-section-title">Identity & Verification</span>
                    
                    <div className="pso-card">
                        <div className="pso-card-info">
                            <div className="pso-icon-box" style={{ background: 'rgba(41, 169, 234, 0.12)', color: '#29A9EA' }}>
                                <i className="fab fa-telegram-plane"></i>
                            </div>
                            <div className="pso-text-group">
                                <h4>Telegram Identity</h4>
                                <p>
                                    {isTelegramLinked 
                                        ? `Verified as ${telegramHandle || 'Scholar'}${linkedPhone ? ` (${linkedPhone})` : ''}`
                                        : 'Not linked. Verify phone to enable 1-tap login & claim +50 Credits'}
                                </p>
                            </div>
                        </div>
                        {isTelegramLinked ? (
                            <div className="pso-badge-verified">
                                <i className="fas fa-check-circle"></i> Verified
                            </div>
                        ) : (
                            <a 
                                href={`https://t.me/linkupregistrationbot?start=verify_${sessionUser?.id}`} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="pso-action-btn telegram-btn"
                            >
                                Verify <i className="fas fa-arrow-up-right-from-square" style={{ fontSize: '0.75rem', marginLeft: '4px' }}></i>
                            </a>
                        )}
                    </div>
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
                                <h4>{hasPassword ? 'Account Password' : (isSyntheticEmail ? 'Set Email & Password' : 'Set Account Password')}</h4>
                                <p>
                                    {hasPassword 
                                        ? 'Update your password for email sign-in'
                                        : (isSyntheticEmail 
                                            ? 'Link a personal email and password to sign in anywhere' 
                                            : 'Enable email sign-in alongside Google/Telegram')}
                                </p>
                            </div>
                        </div>
                        <button className="pso-action-btn" onClick={handleOpenPasswordModal}>
                            {hasPassword ? 'Change' : 'Set Up'}
                        </button>
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
                                <span>{isSyntheticEmail ? 'Telegram Session • No Email Linked' : `Linked to ${sessionUser?.email || 'OAuth'}`}</span>
                            </div>
                        )}

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