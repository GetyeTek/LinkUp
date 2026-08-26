import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from './api.js';
import BookReader from './BookReader/BookReader.jsx';
import BookShelf from './components/BookShelf.jsx';
import BookCard from './components/BookCard.jsx';
import ExamPavilion from './ExamPavilion.jsx';
import ExamSession from './ExamSession.jsx';
import PlanMyDayModal from './components/PlanMyDayModal.jsx';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './Study.css';

const Study = () => {
    const { shell, user: userProfile, unreadCount } = usePlatform();
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
    const [pacingData, setPacingData] = useState(null);
    const [targetPage, setTargetPage] = useState(undefined);
    const [showAllPacing, setShowAllPacing] = useState(false);
    const [isPlannerOpen, setIsPlannerOpen] = useState(false);
    const searchInputRef = useRef(null);
    const wavePathRef = useRef(null);

    // 1. Fetch Main Books, Universities, & Academic Pacing
    useEffect(() => {
        // Fetch Main Books
        invokeBookReader({ action: 'list_books' })
            .then(data => {
                if (data.books) {
                    const examBook = { 
                        id: "exam-trigger-001",
                        title: "Exams", 
                        isExamTrigger: true, 
                        cover_url: null 
                    };
                    setBooks([examBook, ...data.books]);
                }
            })
            .catch(err => console.error(err));

        // Fetch Universities
        invokeBookReader({ action: 'list_universities' })
            .then(data => { 
                if (data.universities) setUniversities(data.universities); 
            })
            .catch(err => console.error(err));

        // Fetch Real-time Academic Pacing
        supabase.rpc('get_student_academic_pacing').then(({ data, error }) => {
            if (data && data.courses) {
                setPacingData(data);
            }
        }).catch(err => console.error("Academic pacing error:", err));
    }, []);

    // 2. Search Focus Hook
    useEffect(() => {
        if (isSearchActive && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchActive]);

    // 3. Wave Animation Logic for Observatory Widget
    useEffect(() => {
        const wavePath = wavePathRef.current;
        if (!wavePath) return;

        let animationFrameId;
        const size = 140;
        const rootStyle = getComputedStyle(document.documentElement);
        const cssProgress = rootStyle.getPropertyValue('--progress-percentage').trim() || '76%';
        const progressValue = parseFloat(cssProgress) / 100;
        
        const surfaceLevel = size * (1 - progressValue);
        let time = 0;
        const waves = [{ freq: 10, amp: 1.5, speed: 0.05 }, { freq: 6, amp: 0.8, speed: -0.03 }];

        const updateWave = () => {
            let pathData = [`M 0 ${size}`];
            for (let i = 0; i <= size; i += 5) {
                let y = 0;
                waves.forEach(wave => { y += wave.amp * Math.sin(i / wave.freq + time * wave.speed); });
                pathData.push(`L ${i} ${surfaceLevel + y}`);
            }
            pathData.push(`L ${size} ${size}`, 'Z');
            if (wavePath) wavePath.setAttribute('d', pathData.join(' '));
            time++;
            animationFrameId = requestAnimationFrame(updateWave);
        };

        updateWave();
        return () => cancelAnimationFrame(animationFrameId);
    }, []);

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
                    <h2 className="large-title">Study Hub</h2>
                    <div className="header-actions">
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
                        <div className="expand-prompt"><span className="material-symbols-outlined">open_in_full</span> Tap to expand</div>
                        <div className="vignette-bg pt-4">
                            <div style={{ height: '220px', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                <BookShelf 
                                    items={books.slice(0, 3)} 
                                    previewMode={true} 
                                    onBookClick={setActiveBook} 
                                    onExamTrigger={() => { setIsLibraryOpen(true); setShelfLevel('universities'); }} 
                                />
                            </div>
                        </div>
                    </div>

                    <div className="study-section">
                        {/* AI Planner Trigger */}
                        <div className="compact-trigger" onClick={() => setIsPlannerOpen(true)}>
                            <div className="compact-orb"><span className="material-symbols-outlined">auto_awesome</span></div>
                            <div className="compact-text-content">
                                <h3 className="compact-title">Plan My Day</h3>
                                <div className="compact-subtitle">
                                    <div className="typewriter-wrapper">
                                        <span className="typewriter-text">Let Miron structure your session...</span>
                                        <span className="blinking-cursor"></span>
                                    </div>
                                </div>
                            </div>
                            <i className="fas fa-chevron-right action-chevron"></i>
                        </div>

                        {/* Calibrated Guidance Path */}
                        <div className="guidance-path">
                            <h3 className="guidance-title">Miron&apos;s Next Steps</h3>
                            <div className="timeline">
                                {(!pacingData || !pacingData.courses || pacingData.courses.length === 0) ? (
                                    <div className="timeline-item is-priority">
                                        <div className="timeline-marker"><i className="fas fa-brain fa-xs"></i></div>
                                        <div className="timeline-content">
                                            <div className="item-text">
                                                <h4 className="item-title">Calibrating Curriculum...</h4>
                                                <p className="item-reason">Scanning academic calendar and course books.</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    (showAllPacing ? pacingData.courses : pacingData.courses.slice(0, 3)).map((course, idx) => {
                                        const isBehind = course.status === 'behind' || (course.status === 'not_started' && course.expected_chapter_index > 2);
                                        const isAhead = course.status === 'ahead';
                                        
                                        const handleStart = () => {
                                            if (isAhead) {
                                                setIsLibraryOpen(true);
                                                setShelfLevel('universities');
                                            } else {
                                                const destPage = course.user_current_page > 1 ? course.user_current_page : course.expected_chapter_page;
                                                setTargetPage(destPage);
                                                setActiveBook({
                                                    id: course.book_id,
                                                    title: course.book_title,
                                                    course_code: course.course_code
                                                });
                                            }
                                        };

                                        return (
                                            <div key={course.book_id || idx} className={`timeline-item ${course.is_priority ? 'is-priority' : ''}`}>
                                                <div className="timeline-marker">
                                                    <i className={`fas ${isBehind ? 'fa-bolt' : isAhead ? 'fa-award' : 'fa-book-open'} fa-xs`}></i>
                                                </div>
                                                <div className="timeline-content">
                                                    <div className="item-text">
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                                            <h4 className="item-title">{course.book_title}</h4>
                                                            {isBehind && <span style={{ fontSize: '0.62rem', background: 'rgba(255, 95, 95, 0.15)', color: '#ff5f5f', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>CATCH UP</span>}
                                                            {isAhead && <span style={{ fontSize: '0.62rem', background: 'rgba(255, 215, 0, 0.15)', color: 'var(--linkoin-gold)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>AHEAD</span>}
                                                        </div>
                                                        <p className="item-reason">{course.recommendation_msg}</p>
                                                    </div>
                                                    <button className="item-action-btn" onClick={handleStart}>
                                                        {isAhead ? 'Practice' : 'Start'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                            {pacingData?.courses?.length > 3 && (
                                <div className="expand-footer">
                                    <button className="show-all-btn" onClick={() => setShowAllPacing(!showAllPacing)}>
                                        <i className={`fas fa-chevron-${showAllPacing ? 'up' : 'down'} fa-xs`}></i> 
                                        {showAllPacing ? 'Show Less' : `Show All (${pacingData.courses.length}) Courses`}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Observatory Widget */}
                        <div className="observatory-widget" id="observatoryWidget">
                            <div className="portal-cutout">
                                <span className="portal-percentage">76%</span>
                                <div className="well-aperture">
                                    <div className="particles-container"></div>
                                    <div className="progress-fill">
                                        <svg className="wave-svg"><path className="wave-path" ref={wavePathRef}></path></svg>
                                    </div>
                                </div>
                            </div>
                            <div className="widget-info">
                                <h3 className="widget-title">Global Challenge</h3>
                                <p className="widget-subtitle">Collective Progress</p>
                                <div className="widget-progress-bar"><div className="widget-progress-fill"></div></div>
                            </div>
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
                                        <h2>{shelfLevel === 'main' ? 'My Library' : 'Select University'}</h2>
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
                                <div className={`chip ${activeCategory === 'All' ? 'active' : ''}`} onClick={() => setActiveCategory('All')}>All Books</div>
                                <div className={`chip ${activeCategory === 'Textbooks' ? 'active' : ''}`} onClick={() => setActiveCategory('Textbooks')}>Textbooks</div>
                                <div className={`chip ${activeCategory === 'Exams' ? 'active' : ''}`} onClick={() => {
                                    setActiveCategory('Exams');
                                    setShelfLevel('universities');
                                }}>Exams</div>
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
        </div>
    );
};

export default Study;