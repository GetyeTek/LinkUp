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
    const [activePageNum, setActivePageNum] = useState(null);
    const [activeHighlight, setActiveHighlight] = useState(null);
    const [isLoadingPages, setIsLoadingPages] = useState(false);
    const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
    const [isCatalogRevealed, setIsCatalogRevealed] = useState(false);
    const [isTocRevealed, setIsTocRevealed] = useState(false);
    const [isConfirmRevealed, setIsConfirmRevealed] = useState(false);
    const [isReadingRevealed, setIsReadingRevealed] = useState(false);

    // A4 PDF-Scale & Zoom Matrix
    const [fitScale, setFitScale] = useState(1);
    const [zoomMultiplier, setZoomMultiplier] = useState(1);
    const [layerHeight, setLayerHeight] = useState(1123);

    const wsRef = useRef(null);
    const tocTimeoutRef = useRef(null);
    const confirmTimeoutRef = useRef(null);
    const readingTimeoutRef = useRef(null);
    const speakingTimeout = useRef(null);
    const transcriptRef = useRef(null);
    const pageContainerRef = useRef(null);
    const a4LayerRef = useRef(null);
    const isHangingUpRef = useRef(false);
    const hasSentReadyRef = useRef(false);
    const bufferedHighlightsRef = useRef([]);

    // Gesture Matrix State (Ref-based for 120fps direct DOM manipulation)
    const transformRef = useRef({ scale: 1.0, x: 0, y: 16 });
    const gestureStateRef = useRef({
        mode: 'none', // 'pan' | 'pinch'
        startDist: 0,
        startScale: 1.0,
        startMid: { x: 0, y: 0 },
        startPos: { x: 0, y: 0 },
        lastPan: { x: 0, y: 0 },
        lastTapTime: 0,
        lastTapPos: { x: 0, y: 0 },
        isMouseDown: false,
        history: [],
        velocity: { vx: 0, vy: 0 },
        momentumRafId: null
    });

    const applyTransform = (smooth = false, explicitFit = null) => {
        if (!a4LayerRef.current) return;
        const activeFit = explicitFit || fitScale;
        const { scale, x, y } = transformRef.current;
        const currentEffective = activeFit * scale;
        a4LayerRef.current.style.transition = smooth ? 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
        a4LayerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${currentEffective})`;
    };

    const clampPosition = (x, y, scale) => {
        if (!pageContainerRef.current) return { x, y };
        const cW = pageContainerRef.current.clientWidth;
        const cH = pageContainerRef.current.clientHeight;
        const liveH = a4LayerRef.current?.offsetHeight || 0;
        const totalUnscaledH = Math.max(liveH, (sectionPages.length || 1) * 1150);
        const pW = 794 * fitScale * scale;
        const totalHeight = totalUnscaledH * fitScale * scale;

        const clampedX = pW <= cW ? (cW - pW) / 2 : Math.min(16, Math.max(cW - pW - 16, x));
        const clampedY = totalHeight <= cH ? Math.max(16, (cH - totalHeight) / 2) : Math.min(24, Math.max(cH - totalHeight - 48, y));
        return { x: clampedX, y: clampedY };
    };

    const runMomentum = () => {
        const g = gestureStateRef.current;
        cancelAnimationFrame(g.momentumRafId);
        let vx = g.velocity.vx;
        let vy = g.velocity.vy;
        let lastTime = performance.now();

        const step = (currentTime) => {
            const dt = Math.min(32, currentTime - lastTime);
            lastTime = currentTime;
            const timeFactor = dt / 16.666;

            // Silky exponential decay normalized across 60Hz and 120Hz
            const friction = Math.pow(0.964, timeFactor);
            vx *= friction;
            vy *= friction;

            if (Math.hypot(vx, vy) < 0.18) {
                const targetScale = transformRef.current.scale;
                const clamped = clampPosition(transformRef.current.x, transformRef.current.y, targetScale);
                transformRef.current.x = clamped.x;
                transformRef.current.y = clamped.y;
                applyTransform(true);
                return;
            }

            const nextX = transformRef.current.x + vx * timeFactor;
            const nextY = transformRef.current.y + vy * timeFactor;
            const currentScale = transformRef.current.scale;
            const clamped = clampPosition(nextX, nextY, currentScale);

            if (clamped.x !== nextX) vx = 0;
            if (clamped.y !== nextY) vy = 0;

            transformRef.current.x = clamped.x;
            transformRef.current.y = clamped.y;
            applyTransform(false);

            g.momentumRafId = requestAnimationFrame(step);
        };

        g.momentumRafId = requestAnimationFrame(step);
    };

    const handleToggleZoomFit = () => {
        if (!pageContainerRef.current) return;
        const rect = pageContainerRef.current.getBoundingClientRect();
        if (transformRef.current.scale > 1.1) {
            const targetScale = 1.0;
            const pW = 794 * fitScale;
            const x0 = (rect.width - pW) / 2;
            transformRef.current = { scale: targetScale, x: x0, y: 16 };
            applyTransform(true);
            setZoomMultiplier(1.0);
        } else {
            const targetScale = 1.8;
            const currentScale = transformRef.current.scale;
            const midX = rect.width / 2;
            const midY = rect.height / 2;
            const px = (midX - transformRef.current.x) / (currentScale * fitScale);
            const py = (midY - transformRef.current.y) / (currentScale * fitScale);
            const newX = midX - px * (targetScale * fitScale);
            const newY = midY - py * (targetScale * fitScale);
            const clamped = clampPosition(newX, newY, targetScale);
            transformRef.current = { scale: targetScale, x: clamped.x, y: clamped.y };
            applyTransform(true);
            setZoomMultiplier(targetScale);
        }
    };

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
        if (stage !== 'reading' || viewState !== 'full' || !pageContainerRef.current) return;

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
    }, [stage, activePageIndex, viewState]);

    // 3.3. Unscaled A4 Paper Height Tracker & Initial Transform Reset
    useEffect(() => {
        if (stage !== 'reading' || viewState !== 'full') return;
        const timer = setTimeout(() => {
            if (a4LayerRef.current) {
                const h = a4LayerRef.current.offsetHeight;
                if (h > 0) setLayerHeight(h);
            }
        }, 80);
        return () => clearTimeout(timer);
    }, [stage, activePageIndex, sectionPages, fitScale, viewState]);

    // 3.4. Gestures Engine: Focal Pinch-to-Zoom, 2D Pan, and Double Tap
    useEffect(() => {
        if (stage !== 'reading' || viewState !== 'full' || !pageContainerRef.current) return;
        const container = pageContainerRef.current;

        // Synchronously compute container dimensions to prevent any unscaled frame
        const cW = container.clientWidth;
        const padding = cW < 600 ? 16 : 32;
        const computedFit = Math.max(0.35, Math.min((cW - padding) / 794, 1.2));
        if (computedFit !== fitScale) {
            setFitScale(computedFit);
        }

        // Reset to centered fit on page change, resize, or restore from orb
        const pW = 794 * computedFit;
        const x0 = Math.max(0, (cW - pW) / 2);
        transformRef.current = { scale: 1.0, x: x0, y: 16 };
        applyTransform(false, computedFit);
        setZoomMultiplier(1.0);

        // Smoothly reveal the canvas now that the matrix transform is locked
        if (a4LayerRef.current) {
            a4LayerRef.current.style.opacity = '1';
        }

        const onTouchStart = (e) => {
            const now = Date.now();
            const g = gestureStateRef.current;
            const cRect = container.getBoundingClientRect();

            // Tap-to-Stop: Instantly catch and stop any kinetic momentum
            cancelAnimationFrame(g.momentumRafId);

            if (e.touches.length === 2) {
                if (e.cancelable) e.preventDefault();
                g.mode = 'pinch';
                const t0 = e.touches[0];
                const t1 = e.touches[1];
                g.startDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
                g.startScale = transformRef.current.scale;
                g.startMid = {
                    x: (t0.clientX + t1.clientX) / 2 - cRect.left,
                    y: (t0.clientY + t1.clientY) / 2 - cRect.top
                };
                g.startPos = { x: transformRef.current.x, y: transformRef.current.y };
            } else if (e.touches.length === 1) {
                const t = e.touches[0];
                g.mode = 'pan';
                g.lastPan = { x: t.clientX, y: t.clientY };
                g.history = [{ time: now, x: t.clientX, y: t.clientY }];

                // Double Tap Detection
                const dt = now - g.lastTapTime;
                const distTap = Math.hypot(t.clientX - g.lastTapPos.x, t.clientY - g.lastTapPos.y);
                if (dt < 300 && distTap < 25) {
                    if (e.cancelable) e.preventDefault();
                    g.lastTapTime = 0;
                    const tapX = t.clientX - cRect.left;
                    const tapY = t.clientY - cRect.top;

                    if (transformRef.current.scale > 1.2) {
                        const targetScale = 1.0;
                        const initialW = 794 * fitScale;
                        const currentScale = transformRef.current.scale;
                        const py = (tapY - transformRef.current.y) / (currentScale * fitScale);
                        const nx = (cRect.width - initialW) / 2;
                        const ny = tapY - py * (targetScale * fitScale);
                        const clamped = clampPosition(nx, ny, targetScale);
                        transformRef.current = { scale: targetScale, x: clamped.x, y: clamped.y };
                        applyTransform(true);
                        setZoomMultiplier(1.0);
                    } else {
                        const targetScale = 2.2;
                        const currentScale = transformRef.current.scale;
                        const px = (tapX - transformRef.current.x) / (currentScale * fitScale);
                        const py = (tapY - transformRef.current.y) / (currentScale * fitScale);
                        const newX = cRect.width / 2 - px * (targetScale * fitScale);
                        const newY = cRect.height / 2 - py * (targetScale * fitScale);
                        const clamped = clampPosition(newX, newY, targetScale);
                        transformRef.current = { scale: targetScale, x: clamped.x, y: clamped.y };
                        applyTransform(true);
                        setZoomMultiplier(targetScale);
                    }
                } else {
                    g.lastTapTime = now;
                    g.lastTapPos = { x: t.clientX, y: t.clientY };
                }
            }
        };

        const onTouchMove = (e) => {
            const g = gestureStateRef.current;
            const cRect = container.getBoundingClientRect();
            const now = Date.now();

            if (g.mode === 'pinch' && e.touches.length >= 2) {
                if (e.cancelable) e.preventDefault();
                const t0 = e.touches[0];
                const t1 = e.touches[1];
                const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
                const midX = (t0.clientX + t1.clientX) / 2 - cRect.left;
                const midY = (t0.clientY + t1.clientY) / 2 - cRect.top;

                const ratio = dist / (g.startDist || 1);
                const newScale = Math.min(4.5, Math.max(0.85, g.startScale * ratio));

                const px = (g.startMid.x - g.startPos.x) / (g.startScale * fitScale);
                const py = (g.startMid.y - g.startPos.y) / (g.startScale * fitScale);

                const newX = midX - px * (newScale * fitScale);
                const newY = midY - py * (newScale * fitScale);

                transformRef.current = { scale: newScale, x: newX, y: newY };
                applyTransform(false);
            } else if (g.mode === 'pan' && e.touches.length === 1) {
                if (e.cancelable) e.preventDefault();
                const t = e.touches[0];
                const dx = t.clientX - g.lastPan.x;
                const dy = t.clientY - g.lastPan.y;
                g.lastPan = { x: t.clientX, y: t.clientY };

                // Track rolling touch history for kinetic release velocity
                g.history = g.history.filter(h => now - h.time < 100);
                g.history.push({ time: now, x: t.clientX, y: t.clientY });

                const targetScale = transformRef.current.scale;
                const nextX = transformRef.current.x + dx;
                const nextY = transformRef.current.y + dy;
                const clamped = clampPosition(nextX, nextY, targetScale);

                transformRef.current.x = clamped.x;
                transformRef.current.y = clamped.y;
                applyTransform(false);
            }
        };

        const onTouchEnd = (e) => {
            const g = gestureStateRef.current;
            const now = Date.now();

            if (e.touches.length === 1) {
                g.mode = 'pan';
                g.lastPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                g.history = [{ time: now, x: e.touches[0].clientX, y: e.touches[0].clientY }];
            } else if (e.touches.length === 0) {
                const wasPinching = g.mode === 'pinch';
                g.mode = 'none';

                if (!wasPinching && g.history.length >= 2) {
                    const recent = g.history.filter(h => now - h.time <= 65);
                    if (recent.length >= 2) {
                        const first = recent[0];
                        const last = recent[recent.length - 1];
                        const dt = Math.max(12, last.time - first.time);
                        const rawVx = (last.x - first.x) / dt;
                        const rawVy = (last.y - first.y) / dt;
                        const speed = Math.hypot(rawVx, rawVy);

                        if (speed > 0.12) {
                            // Dynamic Kinetic Force: higher speeds amplify momentum distance
                            const kineticMultiplier = 20 + Math.min(18, speed * 7);
                            g.velocity = {
                                vx: rawVx * kineticMultiplier,
                                vy: rawVy * kineticMultiplier
                            };
                            runMomentum();
                            return;
                        }
                    }
                }

                const targetScale = Math.min(4.5, Math.max(1.0, transformRef.current.scale));
                const clamped = clampPosition(transformRef.current.x, transformRef.current.y, targetScale);
                transformRef.current = { scale: targetScale, x: clamped.x, y: clamped.y };
                applyTransform(true);
                setZoomMultiplier(targetScale);
            }
        };

        const onWheel = (e) => {
            e.preventDefault();
            const cRect = container.getBoundingClientRect();
            const mouseX = e.clientX - cRect.left;
            const mouseY = e.clientY - cRect.top;

            if (e.ctrlKey || e.metaKey) {
                const zoomFactor = -e.deltaY * 0.012;
                const currentScale = transformRef.current.scale;
                const newScale = Math.min(4.5, Math.max(1.0, currentScale * (1 + zoomFactor)));

                const px = (mouseX - transformRef.current.x) / (currentScale * fitScale);
                const py = (mouseY - transformRef.current.y) / (currentScale * fitScale);

                const newX = mouseX - px * (newScale * fitScale);
                const newY = mouseY - py * (newScale * fitScale);
                const clamped = clampPosition(newX, newY, newScale);

                transformRef.current = { scale: newScale, x: clamped.x, y: clamped.y };
                applyTransform(false);
                setZoomMultiplier(newScale);
            } else {
                const nextX = transformRef.current.x - e.deltaX;
                const nextY = transformRef.current.y - e.deltaY;
                const clamped = clampPosition(nextX, nextY, transformRef.current.scale);
                transformRef.current.x = clamped.x;
                transformRef.current.y = clamped.y;
                applyTransform(false);
            }
        };

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            cancelAnimationFrame(gestureStateRef.current.momentumRafId);
            gestureStateRef.current.isMouseDown = true;
            gestureStateRef.current.lastPan = { x: e.clientX, y: e.clientY };
            gestureStateRef.current.history = [{ time: Date.now(), x: e.clientX, y: e.clientY }];
        };

        const onMouseMove = (e) => {
            if (!gestureStateRef.current.isMouseDown) return;
            const now = Date.now();
            const dx = e.clientX - gestureStateRef.current.lastPan.x;
            const dy = e.clientY - gestureStateRef.current.lastPan.y;
            gestureStateRef.current.lastPan = { x: e.clientX, y: e.clientY };

            gestureStateRef.current.history = gestureStateRef.current.history.filter(h => now - h.time < 100);
            gestureStateRef.current.history.push({ time: now, x: e.clientX, y: e.clientY });

            const targetScale = transformRef.current.scale;
            const nextX = transformRef.current.x + dx;
            const nextY = transformRef.current.y + dy;
            const clamped = clampPosition(nextX, nextY, targetScale);
            transformRef.current.x = clamped.x;
            transformRef.current.y = clamped.y;
            applyTransform(false);
        };

        const onMouseUp = () => {
            if (!gestureStateRef.current.isMouseDown) return;
            gestureStateRef.current.isMouseDown = false;
            const now = Date.now();
            const recent = gestureStateRef.current.history.filter(h => now - h.time <= 65);
            if (recent.length >= 2) {
                const first = recent[0];
                const last = recent[recent.length - 1];
                const dt = Math.max(12, last.time - first.time);
                const rawVx = (last.x - first.x) / dt;
                const rawVy = (last.y - first.y) / dt;
                const speed = Math.hypot(rawVx, rawVy);

                if (speed > 0.12) {
                    const kineticMultiplier = 20 + Math.min(18, speed * 7);
                    gestureStateRef.current.velocity = {
                        vx: rawVx * kineticMultiplier,
                        vy: rawVy * kineticMultiplier
                    };
                    runMomentum();
                }
            }
        };

        container.addEventListener('touchstart', onTouchStart, { passive: false });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.addEventListener('touchend', onTouchEnd, { passive: false });
        container.addEventListener('touchcancel', onTouchEnd, { passive: false });
        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        return () => {
            cancelAnimationFrame(gestureStateRef.current.momentumRafId);
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
            container.removeEventListener('touchcancel', onTouchEnd);
            container.removeEventListener('wheel', onWheel);
            container.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [stage, activePageIndex, fitScale, viewState, isLoadingPages, sectionPages, isReadingRevealed]);

    // 3.45. Observe Active Page During Vertical Scroll
    useEffect(() => {
        if (stage !== 'reading' || !pageContainerRef.current || sectionPages.length === 0) return;
        const pageEls = pageContainerRef.current.querySelectorAll('.ml-continuous-page');
        if (pageEls.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pNum = entry.target.getAttribute('data-page-number');
                    if (pNum) setActivePageNum(pNum);
                }
            });
        }, { root: pageContainerRef.current, threshold: 0.15 });

        pageEls.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, [stage, sectionPages, viewState]);

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
            if (stage === 'reading') setIsReadingRevealed(true);
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

            // Strict Backend Pre-Flight Verification (Source of Truth)
            try {
                const { data: freshProfile, error: profileErr } = await supabase
                    .from('profiles')
                    .select('is_pro, linkoin_balance, pro_expires_at')
                    .eq('id', sessionUser.id)
                    .maybeSingle();

                if (!profileErr && freshProfile) {
                    const isPro = Boolean(freshProfile.is_pro && (!freshProfile.pro_expires_at || new Date(freshProfile.pro_expires_at) > new Date()));
                    const hasCredits = (freshProfile.linkoin_balance || 0) >= 2;

                    if (!isPro && !hasCredits) {
                        console.warn("[Miron Live] Backend pre-flight credit check failed. Triggering paywall.");
                        isHangingUpRef.current = true;
                        window.dispatchEvent(new CustomEvent('open-premium-modal'));
                        onClose();
                        return;
                    }
                }
            } catch (err) {
                console.error("[Miron Live] Pre-flight credit verification error:", err);
            }

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

                    // E. Live Highlight Preload Queue & Green Light Synchronization
                    if (payload.type === "preload_highlights" && Array.isArray(payload.queue)) {
                        bufferedHighlightsRef.current = payload.queue;
                    }

                    if (payload.type === "green_light_chunk" && payload.chunk_index !== undefined) {
                        const match = (bufferedHighlightsRef.current || []).find(h => h.chunk_index === payload.chunk_index);
                        if (match && match.highlight) {
                            setActiveHighlight(match.highlight);
                        }
                    }

                    if (payload.type === "page_turn" && payload.page_number) {
                        const targetPageNum = payload.page_number;
                        setActivePageNum(targetPageNum);
                        setActiveHighlight(null);

                        setSectionPages(prevPages => {
                            const exists = prevPages.some(p => p.page_number === targetPageNum);
                            if (!exists && selectedBook?.id) {
                                supabase
                                    .from('book_pages')
                                    .select('id, page_number, content_json')
                                    .eq('book_id', selectedBook.id)
                                    .gte('page_number', targetPageNum)
                                    .lte('page_number', targetPageNum + 5)
                                    .order('page_number', { ascending: true })
                                    .then(({ data, error }) => {
                                        if (!error && data && data.length > 0) {
                                            setSectionPages(current => {
                                                const existingIds = new Set(current.map(p => p.id));
                                                const newPages = data.filter(p => !existingIds.has(p.id));
                                                return [...current, ...newPages];
                                            });
                                        }
                                    });
                            }
                            return prevPages;
                        });

                        setTimeout(() => {
                            if (!pageContainerRef.current || !a4LayerRef.current) return;
                            const pageEl = a4LayerRef.current.querySelector(`[data-page-number="${targetPageNum}"]`);
                            if (pageEl) {
                                const pageOffsetTop = pageEl.offsetTop;
                                const currentScale = transformRef.current.scale;
                                const effective = fitScale * currentScale;
                                const targetY = -(pageOffsetTop * effective) + 24;
                                const clamped = clampPosition(transformRef.current.x, targetY, currentScale);
                                transformRef.current.y = clamped.y;
                                applyTransform(true);
                            }
                        }, 120);
                    }

                    if (payload.type === "navigate_stage" && payload.stage) {
                        setStage(payload.stage);
                        if (payload.stage === 'course_select') {
                            setSelectedBook(null);
                            setSelectedSection(null);
                            setSectionPages([]);
                            setActiveHighlight(null);
                            bufferedHighlightsRef.current = [];
                        }
                    }

                    // F. Tool Consulting State
                    if (payload.type === "tool_call_state") {
                        setIsConsulting(payload.executing);
                    }

                    // G. Billing Alert & Circuit Breaker
                    if (payload.event === "billing_error" || (payload.error && payload.error.toLowerCase().includes('insufficient_credits'))) {
                        isHangingUpRef.current = true;
                        if (reconnectTimer) clearTimeout(reconnectTimer);
                        setIsConnected(false);
                        setIsMironSpeaking(false);
                        window.dispatchEvent(new CustomEvent('open-premium-modal'));
                        setTranscripts(prev => [...prev, {
                            id: Date.now(),
                            role: 'miron',
                            text: "You have used all your LinkUp Credits for live voice study sessions. Upgrade to LinkUp Gold for unlimited AI stages.",
                            isFinal: true,
                            isBroke: true
                        }]);
                        try {
                            ws.close(1000, "Insufficient credits");
                        } catch (e) {}
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
        if (!selectedBook || !selectedSection || isLoadingPages) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: "interrupt" }));
        }
        setIsLoadingPages(true);

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
            setActivePageNum(validPages[0]?.page_number || null);
            setIsLoadingPages(false);
            setStage('reading');
            setIsReadingRevealed(false);
            bufferedHighlightsRef.current = [];

            clearTimeout(readingTimeoutRef.current);
            readingTimeoutRef.current = setTimeout(() => {
                setIsReadingRevealed(true);
            }, 6000);

            // Semantic handoff: Backend DO takes full ownership of kickoff orchestration
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    action: "confirm_start_reading",
                    book_id: selectedBook.id,
                    course_code: selectedBook.course_code || selectedBook.title,
                    section_title: selectedSection.title,
                    page_number: physicalStart
                }));
            }
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
        clearTimeout(readingTimeoutRef.current);
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
                    {stage === 'reading' ? (
                        <div className="ml-reading-header-controls">
                            <span className="ml-hdr-page-title">
                                {selectedBook?.course_code || 'Book'}
                                {activePageNum ? ` • p.${activePageNum}` : (sectionPages[0]?.page_number ? ` • p.${sectionPages[0].page_number}` : '')}
                            </span>
                        </div>
                    ) : (
                        <span>
                            {!isConnected ? 'Connecting to Miron...' :
                             stage === 'course_select' ? 'Select a Course' : 
                             stage === 'toc_select' ? (selectedBook?.course_code || selectedBook?.title) :
                             'Ready to Study'}
                        </span>
                    )}
                    {isConnected && stage !== 'reading' && (
                        <span className="ml-voice-status-pill">
                            <i className="fas fa-headphones-simple"></i>
                            <span>Live Voice</span>
                        </span>
                    )}
                </div>

                <div className="ml-header-right">
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
                                                <button 
                                                    className="ml-start-grind-btn" 
                                                    onClick={handleConfirmStartReading}
                                                    disabled={isLoadingPages}
                                                >
                                                    {isLoadingPages ? (
                                                        <>
                                                            <i className="fas fa-circle-notch fa-spin"></i>
                                                            <span>Preparing Session...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span>Start Reading with Miron</span>
                                                            <i className="fas fa-arrow-right"></i>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                )}

                                {stage === 'reading' && (
                                    <div className="ml-reader-workspace">
                                        <div className="ml-page-viewport" ref={pageContainerRef}>
                                            {!isReadingRevealed || isLoadingPages ? (
                                                <div className="ml-a4-skeleton-page skeleton">
                                                    <div className="ml-skeleton-box" style={{ width: '28%', height: '14px', marginBottom: '24px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '82%', height: '28px', marginBottom: '14px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '48%', height: '16px', marginBottom: '32px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '98%', height: '13px', marginBottom: '8px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '94%', height: '13px', marginBottom: '8px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '91%', height: '13px', marginBottom: '8px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '65%', height: '13px', marginBottom: '28px' }}></div>
                                                    <div className="ml-skeleton-box ml-skeleton-formula-box" style={{ width: '100%', height: '96px', marginBottom: '28px', borderRadius: '10px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '97%', height: '13px', marginBottom: '8px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '93%', height: '13px', marginBottom: '8px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '88%', height: '13px', marginBottom: '8px' }}></div>
                                                    <div className="ml-skeleton-box" style={{ width: '42%', height: '13px' }}></div>
                                                </div>
                                            ) : sectionPages && sectionPages.length > 0 ? (
                                                (() => {
                                                    const bookPrefix = selectedBook?.course_code ? (COURSE_PREFIX_MAP[selectedBook.course_code.toUpperCase().trim()] || '') : '';
                                                    const engineClass = bookPrefix ? `engine-${bookPrefix}` : 'engine-universal';
                                                    return (
                                                        <div 
                                                            ref={a4LayerRef}
                                                            className="ml-a4-layer"
                                                            style={{
                                                                width: '794px',
                                                                transformOrigin: '0 0',
                                                                opacity: 0,
                                                                transition: 'opacity 0.18s ease'
                                                            }}
                                                        >
                                                            {sectionPages.map((page, pIdx) => (
                                                                <div 
                                                                    key={page.id || pIdx} 
                                                                    className="ml-continuous-page"
                                                                    data-page-number={page.page_number}
                                                                >
                                                                    <div className="ml-page-number-strip">
                                                                        <span>Page {page.page_number}</span>
                                                                    </div>
                                                                    <div className={`page-wrapper ${engineClass}`} data-page-number={page.page_number}>
                                                                        <div className={`page-canvas ${engineClass}`}>
                                                                            {(page.content_json || []).map((block, idx) => (
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
                                                            ))}
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
                                        <button className="mcoc-upgrade-btn" onClick={() => window.dispatchEvent(new CustomEvent('open-premium-modal'))}>
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