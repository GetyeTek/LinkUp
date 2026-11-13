import React, { useState, useEffect, useRef } from 'react';
import { usePlatform, supabase, getComponent } from '@linkup-platform/sdk-core';
import FloatingMironOrb from './FloatingMironOrb.jsx';
import MironConnectionRing from './MironConnectionRing.jsx';
import MironCatalogView from './miron/MironCatalogView.jsx';
import MironStudioStage from './miron/MironStudioStage.jsx';
import MironSimulatorModal from './miron/MironSimulatorModal.jsx';
import { useMironLecture, proxyUrl, ensureBlockArray } from './miron/useMironLecture.js';
import './MironLiveSession.css';

const MironLiveSession = ({ onClose, mironAvatarUrl }) => {
    const { t } = usePlatform();
    const renderBookBlock = getComponent('book-block-renderer');

    // Navigation & Data State: 'course_select' | 'toc_select' | 'studio'
    const [stage, setStage] = useState('course_select');
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedSection, setSelectedSection] = useState(null);
    const [expandedChapters, setExpandedChapters] = useState(new Set([0]));
    
    // Audio Lesson, Visual Asset & Pre-Fetched Textbook Blocks Cache
    const [audioLesson, setAudioLesson] = useState(null);
    const [visualAssets, setVisualAssets] = useState({});
    const [cachedPageBlocks, setCachedPageBlocks] = useState({});
    const [sectionPages, setSectionPages] = useState([]);
    const [isLoadingLesson, setIsLoadingLesson] = useState(false);
    const [availableLessonSections, setAvailableLessonSections] = useState(new Set());

    // Studio Player State
    const [viewMode, setViewMode] = useState('cinema'); // 'cinema' | 'anchor'
    const [pinnedBlockIndex, setPinnedBlockIndex] = useState(0);
    const [viewState, setViewState] = useState('full');
    const [isDebugOpen, setIsDebugOpen] = useState(false);

    // DOM & Element Refs
    const excerptCardRef = useRef(null);
    const cinemaContainerRef = useRef(null);
    const notesDeckRef = useRef(null);

    const handleAdvanceToNextSection = () => {
        if (!selectedBook?.toc || !selectedSection) return;
        const allSections = [];
        (selectedBook.toc || []).forEach(ch => {
            if (Array.isArray(ch.children) && ch.children.length > 0) {
                ch.children.forEach(sub => allSections.push({ ...sub, parentTitle: ch.title }));
            } else {
                allSections.push({ ...ch, parentTitle: ch.title });
            }
        });

        const currentIdx = allSections.findIndex(s => 
            (s.title && s.title.toLowerCase() === selectedSection.title?.toLowerCase()) ||
            (s.section_tag && selectedSection.title?.startsWith(s.section_tag))
        );

        if (currentIdx !== -1 && currentIdx < allSections.length - 1) {
            const nextSec = allSections[currentIdx + 1];
            console.log(`⏩ [MironLecture] Auto-advancing to next section: "${nextSec.title}"`);
            handleSelectSection(nextSec, nextSec.parentTitle);
        }
    };

    // Initialize Headless Lecture Engine
    const lectureEngine = useMironLecture({
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
        onLessonEnded: handleAdvanceToNextSection
    });

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

    // 2. Dynamic Custom Book CSS Injection for Anchor Mode
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

    // Navigation & Lesson Loader Handlers
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
                const domParser = (typeof window !== 'undefined' && window.DOMParser) ? new DOMParser() : null;

                assets.forEach(a => {
                    assetMap[a.id] = a;
                    console.log(`   👉 Registered Asset: [${a.asset_type}] ID: "${a.id}" (Section: ${a.section_tag || 'N/A'})`);

                    // Hardware GPU Texture Pre-warm for raster illustrations
                    if (a.asset_type === 'image' && a.image_url) {
                        const prewarmImg = new Image();
                        prewarmImg.src = proxyUrl(a.image_url);
                        if (typeof prewarmImg.decode === 'function') {
                            prewarmImg.decode().catch(() => {});
                        }
                    }

                    // Headless DOM Parser Pre-warming for SVG diagrams
                    if (a.asset_type === 'diagram_svg' && a.content_payload && domParser) {
                        try {
                            domParser.parseFromString(a.content_payload, 'image/svg+xml');
                        } catch (e) {}
                    }
                });
            }
            console.groupEnd();
            setVisualAssets(assetMap);

            // 3. Pre-Flight Batch Cache for Referenced Pages (0ms instant lookup during playback)
            const offset = selectedBook.page_offset || 0;
            const logicalStart = sectionNode.page || 1;
            const physicalStart = Math.max(1, logicalStart + offset);

            const pagesToFetchSet = new Set([physicalStart]);
            const isTextbookCue = (t) => ['page_block', 'show_page', 'page', 'highlight', 'block', 'anchor_block'].includes(t);
            if (lesson?.cue_timeline && Array.isArray(lesson.cue_timeline)) {
                lesson.cue_timeline.forEach(cue => {
                    if (isTextbookCue(cue.type)) {
                        const rawTarget = String(cue.target || '').trim();
                        const parts = rawTarget.split(':');
                        if (parts.length >= 1) {
                            const pNum = parseInt(parts[0], 10);
                            if (!isNaN(pNum)) pagesToFetchSet.add(pNum);
                        }
                    }
                });
            }

            const { data: batchPages, error: pagesErr } = await supabase.rpc('get_book_page_blocks', {
                p_book_id: selectedBook.id,
                p_course_code: selectedBook.course_code,
                p_page_numbers: Array.from(pagesToFetchSet)
            });

            console.group(`📚 [MironLive:BatchPages] Loaded via RPC for Book "${selectedBook.title}"`);
            console.log('Requested Page Numbers:', Array.from(pagesToFetchSet));
            console.log('RPC Error:', pagesErr);
            console.log('Returned Rows:', batchPages?.length || 0);

            const blocksMap = {};
            if (Array.isArray(batchPages)) {
                batchPages.forEach(p => {
                    const safeBlocks = ensureBlockArray(p.content_json);
                    blocksMap[p.page_number] = safeBlocks;
                    console.log(`  📄 Page ${p.page_number}: Parsed ${safeBlocks.length} block(s)`);
                    if (p.page_number === physicalStart) {
                        setSectionPages(safeBlocks);
                    }
                });
            }
            console.groupEnd();
            setCachedPageBlocks(blocksMap);

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

                if (lesson?.cue_timeline && Array.isArray(lesson.cue_timeline)) {
                    lesson.cue_timeline.sort((a, b) => (a.time || 0) - (b.time || 0));
                }
                lectureEngine.pendingSeekTimeRef.current = jumpStartTime;
                setAudioLesson(lesson);
                lectureEngine.setDuration(lesson.duration_seconds || 0);
                lectureEngine.setCurrentTime(jumpStartTime);
                setStage('studio');
                setViewMode('cinema');

                if (lectureEngine.audioRef.current && lectureEngine.audioRef.current.src === proxyUrl(lesson.audio_url)) {
                    try {
                        lectureEngine.audioRef.current.currentTime = jumpStartTime;
                        lectureEngine.audioRef.current.play().catch((err) => {
                            console.warn('⚠️ [Audio Autoplay Blocked]: Tap Play to begin', err.message);
                            lectureEngine.setIsPlaying(false);
                        });
                    } catch (e) {}
                }
            } else {
                setAudioLesson(null);
                setStage('studio');
                lectureEngine.setIsPlaying(false);
            }
        } catch (err) {
            console.error('Failed to load lesson studio:', err);
        } finally {
            setIsLoadingLesson(false);
        }
    };

    // Script Simulation Engine
    const handleStartSimulation = async (rawScript) => {
        const raw = (rawScript || '').trim();
        if (!raw) return;

        let targetCourse = selectedBook?.course_code || 'ANTH 1012';
        if (Object.keys(visualAssets).length === 0) {
            const codeWithSpace = targetCourse.trim();
            const codeWithUnderscore = codeWithSpace.replace(/\s+/g, '_');
            const { data: assets } = await supabase
                .from('course_visual_assets')
                .select('*')
                .or(`course_code.eq."${codeWithSpace}",course_code.eq."${codeWithUnderscore}"`);

            if (Array.isArray(assets) && assets.length > 0) {
                const map = {};
                assets.forEach(a => { map[a.id] = a; });
                setVisualAssets(map);
            }
        }

        const targetPagesToSimulate = new Set([11, 12, 13]);
        const simTargetRegex = /\[\[(?:cue|call):(page_block|show_page|page|highlight|block):(\d+)/g;
        let pMatch;
        while ((pMatch = simTargetRegex.exec(raw)) !== null) {
            targetPagesToSimulate.add(parseInt(pMatch[2], 10));
        }

        let targetBook = selectedBook;
        if (!targetBook && Array.isArray(books) && books.length > 0) {
            targetBook = books.find(b => 
                (b.course_code || '').includes('ANTH') || 
                (b.title || '').toLowerCase().includes('anthro')
            ) || null;
            if (targetBook) {
                targetCourse = targetBook.course_code;
                setSelectedBook(targetBook);
            }
        }

        const { data: simPages, error: simPagesErr } = await supabase.rpc('get_book_page_blocks', {
            p_course_code: targetCourse,
            p_book_id: targetBook?.id || null,
            p_page_numbers: Array.from(targetPagesToSimulate)
        });

        console.group('🔍 [MironSimulator:Preload]');
        console.log('Target Course:', targetCourse, '| Book ID:', targetBook?.id || '(Auto-resolving in Postgres)');
        console.log('Target Page Numbers:', Array.from(targetPagesToSimulate));
        console.log('RPC Error:', simPagesErr);
        console.log('RPC Returned Rows:', simPages?.length || 0);

        if (Array.isArray(simPages) && simPages.length > 0) {
            if (!selectedBook && simPages[0]?.book_title) {
                setSelectedBook({
                    id: simPages[0].book_id,
                    title: simPages[0].book_title,
                    course_code: simPages[0].course_code
                });
            }
            const blocksMap = {};
            simPages.forEach(p => {
                const safeBlocks = ensureBlockArray(p.content_json);
                blocksMap[p.page_number] = safeBlocks;
                console.log(`  📄 Page ${p.page_number}: Parsed ${safeBlocks.length} block(s) -> Sample block[0]:`, safeBlocks[0]?.type || '(none)');
            });
            setCachedPageBlocks(blocksMap);
        } else {
            console.warn('⚠️ No page records returned for simulation pages:', Array.from(targetPagesToSimulate));
        }
        console.groupEnd();

        const cueRegex = /\[\[(?:cue|call):([a-zA-Z0-9_\-]+)(?::([\s\S]*?))?\]\]/g;
        const cues = [];
        const sections = [];
        let cleanText = '';
        let lastIdx = 0;
        let match;

        while ((match = cueRegex.exec(raw)) !== null) {
            cleanText += raw.slice(lastIdx, match.index);
            const wordCount = cleanText.trim().split(/\s+/).filter(Boolean).length;
            const cueType = match[1].trim();
            const rawTarget = (match[2] || '').trim();

            if (cueType === 'section' || cueType === 'section_start') {
                const parts = rawTarget.split(':');
                sections.push({
                    type: 'section',
                    tag: parts[0]?.trim() || '',
                    title: (parts.slice(1).join(':') || parts[0] || '').trim(),
                    wordCount
                });
            } else {
                cues.push({ type: cueType, target: rawTarget, wordCount });
            }
            lastIdx = match.index + match[0].length;
        }
        cleanText += raw.slice(lastIdx);
        const totalWords = cleanText.trim().split(/\s+/).filter(Boolean).length;
        const wordsPerSec = 2.4;
        const totalDuration = Math.max(40, Math.ceil(totalWords / wordsPerSec));

        const cueTimeline = cues.map(c => ({
            time: Number((c.wordCount / wordsPerSec).toFixed(2)),
            type: c.type,
            target: c.target
        })).sort((a, b) => a.time - b.time);

        let sectionsManifest = [];
        if (sections.length > 0) {
            sectionsManifest = sections.map((sec, idx) => {
                const startTime = Number((sec.wordCount / wordsPerSec).toFixed(2));
                const nextSec = sections[idx + 1];
                const endTime = nextSec ? Number((nextSec.wordCount / wordsPerSec).toFixed(2)) : totalDuration;
                return {
                    section_tag: sec.tag,
                    title: sec.title,
                    start_time: startTime,
                    end_time: endTime,
                    duration: Math.max(1, endTime - startTime)
                };
            });
        } else {
            sectionsManifest = [{
                section_tag: '1.1',
                title: 'Simulated Lecture',
                start_time: 0,
                end_time: totalDuration,
                duration: totalDuration
            }];
        }

        const simLesson = {
            id: 'sim-' + Date.now(),
            book_id: selectedBook?.id || null,
            course_code: targetCourse,
            section_title: sectionsManifest[0]?.title || 'Visual Simulation',
            cue_timeline: cueTimeline,
            sections_manifest: sectionsManifest,
            duration_seconds: totalDuration,
            audio_url: null
        };

        if (lectureEngine.audioRef.current) {
            lectureEngine.audioRef.current.pause();
            lectureEngine.audioRef.current.src = '';
        }

        setAudioLesson(simLesson);
        lectureEngine.setDuration(totalDuration);
        lectureEngine.setCurrentTime(0);
        setSelectedSection({ title: simLesson.section_title });
        lectureEngine.pendingSeekTimeRef.current = 0;
        lectureEngine.lastSimTickRef.current = performance.now();
        lectureEngine.setIsPlaying(true);
        setStage('studio');
        setViewMode('cinema');
        setIsDebugOpen(false);
    };

    const handleClose = () => {
        if (lectureEngine.audioRef.current) {
            lectureEngine.audioRef.current.pause();
            lectureEngine.audioRef.current.src = '';
        }
        lectureEngine.setIsPlaying(false);
        onClose();
    };

    if (viewState === 'minimized') {
        return (
            <FloatingMironOrb 
                mironAvatarUrl={mironAvatarUrl} 
                isConnected={lectureEngine.isPlaying} 
                onClick={() => setViewState('full')} 
            />
        );
    }

    return (
        <div className="ml-overlay">
            <div className="ml-ambient"></div>

            {/* Hidden Native Audio Element with Diagnostic Probe */}
            {audioLesson?.audio_url && (
                <audio 
                    ref={lectureEngine.audioRef}
                    src={proxyUrl(audioLesson.audio_url)}
                    preload="auto"
                    {...lectureEngine.audioHandlers}
                />
            )}

            {/* Top Navigation Bar with Ghost Auto-Hide */}
            <header 
                className={`ml-header ${stage === 'studio' ? 'studio-mode' : ''} ${!lectureEngine.isChromeVisible && stage === 'studio' ? 'is-hidden' : ''}`}
                onClick={(e) => { e.stopPropagation(); lectureEngine.resetInactivityTimer(); }}
            >
                <div className="ml-header-left">
                    {stage !== 'course_select' && (
                        <button 
                            className="ml-back-btn" 
                            onClick={() => {
                                if (lectureEngine.audioRef.current) lectureEngine.audioRef.current.pause();
                                lectureEngine.setIsPlaying(false);
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
                            className={`ml-avatar ${lectureEngine.isPlaying ? 'is-speaking' : ''}`} 
                        />
                        {lectureEngine.isPlaying && (
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
                    <button 
                        className="ml-debug-sim-btn" 
                        onClick={(e) => { e.stopPropagation(); setIsDebugOpen(true); }}
                        title="Open Raw Script Visual Simulator"
                    >
                        <i className="fas fa-flask"></i>
                        <span className="ml-debug-sim-label">Simulate</span>
                    </button>
                    <button className="athena-close" onClick={handleClose} style={{ color: '#ff5f5f' }} title={t('close', 'Close')}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </header>

            {/* Interactive Workspace Body with Universal Tap-to-Wake */}
            <main 
                className={`ml-classroom-body ${stage}`}
                onClick={() => {
                    if (stage === 'studio' && !lectureEngine.isChromeVisible) {
                        lectureEngine.resetInactivityTimer();
                    }
                }}
            >
                {/* Floating Minimize Button */}
                <button 
                    className={`ml-page-collapse-btn ${!lectureEngine.isChromeVisible && stage === 'studio' ? 'is-hidden' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setViewState('minimized'); }}
                    title={t('minimize_to_orb', 'Minimize to Floating Orb')}
                >
                    <i className="fas fa-compress-alt"></i>
                </button>

                {/* STAGES 0 & 1: CATALOG & TOC ACCORDION */}
                {stage !== 'studio' && (
                    <MironCatalogView
                        stage={stage}
                        books={books}
                        selectedBook={selectedBook}
                        expandedChapters={expandedChapters}
                        availableLessonSections={availableLessonSections}
                        t={t}
                        onSelectCourse={handleSelectCourse}
                        onToggleChapterExpand={toggleChapterExpand}
                        onSelectSection={handleSelectSection}
                    />
                )}

                {/* STAGE 2: STUDIO WORKSPACE & PLAYER */}
                {stage === 'studio' && (
                    <MironStudioStage
                        isLoadingLesson={isLoadingLesson}
                        audioLesson={audioLesson}
                        selectedBook={selectedBook}
                        selectedSection={selectedSection}
                        onReturnToToc={() => setStage('toc_select')}
                        viewMode={viewMode}
                        pinnedBlockIndex={pinnedBlockIndex}
                        sectionPages={sectionPages}
                        renderBookBlock={renderBookBlock}
                        mironAvatarUrl={mironAvatarUrl}
                        stage={stage}
                        cinemaContainerRef={cinemaContainerRef}
                        excerptCardRef={excerptCardRef}
                        notesDeckRef={notesDeckRef}
                        lectureEngine={lectureEngine}
                    />
                )}
            </main>

            {/* SCRIPT SIMULATOR MODAL */}
            <MironSimulatorModal
                isOpen={isDebugOpen}
                onClose={() => setIsDebugOpen(false)}
                onStartSimulation={handleStartSimulation}
            />
        </div>
    );
};

export default MironLiveSession;