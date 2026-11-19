import { useState, useEffect, useRef, useMemo } from 'react';

export const formatTime = (secs) => {
    if (isNaN(secs) || secs <= 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const proxyUrl = (url) => {
    if (!url) return url;
    return url.replace(/https:\/\/[^/]+\.supabase\.co/gi, 'https://linkup-gateway.getyeteklu2.workers.dev');
};

export const ensureBlockArray = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.content)) return parsed.content;
                if (Array.isArray(parsed.blocks)) return parsed.blocks;
                return [parsed];
            }
        } catch (e) {
            console.warn('[Miron:JSONParseError] Failed to parse block JSON string:', e.message);
            return [];
        }
    }
    if (typeof raw === 'object') {
        if (Array.isArray(raw.content)) return raw.content;
        if (Array.isArray(raw.blocks)) return raw.blocks;
        const values = Object.values(raw);
        if (values.length > 0 && typeof values[0] === 'object') return values;
        return [raw];
    }
    return [];
};
export const safeJsonParse = (str) => {
    if (!str) return null;
    if (typeof str === 'object') return str;
    if (typeof str !== 'string') return null;
    try {
        return JSON.parse(str);
    } catch (e1) {
        try {
            const sanitized = str
                .replace(/[\r\n\t]+/g, ' ')
                .replace(/[\x00-\x1F\x7F]/g, ' ')
                .trim();
            return JSON.parse(sanitized);
        } catch (e2) {
            try {
                const cleanedCommas = str
                    .replace(/[\r\n\t]+/g, ' ')
                    .replace(/,\s*([\]}])/g, '$1')
                    .trim();
                return JSON.parse(cleanedCommas);
            } catch (e3) {
                console.warn('[Miron:safeJsonParse] Failed to parse JSON even after sanitization:', e3.message, str.slice(0, 100));
                return null;
            }
        }
    }
};

export const parseBulletItem = (rawText) => {
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

const normalizeQuoteText = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const buildFlexiblePhraseRegex = (phrase) => {
    const tokens = normalizeQuoteText(phrase).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const escaped = tokens.map(tok =>
        tok
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/"/g, '["\u201C\u201D]')
            .replace(/'/g, "['\u2018\u2019]")
            .replace(/-/g, '[-\u2013\u2014]')
    );
    return new RegExp(escaped.join('(?:<[^>]+>|\\s)+'), 'i');
};

const resolveVisualAsset = (target, visualAssets) => {
    if (!target || !visualAssets) return null;
    if (visualAssets[target]) return visualAssets[target];
    const trimmed = String(target).trim();
    if (visualAssets[trimmed]) return visualAssets[trimmed];
    if (!/\.png$/i.test(trimmed) && visualAssets[`${trimmed}.png`]) {
        return visualAssets[`${trimmed}.png`];
    }
    const noExt = trimmed.replace(/\.(png|jpg|jpeg|webp|svg)$/i, '');
    if (visualAssets[noExt]) return visualAssets[noExt];
    const lower = trimmed.toLowerCase();
    const lowerNoExt = noExt.toLowerCase();
    for (const [k, v] of Object.entries(visualAssets)) {
        const kl = k.toLowerCase();
        if (kl === lower || kl === `${lower}.png` || kl.replace(/\.(png|jpg|jpeg|webp|svg)$/i, '') === lowerNoExt) {
            return v;
        }
    }
    return null;
};

const findSvgNodeElement = (svg, targetNode) => {
    if (!svg || !targetNode) return null;
    const exact = svg.querySelector(`[data-node="${targetNode}"]`);
    if (exact) return exact;
    const lower = String(targetNode).trim().toLowerCase();
    const candidates = svg.querySelectorAll('[data-node]');
    for (const el of candidates) {
        const attr = (el.getAttribute('data-node') || '').trim().toLowerCase();
        if (attr === lower || attr === `node-${lower}` || `node-${attr}` === lower) {
            return el;
        }
    }
    return null;
};

