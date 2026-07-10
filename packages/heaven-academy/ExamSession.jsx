import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from './api.js';
import BookReader from './BookReader/BookReader.jsx';
import ReportModal from './components/ReportModal.jsx';
import ExamQuestionCard from './components/ExamQuestionCard.jsx';
import './ExamSession.css';

const ExamSession = ({ exam, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(exam.time_allowed_minutes * 60 || 3600);
    const [activeReferenceBook, setActiveReferenceBook] = useState(null);
    const [answers, setAnswers] = useState({});
    const [flagged, setFlagged] = useState({});
    const [sections, setSections] = useState([]);
    const [hints, setHints] = useState({});
    const [activeMatch, setActiveMatch] = useState({});
    const [loading, setLoading] = useState(true);
    const [reportQuestionId, setReportQuestionId] = useState(null);

    const [examMeta, setExamMeta] = useState({ name: exam.course_name, code: exam.course_code });
    const [activeQuestionId, setActiveQuestionId] = useState(null);
    const navStripRef = useRef(null);

    // Grading System States
    const [gradingMode, setGradingMode] = useState(null); // 'on_the_go' or 'at_end'
    const [showModeModal, setShowModeModal] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const [evaluatedQs, setEvaluatedQs] = useState({});
    const [showResultsModal, setShowResultsModal] = useState(false);

    useEffect(() => {
        const savedMode = localStorage.getItem('linkup_exam_grading_mode');
        if (savedMode) {
            setGradingMode(savedMode);
        } else {
            setShowModeModal(true);
        }

        console.log("[SESSION] Fetching real questions from DB...");
        invokeBookReader({ action: 'get_exam_questions', exam_id: exam.id })
        .then(data => {
            if (data.sections) {
                setSections(data.sections);
                setExamMeta({ name: data.course_name, code: data.course_code });
            }
            setLoading(false);
        })
        .catch(err => console.error("[SESSION_ERROR]", err));
    }, [exam.id]);

    useEffect(() => {
        if (showModeModal || showResultsModal) return;
        const timer = setInterval(() => {
            setTimeLeft(prev => prev > 0 ? prev - 1 : 0);
        }, 1000);
        return () => clearInterval(timer);
    }, [showModeModal, showResultsModal]);

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleSelect = (qId, opt) => {
        setAnswers(prev => ({ ...prev, [qId]: opt }));
    };

    const handleEvaluate = (qId) => {
        setEvaluatedQs(prev => ({ ...prev, [qId]: true }));
    };

    const toggleFlag = (qId) => setFlagged(prev => ({ ...prev, [qId]: !prev[qId] }));

    const scrollToQuestion = (id) => {
        const el = document.getElementById(`q-box-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    useEffect(() => {
        if (loading || sections.length === 0) return;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const qId = entry.target.id.replace('q-box-', '');
                    setActiveQuestionId(qId);
                    if (navStripRef.current) {
                        const activeDot = navStripRef.current.querySelector(`[data-nav-id="${qId}"]`);
                        if (activeDot) activeDot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                }
            });
        }, { threshold: 0.5, rootMargin: "-10% 0px -40% 0px" });

        document.querySelectorAll('.q-row').forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, [loading, sections]);

    const toggleHint = async (qId) => {
        setHints(prev => {
            const current = prev[qId];
            if (current?.data || current?.loading) return { ...prev, [qId]: { ...current, open: !current.open } };
            return { ...prev, [qId]: { loading: true, open: true, data: null } };
        });

        if (!hints[qId]?.data && !hints[qId]?.loading) {
            try {
                const res = await invokeBookReader({ action: 'get_question_hint', question_id: qId });
                setHints(prev => ({ ...prev, [qId]: { loading: false, open: prev[qId].open, data: res } }));
            } catch (err) {
                setHints(prev => ({ ...prev, [qId]: { loading: false, open: prev[qId].open, data: { found: false } } }));
            }
        }
    };

    const allQuestions = sections.flatMap(s => s.questions);
    const totalCount = allQuestions.length || 1;
    const progress = (Object.keys(answers).length / totalCount) * 100;
    const flaggedCount = Object.values(flagged).filter(Boolean).length;
    const flaggedProgress = (flaggedCount / totalCount) * 100;

    const selectMode = (mode) => {
        if (dontShowAgain) localStorage.setItem('linkup_exam_grading_mode', mode);
        setGradingMode(mode);
        setShowModeModal(false);
    };

    // Calculate Results
    const calculateScore = () => {
        let correctCount = 0;
        allQuestions.forEach(q => {
            const ans = answers[q.id];
            const qType = (q.question_type || '').toLowerCase();
            let isCorrect = false;

            if (qType === 'true_false') {
                const boolAns = ans === 'True' || ans?.text === 'True';
                isCorrect = boolAns === q.correct_answer;
            } else if (qType === 'multiple_choice' || qType === 'reading_comprehension') {
                let selectedIdx = -1;
                q.options?.forEach((opt, idx) => {
                    if ((opt.text || opt) === (ans?.text || ans)) selectedIdx = idx;
                });
                const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer;
                isCorrect = selectedIdx === correctIdx;
            } else if (qType === 'matching') {
                if (q.correct_answer && typeof q.correct_answer === 'object') {
                    const keys = Object.keys(q.correct_answer);
                    if (keys.length > 0 && ans) {
                        isCorrect = true;
                        for (let k of keys) {
                            if (ans[k] !== q.correct_answer[k]) isCorrect = false;
                        }
                    }
                }
            } else if (qType === 'fill_in_the_blank') {
                if (Array.isArray(q.correct_answer) && ans) {
                    isCorrect = true;
                    for (let i = 0; i < q.correct_answer.length; i++) {
                        if ((ans[i] || '').toLowerCase().trim() !== (q.correct_answer[i] || '').toLowerCase().trim()) isCorrect = false;
                    }
                }
            }
            if (isCorrect) correctCount++;
        });
        return Math.round((correctCount / totalCount) * 100);
    };

    const finishExam = () => {
        setShowResultsModal(true);
    };

    return (
        <div className="exam-session-overlay">
            {showModeModal && (
                <div className="exam-mode-modal-overlay">
                    <div className="exam-mode-card">
                        <h2>How do you want to practice?</h2>
                        <p>You can adjust this preference later in your settings.</p>
                        <div className="mode-options">
                            <div className="mode-card" onClick={() => selectMode('on_the_go')}>
                                <i className="fas fa-bolt"></i>
                                <h3>Grade as I go</h3>
                                <p>Immediate feedback after every question.</p>
                            </div>
                            <div className="mode-card" onClick={() => selectMode('at_end')}>
                                <i className="fas fa-flag-checkered"></i>
                                <h3>Grade at the end</h3>
                                <p>Simulate a real exam environment.</p>
                            </div>
                        </div>
                        <label className="dont-show-again">
                            <input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)} /> Don't show this again
                        </label>
                    </div>
                </div>
            )}

            {showResultsModal && (
                <div className="exam-results-overlay">
                    <div className="exam-results-card">
                        <h2>Exam Completed!</h2>
                        <div className="score-circle">
                            {calculateScore()}%
                        </div>
                        <p>Time Remaining: {formatTime(timeLeft)}</p>
                        <button className="results-close-btn" onClick={onClose}>Return to Pavilion</button>
                    </div>
                </div>
            )}

            <header className="session-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button className="icon-button exit-session-btn" onClick={onClose} title="Exit Exam" style={{ opacity: 1 }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="session-title-box">
                        <p>{examMeta.code}</p>
                        <h1>{examMeta.name}</h1>
                    </div>
                </div>
                <div className="session-header-actions">
                    <div className={`timer-pill ${timeLeft < 300 ? 'urgent' : ''}`}>
                        {formatTime(timeLeft)}
                    </div>
                </div>
            </header>

            <nav className="question-nav-strip" ref={navStripRef}>
                {allQuestions.map((q, i) => (
                    <div 
                        key={q.id} 
                        data-nav-id={q.id}
                        onClick={() => scrollToQuestion(q.id)}
                        className={`nav-dot ${activeQuestionId === q.id ? 'active-focus' : ''} ${answers[q.id] ? 'answered' : ''} ${flagged[q.id] ? 'flagged' : ''}`}
                    >
                        {i + 1}
                    </div>
                ))}
            </nav>

            <main className="exam-viewport">
                {loading ? (
                    <div style={{padding: '2rem', textAlign: 'center'}}>Assembling Exam Papers...</div>
                ) : sections.map((section) => (
                    <div key={section.id} className="section-wrap">
                        <div className="section-header-display" style={{padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '1rem'}}>
                            <h3 style={{color: 'var(--accent-teal)'}}>{section.title}</h3>
                            <p style={{fontSize: '0.8rem', opacity: 0.6}}>{section.instructions}</p>
                        </div>
                        {section.questions.map((q, idx) => (
                            <ExamQuestionCard
                                key={q.id}
                                q={q}
                                idx={idx}
                                answers={answers}
                                handleSelect={handleSelect}
                                flagged={flagged}
                                toggleFlag={toggleFlag}
                                hints={hints}
                                toggleHint={toggleHint}
                                activeMatch={activeMatch}
                                setActiveMatch={setActiveMatch}
                                setReportQuestionId={setReportQuestionId}
                                setActiveReferenceBook={setActiveReferenceBook}
                                gradingMode={gradingMode}
                                evaluatedQs={evaluatedQs}
                                handleEvaluate={handleEvaluate}
                                showResults={showResultsModal}
                            />
                        ))}
                    </div>
                ))}
            </main>

            <footer className="session-footer">
                <div className="session-progress-block">
                    <div className="p-text">
                        <span>{Object.keys(answers).length} / {totalCount} Answered</span>
                        <span>{Math.round(progress)}% Complete</span>
                    </div>
                    <div className="p-track">
                        <div className="p-bar-fill" style={{ width: `${progress}%` }}></div>
                        <div className="p-bar-flagged" style={{ width: `${flaggedProgress}%`, left: `${progress}%` }}></div>
                    </div>
                </div>
                <button className="finish-exam-btn" onClick={finishExam}>Finish Exam</button>
            </footer>
            
            {activeReferenceBook && (
                <BookReader 
                    book={{ id: activeReferenceBook.book_id, title: activeReferenceBook.book_title }} 
                    onClose={() => setActiveReferenceBook(null)}
                    targetPageNumber={activeReferenceBook.page_number}
                    targetBlockIndex={activeReferenceBook.content_index}
                    zIndexOverride={3500}
                />
            )}

            {reportQuestionId && (
                <ReportModal 
                    questionId={reportQuestionId} 
                    source="exam" 
                    onClose={() => setReportQuestionId(null)} 
                />
            )}
        </div>
    );
};

export default ExamSession;