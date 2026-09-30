import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './AppearanceOverlay.css';

const AppearanceOverlay = ({ isActive, onClose }) => {
    const { theme, setTheme, language, changeLanguage, t } = usePlatform();

    if (!isActive) return null;

    return (
        <div className="appearance-overlay">
            <header className="ao-header" style={{ justifyContent: 'flex-start', gap: '1.25rem' }}>
                <button className="icon-button" onClick={onClose} style={{ marginLeft: '-0.5rem' }}>
                    <i className="fas fa-chevron-left"></i>
                </button>
                <h2>{t('appearance', 'Appearance')}</h2>
            </header>

            <div className="ao-body">
                {/* 1. Theme Configuration */}
                <div className="ao-section">
                    <span className="ao-section-title">{t('theme_mode', 'Theme Mode')}</span>
                    
                    <div className="ao-options-grid">
                        <div 
                            className={`ao-card ${theme === 'dark' ? 'active' : ''}`}
                            onClick={() => setTheme('dark')}
                        >
                            <div className="ao-card-info">
                                <div className="ao-icon-box">
                                    <i className="fas fa-moon"></i>
                                </div>
                                <div className="ao-text-group">
                                    <h4>{t('theme_dark', 'Dark Mode')}</h4>
                                    <p>{t('theme_dark_desc', 'OLED-friendly dark palette')}</p>
                                </div>
                            </div>
                            <div className="ao-indicator"></div>
                        </div>

                        <div 
                            className={`ao-card ${theme === 'light' ? 'active' : ''}`}
                            onClick={() => setTheme('light')}
                        >
                            <div className="ao-card-info">
                                <div className="ao-icon-box">
                                    <i className="fas fa-sun"></i>
                                </div>
                                <div className="ao-text-group">
                                    <h4>{t('theme_light', 'Light Mode')}</h4>
                                    <p>{t('theme_light_desc', 'High-contrast clean daylight palette')}</p>
                                </div>
                            </div>
                            <div className="ao-indicator"></div>
                        </div>
                    </div>
                </div>

                {/* 2. Language Selection */}
                <div className="ao-section">
                    <span className="ao-section-title">{t('language', 'Display Language')}</span>

                    <div className="ao-options-grid">
                        <div 
                            className={`ao-card ${language === 'en' ? 'active' : ''}`}
                            onClick={() => changeLanguage('en')}
                        >
                            <div className="ao-card-info">
                                <div className="ao-icon-box" style={{ fontSize: '1.3rem' }}>
                                    <span>🇺🇸</span>
                                </div>
                                <div className="ao-text-group">
                                    <h4>English</h4>
                                </div>
                            </div>
                            <div className="ao-indicator"></div>
                        </div>

                        <div 
                            className={`ao-card ${language === 'am' ? 'active' : ''}`}
                            onClick={() => changeLanguage('am')}
                        >
                            <div className="ao-card-info">
                                <div className="ao-icon-box" style={{ fontSize: '1.3rem' }}>
                                    <span>🇪🇹</span>
                                </div>
                                <div className="ao-text-group">
                                    <h4>አማርኛ</h4>
                                </div>
                            </div>
                            <div className="ao-indicator"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AppearanceOverlay;