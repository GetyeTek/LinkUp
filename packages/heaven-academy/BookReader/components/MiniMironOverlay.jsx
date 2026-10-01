import React, { useState, useEffect, useRef } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import { invokeMiron } from '../../api.js';
import { marked } from 'https://esm.sh/marked';
import DOMPurify from 'dompurify';
import './MiniMironOverlay.css';

const renderMiniMarkdown = (txt) => {
    if (!txt) return '';
    const clean = txt
        .replace(/\[SNAPSHOT_\d+\]/gi, '')
        .replace(/\[QUIZ_\d+\]/gi, '')
        .replace(/\[BOARD_[a-zA-Z0-9_\-]+\]/gi, '')
        .replace(/\[FLASHCARD_\d+\]/gi, '');
    return DOMPurify.sanitize(marked.parse(clean), {
        USE_PROFILES: { html: true, mathMl: true, svg: true }
    });
};

const MiniMironOverlay = ({ context, textContext, onClose }) => {
    const { shell } = usePlatform();
    const ctx = context || (typeof textContext === 'string' ? { selectedText: textContext, fullPrompt: textContext } : textContext);

    const [miniMessages, setMiniMessages] = useState([]);
    const [isMiniTyping, setIsMiniTyping] = useState(false);
    const [miniInput, setMiniInput] = useState('');
    const miniFlowRef = useRef(null);
    const initializedRef = useRef(false);

    // Initial Live Inquiry to Miron with Textbook Context
    useEffect(() => {
        if (!ctx || initializedRef.current) return;
        initializedRef.current = true;

        const displayQuote = ctx.selectedText || ctx.fullPrompt || 'Selected excerpt';
        const userPrompt = ctx.fullPrompt || displayQuote;

        setMiniMessages([
            { id: 1, side: 'user', text: displayQuote }
        ]);

        setIsMiniTyping(true);

        invokeMiron({
            prompt: userPrompt,
            history: [],
            context: ctx.surroundingText || null
        }).then(data => {
            if (data?.response) {
                setMiniMessages(prev => [
                    ...prev,
                    { id: 2, side: 'miron', text: data.response }
                ]);
            }
        }).catch(err => {
            console.error('[MiniMiron] Live query failed:', err);
            setMiniMessages(prev => [
                ...prev,
                { id: 2, side: 'miron', text: 'I had trouble analyzing this passage right now. Please tap the expand button to retry in full chat.' }
            ]);
        }).finally(() => {
            setIsMiniTyping(false);
        });
    }, [ctx]);

    // Keep thread scrolled to bottom
    useEffect(() => {
        if (miniFlowRef.current) {
            miniFlowRef.current.scrollTo({ top: miniFlowRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [miniMessages, isMiniTyping]);

    const handleMiniSend = async () => {
        if (!miniInput.trim() || isMiniTyping) return;
        const queryText = miniInput.trim();
        const userMsg = { id: Date.now(), side: 'user', text: queryText };
        
        setMiniMessages(prev => [...prev, userMsg]);
        setMiniInput('');
        setIsMiniTyping(true);

        try {
            const data = await invokeMiron({
                prompt: queryText,
                history: miniMessages.slice(-8),
                context: ctx?.surroundingText || null
            });
            if (data?.response) {
                setMiniMessages(prev => [
                    ...prev,
                    { id: Date.now() + 1, side: 'miron', text: data.response }
                ]);
            }
        } catch (err) {
            console.error('[MiniMiron] Follow-up query failed:', err);
        } finally {
            setIsMiniTyping(false);
        }
    };

    const handleMiniExpand = () => {
        const promptToExpand = ctx?.fullPrompt || ctx?.selectedText || '';
        if (shell?.openMiron) {
            shell.openMiron(promptToExpand, true);
        } else {
            window.dispatchEvent(new CustomEvent('open-full-miron-chat', {
                detail: { text: promptToExpand, autoSend: true }
            }));
        }
        onClose();
    };

    const headerSub = [ctx?.bookTitle, ctx?.pageNumber ? `Page ${ctx.pageNumber}` : null].filter(Boolean).join(' • ');

    return (
        <div className="mini-miron-overlay" onTouchStart={(e) => e.stopPropagation()}>
            <header className="mini-miron-header">
                <div>
                    <div className="mini-miron-title">Miron AI Passage Sync</div>
                    {headerSub && <div className="mini-miron-meta-sub">{headerSub}</div>}
                </div>
                <div className="mini-miron-actions">
                    <button className="icon-button" style={{color: 'white', opacity: 0.8, width: '34px', height: '34px', fontSize: '1rem'}} onClick={handleMiniExpand} title="Expand to Fullscreen Miron">
                        <i className="fa-solid fa-expand"></i>
                    </button>
                    <button className="icon-button" style={{color: 'white', opacity: 0.8, width: '34px', height: '34px', fontSize: '1.1rem'}} onClick={onClose} title="Dismiss">
                        <i className="fa-solid fa-times"></i>
                    </button>
                </div>
            </header>

            <main className="mini-miron-flow" ref={miniFlowRef}>
                {miniMessages.map((m) => (
                    <div key={m.id} className={`mini-bubble-wrap ${m.side}`}>
                        <div className="mini-bubble">
                            {m.side === 'miron' ? (
                                <div dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(m.text) }} />
                            ) : (
                                m.text
                            )}
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
                        placeholder="Ask follow-up about this passage..." 
                        value={miniInput}
                        onChange={(e) => setMiniInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleMiniSend()}
                        disabled={isMiniTyping}
                    />
                    <button className="mini-send-btn" onClick={handleMiniSend} disabled={!miniInput.trim() || isMiniTyping}>
                        <i className="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default MiniMironOverlay;