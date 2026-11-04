import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePlatform, supabase, getComponent, getCachedBook } from '@linkup-platform/sdk-core';
import FloatingMironOrb from './FloatingMironOrb.jsx';
import MironConnectionRing from './MironConnectionRing.jsx';
import './MironLiveSession.css';

const formatTime = (secs) => {
    if (isNaN(secs) || secs <= 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const proxyUrl = (url) => {
    if (!url) return url;
    return url.replace(/https:\/\/[^/]+\.supabase\.co/gi, 'https://linkup-gateway.getyeteklu2.workers.dev');
};

const parseBulletItem = (rawText) => {
    if (!rawText) return { glyph: '—', content: '' };
    const trimmed = rawText.trim();

    // 1. Numbered lists (e.g. "1.", "2)", "10.")
    const numMatch = trimmed.match(/^(\d+[\.\)])\s*(.*)$/);
    if (numMatch) {
        return { glyph: numMatch[1], content: numMatch[2] || '' };
    }

    // 2. Common symbols and emojis
    const bulletSymbols = ['•', '·', '◦', '‣', '⁃', '-', '*', '⚡', '✔', '✖', '→', '>', '▶', '■', '◆', '👉', '💡', '📝', '📌'];
    for (const sym of bulletSymbols) {
        if (trimmed.startsWith(sym)) {
            return { glyph: sym, content: trimmed.slice(sym.length).trim() };
        }
    }

    return { glyph: '—', content: trimmed };
};

const MironLiveSession = ({ onClose, mironAvatarUrl }) => {
    const { t } = usePlatform();
    const renderBookBlock = getComponent('book-block-renderer');

    // Navigation & Data State
    // 'course_select' | 'toc_select' | 'studio'
    const [stage, setStage] = useState('course_select');
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedSection, setSelectedSection] = useState(null);
    const [expandedChapters, setExpandedChapters] = useState(new Set([0]));
    
    // Audio Lesson & Visual Asset Cache
    const [audioLesson, setAudioLesson] = useState(null);
    const [visualAssets, setVisualAssets] = useState({});
    const [sectionPages, setSectionPages] = useState([]);
    const [isLoadingLesson, setIsLoadingLesson] = useState(false);
    const [availableLessonSections, setAvailableLessonSections] = useState(new Set());

    // Studio Player State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [viewMode, setViewMode] = useState('cinema'); // 'cinema' | 'anchor'
    const [pinnedBlockIndex, setPinnedBlockIndex] = useState(0);
    const [viewState, setViewState] = useState('full');

    const audioRef = useRef(null);
    const rafIdRef = useRef(null);
    const progressBarRef = useRef(null);
    const pendingSeekTimeRef = useRef(0);
    const cinemaContainerRef = useRef(null);
    const cameraAnimRef = useRef(null);

    // 1. Hydrate Published Curriculum Books & Lesson Availability
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
            .select('id, title, course_code, toc, cover_url, page_offset, custom_css, icon, friendly_name, prefix')
            .eq('is_published', true)
            .order('title', { ascending: true })
            .then(({ data }) => {
                if (data) setBooks(data);
            });

        // Scan available ready audio lessons (including multi-section chapter tracks)
        supabase
            .from('book_audio_lessons')
            .select('id, book_id, section_title, sections_manifest')
            .eq('status', 'ready')
            .then(({ data }) => {
                if (data) {
                    const keys = new Set();
                    data.forEach(d => {
                        keys.add(`${d.book_id}::${d.section_title}`);
                        if (Array.isArray(d.sections_manifest)) {
                            d.sections_manifest.forEach(s => {
                                if (s.title) keys.add(`${d.book_id}::${s.title}`);
                                if (s.section_tag) keys.add(`${d.book_id}::${s.section_tag}`);
                            });
                        }
                    });
                    setAvailableLessonSections(keys);
                }
            });
    }, []);

    // 2. High-Precision Audio Sync Loop (60 FPS)
    useEffect(() => {
        const updateTick = () => {
            if (audioRef.current && !audioRef.current.paused) {
                const cur = audioRef.current.currentTime;
                setCurrentTime(cur);

                if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
                    setDuration(audioRef.current.duration);
                }
            }
            rafIdRef.current = requestAnimationFrame(updateTick);
        };

        if (isPlaying) {
            rafIdRef.current = requestAnimationFrame(updateTick);
        } else {
            cancelAnimationFrame(rafIdRef.current);
        }

        return () => cancelAnimationFrame(rafIdRef.current);
    }, [isPlaying]);

    // 3. Dynamic Custom Book CSS Injection for Anchor Mode
    useEffect(() => {
        if (selectedBook?.custom_css) {
            let styleTag = document.getElementById('ml-lecture-book-css');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'ml-lecture-book-css';
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = selectedBook.custom_css;
        }

        return () => {
            const el = document.getElementById('ml-lecture-book-css');
            if (el) el.remove();
        };
    }, [selectedBook]);

    // 4. Resolve Active Visual Cue, Node Camera, Continuous HUD Notes & Karaoke Words
    const { activeCue, activeNodeCue, activeBullets } = useMemo(() => {
        if (!audioLesson?.cue_timeline || audioLesson.cue_timeline.length === 0) {
            return { activeCue: null, activeNodeCue: null, activeBullets: [] };
        }
        const timeline = audioLesson.cue_timeline;
        let latestAsset = null;
        let latestNode = null;
        let currentBullets = [];

        for (const cue of timeline) {
            if (cue.time <= currentTime) {
                if (cue.type === 'show_diagram' || cue.type === 'show_image' || cue.type === 'note_card') {
                    if (cue.target && cue.target.includes(':') && !visualAssets[cue.target]) {
                        const [assetKey, nodeKey] = cue.target.split(':');
                        latestAsset = { ...cue, target: assetKey };
                        latestNode = { ...cue, type: 'zoom', target: nodeKey };
                    } else if (cue.target && cue.target.includes('#') && !visualAssets[cue.target]) {
                        const [assetKey, nodeKey] = cue.target.split('#');
                        latestAsset = { ...cue, target: assetKey };
                        latestNode = { ...cue, type: 'zoom', target: nodeKey };
                    } else {
                        latestAsset = cue;
                        latestNode = null;
                    }
                    currentBullets = []; // resets strictly when a new visual asset arrives
                } else if (cue.type === 'zoom' || cue.type === 'focus' || cue.type === 'spotlight') {
                    latestNode = cue;
                    // Intentionally do NOT clear bullets here: lets notes stack below each other as camera tours!
                } else if (cue.type === 'bullet' || cue.type === 'note') {
                    const text = cue.target || '';
                    if (text && !currentBullets.includes(text)) {
                        currentBullets.push(text);
                    }
                } else if (cue.type === 'clear_notes' || cue.type === 'notes:clear' || cue.type === 'section') {
                    currentBullets = [];
                } else if (cue.type === 'anchor_block') {
                    latestAsset = cue;
                    currentBullets = [];
                }
            } else {
                break;
            }
        }
        return { activeCue: latestAsset, activeNodeCue: latestNode, activeBullets: currentBullets };
    }, [audioLesson, currentTime, visualAssets]);

    // Dynamic 60fps ViewBox Camera Interpolator
    const animateViewBox = (svg, targetBoxStr) => {
        if (!svg || !targetBoxStr) return;
        const target = targetBoxStr.trim().split(/\s+/).map(Number);
        if (target.length !== 4 || target.some(isNaN)) return;

        cancelAnimationFrame(cameraAnimRef.current);
        const currentBoxStr = svg.getAttribute('viewBox') || targetBoxStr;
        const start = currentBoxStr.trim().split(/\s+/).map(Number);
        if (start.length !== 4 || start.some(isNaN)) {
            svg.setAttribute('viewBox', targetBoxStr);
            return;
        }

        const startTime = performance.now();
        const duration = 650; // Smooth 650ms camera pan

        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic

            const cur = [
                start[0] + (target[0] - start[0]) * ease,
                start[1] + (target[1] - start[1]) * ease,
                start[2] + (target[2] - start[2]) * ease,
                start[3] + (target[3] - start[3]) * ease
            ];

            svg.setAttribute('viewBox', `${cur[0].toFixed(2)} ${cur[1].toFixed(2)} ${cur[2].toFixed(2)} ${cur[3].toFixed(2)}`);

            if (progress < 1) {
                cameraAnimRef.current = requestAnimationFrame(step);
            }
        };
        cameraAnimRef.current = requestAnimationFrame(step);
    };

    // Camera Director: Synchronizes ViewBox Pan/Zoom & CSS Node Spotlight
    useEffect(() => {
        if (viewMode !== 'cinema') return;
        const container = cinemaContainerRef.current;
        if (!container) return;

        const targetNode = activeNodeCue?.target;
        const cardEl = container.querySelector('.vis-card');

        if (!targetNode || targetNode === 'overview' || targetNode === 'reset') {
            if (cardEl) {
                cardEl.removeAttribute('data-active-node');
                cardEl.querySelectorAll('.vis-node').forEach(n => {
                    n.classList.remove('is-focused');
                    n.removeAttribute('data-is-active');
                });
            }
            const activeSvg = window.innerWidth <= 768
                ? (container.querySelector('svg.vis-mobile') || container.querySelector('svg'))
                : (container.querySelector('svg.vis-desktop') || container.querySelector('svg'));
            if (activeSvg) {
                const defaultView = activeSvg.getAttribute('data-default-view') || '0 0 780 340';
                animateViewBox(activeSvg, defaultView);
            }
            return;
        }

        // 1. Activate CSS Spotlight & Card Glow
        if (cardEl) {
            cardEl.setAttribute('data-active-node', targetNode);
            cardEl.querySelectorAll('.vis-node').forEach(n => {
                const isMatch = n.getAttribute('data-node') === targetNode;
                n.classList.toggle('is-focused', isMatch);
                if (isMatch) n.setAttribute('data-is-active', 'true');
                else n.removeAttribute('data-is-active');
            });
        }

        // 2. Drive ViewBox Camera Pan-and-Zoom
        const activeSvg = window.innerWidth <= 768
            ? (container.querySelector('svg.vis-mobile') || container.querySelector('svg'))
            : (container.querySelector('svg.vis-desktop') || container.querySelector('svg'));

        if (activeSvg) {
            if (!activeSvg.getAttribute('data-default-view')) {
                activeSvg.setAttribute('data-default-view', activeSvg.getAttribute('viewBox') || '0 0 780 340');
            }

            const targetEl = activeSvg.querySelector(`[data-node="${targetNode}"]`);
            if (targetEl) {
                const boxStr = targetEl.getAttribute('data-focus-box');
                if (boxStr) {
                    animateViewBox(activeSvg, boxStr);
                } else {
                    try {
                        const b = targetEl.getBBox();
                        const padX = Math.max(25, b.width * 0.15);
                        const padY = Math.max(25, b.height * 0.15);
                        const calcBox = `${b.x - padX} ${b.y - padY} ${b.width + padX * 2} ${b.height + padY * 2}`;
                        animateViewBox(activeSvg, calcBox);
                    } catch (e) {}
                }
            }
        }
    }, [activeNodeCue, activeCue, viewMode]);

    // Automatic Dual-Mode Switcher: Flips to anchor on block cue, snaps to cinema on visuals
    useEffect(() => {
        if (activeCue) {
            if (activeCue.type === 'anchor_block') {
                const match = String(activeCue.target || '').match(/B(\d+)/i);
                if (match) {
                    setPinnedBlockIndex(parseInt(match[1], 10));
                }
                setViewMode('anchor');
            } else if (activeCue.type === 'show_diagram' || activeCue.type === 'show_image' || activeCue.type === 'note_card') {
                setViewMode('cinema');
            }
        }
    }, [activeCue]);

    // Safe Manifest Parsing & Fallback (Guarantees visible chapter segments)
    const manifest = useMemo(() => {
        let raw = audioLesson?.sections_manifest;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { raw = []; }
        }
        if (Array.isArray(raw) && raw.length > 0) return raw;
        if (duration > 0) {
            return [{
                section_tag: '1.1',
                title: selectedSection?.title || 'Core Lecture',
                start_time: 0,
                end_time: duration,
                duration: duration
            }];
        }
        return [];
    }, [audioLesson, duration, selectedSection]);

    // Active Section Resolution
    const activeSection = useMemo(() => {
        if (manifest.length === 0) return null;
        return manifest.find(s => currentTime >= s.start_time && currentTime <= s.end_time) || manifest[0];
    }, [manifest, currentTime]);

    const handleJumpToSection = (sec) => {
        if (audioRef.current && sec.start_time !== undefined) {
            audioRef.current.currentTime = sec.start_time;
            setCurrentTime(sec.start_time);
        }
    };

    // Live Cue Match & Dispatch Telemetry Logger
    const lastReportedCueRef = useRef(null);
    useEffect(() => {
        if (activeCue !== lastReportedCueRef.current) {
            lastReportedCueRef.current = activeCue;
            if (activeCue) {
                const matchedAsset = visualAssets[activeCue.target];
                if (matchedAsset) {
                    console.log(`🟢 [Miron Visual Cue Fired] Time: ${currentTime.toFixed(2)}s | Target ID: "${activeCue.target}" | Type: ${matchedAsset.asset_type} -> MATCHED!`);
                } else if (activeCue.type === 'note_card') {
                    console.log(`📝 [Miron Note Card Fired] Time: ${currentTime.toFixed(2)}s | Data:`, activeCue.target);
                } else {
                    console.warn(`⚠️ [Miron Cue Missing Asset] Time: ${currentTime.toFixed(2)}s | Cue Target: "${activeCue.target}" was NOT found in loaded visual assets!`, {
                        searchedTarget: activeCue.target,
                        availableAssetKeys: Object.keys(visualAssets)
                    });
                }
            } else if (currentTime > 0) {
                console.log(`⏱️ [Miron Cue] No cue active at ${currentTime.toFixed(2)}s (Showing default soundwave)`);
            }
        }
    }, [activeCue, currentTime, visualAssets]);

    // Active Karaoke Subtitle Window
    const karaokeData = useMemo(() => {
        const words = audioLesson?.word_timestamps;
        if (!Array.isArray(words) || words.length === 0) {
            return { activeWord: '', sentenceSnippet: [] };
        }

        let activeIdx = -1;
        for (let i = 0; i !== words.length; i++) {
            if (currentTime >= words[i].start && currentTime <= words[i].end) {
                activeIdx = i;
                break;
            }
        }

        if (activeIdx === -1) {
            for (let i = 0; i !== words.length; i++) {
                if (words[i].start > currentTime) {
                    activeIdx = Math.max(0, i - 1);
                    break;
                }
            }
        }

        const safeIdx = activeIdx === -1 ? 0 : activeIdx;
        const windowStart = Math.max(0, safeIdx - 5);
        const windowEnd = Math.min(words.length, safeIdx + 7);
        const snippet = words.slice(windowStart, windowEnd);

        return {
            activeWord: words[safeIdx]?.word || '',
            activeWordIdx: safeIdx,
            sentenceSnippet: snippet
        };
    }, [audioLesson, currentTime]);

    // --- NAVIGATION & LESSON LOADER ---
    const handleSelectCourse = (book) => {
        setSelectedBook(book);
        setStage('toc_select');
        setExpandedChapters(new Set([0]));
    };

    const toggleChapterExpand = (chIndex) => {
        setExpandedChapters(prev => {
            const next = new Set(prev);
            if (next.has(chIndex)) next.delete(chIndex);
            else next.add(chIndex);
            return next;
        });
    };

    const handleSelectSection = async (sectionNode, parentChapterTitle) => {
        if (!selectedBook) return;
        setIsLoadingLesson(true);
        setSelectedSection({ ...sectionNode, parentTitle: parentChapterTitle });

        try {
            // 1. Fetch matching Audio Lesson (Direct Title or via Sections Manifest)
            let lesson = null;
            const { data: directMatch } = await supabase
                .from('book_audio_lessons')
                .select('*')
                .eq('book_id', selectedBook.id)
                .eq('section_title', sectionNode.title)
                .eq('status', 'ready')
                .maybeSingle();

            if (directMatch) {
                lesson = directMatch;
            } else {
                // Check if this section sits inside a master chapter audio lesson
                const { data: bookLessons } = await supabase
                    .from('book_audio_lessons')
                    .select('*')
                    .eq('book_id', selectedBook.id)
                    .eq('status', 'ready');

                if (Array.isArray(bookLessons)) {
                    lesson = bookLessons.find(bl => {
                        if (!Array.isArray(bl.sections_manifest)) return false;
                        return bl.sections_manifest.some(s => 
                            (s.title && s.title.toLowerCase() === sectionNode.title.toLowerCase()) ||
                            (s.title && sectionNode.title.toLowerCase().includes(s.title.toLowerCase())) ||
                            (s.section_tag && sectionNode.title.startsWith(s.section_tag))
                        );
                    }) || null;
                }
            }

            // 2. Fetch Visual Assets with Dual Space/Underscore Normalization
            const codeWithSpace = (selectedBook.course_code || '').trim();
            const codeWithUnderscore = codeWithSpace.replace(/\s+/g, '_');

            console.group(`🎨 [Miron Visual Assets Cache] Fetching for "${codeWithSpace}" / "${codeWithUnderscore}"`);

            const { data: assets, error: assetErr } = await supabase
                .from('course_visual_assets')
                .select('*')
                .or(`course_code.eq."${codeWithSpace}",course_code.eq."${codeWithUnderscore}"`);

            if (assetErr) {
                console.error('❌ Failed to fetch from course_visual_assets:', assetErr);
            } else if (!assets || assets.length === 0) {
                console.warn(`⚠️ 0 assets found in course_visual_assets for course_code: ["${codeWithSpace}", "${codeWithUnderscore}"]. Verify that XML diagrams or images are inserted in Supabase!`);
            } else {
                console.log(`📦 Loaded ${assets.length} visual asset(s):`, assets);
            }

            const assetMap = {};
            if (Array.isArray(assets)) {
                assets.forEach(a => {
                    assetMap[a.id] = a;
                    console.log(`   👉 Registered Asset: [${a.asset_type}] ID: "${a.id}" (Section: ${a.section_tag || 'N/A'})`);
                });
            }
            console.groupEnd();
            setVisualAssets(assetMap);

            // 3. Preload Book Page Blocks for Anchor Mode
            const offset = selectedBook.page_offset || 0;
            const logicalStart = sectionNode.page || 1;
            const physicalStart = Math.max(1, logicalStart + offset);

            const { data: pages } = await supabase
                .from('book_pages')
                .select('id, page_number, content_json')
                .eq('book_id', selectedBook.id)
                .eq('page_number', physicalStart)
                .maybeSingle();

            if (pages?.content_json) {
                const raw = pages.content_json;
                const safeBlocks = Array.isArray(raw) ? raw : (raw.blocks || raw.content || Object.values(raw));
                setSectionPages(safeBlocks);
            } else {
                setSectionPages([]);
            }

            if (lesson && lesson.audio_url) {
                // Resolve section offset within master track
                let jumpStartTime = 0;
                if (Array.isArray(lesson.sections_manifest)) {
                    const matchedManifest = lesson.sections_manifest.find(s => 
                        (s.title && s.title.toLowerCase() === sectionNode.title.toLowerCase()) ||
                        (s.title && sectionNode.title.toLowerCase().includes(s.title.toLowerCase())) ||
                        (s.section_tag && sectionNode.title.startsWith(s.section_tag))
                    );
                    if (matchedManifest && matchedManifest.start_time !== undefined) {
                        jumpStartTime = matchedManifest.start_time;
                    }
                }

                pendingSeekTimeRef.current = jumpStartTime;
                setAudioLesson(lesson);
                setDuration(lesson.duration_seconds || 0);
                setCurrentTime(jumpStartTime);
                setStage('studio');
                setViewMode('cinema');

                // If track is already loaded in the audio tag, seek and play immediately
                if (audioRef.current && audioRef.current.src === proxyUrl(lesson.audio_url)) {
                    try {
                        audioRef.current.currentTime = jumpStartTime;
                        audioRef.current.play().catch((err) => {
                            console.warn('⚠️ [Audio Autoplay Blocked]: Tap Play to begin', err.message);
                            setIsPlaying(false);
                        });
                    } catch (e) {}
                }
            } else {
                setAudioLesson(null);
                setStage('studio');
                setIsPlaying(false);
            }
        } catch (err) {
            console.error('Failed to load lesson studio:', err);
        } finally {
            setIsLoadingLesson(false);
        }
    };

    // --- TRANSPORT CONTROLS ---
    const handleTogglePlay = () => {
        if (!audioRef.current) return;
        if (!audioRef.current.paused) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play()
                .then(() => setIsPlaying(true))
                .catch((err) => {
                    console.error('❌ [Audio Playback Failed]:', err);
                    setIsPlaying(false);
                });
        }
    };

    const handleSeek = (e) => {
        if (!progressBarRef.current || !audioRef.current || duration <= 0) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        const targetTime = pct * duration;
        audioRef.current.currentTime = targetTime;
        setCurrentTime(targetTime);
    };

    const handleSkip = (seconds) => {
        if (!audioRef.current) return;
        const target = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
        audioRef.current.currentTime = target;
        setCurrentTime(target);
    };

    const handleCycleSpeed = () => {
        const speeds = [1.0, 1.25, 1.5, 2.0];
        const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
        const nextSpeed = speeds[nextIdx];
        setPlaybackRate(nextSpeed);
        if (audioRef.current) {
            audioRef.current.playbackRate = nextSpeed;
        }
    };

    const handleClose = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
        }
        setIsPlaying(false);
        onClose();
    };

    if (viewState === 'minimized') {
        return (
            <FloatingMironOrb 
                mironAvatarUrl={mironAvatarUrl} 
                isConnected={isPlaying} 
                onClick={() => setViewState('full')} 
            />
        );
    }

    // Resolve Active Visual Item from Cache
    const activeAsset = activeCue ? visualAssets[activeCue.target] : null;

    return (
        <div className="ml-overlay">
            <div className="ml-ambient"></div>

            {/* Hidden Native Audio Element with Full-Spectrum Forensic Probe */}
            {audioLesson?.audio_url && (
                <audio 
                    ref={audioRef}
                    src={proxyUrl(audioLesson.audio_url)}
                    preload="auto"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onLoadStart={() => console.log('⏳ [Audio Element] loadstart triggered:', audioLesson.audio_url)}
                    onCanPlay={() => console.log('🟢 [Audio Element] canplay triggered (Stream buffered)')}
                    onStalled={() => console.warn('⚠️ [Audio Element] stalled (Data not arriving)')}
                    onWaiting={() => console.warn('⚠️ [Audio Element] waiting for more frames')}
                    onError={async (e) => {
                        const targetUrl = proxyUrl(audioLesson.audio_url);
                        const el = audioRef.current;
                        setIsPlaying(false);

                        console.group('🔬 [MIRON AUDIO DEEP DIAGNOSTIC PROBE]');
                        console.error('❌ Native Audio Tag Crashed!');
                        console.log('🔗 Target URL:', targetUrl);
                        console.log('📊 DOM Media Element State:', {
                            networkState: el?.networkState, // 0:EMPTY, 1:IDLE, 2:LOADING, 3:NO_SOURCE
                            readyState: el?.readyState,     // 0:HAVE_NOTHING, 1:HAVE_METADATA...
                            error: el?.error ? {
                                code: el.error.code,
                                message: el.error.message || '(Empty message from browser)',
                                codeMeaning: el.error.code === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED' : el.error.code === 3 ? 'MEDIA_ERR_DECODE' : el.error.code === 2 ? 'MEDIA_ERR_NETWORK' : 'MEDIA_ERR_ABORTED'
                            } : null,
                            currentSrc: el?.currentSrc
                        });

                        // 1. Synthetic Probe for CORS, Content-Type & Headers
                        try {
                            console.log('📡 1. Probing URL via fetch() to inspect HTTP Headers & CORS...');
                            const t0 = performance.now();
                            const res = await fetch(targetUrl, { method: 'GET' });
                            const tDelta = (performance.now() - t0).toFixed(1);

                            const headersObj = {};
                            res.headers.forEach((val, key) => { headersObj[key] = val; });

                            console.log(`📡 Fetch Result (${tDelta}ms) [HTTP ${res.status} ${res.statusText}]:`, {
                                ok: res.ok,
                                type: res.type,
                                headers: headersObj
                            });

                            const cType = res.headers.get('content-type') || '';
                            if (!cType.includes('audio') && !cType.includes('mpeg')) {
                                console.error(`🚨 FATAL MIME MISMATCH: Server returned Content-Type: "${cType}". Browsers will REJECT this as non-audio! Expected "audio/mpeg".`);
                            }

                            // 2. Test Range Request Support (HTTP 206)
                            try {
                                console.log('📡 2. Testing Byte-Range request (Range: bytes=0-1024)...');
                                const rangeRes = await fetch(targetUrl, {
                                    headers: { 'Range': 'bytes=0-1024' }
                                });
                                console.log(`📡 Range Request Status: [HTTP ${rangeRes.status} ${rangeRes.statusText}] (Expected: 206 Partial Content)`);
                                if (rangeRes.status !== 206 && rangeRes.status !== 200) {
                                    console.error('🚨 Range Request Warning: Storage server rejected byte range request!');
                                }
                            } catch (rErr) {
                                console.error('🚨 Range Request fetch failed:', rErr);
                            }

                            // 3. Hardware Bitstream Decoding Test
                            if (res.ok) {
                                console.log('📡 3. Downloading byte buffer to test hardware audio decoder...');
                                const blob = await res.blob();
                                console.log(`📦 Buffer Size: ${(blob.size / 1024).toFixed(1)} KB | Blob Type: "${blob.type}"`);

                                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                                if (AudioCtx) {
                                    const actx = new AudioCtx();
                                    try {
                                        const arrayBuf = await blob.arrayBuffer();
                                        const decoded = await actx.decodeAudioData(arrayBuf);
                                        console.log('🎉 Web Audio Hardware Decoder SUCCESS:', {
                                            sampleRate: decoded.sampleRate,
                                            channels: decoded.numberOfChannels,
                                            duration: `${decoded.duration.toFixed(2)}s`
                                        });
                                        console.log('💡 DIAGNOSIS: The audio file bitstream is 100% VALID. The failure is strictly browser <audio> tag stream negotiation!');
                                    } catch (decErr) {
                                        console.error('💥 Web Audio Hardware Decoder REJECTED bitstream! The MP3 header/framing is corrupt:', decErr);
                                    } finally {
                                        actx.close();
                                    }
                                }
                            } else {
                                const errBody = await res.text();
                                console.error('🚨 Non-200 Server Error Body:', errBody);
                            }
                        } catch (netErr) {
                            console.error('🚨 Fetch Probe Completely Blocked (CORS failure or SSL drop):', netErr);
                        }
                        console.groupEnd();
                    }}
                    onLoadedMetadata={() => {
                        if (audioRef.current) {
                            const seekTo = pendingSeekTimeRef.current || 0;
                            if (seekTo > 0 && Math.abs(audioRef.current.currentTime - seekTo) > 0.5) {
                                audioRef.current.currentTime = seekTo;
                            }
                            setDuration(audioRef.current.duration || audioLesson.duration_seconds || 0);
                            audioRef.current.playbackRate = playbackRate;
                            audioRef.current.play()
                                .then(() => setIsPlaying(true))
                                .catch((err) => {
                                    console.warn('⚠️ [Audio Autoplay Prevented by Browser]: Tap Play to begin lecture', err.message);
                                    setIsPlaying(false);
                                });
                        }
                    }}
                />
            )}

            {/* Top Navigation Bar */}
            <header className="ml-header">
                <div className="ml-header-left">
                    {stage !== 'course_select' && (
                        <button 
                            className="ml-back-btn" 
                            onClick={() => {
                                if (audioRef.current) audioRef.current.pause();
                                setIsPlaying(false);
                                if (stage === 'studio') setStage('toc_select');
                                else if (stage === 'toc_select') setStage('course_select');
                            }}
                            title={t('back', 'Back')}
                        >
                            <i className="fas fa-chevron-left"></i>
                        </button>
                    )}
                </div>

                <div className="ml-header-center">
                    <div className="ml-avatar-mini-container">
                        <MironConnectionRing isConnected={true} />
                        <img 
                            src={mironAvatarUrl} 
                            alt="Miron" 
                            className={`ml-avatar ${isPlaying ? 'is-speaking' : ''}`} 
                        />
                        {isPlaying && (
                            <div className="ml-speaking-eq-pill" title="Miron Speaking">
                                <span className="ml-eq-bar b1"></span>
                                <span className="ml-eq-bar b2"></span>
                                <span className="ml-eq-bar b3"></span>
                                <span className="ml-eq-bar b4"></span>
                            </div>
                        )}
                    </div>

                    <div className="ml-status">
                        {stage === 'studio' ? (
                            <div className="ml-studio-title-pill">
                                <span className="ml-studio-course-tag">{selectedBook?.course_code || 'COURSE'}</span>
                                <span className="ml-studio-section-name">{selectedSection?.title}</span>
                            </div>
                        ) : (
                            <span>
                                {stage === 'course_select' 
                                    ? t('miron_what_studying_today', 'Select a Course') 
                                    : (selectedBook?.title || 'Course')}
                            </span>
                        )}
                    </div>


                </div>

                <div className="ml-header-right">
                    <button className="athena-close" onClick={handleClose} style={{ color: '#ff5f5f' }} title={t('close', 'Close')}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            {/* Interactive Workspace Body */}
            <main className={`ml-classroom-body ${stage}`}>
                {/* Floating Minimize Button */}
                <button 
                    className="ml-page-collapse-btn" 
                    onClick={() => setViewState('minimized')}
                    title={t('minimize_to_orb', 'Minimize to Floating Orb')}
                >
                    <i className="fas fa-compress-alt"></i>
                </button>

                {/* STAGE 0: COURSE SELECT GRID */}
                {stage === 'course_select' && (
                    <div className="ml-stage-content course-grid-stage">
                        <div className="ml-stage-header">
                            <h2>{t('miron_what_studying_today', 'What are we studying today?')}</h2>
                            <p>{t('miron_select_course_desc', 'Select a curriculum textbook to listen to AI-narrated visual lectures.')}</p>
                        </div>

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
                                            <i className={`fa-solid ${b.icon || getCachedBook(b.course_code)?.icon || 'fa-book-open'}`}></i>
                                        </div>
                                        <div className="ml-card-top-tags">
                                            <span className="ml-voice-cue-chip" title="Audio Studio"><i className="fas fa-headphones"></i></span>
                                            <span className="ml-card-code-tag">{b.course_code || 'COURSE'}</span>
                                        </div>
                                    </div>
                                    <h3 className="ml-card-name">{b.title}</h3>
                                    <div className="ml-card-footer">
                                        <span className="ml-card-count">
                                            {b.toc?.length ? `${b.toc.length} Chapters` : 'Curriculum Book'}
                                        </span>
                                        <span className="ml-card-arrow"><i className="fas fa-arrow-right"></i></span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* STAGE 1: TOC ACCORDION WITH AUDIO BADGES */}
                {stage === 'toc_select' && selectedBook && (
                    <div className="ml-stage-content toc-split-stage">
                        <div className="ml-toc-split-layout">
                            {/* Book Showcase Column */}
                            <div className="ml-toc-book-showcase" style={selectedBook.cover_url ? { '--bg-cover': `url("${selectedBook.cover_url}")` } : {}}>
                                <div className="ml-showcase-backdrop-blur"></div>
                                <div className="ml-showcase-cover-wrapper">
                                    {selectedBook.cover_url ? (
                                        <img src={selectedBook.cover_url} className="ml-showcase-cover" alt={selectedBook.title} />
                                    ) : (
                                        <div className="ml-showcase-fallback-cover">
                                            <i className={`fa-solid ${selectedBook.icon || 'fa-book-open'}`}></i>
                                        </div>
                                    )}
                                </div>
                                <div className="ml-showcase-details">
                                    <span className="ml-card-code-tag">{selectedBook.course_code || 'CURRICULUM'}</span>
                                    <h2 className="ml-showcase-title">{selectedBook.title}</h2>
                                    <p className="ml-showcase-meta">{selectedBook.toc?.length || 0} Chapters in Syllabus</p>
                                    <div className="ml-showcase-prompt-tip">
                                        <i className="fas fa-headphones"></i>
                                        <span>Select any section to launch its synchronized audio lecture.</span>
                                    </div>
                                </div>
                            </div>

                            {/* Chapters & Sections Accordion */}
                            <div className="ml-toc-interactive-pane">
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
                                                        {node.children.map((sub, sIdx) => {
                                                            const isReady = availableLessonSections.has(`${selectedBook.id}::${sub.title}`);
                                                            return (
                                                                <div 
                                                                    key={sIdx} 
                                                                    className="ml-toc-section-item" 
                                                                    onClick={() => handleSelectSection(sub, node.title)}
                                                                >
                                                                    <span className="ml-toc-sec-title">
                                                                        <i className={`fas fa-${isReady ? 'circle-play' : 'file-lines'} ml-sec-voice-glyph`}></i>
                                                                        {sub.title}
                                                                    </span>
                                                                    <div className="ml-toc-sec-actions">
                                                                        {isReady && <span className="ml-lesson-ready-badge">Audio Ready</span>}
                                                                        <span className="ml-toc-sec-arrow">
                                                                            {sub.page ? `p.${sub.page}` : ''} <i className="fas fa-arrow-right"></i>
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* STAGE 2: INTERACTIVE SYNCED LECTURE STUDIO */}
                {stage === 'studio' && (
                    <div className="ml-studio-viewport">
                        {isLoadingLesson ? (
                            <div className="ml-studio-loading-screen">
                                <i className="fas fa-circle-notch fa-spin"></i>
                                <span>Loading synchronized lecture track...</span>
                            </div>
                        ) : !audioLesson ? (
                            <div className="ml-studio-empty-card">
                                <div className="ml-empty-icon"><i className="fas fa-microphone-slash"></i></div>
                                <h2>Audio Lecture In Production</h2>
                                <p>This section is scheduled for audio synthesis. You can trigger batch processing or read the textbook directly.</p>
                                <button className="ml-btn-back-toc" onClick={() => setStage('toc_select')}>
                                    <i className="fas fa-chevron-left"></i> Return to Syllabus
                                </button>
                            </div>
                        ) : (
                            <div className={`ml-studio-content-layout ${viewMode}`}>
                                
                                {/* VIEW 1: CINEMA STAGE */}
                                {viewMode === 'cinema' && (
                                    <div 
                                        className="ml-cinema-stage" 
                                        ref={cinemaContainerRef}
                                        data-has-notes={activeBullets.length > 0 ? "true" : "false"}
                                    >
                                        <div className="ml-cinema-visual-frame">
                                            {activeAsset ? (
                                                activeAsset.asset_type === 'diagram_svg' ? (
                                                    <div 
                                                        className="ml-visual-card-svg" 
                                                        dangerouslySetInnerHTML={{ __html: activeAsset.content_payload }} 
                                                    />
                                                ) : (
                                                    <div className="ml-visual-card-image">
                                                        <img src={proxyUrl(activeAsset.image_url)} alt={activeAsset.title || 'Lecture Illustration'} />
                                                        <div className="ml-image-caption-pill">
                                                            <span>{activeAsset.title || 'Scene Concept'}</span>
                                                        </div>
                                                    </div>
                                                )
                                            ) : activeCue?.type === 'note_card' ? (
                                                <div className="ml-visual-card-note">
                                                    <div className="ml-note-badge"><i className="fas fa-bolt"></i> KEY CONCEPT</div>
                                                    <h3>{activeCue.target?.title || 'Core Takeaway'}</h3>
                                                    <p>{activeCue.target?.body || activeCue.target || ''}</p>
                                                </div>
                                            ) : (
                                                <div className="ml-default-soundwave-stage">
                                                    <div className="ml-soundwave-ambient-glow"></div>
                                                    <div className="ml-soundwave-avatar-wrapper">
                                                        <img src={mironAvatarUrl} alt="Miron" className={isPlaying ? 'pulsing' : ''} />
                                                        <div className="ml-soundwave-circle c1"></div>
                                                        <div className="ml-soundwave-circle c2"></div>
                                                    </div>
                                                    <h3 className="ml-soundwave-topic">{selectedSection?.title}</h3>
                                                    <p className="ml-soundwave-sub">Listening to Miron explanation...</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Studio Split-Screen Notes Deck */}
                                        {activeBullets.length > 0 && (
                                            <div className="ml-studio-notes-deck">
                                                <div className="ml-studio-notes-header">
                                                    <span className="ml-studio-notes-badge">
                                                        <i className="fas fa-bolt"></i> CORE TAKEAWAYS
                                                    </span>
                                                    {activeNodeCue?.target && (
                                                        <span className="ml-studio-topic-tag">
                                                            {activeNodeCue.target.replace(/[-_]/g, ' ')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="ml-studio-bullets-stream">
                                                    {activeBullets.map((bullet, bIdx) => {
                                                        const { glyph, content } = parseBulletItem(bullet);
                                                        return (
                                                            <div key={bIdx} className="ml-studio-bullet-row" style={{ animationDelay: `${bIdx * 0.05}s` }}>
                                                                <span className={`ml-studio-bullet-glyph ${/^\d/.test(glyph) ? 'is-number' : ''}`}>
                                                                    {glyph}
                                                                </span>
                                                                <span className="ml-studio-bullet-text">{content}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* VIEW 2: ANCHOR BLOCK SPLIT VIEW */}
                                {viewMode === 'anchor' && (
                                    <div className="ml-anchor-split-workspace">
                                        <div className="ml-pinned-block-card">
                                            <div className="ml-pinned-block-header">
                                                <span><i className="fas fa-thumbtack"></i> Pinned Textbook Block</span>
                                                <span className="ml-pinned-block-tag">Block #{pinnedBlockIndex}</span>
                                            </div>
                                            <div className="ml-pinned-block-content page-canvas">
                                                {sectionPages[pinnedBlockIndex] && renderBookBlock ? (
                                                    renderBookBlock(sectionPages[pinnedBlockIndex], pinnedBlockIndex, {
                                                        bookTitle: selectedBook?.title,
                                                        courseCode: selectedBook?.course_code
                                                    })
                                                ) : (
                                                    <p>{sectionPages[pinnedBlockIndex]?.body || 'Referencing section text...'}</p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="ml-anchor-sub-visual">
                                            {activeAsset ? (
                                                activeAsset.asset_type === 'diagram_svg' ? (
                                                    <div className="ml-visual-card-svg" dangerouslySetInnerHTML={{ __html: activeAsset.content_payload }} />
                                                ) : (
                                                    <div className="ml-visual-card-image">
                                                        <img src={proxyUrl(activeAsset.image_url)} alt="Illustration" />
                                                    </div>
                                                )
                                            ) : (
                                                <div className="ml-anchor-narration-card">
                                                    <i className="fas fa-volume-high"></i>
                                                    <span>Miron is breaking down this specific formula step-by-step.</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* BOTTOM TRANSPORT: COMPACT IMMERSIVE CONTROLS */}
                                <div className="ml-transport-bar">
                                    {/* Row 1: Single-Line Title & Time */}
                                    <div className="ml-chapter-info-row">
                                        <div className="ml-active-section-pill">
                                            <i className="fas fa-bookmark"></i>
                                            <span className="ml-active-sec-text">
                                                {activeSection ? `${activeSection.section_tag ? activeSection.section_tag + ' • ' : ''}${activeSection.title}` : (selectedSection?.title || 'Lecture Track')}
                                            </span>
                                        </div>
                                        <div className="ml-time-display">
                                            <span>{formatTime(currentTime)}</span>
                                            <span className="ml-time-divider">/</span>
                                            <span>{formatTime(duration)}</span>
                                        </div>
                                    </div>

                                    {/* Row 2: Visible YouTube Chapter Segments (Tap to Jump) */}
                                    <div className="ml-chapter-bar" title="Tap any chapter line to jump to section">
                                        {manifest.map((sec, idx) => {
                                            const isPast = currentTime >= sec.end_time;
                                            const isCurrent = currentTime >= sec.start_time && currentTime < sec.end_time;
                                            const progressPct = isPast ? 100 : isCurrent ? Math.min(100, Math.max(0, ((currentTime - sec.start_time) / (sec.duration || 1)) * 100)) : 0;
                                            const widthPct = duration > 0 ? (sec.duration / duration) * 100 : (100 / (manifest.length || 1));

                                            return (
                                                <div 
                                                    key={idx}
                                                    className={`ml-chapter-segment ${isCurrent ? 'active' : ''}`}
                                                    style={{ width: `${Math.max(4, widthPct)}%` }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleJumpToSection(sec);
                                                    }}
                                                    title={`${sec.section_tag ? sec.section_tag + ' ' : ''}${sec.title} (${formatTime(sec.start_time)})`}
                                                >
                                                    <div className="ml-chapter-fill" style={{ width: `${progressPct}%` }}></div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Row 3: Mathematically Centered Controls */}
                                    <div className="ml-transport-row">
                                        <div className="ml-transport-left-spacer"></div>

                                        <div className="ml-center-playback-actions">
                                            <button className="ml-skip-btn" onClick={() => handleSkip(-10)} title="Rewind 10s">
                                                <i className="fas fa-rotate-left"></i>
                                                <span className="ml-skip-label">10</span>
                                            </button>

                                            <button className="ml-main-play-btn" onClick={handleTogglePlay}>
                                                <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i>
                                            </button>

                                            <button className="ml-skip-btn" onClick={() => handleSkip(10)} title="Forward 10s">
                                                <i className="fas fa-rotate-right"></i>
                                                <span className="ml-skip-label">10</span>
                                            </button>
                                        </div>

                                        <div className="ml-right-actions">
                                            <button className="ml-speed-btn" onClick={handleCycleSpeed} title="Playback Speed">
                                                <span>{playbackRate}x</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

export default MironLiveSession;