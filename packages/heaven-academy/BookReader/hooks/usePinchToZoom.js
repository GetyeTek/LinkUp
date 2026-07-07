import { useEffect, useRef } from 'react';

export const usePinchToZoom = (viewportRef, scrollContainerRef, layerRef, currentScale, minScale, cachedDocHeight, baseCanvasWidth, setContextMenu) => {
    const pinchState = useRef({
        isPinching: false,
        initialDist: 0,
        initialScale: 1,
        viewportLeft: 0,
        viewportTop: 0,
        docHeight: 0,
        docX: 0,
        docY: 0
    });

    useEffect(() => {
        const viewport = viewportRef.current;
        const container = scrollContainerRef.current;
        const layer = layerRef.current;
        if (!viewport || !container || !layer) return;

        let ticking = false;

        const onTouchStart = (e) => {
            if (e.target.closest('#ui-layer') || e.target.closest('.fab-container') || e.target.closest('.reader-ctx-menu')) return;

            if (e.touches.length > 1) {
                window.getSelection()?.removeAllRanges();
                if (setContextMenu) setContextMenu(null);
            }

            if (e.touches.length === 2) {
                e.preventDefault(); 
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                
                const cx = (t1.clientX + t2.clientX) / 2;
                const cy = (t1.clientY + t2.clientY) / 2;
                
                const rect = viewport.getBoundingClientRect();
                const pinchX = cx - rect.left;
                const pinchY = cy - rect.top;

                pinchState.current = {
                    isPinching: true,
                    initialDist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
                    initialScale: currentScale.current,
                    viewportLeft: rect.left,
                    viewportTop: rect.top,
                    docHeight: cachedDocHeight.current,
                    docX: (pinchX + viewport.scrollLeft) / currentScale.current,
                    docY: (pinchY + viewport.scrollTop) / currentScale.current
                };
            }
        };

        const onTouchMove = (e) => {
            if (e.touches.length === 2 && pinchState.current.isPinching) {
                e.preventDefault(); 
                
                if (!ticking) {
                    const t1 = e.touches[0];
                    const t2 = e.touches[1];
                    const cx = (t1.clientX + t2.clientX) / 2;
                    const cy = (t1.clientY + t2.clientY) / 2;
                    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

                    requestAnimationFrame(() => {
                        const state = pinchState.current;
                        const ratio = dist / state.initialDist;
                        let newScale = state.initialScale * ratio;
                        newScale = Math.max(minScale.current, Math.min(newScale, 4.0));

                        const pinchX = cx - state.viewportLeft;
                        const pinchY = cy - state.viewportTop;

                        container.style.width = `${baseCanvasWidth * newScale}px`;
                        container.style.height = `${state.docHeight * newScale}px`;
                        layer.style.transform = `scale(${newScale})`;
                        currentScale.current = newScale;

                        viewport.scrollLeft = (state.docX * newScale) - pinchX;
                        viewport.scrollTop = (state.docY * newScale) - pinchY;

                        ticking = false;
                    });
                    ticking = true;
                }
            }
        };

        const onTouchEnd = (e) => {
            if (e.touches.length < 2) pinchState.current.isPinching = false;
        };

        viewport.addEventListener('touchstart', onTouchStart, { passive: false });
        viewport.addEventListener('touchmove', onTouchMove, { passive: false });
        viewport.addEventListener('touchend', onTouchEnd);
        
        return () => {
            viewport.removeEventListener('touchstart', onTouchStart);
            viewport.removeEventListener('touchmove', onTouchMove);
            viewport.removeEventListener('touchend', onTouchEnd);
        };
    }, [viewportRef, scrollContainerRef, layerRef, currentScale, minScale, cachedDocHeight, baseCanvasWidth, setContextMenu]);

    return pinchState;
};