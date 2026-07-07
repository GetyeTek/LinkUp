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
    pageCountRef
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
                </div>

                <div className="ui-bar reader-footer">
                    <div className="icon-btn" title="Table of Contents" onClick={() => setIsTocOpen(!isTocOpen)}>
                        <i className="fa-solid fa-list"></i>
                    </div>
                    
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

                    {isJumpMode ? (
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