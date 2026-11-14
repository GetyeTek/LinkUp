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

    // Script-Driven Chapter Catalog & Playlist State
    const [readyLessonRows, setReadyLessonRows] = useState([]);
    const [chapterLessons, setChapterLessons] = useState([]);
    const [activeLessonIndex, setActiveLessonIndex] = useState(0);
    const [activeChapterTitle, setActiveChapterTitle] = useState('');
    const [isOutlineOpen, setIsOutlineOpen] = useState(false);

    // Progress & Resume Memory (localStorage)
    const PROGRESS_STORAGE_KEY = 'miron_lecture_progress_v1';
    const [resumeProgress, setResumeProgress] = useState(() => {
        try {
            const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    });
    const [completedLessonIds, setCompletedLessonIds] = useState(() => {
        try {
            const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return new Set(Array.isArray(parsed?.completedLessonIds) ? parsed.completedLessonIds : []);
        } catch (e) { return new Set(); }
    });

    // Audio Lesson, Visual Asset & Pre-Fetched Textbook Blocks Cache
    const [audioLesson, setAudioLesson] = useState(null);
    const [visualAssets, setVisualAssets] = useState({});
    const [cachedPageBlocks, setCachedPageBlocks] = useState({});
    const [sectionPages, setSectionPages] = useState([]);
    const [isLoadingLesson, setIsLoadingLesson] = useState(false);

    // Studio Player State
    const [viewMode, setViewMode] = useState('cinema'); // 'cinema' | 'anchor'
    const [pinnedBlockIndex, setPinnedBlockIndex] = useState(0);
    const [viewState, setViewState] = useState('full');
    const [isDebugOpen, setIsDebugOpen] = useState(false);

    // DOM & Element Refs
    const excerptCardRef = useRef(null);
    const cinemaContainerRef = useRef(null);
    const notesDeckRef = useRef(null);

    const compareSectionTags = (tagA, tagB) => {
        const aParts = String(tagA || '999').split('.').map(n => parseInt(n, 10) || 0);
        const bParts = String(tagB || '999').split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(aParts.length, bParts.length);
        for (let i = 0; i < len; i++) {
            const diff = (aParts[i] ?? -1) - (bParts[i] ?? -1);
            if (diff !== 0) return diff;
        }
        return 0;
    };

    const extractTagFromRow = (row) => {
        const manifestFirst = Array.isArray(row?.sections_manifest) && row.sections_manifest[0]?.section_tag;
        if (manifestFirst) return String(manifestFirst).trim();
        const m = String(row?.section_title || '').match(/^([0-9]+(?:\.[0-9]+)*)/);
        return m ? m[1] : '';
    };

    // Flatten chapterLessons (and multi-section manifests) into a unified script-defined sections list
    const chapterSections = React.useMemo(() => {
        const list = [];
        chapterLessons.forEach((lesson, lIdx) => {
            let manifest = lesson.sections_manifest;
            if (typeof manifest === 'string') {
                try { manifest = JSON.parse(manifest); } catch (e) { manifest = []; }
            }
            if (Array.isArray(manifest) && manifest.length > 0) {
                manifest.forEach((sec, sIdx) => {
                    list.push({
                        key: `${lesson.id}::${sIdx}`,
                        lessonId: lesson.id,
                        lessonIndex: lIdx,
                        sectionTag: sec.section_tag || extractTagFromRow(lesson),
                        title: sec.title || lesson.section_title,
                        startTimeInLesson: Number(sec.start_time || 0),
                        endTimeInLesson: Number(sec.end_time || lesson.duration_seconds || 0),
                        duration: Number(sec.duration || lesson.duration_seconds || 0),
                        pageNumber: lesson.page_number || 1
                    });
                });
            } else {
                list.push({
                    key: `${lesson.id}::0`,
                    lessonId: lesson.id,
                    lessonIndex: lIdx,
                    sectionTag: extractTagFromRow(lesson),
                    title: lesson.section_title || 'Core Lecture',
                    startTimeInLesson: 0,
                    endTimeInLesson: Number(lesson.duration_seconds || 0),
                    duration: Number(lesson.duration_seconds || 0),
                    pageNumber: lesson.page_number || 1
                });
            }
        });
        return list;
    }, [chapterLessons]);

    const activateLessonAtIndex = (lessonsArr, targetIdx, seekOffset = 0, explicitTitle = null) => {
        const target = lessonsArr[targetIdx];
        if (!target) return;

        if (Array.isArray(target.cue_timeline)) {
            target.cue_timeline.sort((a, b) => (a.time || 0) - (b.time || 0));
        }

        const secTitle = explicitTitle || target.section_title || 'Lecture Track';
        setActiveLessonIndex(targetIdx);
        setSelectedSection({ title: secTitle, page: target.page_number || 1 });
        lectureEngine.pendingSeekTimeRef.current = seekOffset;
        setAudioLesson(target);
        lectureEngine.setDuration(target.duration_seconds || 0);
        lectureEngine.setCurrentTime(seekOffset);
        if (cachedPageBlocks[target.page_number]) {
            setSectionPages(cachedPageBlocks[target.page_number]);
        }

        if (target.audio_url && lectureEngine.audioRef.current && lectureEngine.audioRef.current.src === proxyUrl(target.audio_url)) {
            try {
                lectureEngine.audioRef.current.currentTime = seekOffset;
                lectureEngine.audioRef.current.play()
                    .then(() => lectureEngine.setIsPlaying(true))
                    .catch(() => lectureEngine.setIsPlaying(false));
            } catch (e) {}
        }
    };

    const handleAdvanceToNextLesson = () => {
        if (audioLesson?.id) {
            setCompletedLessonIds(prev => {
                const next = new Set(prev);
                next.add(audioLesson.id);
                try {
                    const existing = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
                    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
                        ...existing,
                        completedLessonIds: Array.from(next)
                    }));
                } catch (e) {}
                return next;
            });
        }

        if (activeLessonIndex + 1 < chapterLessons.length) {
            const nextIdx = activeLessonIndex + 1;
            const nextLesson = chapterLessons[nextIdx];
            console.log(`⏩ [MironLecture] Auto-advancing to next script section: "${nextLesson.section_title}"`);
            activateLessonAtIndex(chapterLessons, nextIdx, 0);
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
        onLessonEnded: handleAdvanceToNextLesson
    });

    // Determine currently active section item across unified chapterSections
    const activeSectionIndex = React.useMemo(() => {
        if (chapterSections.length === 0 || !audioLesson) return 0;
        const curT = lectureEngine.currentTime || 0;
        const foundIdx = chapterSections.findIndex(s =>
            s.lessonId === audioLesson.id &&
            curT >= Math.max(0, s.startTimeInLesson - 0.5) &&
            (curT <= s.endTimeInLesson || s.endTimeInLesson === 0)
        );
        if (foundIdx !== -1) return foundIdx;
        const fallbackIdx = chapterSections.findIndex(s => s.lessonId === audioLesson.id);
        return fallbackIdx !== -1 ? fallbackIdx : 0;
    }, [chapterSections, audioLesson, lectureEngine.currentTime]);

    // Persist active playback progress periodically
    useEffect(() => {
        if (stage !== 'studio' || !selectedBook || !audioLesson || String(audioLesson.id).startsWith('sim-')) return;
        const curSec = chapterSections[activeSectionIndex];
        const snapshot = {
            bookId: selectedBook.id,
            bookTitle: selectedBook.title,
            courseCode: selectedBook.course_code,
            chapterTitle: activeChapterTitle || audioLesson.chapter_title,
            lessonId: audioLesson.id,
            sectionTitle: curSec?.title || audioLesson.section_title,
            sectionTag: curSec?.sectionTag || '',
            currentTime: Math.floor(lectureEngine.currentTime || 0),
            duration: Math.floor(lectureEngine.duration || audioLesson.duration_seconds || 0),
            updatedAt: Date.now(),
            completedLessonIds: Array.from(completedLessonIds)
        };
        setResumeProgress(snapshot);
        try {
            localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(snapshot));
        } catch (e) {}
    }, [stage, selectedBook?.id, audioLesson?.id, Math.floor((lectureEngine.currentTime || 0) / 5)]);

    // 1. Hydrate Published Curriculum Books & Script-Defined Chapter Metadata
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

        supabase
            .from('book_audio_lessons')
            .select('id, book_id, course_code, chapter_title, section_title, page_number, duration_seconds, sections_manifest, created_at')
            .eq('status', 'ready')
            .order('page_number', { ascending: true })
            .order('created_at', { ascending: true })
            .then(({ data }) => {
                if (Array.isArray(data)) setReadyLessonRows(data);
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

    // Build Script-Driven Chapters List for a Book
    const getChaptersForBook = (book) => {
        if (!book) return [];
        const bookRows = readyLessonRows.filter(r => r.book_id === book.id);
        const chapterMap = new Map();

        bookRows.forEach(row => {
            const chKey = (row.chapter_title || 'Core Chapter').trim();
            if (!chapterMap.has(chKey)) {
                chapterMap.set(chKey, {
                    chapterTitle: chKey,
                    isReady: true,
                    rows: [],
                    sections: [],
                    totalDuration: 0,
                    minPage: row.page_number || 9999
                });
            }
            const group = chapterMap.get(chKey);
            group.rows.push(row);
            group.totalDuration += Number(row.duration_seconds || 0);
            if (row.page_number && row.page_number < group.minPage) group.minPage = row.page_number;

            let manifest = row.sections_manifest;
            if (typeof manifest === 'string') {
                try { manifest = JSON.parse(manifest); } catch (e) { manifest = []; }
            }
            if (Array.isArray(manifest) && manifest.length > 0) {
                manifest.forEach(s => group.sections.push({
                    lessonId: row.id,
                    sectionTag: s.section_tag || extractTagFromRow(row),
                    title: s.title || row.section_title,
                    duration: Number(s.duration || row.duration_seconds || 0)
                }));
            } else {
                group.sections.push({
                    lessonId: row.id,
                    sectionTag: extractTagFromRow(row),
                    title: row.section_title,
                    duration: Number(row.duration_seconds || 0)
                });
            }
        });

        const readyChapters = Array.from(chapterMap.values()).map(ch => {
            ch.sections.sort((a, b) => compareSectionTags(a.sectionTag, b.sectionTag));
            return ch;
        }).sort((a, b) => a.minPage - b.minPage);

        // Append upcoming TOC chapters that don't have ready audio yet (dimmed "In Production")
        const readyTitlesLower = new Set(readyChapters.map(c => c.chapterTitle.toLowerCase()));
        (book.toc || []).forEach(node => {
            const title = (node.title || '').trim();
            if (!title) return;
            const alreadyCovered = Array.from(readyTitlesLower).some(rt =>
                rt === title.toLowerCase() || title.toLowerCase().includes(rt) || rt.includes(title.toLowerCase())
            );
            if (!alreadyCovered) {
                readyChapters.push({
                    chapterTitle: title,
                    isReady: false,
                    rows: [],
                    sections: [],
                    totalDuration: 0,
                    minPage: node.page || 9999
                });
            }
        });

        return readyChapters;
    };

    // Navigation & Chapter Loader Handlers
    const handleSelectCourse = (book) => {
        setSelectedBook(book);
        setStage('toc_select');
    };

    const handleSelectChapter = async (chapterGroup, resumeTarget = null, explicitBook = null) => {
        const targetBook = explicitBook || selectedBook;
        if (!targetBook || !chapterGroup?.isReady) return;

        setSelectedBook(targetBook);
        setIsLoadingLesson(true);
        setIsOutlineOpen(false);
        setActiveChapterTitle(chapterGroup.chapterTitle);
        setStage('studio');
        setViewMode('cinema');

        try {
            // 1. Fetch ALL ready lessons for this chapter ordered naturally by script tag & page
            const { data: rows } = await supabase
                .from('book_audio_lessons')
                .select('*')
                .eq('book_id', targetBook.id)
                .eq('chapter_title', chapterGroup.chapterTitle)
                .eq('status', 'ready')
                .order('page_number', { ascending: true })
                .order('created_at', { ascending: true });

            const sortedLessons = (Array.isArray(rows) ? [...rows] : []).sort((a, b) => {
                const tagDiff = compareSectionTags(extractTagFromRow(a), extractTagFromRow(b));
                if (tagDiff !== 0) return tagDiff;
                return (a.page_number || 0) - (b.page_number || 0);
            });

            if (sortedLessons.length === 0) {
                setChapterLessons([]);
                setAudioLesson(null);
                lectureEngine.setIsPlaying(false);
                return;
            }

            // 2. Fetch Visual Assets once for the entire course
            const codeWithSpace = (targetBook.course_code || '').trim();
            const codeWithUnderscore = codeWithSpace.replace(/\s+/g, '_');
            const { data: assets } = await supabase
                .from('course_visual_assets')
                .select('*')
                .or(`course_code.eq."${codeWithSpace}",course_code.eq."${codeWithUnderscore}"`);

            const assetMap = {};
            if (Array.isArray(assets)) {
                const domParser = (typeof window !== 'undefined' && window.DOMParser) ? new DOMParser() : null;
                assets.forEach(a => {
                    assetMap[a.id] = a;
                    if (a.asset_type === 'image' && a.image_url) {
                        const prewarmImg = new Image();
                        prewarmImg.src = proxyUrl(a.image_url);
                        if (typeof prewarmImg.decode === 'function') prewarmImg.decode().catch(() => {});
                    }
                    if (a.asset_type === 'diagram_svg' && a.content_payload && domParser) {
                        try { domParser.parseFromString(a.content_payload, 'image/svg+xml'); } catch (e) {}
                    }
                });
            }
            setVisualAssets(assetMap);

            // 3. Batch-Cache ALL referenced textbook pages across the entire chapter once
            const offset = targetBook.page_offset || 0;
            const pagesToFetchSet = new Set();
            const isTextbookCue = (t) => ['page_block', 'show_page', 'page', 'highlight', 'block', 'anchor_block'].includes(t);

            sortedLessons.forEach(l => {
                pagesToFetchSet.add(Math.max(1, (l.page_number || 1) + offset));
                if (Array.isArray(l.cue_timeline)) {
                    l.cue_timeline.forEach(cue => {
                        if (isTextbookCue(cue.type)) {
                            const pNum = parseInt(String(cue.target || '').trim().split(':')[0], 10);
                            if (!isNaN(pNum)) pagesToFetchSet.add(pNum);
                        }
                    });
                }
            });

            const { data: batchPages } = await supabase.rpc('get_book_page_blocks', {
                p_book_id: targetBook.id,
                p_course_code: targetBook.course_code,
                p_page_numbers: Array.from(pagesToFetchSet)
            });

            const blocksMap = {};
            if (Array.isArray(batchPages)) {
                batchPages.forEach(p => {
                    blocksMap[p.page_number] = ensureBlockArray(p.content_json);
                });
            }
            setCachedPageBlocks(blocksMap);
            setChapterLessons(sortedLessons);

            // 4. Determine starting lesson & timestamp (supports Resume!)
            let startIdx = 0;
            let startTime = 0;
            if (resumeTarget?.lessonId) {
                const rIdx = sortedLessons.findIndex(l => l.id === resumeTarget.lessonId);
                if (rIdx !== -1) {
                    startIdx = rIdx;
                    startTime = Math.max(0, Math.min((sortedLessons[rIdx].duration_seconds || 0) - 2, resumeTarget.currentTime || 0));
                }
            }

            const firstLesson = sortedLessons[startIdx];
            if (Array.isArray(firstLesson.cue_timeline)) {
                firstLesson.cue_timeline.sort((a, b) => (a.time || 0) - (b.time || 0));
            }
            setActiveLessonIndex(startIdx);
            setSelectedSection({ title: firstLesson.section_title, page: firstLesson.page_number || 1 });
            setSectionPages(blocksMap[firstLesson.page_number] || []);
            lectureEngine.pendingSeekTimeRef.current = startTime;
            setAudioLesson(firstLesson);
            lectureEngine.setDuration(firstLesson.duration_seconds || 0);
            lectureEngine.setCurrentTime(startTime);

            if (firstLesson.audio_url && lectureEngine.audioRef.current && lectureEngine.audioRef.current.src === proxyUrl(firstLesson.audio_url)) {
                try {
                    lectureEngine.audioRef.current.currentTime = startTime;
                    lectureEngine.audioRef.current.play()
                        .then(() => lectureEngine.setIsPlaying(true))
                        .catch(() => lectureEngine.setIsPlaying(false));
                } catch (e) {}
            }
        } catch (err) {
            console.error('Failed to load chapter studio:', err);
        } finally {
            setIsLoadingLesson(false);
        }
    };

    const handleResumeLastSession = () => {
        if (!resumeProgress?.bookId) return;
        const targetBook = books.find(b => b.id === resumeProgress.bookId);
        if (!targetBook) return;
        const chapters = getChaptersForBook(targetBook);
        const targetChapter = chapters.find(c => c.isReady && c.chapterTitle === resumeProgress.chapterTitle) || chapters.find(c => c.isReady);
        if (targetChapter) {
            handleSelectChapter(targetChapter, resumeProgress, targetBook);
        }
    };

    const handleSelectSectionItem = (sectionItem) => {
        if (!sectionItem) return;
        setIsOutlineOpen(false);
        if (audioLesson && sectionItem.lessonId === audioLesson.id) {
            const targetTime = sectionItem.startTimeInLesson || 0;
            if (lectureEngine.audioRef.current && audioLesson.audio_url) {
                lectureEngine.audioRef.current.currentTime = targetTime;
                if (lectureEngine.audioRef.current.paused) {
                    lectureEngine.audioRef.current.play().then(() => lectureEngine.setIsPlaying(true)).catch(() => {});
                }
            }
            lectureEngine.setCurrentTime(targetTime);
            setSelectedSection(prev => ({ ...prev, title: sectionItem.title }));
        } else {
            activateLessonAtIndex(chapterLessons, sectionItem.lessonIndex, sectionItem.startTimeInLesson || 0, sectionItem.title);
        }
    };

    const handleStepSection = (delta) => {
        if (chapterSections.length === 0) return;
        const nextIdx = activeSectionIndex + delta;
        if (nextIdx >= 0 && nextIdx < chapterSections.length) {
            handleSelectSectionItem(chapterSections[nextIdx]);
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

        setChapterLessons([simLesson]);
        setActiveLessonIndex(0);
        setActiveChapterTitle('Simulation Studio');
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
                            <button
                                type="button"
                                className="ml-studio-title-pill is-interactive"
                                onClick={(e) => { e.stopPropagation(); setIsOutlineOpen(prev => !prev); lectureEngine.resetInactivityTimer(); }}
                                title="Open Chapter Sections"
                            >
                                <span className="ml-studio-course-tag">{selectedBook?.course_code || 'COURSE'}</span>
                                <span className="ml-studio-section-name">
                                    {chapterSections[activeSectionIndex]?.sectionTag ? `${chapterSections[activeSectionIndex].sectionTag} • ` : ''}
                                    {chapterSections[activeSectionIndex]?.title || selectedSection?.title}
                                </span>
                                <i className="fas fa-chevron-down ml-title-caret"></i>
                            </button>
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
                    {stage === 'studio' && audioLesson && (
                        <div className="ml-mode-switch-pill" onClick={(e) => e.stopPropagation()}>
                            <button
                                type="button"
                                className={`ml-mode-btn ${viewMode === 'cinema' ? 'active' : ''}`}
                                onClick={() => setViewMode('cinema')}
                                title="Cinema Stage"
                            >
                                <i className="fas fa-clapperboard"></i>
                                <span className="ml-mode-label">Stage</span>
                            </button>
                            <button
                                type="button"
                                className={`ml-mode-btn ${viewMode === 'anchor' ? 'active' : ''}`}
                                onClick={() => setViewMode('anchor')}
                                title="Textbook Block View"
                            >
                                <i className="fas fa-book-open"></i>
                                <span className="ml-mode-label">Book</span>
                            </button>
                        </div>
                    )}
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

                {/* STAGES 0 & 1: COURSE GRID & SCRIPT-DRIVEN CHAPTERS HUB */}
                {stage !== 'studio' && (
                    <MironCatalogView
                        stage={stage}
                        books={books}
                        selectedBook={selectedBook}
                        chaptersForBook={getChaptersForBook(selectedBook)}
                        readyLessonRows={readyLessonRows}
                        completedLessonIds={completedLessonIds}
                        resumeProgress={resumeProgress}
                        t={t}
                        onSelectCourse={handleSelectCourse}
                        onSelectChapter={handleSelectChapter}
                        onResumeLastSession={handleResumeLastSession}
                    />
                )}

                {/* STAGE 2: STUDIO WORKSPACE & PLAYER */}
                {stage === 'studio' && (
                    <MironStudioStage
                        isLoadingLesson={isLoadingLesson}
                        audioLesson={audioLesson}
                        selectedBook={selectedBook}
                        selectedSection={selectedSection}
                        activeChapterTitle={activeChapterTitle}
                        chapterSections={chapterSections}
                        activeSectionIndex={activeSectionIndex}
                        completedLessonIds={completedLessonIds}
                        isOutlineOpen={isOutlineOpen}
                        setIsOutlineOpen={setIsOutlineOpen}
                        onSelectSectionItem={handleSelectSectionItem}
                        onStepSection={handleStepSection}
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