import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from './api.js';
import BookReader from './BookReader/BookReader.jsx';
import ReportModal from './components/ReportModal.jsx';
import ExamQuestionCard from './components/ExamQuestionCard.jsx';
import { usePlatform, logQuestionAttempt, logBatchQuestionAttempts, evaluateQuestionAnswer, telemetry } from '@linkup-platform/sdk-core';
import './ExamSession.css';

const typeOrder = {
    'true_false': 1,
    'matching': 2,
    'reading_comprehension': 3,
    'multiple_choice': 4,
    'fill_in_the_blank': 5,
    'short_answer': 6,
    'workout': 7
};

const typeTitles = {
    'true_false': 'Part: True or False',
    'matching': 'Part: Matching',
    'reading_comprehension': 'Part: Reading Comprehension',
    'multiple_choice': 'Part: Multiple Choice',
    'fill_in_the_blank': 'Part: Fill in the Blanks',
    'short_answer': 'Part: Short Answer',
    'workout': 'Part: Workout'
};

const typeInstructions = {
    'true_false': 'Read each statement carefully and decide whether it is True or False.',
    'matching': 'Match the items in Column A with the correct items in Column B.',
    'reading_comprehension': 'Read the passage and answer the questions that follow.',
    'multiple_choice': 'Choose the best answer from the given alternatives.',
    'fill_in_the_blank': 'Fill in the blank spaces with the appropriate word or phrase.',
    'short_answer': 'Provide a concise and accurate answer for each question.',
    'workout': 'Show all necessary steps and clearly state your final answer.'
};

const getNormalizedType = (q) => {
    let type = (q.question_type || '').toLowerCase();
    const isMatching = type === 'matching' || q.matching_data || (Array.isArray(q.options) && q.options.some(o => typeof o === 'string' && o.includes('Column A')));
    if (isMatching) return 'matching';
    if (!type) return 'multiple_choice'; 
    return type;
};

