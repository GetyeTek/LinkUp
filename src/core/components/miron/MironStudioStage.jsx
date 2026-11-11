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
        activeCue,
        activeQuizCue,
        activeQuizData,
        resumeFromQuiz,
        activeCardCue,
        activeCardData,
        hasActiveNode,
        isDualStage,
        manifest,
        activeSection,
        handleTogglePlay,
        handleSkip,
        handleCycleSpeed,
        handleJumpToSection
    } = lectureEngine;

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

                                {/* PRESENTATION CARD (Intro Roadmap, Compare, Exam Alert, Summary, Note) */}
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
                                    <div className={`ml-stage-diagram-pane ${isDualStage ? 'is-docked' : 'is-hero'}`}>
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

                                {/* STANDALONE NOTE CARD (When active cue is a note card) */}
                                {!activeBlockData && !activeDiagramAsset && !activeImageAsset && activeCue?.type === 'note_card' && (
                                    <div className="ml-visual-card-note">
                                        <div className="ml-note-badge"><i className="fas fa-bolt"></i> KEY CONCEPT</div>
                                        <h3>{activeCue.target?.title || 'Core Takeaway'}</h3>
                                        <p>{activeCue.target?.body || activeCue.target || ''}</p>
                                    </div>
                                )}

                                {/* DEFAULT SOUNDWAVE STAGE (When no visuals or blocks are active) */}
                                {!activeQuizData && !activeCardData && !activeBlockData && !activeDiagramAsset && !activeImageAsset && activeCue?.type !== 'note_card' && (
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

                            {/* Studio Split-Screen Notes Deck */}
                            {(activeBullets?.length || 0) > 0 && !activeQuizData && (
                                <div 
                                    className="ml-studio-notes-deck"
                                    ref={notesDeckRef}
                                    onClick={(e) => { e.stopPropagation(); resetInactivityTimer(); }}
                                >
                                    <div className="ml-studio-notes-header">
                                        <span className="ml-studio-notes-badge">
                                            <i className="fas fa-bolt"></i> CORE TAKEAWAYS
                                        </span>
                                        {activeNodeCue?.target && (
                                            <span className="ml-studio-topic-tag">
                                                {activeNodeCue.target.replace(/[-_]/g, ' ')}
                                            </span>
                                        )}
                                    </div>
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

                    {/* BOTTOM TRANSPORT: COMPACT IMMERSIVE CONTROLS */}
                    <div 
                        className={`ml-transport-bar ${!isChromeVisible ? 'is-hidden' : ''}`}
                        onClick={(e) => { e.stopPropagation(); resetInactivityTimer(); }}
                    >
                        {/* Row 1: Single-Line Title & Time */}
                        <div className="ml-chapter-info-row">
                            <div className="ml-active-section-pill">
                                <i className="fas fa-bookmark"></i>
                                <span className="ml-active-sec-text">
                                    {activeSection ? `${activeSection.section_tag ? activeSection.section_tag + ' • ' : ''}${activeSection.title}` : (selectedSection?.title || 'Lecture Track')}
                                </span>
                            </div>
                            <div className="ml-time-display">
                                <span>{formatTime(currentTime)}</span>
                                <span className="ml-time-divider">/</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        {/* Row 2: Visible YouTube Chapter Segments (Tap to Jump) */}
                        <div className="ml-chapter-bar" title="Tap any chapter line to jump to section">
                            {manifest.map((sec, idx) => {
                                const isPast = currentTime >= sec.end_time;
                                const isCurrent = currentTime >= sec.start_time && currentTime < sec.end_time;
                                const progressPct = isPast ? 100 : isCurrent ? Math.min(100, Math.max(0, ((currentTime - sec.start_time) / (sec.duration || 1)) * 100)) : 0;
                                const widthPct = duration > 0 ? (sec.duration / duration) * 100 : (100 / (manifest.length || 1));

                                return (
                                    <div 
                                        key={idx}
                                        className={`ml-chapter-segment ${isCurrent ? 'active' : ''}`}
                                        style={{ width: `${Math.max(4, widthPct)}%` }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleJumpToSection(sec);
                                        }}
                                        title={`${sec.section_tag ? sec.section_tag + ' ' : ''}${sec.title} (${formatTime(sec.start_time)})`}
                                    >
                                        <div className="ml-chapter-fill" style={{ width: `${progressPct}%` }}></div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Row 3: Mathematically Centered Controls */}
                        <div className="ml-transport-row">
                            <div className="ml-transport-left-spacer"></div>

                            <div className="ml-center-playback-actions">
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
                            </div>

                            <div className="ml-right-actions">
                                <button className="ml-speed-btn" onClick={handleCycleSpeed} title="Playback Speed">
                                    <span>{playbackRate}x</span>
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};

export default MironStudioStage;