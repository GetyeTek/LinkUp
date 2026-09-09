import React, { useState } from 'react';
import { marked } from 'https://esm.sh/marked';
import katex from 'https://esm.sh/katex@0.16.11';
import DOMPurify from 'dompurify';
import './InlineChatCard.css';

const renderFormattedText = (content) => {
    if (!content) return "";
    let str = String(content);
    const mathMap = new Map();
    let counter = 0;

    // Display math
    str = str.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (match, p1, p2) => {
        const math = p1 || p2;
        const key = `@@@CARD_MATH_DISP_${counter++}@@@`;
        try {
            const html = katex.renderToString(math.trim(), { displayMode: true, throwOnError: false, strict: false });
            mathMap.set(key, html);
            return key;
        } catch (e) {
            return match;
        }
    });

    // Inline math
    let processed = str.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)/g, (match, p1, p2) => {
        const math = p1 || p2;
        const key = `@@@CARD_MATH_INL_${counter++}@@@`;
        try {
            const html = katex.renderToString(math.trim(), { displayMode: false, throwOnError: false, strict: false });
            mathMap.set(key, html);
            return key;
        } catch (e) {
            return match;
        }
    });

    let html = marked.parse(processed);
    mathMap.forEach((katexHtml, key) => {
        html = html.split(key).join(katexHtml);
    });

    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, mathMl: true, svg: true }
    });
};

const InlineChatCard = ({ cards = [], card, onRate }) => {
    const rawList = cards && cards.length > 0 ? cards : (card ? [card] : []);
    const [queue, setQueue] = useState(rawList);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);
    const [stats, setStats] = useState({ hard: 0, good: 0, easy: 0 });

    React.useEffect(() => {
        if (rawList.length > 0) {
            setQueue(rawList);
            setCurrentIndex(0);
            setIsFlipped(false);
            setIsCompleted(false);
        }
    }, [rawList.length]);

    if (!queue || queue.length === 0) return null;

    const currentCard = queue[currentIndex];
    const progressPct = queue.length > 0 ? ((currentIndex + 1) / queue.length) * 100 : 0;

    const handleFlip = (e) => {
        e.stopPropagation();
        if (!currentCard || isTransitioning) return;
        setIsFlipped(prev => !prev);
        if (navigator.vibrate) navigator.vibrate(18);
    };

    const handleRating = (e, difficulty) => {
        e.stopPropagation();
        if (!currentCard || isTransitioning) return;

        setStats(prev => ({ ...prev, [difficulty]: prev[difficulty] + 1 }));
        if (navigator.vibrate) navigator.vibrate([15, 30]);

        if (onRate) {
            onRate(difficulty, currentCard);
        }

        // Intra-session retry loop: If Hard, re-queue card 3 slots ahead
        if (difficulty === 'hard') {
            setQueue(prev => {
                const nextQueue = [...prev];
                const insertIdx = Math.min(currentIndex + 4, nextQueue.length);
                nextQueue.splice(insertIdx, 0, currentCard);
                return nextQueue;
            });
        }

        // Advance to next card in-place horizontally
        if (currentIndex + 1 < queue.length || difficulty === 'hard') {
            setIsTransitioning(true);
            setIsFlipped(false);
            setCurrentIndex(prev => prev + 1);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setIsTransitioning(false);
                });
            });
        } else {
            setIsFlipped(false);
            setIsCompleted(true);
        }
    };

    if (isCompleted) {
        return (
            <div className="miron-inline-card-wrapper" onTouchStart={e => e.stopPropagation()}>
                <div className="mic-completed-box">
                    <div className="mic-completed-icon">
                        <i className="fas fa-check-circle"></i>
                    </div>
                    <h4>Review Completed!</h4>
                    <p>{rawList.length} cards scheduled in your Spaced Repetition deck.</p>
                    <div className="mic-stats-mini">
                        <span style={{ color: 'var(--accent-teal, #42d7b8)' }}>🟢 {stats.easy} Easy</span>
                        <span style={{ color: '#f1c40f' }}>🟡 {stats.good} Good</span>
                        <span style={{ color: '#ff5f5f' }}>🔴 {stats.hard} Hard</span>
                    </div>
                    <button className="mic-restart-btn" onClick={() => {
                        setCurrentIndex(0);
                        setIsCompleted(false);
                        setIsFlipped(false);
                        setQueue(rawList);
                    }}>
                        <i className="fas fa-rotate-right"></i> Review Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="miron-inline-card-wrapper" onTouchStart={e => e.stopPropagation()}>
            <div className="mic-deck-header">
                <span className="mic-counter">
                    Card {currentIndex + 1} of {queue.length}
                </span>
                <span className="mic-course-tag">
                    {currentCard?.course_code || 'MIRON'} {currentCard?.topic ? `• ${currentCard.topic}` : ''}
                </span>
            </div>

            <div className="mic-progress-track">
                <div className="mic-progress-fill" style={{ width: `${progressPct}%` }}></div>
            </div>

            <div 
                className={`mic-card ${isFlipped ? 'is-flipped' : ''} ${isTransitioning ? 'no-transition' : ''}`}
                onClick={handleFlip}
            >
                {/* FRONT FACE */}
                <div className="mic-face front">
                    <div className="mic-top-tag">
                        <span>Active Recall</span>
                        <i className="fas fa-sparkles"></i>
                    </div>

                    <div 
                        className="mic-content-text"
                        dangerouslySetInnerHTML={{ __html: renderFormattedText(currentCard?.front) }}
                    />

                    <div className="mic-tap-hint">
                        <i className="fas fa-rotate"></i> Tap card to reveal answer
                    </div>
                </div>

                {/* BACK FACE */}
                <div className="mic-face back">
                    <div className="mic-back-header">Explanation & Answer</div>

                    <div 
                        className="mic-answer-text"
                        dangerouslySetInnerHTML={{ __html: renderFormattedText(currentCard?.back) }}
                    />

                    <div className="mic-source-ref">
                        <i className="fas fa-bookmark"></i>
                        <span>{currentCard?.ref || 'Miron Dynamic Synthesis'}</span>
                    </div>

                    <div className="mic-rating-bar" onClick={e => e.stopPropagation()}>
                        <button className="mic-rate-btn hard" onClick={e => handleRating(e, 'hard')}>
                            🔴 Hard
                        </button>
                        <button className="mic-rate-btn good" onClick={e => handleRating(e, 'good')}>
                            🟡 Good
                        </button>
                        <button className="mic-rate-btn easy" onClick={e => handleRating(e, 'easy')}>
                            🟢 Easy
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InlineChatCard;