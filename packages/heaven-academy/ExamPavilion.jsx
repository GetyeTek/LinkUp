import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invokeBookReader } from './api.js';
import { universityIconMap } from './components/BookCard.jsx';
import { supabase } from '@linkup-platform/sdk-core';
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
    const [selectedCourseName, setSelectedCourseName] = useState('All Courses');
    const [examSearch, setExamSearch] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    // Dropdown Drawer States
    const [isCampusDrawerOpen, setIsCampusDrawerOpen] = useState(false);
    const [isCourseDrawerOpen, setIsCourseDrawerOpen] = useState(false);
    const [isTermDrawerOpen, setIsTermDrawerOpen] = useState(false);
    const [campusSearch, setCampusSearch] = useState('');
    const [courseSearch, setCourseSearch] = useState('');

    const [activeSession, setActiveSession] = useState(null);
    const examCache = useRef({});

    // Fetch exams with in-memory caching and client-side fallback
    useEffect(() => {
        const controller = new AbortController();
        const cacheKey = selectedUniversityId || 'all';

        if (examCache.current[cacheKey]) {
            setExams(examCache.current[cacheKey]);
            setLoading(false);
            return;
        }

        setLoading(true);

        const fetchExamsAsync = async () => {
            try {
                const payload = { action: 'list_exams' };
                if (selectedUniversityId && selectedUniversityId !== 'all') {
                    payload.university_id = selectedUniversityId;
                }

                const data = await invokeBookReader(payload, controller.signal);
                let fetchedExams = data?.exams || [];

                // Client fallback: If edge function returns empty on "All Campuses", query PostgREST directly
                if (fetchedExams.length === 0 && selectedUniversityId === 'all') {
                    const { data: directData } = await supabase
                        .from('exams')
                        .select('id, exam_type, date, time_allowed_minutes, total_marks, university_id, courses(code, name), universities(name)')
                        .order('created_at', { ascending: false });

                    if (directData && directData.length > 0) {
                        fetchedExams = directData.map(exam => ({
                            ...exam,
                            course_name: exam.courses?.name || 'General Assessment',
                            course_code: exam.courses?.code || 'EXAM',
                            university_name: exam.universities?.name || null
                        }));
                    }
                }

                examCache.current[cacheKey] = fetchedExams;
                setExams(fetchedExams);
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("[ExamPavilion] Failed to fetch exams:", err);
                setExams([]);
            } finally {
                setLoading(false);
            }
        };

        fetchExamsAsync();
        return () => controller.abort();
    }, [selectedUniversityId]);

    // Extract courses with friendly names
    const availableCourses = useMemo(() => {
        const courseMap = new Map();
        exams.forEach(e => {
            const name = e.course_name && e.course_name !== 'General Assessment' 
                ? e.course_name 
                : (e.courses?.name || 'General Assessment');
            const code = e.course_code || e.courses?.code || '';
            if (name && !courseMap.has(name)) {
                courseMap.set(name, { name, code });
            }
        });

        const sorted = Array.from(courseMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        return [{ name: 'All Courses', code: '' }, ...sorted];
    }, [exams]);

    // Filter courses for the Course Picker modal
    const filteredCoursePickerList = useMemo(() => {
        if (!courseSearch.trim()) return availableCourses;
        const q = courseSearch.toLowerCase().trim();
        return availableCourses.filter(c => 
            c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
        );
    }, [availableCourses, courseSearch]);

    // Filter exams according to term, friendly course name, and text search
    const filteredExams = useMemo(() => {
        return exams.filter(e => {
            const type = (e.exam_type || e.type || e.category || '').toLowerCase();
            if (termTab === 'Midterm' && !type.includes('mid')) return false;
            if (termTab === 'Final' && !type.includes('final')) return false;
            if (termTab === 'Other' && (type.includes('mid') || type.includes('final'))) return false;

            if (selectedCourseName !== 'All Courses') {
                const name = e.course_name || e.courses?.name || '';
                if (name.toLowerCase() !== selectedCourseName.toLowerCase()) return false;
            }

            if (examSearch.trim()) {
                const q = examSearch.toLowerCase().trim();
                const titleMatch = (e.course_name || e.courses?.name || '').toLowerCase().includes(q);
                const codeMatch = (e.course_code || e.courses?.code || '').toLowerCase().includes(q);
                const dateMatch = (e.date || '').toLowerCase().includes(q);
                const uniMatch = (e.university_name || e.universities?.name || '').toLowerCase().includes(q);
                if (!titleMatch && !codeMatch && !dateMatch && !uniMatch) return false;
            }

            return true;
        });
    }, [exams, termTab, selectedCourseName, examSearch]);

    // Campus switcher live search
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
            {/* CLEAN COMPACT TOPBAR */}
            <header className="pav-topbar">
                <button className="icon-button pav-back-btn" onClick={onClose} title="Back to Study Hub">
                    <i className="fas fa-chevron-left"></i>
                </button>

                {/* VISUALLY CLICKABLE TACTILE DROPDOWN PILL */}
                <div 
                    className={`pav-campus-selector-pill ${isHomeSelected ? 'is-home' : ''}`}
                    onClick={() => setIsCampusDrawerOpen(true)}
                    role="button"
                    tabIndex={0}
                >
                    <div className="pav-pill-emblem">
                        <i className={`fa-solid ${selectedUniversityId === 'all' ? 'fa-globe' : (universityIconMap[activeUniversity.name] || 'fa-landmark')}`}></i>
                    </div>
                    <div className="pav-pill-text-col">
                        <span className="pav-pill-sub">
                            {isHomeSelected ? '⭐ YOUR CAMPUS' : selectedUniversityId === 'all' ? '🌐 NATIONAL ARCHIVE' : 'CAMPUS ARCHIVE'}
                        </span>
                        <span className="pav-pill-title">
                            {activeUniversity.name}
                        </span>
                    </div>
                    <i className="fas fa-chevron-down pav-pill-chevron"></i>
                </div>

                <button 
                    className={`icon-button pav-search-toggle ${isSearchOpen ? 'active' : ''}`} 
                    onClick={() => setIsSearchOpen(!isSearchOpen)}
                    title="Search exams"
                >
                    <i className={`fas ${isSearchOpen ? 'fa-times' : 'fa-search'}`}></i>
                </button>
            </header>

            {/* EXPANDABLE SEARCH BAR */}
            {isSearchOpen && (
                <div className="pav-expand-search-bar">
                    <i className="fas fa-search"></i>
                    <input 
                        type="text" 
                        placeholder="Search exam title, year, or code..."
                        value={examSearch}
                        onChange={e => setExamSearch(e.target.value)}
                        autoFocus
                    />
                    {examSearch && (
                        <button className="pav-clear-search" onClick={() => setExamSearch('')}>
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
            )}

            {/* COMPACT TWO-DROPDOWN COMMAND ROW (44px HEIGHT) */}
            <div className="pav-quick-bar">
                <button 
                    className={`pav-dropdown-btn ${selectedCourseName !== 'All Courses' ? 'filtered' : ''}`}
                    onClick={() => setIsCourseDrawerOpen(true)}
                >
                    <i className="fas fa-book-open"></i>
                    <span className="btn-label">{selectedCourseName}</span>
                    <i className="fas fa-chevron-down btn-arrow"></i>
                </button>

                <button 
                    className={`pav-dropdown-btn ${termTab !== 'All' ? 'filtered' : ''}`}
                    onClick={() => setIsTermDrawerOpen(true)}
                >
                    <i className="fas fa-calendar-check"></i>
                    <span className="btn-label">{termTab === 'All' ? 'All Terms' : `${termTab} Exams`}</span>
                    <i className="fas fa-chevron-down btn-arrow"></i>
                </button>
            </div>

            {/* SPLIT / MASTER-DETAIL CONTAINER */}
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
                        {/* 1. All Universities Master Item */}
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
                    <div className="pav-exam-grid">
                        {loading ? (
                            <div className="pav-state-box">
                                <i className="fas fa-circle-notch fa-spin"></i>
                                <p>Synchronizing Academic Archive...</p>
                            </div>
                        ) : filteredExams.length > 0 ? (
                            filteredExams.map((exam, idx) => {
                                const displayCode = exam.course_code || exam.courses?.code || "EXAM";
                                const displayTitle = exam.course_name || exam.courses?.name || exam.exam_type || "General Assessment";
                                const displayDate = exam.date || "Unknown Date";
                                const displayTime = exam.time_allowed_minutes ? `${exam.time_allowed_minutes}m` : "N/A";
                                const displayMarks = exam.total_marks ? `${exam.total_marks}` : "---";
                                const examUniName = exam.university_name || exam.universities?.name || (selectedUniversityId !== 'all' ? activeUniversity.name : null);

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
                                        <i className="fas fa-globe"></i> Explore All Campuses
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* 1. CAMPUS SELECTOR BOTTOM SHEET */}
            {isCampusDrawerOpen && (
                <div className="pav-drawer-overlay" onClick={() => setIsCampusDrawerOpen(false)}>
                    <div className="pav-drawer-sheet" onClick={e => e.stopPropagation()}>
                        <div className="pds-drawer-header">
                            <div className="pds-grab-bar"></div>
                            <div className="pds-drawer-title-row">
                                <h3>Select University Archive</h3>
                                <button className="icon-button" onClick={() => setIsCampusDrawerOpen(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>

                            {/* Quick Shortcut Buttons */}
                            <div className="pds-shortcut-grid">
                                {homeUniversity && (
                                    <div 
                                        className={`pds-shortcut-card home ${isHomeSelected ? 'active' : ''}`}
                                        onClick={() => { setSelectedUniversityId(homeUniversity.id); setIsCampusDrawerOpen(false); }}
                                    >
                                        <i className="fas fa-star"></i>
                                        <div>
                                            <strong>My Campus</strong>
                                            <span>{homeUniversity.name.split(' ')[0]}</span>
                                        </div>
                                    </div>
                                )}
                                <div 
                                    className={`pds-shortcut-card all ${selectedUniversityId === 'all' ? 'active' : ''}`}
                                    onClick={() => { setSelectedUniversityId('all'); setIsCampusDrawerOpen(false); }}
                                >
                                    <i className="fas fa-globe"></i>
                                    <div>
                                        <strong>All Campuses</strong>
                                        <span>Nationwide</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pds-search-box" style={{ margin: '0.5rem 0' }}>
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
                                {popularCampuses.slice(0, 5).map(u => (
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

            {/* 2. COURSE SELECTOR BOTTOM SHEET (FRIENDLY NAMES, NOT CODE PILLS) */}
            {isCourseDrawerOpen && (
                <div className="pav-drawer-overlay" onClick={() => setIsCourseDrawerOpen(false)}>
                    <div className="pav-drawer-sheet" onClick={e => e.stopPropagation()}>
                        <div className="pds-drawer-header">
                            <div className="pds-grab-bar"></div>
                            <div className="pds-drawer-title-row">
                                <h3>Select Course</h3>
                                <button className="icon-button" onClick={() => setIsCourseDrawerOpen(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                            
                            <div className="pds-search-box" style={{ margin: '0.75rem 0 0.25rem 0' }}>
                                <i className="fas fa-search"></i>
                                <input 
                                    type="text" 
                                    placeholder="Search course by name..."
                                    value={courseSearch}
                                    onChange={e => setCourseSearch(e.target.value)}
                                    autoFocus
                                />
                                {courseSearch && (
                                    <button className="pds-clear-btn" onClick={() => setCourseSearch('')}>
                                        <i className="fas fa-times"></i>
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="pds-drawer-list">
                            {filteredCoursePickerList.map((courseItem) => {
                                const isSelected = selectedCourseName === courseItem.name;
                                return (
                                    <div 
                                        key={courseItem.name}
                                        className={`pds-course-picker-item ${isSelected ? 'active' : ''}`}
                                        onClick={() => {
                                            setSelectedCourseName(courseItem.name);
                                            setIsCourseDrawerOpen(false);
                                        }}
                                    >
                                        <div className="pds-course-left">
                                            <div className="pds-course-title">{courseItem.name}</div>
                                            {courseItem.code && (
                                                <div className="pds-course-code-badge">{courseItem.code}</div>
                                            )}
                                        </div>
                                        {isSelected && <i className="fas fa-check pav-check-active"></i>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* 3. TERM SELECTOR BOTTOM SHEET */}
            {isTermDrawerOpen && (
                <div className="pav-drawer-overlay" onClick={() => setIsTermDrawerOpen(false)}>
                    <div className="pav-drawer-sheet" onClick={e => e.stopPropagation()}>
                        <div className="pds-drawer-header">
                            <div className="pds-grab-bar"></div>
                            <div className="pds-drawer-title-row">
                                <h3>Select Exam Term</h3>
                                <button className="icon-button" onClick={() => setIsTermDrawerOpen(false)}>
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                        </div>

                        <div className="pds-drawer-list" style={{ paddingBottom: '2.5rem' }}>
                            {[
                                { id: 'All', title: 'All Terms', desc: 'Browse midterms, finals, and model exams' },
                                { id: 'Midterm', title: 'Midterm Examinations', desc: 'Standard mid-semester assessments' },
                                { id: 'Final', title: 'Final Examinations', desc: 'Comprehensive end-of-semester papers' },
                                { id: 'Other', title: 'Model & Mock Exams', desc: 'Practice tests and departmental mock papers' }
                            ].map(termItem => {
                                const isSelected = termTab === termItem.id;
                                return (
                                    <div 
                                        key={termItem.id}
                                        className={`pds-term-picker-item ${isSelected ? 'active' : ''}`}
                                        onClick={() => {
                                            setTermTab(termItem.id);
                                            setIsTermDrawerOpen(false);
                                        }}
                                    >
                                        <div className="pds-term-left">
                                            <div className="pds-term-title">{termItem.title}</div>
                                            <div className="pds-term-desc">{termItem.desc}</div>
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