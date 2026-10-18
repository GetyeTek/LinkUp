import React, { useState, useEffect, useRef } from 'react';
import { usePlatform, useGeminiAudio, supabase, getComponent } from '@linkup-platform/sdk-core';
import FloatingMironOrb from './FloatingMironOrb.jsx';
import MironConnectionRing from './MironConnectionRing.jsx';
import './MironLiveSession.css';

const COURSE_ICONS = {
    'PHYS 1011': 'fa-bolt',
    'BIOL 1012': 'fa-dna',
    'CHEM 1012': 'fa-flask',
    'MATH 1011': 'fa-square-root-variable',
    'MATH 1012': 'fa-chart-pie',
    'LOCT 1011': 'fa-brain',
    'EMTE 1012': 'fa-robot',
    'FLEN 1011': 'fa-comments',
    'ECON 1011': 'fa-chart-line',
    'GEES 1011': 'fa-earth-africa',
    'HIST 1012': 'fa-landmark-dome',
    'INCL 1012': 'fa-hands-holding-circle',
    'MCIE 1012': 'fa-scale-balanced',
    'MGMT 1012': 'fa-briefcase',
    'PSYC 1011': 'fa-head-side-virus',
    'SPSC 1011': 'fa-person-running',
    'ANTH 1012': 'fa-people-group'
};

const COURSE_NAMES = {
    'PHYS 1011': 'Physics',
    'BIOL 1012': 'Biology',
    'CHEM 1012': 'Chemistry',
    'MATH 1011': 'Math',
    'MATH 1012': 'Math',
    'LOCT 1011': 'Logic',
    'EMTE 1012': 'Emerging Tech',
    'FLEN 1011': 'English',
    'ECON 1011': 'Economics',
    'GEES 1011': 'Geography',
    'HIST 1012': 'History',
    'INCL 1012': 'Inclusiveness',
    'MCIE 1012': 'Civics',
    'MGMT 1012': 'Entrepreneurship',
    'PSYC 1011': 'Psychology',
    'SPSC 1011': 'Fitness',
    'ANTH 1012': 'Anthropology'
};

const COURSE_PREFIX_MAP = {
    'PHYS 1011': 'phys',
    'BIOL 1012': 'biol',
    'CHEM 1012': 'chem',
    'MATH 1011': 'math',
    'MATH 1012': 'math',
    'LOCT 1011': 'logic',
    'EMTE 1012': 'emte',
    'FLEN 1011': 'flen',
    'ECON 1011': 'econ',
    'GEES 1011': 'geog',
    'HIST 1012': 'history',
    'INCL 1012': 'snie',
    'MCIE 1012': 'mced',
    'MGMT 1012': 'entre',
    'PSYC 1011': 'psych',
    'SPSC 1011': 'spsc',
    'ANTH 1012': 'anthro'
};

// DOM Range Highlighter for active textbook page
const clearDOMHighlights = (root) => {
    if (!root) return;
    const marks = root.querySelectorAll('mark.miron-live-highlight');
    marks.forEach(m => {
        const parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
    });
};

const applyDOMHighlight = (root, searchText) => {
    if (!root || !searchText || searchText.trim().length < 3) return;
    clearDOMHighlights(root);

    const words = searchText.trim().split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) return;

    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
    const fullPattern = words.map(escapeRegExp).join('\\s+');
    const shortPattern = words.slice(0, 5).map(escapeRegExp).join('\\s+');

    const fullRegex = new RegExp(fullPattern, 'i');
    const shortRegex = words.length > 4 ? new RegExp(shortPattern, 'i') : null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let node;

    while ((node = walker.nextNode())) {
        const raw = node.nodeValue;
        let match = fullRegex.exec(raw);
        if (!match && shortRegex) {
            match = shortRegex.exec(raw);
        }

        if (match) {
            try {
                const range = document.createRange();
                range.setStart(node, match.index);
                range.setEnd(node, Math.min(raw.length, match.index + match[0].length));
                const mark = document.createElement('mark');
                mark.className = 'miron-live-highlight';
                range.surroundContents(mark);
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (e) {}
            break;
        }
    }
};

