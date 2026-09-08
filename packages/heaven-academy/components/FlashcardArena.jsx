import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@linkup-platform/sdk-core';
import './FlashcardArena.css';

const FlashcardArena = ({ deck, cards = [], onClose }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [stats, setStats] = useState({ hard: 0, good: 0, easy: 0 });
    const [isCompleted, setIsCompleted] = useState(false);

    if (!cards || cards.length === 0) {
        return (
            <div className="fca-overlay">
                <header className="fca-topbar">
                    <button className="fca-btn-close" onClick={onClose}><i className="fas fa-times"></i></button>
                </header>
                <main className="fca-summary">
                    <i className="fas fa-box-open" style={{ fontSize: '2.5rem', color: '#888', marginBottom: '1rem' }}></i>
                    <h2>No Cards Due</h2>
                    <p>You are all caught up on this deck. Check back later for your next scheduled review.</p>
                    <button className="fca-btn-finish" onClick={onClose}>Return to Decks</button>
                </main>
            </div>
        );
    }

    const currentCard = cards[currentIndex];
    const progressPct = ((currentIndex + 1) / cards.length) * 100;

    const handleFlip = () => {
        setIsFlipped(!isFlipped);
        if (navigator.vibrate) navigator.vibrate(18);
    };

    const handleRate = async (difficulty) => {
        setStats(prev => ({ ...prev, [difficulty]: prev[difficulty] + 1 }));
        if (navigator.vibrate) navigator.vibrate([15, 30]);

        // Non-blocking background sync (bypasses thenable .catch limitation)
        if (currentCard?.id) {
            (async () => {
                try {
                    await supabase.rpc('record_flashcard_review', {
                        p_card_id: currentCard.id,
                        p_card_type: currentCard.is_mistake ? 'mistake' : 'course',
                        p_difficulty: difficulty
                    });
                } catch (e) {
                    console.warn('SRS review sync warning:', e?.message || e);
                }
            })();
        }

        setIsFlipped(false);

        if (currentIndex + 1 < cards.length) {
            setCurrentIndex(prev => prev + 1);
        } else {
            setIsCompleted(true);
        }
    };

    return (
        <div className="fca-overlay">
            {!isCompleted ? (
                <>
                    <header className="fca-topbar">
                        <button className="fca-btn-close" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                        <span className="fca-counter">Card {currentIndex + 1} / {cards.length}</span>
                        <div style={{ width: '36px' }}></div>
                    </header>

                    <div className="fca-progress-track">
                        <div className="fca-progress-fill" style={{ width: `${progressPct}%` }}></div>
                    </div>

                    <main className="fca-stage">
                        <div 
                            className={`fca-flip-card ${isFlipped ? 'is-flipped' : ''}`}
                            onClick={handleFlip}
                        >
                            {/* FRONT FACE */}
                            <div className="fca-card-face front">
                                <span className="fca-topic-tag">
                                    {deck?.course_code || 'COURSE'} {currentCard?.chapter_title ? `• ${currentCard.chapter_title}` : ''}
                                </span>

                                <div 
                                    className="fca-prompt-text"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(currentCard.front) }}
                                />

                                <div className="fca-tap-hint">
                                    <i className="fas fa-rotate"></i> Tap card to reveal answer
                                </div>
                            </div>

                            {/* BACK FACE */}
                            <div className="fca-card-face back">
                                <span className="fca-back-label">Explanation & Answer</span>

                                <div 
                                    className="fca-answer-text" 
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(currentCard.back) }} 
                                />

                                <div className="fca-source-ref">
                                    <i className="fas fa-bookmark"></i>
                                    <span>{currentCard.ref || currentCard.reference_info || `${deck?.title || 'Course Textbook'}`}</span>
                                </div>
                            </div>
                        </div>
                    </main>

                    <footer className="fca-footer">
                        {!isFlipped ? (
                            <button className="fca-btn-flip" onClick={handleFlip}>
                                <i className="fas fa-eye"></i> Show Answer
                            </button>
                        ) : (
                            <div className="fca-srs-group">
                                <button className="fca-btn-srs hard" onClick={() => handleRate('hard')}>
                                    🔴 Hard
                                </button>
                                <button className="fca-btn-srs good" onClick={() => handleRate('good')}>
                                    🟡 Good
                                </button>
                                <button className="fca-btn-srs easy" onClick={() => handleRate('easy')}>
                                    🟢 Easy
                                </button>
                            </div>
                        )}
                    </footer>
                </>
            ) : (
                <main className="fca-summary">
                    <div className="fca-trophy-orb">
                        <i className="fas fa-trophy"></i>
                    </div>
                    <h2>Session Complete!</h2>
                    <p>You have practiced this deck. Your spaced repetition schedule has been updated.</p>

                    <div className="fca-stats-pill">
                        <div className="fca-stat-col">
                            <span className="num">{cards.length}</span>
                            <span className="lbl">Reviewed</span>
                        </div>
                        <div className="fca-stat-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                            <span className="num" style={{ color: 'var(--accent-teal, #42d7b8)' }}>{stats.easy}</span>
                            <span className="lbl">Easy</span>
                        </div>
                        <div className="fca-stat-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                            <span className="num" style={{ color: '#f1c40f' }}>{stats.good}</span>
                            <span className="lbl">Good</span>
                        </div>
                        <div className="fca-stat-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                            <span className="num" style={{ color: '#ff5f5f' }}>{stats.hard}</span>
                            <span className="lbl">Hard</span>
                        </div>
                    </div>

                    <button className="fca-btn-finish" onClick={onClose}>
                        Done
                    </button>
                </main>
            )}
        </div>
    );
};

export default FlashcardArena;