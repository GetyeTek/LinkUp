import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'https://esm.sh/marked';
import { invokeMiron } from '../config/api.js';
import { getComponent, usePlatform } from '@linkup-platform/sdk-core';
import DOMPurify from 'dompurify';
import './MironChat.css';

import MironLiveSession from './components/MironLiveSession.jsx';
import InlineChatQuiz from './components/InlineChatQuiz.jsx';

const MironChat = ({ onClose, initialContext }) => {
    const [avatarError, setAvatarError] = useState(false);
    const [isLiveMode, setIsLiveMode] = useState(false);
    const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";
    
    useEffect(() => {
        const handleOpenLive = () => setIsLiveMode(true);
        window.addEventListener('miron:open-live-session', handleOpenLive);
        return () => window.removeEventListener('miron:open-live-session', handleOpenLive);
    }, []);

    const [messages, setMessages] = useState(() => {
        const base = [
            {
                id: 1,
                side: 'miron',
                text: "I'm monitoring your cognitive path. Let's explore.",
                thought: null
            }
        ];
        
        if (initialContext) {
            base.push({
                id: 2,
                side: 'user',
                text: `Regarding this passage: "${initialContext}"`
            });
            base.push({
                id: 3,
                side: 'miron',
                thought: "Analyzing literature node...",
                text: "Ah, yes. This relation contains a deep thermodynamic constraint. Let's dissect the mathematical properties together."
            });
        }
        return base;
    });
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const flowRef = useRef(null);

    const mironThoughts = [
        "Synthesizing knowledge nodes...",
        "Tracing cognitive patterns...",
        "Formulating elegant solutions..."
    ];

    useEffect(() => {
        if (flowRef.current) {
            flowRef.current.scrollTo({
                top: flowRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages, isTyping]);

    const sendMessage = async (textToSend) => {
        if (!textToSend.trim()) return;

        const userMsg = { id: Date.now(), side: 'user', text: textToSend };
        const currentHistory = [...messages];
        
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        try {
            const data = await invokeMiron({
                prompt: textToSend,
                history: currentHistory,
                context: initialContext
            });

            const thoughtText = data.thoughts && data.thoughts.length > 0 
                ? data.thoughts.join(" | ") 
                : "Synthesizing response...";

            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: thoughtText,
                text: data.response,
                snapshots: data.snapshots,
                quizzes: data.quizzes
            }]);

            if (data.ui_command && data.ui_command.action === 'open_page') {
                console.log("Miron instructed UI to open page:", data.ui_command);
            }

        } catch (error) {
            console.error("Miron Communication Error:", error);
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: "Connection unstable...",
                text: "My cognitive link to the mainframe encountered an anomaly. Please try asking again."
            }]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = () => {
        sendMessage(input);
        setInput('');
    };

    return (
        <div className="miron-chat-overlay">
            <div className="athena-bg"></div>

            <header className="athena-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button className="athena-close" onClick={onClose} style={{ background: 'transparent' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="athena-brand">
                        <div className="athena-orb" style={{ overflow: 'hidden' }}>
                            {!avatarError ? (
                                <img 
                                    src={mironAvatarUrl} 
                                    alt="Miron" 
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} 
                                    onError={() => setAvatarError(true)} 
                                />
                            ) : (
                                <i className="fa-solid fa-sparkles" style={{fontSize: '0.8rem'}}></i>
                            )}
                        </div>
                        <h1 className="athena-title">Miron</h1>
                    </div>
                </div>
                
                <button 
                    className="athena-live-btn"
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('miron:open-live-session'));
                    }}
                    style={{ background: 'transparent', padding: 0, border: 'none', borderRadius: 0, width: '38px', height: '38px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
                      <defs>
                        <linearGradient id="miron-live-pulse-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#0b0f19" />
                          <stop offset="100%" stopColor="#1e293b" />
                        </linearGradient>

                        <linearGradient id="miron-neon-cyan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#00f0ff" />
                          <stop offset="100%" stopColor="#0066ff" />
                        </linearGradient>

                        <filter id="miron-neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="2.5" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>

                        <filter id="miron-red-dot-glow" x="-30%" y="-30%" width="160%" height="160%">
                          <feGaussianBlur stdDeviation="1.5" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      {/* Button Container (Squircle) */}
                      <rect x="2" y="2" width="96" height="96" rx="26" fill="url(#miron-live-pulse-bg)" stroke="#1e293b" strokeWidth="2.5" />

                      {/* Background Chat Bubble Frame (Subtle outline) */}
                      <path d="M 22,50 C 22,34.5 34.5,22 50,22 C 65.5,22 78,34.5 78,50 C 78,65.5 65.5,78 50,78 C 45,78 40,76.5 36,74 L 18,78 L 22,64 C 20.7,60 22,55 22,50 Z" 
                            fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />

                      {/* Glow effect duplicate for EKG line (creates the base ambient light) */}
                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                            fill="none" stroke="#00f0ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" filter="url(#miron-neon-glow)" />

                      {/* Crisp Main ECG Heartbeat Line (Zigzag) */}
                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                            fill="none" stroke="url(#miron-neon-cyan-grad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                      {/* Active "LIVE" Red Status Indicator Dot */}
                      <circle cx="35" cy="37" r="3.5" fill="#ef4444" filter="url(#miron-red-dot-glow)" />

                      {/* Modern bold status text */}
                      <text x="57" y="41" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="12" letterSpacing="1" textAnchor="middle">LIVE</text>
                    </svg>
                </button>
            </header>

            <main className="athena-flow" ref={flowRef}>
                {messages.map(m => (
                                        <div key={m.id} className={`chat-node ${m.side}`}>
                        {m.side === 'miron' && m.thought && (
                            <span className="miron-thought">{m.thought}</span>
                        )}
                        <div className="athena-bubble">
                            {m.text.split(/(\[SNAPSHOT_\d+\]|\[QUIZ_\d+\])/g).map((part, idx) => {
                                const quizMatch = part.match(/\[QUIZ_(\d+)\]/);
                                if (quizMatch) {
                                    const quizId = parseInt(quizMatch[1], 10);
                                    const quiz = m.quizzes?.find(q => q.id === quizId);
                                    if (!quiz) return <span key={idx} style={{color:'red'}}>[Quiz Error]</span>;
                                    return <InlineChatQuiz key={idx} quiz={quiz} onSubmit={sendMessage} />;
                                }

                                const snapMatch = part.match(/\[SNAPSHOT_(\d+)\]/);
                                if (snapMatch) {
                                    const snapId = parseInt(snapMatch[1], 10);
                                    const snap = m.snapshots?.find(s => s.id === snapId);
                                    if (!snap) return null;
                                    
                                    return (
                                        <div key={idx} className="inline-chat-snapshot">
                                            <div className="snapshot-topbar">
                                                <span><i className="fas fa-file-pdf"></i> {snap.book_title || snap.course_code}</span>
                                                <span>Page {snap.page_number}</span>
                                            </div>
                                            <div className="snapshot-content">
                                                {snap.blocks.map((b, i) => {
                                                    const Renderer = getComponent('book-block-renderer');
                                                    if (Renderer) return Renderer(b, i, {});
                                                    return <div key={i} style={{color: 'red'}}>[Rendering Engine Disconnected]</div>;
                                                })}
                                            </div>
                                        </div>
                                    );
                                }
                                
                                // Render Markdown Text safely via Marked.js
                                if (!part.trim()) return null;
                                return (
                                    <div 
                                        key={idx} 
                                        className="miron-markdown-chunk"
                                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(part)) }} 
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
                
                {isTyping && (
                    <div className="chat-node miron">
                        <div className="athena-typing">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                        </div>
                    </div>
                )}
            </main>

            <footer className="athena-input-area">
                <div className="capsule-dock">
                    <input 
                        type="text" 
                        placeholder="Message Miron..." 
                        value={input} 
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="capsule-send" onClick={handleSend}>
                        <i className="fa-solid fa-arrow-up"></i>
                    </button>
                </div>
            </footer>
            
            {isLiveMode && <MironLiveSession onClose={() => setIsLiveMode(false)} mironAvatarUrl={mironAvatarUrl} />}
        </div>
    );
};

export default MironChat;