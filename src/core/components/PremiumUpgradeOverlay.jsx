import React, { useState, useEffect } from 'react';
import './PremiumUpgradeOverlay.css';

const PremiumUpgradeOverlay = ({ isActive, onClose }) => {
    const [plan, setPlan] = useState('annual'); // 'semester' | 'annual'

    // Prevent body scroll when active
    useEffect(() => {
        if (isActive) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isActive]);

    return (
        <div className={`pu-overlay-wrapper ${isActive ? 'is-active' : ''}`} onClick={onClose}>
            {isActive && (
                <div className="pu-ambient-mesh">
                    <div className="pu-mesh-orb-1"></div>
                    <div className="pu-mesh-orb-2"></div>
                </div>
            )}

            <div className="pu-modal-frame" onClick={e => e.stopPropagation()}>
                <button className="pu-close-btn" onClick={onClose} aria-label="Close modal">
                    <i className="fa-solid fa-xmark"></i>
                </button>

                <header className="pu-header">
                    <div className="pu-crown-wrapper">
                        <div className="pu-crown-emblem">
                            <i className="fa-solid fa-crown"></i>
                        </div>
                        <div className="pu-crown-halo"></div>
                    </div>
                    <div className="pu-brand-tag">Academic Privilege</div>
                    <h1 className="pu-title">LinkUp Gold Pass</h1>
                    <p className="pu-subtitle">Elevate your academic standing with unrestricted AI reasoning, multi-year exam archives, and priority stage access.</p>
                </header>

                <div className="pu-billing-selector">
                    <div 
                        className={`pu-plan-card ${plan === 'semester' ? 'active' : ''}`} 
                        onClick={() => setPlan('semester')}
                    >
                        <span className="pu-plan-name">Semester Pass</span>
                        <div className="pu-plan-price">199 <span>ETB / sem</span></div>
                    </div>
                    <div 
                        className={`pu-plan-card ${plan === 'annual' ? 'active' : ''}`} 
                        onClick={() => setPlan('annual')}
                    >
                        <span className="pu-value-pill">Most Popular</span>
                        <span className="pu-plan-name">Annual Pass</span>
                        <div className="pu-plan-price">299 <span>ETB / yr</span></div>
                    </div>
                </div>

                <div className="pu-comparison-wrapper">
                    <table className="pu-comparison-table">
                        <thead>
                            <tr>
                                <th>Platform Capability</th>
                                <th className="col-standard">Standard</th>
                                <th className="col-gold">Gold Pass</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="pu-feature-title">
                                    <div className="pu-feature-icon"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
                                    <span>Miron AI Tutor</span>
                                </td>
                                <td className="pu-cell-standard">Fewer queries</td>
                                <td className="pu-cell-gold">
                                    <span className="pu-gold-highlight">
                                        <i className="fa-solid fa-check"></i> Unlimited 24/7 Access
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <td className="pu-feature-title">
                                    <div className="pu-feature-icon"><i className="fa-solid fa-file-signature"></i></div>
                                    <span>Exam Pavilion</span>
                                </td>
                                <td className="pu-cell-standard">Recent papers only</td>
                                <td className="pu-cell-gold">
                                    <span className="pu-gold-highlight">
                                        <i className="fa-solid fa-check"></i> Full Multi-Year Archives
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <td className="pu-feature-title">
                                    <div className="pu-feature-icon"><i className="fa-solid fa-book-bookmark"></i></div>
                                    <span>Book Reader Engine</span>
                                </td>
                                <td className="pu-cell-standard">Basic navigation</td>
                                <td className="pu-cell-gold">
                                    <span className="pu-gold-highlight">
                                        <i className="fa-solid fa-check"></i> Deep AI Explanations
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <td className="pu-feature-title">
                                    <div className="pu-feature-icon"><i className="fa-solid fa-podcast"></i></div>
                                    <span>Live Audio Stages</span>
                                </td>
                                <td className="pu-cell-standard">Listener mode</td>
                                <td className="pu-cell-gold">
                                    <span className="pu-gold-highlight">
                                        <i className="fa-solid fa-check"></i> Host & AI Co-Hosting
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <td className="pu-feature-title">
                                    <div className="pu-feature-icon"><i className="fa-solid fa-chart-line"></i></div>
                                    <span>Personal Observatory</span>
                                </td>
                                <td className="pu-cell-standard">Basic metrics</td>
                                <td className="pu-cell-gold">
                                    <span className="pu-gold-highlight">
                                        <i className="fa-solid fa-check"></i> Full Weakness Analytics
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <td className="pu-feature-title">
                                    <div className="pu-feature-icon"><i className="fa-solid fa-shield-halved"></i></div>
                                    <span>Scholar Distinction</span>
                                </td>
                                <td className="pu-cell-standard">Standard badge</td>
                                <td className="pu-cell-gold">
                                    <span className="pu-gold-highlight">
                                        <i className="fa-solid fa-crown"></i> Gold Crown & Priority Network
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="pu-cta-container">
                    <button className="pu-cta-btn" onClick={() => alert("Payment gateway integration coming soon!")}>
                        <span>{plan === 'semester' ? 'Get Semester Pass • 199 ETB' : 'Get Annual Pass • 299 ETB'}</span>
                        <i className="fa-solid fa-arrow-right"></i>
                    </button>
                    <div className="pu-guarantee">
                        <i className="fa-solid fa-lock"></i>
                        <span>Instant activation via Telebirr or CBE Birr</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PremiumUpgradeOverlay;