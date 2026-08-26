import React, { useState, useEffect } from 'react';
import './PremiumUpgradeOverlay.css';

const PremiumUpgradeOverlay = ({ isActive, onClose }) => {
    const [plan, setPlan] = useState('annual'); // 'semester' | 'annual'

    // Prevent background page scroll while modal is active
    useEffect(() => {
        if (isActive) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isActive]);

    if (!isActive) return null;

    return (
        <div className={`pu-overlay-wrapper ${isActive ? 'is-active' : ''}`} onClick={onClose}>
            <div className="pu-ambient-backlight"></div>

            <div className="pu-modal-card" onClick={e => e.stopPropagation()}>
                {/* Vivid Classical Library Background */}
                <div className="pu-hero-bg-wrapper"></div>

                <button className="pu-close-btn" onClick={onClose} aria-label="Close modal">
                    <i className="fa-solid fa-xmark"></i>
                </button>

                <div className="pu-modal-content">
                    {/* Pure Floating 3D Glowing Crown Orb */}
                    <div className="pu-crown-orb-pure">
                        <i className="fa-solid fa-crown"></i>
                    </div>

                    {/* Scholar Tag Flanked by Golden Laurel Leaves */}
                    <div className="pu-scholar-badge">
                        <i className="fa-solid fa-leaf pu-leaf-icon"></i>
                        <span>Academic Privilege</span>
                        <i className="fa-solid fa-leaf pu-leaf-icon" style={{ transform: 'scaleX(-1)' }}></i>
                    </div>

                    <h1 className="pu-modal-title">LinkUp Gold Pass</h1>
                    <p className="pu-modal-subtitle">Unrestricted AI reasoning, complete multi-year exam pavilion archives, and live audio co-hosting.</p>

                    {/* Perks List with Emerald/Teal Checkmarks */}
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

                    {/* Interactive Plan Switcher */}
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

                    {/* Gold CTA Action Button */}
                    <button 
                        className="pu-cta-gold-btn" 
                        onClick={() => alert("Payment gateway integration coming soon!")}
                    >
                        <span>{plan === 'semester' ? 'Get Semester Pass • 199 ETB' : 'Get Annual Pass • 299 ETB'}</span>
                        <i className="fa-solid fa-arrow-right"></i>
                    </button>

                    {/* Trust Badge */}
                    <div className="pu-trust-footer">
                        <i className="fa-solid fa-shield-check"></i>
                        <span>Instant activation via Telebirr & CBE Birr</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PremiumUpgradeOverlay;