const MironLiveSession = ({ onClose, mironAvatarUrl }) => {
    const { sessionUser } = usePlatform();
    const [sessionId] = useState(() => crypto.randomUUID());
    const [viewState, setViewState] = useState('full');
    const [isConnected, setIsConnected] = useState(false);
    const [micActive, setMicActive] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [transcripts, setTranscripts] = useState([]);
    const [isMironSpeaking, setIsMironSpeaking] = useState(false);
    const [isConsulting, setIsConsulting] = useState(false);

    // --- CLASSROOM WORKSPACE STATE MACHINE ---
    // 'course_select' | 'toc_select' | 'section_confirm' | 'reading'
    const [stage, setStage] = useState('course_select');
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedSection, setSelectedSection] = useState(null);
    const [expandedChapters, setExpandedChapters] = useState(new Set());
    const [sectionPages, setSectionPages] = useState([]);
    const [activePageIndex, setActivePageIndex] = useState(0);
    const [activeHighlight, setActiveHighlight] = useState(null);
    const [isLoadingPages, setIsLoadingPages] = useState(false);
    const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
    const [isCatalogRevealed, setIsCatalogRevealed] = useState(false);
    const [isTocRevealed, setIsTocRevealed] = useState(false);
    const [isConfirmRevealed, setIsConfirmRevealed] = useState(false);

    // A4 PDF-Scale & Zoom Matrix
    const [fitScale, setFitScale] = useState(1);
    const [zoomMultiplier, setZoomMultiplier] = useState(1);
    const [layerHeight, setLayerHeight] = useState(1123);

    const wsRef = useRef(null);
    const tocTimeoutRef = useRef(null);
    const confirmTimeoutRef = useRef(null);
    const speakingTimeout = useRef(null);
    const transcriptRef = useRef(null);
    const pageContainerRef = useRef(null);
    const a4LayerRef = useRef(null);
    const isHangingUpRef = useRef(false);
    const hasSentReadyRef = useRef(false);

    const { playAudioChunk } = useGeminiAudio(wsRef, micActive);
    const renderBookBlock = getComponent('book-block-renderer');

    // 1. Hydrate Course Books (Fast cache hit + fresh DB fetch)
    useEffect(() => {
        try {
            const raw = localStorage.getItem('linkup_books_catalog');
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list) && list.length > 0) {
                    setBooks(list.filter(b => !b.isExamTrigger && !b.isFlashcardTrigger));
                }
            }
        } catch (e) {}

        supabase
            .from('books')
            .select('id, title, course_code, toc, cover_url, page_offset, custom_css')
            .eq('is_published', true)
            .order('title', { ascending: true })
            .then(({ data, error }) => {
                if (!error && data) {
                    setBooks(data);
                }
            });
    }, []);

    // 2. Auto-scroll Transcripts
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTo({
                top: transcriptRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [transcripts]);

    // 3. Live Highlight Synchronization
    useEffect(() => {
        if (stage === 'reading' && pageContainerRef.current && activeHighlight) {
            applyDOMHighlight(pageContainerRef.current, activeHighlight);
        }
    }, [activeHighlight, activePageIndex, stage]);

    // 3.1. Dynamic Custom Book CSS Injection (High-Fidelity Rendering)
    useEffect(() => {
        if (stage === 'reading' && selectedBook?.custom_css) {
            const normalizedCss = selectedBook.custom_css
                .replace(/(border(?:-[a-z]+)?\s*:\s*[^;}]*?)(#000000|#000|black)\b/gi, '$1var(--border, #000)')
                .replace(/\b(background(?:-color)?\s*:\s*)(#ffffff|#fff|white)\s*;/gi, '$1var(--page-bg);')
                .replace(/\b(color\s*:\s*)(#000000|#000|#111111|#111|#222222|#222|black)\s*;/gi, '$1var(--text-color);');

            let styleTag = document.getElementById('ml-live-book-css');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'ml-live-book-css';
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = normalizedCss;
        }

        return () => {
            const el = document.getElementById('ml-live-book-css');
            if (el) el.remove();
        };
    }, [stage, selectedBook]);

    // 3.2. Auto-Fit A4 Scale Calculator
    useEffect(() => {
        if (stage !== 'reading' || !pageContainerRef.current) return;

        const updateFitScale = () => {
            if (!pageContainerRef.current) return;
            const containerW = pageContainerRef.current.clientWidth;
            const padding = containerW < 600 ? 16 : 32;
            const computed = Math.min((containerW - padding) / 794, 1.2);
            setFitScale(Math.max(0.35, computed));
        };

        updateFitScale();
        const ro = new ResizeObserver(updateFitScale);
        ro.observe(pageContainerRef.current);
        return () => ro.disconnect();
    }, [stage, activePageIndex]);

    // 3.3. Unscaled A4 Paper Height Tracker
    useEffect(() => {
        if (stage !== 'reading') return;
        const timer = setTimeout(() => {
            if (a4LayerRef.current) {
                const h = a4LayerRef.current.offsetHeight;
                if (h > 0) setLayerHeight(h);
            }
        }, 80);
        return () => clearTimeout(timer);
    }, [stage, activePageIndex, sectionPages, fitScale, zoomMultiplier]);

    // 3.5. Signal Client Ready on Course Select Stage
    useEffect(() => {
        if (isConnected && books.length > 0 && stage === 'course_select' && !hasSentReadyRef.current) {
            hasSentReadyRef.current = true;
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ action: "client_ready", stage: "course_select" }));
            }
        }
    }, [isConnected, books.length, stage]);

    // 3.6. Gated Catalog Reveal: Shimmer remains active until Miron is connected
    useEffect(() => {
        if (!isConnected) {
            setIsCatalogRevealed(false);
            return;
        }
        // Safety ceiling only ticks down once connection is hot
        const timer = setTimeout(() => setIsCatalogRevealed(true), 5000);
        return () => clearTimeout(timer);
    }, [isConnected]);

    // 3.7. Synchronize Reveal With Miron's Voice (Gated on Active Connection)
    useEffect(() => {
        if (isConnected && isMironSpeaking) {
            if (stage === 'course_select') setIsCatalogRevealed(true);
            if (stage === 'toc_select') setIsTocRevealed(true);
            if (stage === 'section_confirm') setIsConfirmRevealed(true);
        }
    }, [isConnected, isMironSpeaking, stage]);

    // 4. Core WebSocket Connection to Gemini DO
    useEffect(() => {
        if (!sessionUser?.id) return;
        isHangingUpRef.current = false;
        const agentId = `miron-personal-${sessionUser.id}-${sessionId}`;
        const studentName = sessionUser.user_metadata?.full_name?.split(' ')[0] || "Scholar";
        const url = `wss://linkup-gateway.getyeteklu2.workers.dev/realtime-ai?agent=${agentId}&name=${encodeURIComponent(studentName)}&uid=${sessionUser.id}`;
        
        let ws = null;
        let isMounted = true;
        let reconnectTimer = null;

        const connectWS = async () => {
            if (!isMounted || isHangingUpRef.current) return;
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || '';
            ws = new WebSocket(url, ["access_token", token]);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("[Miron Live] Secure Neural Link Established");
                setIsConnected(true);
            };

            ws.onclose = () => {
                setIsConnected(false);
                if (isMounted && !isHangingUpRef.current) {
                    reconnectTimer = setTimeout(connectWS, 2000);
                }
            };

            ws.onmessage = (e) => {
                try {
                    const payload = JSON.parse(e.data);

                    // A. Intercept User Transcription
                    if (payload.serverContent?.inputTranscription?.text) {
                        const userText = payload.serverContent.inputTranscription.text;
                        setTranscripts(prev => {
                            const last = prev[prev.length - 1];
                            if (last && last.role === 'user' && !last.isFinal) {
                                const updated = [...prev];
                                updated[updated.length - 1] = { ...last, text: last.text + userText };
                                return updated;
                            }
                            return [...prev, { id: Date.now(), role: 'user', text: userText, isFinal: false }];
                        });
                    }

                    // B. Intercept Gemini Speech Transcript
                    if (payload.serverContent?.outputTranscription?.text) {
                        const mironText = payload.serverContent.outputTranscription.text;
                        setTranscripts(prev => {
                            const last = prev[prev.length - 1];
                            if (last && last.role === 'miron' && !last.isFinal) {
                                const updated = [...prev];
                                updated[updated.length - 1] = { ...last, text: last.text + mironText };
                                return updated;
                            }
                            return [...prev, { id: Date.now(), role: 'miron', text: mironText, isFinal: false }];
                        });
                    }

                    // C. Finalize bubble
                    if (payload.serverContent?.turnComplete) {
                        setTranscripts(prev => {
                            const last = prev[prev.length - 1];
                            if (last && !last.isFinal) {
                                const updated = [...prev];
                                updated[updated.length - 1] = { ...last, isFinal: true };
                                return updated;
                            }
                            return prev;
                        });
                    }

                    // D. Voice Output Audio Chunks
                    if (payload.serverContent?.modelTurn?.parts) {
                        for (const part of payload.serverContent.modelTurn.parts) {
                            if (part.inlineData?.data) {
                                playAudioChunk(part.inlineData.data);
                                setIsMironSpeaking(true);
                                clearTimeout(speakingTimeout.current);
                                speakingTimeout.current = setTimeout(() => setIsMironSpeaking(false), 800);
                            }
                        }
                    }

                    // E. Live Highlight Transmission
                    if (payload.type === "live_highlight" && payload.text) {
                        setActiveHighlight(payload.text);
                    } else if (payload.type === "miron_thought" && typeof payload.text === 'string') {
                        const hlMatch = payload.text.match(/highlight=["']([^"']+)["']/i);
                        if (hlMatch) {
                            setActiveHighlight(hlMatch[1]);
                        }
                    }

                    // F. Tool Consulting State
                    if (payload.type === "tool_call_state") {
                        setIsConsulting(payload.executing);
                    }

                    // G. Billing Alert
                    if (payload.event === "billing_error" || (payload.error && payload.error.toLowerCase().includes('insufficient_credits'))) {
                        setTranscripts(prev => [...prev, {
                            id: Date.now(),
                            role: 'miron',
                            text: "You have used all your LinkUp Credits for live voice study sessions. Upgrade to LinkUp Gold for unlimited AI stages.",
                            isFinal: true,
                            isBroke: true
                        }]);
                        setIsMironSpeaking(false);
                        ws.close();
                    }
                } catch (err) {}
            };
        };

        connectWS();

        return () => {
            isMounted = false;
            clearTimeout(reconnectTimer);
            clearTimeout(speakingTimeout.current);
            if (ws) ws.close();
        };
    }, [sessionUser?.id]);

    // Send verbal intent to DO
    const emitVoicePrompt = (spokenText) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                clientContent: {
                    turns: [{ role: "user", parts: [{ text: spokenText }] }],
                    turnComplete: true
                }
            }));
        }
    };

    // --- NAVIGATION FLOW HANDLERS ---
    const handleSelectCourse = (book) => {
        setSelectedBook(book);
        setStage('toc_select');
        setExpandedChapters(new Set([0]));
        setIsTocRevealed(false);
        setIsMironSpeaking(false);
        clearTimeout(speakingTimeout.current);
        clearTimeout(tocTimeoutRef.current);
        tocTimeoutRef.current = setTimeout(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                setIsTocRevealed(true);
            }
        }, 5000);

        const friendlyName = (book.course_code && COURSE_NAMES[book.course_code]) || (book.title || 'Course').replace(/^General\s+/i, '');
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                action: "course_selected",
                course_name: friendlyName
            }));
        }
    };

    const toggleChapterExpand = (chIndex) => {
        setExpandedChapters(prev => {
            const next = new Set(prev);
            if (next.has(chIndex)) next.delete(chIndex);
            else next.add(chIndex);
            return next;
        });
    };

    const handleSelectSection = (sectionNode, parentChapterTitle) => {
        setSelectedSection({
            ...sectionNode,
            parentTitle: parentChapterTitle
        });
        setStage('section_confirm');
        setIsConfirmRevealed(false);
        setIsMironSpeaking(false);
        clearTimeout(speakingTimeout.current);
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = setTimeout(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                setIsConfirmRevealed(true);
            }
        }, 5000);

        const friendlyName = (selectedBook?.course_code && COURSE_NAMES[selectedBook.course_code]) || (selectedBook?.title || 'Course').replace(/^General\s+/i, '');
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                action: "section_selected",
                course_name: friendlyName,
                chapter_title: parentChapterTitle,
                section_title: sectionNode.title
            }));
        }
    };

    const handleConfirmStartReading = async () => {
        if (!selectedBook || !selectedSection) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: "interrupt" }));
        }
        setIsLoadingPages(true);
        setStage('reading');

        const offset = selectedBook.page_offset || 0;
        const logicalStart = selectedSection.page || 1;
        const physicalStart = Math.max(1, logicalStart + offset);
        const physicalEnd = physicalStart + 6;

        try {
            const { data, error } = await supabase
                .from('book_pages')
                .select('id, page_number, content_json')
                .eq('book_id', selectedBook.id)
                .gte('page_number', physicalStart)
                .lte('page_number', physicalEnd)
                .order('page_number', { ascending: true });

            if (error) throw error;
            const validPages = data && data.length > 0 ? data : [
                { id: 'blank', page_number: physicalStart, content_json: [{ type: 'paragraph', body: `Welcome to ${selectedSection.title}. Let's begin the review.` }] }
            ];

            setSectionPages(validPages);
            setActivePageIndex(0);
            setIsLoadingPages(false);

            // Feed Miron Page 1
            const p1 = validPages[0];
            const p1Text = (p1.content_json || []).map(b => b.body || b.text || b.main || '').filter(Boolean).join(' ');
            emitVoicePrompt(`We are confirmed on Page ${p1.page_number} for "${selectedSection.title}". Here is the raw page text:\n"""${p1Text.slice(0, 1800)}"""\nTeach me the first concept step by step. Remember to tag exact sentences you are discussing with <chunk highlight="...">.`);
        } catch (e) {
            console.error("Failed to load section pages:", e);
            setIsLoadingPages(false);
        }
    };

    const handleNextPage = () => {
        if (activePageIndex < sectionPages.length - 1) {
            setActivePageIndex(prev => prev + 1);
            setActiveHighlight(null);
        }
    };

    const handlePrevPage = () => {
        if (activePageIndex > 0) {
            setActivePageIndex(prev => prev - 1);
            setActiveHighlight(null);
        }
    };

    const handleSendText = () => {
        if (!textInput.trim()) return;
        const text = textInput.trim();
        setTextInput('');
        setTranscripts(prev => [...prev, { id: Date.now(), role: 'user', text, isFinal: true }]);
        emitVoicePrompt(text);
    };

    const handleHangup = () => {
        isHangingUpRef.current = true;
        hasSentReadyRef.current = false;
        clearTimeout(tocTimeoutRef.current);
        clearTimeout(confirmTimeoutRef.current);
        if (wsRef.current) {
            try {
                if (wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ action: "hangup" }));
                }
                wsRef.current.close(1000, "User ended session");
            } catch (e) {}
        }
        setTranscripts([]);
        onClose();
    };

    if (viewState === 'minimized') {
        return <FloatingMironOrb mironAvatarUrl={mironAvatarUrl} isConnected={isConnected} onClick={() => setViewState('full')} />;
    }

    const currentPage = sectionPages[activePageIndex];

    return (
        <div className="ml-overlay">
            <div className="ml-ambient"></div>

            {/* Header Bar */}
            <header className="ml-header">
                <div className="ml-header-left">
                    {stage !== 'course_select' && (
                        <button 
                            className="ml-back-btn" 
                            onClick={() => {
                                if (stage === 'reading') setStage('section_confirm');
                                else if (stage === 'section_confirm') setStage('toc_select');
                                else if (stage === 'toc_select') setStage('course_select');
                            }}
                        >
                            <i className="fas fa-chevron-left"></i>
                        </button>
                    )}
                    <button className="athena-close" onClick={() => setViewState('minimized')}>
                        <i className="fas fa-chevron-down"></i>
                    </button>
                </div>

                <div className="ml-status">
                    <span className="live-dot" style={!isConnected ? { background: '#f59e0b', boxShadow: '0 0 8px #f59e0b' } : {}}></span>
                    <span>
                        {!isConnected ? 'Connecting to Miron...' :
                         stage === 'course_select' ? 'Select a Course' : 
                         stage === 'toc_select' ? (selectedBook?.course_code || selectedBook?.title) :
                         stage === 'section_confirm' ? 'Ready to Study' :
                         `${selectedBook?.course_code || 'Reader'} • p.${currentPage?.page_number || ''}`}
                    </span>
                    {isConnected && (
                        <span className="ml-voice-status-pill">
                            <i className="fas fa-headphones-simple"></i>
                            <span>Live Voice</span>
                        </span>
                    )}
                </div>

                <div className="ml-header-right">
                    {stage === 'reading' && (
                        <button 
                            className={`ml-transcript-toggle ${showTranscriptDrawer ? 'active' : ''}`}
                            onClick={() => setShowTranscriptDrawer(!showTranscriptDrawer)}
                            title="Toggle Live Transcript"
                        >
                            <i className="fas fa-comment-dots"></i>
                        </button>
                    )}
                    <button className="athena-close" onClick={handleHangup} style={{ color: '#ff5f5f' }}>
                        <i className="fas fa-phone-slash"></i>
                    </button>
                </div>
            </header>

            {/* Interactive Workspace */}
            <main className={`ml-classroom-body ${stage}`}>

                {/* Compact Miron Avatar Strip */}
                <div className={`ml-avatar-strip ${stage}`}>
                    <div className="ml-avatar-mini-container">
                        <MironConnectionRing isConnected={isConnected} />
                        {isConnected && !isConsulting && isMironSpeaking && (
                            <>
                                <div className="ml-halo"></div>
                                <div className="ml-halo" style={{ animationDelay: '0.6s' }}></div>
                            </>
                        )}
                        <img 
                            src={mironAvatarUrl} 
                            alt="Miron" 
                            className={`ml-avatar ${isMironSpeaking ? 'is-speaking' : ''} ${isConsulting ? 'consulting-mode' : ''}`} 
                        />
                        {isConnected && isMironSpeaking && (
                            <div className="ml-speaking-eq-pill" title="Miron Speaking">
                                <span className="ml-eq-bar b1"></span>
                                <span className="ml-eq-bar b2"></span>
                                <span className="ml-eq-bar b3"></span>
                                <span className="ml-eq-bar b4"></span>
                            </div>
                        )}
                    </div>
                    {isConsulting && (
                        <span className="ml-consulting-badge">
                            <i className="fas fa-circle-notch fa-spin"></i> Consulting textbook...
                        </span>
                    )}
                </div>

                {/* STAGE 0: COURSE SELECT GRID */}
                {stage === 'course_select' && (
                    <div className="ml-stage-content course-grid-stage">
                        <div className="ml-stage-header">
                            <h2>What are we studying today?</h2>
                            <p>Tap a course to explore the curriculum out loud with Miron.</p>
                        </div>
                        {!isCatalogRevealed ? (
                            <div className="ml-courses-grid skeleton-grid">
                                {Array.from({ length: 18 }).map((_, idx) => (
                                    <div key={idx} className="ml-course-card skeleton">
                                        <div className="ml-card-top-row">
                                            <div className="ml-skeleton-box icon-skeleton"></div>
                                            <div className="ml-skeleton-box pill-skeleton"></div>
                                        </div>
                                        <div className="ml-skeleton-box title-skeleton"></div>
                                        <div className="ml-skeleton-box sub-skeleton"></div>
                                        <div className="ml-card-footer">
                                            <div className="ml-skeleton-box footer-skeleton"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="ml-courses-grid">
                                {books.map(b => (
                                    <div 
                                        key={b.id} 
                                        className="ml-course-card" 
                                        onClick={() => handleSelectCourse(b)}
                                        style={b.cover_url ? {
                                            backgroundImage: `linear-gradient(145deg, rgba(14, 14, 18, 0.70) 0%, rgba(10, 10, 14, 0.88) 100%), url("${b.cover_url}")`,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center'
                                        } : {}}
                                    >
                                        <div className="ml-card-top-row">
                                            <div className="ml-card-icon-box">
                                                <i className={`fa-solid ${COURSE_ICONS[b.course_code] || 'fa-book-open'}`}></i>
                                            </div>
                                            <div className="ml-card-top-tags">
                                                <span className="ml-voice-cue-chip" title="Voice Guided"><i className="fas fa-volume-high"></i></span>
                                                <span className="ml-card-code-tag">{b.course_code || 'COURSE'}</span>
                                            </div>
                                        </div>

                                        <h3 className="ml-card-name">{b.title}</h3>

                                        <div className="ml-card-footer">
                                            <span className="ml-card-count">
                                                {b.toc?.length ? `${b.toc.length} Chapters` : 'Curriculum Book'}
                                            </span>
                                            <span className="ml-card-arrow">
                                                <i className="fas fa-arrow-right"></i>
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* STAGE 1: TOC SELECT OR STAGE 2: SECTION CONFIRM (SPLIT MASTER-DETAIL WORKSPACE) */}
                {/* STAGE 1, 2, and 3: SPLIT MASTER-DETAIL WORKSPACE */}
                {stage !== 'course_select' && selectedBook && (
                    <div className={`ml-stage-content toc-split-stage ${stage === 'reading' ? 'reading-stage-active' : ''}`}>
                        <div className={`ml-toc-split-layout ${stage === 'reading' ? 'is-reading-layout' : ''}`}>
                            
                            {/* Column 1: Prominent Book Showcase (Desktop: Left Column, Mobile: Sleek Header) */}
                            <div className="ml-toc-book-showcase" style={selectedBook.cover_url ? { '--bg-cover': `url("${selectedBook.cover_url}")` } : {}}>
                                <div className="ml-showcase-backdrop-blur"></div>
                                <div className="ml-showcase-cover-wrapper">
                                    {selectedBook.cover_url ? (
                                        <img src={selectedBook.cover_url} className="ml-showcase-cover" alt={selectedBook.title} />
                                    ) : (
                                        <div className="ml-showcase-fallback-cover">
                                            <i className={`fa-solid ${COURSE_ICONS[selectedBook.course_code] || 'fa-book-open'}`}></i>
                                        </div>
                                    )}
                                </div>
                                <div className="ml-showcase-details">
                                    <span className="ml-card-code-tag">{selectedBook.course_code || 'CURRICULUM'}</span>
                                    <h2 className="ml-showcase-title">{selectedBook.title}</h2>
                                    <p className="ml-showcase-meta">
                                        {selectedBook.toc?.length ? `${selectedBook.toc.length} Chapters in Syllabus` : 'Official Curriculum Textbook'}
                                    </p>
                                    {stage === 'toc_select' && (
                                        <div className="ml-showcase-prompt-tip">
                                            <i className="fas fa-hand-pointer"></i>
                                            <span>Pick a chapter on the right to reveal study topics</span>
                                        </div>
                                    )}
                                    {stage === 'reading' && (
                                        <div className="ml-showcase-prompt-tip" style={{background: 'rgba(66, 215, 184, 0.1)', borderColor: 'rgba(66, 215, 184, 0.25)'}}>
                                            <i className="fas fa-book-open"></i>
                                            <span>Reading Page {currentPage?.page_number || ''}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Column 2: Interactive Pane (TOC Accordion, Section Confirm, or Reader) */}
                            <div className="ml-toc-interactive-pane">
                                {stage === 'toc_select' && (
                                    !isTocRevealed ? (
                                        <div className="ml-toc-accordion skeleton-accordion">
                                            {Array.from({ length: 6 }).map((_, idx) => (
                                                <div key={idx} className="ml-toc-chapter-card skeleton">
                                                    <div className="ml-toc-ch-header">
                                                        <div className="ml-toc-ch-left">
                                                            <div className="ml-skeleton-box ch-icon-skeleton"></div>
                                                            <div className="ml-skeleton-box ch-title-skeleton"></div>
                                                        </div>
                                                        <div className="ml-skeleton-box pill-skeleton"></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="ml-toc-accordion">
                                            {(selectedBook.toc || []).map((node, chIdx) => {
                                                const isExpanded = expandedChapters.has(chIdx);
                                                const hasChildren = node.children && node.children.length > 0;

                                                return (
                                                    <div key={chIdx} className={`ml-toc-chapter-card ${isExpanded ? 'expanded' : ''}`}>
                                                        <div className="ml-toc-ch-header" onClick={() => toggleChapterExpand(chIdx)}>
                                                            <div className="ml-toc-ch-left">
                                                                <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'}`}></i>
                                                                <span className="ml-toc-ch-title">{node.title}</span>
                                                            </div>
                                                            {node.page && <span className="ml-toc-page-pill">p.{node.page}</span>}
                                                        </div>

                                                        {isExpanded && hasChildren && (
                                                            <div className="ml-toc-sections-list">
                                                                {node.children.map((sub, sIdx) => (
                                                                    <div 
                                                                        key={sIdx} 
                                                                        className="ml-toc-section-item" 
                                                                        onClick={() => handleSelectSection(sub, node.title)}
                                                                    >
                                                                        <span className="ml-toc-sec-title">
                                                                            <i className="fas fa-volume-low ml-sec-voice-glyph"></i>
                                                                            {sub.title}
                                                                        </span>
                                                                        <span className="ml-toc-sec-arrow">
                                                                            {sub.page ? `p.${sub.page}` : ''} <i className="fas fa-arrow-right"></i>
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )
                                )}

                                {stage === 'section_confirm' && (
                                    !isConfirmRevealed ? (
                                        <div className="ml-confirm-card skeleton">
                                            <div className="ml-skeleton-box pill-skeleton" style={{ width: 110, height: 16 }}></div>
                                            <div className="ml-skeleton-box sub-skeleton" style={{ width: 140, height: 13, margin: '10px 0 6px' }}></div>
                                            <div className="ml-skeleton-box title-skeleton" style={{ width: '85%', height: 26, margin: '6px 0 14px' }}></div>
                                            <div className="ml-confirm-meta" style={{ width: '100%', gap: 12 }}>
                                                <div className="ml-skeleton-box" style={{ width: 120, height: 14 }}></div>
                                                <div className="ml-skeleton-box" style={{ width: 150, height: 14 }}></div>
                                            </div>
                                            <div className="ml-skeleton-box" style={{ width: '100%', height: 14, margin: '16px 0 8px' }}></div>
                                            <div className="ml-skeleton-box" style={{ width: '90%', height: 14, marginBottom: 20 }}></div>
                                            <div className="ml-confirm-actions-row">
                                                <div className="ml-skeleton-box" style={{ width: 120, height: 46, borderRadius: 14 }}></div>
                                                <div className="ml-skeleton-box" style={{ flex: 1, height: 46, borderRadius: 14 }}></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="ml-confirm-card">
                                            <span className="ml-confirm-tag">
                                                <i className="fas fa-bookmark"></i> SELECTED TOPIC
                                            </span>
                                            <span className="ml-confirm-parent">{selectedSection.parentTitle}</span>
                                            <h2 className="ml-confirm-title">{selectedSection.title}</h2>
                                            <div className="ml-confirm-meta">
                                                <span><i className="far fa-file-alt"></i> Starts on Page {selectedSection.page || 1}</span>
                                                <span><i className="fas fa-bolt"></i> Co-Pilot Guided Session</span>
                                            </div>

                                            <p className="ml-confirm-blurb">
                                                Miron will read through this section with you, breaking down concepts, formulas, and highlighting key sentences live as he explains them.
                                            </p>

                                            <div className="ml-confirm-actions-row">
                                                <button className="ml-btn-back-toc" onClick={() => setStage('toc_select')}>
                                                    <i className="fas fa-chevron-left"></i> Change Topic
                                                </button>
                                                <button className="ml-start-grind-btn" onClick={handleConfirmStartReading}>
                                                    <span>Start Reading with Miron</span>
                                                    <i className="fas fa-arrow-right"></i>
                                                </button>
                                            </div>
                                        </div>
                                    )
                                )}

                                {stage === 'reading' && (
                                    <div className="ml-reader-workspace">
                                        <div className="ml-reader-bar">
                                            <div className="ml-reader-bar-left">
                                                <button 
                                                    className="ml-page-nav-btn" 
                                                    onClick={handlePrevPage} 
                                                    disabled={activePageIndex === 0}
                                                >
                                                    <i className="fas fa-chevron-left"></i> Prev
                                                </button>
                                                <span className="ml-page-indicator">
                                                    p. {currentPage?.page_number || ''} ({activePageIndex + 1}/{sectionPages.length})
                                                </span>
                                                <button 
                                                    className="ml-page-nav-btn" 
                                                    onClick={handleNextPage} 
                                                    disabled={activePageIndex >= sectionPages.length - 1}
                                                >
                                                    Next <i className="fas fa-chevron-right"></i>
                                                </button>
                                            </div>

                                            <div className="ml-reader-bar-right">
                                                <button 
                                                    className="ml-zoom-toggle-btn"
                                                    onClick={() => setZoomMultiplier(prev => prev > 1.1 ? 1 : 1.5)}
                                                    title={zoomMultiplier > 1.1 ? "Fit to Viewport" : "Zoom 150%"}
                                                >
                                                    <i className={`fas ${zoomMultiplier > 1.1 ? 'fa-compress' : 'fa-magnifying-glass-plus'}`}></i>
                                                    <span>{zoomMultiplier > 1.1 ? 'Fit' : '150%'}</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="ml-page-viewport" ref={pageContainerRef}>
                                            {isLoadingPages ? (
                                                <div className="ml-page-loader">
                                                    <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                                                    <p>Loading textbook page...</p>
                                                </div>
                                            ) : currentPage ? (
                                                (() => {
                                                    const bookPrefix = selectedBook?.course_code ? (COURSE_PREFIX_MAP[selectedBook.course_code.toUpperCase().trim()] || '') : '';
                                                    const engineClass = bookPrefix ? `engine-${bookPrefix}` : 'engine-universal';
                                                    const effectiveScale = fitScale * zoomMultiplier;
                                                    return (
                                                        <div 
                                                            className="ml-a4-viewport-sizer"
                                                            style={{
                                                                width: `${794 * effectiveScale}px`,
                                                                height: `${layerHeight * effectiveScale}px`
                                                            }}
                                                            onDoubleClick={() => setZoomMultiplier(prev => prev > 1.1 ? 1 : 1.5)}
                                                        >
                                                            <div 
                                                                ref={a4LayerRef}
                                                                className="ml-a4-layer"
                                                                style={{
                                                                    width: '794px',
                                                                    transform: `scale(${effectiveScale})`,
                                                                    transformOrigin: 'top left'
                                                                }}
                                                            >
                                                                <div className={`page-wrapper ${engineClass}`} data-page-number={currentPage.page_number}>
                                                                    <div className={`page-canvas ${engineClass}`}>
                                                                        {(currentPage.content_json || []).map((block, idx) => (
                                                                            <div key={idx} className="block-target-wrapper">
                                                                                {renderBookBlock ? (
                                                                                    renderBookBlock(block, idx, { bookTitle: selectedBook?.title, courseCode: selectedBook?.course_code })
                                                                                ) : (
                                                                                    <p>{block.body || block.text || block.main || ''}</p>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()
                                            ) : null}
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>
                    </div>
                )}

                {/* Live Transcript Drawer */}
                <div className={`ml-transcript-floating-drawer ${showTranscriptDrawer ? 'open' : ''}`}>
                    <div className="ml-tfd-header">
                        <span><i className="fas fa-comment-dots"></i> Live Transcript</span>
                        <button onClick={() => setShowTranscriptDrawer(false)}><i className="fas fa-times"></i></button>
                    </div>
                    <div className="ml-tfd-scroll" ref={transcriptRef}>
                        {transcripts.map(t => (
                            <div key={t.id} className={`ml-bubble-wrap ${t.role}`}>
                                {t.isBroke ? (
                                    <div className="miron-credit-out-card live-mode">
                                        <div className="mcoc-header">
                                            <div className="mcoc-crown-badge"><i className="fas fa-crown"></i></div>
                                            <span className="mcoc-title">LinkUp Gold Required</span>
                                        </div>
                                        <p className="mcoc-text">{t.text}</p>
                                        <button className="mcoc-upgrade-btn" onClick={() => window.location.href = '/subscription'}>
                                            <i className="fas fa-bolt"></i> Upgrade to LinkUp Gold
                                        </button>
                                    </div>
                                ) : (
                                    <div className="ml-bubble">
                                        {t.text || <span className="ml-typing-dots">...</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

            </main>

            {/* Bottom Microphone / Chat Capsule */}
            <footer className="ml-dock-container">
                <div className="ml-dock">
                    <input 
                        type="text" 
                        placeholder={stage === 'reading' ? "Ask Miron about this page..." : "Type to Miron..."} 
                        value={textInput}
                        onChange={e => setTextInput(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && handleSendText()}
                    />
                    {textInput.trim() ? (
                        <button className="ml-action-btn ml-send-btn" onClick={handleSendText}>
                            <i className="fas fa-arrow-up"></i>
                        </button>
                    ) : (
                        <button className={`ml-action-btn ml-mic-btn ${micActive ? 'active' : ''}`} onClick={() => setMicActive(!micActive)}>
                            <i className={`fas fa-microphone${micActive ? '' : '-slash'}`}></i>
                        </button>
                    )}
                </div>
            </footer>
        </div>
    );
};

export default MironLiveSession;