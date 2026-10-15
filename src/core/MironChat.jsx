import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'https://esm.sh/marked';
import katex from 'https://esm.sh/katex@0.16.11';
import { invokeMiron, invokeMironStream } from '../config/api.js';
import { supabase, getComponent, usePlatform, telemetry } from '@linkup-platform/sdk-core';
import DOMPurify from 'dompurify';

const renderMironMarkdown = (content) => {
    if (!content) return "";
    const mathMap = new Map();
    let counter = 0;

    // 1. Extract and render Display Equations ($...$ and \[...\])
    let processed = content.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (match, p1, p2) => {
        const math = p1 || p2;
        const key = `@@@MATH_DISP_${counter++}@@@`;
        try {
            const html = katex.renderToString(math.trim(), { displayMode: true, throwOnError: false, strict: false });
            mathMap.set(key, html);
            return key;
        } catch (e) {
            return match;
        }
    });

    // 2. Extract and render Inline Math ($...$ and \(...\))
    processed = processed.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)/g, (match, p1, p2) => {
        const math = p1 || p2;
        const key = `@@@MATH_INL_${counter++}@@@`;
        try {
            const html = katex.renderToString(math.trim(), { displayMode: false, throwOnError: false, strict: false });
            mathMap.set(key, html);
            return key;
        } catch (e) {
            return match;
        }
    });

    // 3. Convert Markdown to HTML
    let html = marked.parse(processed);

    // 4. Inject rendered KaTeX HTML equations back
    mathMap.forEach((katexHtml, key) => {
        html = html.split(key).join(katexHtml);
    });

    // 5. Sanitize HTML
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['style', 'class', 'aria-hidden']
    });
};
import InteractiveBoard from './components/InteractiveBoard.jsx';
import InlineBoardTrigger from './components/InlineBoardTrigger.jsx';
import InlineChatQuiz from './components/InlineChatQuiz.jsx';
import InlineChatCard from './components/InlineChatCard.jsx';
import MironThreadSidebar from './components/MironThreadSidebar.jsx';
import './MironChat.css';

