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

const InlineChatCard = ({ card, onRate }) => {
    const [isFlipped, setIsFlipped] = useState(false);
    const [ratedDifficulty, setRatedDifficulty] = useState(null);

    const handleFlip = (e) => {
        e.stopPropagation();
        setIsFlipped(prev => !prev);
        if (navigator.vibrate) navigator.vibrate(18);
    };

    const handleRating = (e, difficulty) => {
        e.stopPropagation();
        if (ratedDifficulty) return;
        setRatedDifficulty(difficulty);
        if (navigator.vibrate) navigator.vibrate([15, 30]);
        if (onRate) {
            onRate(difficulty, card);
        }
    };

    return (
        <div className="miron-inline-card-wrapper" onTouchStart={e => e.stopPropagation()}>
            <div 
                className={`mic-card ${isFlipped ? 'is-flipped' : ''}`}
                onClick={handleFlip}
            >
                {/* FRONT FACE */}
                <div className="mic-face front">
                    <div className="mic-top-tag">
                        <span>{card.course_code || 'AI MEMORY'} • {card.topic || 'SYNTHESIS'}</span>
                        <i className="fas fa-sparkles"></i>
                    </div>

                    <div 
                        className="mic-content-text"
                        dangerouslySetInnerHTML={{ __html: renderFormattedText(card.front) }}
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
                        dangerouslySetInnerHTML={{ __html: renderFormattedText(card.back) }}
                    />

                    <div className="mic-source-ref">
                        <i className="fas fa-bookmark"></i>
                        <span>{card.ref || 'Miron Dynamic Synthesis'}</span>
                    </div>

                    {!ratedDifficulty ? (
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
                    ) : (
                        <div className="mic-status-pill">
                            <i className="fas fa-check-circle"></i>
                            <span>
                                {ratedDifficulty === 'hard' && 'Queued for review tomorrow'}
                                {ratedDifficulty === 'good' && 'Scheduled for review in 1–3 days'}
                                {ratedDifficulty === 'easy' && 'Mastered! Review scheduled in 4 days'}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InlineChatCard;