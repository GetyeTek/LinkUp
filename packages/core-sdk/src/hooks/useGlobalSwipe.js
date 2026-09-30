import { useRef } from 'react';

export const useGlobalSwipe = (activeTab, setActiveTab) => {
    const touchState = useRef({ startX: 0, startY: 0, endX: 0, endY: 0 });

            const handleTouchStart = (e) => {
            // 1. Ignore multi-touch gestures (pinch-to-zoom, multi-finger gestures)
            if (!e.touches || e.touches.length !== 1) {
                touchState.current.startX = 0;
                return;
            }

            const target = e.target;

            // 2. Ignore any open modals, overlays, drawers, sheets, and full-screen portals
            const isInsideOverlay = target.closest(
                '[class*="-overlay"], [class*="-modal"], [class*="-sheet"], [class*="-drawer"], [class*="-dialog"], .fullscreen-overlay, .reader-root, .kicked-overlay, .video-tour-overlay, .discovery-screen'
            );
            if (isInsideOverlay) {
                touchState.current.startX = 0;
                return;
            }

            // 3. Ignore interactive controls, media players, canvas engines, ranges, and explicit no-swipe targets
            const isInteractive = target.closest(
                'input, textarea, select, button, canvas, video, audio, iframe, pre, code, .katex-display, .no-swipe, [data-no-swipe], .page-scrubber'
            );
            if (isInteractive) {
                touchState.current.startX = 0;
                return;
            }

            // 4. Ignore known horizontal scroll areas & carousels across all modules
            const isHorizontalScrollZone = target.closest(
                '.discovery-scroll-container, .priority-scroll-wrapper, .priority-track, .dashboard-scroll-wrapper, .dashboard-track, .filter-pills, .filter-pills-container, .library-filters, .question-nav-strip, .fca-chapter-strip, .sheet-selector-pills, .staging-preview-content, .pc-duration-pills, .tasks-nav, .si-media-pills, .toc-children, .bookshelf-perspective, .book-container, .live-board-canvas, .cropper-viewport, .interactive-match-container'
            );
            if (isHorizontalScrollZone) {
                touchState.current.startX = 0;
                return;
            }

            // 5. Dynamic Computed Style Guard: Traverse ancestors to detect any horizontally scrollable container
            let curr = target;
            while (curr && curr !== document.body && curr !== document.documentElement) {
                if (curr.scrollWidth > curr.clientWidth + 5) {
                    const style = window.getComputedStyle(curr);
                    const overflowX = style.overflowX;
                    if (overflowX === 'auto' || overflowX === 'scroll') {
                        touchState.current.startX = 0;
                        return;
                    }
                }
                curr = curr.parentElement;
            }

            touchState.current.startX = e.touches[0].clientX;
            touchState.current.startY = e.touches[0].clientY;
        };

    const handleTouchMove = (e) => {
        touchState.current.endX = e.touches[0].clientX;
        touchState.current.endY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e) => {
        const { startX, startY, endX, endY } = touchState.current;
        if (!startX || !endX) return;

        const diffX = startX - endX;
        const diffY = startY - endY;

        // Detect intentional horizontal swipe (min 75px threshold, strictly horizontal to avoid scroll bleed)
        if (Math.abs(diffX) > 75 && Math.abs(diffX) > Math.abs(diffY) * 2.0) {
            const direction = diffX > 0 ? 'left' : 'right';

            const swipeEvent = new CustomEvent('app-swipe', { detail: { direction }, cancelable: true });
            window.dispatchEvent(swipeEvent);
            
            // If the sub-component didn't intercept the swipe, handle main tabs
            if (!swipeEvent.defaultPrevented) {
                const tabs = ['home', 'discover', 'study', 'connect', 'profile'];
                const currentIndex = tabs.indexOf(activeTab);
                
                if (direction === 'left' && currentIndex < tabs.length - 1) {
                    setActiveTab(tabs[currentIndex + 1]);
                } else if (direction === 'right' && currentIndex > 0) {
                    setActiveTab(tabs[currentIndex - 1]);
                }
            }
        }
        touchState.current = { startX: 0, startY: 0, endX: 0, endY: 0 };
    };

    return { handleTouchStart, handleTouchMove, handleTouchEnd };
};