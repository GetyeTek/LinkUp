import React from 'react';
import { BookPageCanvas } from '@linkup-platform/sdk-core';
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
    React.useEffect(() => {
        if (!railRef.current) return;
        const activeEl = railRef.current.querySelector('.ml-section-pill.active');
        if (activeEl) {
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [activeSectionIndex]);

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
                <div className={`ml-studio-content-layout ${viewMode}`}>
                    {/* VIEW 1: CINEMA STAGE (Tap to Toggle Chrome) */}
                    {viewMode === 'cinema' && (
                        <div 
                            className="ml-cinema-stage" 
                            ref={cinemaContainerRef}
                            data-has-notes={(activeBullets?.length || 0) > 0 ? "true" : "false"}
                            data-has-image={Boolean(activeImageAsset) ? "true" : "false"}
                            data-dual-stage={isDualStage ? "true" : "false"}
                            data-has-book={Boolean(activeBlockData) ? "true" : "false"}
                            onClick={() => {
                                if (stage === 'studio') {
                                    setIsChromeVisible(prev => {
                                        const next = !prev;
                                        if (next && isPlaying) resetInactivityTimer();
                                        return next;
                                    });
                                }
                            }}
                        >
                            <div className={`ml-cinema-visual-frame ${isDualStage ? 'is-dual-stage' : ''} ${!isDualStage && activeImageAsset ? 'is-single-image' : ''}`}>
                                {/* INTERACTIVE CHECKPOINT QUIZ (Takes center stage during checkpoint gate) */}
                                {activeQuizData && (
                                    <MironQuizCard
                                        quizData={activeQuizData}
                                        onComplete={() => resumeFromQuiz(activeQuizCue?.time)}
                                    />
                                )}

                                {/* PRESENTATION BOOKEND (Intro Roadmap & Summary Recap) */}
                                {!activeQuizData && activeCardData && (
                                    <MironStageCard cardData={activeCardData} />
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

                                {/* TIGHT EXCERPT CARD: Locked 794px virtual canvas clone (Zero re-wrap, zero void) */}
                                {activeBlockData && isDualStage && !activeQuizData && !activeCardData && (
                                    <div 
                                        className="ml-stage-excerpt-pane"
                                        style={{ 
                                            height: 'max-content',
                                            minHeight: '0',
                                            flex: '0 0 auto'
                                        }}
                                    >
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
                                                <img src={proxyUrl(activeDiagramAsset.image_url)} alt={activeDiagramAsset.title || 'Illustration'} />
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
                                            <img src={proxyUrl(activeImageAsset.image_url)} alt={activeImageAsset.title || 'Supporting Specimen'} />
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

                            {/* Subtle Desktop Stage Indicator Chip */}
                            {stageModeBadge && (
                                <div className="ml-stage-mode-chip">
                                    <i className={`fas fa-${stageModeBadge.icon}`}></i>
                                    <span>{stageModeBadge.label}</span>
                                </div>
                            )}

                            {/* Floating Live Karaoke Subtitles Pill */}
                            {showKaraoke && (
                                <div
                                    className={`ml-karaoke-float ${!isChromeVisible ? 'is-docked-low' : ''} ${(activeBullets?.length || 0) > 0 && !isNotesCollapsed ? 'above-notes' : ''}`}
                                >
                                    <div className="ml-karaoke-stream">
                                        {karaokeData.sentenceSnippet.map((wObj, wIdx) => {
                                            const isActiveWord = wObj.word === karaokeData.activeWord &&
                                                currentTime >= wObj.start - 0.05 &&
                                                currentTime <= wObj.end + 0.15;
                                            return (
                                                <span key={wIdx} className={`ml-karaoke-word ${isActiveWord ? 'active' : ''}`}>
                                                    {wObj.word}{' '}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Studio Split-Screen Notes Deck (Collapsible on Mobile) */}
                            {(activeBullets?.length || 0) > 0 && !activeQuizData && !activeCardData && (
                                <div 
                                    className={`ml-studio-notes-deck ${isNotesCollapsed ? 'is-collapsed' : ''}`}
                                    ref={notesDeckRef}
                                    onClick={(e) => { e.stopPropagation(); resetInactivityTimer(); }}
                                >
                                    <div
                                        className="ml-studio-notes-header is-toggleable"
                                        onClick={() => setIsNotesCollapsed(prev => !prev)}
                                    >
                                        <span className="ml-studio-notes-badge">
                                            <i className="fas fa-bolt"></i> CORE TAKEAWAYS ({activeBullets.length})
                                        </span>
                                        <div className="ml-notes-header-right">
                                            {activeNodeCue?.target && (
                                                <span className="ml-studio-topic-tag">
                                                    {activeNodeCue.target.replace(/[-_]/g, ' ')}
                                                </span>
                                            )}
                                            <i className={`fas fa-chevron-${isNotesCollapsed ? 'up' : 'down'} ml-notes-collapse-icon`}></i>
                                        </div>
                                    </div>
                                    {!isNotesCollapsed && (
                                        <div className="ml-studio-bullets-stream">
                                            {activeBullets.map((bullet, bIdx) => {
                                                const { glyph, content } = parseBulletItem(bullet);
                                                return (
                                                    <div key={bIdx} className="ml-studio-bullet-row" style={{ animationDelay: `${bIdx * 0.05}s` }}>
                                                        <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>
                                                            {glyph}
                                                        </span>
                                                        <span className="ml-studio-bullet-text">{content}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
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

                            <div className="ml-anchor-sub-visual">
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
                                    title="Toggle Live Captions"
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

                                <button className="ml-skip-btn" onClick={() => handleSkip(-10)} title="Rewind 10s">
                                    <i className="fas fa-rotate-left"></i>
                                    <span className="ml-skip-label">10</span>
                                </button>

                                <button className="ml-main-play-btn" onClick={handleTogglePlay}>
                                    <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i>
                                </button>

                                <button className="ml-skip-btn" onClick={() => handleSkip(10)} title="Forward 10s">
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