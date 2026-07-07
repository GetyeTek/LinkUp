import { useRef } from 'react';

export const useGlobalSwipe = (activeTab, setActiveTab) => {
    const touchState = useRef({ startX: 0, startY: 0, endX: 0, endY: 0 });

    const handleTouchStart = (e) => {
        // Ignore swipes originating from horizontal scroll areas to prevent conflict
        if (e.target.closest('.priority-scroll-wrapper') || e.target.closest('.dashboard-scroll-wrapper') || e.target.closest('.filter-pills') || e.target.closest('.question-nav-strip')) {
            touchState.current.startX = 0;
            return;
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