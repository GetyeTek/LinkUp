import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invokeBookReader } from './api.js';
import { universityIconMap } from './components/BookCard.jsx';
import ExamSession from './ExamSession.jsx';
import './ExamPavilion.css';

const ExamPavilion = ({ 
    university: initialUniversity, 
    universities = [], 
    homeUniversityId, 
    onClose 
}) => {
    const [allUnis, setAllUnis] = useState(universities);

    // Self-healing: Fetch universities if not supplied by parent
    useEffect(() => {
        if (universities.length > 0) {
            setAllUnis(universities);
        } else {
            invokeBookReader({ action: 'list_universities' })
                .then(data => {
                    if (data?.universities) setAllUnis(data.universities);
                })
                .catch(() => {});
        }
    }, [universities]);

    // Initial university resolver: Prioritize home campus from profile
    const resolvedInitialId = useMemo(() => {
        if (initialUniversity?.id) return initialUniversity.id;
        if (homeUniversityId) return homeUniversityId;
        if (allUnis.length > 0) return allUnis[0].id;
        return 'all';
    }, [initialUniversity, homeUniversityId, allUnis]);

    const [selectedUniversityId, setSelectedUniversityId] = useState(resolvedInitialId);

    // Sync state once async profile or university list resolves
    useEffect(() => {
        if (selectedUniversityId === 'all' && resolvedInitialId !== 'all') {
            setSelectedUniversityId(resolvedInitialId);
        }
    }, [resolvedInitialId]);

    const activeUniversity = useMemo(() => {
        if (selectedUniversityId === 'all') {
            return { id: 'all', name: 'All Ethiopian Universities' };
        }
        return allUnis.find(u => u.id === selectedUniversityId) || { id: selectedUniversityId, name: 'University Archive' };
    }, [selectedUniversityId, allUnis]);

    const homeUniversity = useMemo(() => {
        if (!homeUniversityId) return null;
        return allUnis.find(u => u.id === homeUniversityId) || null;
    }, [homeUniversityId, allUnis]);

    const isHomeSelected = homeUniversityId && selectedUniversityId === homeUniversityId;

    // Exam feed states
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [termTab, setTermTab] = useState('All'); // 'All' | 'Midterm' | 'Final' | 'Other'
    const [selectedCourse, setSelectedCourse] = useState('All');
    const [examSearch, setExamSearch] = useState('');
    const [campusSearch, setCampusSearch] = useState('');
    const [isCampusDrawerOpen, setIsCampusDrawerOpen] = useState(false);
    const [activeSession, setActiveSession] = useState(null);
    const examCache = useRef({});

    // Fetch exams with in-memory caching for instantaneous tab shifts
    useEffect(() => {
        const controller = new AbortController();
        const cacheKey = selectedUniversityId || 'all';

        if (examCache.current[cacheKey]) {
            setExams(examCache.current[cacheKey]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const payload = { action: 'list_exams' };
        if (selectedUniversityId && selectedUniversityId !== 'all') {
            payload.university_id = selectedUniversityId;
        }

        invokeBookReader(payload, controller.signal)
            .then(data => {
                if (data?.exams) {
                    examCache.current[cacheKey] = data.exams;
                    setExams(data.exams);
                } else {
                    setExams([]);
                }
                setLoading(false);
            })
            .catch(err => {
                if (err.name === 'AbortError') return;
                console.error("[ExamPavilion] Failed to fetch exams:", err);
                setExams([]);
                setLoading(false);
            });

        return () => controller.abort();
    }, [selectedUniversityId]);

    // Extract dynamic course code pills from the active exam payload
    const availableCourses = useMemo(() => {
        const codes = new Set();
        exams.forEach(e => {
            if (e.course_code) codes.add(e.course_code.toUpperCase().trim());
        });
        return ['All', ...Array.from(codes).sort()];
    }, [exams]);

    // Filter exams according to term, course, and text search
    const filteredExams = useMemo(() => {
        return exams.filter(e => {
            const type = (e.exam_type || e.type || e.category || '').toLowerCase();
            if (termTab === 'Midterm' && !type.includes('mid')) return false;
            if (termTab === 'Final' && !type.includes('final')) return false;
            if (termTab === 'Other' && (type.includes('mid') || type.includes('final'))) return false;

            if (selectedCourse !== 'All') {
                const code = (e.course_code || '').toUpperCase().trim();
                if (code !== selectedCourse) return false;
            }

            if (examSearch.trim()) {
                const q = examSearch.toLowerCase().trim();
                const titleMatch = (e.course_name || e.title || '').toLowerCase().includes(q);
                const codeMatch = (e.course_code || '').toLowerCase().includes(q);
                const dateMatch = (e.date || '').toLowerCase().includes(q);
                const uniMatch = (e.university_name || '').toLowerCase().includes(q);
                if (!titleMatch && !codeMatch && !dateMatch && !uniMatch) return false;
            }

            return true;
        });
    }, [exams, termTab, selectedCourse, examSearch]);

    // Campus switcher live filter
    const filteredCampuses = useMemo(() => {
        if (!campusSearch.trim()) return allUnis;
        const q = campusSearch.toLowerCase().trim();
        return allUnis.filter(u => u.name.toLowerCase().includes(q));
    }, [allUnis, campusSearch]);

    const popularCampuses = useMemo(() => {
        const priorityNames = [
            'Addis Ababa University',
            'Adama Science and Technology University',
            'Addis Ababa Science and Technology University',
            'Hawassa University',
            'Jimma University',
            'University of Gondar',
            'Bahir Dar University',
            'Arba Minch University',
            'Haramaya University'
        ];
        return allUnis.filter(u => priorityNames.includes(u.name));
    }, [allUnis]);

    return (
        <div className="pavilion-overlay">
            {/* TOP HEADER */}
            <header className="pav-topbar">
                <div className="pav-topbar-left">
                    <button className="icon-button pav-back-btn" onClick={onClose} title="Back to Study Hub">
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="pav-scope-trigger" onClick={() => setIsCampusDrawerOpen(true)}>
                        <div className="pav-scope-icon">
                            <i className={`fa-solid ${selectedUniversityId === 'all' ? 'fa-globe' : (universityIconMap[activeUniversity.name] || 'fa-landmark')}`}></i>
                        </div>
                        <div className="pav-scope-text">
                            <div className="pav-scope-badge">
                                {isHomeSelected ? '⭐ Your Campus' : selectedUniversityId === 'all' ? '🌐 National Hub' : 'Campus Archive'}
                            </div>
                            <h1 className="pav-scope-title">
                                {activeUniversity.name}
                                <i className="fas fa-chevron-down pav-chevron-icon"></i>
                            </h1>
                        </div>
                    </div>
                </div>

                <div className="pav-topbar-actions">
                    <button 
                        className={`pav-quick-pill ${selectedUniversityId === 'all' ? 'active' : ''}`}
                        onClick={() => setSelectedUniversityId('all')}
                        title="Browse all universities"
                    >
                        <i className="fas fa-globe"></i>
                        <span>All Campuses</span>
                    </button>
                    {homeUniversity && !isHomeSelected && (
                        <button 
                            className="pav-quick-pill home-pill"
                            onClick={() => setSelectedUniversityId(homeUniversity.id)}
                            title="Return to your home university"
                        >
                            <i className="fas fa-star"></i>
                            <span>My Campus</span>
                        </button>
                    )}
                </div>
            </header>

            {/* SPLIT / MASTER-DETAIL WORKSPACE */}
            <div className="pav-split-container">
                {/* DESKTOP SIDEBAR (>= 900px) */}
                <aside className="pav-desktop-sidebar">
                    <div className="pds-search-box">
                        <i className="fas fa-search"></i>
                        <input 
                            type="text" 
                            placeholder="Filter 40+ universities..."
                            value={campusSearch}
                            onChange={e => setCampusSearch(e.target.value)}
                        />
                        {campusSearch && (
                            <button className="pds-clear-btn" onClick={() => setCampusSearch('')}>
                                <i className="fas fa-times"></i>
                            </button>
                        )}
                    </div>

                    <div className="pds-campuses-scroll">
                        {/* 1. All Universities Item */}
                        <div 
                            className={`pds-campus-item ${selectedUniversityId === 'all' ? 'active' : ''}`}
                            onClick={() => setSelectedUniversityId('all')}
                        >
                            <div className="pds-icon all-globe">
                                <i className="fas fa-globe"></i>
                            </div>
                            <div className="pds-info">
                                <span className="pds-name">All Ethiopian Universities</span>
                                <span className="pds-sub">Cross-Campus Search</span>
                            </div>
                        </div>

                        {/* 2. Pinned Home Campus */}
                        {homeUniversity && (
                            <div 
                                className={`pds-campus-item home-item ${isHomeSelected ? 'active' : ''}`}
                                onClick={() => setSelectedUniversityId(homeUniversity.id)}
                            >
                                <div className="pds-icon home-star">
                                    <i className="fas fa-star"></i>
                                </div>
                                <div className="pds-info">
                                    <span className="pds-name">{homeUniversity.name}</span>
                                    <span className="pds-sub gold-text">⭐ Your Enrolled Campus</span>
                                </div>
                            </div>
                        )}

                        <div className="pds-divider-label">All Academic Institutions</div>

                        {/* 3. Filtered Campus Directory */}
                        {filteredCampuses.map(uni => {
                            const isSelected = selectedUniversityId === uni.id;
                            const isHome = homeUniversityId === uni.id;
                            const iconClass = universityIconMap[uni.name] || 'fa-graduation-cap';
                            return (
                                <div 
                                    key={uni.id} 
                                    className={`pds-campus-item ${isSelected ? 'active' : ''}`}
                                    onClick={() => setSelectedUniversityId(uni.id)}
                                >
                                    <div className="pds-icon">
                                        <i className={`fa-solid ${iconClass}`}></i>
                                    </div>
                                    <div className="pds-info">
                                        <span className="pds-name">{uni.name}</span>
                                        {isHome && <span className="pds-sub gold-text">Your Campus</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* MAIN EXAM FEED CANVAS */}
                <main className="pav-main-stage">
                    {/* FILTER TOOLBAR */}
                    <div className="pav-filters-card">
                        <div className="pav-term-row">
                            <div className="pav-segmented-control">
                                {['All', 'Midterm', 'Final', 'Other'].map(tab => (
                                    <button 
                                        key={tab} 
                                        className={`pav-segment ${termTab === tab ? 'active' : ''}`}
                                        onClick={() => setTermTab(tab)}
                                    >
                                        {tab === 'All' ? 'All Terms' : tab}
                                    </button>
                                ))}
                            </div>

                            <div className="pav-search-wrap">
                                <i className="fas fa-search"></i>
                                <input 
                                    type="text" 
                                    placeholder="Search course code, title, or year..."
                                    value={examSearch}
                                    onChange={e => setExamSearch(e.target.value)}
                                />
                                {examSearch && (
                                    <button className="pav-clear-search" onClick={() => setExamSearch('')}>
                                        <i className="fas fa-times"></i>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* COURSE CHIPS SCROLLER */}
                        {availableCourses.length > 1 && (
                            <div className="pav-courses-strip">
                                {availableCourses.map(course => (
                                    <button 
                                        key={course}
                                        className={`pav-course-chip ${selectedCourse === course ? 'active' : ''}`}
                                        onClick={() => setSelectedCourse(course)}
                                    >
                                        {course === 'All' ? 'All Courses' : course}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* EXAM CARDS GRID */}
                    <div className="pav-exam-grid">
                        {loading ? (
                            <div className="pav-state-box">
                                <i className="fas fa-circle-notch fa-spin"></i>
                                <p>Synchronizing Academic Archive...</p>
                            </div>
                        ) : filteredExams.length > 0 ? (
                            filteredExams.map((exam, idx) => {
                                const displayCode = exam.course_code || "EXAM";
                                const displayTitle = exam.course_name || exam.exam_type || "General Assessment";
                                const displayDate = exam.date || "Unknown Date";
                                const displayTime = exam.time_allowed_minutes ? `${exam.time_allowed_minutes}m` : "N/A";
                                const displayMarks = exam.total_marks ? `${exam.total_marks}` : "---";
                                const examUniName = exam.university_name || (selectedUniversityId !== 'all' ? activeUniversity.name : null);

                                return (
                                    <div 
                                        className="pav-exam-card" 
                                        key={exam.id || idx} 
                                        onClick={() => setActiveSession(exam)}
                                    >
                                        <div className="pav-card-top">
                                            <div className="pav-badge-group">
                                                <span className="pav-course-code">{displayCode}</span>
                                                {selectedUniversityId === 'all' && examUniName && (
                                                    <span className="pav-uni-tag" title={examUniName}>
                                                        <i className="fas fa-landmark"></i> {examUniName}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="pav-year">{displayDate}</span>
                                        </div>

                                        <h2 className="pav-exam-title">{displayTitle}</h2>

                                        <div className="pav-meta-ribbon">
                                            <div className="pav-meta-item">
                                                <i className="far fa-clock"></i> {displayTime}
                                            </div>
                                            <div className="pav-meta-item">
                                                <i className="far fa-file-alt"></i> {displayMarks} Marks
                                            </div>
                                            <div className="pav-meta-item action-tag">
                                                <i className="fas fa-bolt"></i> Practice
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="pav-state-box">
                                <i className="fas fa-folder-open"></i>
                                <h3>No Exams Discovered</h3>
                                <p>No exams match the selected filters for {activeUniversity.name}.</p>
                                {selectedUniversityId !== 'all' && (
                                    <button 
                                        className="pav-switch-btn" 
                                        onClick={() => setSelectedUniversityId('all')}
                                    >
                                        <i className="fas fa-globe"></i> Search All Campuses
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* MOBILE CAMPUS SELECTION BOTTOM SHEET */}
            {isCampusDrawerOpen && (
                <div className="pav-drawer-overlay" onClick={() => setIsCampusDrawerOpen(false)}>
                    <div className="pav-drawer-sheet" onClick={e => e.stopPropagation()}>
                        <div className="pds-drawer-header">
                            <div className="pds-grab-bar"></div>
                            <div className="pds-drawer-title-row">
                                <h3>Select Campus Archive</h3>
                                <button className="icon-button" onClick={() => setIsCampusDrawerOpen(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                            <div className="pds-search-box" style={{ margin: '0.75rem 0' }}>
                                <i className="fas fa-search"></i>
                                <input 
                                    type="text" 
                                    placeholder="Type to filter university..."
                                    value={campusSearch}
                                    onChange={e => setCampusSearch(e.target.value)}
                                    autoFocus
                                />
                                {campusSearch && (
                                    <button className="pds-clear-btn" onClick={() => setCampusSearch('')}>
                                        <i className="fas fa-times"></i>
                                    </button>
                                )}
                            </div>
                            
                            <div className="pds-popular-pills">
                                <button 
                                    className={`pds-pop-pill ${selectedUniversityId === 'all' ? 'active' : ''}`}
                                    onClick={() => { setSelectedUniversityId('all'); setIsCampusDrawerOpen(false); }}
                                >
                                    🌐 All Campuses
                                </button>
                                {homeUniversity && (
                                    <button 
                                        className={`pds-pop-pill ${isHomeSelected ? 'active' : ''}`}
                                        onClick={() => { setSelectedUniversityId(homeUniversity.id); setIsCampusDrawerOpen(false); }}
                                    >
                                        ⭐ My Campus
                                    </button>
                                )}
                                {popularCampuses.slice(0, 4).map(u => (
                                    <button 
                                        key={u.id}
                                        className={`pds-pop-pill ${selectedUniversityId === u.id ? 'active' : ''}`}
                                        onClick={() => { setSelectedUniversityId(u.id); setIsCampusDrawerOpen(false); }}
                                    >
                                        {u.name.replace('University', '').trim()}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pds-drawer-list">
                            {filteredCampuses.map(uni => {
                                const isSelected = selectedUniversityId === uni.id;
                                const isHome = homeUniversityId === uni.id;
                                const iconClass = universityIconMap[uni.name] || 'fa-graduation-cap';
                                return (
                                    <div 
                                        key={uni.id} 
                                        className={`pds-campus-item ${isSelected ? 'active' : ''}`}
                                        onClick={() => { setSelectedUniversityId(uni.id); setIsCampusDrawerOpen(false); }}
                                    >
                                        <div className="pds-icon">
                                            <i className={`fa-solid ${iconClass}`}></i>
                                        </div>
                                        <div className="pds-info">
                                            <span className="pds-name">{uni.name}</span>
                                            {isHome && <span className="pds-sub gold-text">⭐ Your Enrolled Campus</span>}
                                        </div>
                                        {isSelected && <i className="fas fa-check pav-check-active"></i>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {activeSession && <ExamSession exam={activeSession} onClose={() => setActiveSession(null)} />}
        </div>
    );
};

export default ExamPavilion;