const ExamSession = ({ exam, onClose }) => {
    const { sessionUser, user: userProfile, t } = usePlatform();
    const isProUser = Boolean(userProfile?.is_pro);
    const currentUser = sessionUser;
    const loggedQsRef = useRef(new Set());
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
        telemetry.switchFeature('exam');
        return () => telemetry.restorePreviousFeature();
    }, []);

    useEffect(() => {
        if (exam?.is_pro_gated && !isProUser) {
            window.dispatchEvent(new CustomEvent('open-premium-modal'));
            onClose();
            return;
        }

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
                let allQs = data.sections.flatMap(s => s.questions || []);
                let grouped = {};
                allQs.forEach(q => {
                    const nType = getNormalizedType(q);
                    if (!grouped[nType]) grouped[nType] = [];
                    grouped[nType].push(q);
                });

                const sortedKeys = Object.keys(grouped).sort((a, b) => (typeOrder[a] || 99) - (typeOrder[b] || 99));
                
                const virtualSections = sortedKeys.map((typeKey) => ({
                    id: `virtual-sec-${typeKey}`,
                    title: typeTitles[typeKey] || `Part: ${typeKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
                    instructions: typeInstructions[typeKey] || '',
                    questions: grouped[typeKey]
                }));

                setSections(virtualSections);
                setExamMeta({ name: data.course_name, code: data.course_code });
            }
            setLoading(false);
        })
        .catch(err => console.error("[SESSION_ERROR]", err));
    }, [exam.id]);

    useEffect(() => {
        if (showModeModal || showResultsModal || loading) return;
        const timer = setInterval(() => {
            setTimeLeft(prev => prev > 0 ? prev - 1 : 0);
        }, 1000);
        return () => clearInterval(timer);
    }, [showModeModal, showResultsModal, loading]);

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleSelect = (qId, opt) => {
        setAnswers(prev => ({ ...prev, [qId]: opt }));
    };

    const logQuestion = async (q, ans) => {
        if (!q || !currentUser || loggedQsRef.current.has(q.id)) return;
        loggedQsRef.current.add(q.id);

        const res = await logQuestionAttempt({
            userId: currentUser.id,
            questionId: q.id,
            courseCode: examMeta.code,
            topicTag: q.topic_tag || q.question_type || 'Exam Topic',
            sourceType: 'exam',
            sourceId: exam.id,
            userAnswer: ans
        });

        if (res?.explanation && !q.explanation) {
            q.explanation = res.explanation;
        }
    };

    const handleEvaluate = (qId) => {
        setEvaluatedQs(prev => ({ ...prev, [qId]: true }));
        const q = allQuestions.find(x => x.id === qId);
        if (q) logQuestion(q, answers[qId]);
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

    const isQuestionWrong = (qId) => {
        if (!evaluatedQs[qId] && !showResultsModal) return false;
        const q = allQuestions.find(x => x.id === qId);
        if (!q || answers[qId] === undefined) return false;
        return !evaluateQuestionAnswer(q, answers[qId]).isCorrect;
    };

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
            if (answers[q.id] !== undefined && evaluateQuestionAnswer(q, answers[q.id]).isCorrect) {
                correctCount++;
            }
        });
        return Math.round((correctCount / totalCount) * 100);
    };

    const finishExam = () => {
        const unloggedAttempts = [];
        allQuestions.forEach(q => {
            if (!evaluatedQs[q.id] && answers[q.id] !== undefined && currentUser && !loggedQsRef.current.has(q.id)) {
                loggedQsRef.current.add(q.id);
                unloggedAttempts.push({
                    questionId: q.id,
                    userAnswer: answers[q.id],
                    courseCode: examMeta.code,
                    topicTag: q.topic_tag || q.question_type || 'Exam Topic',
                    sourceType: 'exam',
                    sourceId: exam.id
                });
            }
        });

        if (unloggedAttempts.length > 0) {
            logBatchQuestionAttempts(unloggedAttempts);
        }
        setShowResultsModal(true);
    };

    return (
        <div className="exam-session-overlay">
            {showModeModal && (
                <div className="exam-mode-modal-overlay">
                    <div className="exam-mode-card">
                        <h2>{t('exam_mode_prompt_title', 'How do you want to practice?')}</h2>
                        <p>{t('exam_mode_prompt_subtitle', 'You can adjust this preference later in your settings.')}</p>
                        <div className="mode-options">
                            <div className="mode-card" onClick={() => selectMode('on_the_go')}>
                                <i className="fas fa-bolt"></i>
                                <h3>{t('exam_mode_instant_title', 'Grade as I go')}</h3>
                                <p>{t('exam_mode_instant_desc', 'Immediate feedback after every question.')}</p>
                            </div>
                            <div className="mode-card" onClick={() => selectMode('at_end')}>
                                <i className="fas fa-flag-checkered"></i>
                                <h3>{t('exam_mode_end_title', 'Grade at the end')}</h3>
                                <p>{t('exam_mode_end_desc', 'Simulate a real exam environment.')}</p>
                            </div>
                        </div>
                        <label className="dont-show-again">
                            <input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)} /> {t('exam_mode_dont_show', "Don't show this again")}
                        </label>
                    </div>
                </div>
            )}

            {showResultsModal && (
                <div className="exam-results-overlay">
                    <div className="exam-results-card">
                        <h2>{t('exam_completed_title', 'Exam Completed!')}</h2>
                        <div className="score-circle">
                            {calculateScore()}%
                        </div>
                        <p>{t('exam_time_left', 'Time Remaining: {time}').replace('{time}', formatTime(timeLeft))}</p>
                        <button className="results-close-btn" onClick={onClose}>{t('exam_return_btn', 'Return to Pavilion')}</button>
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
                        className={`nav-dot ${activeQuestionId === q.id ? 'active-focus' : ''} ${answers[q.id] && !isQuestionWrong(q.id) ? 'answered' : ''} ${isQuestionWrong(q.id) ? 'wrong-answer' : ''} ${flagged[q.id] ? 'flagged' : ''}`}
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
                        {section.questions.map((q) => {
                            const globalIdx = allQuestions.findIndex(x => x.id === q.id);
                            return (
                            <ExamQuestionCard
                                key={q.id}
                                q={q}
                                idx={globalIdx !== -1 ? globalIdx : 0}
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
                            );
                        })}
                    </div>
                ))}
            </main>

            <footer className="session-footer">
                <div className="session-progress-block">
                    <div className="p-text">
                        <span>{Object.keys(answers).length} / {totalCount} {t('common_completed', 'Answered')}</span>
                        <span>{Math.round(progress)}% {t('common_completed', 'Complete')}</span>
                    </div>
                    <div className="p-track">
                        <div className="p-bar-fill" style={{ width: `${progress}%` }}></div>
                        <div className="p-bar-flagged" style={{ width: `${flaggedProgress}%`, left: `${progress}%` }}></div>
                    </div>
                </div>
                <button className="finish-exam-btn" onClick={finishExam}>{t('exam_finish_btn', 'Finish Exam')}</button>
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