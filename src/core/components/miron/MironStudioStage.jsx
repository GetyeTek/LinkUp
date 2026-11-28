import React from 'react';
import { BookPageCanvas } from '@linkup-platform/sdk-core';
import { motion } from 'motion/react';

class MironMotionBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(err) {
        console.warn('[MironNoteFlight] Motion fallback engaged:', err?.message || err);
    }
    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? null;
        }
        return this.props.children;
    }
}
import { proxyUrl, formatTime, parseBulletItem } from './useMironLecture.js';
import MironQuizCard from './MironQuizCard.jsx';
import './MironQuizCard.css';
import MironStageCard from './MironStageCard.jsx';
import './MironStageCard.css';

const MironStudioStage = ({
    isLoadingLesson,
    audioLesson,
    selectedBook,
    selectedSection,
    activeChapterTitle = '',
    chapterSections = [],
    activeSectionIndex = 0,
    completedLessonIds = new Set(),
    isOutlineOpen = false,
    setIsOutlineOpen,
    isSidebarOpen = true,
    setIsSidebarOpen,
    desktopSidebarTab = 'outline',
    setDesktopSidebarTab,
    isDesktopViewport = true,
    onSelectSectionItem,
    onStepSection,
    onReturnToToc,
    viewMode,
    pinnedBlockIndex,
    sectionPages,
    renderBookBlock,
    mironAvatarUrl,
    stage,
    cinemaContainerRef,
    excerptCardRef,
    notesDeckRef,
    lectureEngine
}) => {
    const {
        progressBarRef,
        isPlaying,
        currentTime,
        duration,
        playbackRate,
        fitScale,
        isChromeVisible,
        setIsChromeVisible,
        resetInactivityTimer,
        activeDiagramAsset,
        activeImageAsset,
        activeNodeCue,
        activeBlockData,
        activeBullets,
        dwellingNote,
        dockedBullets = [],
        justLandedNoteKey,
        dockDwellingNote,
        activeQuizCue,
        activeQuizData,
        resumeFromQuiz,
        activeCardData,
        hasActiveNode,
        isDualStage,
        manifest,
        karaokeData,
        ccEnabled,
        setCcEnabled,
        isNotesCollapsed,
        setIsNotesCollapsed,
        quizMarkers,
        handleTogglePlay,
        handleSeek,
        handleSkip,
        handleCycleSpeed,
        handleJumpToSection
    } = lectureEngine;

    const railRef = React.useRef(null);
    const desktopNotesRef = React.useRef(null);
    const prevBulletCountRef = React.useRef(0);
    const userPinnedOutlineRef = React.useRef(false);
    const [isMobileNotesExpanded, setIsMobileNotesExpanded] = React.useState(false);
    const mobileExpandedListRef = React.useRef(null);

    React.useEffect(() => {
        if ((dockedBullets?.length || 0) === 0 && isMobileNotesExpanded) {
            setIsMobileNotesExpanded(false);
        }
        if (isMobileNotesExpanded && mobileExpandedListRef.current) {
            mobileExpandedListRef.current.scrollTo({
                top: mobileExpandedListRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [dockedBullets?.length, isMobileNotesExpanded]);

    // Auto-scroll Full Textbook Page smoothly to keep the active highlighted sentence centered
    React.useEffect(() => {
        if (!activeBlockData || viewMode !== 'cinema' || activeQuizData || activeCardData) return;
        const timer = setTimeout(() => {
            const stageEl = cinemaContainerRef?.current;
            if (!stageEl) return;
            const target = stageEl.querySelector('.ml-live-book-stage .miron-active-sentence')
                || stageEl.querySelector('.ml-live-book-stage .bpc-block-target.is-focused');
            if (target && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 80);
        return () => clearTimeout(timer);
    }, [activeBlockData?.page, activeBlockData?.blockIndex, lectureEngine.activeBlockCue?.time, viewMode, activeQuizData, activeCardData, cinemaContainerRef]);

    React.useEffect(() => {
        if (!railRef.current) return;
        const activeEl = railRef.current.querySelector('.ml-section-pill.active');
        if (activeEl) {
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [activeSectionIndex]);

    React.useEffect(() => {
        const count = activeBullets?.length || 0;
        if (count === 0) {
            userPinnedOutlineRef.current = false;
        } else if (prevBulletCountRef.current === 0 && count > 0 && !userPinnedOutlineRef.current) {
            setDesktopSidebarTab?.('notes');
        }
        prevBulletCountRef.current = count;
        if (desktopNotesRef.current && dockedBullets.length > 0) {
            desktopNotesRef.current.scrollTo({
                top: desktopNotesRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [activeBullets?.length, dockedBullets.length, setDesktopSidebarTab]);

    const effectiveSections = chapterSections.length > 0
        ? chapterSections
        : manifest.map((m, idx) => ({
            key: `sim::${idx}`,
            lessonId: audioLesson?.id,
            lessonIndex: 0,
            sectionTag: m.section_tag || `${idx + 1}`,
            title: m.title,
            startTimeInLesson: m.start_time || 0,
            endTimeInLesson: m.end_time || duration,
            duration: m.duration || duration,
            manifestRef: m
        }));

    const stageModeBadge = activeQuizData
        ? { icon: 'brain', label: 'Checkpoint' }
        : activeCardData
            ? { icon: 'compass', label: activeCardData.mode === 'summary' ? 'Recap' : 'Roadmap' }
            : isDualStage
                ? { icon: 'layer-group', label: 'Split View' }
                : activeBlockData
                    ? { icon: 'book-open', label: `Page ${activeBlockData.page}` }
                    : activeImageAsset
                        ? { icon: 'image', label: 'Specimen' }
                        : activeDiagramAsset
                            ? { icon: 'diagram-project', label: 'Diagram' }
                            : null;

    const scrubPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
    const showKaraoke = ccEnabled && viewMode === 'cinema' && !activeQuizData && !activeCardData && karaokeData?.sentenceSnippet?.length > 0;

    const activeAsset = activeDiagramAsset || activeImageAsset;
    const showQuiz = Boolean(activeQuizData);
    const showCard = !showQuiz && Boolean(activeCardData);
    const showExcerpt = !showQuiz && !showCard && Boolean(activeBlockData) && isDualStage;
    const showDiagram = !showQuiz && !showCard && Boolean(activeDiagramAsset) && (!activeImageAsset || hasActiveNode || !activeBlockData);
    const showImage = !showQuiz && !showCard && Boolean(activeImageAsset);
    const isTripleStage = showExcerpt && showDiagram && showImage;

    return (
        <div className="ml-studio-viewport">
            {isLoadingLesson ? (
                <div className="ml-studio-loading-screen">
                    <i className="fas fa-circle-notch fa-spin"></i>
                    <span>Loading synchronized lecture track...</span>
                </div>
            ) : !audioLesson ? (
                <div className="ml-studio-empty-card">
                    <div className="ml-empty-icon"><i className="fas fa-microphone-slash"></i></div>
                    <h2>Audio Lecture In Production</h2>
                    <p>This section is scheduled for audio synthesis. You can trigger batch processing or read the textbook directly.</p>
                    <button className="ml-btn-back-toc" onClick={onReturnToToc}>
                        <i className="fas fa-chevron-left"></i> Return to Syllabus
                    </button>
                </div>
            ) : (
                <div className={`ml-studio-content-layout ${viewMode} ${isSidebarOpen ? 'has-desktop-sidebar' : 'sidebar-collapsed'}`}>
                    <div className="ml-player-column">
                    {/* VIEW 1: CINEMA STAGE (Tap to Toggle Chrome) */}
                    {viewMode === 'cinema' && (
                        <div 
                            className="ml-cinema-stage" 
                            ref={cinemaContainerRef}
                            data-chrome-visible={isChromeVisible ? "true" : "false"}
                            data-is-playing={isPlaying ? "true" : "false"}
                            data-has-notes={(activeBullets?.length || 0) > 0 ? "true" : "false"}
                            data-has-image={Boolean(activeImageAsset) ? "true" : "false"}
                            data-note-dwelling={Boolean(dwellingNote && !activeQuizData && !activeCardData) ? "true" : "false"}
                            data-dual-stage={isDualStage ? "true" : "false"}
                            data-has-book={Boolean(activeBlockData && !isDualStage && !(activeDiagramAsset && activeImageAsset)) ? "true" : "false"}
                            onClick={(e) => {
                                if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
                                if (stage === 'studio') {
                                    setIsChromeVisible(prev => {
                                        const next = !prev;
                                        if (next && isPlaying) resetInactivityTimer();
                                        return next;
                                    });
                                }
                            }}
                        >
                            <div className={`ml-cinema-visual-frame ${isTripleStage ? 'is-triple-stage' : ''} ${isDualStage ? 'is-dual-stage' : ''} ${!isDualStage && activeImageAsset ? 'is-single-image' : ''}`}>
                                {/* INTERACTIVE CHECKPOINT QUIZ (Keyed per cue time so multi-quiz tracks mount fresh) */}
                                {activeQuizData && (
                                    <MironQuizCard
                                        key={activeQuizCue?.time ?? 'quiz'}
                                        quizData={activeQuizData}
                                        onComplete={() => resumeFromQuiz(activeQuizCue?.time)}
                                    />
                                )}

                                {/* PRESENTATION BOOKEND (Intro Roadmap & Summary Recap) */}
                                {!activeQuizData && activeCardData && (
                                    <MironStageCard cardData={activeCardData} isPlaying={isPlaying} />
                                )}

                                {/* FULL A4 PAGE: Initial full-size textbook view before breakdown cue */}
                                {!activeQuizData && !activeCardData && activeBlockData && !isDualStage && (
                                    <BookPageCanvas
                                        blocks={activeBlockData.blocks}
                                        pageNumber={activeBlockData.page}
                                        bookTitle={selectedBook?.title || 'Curriculum Book'}
                                        courseCode={selectedBook?.course_code || ''}
                                        prefix={selectedBook?.prefix || ''}
                                        focusedBlockIndex={activeBlockData.blockIndex}
                                        isSpotlightActive={true}
                                        renderBlock={renderBookBlock}
                                        className="ml-live-book-stage"
                                    />
                                )}

                                {/* TIGHT EXCERPT CARD: Locked 794px virtual canvas clone (Hard-capped at 2 panes max) */}
                                {activeBlockData && isDualStage && !(activeDiagramAsset && activeImageAsset) && !activeQuizData && !activeCardData && (
                                    <div className="ml-stage-excerpt-pane">
                                        <div 
                                            className="ml-tight-scale-wrapper"
                                            style={{
                                                width: '794px',
                                                zoom: fitScale
                                            }}
                                        >
                                            <div 
                                                ref={excerptCardRef}
                                                className={`bpc-page-canvas ml-tight-excerpt-card is-spotlight-active ${selectedBook?.prefix ? `engine-${selectedBook.prefix}` : ''}`}
                                            >
                                                <div className="bpc-block-target is-focused">
                                                    {renderBookBlock ? (
                                                        renderBookBlock(activeBlockData.blocks[activeBlockData.blockIndex], activeBlockData.blockIndex, {
                                                            bookTitle: selectedBook?.title,
                                                            courseCode: selectedBook?.course_code,
                                                            prefix: selectedBook?.prefix
                                                        })
                                                    ) : (
                                                        <div 
                                                            className="book-block type-paragraph"
                                                            dangerouslySetInnerHTML={{ __html: activeBlockData.blocks[activeBlockData.blockIndex]?.body || '' }} 
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* PERSISTENT DIAGRAM PANE (Glides to top HUD without remounting) */}
                                {activeDiagramAsset && (!activeImageAsset || hasActiveNode || !activeBlockData) && !activeQuizData && !activeCardData && (
                                    <div className={`ml-stage-diagram-pane ${isDualStage && activeImageAsset ? 'is-docked' : 'is-hero'}`}>
                                        {activeDiagramAsset.asset_type === 'diagram_svg' ? (
                                            <div 
                                                className="ml-visual-card-svg" 
                                                dangerouslySetInnerHTML={{ __html: activeDiagramAsset.content_payload }} 
                                            />
                                        ) : (
                                            <div className="ml-visual-card-image">
                                                <img
                                                    src={proxyUrl(activeDiagramAsset.image_url)}
                                                    alt={activeDiagramAsset.title || 'Illustration'}
                                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                />
                                                <div className="ml-image-caption-pill">
                                                    <span>{activeDiagramAsset.title || 'Scene Concept'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* PERSISTENT SPECIMEN IMAGE PANE (Slides in smoothly underneath) */}
                                {activeImageAsset && !activeQuizData && !activeCardData && (
                                    <div className="ml-stage-image-pane">
                                        <div className="ml-visual-card-image">
                                            <img
                                                src={proxyUrl(activeImageAsset.image_url)}
                                                alt={activeImageAsset.title || 'Supporting Specimen'}
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                            <div className="ml-image-caption-pill">
                                                <span>{activeImageAsset.title || 'Scene Concept'}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* DEFAULT SOUNDWAVE STAGE (When no visuals, cards, or blocks are active) */}
                                {!activeQuizData && !activeCardData && !activeBlockData && !activeDiagramAsset && !activeImageAsset && (
                                    <div className="ml-default-soundwave-stage">
                                        <div className="ml-soundwave-ambient-glow"></div>
                                        <div className="ml-soundwave-avatar-wrapper">
                                            <img src={mironAvatarUrl} alt="Miron" className={isPlaying ? 'pulsing' : ''} />
                                            <div className="ml-soundwave-circle c1"></div>
                                            <div className="ml-soundwave-circle c2"></div>
                                        </div>
                                        <h3 className="ml-soundwave-topic">{selectedSection?.title}</h3>
                                        <p className="ml-soundwave-sub">Listening to Miron explanation...</p>
                                    </div>
                                )}
                            </div>

                                                        {/* Phase 1: Main-Stage Spotlight Note (Makes room on stage, then physically takes off to dock) */}
                            {dwellingNote && !activeQuizData && !activeCardData && (() => {
                                const { glyph, content } = parseBulletItem(dwellingNote.text);
                                const staticSpotlight = (
                                    <div className="ml-stage-spotlight-slot">
                                        <div
                                            className="ml-stage-spotlight-card"
                                            onClick={(e) => { e.stopPropagation(); dockDwellingNote?.(); }}
                                        >
                                            <div className="ml-spotlight-badge-row">
                                                <span className="ml-spotlight-eyebrow">
                                                    <i className="fas fa-bolt"></i> KEY TAKEAWAY
                                                </span>
                                                <span className="ml-spotlight-index">#{dwellingNote.index + 1}</span>
                                            </div>
                                            <div className="ml-spotlight-body">
                                                <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>{glyph}</span>
                                                <span className="ml-spotlight-text">{content}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                                return (
                                    <MironMotionBoundary fallback={staticSpotlight}>
                                        <div className="ml-stage-spotlight-slot">
                                            <motion.div
                                                key={dwellingNote.key}
                                                layoutId={`miron-note-${dwellingNote.key}`}
                                                className="ml-stage-spotlight-card"
                                                initial={{ opacity: 0, y: 18, scale: 0.94 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                transition={{ type: 'spring', stiffness: 330, damping: 27, mass: 0.9 }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    dockDwellingNote?.();
                                                }}
                                                title="Tap to dock note"
                                            >
                                                <div className="ml-spotlight-badge-row">
                                                    <span className="ml-spotlight-eyebrow">
                                                        <i className="fas fa-bolt"></i> KEY TAKEAWAY
                                                    </span>
                                                    <span className="ml-spotlight-index">#{dwellingNote.index + 1}</span>
                                                </div>
                                                <div className="ml-spotlight-body">
                                                    <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>
                                                        {glyph}
                                                    </span>
                                                    <span className="ml-spotlight-text">{content}</span>
                                                </div>
                                            </motion.div>
                                        </div>
                                    </MironMotionBoundary>
                                );
                            })()}
{/* Subtle Desktop Stage Indicator Chip */}
                            {stageModeBadge && (
                                <div className="ml-stage-mode-chip">
                                    <i className={`fas fa-${stageModeBadge.icon}`}></i>
                                    <span>{stageModeBadge.label}</span>
                                </div>
                            )}

                            {/* Stationary 1-Line Live Karaoke Subtitles Pill */}
                            {showKaraoke && (
                                <div
                                    className={`ml-karaoke-float ${!isChromeVisible ? 'is-docked-low' : ''} ${(activeBullets?.length || 0) > 0 && !isNotesCollapsed ? 'above-notes' : ''}`}
                                >
                                    <div className="ml-karaoke-stream">
                                        {karaokeData.sentenceSnippet.map((wObj) => {
                                            const isActiveWord = wObj.globalIdx === karaokeData.activeWordIdx;
                                            return (
                                                <span key={wObj.globalIdx} className={`ml-karaoke-word ${isActiveWord ? 'active' : ''}`}>
                                                    {wObj.word}{' '}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Mobile In-Place Live Takeaway Card (< 1024px Only; Desktop uses Right Sidebar) */}
                            {!isDesktopViewport && (dockedBullets?.length || 0) > 0 && !activeQuizData && !activeCardData && (() => {
                                const latestItem = dockedBullets[dockedBullets.length - 1];
                                const { glyph, content } = parseBulletItem(latestItem.text);
                                const isSlimTarget = !isNotesCollapsed && !isMobileNotesExpanded && Boolean(justLandedNoteKey);
                                const isChipTarget = isNotesCollapsed && Boolean(justLandedNoteKey);
                                const staticMobileFallback = (
                                    <div className="ml-mobile-note-bar" ref={notesDeckRef} onClick={(e) => { e.stopPropagation(); resetInactivityTimer(); }}>
                                        <div className="ml-mobile-note-pill" onClick={() => setIsMobileNotesExpanded(true)}>
                                            <div className="ml-mobile-note-content">
                                                <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>{glyph}</span>
                                                <span className="ml-mobile-note-text">{content}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                                return (
                                    <MironMotionBoundary fallback={staticMobileFallback}>
                                        <div
                                            className={`ml-mobile-note-bar ${isNotesCollapsed ? 'is-minimized' : ''}`}
                                            ref={notesDeckRef}
                                            onClick={(e) => { e.stopPropagation(); resetInactivityTimer(); }}
                                        >
                                            {isNotesCollapsed ? (
                                                <motion.button
                                                    type="button"
                                                    layoutId={isChipTarget ? `miron-note-${justLandedNoteKey}` : undefined}
                                                    className={`ml-mobile-note-chip ${justLandedNoteKey ? 'is-just-landed' : ''}`}
                                                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                                                    onClick={() => setIsNotesCollapsed(false)}
                                                    title="Show Live Takeaway"
                                                >
                                                    <i className="fas fa-bolt"></i>
                                                    <span>{dockedBullets.length}</span>
                                                </motion.button>
                                            ) : isMobileNotesExpanded ? (
                                                <div className="ml-mobile-note-pill is-expanded">
                                                    <div
                                                        className="ml-mobile-note-expanded-head"
                                                        onClick={() => setIsMobileNotesExpanded(false)}
                                                    >
                                                        <span className="ml-studio-notes-badge">
                                                            <i className="fas fa-bolt"></i> CORE TAKEAWAYS ({dockedBullets.length})
                                                        </span>
                                                        <div className="ml-mobile-note-actions">
                                                            <span className="ml-mobile-note-count" title="Collapse Takeaways">
                                                                <i className="fas fa-chevron-down"></i>
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="ml-mobile-note-min-btn"
                                                                onClick={(e) => { e.stopPropagation(); setIsMobileNotesExpanded(false); setIsNotesCollapsed(true); }}
                                                                title="Minimize Takeaway Pill"
                                                            >
                                                                <i className="fas fa-minus"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="ml-mobile-note-expanded-list" ref={mobileExpandedListRef}>
                                                        {dockedBullets.map((bItem) => {
                                                            const item = parseBulletItem(bItem.text);
                                                            const isLanded = justLandedNoteKey === bItem.key;
                                                            return (
                                                                <motion.div
                                                                    key={bItem.key}
                                                                    layout="position"
                                                                    layoutId={`miron-note-${bItem.key}`}
                                                                    className={`ml-mobile-note-expanded-row ${isLanded ? 'is-just-landed' : ''}`}
                                                                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                                                                >
                                                                    <span className={`ml-studio-bullet-glyph ${/^\d/.test(item.glyph) ? 'is-number' : ''}`}>
                                                                        {item.glyph}
                                                                    </span>
                                                                    <span className="ml-mobile-note-text">{item.content}</span>
                                                                </motion.div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ) : (
                                                <motion.div
                                                    layoutId={isSlimTarget ? `miron-note-${justLandedNoteKey}` : undefined}
                                                    className={`ml-mobile-note-pill ${justLandedNoteKey ? 'is-just-landed' : ''}`}
                                                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                                                    onClick={() => setIsMobileNotesExpanded(true)}
                                                >
                                                    <div className="ml-mobile-note-content" key={latestItem.key}>
                                                        <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>
                                                            {glyph}
                                                        </span>
                                                        <span className="ml-mobile-note-text">{content}</span>
                                                    </div>
                                                    <div className="ml-mobile-note-actions">
                                                        <span className="ml-mobile-note-count" title="Expand All Takeaways">
                                                            <i className="fas fa-bolt"></i> {dockedBullets.length}
                                                            <i className="fas fa-chevron-up"></i>
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="ml-mobile-note-min-btn"
                                                            onClick={(e) => { e.stopPropagation(); setIsNotesCollapsed(true); }}
                                                            title="Minimize Takeaway Pill"
                                                        >
                                                            <i className="fas fa-minus"></i>
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </div>
                                    </MironMotionBoundary>
                                );
                            })()}
                        </div>
                    )}
                    {/* VIEW 2: ANCHOR BLOCK SPLIT VIEW */}
                    {viewMode === 'anchor' && (
                        <div className="ml-anchor-split-workspace">
                            <div className="ml-pinned-block-card">
                                <div className="ml-pinned-block-header">
                                    <span><i className="fas fa-thumbtack"></i> Pinned Textbook Block</span>
                                    <span className="ml-pinned-block-tag">Block #{pinnedBlockIndex}</span>
                                </div>
                                <div className="ml-pinned-block-content page-canvas">
                                    {sectionPages[pinnedBlockIndex] && renderBookBlock ? (
                                        renderBookBlock(sectionPages[pinnedBlockIndex], pinnedBlockIndex, {
                                            bookTitle: selectedBook?.title,
                                            courseCode: selectedBook?.course_code
                                        })
                                    ) : (
                                        <p>{sectionPages[pinnedBlockIndex]?.body || 'Referencing section text...'}</p>
                                    )}
                                </div>
                            </div>

                            <div className="ml-anchor-sub-visual" ref={cinemaContainerRef}>
                                {activeAsset ? (
                                    activeAsset.asset_type === 'diagram_svg' ? (
                                        <div className="ml-visual-card-svg" dangerouslySetInnerHTML={{ __html: activeAsset.content_payload }} />
                                    ) : (
                                        <div className="ml-visual-card-image">
                                            <img src={proxyUrl(activeAsset.image_url)} alt="Illustration" />
                                        </div>
                                    )
                                ) : (
                                    <div className="ml-anchor-narration-card">
                                        <i className="fas fa-volume-high"></i>
                                        <span>Miron is breaking down this specific formula step-by-step.</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* BOTTOM TRANSPORT: OPTION A TWO-TIER STUDIO SCRUBBER */}
                    <div 
                        className={`ml-transport-bar ${!isChromeVisible ? 'is-hidden' : ''}`}
                        onClick={(e) => { e.stopPropagation(); resetInactivityTimer(); }}
                    >
                        {/* Tier 1: Script-Defined Section Rail + Outline Trigger */}
                        {effectiveSections.length > 0 && (
                            <div className="ml-section-rail-row">
                                <div className="ml-section-rail" ref={railRef}>
                                    {effectiveSections.map((sec, idx) => {
                                        const isActive = idx === activeSectionIndex;
                                        const isDone = idx < activeSectionIndex || (sec.lessonId && completedLessonIds.has(sec.lessonId));
                                        return (
                                            <button
                                                key={sec.key || idx}
                                                type="button"
                                                className={`ml-section-pill ${isActive ? 'active' : ''} ${isDone ? 'is-done' : ''}`}
                                                onClick={() => {
                                                    if (sec.manifestRef) handleJumpToSection(sec.manifestRef);
                                                    else if (onSelectSectionItem) onSelectSectionItem(sec);
                                                }}
                                                title={`${sec.sectionTag ? sec.sectionTag + ' • ' : ''}${sec.title}`}
                                            >
                                                {isDone && !isActive && <i className="fas fa-check ml-sec-check"></i>}
                                                <span className="ml-sec-pill-tag">{sec.sectionTag || `Part ${idx + 1}`}</span>
                                                <span className="ml-sec-pill-title">{sec.title}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {setIsOutlineOpen && (
                                    <button
                                        type="button"
                                        className="ml-outline-trigger-btn"
                                        onClick={() => setIsOutlineOpen(true)}
                                        title="Chapter Outline"
                                    >
                                        <i className="fas fa-list-ul"></i>
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Tier 2: Full-Width Precision Scrubber with Quiz Checkpoints */}
                        <div className="ml-scrub-row">
                            <span className="ml-scrub-time">{formatTime(currentTime)}</span>
                            <div
                                className="ml-scrub-track"
                                ref={progressBarRef}
                                onClick={handleSeek}
                                title="Seek within current section"
                            >
                                <div className="ml-scrub-fill" style={{ width: `${scrubPct}%` }}></div>
                                {quizMarkers.map((qm, qIdx) => (
                                    <span
                                        key={qIdx}
                                        className={`ml-quiz-marker ${qm.completed ? 'is-completed' : ''}`}
                                        style={{ left: `${qm.pct}%` }}
                                        title={`Checkpoint Quiz (${formatTime(qm.time)})`}
                                    ></span>
                                ))}
                            </div>
                            <span className="ml-scrub-time is-end">{formatTime(duration)}</span>
                        </div>

                        {/* Tier 3: Mathematically Centered Controls */}
                        <div className="ml-transport-row">
                            <div className="ml-left-actions">
                                <button
                                    type="button"
                                    className={`ml-cc-btn ${ccEnabled ? 'active' : ''}`}
                                    onClick={() => setCcEnabled(prev => !prev)}
                                    title="Toggle Live Captions (C)"
                                >
                                    CC
                                </button>
                            </div>

                            <div className="ml-center-playback-actions">
                                <button
                                    type="button"
                                    className="ml-section-step-btn"
                                    onClick={() => onStepSection && onStepSection(-1)}
                                    disabled={activeSectionIndex <= 0}
                                    title="Previous Section"
                                >
                                    <i className="fas fa-backward-step"></i>
                                </button>

                                <button className="ml-skip-btn" onClick={() => handleSkip(-10)} title="Rewind 10s (←)">
                                    <i className="fas fa-rotate-left"></i>
                                    <span className="ml-skip-label">10</span>
                                </button>

                                <button className="ml-main-play-btn" onClick={handleTogglePlay} title="Play / Pause (Space)">
                                    <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i>
                                </button>

                                <button className="ml-skip-btn" onClick={() => handleSkip(10)} title="Forward 10s (→)">
                                    <i className="fas fa-rotate-right"></i>
                                    <span className="ml-skip-label">10</span>
                                </button>

                                <button
                                    type="button"
                                    className="ml-section-step-btn"
                                    onClick={() => onStepSection && onStepSection(1)}
                                    disabled={activeSectionIndex >= effectiveSections.length - 1}
                                    title="Next Section"
                                >
                                    <i className="fas fa-forward-step"></i>
                                </button>
                            </div>

                            <div className="ml-right-actions">
                                <button className="ml-speed-btn" onClick={handleCycleSpeed} title="Playback Speed">
                                    <span>{playbackRate}x</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    </div>

                    {/* DESKTOP STUDIO SIDEBAR (>= 1024px): LIVE TAKEAWAYS & OUTLINE */}
                    {isDesktopViewport && isSidebarOpen && (
                        <aside className="ml-desktop-sidebar" onClick={(e) => e.stopPropagation()}>
                            <div className="ml-sidebar-header">
                                <div className="ml-sidebar-tabs">
                                    <button
                                        type="button"
                                        className={`ml-sidebar-tab ${desktopSidebarTab === 'notes' ? 'active' : ''} ${desktopSidebarTab === 'outline' && justLandedNoteKey ? 'is-receiving-note' : ''}`}
                                        onClick={() => {
                                            userPinnedOutlineRef.current = false;
                                            setDesktopSidebarTab?.('notes');
                                        }}
                                    >
                                        {desktopSidebarTab === 'outline' && justLandedNoteKey && (
                                            <motion.span
                                                layoutId={`miron-note-${justLandedNoteKey}`}
                                                className="ml-flight-landing-anchor"
                                                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                                            />
                                        )}
                                        <i className="fas fa-bolt"></i>
                                        <span>Takeaways</span>
                                        {dockedBullets.length > 0 && (
                                            <span className="ml-sidebar-tab-badge">{dockedBullets.length}</span>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        className={`ml-sidebar-tab ${desktopSidebarTab === 'outline' ? 'active' : ''}`}
                                        onClick={() => {
                                            userPinnedOutlineRef.current = true;
                                            setDesktopSidebarTab?.('outline');
                                        }}
                                    >
                                        <i className="fas fa-list-ul"></i>
                                        <span>Outline</span>
                                        <span className="ml-sidebar-tab-count">{effectiveSections.length}</span>
                                    </button>
                                </div>
                                {setIsSidebarOpen && (
                                    <button
                                        type="button"
                                        className="ml-sidebar-collapse-btn"
                                        onClick={() => setIsSidebarOpen(false)}
                                        title="Collapse Panel for Fullscreen Cinema"
                                    >
                                        <i className="fas fa-angles-right"></i>
                                    </button>
                                )}
                            </div>

                            {desktopSidebarTab === 'notes' ? (
                                <div className="ml-sidebar-body" ref={desktopNotesRef}>
                                    <div className="ml-sidebar-now-card">
                                        <div className="ml-sidebar-now-top">
                                            <span className="ml-sidebar-now-eyebrow">
                                                <i className="fas fa-wave-square"></i> NOW EXPLAINING
                                            </span>
                                            {activeNodeCue?.target && (
                                                <span className="ml-sidebar-focus-chip">
                                                    {activeNodeCue.target.replace(/[-_]/g, ' ')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="ml-sidebar-now-title">
                                            {effectiveSections[activeSectionIndex]?.sectionTag ? `${effectiveSections[activeSectionIndex].sectionTag} • ` : ''}
                                            {effectiveSections[activeSectionIndex]?.title || selectedSection?.title}
                                        </div>
                                    </div>

                                    {dockedBullets.length > 0 ? (
                                        <MironMotionBoundary
                                            fallback={
                                                <div className="ml-sidebar-bullets-list">
                                                    {dockedBullets.map((bItem) => {
                                                        const { glyph, content } = parseBulletItem(bItem.text);
                                                        return (
                                                            <div key={bItem.key} className="ml-sidebar-bullet-card">
                                                                <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>{glyph}</span>
                                                                <span className="ml-studio-bullet-text">{content}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            }
                                        >
                                            <div className="ml-sidebar-bullets-list">
                                                {dockedBullets.map((bItem) => {
                                                    const { glyph, content } = parseBulletItem(bItem.text);
                                                    const isLanded = justLandedNoteKey === bItem.key;
                                                    return (
                                                        <motion.div
                                                            key={bItem.key}
                                                            layout="position"
                                                            layoutId={`miron-note-${bItem.key}`}
                                                            className={`ml-sidebar-bullet-card ${isLanded ? 'is-just-landed' : ''}`}
                                                            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                                                        >
                                                            <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>
                                                                {glyph}
                                                            </span>
                                                            <span className="ml-studio-bullet-text">{content}</span>
                                                        </motion.div>
                                                    );
                                                })}
                                            </div>
                                        </MironMotionBoundary>
                                    ) : (
                                        <div className="ml-sidebar-empty">
                                            <div className="ml-sidebar-empty-icon">
                                                <i className="fas fa-bolt"></i>
                                            </div>
                                            <h4>{dwellingNote ? 'Takeaway On Stage' : 'Live Key Takeaways'}</h4>
                                            <p>
                                                {dwellingNote
                                                    ? 'Watch the main stage — this takeaway will glide over and dock here momentarily.'
                                                    : 'Core concepts, definitions, and exam-ready points will stream onto the stage and dock here as Miron teaches.'}
                                            </p>
                                            <button
                                                type="button"
                                                className="ml-sidebar-empty-btn"
                                                onClick={() => {
                                                    userPinnedOutlineRef.current = true;
                                                    setDesktopSidebarTab?.('outline');
                                                }}
                                            >
                                                <i className="fas fa-list-ul"></i> Browse Chapter Outline
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="ml-sidebar-body">
                                    <div className="ml-sidebar-outline-head">
                                        <span className="ml-outline-eyebrow">CHAPTER SYLLABUS</span>
                                        <h4 className="ml-sidebar-outline-title">{activeChapterTitle || selectedBook?.title}</h4>
                                    </div>
                                    <div className="ml-sidebar-outline-list">
                                        {effectiveSections.map((sec, idx) => {
                                            const isActive = idx === activeSectionIndex;
                                            const isDone = idx < activeSectionIndex || (sec.lessonId && completedLessonIds.has(sec.lessonId));
                                            return (
                                                <button
                                                    key={sec.key || idx}
                                                    type="button"
                                                    className={`ml-outline-item ${isActive ? 'active' : ''}`}
                                                    onClick={() => {
                                                        if (sec.manifestRef) handleJumpToSection(sec.manifestRef);
                                                        else if (onSelectSectionItem) onSelectSectionItem(sec);
                                                    }}
                                                >
                                                    <div className="ml-outline-item-left">
                                                        <span className={`ml-outline-status-dot ${isActive ? 'is-playing' : isDone ? 'is-done' : ''}`}>
                                                            {isActive ? <i className="fas fa-volume-high"></i> : isDone ? <i className="fas fa-check"></i> : (idx + 1)}
                                                        </span>
                                                        <div className="ml-outline-item-text">
                                                            {sec.sectionTag && <span className="ml-outline-sec-tag">{sec.sectionTag}</span>}
                                                            <span className="ml-outline-sec-name">{sec.title}</span>
                                                        </div>
                                                    </div>
                                                    <span className="ml-outline-duration">{formatTime(sec.duration)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </aside>
                    )}
                    {/* SLIDE-UP CHAPTER OUTLINE SHEET */}
                    {isOutlineOpen && (
                        <div className="ml-outline-backdrop" onClick={() => setIsOutlineOpen && setIsOutlineOpen(false)}>
                            <div className="ml-outline-sheet" onClick={(e) => e.stopPropagation()}>
                                <div className="ml-outline-header">
                                    <div>
                                        <span className="ml-outline-eyebrow">CHAPTER SECTIONS</span>
                                        <h3 className="ml-outline-title">{activeChapterTitle || selectedBook?.title}</h3>
                                    </div>
                                    <button
                                        type="button"
                                        className="ml-outline-close"
                                        onClick={() => setIsOutlineOpen && setIsOutlineOpen(false)}
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                                <div className="ml-outline-list">
                                    {effectiveSections.map((sec, idx) => {
                                        const isActive = idx === activeSectionIndex;
                                        const isDone = idx < activeSectionIndex || (sec.lessonId && completedLessonIds.has(sec.lessonId));
                                        return (
                                            <button
                                                key={sec.key || idx}
                                                type="button"
                                                className={`ml-outline-item ${isActive ? 'active' : ''}`}
                                                onClick={() => {
                                                    if (sec.manifestRef) handleJumpToSection(sec.manifestRef);
                                                    else if (onSelectSectionItem) onSelectSectionItem(sec);
                                                }}
                                            >
                                                <div className="ml-outline-item-left">
                                                    <span className={`ml-outline-status-dot ${isActive ? 'is-playing' : isDone ? 'is-done' : ''}`}>
                                                        {isActive ? <i className="fas fa-volume-high"></i> : isDone ? <i className="fas fa-check"></i> : (idx + 1)}
                                                    </span>
                                                    <div className="ml-outline-item-text">
                                                        {sec.sectionTag && <span className="ml-outline-sec-tag">{sec.sectionTag}</span>}
                                                        <span className="ml-outline-sec-name">{sec.title}</span>
                                                    </div>
                                                </div>
                                                <span className="ml-outline-duration">{formatTime(sec.duration)}</span>
                                            </button>
                                        );
                                                                        })}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            )}
        </div>
    );
};

export default MironStudioStage;