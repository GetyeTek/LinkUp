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
    stage
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [fitScale, setFitScale] = useState(0.47);
    const [isChromeVisible, setIsChromeVisible] = useState(true);

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

    // Ghost Chrome Inactivity Engine
    const resetInactivityTimer = () => {
        setIsChromeVisible(true);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
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
    const { activeDiagramCue, activeImageCue, activeNodeCue, activeBlockCue, activeBullets } = useMemo(() => {
        if (!audioLesson?.cue_timeline || audioLesson.cue_timeline.length === 0) {
            return { activeDiagramCue: null, activeImageCue: null, activeNodeCue: null, activeBlockCue: null, activeBullets: [] };
        }
        const timeline = audioLesson.cue_timeline;
        let latestDiagram = null;
        let latestImage = null;
        let latestNode = null;
        let latestBlock = null;
        let currentBullets = [];

        for (const cue of timeline) {
            if (cue.time <= currentTime) {
                if (cue.type === 'show_diagram') {
                    if (cue.target && cue.target.includes(':') && !visualAssets[cue.target]) {
                        const [assetKey, nodeKey] = cue.target.split(':');
                        latestDiagram = { ...cue, target: assetKey };
                        latestNode = { ...cue, type: 'zoom', target: nodeKey };
                    } else if (cue.target && cue.target.includes('#') && !visualAssets[cue.target]) {
                        const [assetKey, nodeKey] = cue.target.split('#');
                        latestDiagram = { ...cue, target: assetKey };
                        latestNode = { ...cue, type: 'zoom', target: nodeKey };
                    } else {
                        latestDiagram = cue;
                        latestNode = null;
                    }
                    latestImage = null; // New diagram resets active image to restore diagram hero
                } else if (cue.type === 'show_image') {
                    latestImage = cue; // Preserves latestDiagram for dual-stage composition!
                } else if (cue.type === 'note_card') {
                    latestDiagram = cue;
                    latestImage = null;
                    latestNode = null;
                } else if (cue.type === 'zoom' || cue.type === 'focus' || cue.type === 'spotlight') {
                    latestNode = cue;
                } else if (cue.type === 'bullet' || cue.type === 'note') {
                    const text = cue.target || '';
                    if (text && !currentBullets.includes(text)) {
                        currentBullets.push(text);
                    }
                } else if (cue.type === 'clear_notes' || cue.type === 'notes:clear') {
                    currentBullets = [];
                } else if (cue.type === 'section') {
                    currentBullets = []; // Clean section break
                    latestImage = null;
                } else if (cue.type === 'page_block' || cue.type === 'anchor_block') {
                    const rawTarget = String(cue.target || '').trim();
                    const parts = rawTarget.split(':');
                    let pageNum = null;
                    let blockIdx = 0;
                    let sentenceIdx = null;

                    if (parts.length >= 2) {
                        pageNum = parseInt(parts[0], 10);
                        blockIdx = parseInt(parts[1], 10);
                        if (parts.length >= 3 && parts[2] !== '') {
                            sentenceIdx = parseInt(parts[2], 10);
                        }
                    } else if (rawTarget.match(/^B(\d+)/i)) {
                        blockIdx = parseInt(rawTarget.match(/^B(\d+)/i)[1], 10);
                    }

                    latestBlock = {
                        page: pageNum,
                        blockIndex: isNaN(blockIdx) ? 0 : blockIdx,
                        sentenceIndex: isNaN(sentenceIdx) ? null : sentenceIdx,
                        rawTarget: rawTarget,
                        time: cue.time
                    };
                    latestDiagram = null;
                    latestImage = null;
                }
            } else {
                break;
            }
        }
        return { 
            activeDiagramCue: latestDiagram, 
            activeImageCue: latestImage, 
            activeNodeCue: latestNode, 
            activeBlockCue: latestBlock, 
            activeBullets: currentBullets || [] 
        };
    }, [audioLesson, currentTime, visualAssets]);

    const activeCue = activeImageCue || activeDiagramCue;

    // Resolve Active Visual Items & Page Block from Cache
    const activeDiagramAsset = activeDiagramCue ? visualAssets[activeDiagramCue.target] : null;
    const activeImageAsset = activeImageCue ? (visualAssets[activeImageCue.target] || {
        asset_type: 'image',
        image_url: activeImageCue.target,
        title: activeImageCue.target
    }) : null;

    // Resolve Active Page Block data (Full Page Canvas with Sentence Highlighting)
    const activeBlockData = useMemo(() => {
        if (!activeBlockCue) return null;
        const targetPage = activeBlockCue.page || selectedSection?.page || 1;
        const pageBlocks = cachedPageBlocks[targetPage] || sectionPages || [];
        if (!pageBlocks || pageBlocks.length === 0) return null;

        const processedBlocks = pageBlocks.map((b, idx) => {
            if (idx !== activeBlockCue.blockIndex) return b;
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
            blockIndex: activeBlockCue.blockIndex,
            blocks: processedBlocks
        };
    }, [activeBlockCue, cachedPageBlocks, sectionPages, selectedSection]);

    const hasActiveNode = Boolean(activeNodeCue?.target && activeNodeCue.target !== 'overview' && activeNodeCue.target !== 'reset');
    const isDualStage = Boolean(
        (activeDiagramAsset && activeImageAsset && hasActiveNode) ||
        (activeBlockData && (activeImageAsset || activeDiagramAsset))
    );
    const latestBullet = activeBullets.length > 0 ? activeBullets[activeBullets.length - 1] : null;

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

            const targetEl = activeSvg.querySelector(`[data-node="${targetNode}"]`);
            if (targetEl) {
                try {
                    const cacheKey = `${activeCue?.target || 'vis'}::${targetNode}`;
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

                    if (isDualStage && b && b.width > 0 && b.height > 0) {
                        // Razor-sharp node isolation: 3px padding preserves card border while eliminating stray connector lines
                        const padX = 3;
                        const padY = 3;
                        const calcBox = `${(b.x - padX).toFixed(2)} ${(b.y - padY).toFixed(2)} ${(b.width + padX * 2).toFixed(2)} ${(b.height + padY * 2).toFixed(2)}`;
                        animateViewBox(activeSvg, calcBox);
                    } else {
                        const boxStr = targetEl.getAttribute('data-focus-box');
                        if (boxStr) {
                            animateViewBox(activeSvg, boxStr);
                        } else {
                            const defaultViewStr = activeSvg.getAttribute('data-default-view') || '0 0 360 520';
                            const [defX, defY, defW, defH] = defaultViewStr.trim().split(/\s+/).map(Number);

                            if (defW && defH && b) {
                                const baseCX = defX + defW / 2;
                                const baseCY = defY + defH / 2;
                                const targetCX = b.x + b.width / 2;
                                const targetCY = b.y + b.height / 2;

                                const camCX = baseCX + (targetCX - baseCX) * 0.6;
                                const camCY = baseCY + (targetCY - baseCY) * 0.6;

                                const zoomRatio = window.innerWidth <= 768 ? 0.74 : 0.68;
                                const targetW = defW * zoomRatio;
                                const targetH = defH * zoomRatio;

                                let camX = camCX - targetW / 2;
                                let camY = camCY - targetH / 2;
                                camX = Math.max(defX, Math.min(defX + defW - targetW, camX));
                                camY = Math.max(defY, Math.min(defY + defH - targetH, camY));

                                const calcBox = `${camX.toFixed(2)} ${camY.toFixed(2)} ${targetW.toFixed(2)} ${targetH.toFixed(2)}`;
                                animateViewBox(activeSvg, calcBox);
                            } else {
                                animateViewBox(activeSvg, defaultViewStr);
                            }
                        }
                    }
                } catch (e) {
                    const defaultViewStr = activeSvg.getAttribute('data-default-view');
                    if (defaultViewStr) animateViewBox(activeSvg, defaultViewStr);
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
            } else if (activeCue.type === 'show_diagram' || activeCue.type === 'show_image' || activeCue.type === 'note_card') {
                setViewMode('cinema');
            }
        }
    }, [activeCue, setPinnedBlockIndex, setViewMode]);

    // Fluid viewport & dual-stage responsive scale engine
    useEffect(() => {
        const updateScale = () => {
            if (typeof window === 'undefined') return;
            const w = window.innerWidth;
            if (w <= 768) {
                setFitScale(Math.min((w - 20) / 794, 0.52));
            } else if (isDualStage) {
                const availW = Math.min(w * 0.52, 640);
                setFitScale(Math.min(availW / 794, 0.82));
            } else {
                setFitScale(Math.min((w - 32) / 794, 1.0));
            }
        };
        updateScale();
        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, [isDualStage]);

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

    // Transport Handlers
    const handleTogglePlay = () => {
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
        onEnded: () => setIsPlaying(false),
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
        hasActiveNode,
        isDualStage,

        // Navigation & Manifest
        manifest,
        activeSection,

        // Subtitles
        karaokeData,

        // Handlers
        handleTogglePlay,
        handleSeek,
        handleSkip,
        handleCycleSpeed,
        handleJumpToSection,
        audioHandlers
    };
};