import React from 'react';
import { getCachedBook } from '@linkup-platform/sdk-core';

const formatDurationBadge = (totalSecs) => {
    const mins = Math.max(1, Math.round((totalSecs || 0) / 60));
    return `${mins} min`;
};

const MironCatalogView = ({
    stage,
    books,
    selectedBook,
    chaptersForBook = [],
    readyLessonRows = [],
    completedLessonIds = new Set(),
    resumeProgress,
    t,
    onSelectCourse,
    onSelectChapter,
    onResumeLastSession
}) => {
    const readyCountByBook = React.useMemo(() => {
        const map = {};
        readyLessonRows.forEach(r => {
            map[r.book_id] = (map[r.book_id] || 0) + 1;
        });
        return map;
    }, [readyLessonRows]);

    const hasResumable = Boolean(resumeProgress?.bookId && books.some(b => b.id === resumeProgress.bookId));

    return (
        <>
            {/* STAGE 0: COURSE SELECT GRID + RESUME HERO */}
            {stage === 'course_select' && (
                <div className="ml-stage-content course-grid-stage">
                    <div className="ml-stage-header">
                        <h2>{t('miron_what_studying_today', 'What are we studying today?')}</h2>
                        <p>{t('miron_select_course_desc', 'Select a curriculum textbook to launch synchronized visual audio chapters.')}</p>
                    </div>

                    {hasResumable && (
                        <div className="ml-resume-banner" onClick={onResumeLastSession}>
                            <div className="ml-resume-left">
                                <span className="ml-resume-eyebrow">
                                    <i className="fas fa-bolt"></i> CONTINUE STUDYING
                                </span>
                                <h3 className="ml-resume-title">
                                    {resumeProgress.courseCode ? `${resumeProgress.courseCode} • ` : ''}
                                    {resumeProgress.sectionTag ? `${resumeProgress.sectionTag} ` : ''}
                                    {resumeProgress.sectionTitle}
                                </h3>
                                <span className="ml-resume-meta">{resumeProgress.chapterTitle}</span>
                            </div>
                            <div className="ml-resume-play-pill">
                                <i className="fas fa-play"></i>
                                <span>Resume</span>
                            </div>
                        </div>
                    )}

                    <div className="ml-courses-grid">
                        {books.map(b => {
                            const readySections = readyCountByBook[b.id] || 0;
                            return (
                                <div 
                                    key={b.id} 
                                    className="ml-course-card" 
                                    onClick={() => onSelectCourse(b)}
                                    style={b.cover_url ? {
                                        backgroundImage: `linear-gradient(145deg, rgba(14, 14, 18, 0.70) 0%, rgba(10, 10, 14, 0.88) 100%), url("${b.cover_url}")`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center'
                                    } : {}}
                                >
                                    <div className="ml-card-top-row">
                                        <div className="ml-card-icon-box">
                                            <i className={`fa-solid ${b.icon || getCachedBook(b.course_code)?.icon || 'fa-book-open'}`}></i>
                                        </div>
                                        <div className="ml-card-top-tags">
                                            {readySections > 0 && (
                                                <span className="ml-voice-cue-chip" title="Audio Studio Ready">
                                                    <i className="fas fa-headphones"></i> {readySections}
                                                </span>
                                            )}
                                            <span className="ml-card-code-tag">{b.course_code || 'COURSE'}</span>
                                        </div>
                                    </div>
                                    <h3 className="ml-card-name">{b.title}</h3>
                                    <div className="ml-card-footer">
                                        <span className="ml-card-count">
                                            {b.toc?.length ? `${b.toc.length} Chapters` : 'Curriculum Book'}
                                        </span>
                                        <span className="ml-card-arrow"><i className="fas fa-arrow-right"></i></span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* STAGE 1: SCRIPT-DRIVEN CHAPTERS HUB (NO SECTION DROPDOWNS) */}
            {stage === 'toc_select' && selectedBook && (
                <div className="ml-stage-content toc-split-stage">
                    <div className="ml-toc-split-layout">
                        <div className="ml-toc-book-showcase" style={selectedBook.cover_url ? { '--bg-cover': `url("${selectedBook.cover_url}")` } : {}}>
                            <div className="ml-showcase-backdrop-blur"></div>
                            <div className="ml-showcase-cover-wrapper">
                                {selectedBook.cover_url ? (
                                    <img src={selectedBook.cover_url} className="ml-showcase-cover" alt={selectedBook.title} />
                                ) : (
                                    <div className="ml-showcase-fallback-cover">
                                        <i className={`fa-solid ${selectedBook.icon || 'fa-book-open'}`}></i>
                                    </div>
                                )}
                            </div>
                            <div className="ml-showcase-details">
                                <span className="ml-card-code-tag">{selectedBook.course_code || 'CURRICULUM'}</span>
                                <h2 className="ml-showcase-title">{selectedBook.title}</h2>
                                <p className="ml-showcase-meta">
                                    {chaptersForBook.filter(c => c.isReady).length} Ready Chapter(s)
                                </p>
                                <div className="ml-showcase-prompt-tip">
                                    <i className="fas fa-headphones"></i>
                                    <span>Tap any chapter to launch the lecture studio & scrub across sections.</span>
                                </div>
                            </div>
                        </div>

                        <div className="ml-toc-interactive-pane">
                            <div className="ml-chapters-list">
                                {chaptersForBook.map((ch, idx) => {
                                    const uniqueRowIds = Array.from(new Set(ch.rows.map(r => r.id)));
                                    const completedCount = uniqueRowIds.filter(id => completedLessonIds.has(id)).length;
                                    const pct = uniqueRowIds.length > 0 ? Math.round((completedCount / uniqueRowIds.length) * 100) : 0;
                                    const isResumableChapter = resumeProgress?.bookId === selectedBook.id && resumeProgress?.chapterTitle === ch.chapterTitle;

                                    return (
                                        <div
                                            key={idx}
                                            className={`ml-chapter-card ${ch.isReady ? 'is-ready' : 'is-upcoming'}`}
                                            onClick={() => ch.isReady && onSelectChapter(ch, isResumableChapter ? resumeProgress : null)}
                                        >
                                            <div className="ml-chapter-card-top">
                                                <div className="ml-chapter-badges">
                                                    <span className="ml-chapter-index-pill">CH {idx + 1}</span>
                                                    {ch.isReady ? (
                                                        <span className="ml-lesson-ready-badge">
                                                            <i className="fas fa-circle-play"></i> {ch.sections.length} {ch.sections.length === 1 ? 'Section' : 'Sections'} • {formatDurationBadge(ch.totalDuration)}
                                                        </span>
                                                    ) : (
                                                        <span className="ml-chapter-upcoming-badge">In Production</span>
                                                    )}
                                                </div>
                                                {ch.isReady && (
                                                    <span className="ml-chapter-launch-btn">
                                                        {isResumableChapter ? 'Resume' : 'Play'} <i className="fas fa-play"></i>
                                                    </span>
                                                )}
                                            </div>

                                            <h3 className="ml-chapter-card-title">{ch.chapterTitle}</h3>

                                            {ch.isReady && ch.sections.length > 0 && (
                                                <div className="ml-chapter-preview-tags">
                                                    {ch.sections.slice(0, 4).map((s, sIdx) => (
                                                        <span key={sIdx} className="ml-chapter-sec-chip">
                                                            {s.sectionTag || `Part ${sIdx + 1}`}
                                                        </span>
                                                    ))}
                                                    {ch.sections.length > 4 && (
                                                        <span className="ml-chapter-sec-chip is-more">+{ch.sections.length - 4} more</span>
                                                    )}
                                                </div>
                                            )}

                                            {ch.isReady && completedCount > 0 && (
                                                <div className="ml-chapter-progress-wrap">
                                                    <div className="ml-chapter-progress-track">
                                                        <div className="ml-chapter-progress-fill" style={{ width: `${pct}%` }}></div>
                                                    </div>
                                                    <span className="ml-chapter-progress-label">{completedCount}/{uniqueRowIds.length} done</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default MironCatalogView;