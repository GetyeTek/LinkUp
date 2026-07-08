import React, { useState, useEffect, useRef } from 'react';
import './FullscreenMediaGallery.css';

const FullscreenMediaGallery = ({ fullscreenGallery, setFullscreenGallery }) => {
    const [scale, setScale] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [isInteracting, setIsInteracting] = useState(false);
    
    const touchState = useRef({ startX: 0, startY: 0, initialDist: 0, initialScale: 1 });
    const containerRef = useRef(null);

    // Reset zoom state on image change
    useEffect(() => {
        setScale(1);
        setPos({ x: 0, y: 0 });
    }, [fullscreenGallery?.index]);

    // Handle trackpad pinch-to-zoom (wheel + ctrlKey)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const handleWheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                setScale(prev => {
                    const newScale = Math.max(1, Math.min(prev + (e.deltaY * -0.01), 5));
                    if (newScale === 1) setPos({ x: 0, y: 0 });
                    return newScale;
                });
            }
        };
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [fullscreenGallery]);

    if (!fullscreenGallery) return null;

    const handleTouchStart = (e) => {
        if (e.touches.length === 2) {
            setIsInteracting(true);
            const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            touchState.current = { ...touchState.current, initialDist: dist, initialScale: scale };
        } else if (e.touches.length === 1 && scale > 1) {
            setIsInteracting(true);
            touchState.current = { ...touchState.current, startX: e.touches[0].clientX - pos.x, startY: e.touches[0].clientY - pos.y };
        }
    };

    const handleTouchMove = (e) => {
        if (e.touches.length === 2) {
            const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const newScale = Math.max(1, Math.min(touchState.current.initialScale * (dist / touchState.current.initialDist), 5));
            setScale(newScale);
        } else if (e.touches.length === 1 && scale > 1) {
            const newX = e.touches[0].clientX - touchState.current.startX;
            const newY = e.touches[0].clientY - touchState.current.startY;
            setPos({ x: newX, y: newY });
        }
    };

    const handleTouchEnd = () => {
        setIsInteracting(false);
        if (scale <= 1) {
            setScale(1);
            setPos({ x: 0, y: 0 });
        } else {
            // Soft boundary clamping based on scale projection
            const maxPanX = (window.innerWidth * scale - window.innerWidth) / 2;
            const maxPanY = (window.innerHeight * scale - window.innerHeight) / 2;
            setPos(prev => ({
                x: Math.max(-maxPanX, Math.min(prev.x, maxPanX)),
                y: Math.max(-maxPanY, Math.min(prev.y, maxPanY))
            }));
        }
    };

    const handleDoubleTap = () => {
        if (scale > 1) {
            setScale(1);
            setPos({ x: 0, y: 0 });
        } else {
            setScale(2.5);
        }
    };

    const currentItem = fullscreenGallery.items[fullscreenGallery.index];

    return (
        <div className="fullscreen-gallery-overlay" onClick={() => setFullscreenGallery(null)} ref={containerRef}>
            <button className="fg-close" onClick={() => setFullscreenGallery(null)}>
                <i className="fas fa-chevron-down"></i>
            </button>
            
            {fullscreenGallery.items.length > 1 && scale === 1 && (
                <button className="fg-nav prev" onClick={(e) => { e.stopPropagation(); setFullscreenGallery(p => ({ ...p, index: (p.index - 1 + p.items.length) % p.items.length })); }}>
                    <i className="fas fa-chevron-left"></i>
                </button>
            )}
            
            <div 
                className="fg-content" 
                onClick={e => e.stopPropagation()}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onDoubleClick={handleDoubleTap}
            >
                {currentItem.type.startsWith('video/') ? (
                    <video 
                        src={currentItem.url} 
                        controls 
                        autoPlay 
                        className="fg-item" 
                        style={{ 
                            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                            transition: isInteracting ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                        }}
                    />
                ) : (
                    <img 
                        src={currentItem.url} 
                        alt="Fullscreen Media" 
                        className="fg-item" 
                        style={{ 
                            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                            transition: isInteracting ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                        }}
                        draggable={false}
                    />
                )}
            </div>

            {fullscreenGallery.items.length > 1 && scale === 1 && (
                <button className="fg-nav next" onClick={(e) => { e.stopPropagation(); setFullscreenGallery(p => ({ ...p, index: (p.index + 1) % p.items.length })); }}>
                    <i className="fas fa-chevron-right"></i>
                </button>
            )}
            
            {fullscreenGallery.items.length > 1 && (
                <div className="fg-counter" style={{ opacity: scale > 1 ? 0 : 1, transition: 'opacity 0.2s' }}>
                    {fullscreenGallery.index + 1} / {fullscreenGallery.items.length}
                </div>
            )}
        </div>
    );
};

export default FullscreenMediaGallery;