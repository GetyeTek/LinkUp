import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from './api.js';
import BookReader from './BookReader/BookReader.jsx';
import BookShelf from './components/BookShelf.jsx';
import BookCard from './components/BookCard.jsx';
import ExamPavilion from './ExamPavilion.jsx';
import ExamSession from './ExamSession.jsx';
import PlanMyDayModal from './components/PlanMyDayModal.jsx';
import FlashcardPavilion from './components/FlashcardPavilion.jsx';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './Study.css';

const Study = () => {
    const { shell, user: userProfile, unreadCount, routePayload, clearRoutePayload, t } = usePlatform();
    const [mistakeCount, setMistakeCount] = useState(0);
    const onOpenActivity = shell.openActivity;
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [activeExamFromBook, setActiveExamFromBook] = useState(null);
    const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
    const [activeBook, setActiveBook] = useState(null);
    const [books, setBooks] = useState([]);
    const [universities, setUniversities] = useState([]);
    const [shelfLevel, setShelfLevel] = useState('main'); // 'main' or 'universities'
    const [selectedUniversity, setSelectedUniversity] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [activeCategory, setActiveCategory] = useState('All');
    const [targetPage, setTargetPage] = useState(undefined);
    const [isPlannerOpen, setIsPlannerOpen] = useState(false);
    const [isFlashcardsOpen, setIsFlashcardsOpen] = useState(false);
    const [lastRead, setLastRead] = useState(null);
    const searchInputRef = useRef(null);
    const wavePathRef = useRef(null);

    useEffect(() => {
        try {
            const saved = localStorage.getItem('linkup_last_book');
            if (saved) {
                setLastRead(JSON.parse(saved));
            }
        } catch (e) {}
    }, []);

    const handleResumeReading = () => {
        if (!lastRead?.id) return;
        setTargetPage(lastRead.page || 1);
        setActiveBook({
            id: lastRead.id,
            title: lastRead.title,
            course_code: lastRead.course_code
        });
    };

    // 1. Fetch Main Books, Universities, & Academic Pacing
    useEffect(() => {
        // Fetch Main Books & Mount Interactive Deck Triggers
        invokeBookReader({ action: 'list_books' })
            .then(data => {
                if (data.books) {
                    const examBook = { 
                        id: "exam-trigger-001",
                        title: "Exams", 
                        isExamTrigger: true, 
                        cover_url: null 
                    };
                    const flashcardBook = {
                        id: "flashcard-trigger-001",
                        title: "Flashcards",
                        isFlashcardTrigger: true,
                        cover_url: null
                    };
                    setBooks([examBook, flashcardBook, ...data.books]);
                }
            })
            .catch(err => console.error(err));

        // Fetch Universities
        invokeBookReader({ action: 'list_universities' })
            .then(data => { 
                if (data.universities) setUniversities(data.universities); 
            })
            .catch(err => console.error(err));
    }, []);

    // 2. Search Focus Hook
    useEffect(() => {
        if (isSearchActive && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchActive]);

    // 3. Mistake Vault Stats & Resume Routing
    useEffect(() => {
        supabase.rpc('get_flashcard_deck_stats').then(({ data, error }) => {
            if (!error && data && data.mistakes_due !== undefined) {
                setMistakeCount(data.mistakes_due);
            }
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (routePayload?.action === 'resume_book' && routePayload.book_id) {
            setTargetPage(routePayload.page || 1);
            setActiveBook({
                id: routePayload.book_id,
                title: routePayload.title,
                course_code: routePayload.course_code
            });
            clearRoutePayload?.();
        }
    }, [routePayload, clearRoutePayload]);

    // 4. Local Module listener for opening ExamSession directly from inline Book checkpoints
    useEffect(() => {
        const handleOpenExam = (e) => setActiveExamFromBook(e.detail.exam);
        window.addEventListener('heaven-academy:open-exam', handleOpenExam);
        return () => window.removeEventListener('heaven-academy:open-exam', handleOpenExam);
    }, []);

    return (
        <div className="tab-content active" id="study-content">
            <div className="study-hub-view">
                <header className="study-header">
                    <h2 className="large-title">{t('study_hub', 'Study Hub')}</h2>
                    <div className="header-actions">
                        <button 
                            className="header-miron-btn" 
                            onClick={() => shell.openMiron()} 
                            title="Chat with Miron AI"
                        >
                            <img src="https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png" alt="Miron" className="header-miron-avatar" />
                            <span className="header-miron-pulse"></span>
                        </button>
                        <button className="icon-button notification-btn" onClick={onOpenActivity}>
                            <i className="fas fa-bell"></i>
                            {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                        </button>
                        <img 
                            src={userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`} 
                            alt="Profile" 
                            className="profile-avatar" 
                            style={{ width: '36px', height: '36px', cursor: 'pointer' }} 
                            onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'profile' } }))}
                        />
                    </div>
                </header>
                
                <div className="study-hub-content scrollable-content">
                    {/* Library Preview / Trigger */}
                    <div id="library-preview-wrapper" className="library-preview-wrapper" onClick={() => setIsLibraryOpen(true)}>
                        <div className="library-fade-overlay"></div>
                        <div className="expand-prompt"><span className="material-symbols-outlined">open_in_full</span> {t('tap_to_expand', 'Tap to expand')}</div>
                        <div className="vignette-bg pt-4">
                            <div style={{ height: '220px', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                <BookShelf 
                                    items={books.slice(0, 3)} 
                                    previewMode={true} 
                                    onBookClick={setActiveBook} 
                                    onExamTrigger={() => { setIsLibraryOpen(true); setShelfLevel('universities'); }} 
                                    onFlashcardTrigger={() => setIsFlashcardsOpen(true)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="study-section">
                        {/* Current Study Desk Anchor */}
                        {lastRead && (
                            <div className="resume-study-card" onClick={handleResumeReading}>
                                <div className="resume-book-icon">
                                    <i className="fas fa-book-open"></i>
                                </div>
                                <div className="resume-info">
                                    <div className="resume-tag">
                                        <span>{lastRead.course_code ? `${lastRead.course_code} • Page ${lastRead.page || 1}` : t('curriculum_textbook', 'Curriculum Textbook')}</span>
                                    </div>
                                    <h3 className="resume-title">{lastRead.title}</h3>
                                    <p className="resume-subtitle">
                                        {t('resume_study_desc', `Pick up right where you left off on Page ${lastRead.page || 1}`).replace('{page}', lastRead.page || 1)}
                                    </p>
                                </div>
                                <div className="resume-arrow-box">
                                    <i className="fas fa-arrow-right"></i>
                                </div>
                            </div>
                        )}

                        {/* AI Planner Trigger */}
                        <div className="compact-trigger" onClick={() => setIsPlannerOpen(true)}>
                            <div className="compact-orb"><span className="material-symbols-outlined">auto_awesome</span></div>
                            <div className="compact-text-content">
                                <h3 className="compact-title">{t('plan_my_day', 'Plan My Day')}</h3>
                                <div className="compact-subtitle">
                                    <div className="typewriter-wrapper">
                                        <span className="typewriter-text">Let Miron structure your session...</span>
                                        <span className="blinking-cursor"></span>
                                    </div>
                                </div>
                            </div>
                            <i className="fas fa-chevron-right action-chevron"></i>
                        </div>



                        {/* Mistake Vault Quick Recall Shortcut */}
                        <div className="study-drill-card" onClick={() => setIsFlashcardsOpen(true)}>
                            <div className="drill-icon-box">
                                <i className="fas fa-bullseye"></i>
                            </div>
                            <div className="drill-details">
                                <div className="drill-tag">
                                    <span>{t('recall_training', 'Recall Training')}</span>
                                    {mistakeCount > 0 && <span className="drill-badge">{mistakeCount} Due</span>}
                                </div>
                                <h4 className="drill-title">{t('mistake_vault', 'Mistake Vault Quick Drill')}</h4>
                                <p className="drill-subtitle">
                                    {mistakeCount > 0 
                                        ? `${mistakeCount} missed questions ready for review.` 
                                        : "Review concepts and questions you missed during practice."}
                                </p>
                            </div>
                            <button className="drill-action-btn">
                                <span>{t('practice', 'Practice')}</span>
                                <i className="fas fa-arrow-right"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- FULLSCREEN LIBRARY OVERLAY --- */}
            <div className={`library-fullscreen ${isLibraryOpen ? 'is-expanded' : ''}`}>
                <div style={{ position: 'relative', display: 'flex', height: '100%', flexDirection: 'column' }}>
                    <header className="fullscreen-header">
                        <div className="header-main-row">
                            <button className="icon-button" onClick={() => {
                                if (isSearchActive) {
                                    setIsSearchActive(false);
                                    setSearchQuery('');
                                } else if (shelfLevel === 'universities') {
                                    setShelfLevel('main');
                                } else {
                                    setIsLibraryOpen(false);
                                }
                            }}>
                                <span className="material-symbols-outlined">{isSearchActive ? 'close' : shelfLevel === 'universities' ? 'arrow_back_ios' : 'arrow_back'}</span>
                            </button>
                            
                            {isSearchActive ? (
                                <div className="library-search-dock">
                                    <input 
                                        ref={searchInputRef}
                                        type="text" 
                                        placeholder={shelfLevel === 'main' ? "Search books or code (e.g. PHYS 1011)..." : "Search universities..."}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                    {searchQuery && (
                                        <button className="clear-search-btn" onClick={() => setSearchQuery('')}>
                                            <i className="fas fa-times"></i>
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div 
                                        className={`header-title-wrapper ${isHeaderExpanded ? 'expanded' : ''}`} 
                                        onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                                    >
                                        <h2>{shelfLevel === 'main' ? t('my_library', 'My Library') : t('select_university', 'Select University')}</h2>
                                        <span className="material-symbols-outlined chevron-icon">expand_more</span>
                                    </div>
                                    <button className="icon-button" onClick={() => setIsSearchActive(true)}>
                                        <span className="material-symbols-outlined">search</span>
                                    </button>
                                </>
                            )}
                        </div>
                        
                        <div className={`filter-pills-container ${isHeaderExpanded && !isSearchActive ? 'expanded' : ''}`}>
                            <div className="filter-pills library-filters">
                                <div className={`chip ${activeCategory === 'All' ? 'active' : ''}`} onClick={() => setActiveCategory('All')}>{t('all_books', 'All Books')}</div>
                                <div className={`chip ${activeCategory === 'Textbooks' ? 'active' : ''}`} onClick={() => setActiveCategory('Textbooks')}>{t('textbooks', 'Textbooks')}</div>
                                <div className={`chip ${activeCategory === 'Exams' ? 'active' : ''}`} onClick={() => {
                                    setActiveCategory('Exams');
                                    setShelfLevel('universities');
                                }}>{t('exams', 'Exams')}</div>
                                <div className={`chip ${activeCategory === 'Flashcards' ? 'active' : ''}`} onClick={() => {
                                    setActiveCategory('Flashcards');
                                    setIsFlashcardsOpen(true);
                                }}>{t('flashcards', 'Flashcards')}</div>
                            </div>
                        </div>
                    </header>
                    <div className="flex-grow overflow-y-auto py-4 vignette-bg" style={{ flexGrow: 1, overflowY: 'auto', padding: '1rem', position: 'relative' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: 'auto', paddingBottom: '2rem' }}>
                                {(() => {
                                    let currentList = shelfLevel === 'main' ? books : universities;
                                    
                                    if (shelfLevel === 'main') {
                                        if (activeCategory === 'Textbooks') {
                                            currentList = currentList.filter(b => !b.isExamTrigger);
                                        }
                                    }

                                    if (searchQuery.trim()) {
                                        const query = searchQuery.toLowerCase().trim();
                                        currentList = currentList.filter(item => {
                                            const titleMatch = (item.title || item.name || '').toLowerCase().includes(query);
                                            const codeMatch = (item.course_code || '').toLowerCase().includes(query);
                                            return titleMatch || codeMatch;
                                        });
                                    }

                                    if (currentList.length === 0) {
                                        return (
                                            <div className="library-search-empty">
                                                <i className="fas fa-search"></i>
                                                <p>No materials found matching &ldquo;{searchQuery}&rdquo;.</p>
                                            </div>
                                        );
                                    }

                                    return (
                                        <BookShelf 
                                            items={currentList} 
                                            isUniversity={shelfLevel === 'universities'}
                                            onBookClick={setActiveBook}
                                            onUniversityClick={setSelectedUniversity}
                                            onExamTrigger={() => setShelfLevel('universities')}
                                            onFlashcardTrigger={() => setIsFlashcardsOpen(true)}
                                        />
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Overlays */}
            {activeBook && (
                <BookReader 
                    book={activeBook} 
                    onClose={() => { setActiveBook(null); setTargetPage(undefined); }} 
                    targetPageNumber={targetPage}
                />
            )}
            {selectedUniversity && <ExamPavilion university={selectedUniversity} onClose={() => setSelectedUniversity(null)} />}
            {activeExamFromBook && <ExamSession exam={activeExamFromBook} onClose={() => setActiveExamFromBook(null)} />}
            
            <PlanMyDayModal 
                isOpen={isPlannerOpen}
                onClose={() => setIsPlannerOpen(false)}
                onExecuteTask={(taskBlock) => {
                    if (taskBlock?.action?.type === 'open_book' || taskBlock?.task_type === 'read' || taskBlock?.task_type === 'catch_up') {
                        setTargetPage(taskBlock.action?.page_number || 1);
                        setActiveBook({
                            id: taskBlock.action?.book_id || taskBlock.book_id,
                            title: taskBlock.course_title,
                            course_code: taskBlock.course_code
                        });
                    } else if (taskBlock?.action?.type === 'open_exam' || taskBlock?.task_type === 'drill') {
                        setIsLibraryOpen(true);
                        setShelfLevel('universities');
                    }
                }}
            />

            {isFlashcardsOpen && (
                <FlashcardPavilion onClose={() => setIsFlashcardsOpen(false)} />
            )}
        </div>
    );
};

export default Study;