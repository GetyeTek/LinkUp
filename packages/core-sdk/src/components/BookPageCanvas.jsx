import React, { useState, useEffect, useRef } from 'react';
import './BookPageCanvas.css';

const baseCanvasWidth = 794;

const BookPageCanvas = ({
    blocks = [],
    pageNumber = 1,
    bookTitle = '',
    courseCode = '',
    prefix = '',
    focusedBlockIndex = null,
    isSpotlightActive = false,
    renderBlock = null,
    className = ''
}) => {
    const viewportRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const layerRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [layoutReady, setLayoutReady] = useState(false);

    useEffect(() => {
        const updateScale = () => {
            if (!viewportRef.current || !scrollContainerRef.current || !layerRef.current) return;
            const vw = viewportRef.current.clientWidth;
            const fitScale = Math.min((vw - 16) / baseCanvasWidth, 1.0);
            setScale(fitScale);

            const unscaledH = layerRef.current.offsetHeight;
            scrollContainerRef.current.style.width = `${baseCanvasWidth * fitScale}px`;
            scrollContainerRef.current.style.height = `${unscaledH * fitScale}px`;
            layerRef.current.style.transform = `scale(${fitScale})`;
            setLayoutReady(true);
        };

        updateScale();

        const ro = new ResizeObserver(updateScale);
        if (viewportRef.current) ro.observe(viewportRef.current);
        if (layerRef.current) ro.observe(layerRef.current);

        return () => ro.disconnect();
    }, [blocks]);

    // Center the focused block within the viewport
    useEffect(() => {
        if (focusedBlockIndex === null || focusedBlockIndex === undefined || !layoutReady) return;
        const timer = setTimeout(() => {
            const el = document.getElementById(`bpc-block-${focusedBlockIndex}`);
            if (el && viewportRef.current) {
                const targetY = (el.offsetTop * scale) - (viewportRef.current.clientHeight / 2) + ((el.offsetHeight * scale) / 2);
                viewportRef.current.scrollTo({
                    top: Math.max(0, targetY),
                    behavior: 'smooth'
                });
            }
        }, 80);
        return () => clearTimeout(timer);
    }, [focusedBlockIndex, scale, layoutReady]);

    return (
        <div className={`bpc-viewport ${className}`} ref={viewportRef}>
            <div className="bpc-scroll-container" ref={scrollContainerRef} style={{ opacity: layoutReady ? 1 : 0 }}>
                <div className="bpc-layer" ref={layerRef}>
                    <div className="bpc-page-wrapper" data-page-number={pageNumber}>
                        <div className={`bpc-page-canvas ${isSpotlightActive ? 'is-spotlight-active' : ''}`}>
                            {blocks.map((block, idx) => {
                                const isFocused = idx === focusedBlockIndex;
                                return (
                                    <div
                                        key={idx}
                                        id={`bpc-block-${idx}`}
                                        className={`bpc-block-target block-target-wrapper ${isFocused ? 'is-focused' : 'is-dimmed'}`}
                                    >
                                        {renderBlock ? (
                                            renderBlock(block, idx, { bookTitle, courseCode, prefix })
                                        ) : (
                                            <div className="book-block type-paragraph">
                                                <div className="book-block-body">{block?.body || ''}</div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div className="book-footer univ-footer">
                                <span className="footer-title">{bookTitle}</span>
                                <span className="footer-page">{pageNumber}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BookPageCanvas;