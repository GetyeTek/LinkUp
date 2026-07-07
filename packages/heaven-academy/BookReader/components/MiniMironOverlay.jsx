import React, { useState, useEffect, useRef } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './MiniMironOverlay.css';

const MiniMironOverlay = ({ textContext, onClose }) => {
    const { shell } = usePlatform();
    const [miniMessages, setMiniMessages] = useState([]);
    const [isMiniTyping, setIsMiniTyping] = useState(false);
    const [miniInput, setMiniInput] = useState('');
    const miniFlowRef = useRef(null);

    // Auto-populate thread when passage context is locked
    useEffect(() => {
        if (textContext) {
            setMiniMessages([
                { id: 1, side: 'user', text: textContext },
                { id: 2, side: 'miron', thought: "Synthesizing synced literature node...", text: `I have mapped this text, Alex. Thermodynamics dictate deep constraints here. What specific variables shall we unpack?` }
            ]);
        }
    }, [textContext]);

    // Keep mini-thread scrolled to bottom
    useEffect(() => {
        if (miniFlowRef.current) {
            miniFlowRef.current.scrollTo({ top: miniFlowRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [miniMessages, isMiniTyping]);

    const handleMiniSend = () => {
        if (!miniInput.trim()) return;
        const userMsg = { id: Date.now(), side: 'user', text: miniInput };
        setMiniMessages(prev => [...prev, userMsg]);
        setMiniInput('');
        setIsMiniTyping(true);

        setTimeout(() => {
            setIsMiniTyping(false);
            setMiniMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: "Resolving conceptual references...",
                text: "That is an elegant question. This correlation heavily affects the entropy thresholds we charted in the previous page. Let me display the relation."
            }]);
        }, 1800);
    };

    const handleMiniExpand = () => {
        shell.openMiron(textContext);
        onClose();
    };

    return (
        <div className="mini-miron-overlay" onTouchStart={(e) => e.stopPropagation()}>
            <header className="mini-miron-header">
                <div className="mini-miron-title">Miron Passage Sync</div>
                <div className="mini-miron-actions">
                    <button className="icon-button" style={{color: 'white', opacity: 0.6, width: '32px', height: '32px', fontSize: '1rem'}} onClick={handleMiniExpand} title="Expand to Full Chat">
                        <i className="fa-solid fa-expand"></i>
                    </button>
                    <button className="icon-button" style={{color: 'white', opacity: 0.6, width: '32px', height: '32px', fontSize: '1rem'}} onClick={onClose} title="Dismiss">
                        <i className="fa-solid fa-times"></i>
                    </button>
                </div>
            </header>
            <main className="mini-miron-flow" ref={miniFlowRef}>
                {miniMessages.map((m) => (
                    <div key={m.id} className={`mini-bubble-wrap ${m.side}`}>
                        {m.side === 'miron' && m.thought && (
                            <span className="thought-trace-serif" style={{fontSize: '0.75rem', marginBottom: '2px'}}>{m.thought}</span>
                        )}
                        <div className="mini-bubble">
                            {m.text}
                        </div>
                    </div>
                ))}
                {isMiniTyping && (
                    <div className="mini-bubble-wrap miron">
                        <div className="typing-indicator-lux" style={{padding: '0.6rem 1.1rem', borderRadius: '18px'}}>
                            <div className="typing-dot-lux"></div>
                            <div className="typing-dot-lux"></div>
                            <div className="typing-dot-lux"></div>
                        </div>
                    </div>
                )}
            </main>
            <footer className="mini-miron-input-wrapper">
                <div className="mini-dock">
                    <input 
                        type="text" 
                        placeholder="Consult the sync..." 
                        value={miniInput}
                        onChange={(e) => setMiniInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleMiniSend()}
                    />
                    <button className="mini-send-btn" onClick={handleMiniSend}>
                        <i className="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default MiniMironOverlay;