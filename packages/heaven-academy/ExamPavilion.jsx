import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invokeBookReader } from './api.js';
import { universityIconMap } from './components/BookCard.jsx';
import { supabase } from '@linkup-platform/sdk-core';
import ExamSession from './ExamSession.jsx';
import './ExamPavilion.css';

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

const ExamPavilion = ({ 
    university: initialUniversity, 
    universities = [], 
    homeUniversityId, 
    onClose 
}) => {
    const [allUnis, setAllUnis] = useState(universities);

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

    const homeUniversity = useMemo(() => {
        if (!homeUniversityId) return null;
        return allUnis.find(u => u.id === homeUniversityId) || null;
    }, [homeUniversityId, allUnis]);

    // Master data states
    const [allExams, setAllExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [subjectSearch, setSubjectSearch] = useState('');

    // Navigation / Active View States
    // selectedSubject === null means Lobby view (Subject Cards).
    // selectedSubject !== null means Course Vault view (Filtered exams).
    const [selectedSubject, setSelectedSubject] = useState(null);
    const [campusScope, setCampusScope] = useState('my_campus'); // 'my_campus' | 'other_campuses' | 'all'
    const [termFilter, setTermFilter] = useState('all'); // 'all' | 'midterm' | 'final'
    const [activeSession, setActiveSession] = useState(null);
    const [expandedUnis, setExpandedUnis] = useState({});

    // Fetch all exams once on mount
    useEffect(() => {
        let isMounted = true;
        setLoading(true);

        const loadExams = async () => {
            try {
                // 1. Fetch via Edge Function
                const res = await invokeBookReader({ action: 'list_exams' });
                let loaded = res?.exams || [];

                // 2. Direct Supabase Fallback if empty
                if (loaded.length === 0) {
                    const { data: directData } = await supabase
                        .from('exams')
                        .select('id, exam_type, date, time_allowed_minutes, total_marks, university_id, courses(code, name), universities(name)')
                        .order('created_at', { ascending: false });

                    if (directData && directData.length > 0) {
                        loaded = directData.map(e => ({
                            ...e,
                            course_name: e.courses?.name || 'General Assessment',
                            course_code: e.courses?.code || 'EXAM',
                            university_name: e.universities?.name || null
                        }));
                    }
                }

                if (isMounted) {
                    setAllExams(loaded);
                    setLoading(false);
                }
            } catch (err) {
                console.error('[ExamPavilion] Failed to fetch master exams:', err);
                if (isMounted) setLoading(false);
            }
        };

        loadExams();
        return () => { isMounted = false; };
    }, []);

    // Group all exams into high-level Subject Hubs
    const subjectHubs = useMemo(() => {
        const map = new Map();

        allExams.forEach(exam => {
            const code = (exam.course_code || exam.courses?.code || 'EXAM').toUpperCase().trim();
            const name = exam.course_name && exam.course_name !== 'General Assessment'
                ? exam.course_name
                : (exam.courses?.name || 'General Assessment');

            if (!map.has(code)) {
                map.set(code, {
                    code,
                    name,
                    icon: COURSE_ICONS[code] || 'fa-book-open',
                    exams: [],
                    myCampusCount: 0,
                    otherCampusCount: 0
                });
            }

            const entry = map.get(code);
            entry.exams.push(exam);

            if (homeUniversityId && exam.university_id === homeUniversityId) {
                entry.myCampusCount++;
            } else {
                entry.otherCampusCount++;
            }
        });

        const list = Array.from(map.values()).sort((a, b) => b.exams.length - a.exams.length);
        return list;
    }, [allExams, homeUniversityId]);

    // Filtered subjects in Lobby
    const filteredSubjectHubs = useMemo(() => {
        if (!subjectSearch.trim()) return subjectHubs;
        const q = subjectSearch.toLowerCase().trim();
        return subjectHubs.filter(s => 
            s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
        );
    }, [subjectHubs, subjectSearch]);

    // Handle opening a Subject Vault
    const handleOpenSubject = (subject) => {
        setSelectedSubject(subject);
        setTermFilter('all');
        // Default to home campus if papers exist, otherwise show other campuses or all
        if (homeUniversityId && subject.myCampusCount > 0) {
            setCampusScope('my_campus');
        } else {
            setCampusScope('all');
        }
    };

    // Filtered exams inside the Course Vault
    const vaultExams = useMemo(() => {
        if (!selectedSubject) return [];

        return selectedSubject.exams.filter(exam => {
            // 1. Campus Scope Filter
            if (campusScope === 'my_campus') {
                if (!homeUniversityId || exam.university_id !== homeUniversityId) return false;
            } else if (campusScope === 'other_campuses') {
                if (homeUniversityId && exam.university_id === homeUniversityId) return false;
            }

            // 2. Term Filter
            const type = (exam.exam_type || exam.type || '').toLowerCase();
            if (termFilter === 'midterm' && !type.includes('mid')) return false;
            if (termFilter === 'final' && !type.includes('final')) return false;

            return true;
        });
    }, [selectedSubject, campusScope, termFilter, homeUniversityId]);

    // Group filtered exams by University (Campus Dossier Architecture)
    const groupedVaultExams = useMemo(() => {
        if (!vaultExams || vaultExams.length === 0) return [];

        const map = new Map();
        vaultExams.forEach(exam => {
            const uniId = exam.university_id || 'unknown';
            const uniName = exam.university_name || 'University Assessment';
            const isHome = homeUniversityId && exam.university_id === homeUniversityId;

            if (!map.has(uniId)) {
                map.set(uniId, {
                    university_id: uniId,
                    university_name: uniName,
                    is_home: isHome,
                    exams: []
                });
            }
            map.get(uniId).exams.push(exam);
        });

        // Sort papers within each university descending by year / date
        map.forEach(group => {
            group.exams.sort((a, b) => {
                const dateA = String(a.date || '').toLowerCase();
                const dateB = String(b.date || '').toLowerCase();
                return dateB.localeCompare(dateA);
            });
        });

        // Sort campuses: Home campus always first, then by number of available papers
        const groups = Array.from(map.values());
        groups.sort((a, b) => {
            if (a.is_home) return -1;
            if (b.is_home) return 1;
            return b.exams.length - a.exams.length || a.university_name.localeCompare(b.university_name);
        });

        return groups;
    }, [vaultExams, homeUniversityId]);

    const toggleUniversity = (uniId) => {
        setExpandedUnis(prev => ({
            ...prev,
            [uniId]: !prev[uniId]
        }));
    };

    const activeSubjectCounts = useMemo(() => {
        if (!selectedSubject) return { total: 0, myCampus: 0, otherCampuses: 0, midterms: 0, finals: 0 };

        const myCampus = selectedSubject.myCampusCount;
        const otherCampuses = selectedSubject.otherCampusCount;
        const total = selectedSubject.exams.length;

        // Current scope exams for term count tabs
        const scopeFiltered = selectedSubject.exams.filter(exam => {
            if (campusScope === 'my_campus') return homeUniversityId && exam.university_id === homeUniversityId;
            if (campusScope === 'other_campuses') return !homeUniversityId || exam.university_id !== homeUniversityId;
            return true;
        });

        const midterms = scopeFiltered.filter(e => (e.exam_type || '').toLowerCase().includes('mid')).length;
        const finals = scopeFiltered.filter(e => (e.exam_type || '').toLowerCase().includes('final')).length;

        return { total, myCampus, otherCampuses, midterms, finals, currentScopeTotal: scopeFiltered.length };
    }, [selectedSubject, campusScope, homeUniversityId]);

    return (
        <div className="pavilion-overlay">
            {/* VIEW 1: THE SUBJECT HUB LOBBY (ZERO DROPDOWNS) */}
            {!selectedSubject ? (
                <div className="pav-lobby-view">
                    <header className="pav-header">
                        <div className="pav-header-left">
                            <button className="icon-button pav-back-btn" onClick={onClose} title="Back to Study Hub">
                                <i className="fas fa-chevron-left"></i>
                            </button>
                            <div>
                                <h1 className="pav-main-title">Exam Pavilion</h1>
                                <p className="pav-main-sub">
                                    {homeUniversity 
                                        ? `⭐ ${homeUniversity.name.split(' ')[0]} Campus Archive` 
                                        : 'Verified University Archives'}
                                </p>
                            </div>
                        </div>

                        {homeUniversity && (
                            <div className="pav-home-badge" title={homeUniversity.name}>
                                <i className="fas fa-star"></i>
                                <span>{homeUniversity.name.split(' ')[0]}</span>
                            </div>
                        )}
                    </header>

                    {/* Quick Search */}
                    <div className="pav-search-container">
                        <div className="pav-search-input-box">
                            <i className="fas fa-search"></i>
                            <input 
                                type="text"
                                placeholder="Search course by name or code..."
                                value={subjectSearch}
                                onChange={e => setSubjectSearch(e.target.value)}
                            />
                            {subjectSearch && (
                                <button className="pav-clear-search-btn" onClick={() => setSubjectSearch('')}>
                                    <i className="fas fa-times"></i>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Subject Grid */}
                    <main className="pav-lobby-body">
                        {loading ? (
                            <div className="pav-loading-state">
                                <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                                <p>Cataloging University Archives...</p>
                            </div>
                        ) : filteredSubjectHubs.length === 0 ? (
                            <div className="pav-empty-state">
                                <i className="fas fa-book-open"></i>
                                <h3>No Courses Found</h3>
                                <p>No examination papers matched &ldquo;{subjectSearch}&rdquo;.</p>
                            </div>
                        ) : (
                            <div className="pav-subject-grid">
                                {filteredSubjectHubs.map(hub => (
                                    <div 
                                        key={hub.code} 
                                        className="pav-subject-card"
                                        onClick={() => handleOpenSubject(hub)}
                                    >
                                        <div className="psc-top-row">
                                            <div className="psc-icon-box">
                                                <i className={`fa-solid ${hub.icon}`}></i>
                                            </div>
                                            <span className="psc-code-tag">{hub.code}</span>
                                        </div>

                                        <h3 className="psc-name">{hub.name}</h3>

                                        <div className="psc-footer">
                                            <span className="psc-count">
                                                {hub.exams.length} {hub.exams.length === 1 ? 'Paper' : 'Papers'}
                                            </span>

                                            {hub.myCampusCount > 0 ? (
                                                <span className="psc-campus-pill">
                                                    ⭐ {hub.myCampusCount} from your campus
                                                </span>
                                            ) : (
                                                <span className="psc-arrow">
                                                    <i className="fas fa-arrow-right"></i>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </main>
                </div>
            ) : (
                /* VIEW 2: COURSE VAULT (NO INFINITE SCROLL) */
                <div className="pav-vault-view">
                    <header className="pav-vault-header">
                        <button className="icon-button pav-back-btn" onClick={() => setSelectedSubject(null)} title="Back to Courses">
                            <i className="fas fa-chevron-left"></i>
                        </button>
                        <div className="pav-vault-title-group">
                            <h2>{selectedSubject.name}</h2>
                            <span className="pvt-code">{selectedSubject.code}</span>
                        </div>
                    </header>

                    {/* Scope Selector: My Campus vs Other Campuses */}
                    <div className="pav-vault-toolbar">
                        <div className="pav-scope-pills">
                            {homeUniversity && activeSubjectCounts.myCampus > 0 && (
                                <button 
                                    className={`pav-scope-btn ${campusScope === 'my_campus' ? 'active' : ''}`}
                                    onClick={() => setCampusScope('my_campus')}
                                >
                                    <i className="fas fa-star"></i>
                                    <span>My Campus ({activeSubjectCounts.myCampus})</span>
                                </button>
                            )}
                            <button 
                                className={`pav-scope-btn ${campusScope === 'other_campuses' ? 'active' : ''}`}
                                onClick={() => setCampusScope('other_campuses')}
                            >
                                <i className="fas fa-globe"></i>
                                <span>Other Campuses ({activeSubjectCounts.otherCampuses})</span>
                            </button>
                            <button 
                                className={`pav-scope-btn ${campusScope === 'all' ? 'active' : ''}`}
                                onClick={() => setCampusScope('all')}
                            >
                                <span>All ({activeSubjectCounts.total})</span>
                            </button>
                        </div>

                        {/* Term Filter Pills */}
                        <div className="pav-term-tabs">
                            <button 
                                className={`pav-term-tab ${termFilter === 'all' ? 'active' : ''}`}
                                onClick={() => setTermFilter('all')}
                            >
                                All ({activeSubjectCounts.currentScopeTotal})
                            </button>
                            <button 
                                className={`pav-term-tab ${termFilter === 'midterm' ? 'active' : ''}`}
                                onClick={() => setTermFilter('midterm')}
                            >
                                Midterms ({activeSubjectCounts.midterms})
                            </button>
                            <button 
                                className={`pav-term-tab ${termFilter === 'final' ? 'active' : ''}`}
                                onClick={() => setTermFilter('final')}
                            >
                                Finals ({activeSubjectCounts.finals})
                            </button>
                        </div>
                    </div>

                    {/* Campus Dossier / Accordion Hub */}
                    <main className="pav-vault-body">
                        {groupedVaultExams.length === 0 ? (
                            <div className="pav-empty-state">
                                <i className="fas fa-folder-open"></i>
                                <h3>No Exams in this Category</h3>
                                <p>
                                    {campusScope === 'my_campus' 
                                        ? `No papers available specifically from ${homeUniversity?.name}. Try exploring other universities!` 
                                        : 'Try switching the term or campus filter.'}
                                </p>
                                {campusScope === 'my_campus' && (
                                    <button 
                                        className="pav-switch-scope-btn"
                                        onClick={() => setCampusScope('other_campuses')}
                                    >
                                        <i className="fas fa-globe"></i> View Other Campuses
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="pav-campus-dossier-list">
                                {groupedVaultExams.map(group => {
                                    const isExpanded = expandedUnis[group.university_id] ?? (group.is_home || groupedVaultExams.length <= 2);
                                    const uniIcon = group.is_home ? 'fa-star' : (universityIconMap[group.university_name] || 'fa-landmark');

                                    return (
                                        <div 
                                            key={group.university_id} 
                                            className={`pav-campus-folder ${group.is_home ? 'is-home-folder' : ''} ${isExpanded ? 'expanded' : ''}`}
                                        >
                                            <div 
                                                className="pcf-header"
                                                onClick={() => toggleUniversity(group.university_id)}
                                            >
                                                <div className="pcf-header-left">
                                                    <div className={`pcf-icon-box ${group.is_home ? 'gold' : ''}`}>
                                                        <i className={`fa-solid ${uniIcon}`}></i>
                                                    </div>
                                                    <div className="pcf-title-col">
                                                        <div className="pcf-uni-name-row">
                                                            <h4 className="pcf-uni-name">{group.university_name}</h4>
                                                            {group.is_home && <span className="pcf-home-pill">Your Campus</span>}
                                                        </div>
                                                        <span className="pcf-paper-count">
                                                            {group.exams.length} {group.exams.length === 1 ? 'Exam Paper' : 'Exam Papers'}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="pcf-header-right">
                                                    <span className="pcf-chevron">
                                                        <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                                                    </span>
                                                </div>
                                            </div>

                                            {isExpanded && (
                                                <div className="pcf-paper-rows">
                                                    {group.exams.map(exam => {
                                                        const displayDate = exam.date || 'Past Paper';
                                                        const isFinal = (exam.exam_type || '').toLowerCase().includes('final');
                                                        const displayType = isFinal ? 'FINAL' : 'MIDTERM';
                                                        const displayTime = exam.time_allowed_minutes ? `${exam.time_allowed_minutes}m` : '60m';
                                                        const displayMarks = exam.total_marks ? `${exam.total_marks} Marks` : '50 Marks';

                                                        return (
                                                            <div 
                                                                key={exam.id} 
                                                                className="pcf-paper-row"
                                                                onClick={() => setActiveSession(exam)}
                                                            >
                                                                <div className="ppr-left">
                                                                    <span className={`ppr-term-badge ${isFinal ? 'final' : 'midterm'}`}>
                                                                        {displayType}
                                                                    </span>
                                                                    <span className="ppr-date">{displayDate}</span>
                                                                </div>

                                                                <div className="ppr-meta">
                                                                    <span className="ppr-meta-item">
                                                                        <i className="far fa-clock"></i> {displayTime}
                                                                    </span>
                                                                    <span className="ppr-meta-item">
                                                                        <i className="far fa-file-alt"></i> {displayMarks}
                                                                    </span>
                                                                </div>

                                                                <button className="ppr-practice-btn">
                                                                    <i className="fas fa-bolt"></i> Practice
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </main>
                </div>
            )}

            {activeSession && (
                <ExamSession 
                    exam={activeSession} 
                    onClose={() => setActiveSession(null)} 
                />
            )}
        </div>
    );
};

export default ExamPavilion;