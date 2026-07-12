import React, { useState, useRef } from 'react';
import './FloatingLiveOrb.css';

const FloatingLiveOrb = ({ hostAvatar, hostId, isConnected, onClick }) => {
    const orbRef = useRef(null);
    const [pos, setPos] = useState({ x: window.innerWidth - 96, y: window.innerHeight - 240 });
    const dragStart = useRef(null);

    const handlePointerDown = (e) => {
        e.target.setPointerCapture(e.pointerId);
        dragStart.current = { 
            offsetX: e.clientX - pos.x, 
            offsetY: e.clientY - pos.y, 
            startX: e.clientX,
            startY: e.clientY,
            isDragging: false 
        };
    };

    const handlePointerMove = (e) => {
        if (!dragStart.current) return;
        
        const dx = Math.abs(e.clientX - dragStart.current.startX);
        const dy = Math.abs(e.clientY - dragStart.current.startY);
        
        // Touch jitter deadzone: Must move more than 8 pixels to be considered a drag
        if (dx > 8 || dy > 8) {
            dragStart.current.isDragging = true;
        }

        if (dragStart.current.isDragging) {
            const newX = e.clientX - dragStart.current.offsetX;
            const newY = e.clientY - dragStart.current.offsetY;
            setPos({ 
                x: Math.max(10, Math.min(newX, window.innerWidth - 86)), 
                y: Math.max(50, Math.min(newY, window.innerHeight - 100)) 
            });
        }
    };

    const handlePointerUp = (e) => {
        if (dragStart.current && !dragStart.current.isDragging) {
            onClick();
        }
        dragStart.current = null;
    };

    return (
        <div 
            className="floating-live-orb" 
            ref={orbRef} 
            style={{ left: pos.x, top: pos.y, display: 'flex' }}
            onPointerDown={handlePointerDown} 
            onPointerMove={handlePointerMove} 
            onPointerUp={handlePointerUp}
        >
            {isConnected && <div className="orb-pulse-ring"></div>}
            <img src={hostAvatar} className="floating-orb-host" alt="Live Host" />
            <div className="orb-expand-badge"><i className="fas fa-expand-alt"></i></div>
        </div>
    );
};

export default FloatingLiveOrb;