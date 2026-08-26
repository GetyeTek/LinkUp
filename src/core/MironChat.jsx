import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'https://esm.sh/marked';
import { invokeMiron } from '../config/api.js';
import { supabase, getComponent, usePlatform, telemetry } from '@linkup-platform/sdk-core';
import DOMPurify from 'dompurify';
import InteractiveBoard from './components/InteractiveBoard.jsx';
import InlineBoardTrigger from './components/InlineBoardTrigger.jsx';
import InlineChatQuiz from './components/InlineChatQuiz.jsx';
import MironThreadSidebar from './components/MironThreadSidebar.jsx';
import './MironChat.css';

const MironChat = ({ onClose, initialContext }) => {
    const { sessionUser } = usePlatform();
    const [avatarError, setAvatarError] = useState(false);
    const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";

    // Multi-Thread States
    const [threads, setThreads] = useState([]);
    const [activeThread, setActiveThread] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(true);
    const [activeBoardPayload, setActiveBoardPayload] = useState(null);
    const flowRef = useRef(null);

    // Track Dwell Time in Telemetry
    useEffect(() => {
        telemetry.switchFeature('miron');
        return () => telemetry.restorePreviousFeature();
    }, []);

    const [copiedId, setCopiedId] = useState(null);

    // 1. Fetch Threads on Mount (Greets on Clean Canvas by Default)
    useEffect(() => {
        if (!sessionUser?.id) return;

        const initThreads = async () => {
            try {
                const { data, error } = await supabase
                    .from('miron_threads')
                    .select('*')
                    .eq('user_id', sessionUser.id)
                    .order('is_pinned', { ascending: false })
                    .order('last_message_at', { ascending: false });

                if (error) throw error;
                if (data) setThreads(data);

                if (initialContext) {
                    // If explicitly opened with a textbook highlight, start a contextual session
                    await createNewThread("Passage Review", null, initialContext);
                } else {
                    // Mount directly onto the fresh greeting canvas
                    setActiveThread(null);
                    setMessages([]);
                    setIsLoadingMessages(false);
                }
            } catch (err) {
                console.error("[MironChat] Thread init error:", err);
                setIsLoadingMessages(false);
            }
        };

        initThreads();
    }, [sessionUser?.id]);

    const handleCopyMessage = (msgId, rawText) => {
        if (!rawText) return;
        const cleanText = rawText
            .replace(/\[SNAPSHOT_\d+\]/gi, '')
            .replace(/\[QUIZ_\d+\]/gi, '')
            .replace(/\[BOARD_[a-zA-Z0-9_\-]+\]/gi, '')
            .trim();

        navigator.clipboard.writeText(cleanText);
        setCopiedId(msgId);
        if (navigator.vibrate) navigator.vibrate(20);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // 2. Load Messages for Active Thread
    const selectThread = async (thread) => {
        setActiveThread(thread);
        setIsLoadingMessages(true);
        try {
            const { data, error } = await supabase
                .from('miron_messages')
                .select('*')
                .eq('thread_id', thread.id)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setMessages((data || []).map(m => ({
                id: m.id,
                side: m.role,
                text: m.text,
                thought: m.thought_process,
                snapshots: m.snapshots,
                quizzes: m.quizzes,
                ui_command: m.ui_command
            })));
        } catch (err) {
            console.error("[MironChat] Messages fetch error:", err);
        } finally {
            setIsLoadingMessages(false);
        }
    };

    // 3. Create New Thread Action
    const createNewThread = async (title = "New Conversation", courseCode = null, passage = null) => {
        if (!sessionUser?.id) return;
        setIsLoadingMessages(true);
        try {
            const { data, error } = await supabase
                .from('miron_threads')
                .insert({
                    user_id: sessionUser.id,
                    title,
                    course_code: courseCode,
                    context_passage: passage
                })
                .select()
                .single();

            if (error) throw error;

            setThreads(prev => [data, ...prev]);
            setActiveThread(data);
            
            const initialMessages = [];
            if (passage) {
                const userInitialText = `Regarding this passage: "${passage}"`;
                const { data: initialMsg } = await supabase
                    .from('miron_messages')
                    .insert({
                        thread_id: data.id,
                        user_id: sessionUser.id,
                        role: 'user',
                        text: userInitialText
                    })
                    .select()
                    .single();

                if (initialMsg) {
                    initialMessages.push({
                        id: initialMsg.id,
                        side: 'user',
                        text: userInitialText
                    });
                }
            }
            setMessages(initialMessages);
        } catch (err) {
            console.error("[MironChat] Create thread error:", err);
        } finally {
            setIsLoadingMessages(false);
        }
    };

    // 4. Delete Thread Action
    const deleteThread = async (threadId) => {
        try {
            await supabase.from('miron_threads').delete().eq('id', threadId);
            setThreads(prev => {
                const filtered = prev.filter(t => t.id !== threadId);
                if (activeThread?.id === threadId) {
                    if (filtered.length > 0) {
                        selectThread(filtered[0]);
                    } else {
                        createNewThread();
                    }
                }
                return filtered;
            });
        } catch (err) {
            console.error("[MironChat] Delete thread error:", err);
        }
    };

    // Auto-Scroll to Bottom
    useEffect(() => {
        if (flowRef.current) {
            flowRef.current.scrollTo({
                top: flowRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages, isTyping]);

    const sendMessage = async (textToSend) => {
        if (!textToSend.trim() || isTyping) return;

        let currentThread = activeThread;
        const tempId = `temp-${Date.now()}`;
        const userMsg = { id: tempId, side: 'user', text: textToSend };
        
        // Optimistic UI Append
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        // Lazy Thread Creation on first message send
        if (!currentThread) {
            const dynamicTitle = textToSend.length > 35 ? textToSend.slice(0, 35).trim() + '...' : textToSend;
            try {
                const { data: newThread, error: threadErr } = await supabase
                    .from('miron_threads')
                    .insert({
                        user_id: sessionUser.id,
                        title: dynamicTitle,
                        context_passage: initialContext || null
                    })
                    .select()
                    .single();

                if (threadErr) throw threadErr;
                currentThread = newThread;
                setActiveThread(newThread);
                setThreads(prev => [newThread, ...prev]);
            } catch (e) {
                console.error("[MironChat] Failed to lazily create thread:", e);
            }
        } else {
            supabase.from('miron_threads')
                .update({ last_message_at: new Date().toISOString() })
                .eq('id', currentThread.id);
        }

        const currentThreadId = currentThread?.id;

        // 1. Insert User Message to Database
        let dbUserMsgId = tempId;
        if (currentThreadId) {
            try {
                const { data: savedUserMsg } = await supabase
                    .from('miron_messages')
                    .insert({
                        thread_id: currentThreadId,
                        user_id: sessionUser.id,
                        role: 'user',
                        text: textToSend
                    })
                    .select()
                    .single();
                if (savedUserMsg) dbUserMsgId = savedUserMsg.id;
            } catch (e) {
                console.error("Failed to persist user message:", e);
            }
        }

        // 2. Call Miron Edge Function
        try {
            const data = await invokeMiron({
                prompt: textToSend,
                history: messages.slice(-10),
                context: currentThread?.context_passage || initialContext
            });

            const thoughtText = data.thoughts && data.thoughts.length > 0 
                ? data.thoughts.join(" | ") 
                : "Synthesizing response...";

            let savedAiMsg = null;
            if (currentThreadId) {
                const mironMsgPayload = {
                    thread_id: currentThreadId,
                    user_id: sessionUser.id,
                    role: 'miron',
                    text: data.response,
                    thought_process: thoughtText,
                    snapshots: data.snapshots || null,
                    quizzes: data.quizzes || null,
                    ui_command: data.ui_command || null
                };

                const { data: aiMsgData } = await supabase
                    .from('miron_messages')
                    .insert(mironMsgPayload)
                    .select()
                    .single();
                savedAiMsg = aiMsgData;
            }

            setMessages(prev => [
                ...prev.map(m => m.id === tempId ? { ...m, id: dbUserMsgId } : m),
                {
                    id: savedAiMsg?.id || Date.now() + 1,
                    side: 'miron',
                    thought: thoughtText,
                    text: data.response,
                    snapshots: data.snapshots,
                    quizzes: data.quizzes,
                    ui_command: data.ui_command
                }
            ]);

            if (data.ui_command && (data.ui_command.action === 'draw_flow' || data.ui_command.action === 'draw')) {
                setActiveBoardPayload(data.ui_command);
            }

        } catch (error) {
            console.error("Miron Communication Error:", error);
            setMessages(prev => [
                ...prev.map(m => m.id === tempId ? { ...m, id: dbUserMsgId } : m),
                {
                    id: Date.now() + 1,
                    side: 'miron',
                    thought: "Connection error...",
                    text: "I apologize, but I am currently having trouble processing your request. Please try asking again in a moment."
                }
            ]);
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

            <MironThreadSidebar 
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                threads={threads}
                activeThreadId={activeThread?.id}
                onSelectThread={selectThread}
                onNewThread={() => {
                    setActiveThread(null);
                    setMessages([]);
                    setIsLoadingMessages(false);
                }}
                onDeleteThread={deleteThread}
            />

            <header className="athena-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button className="athena-close" onClick={onClose} style={{ background: 'transparent' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <button className="athena-sidebar-toggle" onClick={() => setIsSidebarOpen(true)} title="Chat History">
                        <i className="fas fa-bars-staggered"></i>
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
                        <h1 className="athena-title">{activeThread?.title || 'Miron'}</h1>
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

                      <rect x="2" y="2" width="96" height="96" rx="26" fill="url(#miron-live-pulse-bg)" stroke="#1e293b" strokeWidth="2.5" />

                      <path d="M 22,50 C 22,34.5 34.5,22 50,22 C 65.5,22 78,34.5 78,50 C 78,65.5 65.5,78 50,78 C 45,78 40,76.5 36,74 L 18,78 L 22,64 C 20.7,60 22,55 22,50 Z" 
                            fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />

                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                            fill="none" stroke="#00f0ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" filter="url(#miron-neon-glow)" />

                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                            fill="none" stroke="url(#miron-neon-cyan-grad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                      <circle cx="35" cy="37" r="3.5" fill="#ef4444" filter="url(#miron-red-dot-glow)" />
                      <text x="57" y="41" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="12" letterSpacing="1" textAnchor="middle">LIVE</text>
                    </svg>
                </button>
            </header>

            {activeBoardPayload && (
                <InteractiveBoard 
                    payload={activeBoardPayload} 
                    onClose={() => setActiveBoardPayload(null)} 
                />
            )}

            <main className="athena-flow" ref={flowRef}>
                {isLoadingMessages ? (
                    <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--accent-teal)' }}>
                        <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="athena-welcome-container">
                        <div className="athena-welcome-logo">
                            <i className="fa-solid fa-sparkles"></i>
                        </div>
                        <h2>How can I help you with your courses?</h2>
                        <p>Ask Miron about formulas, textbook concepts, or assignments.</p>
                    </div>
                ) : (
                    messages.map(m => (
                        <div key={m.id} className={`chat-node ${m.side}`}>
                            {m.side === 'miron' && m.thought && (
                                <span className="miron-thought">{m.thought}</span>
                            )}
                            <div className="athena-bubble">
                                {m.text.split(/(\[SNAPSHOT_\d+\]|\[QUIZ_\d+\]|\[BOARD_[a-zA-Z0-9_\-]+\])/g).map((part, idx) => {
                                    const boardMatch = part.match(/\[BOARD_([a-zA-Z0-9_\-]+)\]/);
                                    if (boardMatch) {
                                        return <InlineBoardTrigger key={idx} boardId={boardMatch[1]} onOpen={setActiveBoardPayload} />;
                                    }

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
                                                        if (Renderer) return Renderer(b, i, { bookTitle: snap.book_title || snap.course_code });
                                                        return <div key={i} style={{color: 'red'}}>[Rendering Engine Disconnected]</div>;
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    }
                                    
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
                            <div className="athena-bubble-actions">
                                <button 
                                    className={`athena-copy-btn ${copiedId === m.id ? 'copied' : ''}`}
                                    onClick={() => handleCopyMessage(m.id, m.text)}
                                    title="Copy message"
                                >
                                    <i className={`fa-${copiedId === m.id ? 'solid fa-check' : 'regular fa-copy'}`}></i>
                                    <span>{copiedId === m.id ? 'Copied' : 'Copy'}</span>
                                </button>
                            </div>
                        </div>
                    ))
                )}
                
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
        </div>
    );
};

export default MironChat;