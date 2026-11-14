import React from 'react';

const MironStageCard = ({ cardData, isPlaying = false }) => {
    if (!cardData) return null;

    const mode = (cardData.mode || 'intro').toLowerCase();

    const renderVoiceBadge = () => (
        <span className={`ml-card-voice-pill ${isPlaying ? 'is-speaking' : ''}`} title={isPlaying ? 'Miron Narrating' : 'Paused'}>
            <span className="ml-card-eq">
                <span className="ml-card-eq-bar b1"></span>
                <span className="ml-card-eq-bar b2"></span>
                <span className="ml-card-eq-bar b3"></span>
                <span className="ml-card-eq-bar b4"></span>
            </span>
            <span className="ml-card-voice-label">{isPlaying ? 'Speaking' : 'Paused'}</span>
        </span>
    );

    return (
        <div className={`ml-stage-card-wrapper mode-${mode}`}>
            <div className={`ml-stage-card card-${mode}`}>
                {/* 1. INTRO / ROADMAP MODE */}
                {mode === 'intro' && (
                    <>
                        <div className="ml-card-head">
                            <span className="ml-card-mode-pill intro">
                                <i className="fas fa-compass"></i>
                                {cardData.badge || 'SECTION ROADMAP'}
                            </span>
                            <div className="ml-card-head-right">
                                {cardData.subtitle && <span className="ml-card-meta">{cardData.subtitle}</span>}
                                {renderVoiceBadge()}
                            </div>
                        </div>
                        <h3 className="ml-card-title">{cardData.title}</h3>
                        {cardData.body && <p className="ml-card-body-text">{cardData.body}</p>}
                        {Array.isArray(cardData.items) && cardData.items.length > 0 && (
                            <div className={`ml-card-roadmap-list ${isPlaying ? 'is-speaking' : ''}`}>
                                {cardData.items.map((item, idx) => (
                                    <div key={idx} className="ml-roadmap-item" style={{ animationDelay: `${idx * 0.05}s` }}>
                                        <span className="ml-roadmap-index">{idx + 1}</span>
                                        <span className="ml-roadmap-label">{typeof item === 'string' ? item : item.text}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* 2. SUMMARY / RECAP MODE */}
                {mode === 'summary' && (
                    <>
                        <div className="ml-card-head">
                            <span className="ml-card-mode-pill summary">
                                <i className="fas fa-bookmark"></i>
                                {cardData.badge || 'KEY TAKEAWAYS RECAP'}
                            </span>
                            <div className="ml-card-head-right">
                                {renderVoiceBadge()}
                            </div>
                        </div>
                        <h3 className="ml-card-title">{cardData.title || 'Summary & Core Synthesis'}</h3>
                        {cardData.body && <p className="ml-card-body-text">{cardData.body}</p>}
                        {Array.isArray(cardData.items) && cardData.items.length > 0 && (
                            <div className="ml-card-summary-stream">
                                {cardData.items.map((item, idx) => (
                                    <div key={idx} className="ml-summary-row" style={{ animationDelay: `${idx * 0.05}s` }}>
                                        <i className="fas fa-circle-check ml-summary-glyph"></i>
                                        <span className="ml-summary-text">{typeof item === 'string' ? item : item.text}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default MironStageCard;