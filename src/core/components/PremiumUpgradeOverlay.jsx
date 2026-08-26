import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './PremiumUpgradeOverlay.css';

const parseTransactionRef = (text) => {
    if (!text) return '';
    const cbeMatch = text.match(/\b(FT[A-Z0-9]{8,20})\b/i) || text.match(/Txn\s*ID[:\s]*([A-Z0-9]+)/i);
    if (cbeMatch) return cbeMatch[1].toUpperCase();

    const tbMatch = text.match(/(?:transaction\s*no\.?|trans\.?\s*id[:\s]*)([A-Z0-9]{8,20})/i) || text.match(/\b(TB[A-Z0-9]{8,20})\b/i);
    if (tbMatch) return tbMatch[1].toUpperCase();

    return '';
};

const PremiumUpgradeOverlay = ({ isActive, onClose }) => {
    const { sessionUser, user: userProfile } = usePlatform();
    
    // View States: 'pricing' | 'methods' | 'verify' | 'pending' | 'active_pro' | 'rejected'
    const [view, setView] = useState('pricing');
    const [plan, setPlan] = useState('annual'); // 'semester' (199) | 'annual' (299)
    const [selectedMethod, setSelectedMethod] = useState('cbe'); // 'cbe' | 'telebirr'
    
    // Accounts loaded strictly from backend (Zero hardcoded fallbacks to prevent misrouted funds)
    const [accounts, setAccounts] = useState(null);
    const [accountsLoading, setAccountsLoading] = useState(true);
    const [accountsError, setAccountsError] = useState(null);

    const fetchPaymentAccounts = async () => {
        setAccountsLoading(true);
        setAccountsError(null);
        try {
            const { data, error } = await supabase.rpc('get_payment_methods');
            if (error) throw error;
            if (data && (data.cbe?.account_number || data.telebirr?.phone_number)) {
                const enriched = {
                    ...data,
                    cbe: {
                        ...data.cbe,
                        icon_url: data.cbe?.icon_url || 'https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/public_assets/cbe_logo.png'
                    },
                    telebirr: {
                        ...data.telebirr,
                        icon_url: data.telebirr?.icon_url || 'https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/public_assets/telebirr_logo.png'
                    }
                };
                setAccounts(enriched);
            } else {
                throw new Error("Payment channels are currently offline. Official recipient numbers could not be verified.");
            }
        } catch (err) {
            console.error("Failed to load payment accounts:", err);
            setAccountsError(err.message || "Failed to load payment accounts from server.");
            setAccounts(null);
        } finally {
            setAccountsLoading(false);
        }
    };

    // Verification Form States
    const [smsText, setSmsText] = useState('');
    const [txnRef, setTxnRef] = useState('');
    const [receiptFile, setReceiptFile] = useState(null);
    const [receiptPreview, setReceiptPreview] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copiedKey, setCopiedKey] = useState(null);
    const [existingSubmission, setExistingSubmission] = useState(null);
    const fileInputRef = useRef(null);

    // Prevent background scroll
    useEffect(() => {
        if (isActive) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isActive]);

    // Fetch Dynamic Accounts & User Verification Status on Open
    useEffect(() => {
        if (!isActive || !sessionUser?.id) return;

        // 1. Fetch Dynamic Payment Accounts from RPC strictly
        fetchPaymentAccounts();

        // 2. Check Pro Status
        if (userProfile?.is_pro) {
            setView('active_pro');
            return;
        }

        // 3. Check for existing payment submissions
        supabase
            .from('payment_submissions')
            .select('*')
            .eq('user_id', sessionUser.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => {
                if (data) {
                    setExistingSubmission(data);
                    if (data.status === 'pending') {
                        setView('pending');
                    } else if (data.status === 'rejected') {
                        setView('rejected');
                    } else {
                        setView('pricing');
                    }
                } else {
                    setView('pricing');
                }
            });
    }, [isActive, sessionUser?.id, userProfile?.is_pro]);

    // Handle SMS input & Auto-Extraction
    const handleSmsChange = (text) => {
        setSmsText(text);
        const extracted = parseTransactionRef(text);
        if (extracted) {
            setTxnRef(extracted);
        }
    };

    // Handle Screenshot File Pick
    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            alert("File is too large. Please select a receipt under 10MB.");
            return;
        }

        setReceiptFile(file);
        setReceiptPreview(URL.createObjectURL(file));
    };

    // 1-Tap Copy Helper
    const copyToClipboard = (text, key) => {
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        if (navigator.vibrate) navigator.vibrate(20);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    // Submit Proof of Payment
    const handleSubmitProof = async () => {
        if (!smsText.trim() && !receiptFile) {
            alert("Please paste the confirmation SMS text or attach a screenshot of your receipt.");
            return;
        }

        setIsSubmitting(true);
        try {
            let uploadedImageUrl = existingSubmission?.screenshot_url || null;

            // Upload Screenshot if attached
            if (receiptFile) {
                const arrayBuffer = await receiptFile.arrayBuffer();
                const filePath = `${sessionUser.id}/${Date.now()}_receipt.png`;

                const { error: uploadError } = await supabase.storage
                    .from('payment_receipts')
                    .upload(filePath, arrayBuffer, {
                        contentType: receiptFile.type,
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage
                    .from('payment_receipts')
                    .getPublicUrl(filePath);

                uploadedImageUrl = publicUrl;
            }

            const amount = plan === 'semester' ? 199 : 299;

            const payload = {
                user_id: sessionUser.id,
                plan,
                amount,
                payment_method: selectedMethod,
                transaction_ref: txnRef.trim() || null,
                sms_text: smsText.trim() || null,
                screenshot_url: uploadedImageUrl,
                status: 'pending',
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('payment_submissions')
                .insert(payload)
                .select()
                .single();

            if (error) throw error;

            setExistingSubmission(data);
            setView('pending');
            if (navigator.vibrate) navigator.vibrate([40, 60, 40]);

        } catch (err) {
            console.error("Payment proof submission error:", err);
            alert(err.message || "Failed to submit verification. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isActive) return null;

    const amountDue = plan === 'semester' ? 199 : 299;

    return (
        <div className={`pu-overlay-wrapper ${isActive ? 'is-active' : ''}`} onClick={onClose}>
            <div className="pu-ambient-backlight"></div>

            <div className="pu-modal-card" onClick={e => e.stopPropagation()}>
                <div className="pu-hero-bg-wrapper"></div>

                {/* Navigation Controls */}
                {view === 'methods' && (
                    <button className="pu-back-btn" onClick={() => setView('pricing')} aria-label="Back">
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                )}
                {view === 'verify' && (
                    <button className="pu-back-btn" onClick={() => setView('methods')} aria-label="Back">
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                )}

                <button className="pu-close-btn" onClick={onClose} aria-label="Close modal">
                    <i className="fa-solid fa-xmark"></i>
                </button>

                <div className="pu-modal-content">
                    
                    {/* ====================================================================
                        1. PRICING SCREEN
                        ==================================================================== */}
                    {view === 'pricing' && (
                        <>
                            <div className="pu-crown-orb-pure">
                                <i className="fa-solid fa-crown"></i>
                            </div>

                            <div className="pu-scholar-badge">
                                <i className="fa-solid fa-leaf pu-leaf-icon"></i>
                                <span>Academic Privilege</span>
                                <i className="fa-solid fa-leaf pu-leaf-icon" style={{ transform: 'scaleX(-1)' }}></i>
                            </div>

                            <h1 className="pu-modal-title">LinkUp Gold Pass</h1>
                            <p className="pu-modal-subtitle">Unrestricted AI reasoning, complete multi-year exam pavilion archives, and live audio co-hosting.</p>

                            <div className="pu-perks-list">
                                <div className="pu-perk-item">
                                    <div className="pu-perk-check-green"><i className="fa-solid fa-check"></i></div>
                                    <div className="pu-perk-text"><strong>Unlimited Miron AI:</strong> 24/7 Deep Reasoning & Tutoring</div>
                                </div>
                                <div className="pu-perk-item">
                                    <div className="pu-perk-check-green"><i className="fa-solid fa-check"></i></div>
                                    <div className="pu-perk-text"><strong>Exam Pavilion:</strong> Full Multi-Year University Archives</div>
                                </div>
                                <div className="pu-perk-item">
                                    <div className="pu-perk-check-green"><i className="fa-solid fa-check"></i></div>
                                    <div className="pu-perk-text"><strong>Live Audio Stages:</strong> AI Co-Hosting & Lecture Sync</div>
                                </div>
                                <div className="pu-perk-item">
                                    <div className="pu-perk-check-green"><i className="fa-solid fa-check"></i></div>
                                    <div className="pu-perk-text"><strong>Scholar Distinction:</strong> Verified Gold Crown & Priority Network</div>
                                </div>
                            </div>

                            <div className="pu-plan-switcher">
                                <div 
                                    className={`pu-plan-card ${plan === 'semester' ? 'active' : ''}`} 
                                    onClick={() => setPlan('semester')}
                                >
                                    <div className="pu-plan-tag">Semester Pass</div>
                                    <div className="pu-plan-price">199 <span>ETB</span></div>
                                </div>
                                <div 
                                    className={`pu-plan-card ${plan === 'annual' ? 'active' : ''}`} 
                                    onClick={() => setPlan('annual')}
                                >
                                    <div className="pu-save-ribbon">Save 35%</div>
                                    <div className="pu-plan-tag">Annual Pass</div>
                                    <div className="pu-plan-price">299 <span>ETB</span></div>
                                </div>
                            </div>

                            <button className="pu-cta-gold-btn" onClick={() => setView('methods')}>
                                <span>Proceed to Payment • {amountDue} ETB</span>
                                <i className="fa-solid fa-arrow-right"></i>
                            </button>

                            <div className="pu-trust-footer">
                                <i className="fa-solid fa-shield-check"></i>
                                <span>Instant activation via Telebirr & CBE Birr</span>
                            </div>
                        </>
                    )}

                    {/* ====================================================================
                        2. PAYMENT METHODS SCREEN (STRICT SERVER-VERIFIED)
                        ==================================================================== */}
                    {view === 'methods' && (
                        <>
                            <div className="pu-scholar-badge" style={{ marginTop: '1rem' }}>
                                <span>Select Payment Channel</span>
                            </div>

                            <h1 className="pu-modal-title" style={{ fontSize: '1.9rem' }}>Pay {amountDue} ETB</h1>
                            <p className="pu-modal-subtitle">Transfer the exact amount to either account below, then submit your confirmation text or receipt.</p>

                            {accountsLoading ? (
                                <div className="pu-accounts-loading">
                                    <i className="fa-solid fa-shield-halved fa-spin" style={{ fontSize: '2rem', color: 'var(--gold-main)', marginBottom: '10px' }}></i>
                                    <p>Verifying official banking channels...</p>
                                </div>
                            ) : accountsError || !accounts ? (
                                <div className="pu-accounts-error">
                                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '2rem', color: '#ff5f5f', marginBottom: '8px' }}></i>
                                    <h3 style={{ color: '#fff', fontSize: '1rem', marginBottom: '6px' }}>Payment Channels Unavailable</h3>
                                    <p style={{ fontSize: '0.8rem', color: '#aaa', lineHeight: 1.4, margin: '0 0 12px 0' }}>
                                        {accountsError || "Could not retrieve verified recipient accounts from the server."}
                                    </p>
                                    <button className="pu-retry-btn" onClick={fetchPaymentAccounts}>
                                        <i className="fa-solid fa-rotate-right"></i> Retry Connection
                                    </button>
                                </div>
                            ) : (
                                <div className="pu-accounts-container">
                                    {/* CBE Bank Card */}
                                    {accounts.cbe?.account_number && (
                                        <div className="pu-account-card cbe-theme">
                                            <div className="pu-acc-header">
                                                <span className="pu-acc-title">
                                                    {accounts.cbe.icon_url ? (
                                                        <img 
                                                            src={accounts.cbe.icon_url} 
                                                            alt="CBE" 
                                                            className="pu-brand-logo" 
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <i className="fa-solid fa-building-columns"></i>
                                                    )}
                                                    {accounts.cbe.bank_name || 'CBE'}
                                                </span>
                                                <span className="pu-acc-name">{accounts.cbe.account_name}</span>
                                            </div>
                                            <div className="pu-acc-box">
                                                <span className="pu-acc-number">{accounts.cbe.account_number}</span>
                                                <button 
                                                    className={`pu-copy-btn ${copiedKey === 'cbe' ? 'copied' : ''}`}
                                                    onClick={() => copyToClipboard(accounts.cbe.account_number, 'cbe')}
                                                >
                                                    <i className={`fa-solid ${copiedKey === 'cbe' ? 'fa-check' : 'fa-copy'}`}></i>
                                                    <span>{copiedKey === 'cbe' ? 'Copied' : 'Copy'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Telebirr Card */}
                                    {accounts.telebirr?.phone_number && (
                                        <div className="pu-account-card telebirr-theme">
                                            <div className="pu-acc-header">
                                                <span className="pu-acc-title">
                                                    {accounts.telebirr.icon_url ? (
                                                        <img 
                                                            src={accounts.telebirr.icon_url} 
                                                            alt="Telebirr" 
                                                            className="pu-brand-logo" 
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <i className="fa-solid fa-mobile-screen-button"></i>
                                                    )}
                                                    Telebirr
                                                </span>
                                                <span className="pu-acc-name">{accounts.telebirr.account_name}</span>
                                            </div>
                                            <div className="pu-acc-box">
                                                <span className="pu-acc-number">{accounts.telebirr.phone_number}</span>
                                                <button 
                                                    className={`pu-copy-btn ${copiedKey === 'telebirr' ? 'copied' : ''}`}
                                                    onClick={() => copyToClipboard(accounts.telebirr.phone_number, 'telebirr')}
                                                >
                                                    <i className={`fa-solid ${copiedKey === 'telebirr' ? 'fa-check' : 'fa-copy'}`}></i>
                                                    <span>{copiedKey === 'telebirr' ? 'Copied' : 'Copy'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button 
                                className="pu-cta-gold-btn" 
                                onClick={() => setView('verify')} 
                                disabled={accountsLoading || !accounts || !!accountsError}
                            >
                                <span>Already Paid? Verify Payment</span>
                                <i className="fa-solid fa-check-double"></i>
                            </button>

                            <div className="pu-trust-footer">
                                <span>Questions? Contact support {accounts?.support_contact || '@getyetek'}</span>
                            </div>
                        </>
                    )}

                    {/* ====================================================================
                        3. VERIFICATION & PROOF FORM
                        ==================================================================== */}
                    {view === 'verify' && (
                        <>
                            <div className="pu-scholar-badge" style={{ marginTop: '0.5rem' }}>
                                <span>Proof of Payment</span>
                            </div>

                            <h1 className="pu-modal-title" style={{ fontSize: '1.8rem' }}>Verify {amountDue} ETB</h1>
                            <p className="pu-modal-subtitle">Paste the confirmation SMS you received or attach a screenshot.</p>

                            <div className="pu-verify-form">
                                <div className="pu-method-tabs">
                                    <button 
                                        className={`pu-method-tab ${selectedMethod === 'cbe' ? 'active' : ''}`}
                                        onClick={() => setSelectedMethod('cbe')}
                                    >
                                        {accounts?.cbe?.icon_url ? (
                                            <img src={accounts.cbe.icon_url} alt="CBE" className="pu-tab-logo" onError={(e) => { e.target.style.display = 'none'; }} />
                                        ) : (
                                            <i className="fa-solid fa-building-columns"></i>
                                        )}
                                        Paid with CBE
                                    </button>
                                    <button 
                                        className={`pu-method-tab ${selectedMethod === 'telebirr' ? 'active' : ''}`}
                                        onClick={() => setSelectedMethod('telebirr')}
                                    >
                                        {accounts?.telebirr?.icon_url ? (
                                            <img src={accounts.telebirr.icon_url} alt="Telebirr" className="pu-tab-logo" onError={(e) => { e.target.style.display = 'none'; }} />
                                        ) : (
                                            <i className="fa-solid fa-mobile-screen-button"></i>
                                        )}
                                        Paid with Telebirr
                                    </button>
                                </div>

                                <div className="pu-field-group">
                                    <label className="pu-field-label">
                                        <span>Confirmation SMS Text</span>
                                        <span className="req">(Optional if uploading pic)</span>
                                    </label>
                                    <textarea 
                                        className="pu-textarea" 
                                        placeholder="Paste the transaction SMS from CBE or Telebirr here..."
                                        value={smsText}
                                        onChange={e => handleSmsChange(e.target.value)}
                                        disabled={isSubmitting}
                                    />
                                    {txnRef && (
                                        <div className="pu-parsed-tag">
                                            <i className="fa-solid fa-circle-check"></i>
                                            <span>Detected Txn Ref: <strong>{txnRef}</strong></span>
                                        </div>
                                    )}
                                </div>

                                <div className="pu-field-group">
                                    <label className="pu-field-label">
                                        <span>Screenshot / Receipt</span>
                                        <span className="req">(Optional if SMS pasted)</span>
                                    </label>
                                    
                                    <input 
                                        type="file" 
                                        ref={fileInputRef} 
                                        accept="image/*" 
                                        style={{ display: 'none' }} 
                                        onChange={handleFileChange} 
                                        disabled={isSubmitting}
                                    />

                                    <div 
                                        className={`pu-dropzone ${receiptFile ? 'has-file' : ''}`}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {receiptFile ? (
                                            <>
                                                <i className="fa-solid fa-file-image"></i>
                                                <span>{receiptFile.name} (Tap to change)</span>
                                            </>
                                        ) : (
                                            <>
                                                <i className="fa-solid fa-cloud-arrow-up"></i>
                                                <span>Tap to attach receipt screenshot</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button 
                                className="pu-cta-gold-btn" 
                                onClick={handleSubmitProof}
                                disabled={isSubmitting || (!smsText.trim() && !receiptFile)}
                            >
                                {isSubmitting ? (
                                    <>
                                        <i className="fa-solid fa-circle-notch fa-spin"></i>
                                        <span>Submitting Proof...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Submit for Verification</span>
                                        <i className="fa-solid fa-paper-plane"></i>
                                    </>
                                )}
                            </button>
                        </>
                    )}

                    {/* ====================================================================
                        4. PENDING VERIFICATION STATE
                        ==================================================================== */}
                    {view === 'pending' && (
                        <div className="pu-status-container">
                            <div className="pu-status-icon-orb pending">
                                <i className="fa-solid fa-hourglass-half"></i>
                            </div>

                            <h1 className="pu-modal-title" style={{ fontSize: '1.8rem' }}>Verification in Progress</h1>
                            <p className="pu-modal-subtitle">
                                We received your payment submission. Our team will verify the transaction and activate your Gold Pass shortly.
                            </p>

                            <div className="pu-status-card">
                                <div><strong>Plan:</strong> {existingSubmission?.plan === 'annual' ? 'Annual Pass (299 ETB)' : 'Semester Pass (199 ETB)'}</div>
                                {existingSubmission?.transaction_ref && (
                                    <div style={{ marginTop: '4px' }}><strong>Txn Ref:</strong> {existingSubmission.transaction_ref}</div>
                                )}
                                <div style={{ marginTop: '4px' }}><strong>Status:</strong> <span style={{ color: 'var(--gold-main)', fontWeight: 600 }}>Under Review</span></div>
                                <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#888' }}>
                                    If not approved within 24 hours, please contact support {accounts?.support_contact || '@getyetek'}.
                                </div>
                            </div>

                            <button className="pu-secondary-btn" onClick={() => setView('verify')}>
                                <i className="fa-solid fa-pen" style={{ marginRight: '6px' }}></i> Update / Re-Upload Proof
                            </button>

                            <button className="pu-cta-gold-btn" style={{ marginTop: '10px' }} onClick={onClose}>
                                <span>Done</span>
                            </button>
                        </div>
                    )}

                    {/* ====================================================================
                        5. ACTIVE GOLD MEMBER STATUS
                        ==================================================================== */}
                    {view === 'active_pro' && (
                        <div className="pu-status-container">
                            <div className="pu-status-icon-orb approved">
                                <i className="fa-solid fa-crown"></i>
                            </div>

                            <div className="pu-scholar-badge">
                                <i className="fa-solid fa-check"></i>
                                <span>Gold Pass Active</span>
                            </div>

                            <h1 className="pu-modal-title" style={{ fontSize: '2rem' }}>You Are Gold!</h1>
                            <p className="pu-modal-subtitle">
                                All academic privileges are fully unlocked on your account.
                            </p>

                            <div className="pu-status-card">
                                <div><strong>Membership:</strong> LinkUp Gold Scholar</div>
                                {userProfile?.pro_expires_at && (
                                    <div style={{ marginTop: '4px' }}>
                                        <strong>Expires:</strong> {new Date(userProfile.pro_expires_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                )}
                            </div>

                            <button className="pu-cta-gold-btn" onClick={onClose}>
                                <span>Return to Dashboard</span>
                            </button>
                        </div>
                    )}

                    {/* ====================================================================
                        6. REJECTED SUBMISSION STATE
                        ==================================================================== */}
                    {view === 'rejected' && (
                        <div className="pu-status-container">
                            <div className="pu-status-icon-orb rejected">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>

                            <h1 className="pu-modal-title" style={{ fontSize: '1.8rem', color: '#ff5f5f' }}>Verification Issue</h1>
                            <p className="pu-modal-subtitle">
                                We could not confirm your previous transaction.
                            </p>

                            <div className="pu-status-card" style={{ borderColor: 'rgba(255, 95, 95, 0.3)' }}>
                                <div><strong>Reason:</strong> {existingSubmission?.rejection_reason || 'Transaction could not be matched with bank records.'}</div>
                                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: '#aaa' }}>
                                    Please verify your account details or re-upload a clear receipt screenshot.
                                </div>
                            </div>

                            <button className="pu-cta-gold-btn" onClick={() => setView('verify')}>
                                <span>Re-Submit Proof</span>
                                <i className="fa-solid fa-arrow-rotate-right"></i>
                            </button>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default PremiumUpgradeOverlay;