export const useMironLecture = ({
    audioLesson,
    visualAssets,
    cachedPageBlocks,
    sectionPages,
    selectedSection,
    cinemaContainerRef,
    notesDeckRef,
    viewMode,
    setViewMode,
    setPinnedBlockIndex,
    stage,
    onLessonEnded
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [fitScale, setFitScale] = useState(0.47);
    const [isChromeVisible, setIsChromeVisible] = useState(true);
    const [completedQuizTimes, setCompletedQuizTimes] = useState(new Set());
    const [ccEnabled, setCcEnabled] = useState(true);
    const [isNotesCollapsed, setIsNotesCollapsed] = useState(false);

    const audioRef = useRef(null);
    const progressBarRef = useRef(null);
    const pendingSeekTimeRef = useRef(0);
    const cameraAnimRef = useRef(null);
    const bboxCacheRef = useRef(new Map());
    const rafIdRef = useRef(null);
    const lastFocusedNodeRef = useRef(null);
    const hideTimeoutRef = useRef(null);
    const lastSimTickRef = useRef(performance.now());
    const lastReportedCueRef = useRef(null);

    // Hardware GPU Pre-warming: Pre-decodes cue timeline images into VRAM ahead of time
    useEffect(() => {
        if (!audioLesson?.cue_timeline) return;
        const urlsToWarm = new Set();
        audioLesson.cue_timeline.forEach(cue => {
            if (cue.type === 'show_image' && cue.target) {
                const asset = visualAssets[cue.target];
                const rawUrl = asset?.image_url || cue.target;
                if (rawUrl) urlsToWarm.add(proxyUrl(rawUrl));
            }
        });

        urlsToWarm.forEach(url => {
            const img = new Image();
            img.src = url;
            if (typeof img.decode === 'function') {
                img.decode().catch(() => {});
            }
        });
    }, [audioLesson, visualAssets]);

    // High-Precision Audio & Simulator Sync Loop (60 FPS Locked RAF)
    useEffect(() => {
        const updateTick = () => {
            const now = performance.now();
            const delta = (now - lastSimTickRef.current) / 1000;
            lastSimTickRef.current = now;

            if (audioRef.current && audioLesson?.audio_url && !audioRef.current.paused) {
                const cur = audioRef.current.currentTime;
                setCurrentTime(cur);

                if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
                    setDuration(audioRef.current.duration);
                }
            } else if (isPlaying && (!audioLesson?.audio_url || !audioRef.current?.src)) {
                // Audio-free Simulator Delta Engine
                setCurrentTime(prev => {
                    const next = prev + delta * playbackRate;
                    if (duration > 0 && next >= duration) {
                        setIsPlaying(false);
                        return duration;
                    }
                    return next;
                });
            }
            rafIdRef.current = requestAnimationFrame(updateTick);
        };

        if (isPlaying) {
            lastSimTickRef.current = performance.now();
            rafIdRef.current = requestAnimationFrame(updateTick);
        } else {
            cancelAnimationFrame(rafIdRef.current);
        }

        return () => cancelAnimationFrame(rafIdRef.current);
    }, [isPlaying, audioLesson, duration, playbackRate]);

    // Ghost Chrome Inactivity Engine (Mobile/Compact Only; Desktop stays docked)
    const resetInactivityTimer = () => {
        setIsChromeVisible(true);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
        if (isPlaying) {
            hideTimeoutRef.current = setTimeout(() => {
                setIsChromeVisible(false);
            }, 3500);
        }
    };

    useEffect(() => {
        if (!isPlaying) {
            setIsChromeVisible(true);
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        } else {
            resetInactivityTimer();
        }
        return () => {
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
    }, [isPlaying]);

    // Resolve Dual-Stage Cues (Diagram + Supporting Image), Camera & Persistent Notes
    const { activeDiagramCue, activeImageCue, activeNodeCue, activeBlockCue, activeBullets, activeQuizCue, activeCardCue } = useMemo(() => {
        if (!audioLesson?.cue_timeline || audioLesson.cue_timeline.length === 0) {
            return { activeDiagramCue: null, activeImageCue: null, activeNodeCue: null, activeBlockCue: null, activeBullets: [], activeQuizCue: null, activeCardCue: null };
        }
        const timeline = audioLesson.cue_timeline;
        let latestDiagram = null;
        let latestImage = null;
        let latestNode = null;
        let latestBlock = null;
        let latestQuiz = null;
        let latestCard = null;
        let currentBullets = [];
        let stageFocus = 'none'; // 'none' | 'diagram' | 'book' | 'image' | 'card'

        for (const cue of timeline) {
            if (cue.time <= currentTime) {
                if (cue.type === 'quiz' || cue.type === 'interactive_quiz') {
                    latestQuiz = cue;
                } else if (cue.type === 'card' || cue.type === 'intro' || cue.type === 'summary') {
                    latestCard = cue;
                    latestDiagram = null;
                    latestImage = null;
                    latestNode = null;
                    latestBlock = null;
                    stageFocus = 'card';
                } else if (cue.type === 'show_diagram') {
                    latestCard = null;
                    latestBlock = null;
                    stageFocus = 'diagram';
                    if (cue.target && cue.target.includes(':') && !resolveVisualAsset(cue.target, visualAssets)) {
                        const [assetKey, nodeKey] = cue.target.split(':');
                        latestDiagram = { ...cue, target: assetKey };
                        latestNode = { ...cue, type: 'zoom', target: nodeKey };
                    } else if (cue.target && cue.target.includes('#') && !resolveVisualAsset(cue.target, visualAssets)) {
                        const [assetKey, nodeKey] = cue.target.split('#');
                        latestDiagram = { ...cue, target: assetKey };
                        latestNode = { ...cue, type: 'zoom', target: nodeKey };
                    } else {
                        latestDiagram = cue;
                        latestNode = null;
                    }
                    latestImage = null;
                } else if (cue.type === 'clear_diagram' || cue.type === 'diagram:clear' || cue.type === 'hide_diagram') {
                    latestDiagram = null;
                    latestNode = null;
                    if (stageFocus === 'diagram') stageFocus = latestImage ? 'image' : 'none';
                } else if (cue.type === 'show_image') {
                    latestImage = cue;
                    latestCard = null;
                    if (stageFocus !== 'book') {
                        stageFocus = latestDiagram ? 'diagram' : 'image';
                    }
                } else if (cue.type === 'clear_image' || cue.type === 'image:clear' || cue.type === 'reset_image') {
                    latestImage = null;
                } else if (cue.type === 'clear_page' || cue.type === 'clear_block' || cue.type === 'page:clear' || cue.type === 'block:clear' || cue.type === 'unpin') {
                    latestBlock = null;
                    if (stageFocus === 'book') stageFocus = latestDiagram ? 'diagram' : (latestImage ? 'image' : 'none');
                } else if (cue.type === 'overview' || cue.type === 'zoom_reset') {
                    latestNode = { ...cue, type: 'zoom', target: 'overview' };
                    latestImage = null;
                    latestCard = null;
                    if (latestDiagram) stageFocus = 'diagram';
                } else if (cue.type === 'zoom' || cue.type === 'focus' || cue.type === 'spotlight') {
                    latestNode = cue;
                    latestCard = null;
                    if (cue.target === 'overview' || cue.target === 'reset' || cue.target === 'none') {
                        latestImage = null;
                    }
                    if (latestDiagram) stageFocus = 'diagram';
                } else if (cue.type === 'bullet' || cue.type === 'note' || cue.type === 'takeaway') {
                    const text = cue.target || '';
                    if (text && !currentBullets.includes(text)) {
                        currentBullets.push(text);
                    }
                } else if (cue.type === 'clear_notes' || cue.type === 'notes:clear' || cue.type === 'clear_bullets') {
                    currentBullets = [];
                } else if (cue.type === 'section' || cue.type === 'sub_section' || cue.type === 'subsection') {
                    currentBullets = [];
                    latestImage = null;
                    latestBlock = null;
                    latestDiagram = null;
                    latestNode = null;
                    latestCard = null;
                    stageFocus = 'none';
                } else if (cue.type === 'clear_all' || cue.type === 'reset_stage') {
                    currentBullets = [];
                    latestImage = null;
                    latestBlock = null;
                    latestDiagram = null;
                    latestNode = null;
                    latestCard = null;
                    stageFocus = 'none';
                } else if (['page_block', 'show_page', 'page', 'highlight', 'block', 'anchor_block'].includes(cue.type)) {
                    const rawTarget = String(cue.target || '').trim();
                    const parts = rawTarget.split(':');
                    let pageNum = null;
                    let blockIdx = 0;
                    let sentenceTarget = null;

                    if (parts.length === 1) {
                        const p = parseInt(parts[0], 10);
                        if (!isNaN(p)) pageNum = p;
                    } else if (parts.length === 2) {
                        pageNum = parseInt(parts[0], 10);
                        const b = parseInt(parts[1], 10);
                        if (!isNaN(b)) {
                            blockIdx = b;
                        } else {
                            sentenceTarget = parts.slice(1).join(':').trim();
                        }
                    } else if (parts.length >= 3) {
                        pageNum = parseInt(parts[0], 10);
                        const b = parseInt(parts[1], 10);
                        blockIdx = isNaN(b) ? 0 : b;
                        const rawSent = parts.slice(2).join(':').trim();
                        const sNum = parseInt(rawSent, 10);
                        sentenceTarget = (!isNaN(sNum) && String(sNum) === rawSent) ? sNum : rawSent;
                    } else if (rawTarget.match(/^B(\d+)/i)) {
                        blockIdx = parseInt(rawTarget.match(/^B(\d+)/i)[1], 10);
                    }

                    // Clear diagram-owned specimen photo when flipping from diagram to textbook page
                    if (stageFocus === 'diagram') {
                        latestImage = null;
                    }
                    latestBlock = {
                        page: pageNum,
                        blockIndex: isNaN(blockIdx) ? 0 : blockIdx,
                        sentenceIndex: typeof sentenceTarget === 'number' ? sentenceTarget : null,
                        sentencePhrase: typeof sentenceTarget === 'string' && sentenceTarget ? sentenceTarget : null,
                        rawTarget: rawTarget,
                        time: cue.time
                    };
                    latestCard = null;
                    stageFocus = 'book';
                }
            } else {
                break;
            }
        }

        const effectiveDiagramCue = (stageFocus === 'diagram' || (stageFocus === 'image' && latestDiagram)) ? latestDiagram : null;
        const effectiveBlockCue = (stageFocus === 'book') ? latestBlock : null;

        return { 
            activeDiagramCue: effectiveDiagramCue, 
            activeImageCue: latestImage, 
            activeNodeCue: effectiveDiagramCue ? latestNode : null, 
            activeBlockCue: effectiveBlockCue, 
            activeBullets: currentBullets || [],
            activeQuizCue: latestQuiz,
            activeCardCue: latestCard
        };
    }, [audioLesson, currentTime, visualAssets]);

    const activeCue = activeImageCue || activeDiagramCue;

    // Resolve Active Visual Items & Page Block from Cache (Forgiving Filename/Case Lookup)
    const activeDiagramAsset = activeDiagramCue ? resolveVisualAsset(activeDiagramCue.target, visualAssets) : null;
    const activeImageAsset = activeImageCue ? (resolveVisualAsset(activeImageCue.target, visualAssets) || (
        /^https?:\/\//i.test(activeImageCue.target || '') ? {
            asset_type: 'image',
            image_url: activeImageCue.target,
            title: activeImageCue.target
        } : null
    )) : null;

    // Resolve Active Page Block data (Full Page Canvas with Sentence Highlighting)
    const activeBlockData = useMemo(() => {
        if (!activeBlockCue) return null;
        const targetPage = activeBlockCue.page || selectedSection?.page || 1;
        const pageBlocks = cachedPageBlocks[targetPage] || sectionPages || [];
        if (!pageBlocks || pageBlocks.length === 0) return null;

        let effectiveBlockIdx = activeBlockCue.blockIndex;
        const phrase = activeBlockCue.sentencePhrase;

        // Auto-locate block if a phrase is provided (supports smart quotes, whitespace & HTML tags)
        if (phrase) {
            const normPhrase = normalizeQuoteText(phrase).toLowerCase();
            const flexRe = buildFlexiblePhraseRegex(phrase);
            const blockMatchesPhrase = (blk) => {
                const rawText = typeof blk?.body === 'string'
                    ? blk.body
                    : (Array.isArray(blk?.items) ? blk.items.map(it => typeof it === 'string' ? it : (it?.text || '')).join(' ') : '');
                const normText = normalizeQuoteText(rawText).toLowerCase();
                const strippedText = normalizeQuoteText(rawText.replace(/<[^>]+>/g, ' ')).toLowerCase();
                return normText.includes(normPhrase) || strippedText.includes(normPhrase) || (flexRe ? flexRe.test(rawText) : false);
            };
            const curBlock = pageBlocks[effectiveBlockIdx];
            if (!blockMatchesPhrase(curBlock)) {
                const found = pageBlocks.findIndex(blockMatchesPhrase);
                if (found !== -1) effectiveBlockIdx = found;
            }
        }

        const processedBlocks = pageBlocks.map((b, idx) => {
            if (idx !== effectiveBlockIdx) return b;

            // 1. Highlight by Exact or Quote/Whitespace-Normalized Match
            if (phrase) {
                const cloned = JSON.parse(JSON.stringify(b));
                const lowerPhrase = phrase.toLowerCase();
                const normPhrase = normalizeQuoteText(phrase).toLowerCase();
                const flexRe = buildFlexiblePhraseRegex(phrase);

                if (typeof cloned.body === 'string' && cloned.body.trim()) {
                    const sentences = cloned.body.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
                    if (sentences) {
                        let matched = false;
                        for (let i = 0; i < sentences.length; i++) {
                            const sNorm = normalizeQuoteText(sentences[i].replace(/<[^>]+>/g, ' ')).toLowerCase();
                            if (sentences[i].toLowerCase().includes(lowerPhrase) || sNorm.includes(normPhrase) || (flexRe && flexRe.test(sentences[i]))) {
                                const s = sentences[i];
                                sentences[i] = `<mark class="miron-active-sentence">${s.trim()}</mark>${s.endsWith(' ') ? ' ' : ''}`;
                                matched = true;
                                break;
                            }
                        }
                        if (matched) {
                            cloned.body = sentences.join('');
                            return cloned;
                        }
                    }
                    const foundIdx = cloned.body.toLowerCase().indexOf(lowerPhrase);
                    if (foundIdx !== -1) {
                        const actualPhrase = cloned.body.slice(foundIdx, foundIdx + phrase.length);
                        cloned.body = cloned.body.slice(0, foundIdx) + `<mark class="miron-active-sentence">${actualPhrase}</mark>` + cloned.body.slice(foundIdx + phrase.length);
                        return cloned;
                    }
                    if (flexRe) {
                        const flexMatch = cloned.body.match(flexRe);
                        if (flexMatch) {
                            cloned.body = cloned.body.replace(flexRe, `<mark class="miron-active-sentence">${flexMatch[0]}</mark>`);
                            return cloned;
                        }
                    }
                } else if (Array.isArray(cloned.items)) {
                    for (let i = 0; i < cloned.items.length; i++) {
                        const itemText = typeof cloned.items[i] === 'string' ? cloned.items[i] : (cloned.items[i]?.text || '');
                        const itemNorm = normalizeQuoteText(itemText.replace(/<[^>]+>/g, ' ')).toLowerCase();
                        if (itemText.toLowerCase().includes(lowerPhrase) || itemNorm.includes(normPhrase) || (flexRe && flexRe.test(itemText))) {
                            const highlighted = `<mark class="miron-active-sentence">${itemText}</mark>`;
                            if (typeof cloned.items[i] === 'string') {
                                cloned.items[i] = highlighted;
                            } else {
                                cloned.items[i] = { ...cloned.items[i], text: highlighted };
                            }
                            return cloned;
                        }
                    }
                }
                return cloned;
            }

            // 2. Highlight by Numeric Sentence Index
            if (activeBlockCue.sentenceIndex !== null && activeBlockCue.sentenceIndex !== undefined) {
                const cloned = JSON.parse(JSON.stringify(b));
                if (typeof cloned.body === 'string' && cloned.body.trim()) {
                    const matches = cloned.body.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
                    if (matches && matches[activeBlockCue.sentenceIndex] !== undefined) {
                        const targetSentence = matches[activeBlockCue.sentenceIndex];
                        const highlighted = `<mark class="miron-active-sentence">${targetSentence.trim()}</mark>${targetSentence.endsWith(' ') ? ' ' : ''}`;
                        matches[activeBlockCue.sentenceIndex] = highlighted;
                        cloned.body = matches.join('');
                    }
                } else if (Array.isArray(cloned.items) && cloned.items[activeBlockCue.sentenceIndex] !== undefined) {
                    const targetItem = cloned.items[activeBlockCue.sentenceIndex];
                    const itemText = typeof targetItem === 'string' ? targetItem : (targetItem?.text || '');
                    if (itemText) {
                        const highlighted = `<mark class="miron-active-sentence">${itemText}</mark>`;
                        if (typeof targetItem === 'string') {
                            cloned.items[activeBlockCue.sentenceIndex] = highlighted;
                        } else {
                            cloned.items[activeBlockCue.sentenceIndex] = { ...targetItem, text: highlighted };
                        }
                    }
                }
                return cloned;
            }

            return b;
        });

        return {
            page: targetPage,
            blockIndex: effectiveBlockIdx,
            blocks: processedBlocks
        };
    }, [activeBlockCue, cachedPageBlocks, sectionPages, selectedSection]);

    const hasActiveNode = Boolean(activeNodeCue?.target && activeNodeCue.target !== 'overview' && activeNodeCue.target !== 'reset');
    const canShowExcerptWithVisual = Boolean(activeBlockData && !(activeDiagramAsset && activeImageAsset));
    const isDualStage = Boolean(
        (activeDiagramAsset && activeImageAsset) ||
        (canShowExcerptWithVisual && (activeImageAsset || activeDiagramAsset))
    );
    const latestBullet = activeBullets.length > 0 ? activeBullets[activeBullets.length - 1] : null;

    // Parse Bookend Presentation Card Payload (Strictly Intro & Summary) with bulletproof multi-line handling
    const activeCardData = useMemo(() => {
        if (!activeCardCue) return null;
        const raw = activeCardCue.target;
        let parsed = null;
        let defaultMode = activeCardCue.type === 'card' ? 'intro' : activeCardCue.type;

        if (raw && typeof raw === 'object') {
            parsed = raw;
        } else if (typeof raw === 'string') {
            const match = raw.match(/^([a-zA-Z0-9_\-]+):([\s\S]*)$/);
            if (match) {
                defaultMode = match[1];
                parsed = safeJsonParse(match[2]);
            } else {
                parsed = safeJsonParse(raw);
            }
        }

        if (parsed && typeof parsed === 'object') {
            const mode = (parsed.mode || defaultMode).toLowerCase();
            if (mode === 'intro' || mode === 'summary') {
                return {
                    mode,
                    ...parsed
                };
            }
        }
        return null;
    }, [activeCardCue]);

    // Parse Quiz Payload (Supports JSON string, prefix "mc:{...}", or object) with multi-line fault tolerance
    const activeQuizData = useMemo(() => {
        if (!activeQuizCue) return null;
        const isCompleted = completedQuizTimes.has(activeQuizCue.time) ||
            completedQuizTimes.has(Number(activeQuizCue.time)) ||
            completedQuizTimes.has(Number(Number(activeQuizCue.time).toFixed(2)));
        if (isCompleted) return null;

        const raw = activeQuizCue.target;
        if (!raw) return null;
        if (typeof raw === 'object') return raw;
        if (typeof raw === 'string') {
            const match = raw.match(/^(mc|tf):([\s\S]*)$/i);
            if (match) {
                const parsed = safeJsonParse(match[2]);
                if (parsed && typeof parsed === 'object') {
                    return { type: match[1].toLowerCase(), ...parsed };
                }
            }
            return safeJsonParse(raw);
        }
        return null;
    }, [activeQuizCue, completedQuizTimes]);

    // Auto-Pause Checkpoint Gate: pauses audio when an uncompleted quiz cue is reached
    useEffect(() => {
        if (activeQuizCue && activeQuizData && isPlaying) {
            const isCompleted = completedQuizTimes.has(activeQuizCue.time) ||
                completedQuizTimes.has(Number(activeQuizCue.time)) ||
                completedQuizTimes.has(Number(Number(activeQuizCue.time).toFixed(2)));
            if (!isCompleted) {
                if (audioRef.current && !audioRef.current.paused) {
                    audioRef.current.pause();
                }
                setIsPlaying(false);
                console.log(`🛑 [Miron Quiz Checkpoint] Auto-paused at ${activeQuizCue.time}s for interactive quiz`);
            }
        }
    }, [activeQuizCue, activeQuizData, completedQuizTimes, isPlaying]);

    const resumeFromQuiz = (quizTime) => {
        if (quizTime !== undefined) {
            setCompletedQuizTimes(prev => {
                const next = new Set(prev);
                next.add(quizTime);
                next.add(Number(quizTime));
                next.add(Number(Number(quizTime).toFixed(2)));
                return next;
            });
        }
        if (audioRef.current && audioLesson?.audio_url) {
            audioRef.current.play()
                .then(() => setIsPlaying(true))
                .catch(() => setIsPlaying(false));
        } else {
            setIsPlaying(true);
        }
    };

    // Auto-scroll Notes Deck to newest bullet
    useEffect(() => {
        if (notesDeckRef.current) {
            notesDeckRef.current.scrollTo({
                top: notesDeckRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [activeBullets?.length, notesDeckRef]);

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

        const targetNode = activeNodeCue?.target || 'overview';
        const targetCompositeKey = `${activeDiagramCue?.target || activeCue?.target || 'vis'}::${targetNode}::dual_${isDualStage}`;

        // Prevent infinite cancellation loop: only initiate camera pan when target node actually changes
        if (lastFocusedNodeRef.current === targetCompositeKey) return;
        lastFocusedNodeRef.current = targetCompositeKey;

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

            const isMobile = window.innerWidth <= 768;
            const defaultViewStr = activeSvg.getAttribute('data-default-view') || (isMobile ? '0 0 360 520' : '0 0 780 340');

            if (!isMobile) {
                // Desktop: Preserve full relationship map while CSS spotlights & lifts the active node
                animateViewBox(activeSvg, defaultViewStr);
                return;
            }

            const targetEl = findSvgNodeElement(activeSvg, targetNode);
            if (targetEl) {
                try {
                    const cacheKey = `${activeCue?.target || 'vis'}::${targetNode}::m`;
                    let b = bboxCacheRef.current.get(cacheKey);
                    if (!b) {
                        const rawBox = targetEl.getBBox();
                        if (rawBox && rawBox.width > 0 && rawBox.height > 0) {
                            b = { x: rawBox.x, y: rawBox.y, width: rawBox.width, height: rawBox.height };
                            bboxCacheRef.current.set(cacheKey, b);
                        } else {
                            b = rawBox;
                        }
                    }

                    if (b && b.width > 0 && b.height > 0) {
                        // Mobile Portrait: Tight node isolation maximizing card size inside available frame
                        const padX = 6;
                        const padY = 6;
                        const calcBox = `${(b.x - padX).toFixed(2)} ${(b.y - padY).toFixed(2)} ${(b.width + padX * 2).toFixed(2)} ${(b.height + padY * 2).toFixed(2)}`;
                        animateViewBox(activeSvg, calcBox);
                    } else {
                        const boxStr = targetEl.getAttribute('data-focus-box');
                        animateViewBox(activeSvg, boxStr || defaultViewStr);
                    }
                } catch (e) {
                    animateViewBox(activeSvg, defaultViewStr);
                }
            }
        }
    }, [activeNodeCue, activeCue, viewMode, isDualStage, activeDiagramCue, cinemaContainerRef]);

    // Automatic Dual-Mode Switcher: Flips to anchor on block cue, snaps to cinema on visuals
    useEffect(() => {
        if (activeCue) {
            if (activeCue.type === 'anchor_block') {
                const match = String(activeCue.target || '').match(/B(\d+)/i);
                if (match) {
                    setPinnedBlockIndex(parseInt(match[1], 10));
                }
                setViewMode('anchor');
            } else if (activeCue.type === 'show_diagram' || activeCue.type === 'show_image') {
                setViewMode('cinema');
            }
        }
    }, [activeCue, setPinnedBlockIndex, setViewMode]);

    // Fluid viewport, container-aware & dual-stage responsive scale engine
    useEffect(() => {
        const updateScale = () => {
            if (typeof window === 'undefined') return;
            const w = window.innerWidth;
            const stageW = cinemaContainerRef?.current?.clientWidth || w;
            if (w <= 768) {
                setFitScale(Math.min((w - 20) / 794, 0.52));
            } else if (isDualStage) {
                const availW = Math.min(stageW * 0.50, 640);
                setFitScale(Math.min(availW / 794, 0.82));
            } else {
                setFitScale(Math.min((stageW - 32) / 794, 1.0));
            }
        };
        updateScale();
        window.addEventListener('resize', updateScale);
        let ro;
        if (typeof ResizeObserver !== 'undefined' && cinemaContainerRef?.current) {
            ro = new ResizeObserver(updateScale);
            ro.observe(cinemaContainerRef.current);
        }
        return () => {
            window.removeEventListener('resize', updateScale);
            if (ro) ro.disconnect();
        };
    }, [isDualStage, cinemaContainerRef]);

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
    useEffect(() => {
        if (activeCue !== lastReportedCueRef.current) {
            lastReportedCueRef.current = activeCue;
            if (activeCue) {
                const matchedAsset = visualAssets[activeCue.target];
                if (matchedAsset) {
                    console.log(`🟢 [Miron Visual Cue Fired] Time: ${currentTime.toFixed(2)}s | Target ID: "${activeCue.target}" | Type: ${matchedAsset.asset_type} -> MATCHED!`);
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

    // Pre-Chunk Word Timestamps into Stationary 1-Line Phrases (Zero Per-Word Jitter)
    const karaokeTimeline = useMemo(() => {
        const words = audioLesson?.word_timestamps;
        if (!Array.isArray(words) || words.length === 0) {
            return { chunks: [], wordToChunk: [] };
        }

        const MAX_CHARS = 36;
        const MAX_WORDS = 6;
        const chunks = [];
        const wordToChunk = new Array(words.length);

        let curChunk = [];
        let curChars = 0;

        for (let i = 0; i < words.length; i++) {
            const wObj = words[i];
            const wStr = String(wObj.word || '').trim();
            const addLen = (curChunk.length > 0 ? 1 : 0) + wStr.length;

            if (curChunk.length > 0 && (curChunk.length >= MAX_WORDS || (curChars + addLen) > MAX_CHARS)) {
                chunks.push(curChunk);
                curChunk = [];
                curChars = 0;
            }

            const chunkIdx = chunks.length;
            wordToChunk[i] = chunkIdx;
            curChunk.push({ ...wObj, globalIdx: i });
            curChars += (curChunk.length > 1 ? 1 : 0) + wStr.length;

            if (/[.!?።]$/.test(wStr)) {
                chunks.push(curChunk);
                curChunk = [];
                curChars = 0;
            }
        }

        if (curChunk.length > 0) {
            chunks.push(curChunk);
        }

        return { chunks, wordToChunk };
    }, [audioLesson?.word_timestamps]);

    // Active Stationary Karaoke Chunk
    const karaokeData = useMemo(() => {
        const words = audioLesson?.word_timestamps;
        if (!Array.isArray(words) || words.length === 0 || karaokeTimeline.chunks.length === 0) {
            return { activeWord: '', activeWordIdx: -1, chunkIdx: -1, sentenceSnippet: [] };
        }

        let activeIdx = -1;
        for (let i = 0; i !== words.length; i++) {
            if (currentTime >= words[i].start && currentTime <= words[i].end) {
                activeIdx = i;
                break;
            }
        }

        if (activeIdx === -1) {
            if (currentTime >= words[words.length - 1].end) {
                activeIdx = words.length - 1;
            } else {
                for (let i = 0; i !== words.length; i++) {
                    if (words[i].start > currentTime) {
                        activeIdx = Math.max(0, i - 1);
                        break;
                    }
                }
            }
        }

        const safeIdx = activeIdx === -1 ? 0 : activeIdx;
        const chunkIdx = karaokeTimeline.wordToChunk[safeIdx] ?? 0;

        return {
            activeWord: words[safeIdx]?.word || '',
            activeWordIdx: safeIdx,
            chunkIdx,
            sentenceSnippet: karaokeTimeline.chunks[chunkIdx] || []
        };
    }, [audioLesson?.word_timestamps, karaokeTimeline, currentTime]);

    // Quiz Checkpoint Markers for Precision Scrubber
    const quizMarkers = useMemo(() => {
        if (!Array.isArray(audioLesson?.cue_timeline) || duration <= 0) return [];
        return audioLesson.cue_timeline
            .filter(c => c.type === 'quiz' || c.type === 'interactive_quiz')
            .map(c => ({
                time: c.time,
                pct: Math.max(1, Math.min(99, (c.time / duration) * 100)),
                completed: completedQuizTimes.has(c.time)
            }));
    }, [audioLesson, duration, completedQuizTimes]);

    // Transport Handlers
    const handleTogglePlay = () => {
        if (activeQuizData) return;
        if (!audioLesson?.audio_url) {
            lastSimTickRef.current = performance.now();
            setIsPlaying(prev => !prev);
            return;
        }
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
        if (!progressBarRef.current || duration <= 0) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        const targetTime = pct * duration;
        if (audioRef.current && audioLesson?.audio_url) {
            audioRef.current.currentTime = targetTime;
        }
        setCurrentTime(targetTime);
    };

    const handleSkip = (seconds) => {
        const target = Math.max(0, Math.min(duration, currentTime + seconds));
        if (audioRef.current && audioLesson?.audio_url) {
            audioRef.current.currentTime = target;
        }
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

    // Forensic Probing Audio Tag Handlers
    const audioHandlers = {
        onPlay: () => setIsPlaying(true),
        onPause: () => setIsPlaying(false),
        onEnded: () => {
            setIsPlaying(false);
            if (typeof onLessonEnded === 'function') {
                onLessonEnded();
            }
        },
        onTimeUpdate: () => {
            if (audioRef.current && !isPlaying) {
                setCurrentTime(audioRef.current.currentTime);
            }
        },
        onLoadStart: () => console.log('⏳ [Audio Element] loadstart triggered:', audioLesson?.audio_url),
        onCanPlay: () => console.log('🟢 [Audio Element] canplay triggered (Stream buffered)'),
        onStalled: () => console.warn('⚠️ [Audio Element] stalled (Data not arriving)'),
        onWaiting: () => console.warn('⚠️ [Audio Element] waiting for more frames'),
        onError: async () => {
            const targetUrl = proxyUrl(audioLesson?.audio_url);
            const el = audioRef.current;
            setIsPlaying(false);

            console.group('🔬 [MIRON AUDIO DEEP DIAGNOSTIC PROBE]');
            console.error('❌ Native Audio Tag Crashed!');
            console.log('🔗 Target URL:', targetUrl);
            console.log('📊 DOM Media Element State:', {
                networkState: el?.networkState,
                readyState: el?.readyState,
                error: el?.error ? {
                    code: el.error.code,
                    message: el.error.message || '(Empty message from browser)',
                    codeMeaning: el.error.code === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED' : el.error.code === 3 ? 'MEDIA_ERR_DECODE' : el.error.code === 2 ? 'MEDIA_ERR_NETWORK' : 'MEDIA_ERR_ABORTED'
                } : null,
                currentSrc: el?.currentSrc
            });

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
        },
        onLoadedMetadata: () => {
            if (audioRef.current) {
                const seekTo = pendingSeekTimeRef.current || 0;
                if (seekTo > 0 && Math.abs(audioRef.current.currentTime - seekTo) > 0.5) {
                    audioRef.current.currentTime = seekTo;
                }
                setDuration(audioRef.current.duration || audioLesson?.duration_seconds || 0);
                audioRef.current.playbackRate = playbackRate;
                audioRef.current.play()
                    .then(() => setIsPlaying(true))
                    .catch((err) => {
                                            console.warn('⚠️ [Audio Autoplay Prevented by Browser]: Tap Play to begin lecture', err.message);
                    setIsPlaying(false);
                });
            }
        }
    };

    // Desktop Keyboard Shortcuts (Space/K: Play-Pause, Left/Right: Skip 10s, C: Captions)
    const keyHandlersRef = useRef({});
    keyHandlersRef.current = {
        togglePlay: handleTogglePlay,
        skip: handleSkip,
        toggleCc: () => setCcEnabled(prev => !prev),
        isQuizBlocked: Boolean(activeQuizData)
    };

    useEffect(() => {
        if (stage !== 'studio') return;
        const onKeyDown = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

            if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
                if (keyHandlersRef.current.isQuizBlocked) return;
                e.preventDefault();
                keyHandlersRef.current.togglePlay();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                keyHandlersRef.current.skip(-10);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                keyHandlersRef.current.skip(10);
            } else if (e.key === 'c' || e.key === 'C') {
                keyHandlersRef.current.toggleCc();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [stage]);

    return {
        // Playback state & refs
        audioRef,
        progressBarRef,
        pendingSeekTimeRef,
        lastSimTickRef,
        isPlaying,
        setIsPlaying,
        currentTime,
        setCurrentTime,
        duration,
        setDuration,
        playbackRate,
        setPlaybackRate,
        fitScale,
        isChromeVisible,
        setIsChromeVisible,
        resetInactivityTimer,

        // Cues & Stage resolution
        activeDiagramCue,
        activeImageCue,
        activeNodeCue,
        activeBlockCue,
        activeBullets,
        latestBullet,
        activeCue,
        activeDiagramAsset,
        activeImageAsset,
        activeBlockData,
        activeQuizCue,
        activeQuizData,
        resumeFromQuiz,
        activeCardCue,
        activeCardData,
        hasActiveNode,
        isDualStage,

        // Navigation & Manifest
        manifest,
        activeSection,

        // Subtitles & Stage UI Toggles
        karaokeData,
        ccEnabled,
        setCcEnabled,
        isNotesCollapsed,
        setIsNotesCollapsed,
        quizMarkers,

        // Handlers
        handleTogglePlay,
        handleSeek,
        handleSkip,
        handleCycleSpeed,
        handleJumpToSection,
        audioHandlers
    };
};