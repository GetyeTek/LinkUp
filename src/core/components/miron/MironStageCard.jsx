import React from 'react';

const MironStageCard = ({ cardData }) => {
    if (!cardData) return null;

    const mode = (cardData.mode || 'note').toLowerCase();

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

                {/* 2. COMPARE / BENTO VERSUS MODE */}
                {mode === 'compare' && (
                    <>
                        <div className="ml-card-head">
                            <span className="ml-card-mode-pill compare">
                                <i className="fas fa-arrows-left-right"></i>
                                {cardData.badge || 'COMPARATIVE ANALYSIS'}
                            </span>
                        </div>
                        {cardData.title && <h3 className="ml-card-title compare-title">{cardData.title}</h3>}
                        <div className="ml-compare-bento-grid">
                            <div className="ml-compare-col left-col">
                                <h4 className="ml-compare-col-title">{cardData.left?.title || 'Concept A'}</h4>
                                <ul className="ml-compare-points">
                                    {(cardData.left?.points || []).map((pt, pIdx) => (
                                        <li key={pIdx}>
                                            <i className="fas fa-circle-dot"></i>
                                            <span>{pt}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="ml-compare-vs-divider">
                                <span className="ml-vs-chip">VS</span>
                            </div>

                            <div className="ml-compare-col right-col">
                                <h4 className="ml-compare-col-title">{cardData.right?.title || 'Concept B'}</h4>
                                <ul className="ml-compare-points">
                                    {(cardData.right?.points || []).map((pt, pIdx) => (
                                        <li key={pIdx}>
                                            <i className="fas fa-circle-dot"></i>
                                            <span>{pt}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </>
                )}

                {/* 3. EXAM ALERT / HIGH YIELD MODE */}
                {mode === 'exam' && (
                    <>
                        <div className="ml-card-head">
                            <span className="ml-card-mode-pill exam">
                                <i className="fas fa-graduation-cap"></i>
                                {cardData.badge || 'HIGH YIELD EXAM ALERT'}
                            </span>
                            <span className="ml-exam-pulse-beacon"></span>
                        </div>
                        <h3 className="ml-card-title exam-title">{cardData.title || 'Watch Out on the Exam!'}</h3>
                        <div className="ml-exam-content-box">
                            <p className="ml-card-body-text">{cardData.body}</p>
                            {cardData.trap && (
                                <div className="ml-exam-trap-callout">
                                    <i className="fas fa-triangle-exclamation"></i>
                                    <span><strong>Common Trap:</strong> {cardData.trap}</span>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* 4. SUMMARY / RECAP MODE */}
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

                {/* 5. GENERIC NOTE / DEFINITION / CONCEPT CALLOUT */}
                {(mode === 'note' || (mode !== 'intro' && mode !== 'compare' && mode !== 'exam' && mode !== 'summary')) && (
                    <>
                        <div className="ml-card-head">
                            <span className="ml-card-mode-pill note">
                                <i className="fas fa-lightbulb"></i>
                                {cardData.badge || 'CONCEPT CALLOUT'}
                            </span>
                        </div>
                        {cardData.title && <h3 className="ml-card-title">{cardData.title}</h3>}
                        {cardData.body && <p className="ml-card-body-text">{cardData.body}</p>}
                        {Array.isArray(cardData.items) && cardData.items.length > 0 && (
                            <ul className="ml-card-note-points">
                                {cardData.items.map((item, idx) => (
                                    <li key={idx}>
                                        <i className="fas fa-chevron-right"></i>
                                        <span>{typeof item === 'string' ? item : item.text}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default MironStageCard;