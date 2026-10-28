import React, { useState, useEffect } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './BookReaderUI.css';

const BookReaderUI = ({
    book,
    isUiVisible,
    setIsUiVisible,
    toggleTheme,
    onClose,
    isTocOpen,
    setIsTocOpen,
    pages,
    scrubberRef,
    handleScrubberChange,
    handleScrubberInput,
    isJumpMode,
    setIsJumpMode,
    jumpInput,
    setJumpInput,
    jumpToPage,
    lastDisplayPage,
    pageCountRef,
    viewMode = 'text',
    setViewMode,
    currentTheme,
    zoomDisplay,
    onZoomIn,
    onZoomOut,
    onZoomFit,
    onZoomReset,
    visualLangs = [],
    visualSheets = [],
    activeVisualSheetIndex = 0,
    onJumpToVisualSheet
}) => {
    const { t } = usePlatform();
    const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const activeScale = (zoomDisplay || 100) / 100;
    const baseContentWidth = viewMode !== 'text' ? 780 : 794;
    const effectiveWidth = baseContentWidth * activeScale;
    const rawDistanceToRight = (windowWidth - effectiveWidth) / 2;
    const minRightBound = (visualLangs?.length >= 2 ? 260 : 190) + 14;
    const maxRightBound = Math.max(minRightBound, windowWidth - 340);
    const dynamicRight = Math.min(maxRightBound, Math.max(minRightBound, rawDistanceToRight));

    return (
        <>
            <div id="main-fab" className={`fab-container ${isUiVisible ? 'active' : ''}`}>
                <div className="fab-options">
                    <div className="fab-mini" onClick={toggleTheme}>
                        <i className="fa-solid fa-palette"></i>
                    </div>
                </div>
                <div className="fab-main" onClick={() => setIsUiVisible(!isUiVisible)}>
                    <i className="fa-solid fa-layer-group"></i>
                </div>
            </div>

            <div id="ui-layer" className={isUiVisible ? '' : 'hidden'}>
                <div className="ui-bar reader-header">
                    <div className="header-left">
                        <div className="icon-btn" onClick={onClose}><i className="fa-solid fa-chevron-left"></i></div>
                        <div className="header-title">{book?.title || 'Loading Document'}</div>
                    </div>

                    {/* Desktop Toolbar: Dynamically Hugs Book Right Shoulder */}
                    <div className="reader-desktop-tools" style={{ right: `${dynamicRight}px` }}>
                        <div className="reader-zoom-cluster">
                            <button className="reader-zoom-btn" onClick={onZoomOut} title={t('reader_zoom_out', 'Zoom Out')}>
                                <i className="fa-solid fa-minus"></i>
                            </button>
                            <button className="reader-zoom-indicator" onClick={onZoomReset} title={t('reader_reset_zoom', 'Reset Zoom')}>
                                {zoomDisplay || 100}%
                            </button>
                            <button className="reader-zoom-btn" onClick={onZoomIn} title={t('reader_zoom_in', 'Zoom In')}>
                                <i className="fa-solid fa-plus"></i>
                            </button>
                            <button className="reader-fit-btn" onClick={onZoomFit} title={t('reader_fit', 'Fit to Screen')}>
                                <i className="fa-solid fa-arrows-left-right-to-line"></i>
                                <span>{t('reader_fit', 'Fit')}</span>
                            </button>
                        </div>

                        <button className="reader-theme-btn" onClick={toggleTheme} title={`Theme: ${currentTheme || 'Dark'}`}>
                            <i className={`fa-solid ${currentTheme === 'light' ? 'fa-sun' : 'fa-moon'}`}></i>
                        </button>
                    </div>

                    {/* Adaptive Mode Switcher */}
                    {(() => {
                        const hasBoth = visualLangs.includes('en') && visualLangs.includes('am');
                        const singleTarget = visualLangs.includes('en') && !visualLangs.includes('am') ? 'visual_en' : 'visual_am';
                        const isVisualActive = viewMode === 'visual_en' || viewMode === 'visual_am';

                        if (hasBoth) {
                            return (
                                <div className="header-variant-toggle">
                                    <button 
                                        className={`variant-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
                                        onClick={() => setViewMode('text')}
                                        title={t('reader_book', 'Book')}
                                    >
                                        <i className="fas fa-book-open"></i>
                                        <span className="variant-label">{t('reader_book', 'Book')}</span>
                                    </button>
                                    <button 
                                        className={`variant-toggle-btn ${viewMode === 'visual_en' ? 'active' : ''}`}
                                        onClick={() => setViewMode('visual_en')}
                                        title={t('reader_english_note', 'English Note')}
                                    >
                                        <span className="variant-flag">🇬🇧</span>
                                        <span className="variant-label">{t('reader_english_note', 'English Note')}</span>
                                    </button>
                                    <button 
                                        className={`variant-toggle-btn ${viewMode === 'visual_am' ? 'am-active' : ''}`}
                                        onClick={() => setViewMode('visual_am')}
                                        title={t('reader_amharic_note', 'Amharic Note')}
                                    >
                                        <span className="variant-flag">🇪🇹</span>
                                        <span className="variant-label">{t('reader_amharic_note', 'Amharic Note')}</span>
                                    </button>
                                </div>
                            );
                        }

                        return (
                            <div className="header-variant-toggle">
                                <button 
                                    className={`variant-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
                                    onClick={() => setViewMode('text')}
                                    title={t('reader_book', 'Book')}
                                >
                                    <i className="fas fa-book-open"></i>
                                    <span className="variant-label">{t('reader_book', 'Book')}</span>
                                </button>
                                <button 
                                    className={`variant-toggle-btn ${isVisualActive ? (singleTarget === 'visual_am' ? 'am-active' : 'active') : ''}`}
                                    onClick={() => setViewMode(singleTarget)}
                                    title={singleTarget === 'visual_am' ? t('reader_amharic_note', 'Amharic Note') : t('reader_english_note', 'English Note')}
                                >
                                    <span className="variant-flag">{singleTarget === 'visual_am' ? '🇪🇹' : '🇬🇧'}</span>
                                    <span className="variant-label">{singleTarget === 'visual_am' ? t('reader_amharic_note', 'Amharic Note') : t('reader_english_note', 'English Note')}</span>
                                </button>
                            </div>
                        );
                    })()}
                </div>

                <div className="ui-bar reader-footer">
                    <div className="icon-btn" title={t('reader_contents', 'Table of Contents')} onClick={() => setIsTocOpen(!isTocOpen)}>
                        <i className="fa-solid fa-list"></i>
                    </div>
                    
                    {viewMode !== 'text' ? (
                        visualSheets && visualSheets.length > 0 && visualSheets.length <= 6 ? (
                            <div className="visual-segmented-scrubber" title="Jump between Visual Sheets">
                                {visualSheets.map((sheet, sIdx) => {
                                    const isPast = sIdx < activeVisualSheetIndex;
                                    const isCurrent = sIdx === activeVisualSheetIndex;
                                    const sheetTitle = sheet?.topic_title || `Sheet ${sIdx + 1}`;
                                    return (
                                        <div 
                                            key={sIdx}
                                            className={`visual-scrubber-segment ${isPast ? 'past' : ''} ${isCurrent ? 'active' : ''}`}
                                            onClick={() => onJumpToVisualSheet?.(sIdx)}
                                        >
                                            <div className="segment-track">
                                                <div className="segment-fill"></div>
                                            </div>
                                            <div className="segment-tooltip">
                                                <span className="st-num">Sheet {sIdx + 1}</span>
                                                <span className="st-title">{sheetTitle}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="scrubber-wrapper">
                                <input 
                                    type="range" 
                                    min="0" 
                                    max={Math.max(0, (visualSheets?.length || 1) - 1)} 
                                    value={activeVisualSheetIndex} 
                                    className="page-scrubber"
                                    style={{
                                        '--scrubber-fill': `${(visualSheets?.length > 1 ? (activeVisualSheetIndex / (visualSheets.length - 1)) * 100 : 0)}%`
                                    }}
                                    onChange={(e) => {
                                        const idx = parseInt(e.target.value, 10);
                                        onJumpToVisualSheet?.(idx);
                                    }}
                                />
                            </div>
                        )
                    ) : (
                        <div className="scrubber-wrapper">
                            <input 
                                type="range" 
                                min="1" 
                                max={pages.length || 1} 
                                defaultValue="1" 
                                ref={scrubberRef}
                                className="page-scrubber"
                                onChange={handleScrubberChange}
                                onInput={handleScrubberInput}
                            />
                        </div>
                    )}

                    {viewMode !== 'text' ? (
                        <div className="page-counter-btn visual-counter-pill" title={t('reader_sheet', 'Active Visual Sheet')}>
                            <i className="fas fa-sparkles" style={{ fontSize: '0.72rem', color: 'var(--accent, #42d7b8)' }}></i>
                            <span className="counter-sheet-word">{t('reader_sheet', 'Sheet')} </span>
                            <span>{activeVisualSheetIndex + 1}</span>
                            <span className="counter-divider">/{visualSheets.length || '--'}</span>
                        </div>
                    ) : isJumpMode ? (
                        <form className="jump-form" onSubmit={(e) => { e.preventDefault(); jumpToPage(jumpInput); }}>
                            <input 
                                type="number" 
                                autoFocus 
                                min="1" max={pages.length || 1} 
                                value={jumpInput} 
                                onChange={e => setJumpInput(e.target.value)} 
                                onBlur={() => setIsJumpMode(false)}
                            />
                        </form>
                    ) : (
                        <div className="page-counter-btn" onClick={() => { setIsJumpMode(true); setJumpInput(lastDisplayPage.current); }}>
                            <span ref={pageCountRef}>{lastDisplayPage.current || 1}</span> <span className="counter-divider">/ {pages.length || '--'}</span>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default BookReaderUI;