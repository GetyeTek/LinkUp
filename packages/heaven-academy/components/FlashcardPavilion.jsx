import React, { useState, useEffect } from 'react';
import { supabase, getCachedBookCover, usePlatform } from '@linkup-platform/sdk-core';
import FlashcardArena from './FlashcardArena.jsx';
import './FlashcardPavilion.css';

const FlashcardPavilion = ({ onClose }) => {
    const { theme, t } = usePlatform();
    const isLight = theme === 'light';
    const [stats, setStats] = useState({ mistakes_due: 0, course_decks: [] });
    const [activeSession, setActiveSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [openingDeckId, setOpeningDeckId] = useState(null);
    const [notice, setNotice] = useState(null); // { title: string, msg: string }

    const fetchDeckStats = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase.rpc('get_flashcard_deck_stats');
            if (!error && data && !data.error) {
                setStats({
                    mistakes_due: data.mistakes_due || 0,
                    course_decks: data.course_decks || []
                });
            }
        } catch (e) {
            console.warn('[Flashcards] Stats fetch warning:', e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDeckStats();
    }, []);

    const handleStartMistakes = async () => {
        if (openingDeckId) return;
        setOpeningDeckId('vault');
        try {
            const { data, error } = await supabase
                .from('user_mistake_flashcards')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            if (!data || data.length === 0) {
                setNotice({
                    title: "Mistake Vault Empty",
                    msg: "You haven't missed any questions yet! When you complete practice exams and textbook checkpoints, questions you miss will be transformed into recall flashcards here."
                });
                return;
            }

            // Hand off to FlashcardArena to synthesize the mistake queue via the unified SRS engine
            setActiveSession({
                deck: { course_code: 'VAULT', title: 'Mistake Vault' }
            });
        } catch (err) {
            setNotice({
                title: "Unable to Load Cards",
                msg: err.message || "Failed to load your mistake cards. Please check your connection."
            });
        } finally {
            setOpeningDeckId(null);
        }
    };

    const handleStartCourse = async (courseCode, title) => {
        if (openingDeckId) return;
        setOpeningDeckId(courseCode);
        try {
            // Fast count check: verify if flashcards exist for this course without fetching all rows upfront
            const { count, error } = await supabase
                .from('course_flashcards')
                .select('id', { count: 'exact', head: true })
                .eq('course_code', courseCode);

            if (error) throw error;

            if (!count || count === 0) {
                setNotice({
                    title: "Deck Not Generated Yet",
                    msg: `No flashcards have been published for ${title || courseCode} yet. Curriculum decks are being processed.`
                });
                return;
            }

            // Hand off to FlashcardArena to lazy-load on a per-chapter basis
            setActiveSession({
                deck: { course_code: courseCode, title }
            });
        } catch (err) {
            setNotice({
                title: "Unable to Load Deck",
                msg: err.message || "Failed to load course flashcards. Please check your connection."
            });
        } finally {
            setOpeningDeckId(null);
        }
    };

    return (
        <div className="fcp-overlay" onTouchStart={(e) => e.stopPropagation()}>
            <header className="fcp-header">
                <button className="fcp-back-btn" onClick={onClose}>
                    <i className="fas fa-chevron-left"></i>
                </button>
                <h2>{t('flashcards_title', 'Flashcard Decks')}</h2>
            </header>

            <main className="fcp-scroll-body">
                <span className="fcp-section-tag">⚡ {t('flashcards_recovery', 'Personalized Recovery')}</span>

                {/* Mistake Vault Card */}
                <div className={`fcp-mistake-card ${openingDeckId === 'vault' ? 'is-opening' : ''}`} onClick={handleStartMistakes}>
                    <div className="fcp-mv-icon">
                        {openingDeckId === 'vault' ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-bullseye"></i>}
                    </div>
                    <div className="fcp-mv-info">
                        <h3>{t('flashcards_mistake_vault', 'Mistake Vault')}</h3>
                        <p>{t('flashcards_mistake_desc', 'Questions you missed on recent exam drills and book checkpoints')}</p>
                    </div>
                    <div className="fcp-badge-red">
                        {stats.mistakes_due > 0 ? t('flashcards_due_badge', '{count} Due').replace('{count}', String(stats.mistakes_due)) : t('flashcards_review_badge', 'Review')}
                    </div>
                </div>

                <span className="fcp-section-tag" style={{ marginTop: '12px' }}>📚 {t('flashcards_course_decks', 'Course Decks')}</span>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--accent-teal)' }}>
                        <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                    </div>
                ) : stats.course_decks.length === 0 ? (
                    <div className="fcp-empty-decks">
                        <i className="fas fa-layer-group"></i>
                        <p>No course flashcard decks available yet.<br />Decks will appear here as textbook sections are processed.</p>
                    </div>
                ) : (
                    stats.course_decks.map((d) => {
                        const deckCover = getCachedBookCover(d.course_code) || getCachedBookCover(d.title);
                        return (
                            <div 
                                key={d.course_code} 
                                className={`fcp-deck-card ${openingDeckId === d.course_code ? 'is-opening' : ''}`} 
                                onClick={() => handleStartCourse(d.course_code, d.title)}
                                style={deckCover ? {
                                    backgroundImage: `${isLight 
                                        ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(240, 242, 245, 0.94) 100%)' 
                                        : 'linear-gradient(135deg, rgba(14, 14, 18, 0.70) 0%, rgba(10, 10, 14, 0.84) 100%)'}, url("${deckCover}")`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center'
                                } : {}}
                            >
                                <div className="fcp-cdc-icon">
                                    {openingDeckId === d.course_code ? (
                                        <i className="fas fa-circle-notch fa-spin"></i>
                                    ) : (
                                        <i className="fas fa-bolt"></i>
                                    )}
                                </div>
                                <div className="fcp-cdc-info">
                                    <div className="fcp-cdc-code">{d.course_code}</div>
                                    <div className="fcp-cdc-title">{d.title}</div>
                                    <div className="fcp-cdc-desc">{d.total_cards} {t('flashcards_reviewed_count', 'Cards')}</div>
                                </div>
                                <div className="fcp-badge-teal">
                                    {t('flashcards_due_badge', '{count} Due').replace('{count}', String(d.due_cards || 0))}
                                </div>
                            </div>
                        );
                    })
                )}
            </main>

            {/* Friendly Empty / Informational Modal */}
            {notice && (
                <div className="fcp-notice-overlay" onClick={() => setNotice(null)}>
                    <div className="fcp-notice-card" onClick={e => e.stopPropagation()}>
                        <div className="fcp-notice-icon">
                            <i className="fas fa-info"></i>
                        </div>
                        <h3>{notice.title}</h3>
                        <p>{notice.msg}</p>
                        <button className="fcp-notice-btn" onClick={() => setNotice(null)}>
                            Okay
                        </button>
                    </div>
                </div>
            )}

            {activeSession && (
                <FlashcardArena 
                    deck={activeSession.deck} 
                    initialCards={activeSession.cards} 
                    onClose={() => {
                        setActiveSession(null);
                        fetchDeckStats();
                    }} 
                />
            )}
        </div>
    );
};

export default FlashcardPavilion;