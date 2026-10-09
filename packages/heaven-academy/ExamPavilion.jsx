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

                    {/* Finite Exam Cards List */}
                    <main className="pav-vault-body">
                        {vaultExams.length === 0 ? (
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
                            <div className="pav-vault-list">
                                {vaultExams.map(exam => {
                                    const displayDate = exam.date || 'Past Paper';
                                    const displayType = (exam.exam_type || 'Exam').toUpperCase();
                                    const displayTime = exam.time_allowed_minutes ? `${exam.time_allowed_minutes}m` : '60m';
                                    const displayMarks = exam.total_marks ? `${exam.total_marks} Marks` : '50 Marks';
                                    const uniName = exam.university_name || 'University Assessment';
                                    const isHomePaper = homeUniversityId && exam.university_id === homeUniversityId;

                                    return (
                                        <div 
                                            key={exam.id}
                                            className={`pav-exam-card ${isHomePaper ? 'home-paper' : ''}`}
                                            onClick={() => setActiveSession(exam)}
                                        >
                                            <div className="pec-header">
                                                <span className={`pec-uni-badge ${isHomePaper ? 'gold' : ''}`}>
                                                    <i className={`fa-solid ${isHomePaper ? 'fa-star' : (universityIconMap[uniName] || 'fa-landmark')}`}></i>
                                                    {uniName}
                                                </span>
                                                <span className="pec-date">{displayDate}</span>
                                            </div>

                                            <h3 className="pec-title">
                                                {displayType} Examination
                                            </h3>

                                            <div className="pec-footer">
                                                <div className="pec-meta-item">
                                                    <i className="far fa-clock"></i> {displayTime}
                                                </div>
                                                <div className="pec-meta-item">
                                                    <i className="far fa-file-alt"></i> {displayMarks}
                                                </div>
                                                <button className="pec-practice-btn">
                                                    <i className="fas fa-bolt"></i> Practice
                                                </button>
                                            </div>
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