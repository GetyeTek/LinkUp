import React from 'react';

const MironStageCard = ({ cardData }) => {
    if (!cardData) return null;

    const mode = (cardData.mode || 'intro').toLowerCase();

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
                            {cardData.subtitle && <span className="ml-card-meta">{cardData.subtitle}</span>}
                        </div>
                        <h3 className="ml-card-title">{cardData.title}</h3>
                        {cardData.body && <p className="ml-card-body-text">{cardData.body}</p>}
                        {Array.isArray(cardData.items) && cardData.items.length > 0 && (
                            <div className="ml-card-roadmap-list">
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