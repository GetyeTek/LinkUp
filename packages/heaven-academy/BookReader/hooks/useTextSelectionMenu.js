import { useEffect } from 'react';

export const useTextSelectionMenu = (viewportRef, pinchState, setContextMenu) => {
    useEffect(() => {
        let debounceTimer;

        const checkSelection = () => {
            if (pinchState.current?.isPinching) return;
            
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) {
                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return;
                    
                    const menuWidth = 280; 
                    const menuHeight = 140; 
                    const verticalGap = 65; 
                    
                    let x = rect.left + (rect.width / 2) - (menuWidth / 2);
                    let y = rect.top - menuHeight - verticalGap; 
                    
                    x = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
                    
                    if (rect.height > window.innerHeight - 150) {
                        y = (window.innerHeight - menuHeight) / 2;
                    } else if (y < 60) {
                        y = rect.bottom + verticalGap;
                        if (y + menuHeight > window.innerHeight - 20) {
                            y = (window.innerHeight - menuHeight) / 2;
                        }
                    }
                    
                    setContextMenu({ x, y, text: selection.toString() });
                } catch(e) {}
            }
        };

        const handleSelectionChange = () => {
            setContextMenu(prev => prev !== null ? null : prev);
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(checkSelection, 500);
        };

        const handleScrollOrTouch = (e) => {
            if (e && e.target && e.target.closest && e.target.closest('.reader-ctx-menu')) return;
            setContextMenu(prev => prev !== null ? null : prev);
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('touchstart', handleScrollOrTouch, { passive: true });
        
        const viewport = viewportRef.current;
        if (viewport) {
            viewport.addEventListener('scroll', handleScrollOrTouch, { passive: true });
        }

        return () => { 
            clearTimeout(debounceTimer); 
            document.removeEventListener('selectionchange', handleSelectionChange); 
            document.removeEventListener('touchstart', handleScrollOrTouch);
            if (viewport) {
                viewport.removeEventListener('scroll', handleScrollOrTouch);
            }
        };
    }, [viewportRef, pinchState, setContextMenu]);
};