const MironMessageNode = React.memo(({ m, copiedId, handleCopyMessage, handleInlineCardRate, sendMessage, setActiveBoardPayload }) => {
    let flashcardDeckRendered = false;
    const parts = (m.text || '').split(/(\[SNAPSHOT_\d+\]|\[QUIZ_\d+\]|\[BOARD_[a-zA-Z0-9_\-]+\]|\[FLASHCARD_\d+\])/g);

    const renderedElements = parts.map((part, idx) => {
        const boardMatch = part.match(/\[BOARD_([a-zA-Z0-9_\-]+)\]/);
        if (boardMatch) {
            return <InlineBoardTrigger key={idx} boardId={boardMatch[1]} onOpen={setActiveBoardPayload} />;
        }

        const quizMatch = part.match(/\[QUIZ_(\d+)\]/);
        if (quizMatch) {
            const quizId = parseInt(quizMatch[1], 10);
            const quiz = m.quizzes?.find(q => q.id === quizId);
            if (!quiz) return null;
            return <InlineChatQuiz key={idx} quiz={quiz} onSubmit={sendMessage} />;
        }

        const cardMatch = part.match(/\[FLASHCARD_\d+\]/);
        if (cardMatch) {
            if (!flashcardDeckRendered && m.flashcards && m.flashcards.length > 0) {
                flashcardDeckRendered = true;
                return <InlineChatCard key={idx} cards={m.flashcards} onRate={handleInlineCardRate} />;
            }
            return null;
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
                dangerouslySetInnerHTML={{ __html: renderMironMarkdown(part) }} 
            />
        );
    });

    if (m.isBroke) {
        return (
            <div className={`chat-node ${m.side}`}>
                <div className="miron-credit-out-card">
                    <div className="mcoc-header">
                        <div className="mcoc-crown-badge">
                            <i className="fa-solid fa-crown"></i>
                        </div>
                        <span className="mcoc-title">LinkUp Credits Exhausted</span>
                    </div>
                    <p className="mcoc-text">{m.text}</p>
                    <button 
                        className="mcoc-upgrade-btn" 
                        onClick={() => window.dispatchEvent(new CustomEvent('open-premium-modal'))}
                    >
                        <i className="fa-solid fa-crown"></i>
                        <span>Upgrade to LinkUp Gold</span>
                        <i className="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`chat-node ${m.side}`}>
            <div className="athena-bubble">
                {m.status && (
                    <div className="miron-streaming-status">
                        <i className="fa-solid fa-gear fa-spin"></i>
                        <span>{m.status}</span>
                    </div>
                )}
                {renderedElements}
                {m.isStreaming && (
                    <span className="streaming-cursor"></span>
                )}
                {!flashcardDeckRendered && m.flashcards && m.flashcards.length > 0 && (
                    <InlineChatCard cards={m.flashcards} onRate={handleInlineCardRate} />
                )}
            </div>
            {!m.isStreaming && m.text && (
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
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    const wasCopied = prevProps.copiedId === prevProps.m.id;
    const isCopied = nextProps.copiedId === nextProps.m.id;
    return (
        prevProps.m.id === nextProps.m.id &&
        prevProps.m.text === nextProps.m.text &&
        prevProps.m.status === nextProps.m.status &&
        prevProps.m.isStreaming === nextProps.m.isStreaming &&
        wasCopied === isCopied
    );
});

const MironChat = ({ onClose, initialContext, autoSend = false }) => {
    const autoSentRef = useRef(false);
    const { sessionUser, user: userProfile, updateUserProfile } = usePlatform();
    const [avatarError, setAvatarError] = useState(false);
    const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";

    // Multi-Thread States
    // Multi-Thread States
    const [threads, setThreads] = useState([]);
    const [activeThread, setActiveThread] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(true);
    const [activeBoardPayload, setActiveBoardPayload] = useState(null);
    const flowRef = useRef(null);
    const scrollAnchorRef = useRef(null);
    const isAutoScrollEnabled = useRef(true);
    const touchStartY = useRef(0);

    // Track Dwell Time in Telemetry
    useEffect(() => {
        telemetry.switchFeature('miron');
        return () => telemetry.restorePreviousFeature();
    }, []);

    const [copiedId, setCopiedId] = useState(null);
    const [isThreadCopied, setIsThreadCopied] = useState(false);

    // Auto-Send query from Home Dock
    useEffect(() => {
        if (autoSend && initialContext && !autoSentRef.current && !isTyping) {
            autoSentRef.current = true;
            sendMessage(initialContext);
        }
    }, [autoSend, initialContext, isTyping]);

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
                if (data) {
                    const sortedData = data.sort((a, b) => {
                        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
                        const timeA = new Date(a.last_message_at || a.created_at).getTime();
                        const timeB = new Date(b.last_message_at || b.created_at).getTime();
                        return timeB - timeA;
                    });
                    setThreads(sortedData);
                }

                if (initialContext) {
                    const titleMatch = initialContext.match(/\[Textbook Inquiry:\s*([^\|\]]+)/i);
                    const threadTitle = titleMatch ? titleMatch[1].trim() : "Textbook Study";
                    if (autoSend) {
                        await createNewThread(threadTitle, null, null);
                    } else {
                        await createNewThread(threadTitle, null, initialContext);
                    }
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

    const handleCopyFullThread = () => {
        if (!messages || messages.length === 0) return;
        const title = activeThread?.title || "Miron Study Session";
        const transcript = messages
            .filter(m => m.text && !m.text.startsWith('[Quiz Submission:'))
            .map(m => {
                const sender = m.side === 'user' ? '👤 User' : '✨ Miron';
                const cleanText = m.text
                    .replace(/\[SNAPSHOT_\d+\]/gi, '[Textbook Snapshot]')
                    .replace(/\[QUIZ_\d+\]/gi, '[Interactive Quiz]')
                    .replace(/\[BOARD_[a-zA-Z0-9_\-]+\]/gi, '[Visual Board Diagram]')
                    .replace(/\[FLASHCARD_\d+\]/gi, '[Flashcards]')
                    .trim();
                return `${sender}:\n${cleanText}`;
            })
            .join('\n\n---\n\n');

        const fullExport = `=== Thread: ${title} ===\n\n${transcript}\n\n=== End of Thread ===`;
        navigator.clipboard.writeText(fullExport);
        setIsThreadCopied(true);
        if (navigator.vibrate) navigator.vibrate(25);
        setTimeout(() => setIsThreadCopied(false), 2000);
    };

    const handleInlineCardRate = async (difficulty, card) => {
        if (!card?.id) return;
        try {
            await supabase.rpc('record_flashcard_reviews_batch', {
                p_reviews: [{
                    card_id: card.id,
                    card_type: 'custom',
                    difficulty,
                    reviewed_at: new Date().toISOString()
                }]
            });
        } catch (e) {
            console.warn('[MironChat] Inline flashcard review error:', e);
        }
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
                flashcards: m.flashcards,
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

    const handleWheel = (e) => {
        if (e.deltaY < 0) {
            // User explicitly wheeled up: pause auto-scroll
            isAutoScrollEnabled.current = false;
        } else if (e.deltaY > 0 && flowRef.current) {
            const { scrollHeight, scrollTop, clientHeight } = flowRef.current;
            if (scrollHeight - scrollTop - clientHeight < 280) {
                isAutoScrollEnabled.current = true;
            }
        }
    };

    const handleTouchStart = (e) => {
        touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e) => {
        const diff = e.touches[0].clientY - touchStartY.current;
        if (diff > 12) {
            // User pulled downward to read history: pause auto-scroll
            isAutoScrollEnabled.current = false;
        } else if (diff < -12 && flowRef.current) {
            const { scrollHeight, scrollTop, clientHeight } = flowRef.current;
            if (scrollHeight - scrollTop - clientHeight < 280) {
                isAutoScrollEnabled.current = true;
            }
        }
    };

    const handleScroll = (e) => {
        const { scrollHeight, scrollTop, clientHeight } = e.currentTarget;
        if (scrollHeight - scrollTop - clientHeight < 280) {
            isAutoScrollEnabled.current = true;
        }
    };

    // Auto-Scroll to Bottom: Instant zero-lag lock during stream, smooth on idle
    useEffect(() => {
        if (!flowRef.current) return;
        if (isTyping) {
            if (isAutoScrollEnabled.current) {
                flowRef.current.scrollTop = flowRef.current.scrollHeight;
            }
        } else if (scrollAnchorRef.current && isAutoScrollEnabled.current) {
            scrollAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages, isTyping]);

    const sendMessage = async (textToSend) => {
        if (!textToSend.trim() || isTyping) return;
        isAutoScrollEnabled.current = true;
        setIsTyping(true);

        // Optimistically update local profile balance to prevent UI layout shift
        // The backend will firmly reject via HTTP 402 if they are actually broke.
        if (!userProfile?.is_pro && (userProfile?.linkoin_balance || 0) >= 2) {
            updateUserProfile({ linkoin_balance: userProfile.linkoin_balance - 2 });
        }

        let currentThread = activeThread;
        const tempId = `temp-${Date.now()}`;
        const userMsg = { id: tempId, side: 'user', text: textToSend };
        
        // Optimistic UI Append with streaming placeholder
        const mironTempId = `miron-stream-${Date.now()}`;
        const placeholderMironMsg = {
            id: mironTempId,
            side: 'miron',
            text: '',
            status: null,
            isStreaming: true
        };

        setMessages(prev => [...prev, userMsg, placeholderMironMsg]);
        setIsTyping(true);

        // Lazy Thread Creation on first message send
        if (!currentThread) {
            const cleanBase = textToSend
                .replace(/^\[(?:Textbook Inquiry|Book Quote|Quiz Submission):?\s*([^\|\]]+).*?\]/is, '$1')
                .replace(/^\[[^\]]+\]\s*/g, '')
                .trim();
            const dynamicTitle = cleanBase.length > 38 ? cleanBase.slice(0, 38).trim() + '...' : (cleanBase || "Study Session");
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
            const nowIso = new Date().toISOString();
            
            supabase.from('miron_threads')
                .update({ last_message_at: nowIso })
                .eq('id', currentThread.id)
                .then(({ error }) => {
                    if (error) console.error("Thread update failed:", error);
                });
            
            setThreads(prev => {
                const updated = prev.map(t => t.id === currentThread.id ? { ...t, last_message_at: nowIso } : t);
                return updated.sort((a, b) => {
                    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
                    const timeA = new Date(a.last_message_at || a.created_at).getTime();
                    const timeB = new Date(b.last_message_at || b.created_at).getTime();
                    return timeB - timeA;
                });
            });
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

        // 2. Stream Miron Edge Function Response directly at native wire speed
        let accumulatedText = '';

        const finalizeTurn = async (data, completeText) => {
            let persistedCards = data?.flashcards || null;
            if (data?.flashcards && Array.isArray(data.flashcards) && data.flashcards.length > 0) {
                try {
                    const { data: savedCards } = await supabase.rpc('save_miron_flashcards', {
                        p_cards: data.flashcards
                    });
                    if (savedCards && savedCards.length > 0) {
                        persistedCards = savedCards;
                    }
                } catch (saveErr) {
                    console.warn('[MironChat] Failed to auto-persist custom cards:', saveErr);
                }
            }

            let savedAiMsg = null;
            if (currentThreadId) {
                const mironMsgPayload = {
                    thread_id: currentThreadId,
                    user_id: sessionUser.id,
                    role: 'miron',
                    text: completeText,
                    thought_process: null,
                    snapshots: data?.snapshots || null,
                    quizzes: data?.quizzes || null,
                    flashcards: persistedCards,
                    ui_command: data?.ui_command || null
                };

                const { data: aiMsgData, error: insertErr } = await supabase
                    .from('miron_messages')
                    .insert(mironMsgPayload)
                    .select()
                    .single();

                if (insertErr && (insertErr.code === 'PGRST204' || insertErr.message?.includes('flashcards'))) {
                    delete mironMsgPayload.flashcards;
                    const { data: retryData } = await supabase
                        .from('miron_messages')
                        .insert(mironMsgPayload)
                        .select()
                        .single();
                    savedAiMsg = retryData;
                } else {
                    savedAiMsg = aiMsgData;
                }
            }

            setMessages(prev => prev.map(m => {
                if (m.id === tempId) return { ...m, id: dbUserMsgId };
                if (m.id === mironTempId) {
                    return {
                        id: savedAiMsg?.id || Date.now() + 1,
                        side: 'miron',
                        text: completeText,
                        snapshots: data?.snapshots,
                        quizzes: data?.quizzes,
                        flashcards: persistedCards,
                        ui_command: data?.ui_command,
                        isStreaming: false,
                        status: null
                    };
                }
                return m;
            }));

            if (data?.ui_command && (data.ui_command.action === 'draw_flow' || data.ui_command.action === 'draw')) {
                setActiveBoardPayload(data.ui_command);
            }
            setIsTyping(false);
        };

        try {
            await invokeMironStream({
                prompt: textToSend,
                history: messages.slice(-10),
                context: currentThread?.context_passage || initialContext
            }, {
                onStatus: (statusMessage) => {
                    setMessages(prev => prev.map(m => m.id === mironTempId ? { ...m, status: statusMessage } : m));
                },
                onChunk: (delta) => {
                    accumulatedText += delta;
                    setMessages(prev => prev.map(m => m.id === mironTempId ? { 
                        ...m, 
                        text: accumulatedText,
                        status: null,
                        isStreaming: true 
                    } : m));
                },
                onDone: async (data) => {
                    await finalizeTurn(data, accumulatedText);
                },
                onError: (err) => {
                    throw new Error(err);
                }
            });
        } catch (error) {
            console.error("Miron Communication Error:", error);
            const errMsg = String(error?.message || '').toLowerCase();
            const isBroke = errMsg.includes('402') || errMsg.includes('insufficient_credits') || errMsg.includes('insufficient linkup credits') || errMsg.includes('out of linkup credits');

            setMessages(prev => prev.map(m => {
                if (m.id === tempId) return { ...m, id: dbUserMsgId };
                if (m.id === mironTempId) {
                    if (isBroke) {
                        return { 
                            id: `broke-${Date.now()}`, 
                            side: 'miron', 
                            text: "You've used all your LinkUp Credits for this study session. Upgrade to LinkUp Gold for unlimited 24/7 Miron AI, complete exam archives, and live audio co-hosting.", 
                            isStreaming: false,
                            status: null,
                            isBroke: true 
                        };
                    }
                    return {
                        id: Date.now() + 1,
                        side: 'miron',
                        text: "I apologize, but I am currently having trouble processing your request. Please try asking again in a moment.",
                        isStreaming: false,
                        status: null
                    };
                }
                return m;
            }));
            
            if (isBroke && !userProfile?.is_pro) {
                // If they hit the wall, ensure the frontend UI accurately reflects their 0 balance
                updateUserProfile({ linkoin_balance: 0 });
            } else if (!isBroke && !userProfile?.is_pro) {
                // If it failed for a server reason, refund the optimistic frontend deduction
                updateUserProfile({ linkoin_balance: (userProfile?.linkoin_balance || 0) + 2 });
            }
            
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

            <div className="athena-chat-stage">
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
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <button
                        className={`athena-dev-copy-btn ${isThreadCopied ? 'copied' : ''}`}
                        onClick={handleCopyFullThread}
                        title={isThreadCopied ? "Thread Copied!" : "Copy Full Thread"}
                        disabled={messages.length === 0}
                    >
                        <i className={`fa-${isThreadCopied ? 'solid fa-check' : 'regular fa-clipboard'}`}></i>
                    </button>
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
                                fill="none" stroke="#00f0ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" filter="url(#header-neon-glow)" />

                          <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                                fill="none" stroke="url(#miron-neon-cyan-grad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                          <circle cx="35" cy="37" r="3.5" fill="#ef4444" filter="url(#header-red-dot-glow)" />
                          <text x="57" y="41" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="12" letterSpacing="1" textAnchor="middle">LIVE</text>
                        </svg>
                    </button>
                </div>
            </header>

            {activeBoardPayload && (
                <InteractiveBoard 
                    payload={activeBoardPayload} 
                    onClose={() => setActiveBoardPayload(null)} 
                />
            )}

            <main 
                className="athena-flow" 
                ref={flowRef}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onScroll={handleScroll}
            >
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
                    messages.filter(m => !m.text?.startsWith('[Quiz Submission:')).map(m => (
                        <MironMessageNode 
                            key={m.id}
                            m={m}
                            copiedId={copiedId}
                            handleCopyMessage={handleCopyMessage}
                            handleInlineCardRate={handleInlineCardRate}
                            sendMessage={sendMessage}
                            setActiveBoardPayload={setActiveBoardPayload}
                        />
                    ))
                )}
                
                {isTyping && !messages.some(m => m.isStreaming) && (
                    <div className="chat-node miron">
                        <div className="athena-typing">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                        </div>
                    </div>
                )}
                <div ref={scrollAnchorRef} style={{ height: '1px', minHeight: '1px', flexShrink: 0 }}></div>
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
        </div>
    );
};

export default MironChat;