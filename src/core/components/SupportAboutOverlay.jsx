import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './SupportAboutOverlay.css';

const SupportAboutOverlay = ({ isActive, onClose }) => {
    const { t } = usePlatform();

    if (!isActive) return null;

    return (
        <div className="sao-overlay" onClick={onClose}>
            <div className="sao-dialog-card" onClick={e => e.stopPropagation()}>
                <header className="sao-header">
                    <button className="icon-button" onClick={onClose} style={{ marginLeft: '-0.5rem', marginRight: '0.75rem' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h2>{t('support_about', 'Support & About')}</h2>
                </header>

                <div className="sao-body">
                    {/* 1. What is LinkUp */}
                <div className="sao-section">
                    <span className="sao-section-title">About the Platform</span>
                    <div className="sao-card">
                        <h3>What is LinkUp?</h3>
                        <p>
                            <strong>LinkUp</strong> is an academic platform built specifically for Ethiopian university students. It unifies course textbooks, past university examination archives, peer discussion groups, and interactive AI tutoring into a single, distraction-free environment.
                        </p>
                        <p>
                            Whether preparing for midterms, reviewing challenging textbook chapters with step-by-step mathematical derivations, or collaborating with classmates in live study sessions, LinkUp is designed to streamline your daily academic journey.
                        </p>
                    </div>
                </div>

                {/* 2. Rollout & Beta Testing Notice */}
                <div className="sao-section">
                    <span className="sao-section-title">Rollout & Testing Status</span>
                    <div className="sao-card">
                        <h3>Freshman Beta Testing</h3>
                        <p>
                            LinkUp is currently in its active <strong>Beta Testing Phase</strong>, rolling out initially for <strong>Freshman students</strong> across Ethiopian universities in both Natural Science and Social Science streams.
                        </p>
                        <p>
                            Starting with the universal freshman curriculum allows us to thoroughly test textbook navigation, past exam questions, and study algorithms with real student feedback.
                        </p>
                        <p>
                            <strong>Upcoming Department Expansions:</strong> Standardized curriculum materials, senior exam collections, and specialized resources for upper-year departments (such as Computer Science, Software Engineering, Medicine, Economics, Management, and Engineering streams) are actively being prepared and will be deployed in upcoming releases.
                        </p>
                    </div>
                </div>

                {/* 3. Security, Privacy & Data Protection */}
                <div className="sao-section">
                    <span className="sao-section-title">Privacy & Security</span>
                    <div className="sao-card">
                        <h3>How Your Data is Handled</h3>
                        <p>
                            We take student privacy and account safety seriously. Here is our direct commitment to how information is stored and managed:
                        </p>
                        <ul>
                            <li>
                                <strong>Phone & Identity Verification:</strong> When you verify your phone number via Telegram, it is used strictly for identity confirmation, spam protection, and account recovery. Your phone number is never sold, shared with advertising brokers, or displayed publicly.
                            </li>
                            <li>
                                <strong>Academic Privacy:</strong> You retain complete control over your profile. You can opt out of the campus leaderboard at any time through Privacy & Security settings if you prefer your study streaks and scores to remain private.
                            </li>
                            <li>
                                <strong>Group & Communication Integrity:</strong> Private study groups are restricted to invited members only. Public groups adhere to community guidelines to prevent harassment or unauthorized academic distribution.
                            </li>
                            <li>
                                <strong>No Third-Party Tracking:</strong> We do not track your activity across other websites or sell behavioral data to external companies.
                            </li>
                        </ul>
                    </div>
                </div>

                {/* 4. Official Contact & Support Channels */}
                <div className="sao-section">
                    <span className="sao-section-title">Help & Community Channels</span>
                    <div className="sao-contact-grid">
                        <a 
                            href="https://t.me/link_up_official" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="sao-contact-card"
                        >
                            <div className="sao-contact-info">
                                <div className="sao-contact-icon telegram">
                                    <i className="fab fa-telegram-plane"></i>
                                </div>
                                <div className="sao-contact-text">
                                    <h4>Official Community & Discussion</h4>
                                    <span>t.me/link_up_official</span>
                                </div>
                            </div>
                            <i className="fas fa-chevron-right sao-contact-arrow"></i>
                        </a>

                        <a 
                            href="mailto:linkupteam03@gmail.com" 
                            className="sao-contact-card"
                        >
                            <div className="sao-contact-info">
                                <div className="sao-contact-icon email">
                                    <i className="fas fa-envelope-open-text"></i>
                                </div>
                                <div className="sao-contact-text">
                                    <h4>Technical Support & Feedback</h4>
                                    <span>linkupteam03@gmail.com</span>
                                </div>
                            </div>
                            <i className="fas fa-chevron-right sao-contact-arrow"></i>
                        </a>

                        <a 
                            href="mailto:linkupofficialhub@gmail.com" 
                            className="sao-contact-card"
                        >
                            <div className="sao-contact-info">
                                <div className="sao-contact-icon email">
                                    <i className="fas fa-building-columns"></i>
                                </div>
                                <div className="sao-contact-text">
                                    <h4>General & Institutional Inquiries</h4>
                                    <span>linkupofficialhub@gmail.com</span>
                                </div>
                            </div>
                            <i className="fas fa-chevron-right sao-contact-arrow"></i>
                        </a>
                    </div>
                </div>

                <div className="sao-footer-note">
                    <p>LinkUp Platform • Version 3.0 (Campus Edition)<br/>Developed for university students across Ethiopia.</p>
                </div>
            </div>
        </div>
    );
};

export default SupportAboutOverlay;