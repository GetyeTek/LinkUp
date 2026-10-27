import React, { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './FlashcardArena.css';

const formatChapterPillLabel = (title, index) => {
    if (!title) return `Ch ${index + 1}`;
    const wordToNum = {
        one: '1', two: '2', three: '3', four: '4', five: '5',
        six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
        eleven: '11', twelve: '12', i: '1', ii: '2', iii: '3',
        iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10'
    };
    const match = title.match(/^(chapter|unit)[-\s:]+([0-9]+|[a-z]+)\b/i);
    if (match) {
        const prefix = match[1].toLowerCase().startsWith('u') ? 'Unit' : 'Ch';
        const rawNum = match[2].toLowerCase();
        const num = wordToNum[rawNum] || rawNum.toUpperCase();
        return `${prefix} ${num}`;
    }
    return title.length > 16 ? title.substring(0, 14) + '...' : title;
};

const sanitizeCard = (c) => ({
    ...c,
    frontHtml: c.frontHtml || DOMPurify.sanitize(c.front || ''),
    backHtml: c.backHtml || DOMPurify.sanitize(c.back || '')
});

const FlashcardArena = ({ deck, initialCards = [], onClose }) => {
    const { user: userProfile, t } = usePlatform();
    const isProUser = Boolean(userProfile?.is_pro);
    const isVault = deck?.course_code === 'VAULT';
    const [chapters, setChapters] = useState([]);
    const [selectedChapter, setSelectedChapter] = useState(null);
    const [cards, setCards] = useState(() => (initialCards || []).map(sanitizeCard));
    const [loadingCards, setLoadingCards] = useState(false);
    const [loadingChapters, setLoadingChapters] = useState(!isVault);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [stats, setStats] = useState({ hard: 0, good: 0, easy: 0 });
    const [isCompleted, setIsCompleted] = useState(false);

    // In-memory session cache & atomic review batch buffer
    const cardCacheRef = useRef({});
    const batchQueueRef = useRef([]);

    // Atomically flush queued reviews to Supabase
    const flushBatchQueue = useCallback(async () => {
        if (batchQueueRef.current.length === 0) return;
        const payloadToFlush = [...batchQueueRef.current];
        batchQueueRef.current = [];

        try {
            await supabase.rpc('record_flashcard_reviews_batch', {
                p_reviews: payloadToFlush
            });
        } catch (err) {
            console.warn('[FlashcardSRS] Batch review flush warning:', err?.message || err);
            // Re-enqueue uncommitted logs on network error
            batchQueueRef.current.push(...payloadToFlush);
        }
    }, []);

    // Flush automatically on unmount, page exit, or app backgrounding
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                flushBatchQueue();
            }
        };
        window.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('beforeunload', flushBatchQueue);

        return () => {
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('beforeunload', flushBatchQueue);
            flushBatchQueue();
        };
    }, [flushBatchQueue]);

    // Synthesize cards via backend SRS queue
    const loadChapterCards = useCallback(async (chapterTitle) => {
        const cacheKey = isVault ? 'vault_all' : chapterTitle;
        if (!cacheKey) return;

        // Flush any pending review logs from prior chapter before switching
        await flushBatchQueue();

        if (cardCacheRef.current[cacheKey]) {
            setCards(cardCacheRef.current[cacheKey]);
            setCurrentIndex(0);
            setIsFlipped(false);
            setIsCompleted(false);
            return;
        }

        setLoadingCards(true);
        try {
            const { data, error } = await supabase.rpc('get_srs_session_queue', {
                p_course_code: isVault ? 'VAULT' : deck.course_code,
                p_chapter_title: isVault ? null : chapterTitle,
                p_limit: isVault ? 50 : 35,
                p_is_vault: isVault
            });

            if (error) throw error;

            const mapped = (data || []).map(c => sanitizeCard({
                id: c.id,
                front: c.front,
                back: c.back,
                ref: c.ref || (c.is_mistake ? 'Exam Review' : deck.title),
                chapter_title: c.chapter_title || (isVault ? 'Mistake Vault' : deck.course_code),
                is_mistake: !!c.is_mistake,
                due_status: c.due_status
            }));

            cardCacheRef.current[cacheKey] = mapped;
            setCards(mapped);
            setCurrentIndex(0);
            setIsFlipped(false);
            setIsCompleted(false);
        } catch (err) {
            console.error('[FlashcardArena] Queue synthesis error:', err);
        } finally {
            setLoadingCards(false);
        }
    }, [deck?.course_code, deck?.title, isVault, flushBatchQueue]);

    // Initial Chapter Discovery & Persistence Retrieval
    useEffect(() => {
        if (isVault) {
            setLoadingChapters(false);
            loadChapterCards(null);
            return;
        }

        const resolveChapters = async () => {
            setLoadingChapters(true);
            try {
                let availableChapters = [];
                const { data: chaptersData, error } = await supabase.rpc('get_course_flashcard_chapters', { 
                    p_course_code: deck.course_code 
                });

                if (!error && chaptersData && chaptersData.length > 0) {
                    availableChapters = chaptersData.map((ch, idx) => ({
                        title: ch.title,
                        label: formatChapterPillLabel(ch.title, idx),
                        is_pro_gated: ch.is_pro_gated
                    }));
                }

                setChapters(availableChapters);

                const savedChapter = localStorage.getItem(`linkup_fc_ch_${deck.course_code}`);
                const candidate = availableChapters.find(c => c.title === savedChapter);
                const isCandidateAllowed = candidate && (!candidate.is_pro_gated || isProUser);
                const initialChapter = isCandidateAllowed 
                    ? candidate.title 
                    : (availableChapters[0]?.title || null);

                if (initialChapter) {
                    setSelectedChapter(initialChapter);
                    loadChapterCards(initialChapter);
                }
            } catch (err) {
                console.error('[FlashcardArena] Chapter header resolution error:', err);
            } finally {
                setLoadingChapters(false);
            }
        };

        resolveChapters();
    }, [deck?.course_code, isVault, loadChapterCards]);

    const handleSelectChapter = (chapter) => {
        const chapterTitle = typeof chapter === 'string' ? chapter : chapter.title;
        const chObj = typeof chapter === 'string' ? chapters.find(c => c.title === chapter) : chapter;

        if (chObj?.is_pro_gated && !isProUser) {
            window.dispatchEvent(new CustomEvent('open-premium-modal'));
            return;
        }

        if (chapterTitle === selectedChapter) return;
        setSelectedChapter(chapterTitle);
        localStorage.setItem(`linkup_fc_ch_${deck.course_code}`, chapterTitle);
        loadChapterCards(chapterTitle);
        if (navigator.vibrate) navigator.vibrate(15);
    };

    const currentCard = cards[currentIndex];
    const progressPct = cards.length > 0 ? ((currentIndex + 1) / cards.length) * 100 : 0;

    const handleFlip = () => {
        if (!currentCard || loadingCards) return;
        setIsFlipped(prev => !prev);
        try { navigator.vibrate?.(12); } catch (e) {}
    };

    const handleRate = (difficulty) => {
        if (!currentCard || loadingCards) return;
        setStats(prev => ({ ...prev, [difficulty]: prev[difficulty] + 1 }));
        try { navigator.vibrate?.(12); } catch (e) {}

        // 1. Buffer review in batch queue (0ms main-thread cost)
        if (currentCard?.id) {
            batchQueueRef.current.push({
                card_id: currentCard.id,
                card_type: currentCard.is_mistake ? 'mistake' : 'course',
                difficulty,
                reviewed_at: new Date().toISOString()
            });

            if (batchQueueRef.current.length >= 8) {
                flushBatchQueue();
            }
        }

        // 2. Intra-Session Retry Loop: If Hard (Lapse), re-queue card 3 slots ahead
        if (difficulty === 'hard') {
            setCards(prev => {
                const nextCards = [...prev];
                const insertIndex = Math.min(currentIndex + 4, nextCards.length);
                nextCards.splice(insertIndex, 0, currentCard);
                return nextCards;
            });
        }

        // 3. Instant unflip and advance (fresh card instance mounts face-up without backward spin)
        setIsFlipped(false);
        if (currentIndex + 1 < cards.length || difficulty === 'hard') {
            setCurrentIndex(prev => prev + 1);
        } else {
            setIsCompleted(true);
            flushBatchQueue();
        }
    };

    const activePillObject = chapters.find(c => c.title === selectedChapter);

    return (
        <div className="fca-overlay" onTouchStart={(e) => e.stopPropagation()}>
            {!isCompleted ? (
                <>
                    <header className="fca-topbar">
                        <button className="fca-btn-close" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                        <span className="fca-counter">
                            {loadingCards ? t('common_loading', 'Loading...') : t('flashcards_card_counter', 'Card {current} / {total}').replace('{current}', String(cards.length > 0 ? currentIndex + 1 : 0)).replace('{total}', String(cards.length))}
                        </span>
                        <div style={{ width: '36px' }}></div>
                    </header>

                    <div className="fca-progress-track">
                        <div className="fca-progress-fill" style={{ width: `${progressPct}%` }}></div>
                    </div>

                    {/* Horizontal Chapter Selector Pill Strip */}
                    {/* Horizontal Chapter Selector Pill Strip */}
                    {!isVault && chapters.length > 0 && (
                        <nav className="fca-chapter-strip">
                            {chapters.map((ch) => {
                                const isLocked = ch.is_pro_gated && !isProUser;
                                return (
                                    <button 
                                        key={ch.title}
                                        className={`fca-chapter-pill ${selectedChapter === ch.title ? 'active' : ''} ${isLocked ? 'is-locked-pill' : ''}`}
                                        onClick={() => handleSelectChapter(ch)}
                                        title={ch.title}
                                    >
                                        {isLocked ? (
                                            <i className="fas fa-crown" style={{ fontSize: '0.65rem', color: '#f1c40f' }}></i>
                                        ) : selectedChapter === ch.title && loadingCards ? (
                                            <i className="fas fa-circle-notch fa-spin"></i>
                                        ) : (
                                            <i className="fas fa-bookmark" style={{ fontSize: '0.65rem' }}></i>
                                        )}
                                        <span>{ch.label}</span>
                                        {isLocked && <span className="fca-pro-tag">PRO</span>}
                                    </button>
                                );
                            })}
                        </nav>
                    )}

                    <main className="fca-stage">
                        {loadingCards || loadingChapters ? (
                            <div className="fca-loading-wrap">
                                <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                                <p>Loading cards for {activePillObject?.label || 'chapter'}...</p>
                            </div>
                        ) : (!cards || cards.length === 0) ? (
                            <div className="fca-no-cards">
                                <i className="fas fa-box-open fa-2x"></i>
                                <h3>No Cards in Chapter</h3>
                                <p>No flashcards were found for this section yet.</p>
                            </div>
                        ) : (
                                                    <div 
                            key={currentCard?.id ? `${currentCard.id}_${currentIndex}` : `card_${currentIndex}`}
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
                                        dangerouslySetInnerHTML={{ __html: currentCard.frontHtml || currentCard.front || '' }}
                                    />

                                    <div className="fca-tap-hint">
                                        <i className="fas fa-rotate"></i> {t('flashcards_tap_reveal', 'Tap card to reveal answer')}
                                    </div>
                                </div>

                                {/* BACK FACE */}
                                <div className="fca-card-face back">
                                    <span className="fca-back-label">{t('flashcards_explanation_label', 'Explanation & Answer')}</span>

                                    <div 
                                        className="fca-answer-text" 
                                        dangerouslySetInnerHTML={{ __html: currentCard.backHtml || currentCard.back || '' }} 
                                    />

                                    <div className="fca-source-ref">
                                        <i className="fas fa-bookmark"></i>
                                        <span>{currentCard.ref || currentCard.reference_info || `${deck?.title || 'Course Textbook'}`}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>

                    <footer className="fca-footer">
                        {cards.length === 0 || loadingCards ? null : !isFlipped ? (
                            <button className="fca-btn-flip" onClick={handleFlip}>
                                <i className="fas fa-eye"></i> {t('flashcards_show_answer', 'Show Answer')}
                            </button>
                        ) : (
                            <div className="fca-srs-group">
                                <button className="fca-btn-srs hard" onClick={() => handleRate('hard')}>
                                    🔴 {t('flashcards_hard', 'Hard')}
                                </button>
                                <button className="fca-btn-srs good" onClick={() => handleRate('good')}>
                                    🟡 {t('flashcards_good', 'Good')}
                                </button>
                                <button className="fca-btn-srs easy" onClick={() => handleRate('easy')}>
                                    🟢 {t('flashcards_easy', 'Easy')}
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
                    <h2>{t('flashcards_session_complete_title', 'Session Complete!')}</h2>
                    <p>{t('flashcards_session_complete_desc', 'You have practiced all cards in this deck. Your spaced repetition schedule has been updated.')}</p>

                    <div className="fca-stats-pill">
                        <div className="fca-stat-col">
                            <span className="num">{cards.length}</span>
                            <span className="lbl">{t('flashcards_reviewed_count', 'Reviewed')}</span>
                        </div>
                        <div className="fca-stat-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                            <span className="num" style={{ color: 'var(--accent-teal, #42d7b8)' }}>{stats.easy}</span>
                            <span className="lbl">{t('flashcards_easy', 'Easy')}</span>
                        </div>
                        <div className="fca-stat-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                            <span className="num" style={{ color: '#f1c40f' }}>{stats.good}</span>
                            <span className="lbl">{t('flashcards_good', 'Good')}</span>
                        </div>
                        <div className="fca-stat-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
                            <span className="num" style={{ color: '#ff5f5f' }}>{stats.hard}</span>
                            <span className="lbl">{t('flashcards_hard', 'Hard')}</span>
                        </div>
                    </div>

                    <button className="fca-btn-finish" onClick={() => {
                        setIsCompleted(false);
                        setCurrentIndex(0);
                        setStats({ hard: 0, good: 0, easy: 0 });
                    }} style={{ marginBottom: '10px', background: 'rgba(255, 255, 255, 0.1)', color: '#fff' }}>
                        {t('flashcards_review_again', 'Review Again')}
                    </button>

                    <button className="fca-btn-finish" onClick={onClose}>
                        {t('flashcards_return_to_decks', 'Return to Decks')}
                    </button>
                </main>
            )}
        </div>
    );
};

export default FlashcardArena;