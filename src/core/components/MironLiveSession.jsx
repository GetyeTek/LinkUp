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

    // 4. Resolve Active Visual Cue & Karaoke Words
    const activeCue = useMemo(() => {
        if (!audioLesson?.cue_timeline || audioLesson.cue_timeline.length === 0) return null;
        const timeline = audioLesson.cue_timeline;
        let candidate = null;
        for (const cue of timeline) {
            if (cue.time <= currentTime) {
                candidate = cue;
            } else {
                break;
            }
        }
        return candidate;
    }, [audioLesson, currentTime]);

    // Sync Pinned Block in Anchor Mode if cue targets anchor
    useEffect(() => {
        if (activeCue && activeCue.type === 'anchor_block') {
            const match = String(activeCue.target || '').match(/B(\d+)/i);
            if (match) {
                const bIdx = parseInt(match[1], 10);
                setPinnedBlockIndex(bIdx);
                setViewMode('anchor');
            }
        }
    }, [activeCue]);

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

                setAudioLesson(lesson);
                setDuration(lesson.duration_seconds || 0);
                setCurrentTime(jumpStartTime);
                setIsPlaying(true);
                setStage('studio');
                setViewMode('cinema');

                setTimeout(() => {
                    if (audioRef.current) {
                        audioRef.current.currentTime = jumpStartTime;
                        audioRef.current.play().catch(() => {});
                    }
                }, 50);
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
        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
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

            {/* Hidden Native Audio Element */}
            {audioLesson?.audio_url && (
                <audio 
                    ref={audioRef}
                    src={audioLesson.audio_url}
                    preload="auto"
                    onEnded={() => setIsPlaying(false)}
                    onLoadedMetadata={() => {
                        if (audioRef.current) {
                            setDuration(audioRef.current.duration);
                            audioRef.current.playbackRate = playbackRate;
                            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
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

                    {stage === 'studio' && (
                        <div className="ml-mode-switch-pill">
                            <button 
                                className={`ml-mode-btn ${viewMode === 'cinema' ? 'active' : ''}`}
                                onClick={() => setViewMode('cinema')}
                            >
                                <i className="fas fa-tv"></i>
                                <span>Studio</span>
                            </button>
                            <button 
                                className={`ml-mode-btn ${viewMode === 'anchor' ? 'active' : ''}`}
                                onClick={() => setViewMode('anchor')}
                            >
                                <i className="fas fa-book-bookmark"></i>
                                <span>Textbook Anchor</span>
                            </button>
                        </div>
                    )}
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
                                    <div className="ml-cinema-stage">
                                        {activeAsset ? (
                                            activeAsset.asset_type === 'diagram_svg' ? (
                                                <div 
                                                    className="ml-visual-card-svg" 
                                                    dangerouslySetInnerHTML={{ __html: activeAsset.content_payload }} 
                                                />
                                            ) : (
                                                <div className="ml-visual-card-image">
                                                    <img src={activeAsset.image_url} alt={activeAsset.title || 'Lecture Illustration'} />
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
                                                        <img src={activeAsset.image_url} alt="Illustration" />
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

                                {/* SUBTITLE KARAOKE BAR */}
                                <div className="ml-karaoke-bar">
                                    <div className="ml-karaoke-stream">
                                        {karaokeData.sentenceSnippet.map((item, idx) => (
                                            <span 
                                                key={idx} 
                                                className={`ml-karaoke-word ${item.word === karaokeData.activeWord ? 'active' : ''}`}
                                            >
                                                {item.word}{' '}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* BOTTOM TRANSPORT AUDIO CONTROLS */}
                                <div className="ml-transport-bar">
                                    {/* Timeline Slider with Cue Markers */}
                                    <div 
                                        className="ml-scrub-track" 
                                        ref={progressBarRef} 
                                        onClick={handleSeek}
                                    >
                                        <div 
                                            className="ml-scrub-fill" 
                                            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                                        ></div>
                                        
                                        {/* Section Chapter Boundaries on Track */}
                                        {(audioLesson.sections_manifest || []).map((sec, idx) => (
                                            <div 
                                                key={`sec-${idx}`}
                                                className="ml-section-tick"
                                                style={{ left: `${duration > 0 ? (sec.start_time / duration) * 100 : 0}%` }}
                                                title={`Section: ${sec.title} (${formatTime(sec.start_time)})`}
                                            ></div>
                                        ))}

                                        {/* Visual Cue Tick Markers on Track */}
                                        {(audioLesson.cue_timeline || []).map((cue, idx) => (
                                            <div 
                                                key={`cue-${idx}`}
                                                className="ml-cue-tick"
                                                style={{ left: `${duration > 0 ? (cue.time / duration) * 100 : 0}%` }}
                                                title={`Event: ${cue.type} at ${formatTime(cue.time)}`}
                                            ></div>
                                        ))}
                                    </div>

                                    {/* Controls Row */}
                                    <div className="ml-transport-row">
                                        <div className="ml-time-display">
                                            <span>{formatTime(currentTime)}</span>
                                            <span className="ml-time-divider">/</span>
                                            <span>{formatTime(duration)}</span>
                                        </div>

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