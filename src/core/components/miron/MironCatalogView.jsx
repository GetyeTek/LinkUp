import React from 'react';
import { getCachedBook } from '@linkup-platform/sdk-core';

const MironCatalogView = ({
    stage,
    books,
    selectedBook,
    expandedChapters,
    availableLessonSections,
    t,
    onSelectCourse,
    onToggleChapterExpand,
    onSelectSection
}) => {
    return (
        <>
            {/* STAGE 0: COURSE SELECT GRID */}
            {stage === 'course_select' && (
                <div className="ml-stage-content course-grid-stage">
                    <div className="ml-stage-header">
                        <h2>{t('miron_what_studying_today', 'What are we studying today?')}</h2>
                        <p>{t('miron_select_course_desc', 'Select a curriculum textbook to listen to AI-narrated visual lectures.')}</p>
                    </div>

                    <div className="ml-courses-grid">
                        {books.map(b => (
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
                                        <span className="ml-voice-cue-chip" title="Audio Studio"><i className="fas fa-headphones"></i></span>
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
                        ))}
                    </div>
                </div>
            )}

            {/* STAGE 1: TOC ACCORDION WITH AUDIO BADGES */}
            {stage === 'toc_select' && selectedBook && (
                <div className="ml-stage-content toc-split-stage">
                    <div className="ml-toc-split-layout">
                        {/* Book Showcase Column */}
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
                                <p className="ml-showcase-meta">{selectedBook.toc?.length || 0} Chapters in Syllabus</p>
                                <div className="ml-showcase-prompt-tip">
                                    <i className="fas fa-headphones"></i>
                                    <span>Select any section to launch its synchronized audio lecture.</span>
                                </div>
                            </div>
                        </div>

                        {/* Chapters & Sections Accordion */}
                        <div className="ml-toc-interactive-pane">
                            <div className="ml-toc-accordion">
                                {(selectedBook.toc || []).map((node, chIdx) => {
                                    const isExpanded = expandedChapters.has(chIdx);
                                    const hasChildren = node.children && node.children.length > 0;

                                    return (
                                        <div key={chIdx} className={`ml-toc-chapter-card ${isExpanded ? 'expanded' : ''}`}>
                                            <div className="ml-toc-ch-header" onClick={() => onToggleChapterExpand(chIdx)}>
                                                <div className="ml-toc-ch-left">
                                                    <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'}`}></i>
                                                    <span className="ml-toc-ch-title">{node.title}</span>
                                                </div>
                                                {node.page && <span className="ml-toc-page-pill">p.{node.page}</span>}
                                            </div>

                                            {isExpanded && hasChildren && (
                                                <div className="ml-toc-sections-list">
                                                    {node.children.map((sub, sIdx) => {
                                                        const subTagMatch = (sub.title || '').match(/^([0-9]+(?:\.[0-9]+)*)/);
                                                        const subTag = subTagMatch ? subTagMatch[1] : null;
                                                        const isReady = availableLessonSections.has(`${selectedBook.id}::${sub.title}`) ||
                                                                        (subTag && availableLessonSections.has(`${selectedBook.id}::${subTag}`));
                                                        return (
                                                            <div 
                                                                key={sIdx} 
                                                                className="ml-toc-section-item" 
                                                                onClick={() => onSelectSection(sub, node.title)}
                                                            >
                                                                <span className="ml-toc-sec-title">
                                                                    <i className={`fas fa-${isReady ? 'circle-play' : 'file-lines'} ml-sec-voice-glyph`}></i>
                                                                    {sub.title}
                                                                </span>
                                                                <div className="ml-toc-sec-actions">
                                                                    {isReady && <span className="ml-lesson-ready-badge">Audio Ready</span>}
                                                                    <span className="ml-toc-sec-arrow">
                                                                        {sub.page ? `p.${sub.page}` : ''} <i className="fas fa-arrow-right"></i>
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
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