export const useDraggable = (ref) => {
    const handleDragStart = (e) => {
        const isTouch = e.type === 'touchstart';
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        
        if (!ref.current) return;

        if (navigator.vibrate) {
            try { navigator.vibrate(12); } catch (err) {}
        }
        
        const rect = ref.current.getBoundingClientRect();
        
        const startX = clientX;
        const startY = clientY;
        const startLeft = rect.left;
        const startTop = rect.top;

        const onDragMove = (moveEvt) => {
            const moveTouch = moveEvt.type === 'touchmove';
            const moveX = moveTouch ? moveEvt.touches[0].clientX : moveEvt.clientX;
            const moveY = moveTouch ? moveEvt.touches[0].clientY : moveEvt.clientY;
            
            const dx = moveX - startX;
            const dy = moveY - startY;
            
            if (ref.current) {
                ref.current.style.left = `${startLeft + dx}px`;
                ref.current.style.top = `${startTop + dy}px`;
            }
            
            if (moveEvt.cancelable) moveEvt.preventDefault();
            moveEvt.stopPropagation();
        };

        const onDragEnd = () => {
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchmove', onDragMove);
            document.removeEventListener('touchend', onDragEnd);
        };

        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
        
        e.stopPropagation();
    };

    return handleDragStart;
};