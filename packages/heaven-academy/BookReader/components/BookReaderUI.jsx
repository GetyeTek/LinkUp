import React from 'react';
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

                    {/* Desktop Toolbar: Zoom & Theme */}
                    <div className="reader-desktop-tools">
                        <div className="reader-zoom-cluster">
                            <button className="reader-zoom-btn" onClick={onZoomOut} title="Zoom Out">
                                <i className="fa-solid fa-minus"></i>
                            </button>
                            <button className="reader-zoom-indicator" onClick={onZoomReset} title="Reset Zoom">
                                {zoomDisplay || 100}%
                            </button>
                            <button className="reader-zoom-btn" onClick={onZoomIn} title="Zoom In">
                                <i className="fa-solid fa-plus"></i>
                            </button>
                            <button className="reader-fit-btn" onClick={onZoomFit} title="Fit to Screen">
                                <i className="fa-solid fa-arrows-left-right-to-line"></i>
                                <span>Fit</span>
                            </button>
                        </div>

                        <button className="reader-theme-btn" onClick={toggleTheme} title={`Theme: ${currentTheme || 'Dark'}`}>
                            <i className={`fa-solid ${currentTheme === 'light' ? 'fa-sun' : currentTheme === 'sepia' ? 'fa-scroll' : 'fa-moon'}`}></i>
                        </button>
                    </div>

                    {/* Adaptive Mode Switcher */}
                    {(() => {
                        const hasBoth = visualLangs.includes('en') && visualLangs.includes('am');
                        const singleTarget = visualLangs.includes('am') && !visualLangs.includes('en') ? 'visual_am' : 'visual_en';
                        const isVisualActive = viewMode === 'visual_en' || viewMode === 'visual_am';

                        if (hasBoth) {
                            return (
                                <div className="header-variant-toggle">
                                    <button 
                                        className={`variant-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
                                        onClick={() => setViewMode('text')}
                                        title="Standard Book"
                                    >
                                        <i className="fas fa-book-open"></i>
                                        <span className="variant-label">Book</span>
                                    </button>
                                    <button 
                                        className={`variant-toggle-btn ${viewMode === 'visual_en' ? 'active' : ''}`}
                                        onClick={() => setViewMode('visual_en')}
                                        title="Visual Note (English)"
                                    >
                                        <i className="fas fa-sparkles"></i>
                                        <span className="variant-label">Visual EN</span>
                                    </button>
                                    <button 
                                        className={`variant-toggle-btn ${viewMode === 'visual_am' ? 'am-active' : ''}`}
                                        onClick={() => setViewMode('visual_am')}
                                        title="Visual Note (Amharic)"
                                    >
                                        <span>🇪🇹</span>
                                        <span className="variant-label">አማርኛ</span>
                                    </button>
                                </div>
                            );
                        }

                        return (
                            <div className="header-variant-toggle">
                                <button 
                                    className={`variant-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
                                    onClick={() => setViewMode('text')}
                                    title="Standard Book"
                                >
                                    <i className="fas fa-book-open"></i>
                                    <span className="variant-label">Book</span>
                                </button>
                                <button 
                                    className={`variant-toggle-btn ${isVisualActive ? 'active' : ''}`}
                                    onClick={() => setViewMode(singleTarget)}
                                    title="Visual Note"
                                >
                                    <i className="fas fa-sparkles"></i>
                                    <span className="variant-label">Visual Note</span>
                                </button>
                            </div>
                        );
                    })()}
                </div>

                <div className="ui-bar reader-footer">
                    <div className="icon-btn" title="Table of Contents" onClick={() => setIsTocOpen(!isTocOpen)}>
                        <i className="fa-solid fa-list"></i>
                    </div>
                    
                    {viewMode !== 'text' ? (
                        <div className="visual-segmented-scrubber" title="Jump between Visual Sheets">
                            {(visualSheets && visualSheets.length > 0 ? visualSheets : Array.from({ length: 4 })).map((sheet, sIdx) => {
                                const isPast = sIdx < activeVisualSheetIndex;
                                const isCurrent = sIdx === activeVisualSheetIndex;
                                const sheetTitle = sheet?.topic_title || `Page ${sheet?.page_number || sIdx + 1}`;
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
                        <div className="page-counter-btn visual-counter-pill" title="Active Visual Sheet">
                            <i className="fas fa-sparkles" style={{ fontSize: '0.72rem', color: 'var(--accent, #42d7b8)' }}></i>
                            <span>Sheet {activeVisualSheetIndex + 1}</span>
                            <span className="counter-divider">/ {visualSheets.length || '--'}</span>
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