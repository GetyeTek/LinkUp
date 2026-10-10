import { useEffect } from 'react';

export const useTextSelectionMenu = (viewportRef, pinchState, setContextMenu) => {
    useEffect(() => {
        let debounceTimer;

        const enforceSinglePageSelection = () => {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

            const range = selection.getRangeAt(0);
            const getNodeElement = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
            const startEl = getNodeElement(range.startContainer);
            const endEl = getNodeElement(range.endContainer);

            const startCanvas = startEl?.closest('.page-canvas');
            const endCanvas = endEl?.closest('.page-canvas');

            if (!startCanvas && !endCanvas) return;

            if (startCanvas && endCanvas && startCanvas !== endCanvas) {
                const startPageNum = parseInt(startCanvas.closest('.page-wrapper')?.getAttribute('data-page-number') || '0', 10);
                const endPageNum = parseInt(endCanvas.closest('.page-wrapper')?.getAttribute('data-page-number') || '0', 10);

                try {
                    if (endPageNum > startPageNum) {
                        range.setEnd(startCanvas, startCanvas.childNodes.length);
                    } else if (endPageNum < startPageNum) {
                        range.setStart(startCanvas, 0);
                    }
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (err) {}
            } else if (startCanvas && !endCanvas) {
                try {
                    range.setEnd(startCanvas, startCanvas.childNodes.length);
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (err) {}
            }
        };

        const checkSelection = () => {
            if (pinchState.current?.isPinching) return;
            
            enforceSinglePageSelection();
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                const text = selection.toString().trim();
                if (!text) {
                    setContextMenu(null);
                    return;
                }

                const range = selection.getRangeAt(0);
                const startEl = range.startContainer?.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer?.parentElement;
                const endEl = range.endContainer?.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer?.parentElement;

                const startCanvas = startEl?.closest('.page-canvas');
                const endCanvas = endEl?.closest('.page-canvas');

                // Strictly restrict context menu to text selected inside .page-canvas within the book viewport
                if (!startCanvas || !endCanvas || !viewportRef.current?.contains(startCanvas)) {
                    setContextMenu(null);
                    return;
                }

                try {
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
            } else {
                setContextMenu(null);
            }
        };

        const handleSelectionChange = () => {
            enforceSinglePageSelection();
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