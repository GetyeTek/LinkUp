import React from 'react';
import { marked } from 'https://esm.sh/marked';
import DOMPurify from 'dompurify';
import { renderBookBlock } from '../BookReader/subjects/Registry.jsx';
import './ExamQuestionCard.css';

const getNormalizedMatchingData = (q) => {
    if (q.matching_data && q.matching_data.left_column && q.matching_data.left_column.length > 0) return q.matching_data;
    let opts = q.options;
    if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch(e) {} }
    if (opts && Array.isArray(opts) && opts.length > 0) {
        const getStr = (arr, prefix) => {
            const found = arr.find(o => {
                const text = typeof o === 'string' ? o : (o?.text || '');
                return typeof text === 'string' && text.includes(prefix);
            });
            return typeof found === 'string' ? found : found?.text;
        };
        const leftStr = getStr(opts, 'Column A');
        const rightStr = getStr(opts, 'Column B');
        if (leftStr && rightStr) {
            const parseStr = (str, prefix, splitRegex) => {
                const prefixMatch = new RegExp(`.*${prefix}:?`, 'i');
                const cleaned = str.replace(prefixMatch, '').trim();
                const parts = cleaned.split(splitRegex);
                const items = [];
                for (let i = 1; i < parts.length; i += 2) {
                    let item = (parts[i+1] || '').trim();
                    item = item.replace(/[,;]+$/, '').trim();
                    if (item) items.push(item);
                }
                return items;
            };
            return {
                left_column: parseStr(leftStr, 'Column A', /(\b\d+\.\s*)/),
                right_column: parseStr(rightStr, 'Column B', /(\b[A-Z]\.\s*)/)
            };
        }
    }
    return { left_column: [], right_column: [] };
};

const ExamQuestionCard = ({
    q, idx, answers, handleSelect, flagged, toggleFlag,
    hints, toggleHint, activeMatch, setActiveMatch,
    setReportQuestionId, setActiveReferenceBook,
    gradingMode, evaluatedQs, handleEvaluate, showResults
}) => {
    const isMatching = (q.question_type && q.question_type.toLowerCase() === 'matching') || q.matching_data || (Array.isArray(q.options) && q.options.some(o => typeof o === 'string' && o.includes('Column A')));
    const isFIB = q.question_type?.toLowerCase() === 'fill_in_the_blank';
    const isWorkout = q.question_type?.toLowerCase() === 'workout' || q.question_type?.toLowerCase() === 'short_answer';
    
    const matchData = isMatching ? getNormalizedMatchingData(q) : null;
    const isEvaluated = evaluatedQs[q.id] || showResults;

    const handleLocalSelect = (opt) => {
        if (isEvaluated) return;
        handleSelect(q.id, opt);
        if (gradingMode === 'on_the_go' && (q.question_type === 'multiple_choice' || q.question_type === 'true_false' || q.question_type === 'reading_comprehension')) {
            handleEvaluate(q.id);
        }
    };

    return (
        <section className="q-row" id={`q-box-${q.id}`}>
            <div className="q-meta">
                <span className="q-label">Question {idx + 1}</span>
                <div className="q-actions">
                    <button className="report-btn" onClick={() => setReportQuestionId(q.id)} title="Report an issue">
                        <i className="fas fa-triangle-exclamation"></i>
                    </button>
                    <button className={`hint ${hints[q.id]?.open ? 'active-hint' : ''}`} onClick={() => toggleHint(q.id)}>
                        <i className="fas fa-wand-magic-sparkles"></i>
                    </button>
                    <button className={flagged[q.id] ? 'active' : ''} onClick={() => toggleFlag(q.id)}>
                        <i className={flagged[q.id] ? 'fas fa-flag' : 'far fa-flag'}></i>
                    </button>
                </div>
            </div>
            
            <div className="q-text">{q.text}</div>
            
            {(q.question_type && q.question_type.toLowerCase() === 'true_false') ? (
                <div className="tf-pad-container">
                    {(() => {
                        const boolAns = answers[q.id];
                        const isTrueSelected = boolAns === 'True' || boolAns?.text === 'True';
                        const isFalseSelected = boolAns === 'False' || boolAns?.text === 'False';
                        const correctBool = q.correct_answer;

                        let trueClass = "tf-btn is-true";
                        let falseClass = "tf-btn is-false";

                        if (isEvaluated) {
                            if (correctBool === true) trueClass += " correct-highlight";
                            if (correctBool === false) falseClass += " correct-highlight";
                            if (isTrueSelected && correctBool !== true) trueClass += " wrong-highlight";
                            if (isFalseSelected && correctBool !== false) falseClass += " wrong-highlight";
                        }
                        
                        return (
                            <>
                                <div className="tf-wrapper">
                                    <input type="radio" name={`q-${q.id}`} id={`q-${q.id}-true`} hidden checked={isTrueSelected} onChange={() => handleLocalSelect('True')} disabled={isEvaluated}/>
                                    <label htmlFor={`q-${q.id}-true`} className={trueClass}><i className="fa-solid fa-check"></i><span>TRUE</span></label>
                                </div>
                                <div className="tf-wrapper">
                                    <input type="radio" name={`q-${q.id}`} id={`q-${q.id}-false`} hidden checked={isFalseSelected} onChange={() => handleLocalSelect('False')} disabled={isEvaluated}/>
                                    <label htmlFor={`q-${q.id}-false`} className={falseClass}><i className="fa-solid fa-xmark"></i><span>FALSE</span></label>
                                </div>
                            </>
                        );
                    })()}
                </div>
            ) : isMatching && matchData && matchData.left_column?.length > 0 ? (
                <div className={`interactive-match-container ${(matchData.right_column?.some(r => (r.text || r).length > 45) || matchData.left_column?.some(l => (l.text || l).length > 45)) ? 'vertical-match' : ''}`}>
                    <div className="match-col match-left">
                        {matchData.left_column?.map((item, idx) => {
                            const qAnswers = answers[q.id] || {};
                            const currentActive = activeMatch[q.id];
                            const isPaired = qAnswers[idx] !== undefined;
                            const isActive = currentActive === idx;
                            const isDisabled = currentActive !== undefined && currentActive !== idx;
                            const isCorrectMatch = qAnswers[idx] === (q.correct_answer ? q.correct_answer[idx] : undefined);
                            
                            let leftClass = `match-item-left ${isActive ? 'is-active' : ''} ${isPaired ? 'is-paired' : ''}`;
                            if (isDisabled && !isEvaluated) leftClass += ' is-disabled';
                            if (isEvaluated) leftClass += isCorrectMatch ? ' correct-match' : ' wrong-match';

                            return (
                                <div key={idx} className={leftClass} onClick={() => !isEvaluated && setActiveMatch(prev => ({ ...prev, [q.id]: isActive ? undefined : idx }))}>
                                    <span className="match-index">{idx + 1}.</span>
                                    <span className="match-text">{item.text || item}</span>
                                    {isPaired && <span className="match-badge">{String.fromCharCode(65 + qAnswers[idx])}</span>}
                                </div>
                            );
                        })}
                    </div>
                    <div className={`match-col match-right ${activeMatch[q.id] !== undefined && !isEvaluated ? 'is-listening' : ''}`}>
                        {matchData.right_column?.map((item, idx) => {
                            const qAnswers = answers[q.id] || {};
                            const currentActive = activeMatch[q.id];
                            const usedByLeftIdx = Object.keys(qAnswers).find(k => qAnswers[k] === idx);
                            const isUsed = usedByLeftIdx !== undefined;

                            return (
                                <div key={idx} className={`match-item-right ${isUsed ? 'is-used' : ''}`} onClick={() => {
                                    if (currentActive !== undefined && !isEvaluated) {
                                        const newAnswers = { ...qAnswers };
                                        if (isUsed) delete newAnswers[usedByLeftIdx];
                                        newAnswers[currentActive] = idx;
                                        handleLocalSelect(newAnswers);
                                        setActiveMatch(prev => ({ ...prev, [q.id]: undefined }));
                                    }
                                }}>
                                    <span className="match-letter">{String.fromCharCode(65 + idx)}.</span>
                                    <span className="match-text">{item.text || item}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : isFIB ? (
                <div className="fib-container">
                    {Array.from({length: Array.isArray(q.correct_answer) ? q.correct_answer.length : 1}).map((_, i) => {
                        const val = answers[q.id]?.[i] || '';
                        let inputClass = "fib-input";
                        if (isEvaluated) {
                            const isCorrect = val.toLowerCase().trim() === (q.correct_answer?.[i] || '').toLowerCase().trim();
                            inputClass += isCorrect ? " correct" : " wrong";
                        }
                        return (
                            <input 
                                key={i} type="text" placeholder={`Blank ${i+1}`} value={val} disabled={isEvaluated} className={inputClass}
                                onChange={(e) => {
                                    const newAns = [...(answers[q.id] || [])];
                                    newAns[i] = e.target.value;
                                    handleLocalSelect(newAns);
                                }}
                            />
                        );
                    })}
                </div>
            ) : isWorkout ? (
                <textarea 
                    className="workout-textarea" 
                    placeholder="Show your work or write your answer here..."
                    value={answers[q.id] || ''}
                    onChange={e => handleLocalSelect(e.target.value)}
                    disabled={isEvaluated}
                />
            ) : (
                <div className={`options-cluster ${q.options?.some(o => (o.text || o).length > 45) ? 'vertical-layout' : ''}`}>
                    {q.options?.map((opt, idx) => {
                        const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer;
                        const isThisOptionCorrect = isEvaluated && idx === correctIdx;
                        const isThisOptionSelected = answers[q.id] === opt || answers[q.id]?.text === (opt.text || opt);
                        const isThisOptionWrong = isEvaluated && isThisOptionSelected && !isThisOptionCorrect;

                        let optClass = "opt-btn";
                        if (isThisOptionCorrect) optClass += " correct-highlight";
                        else if (isThisOptionWrong) optClass += " wrong-highlight";

                        return (
                            <div className="opt-wrapper" key={idx}>
                                <input 
                                    type="radio" name={`q-${q.id}`} id={`q-${q.id}-${idx}`} hidden 
                                    checked={isThisOptionSelected} onChange={() => handleLocalSelect(opt)} disabled={isEvaluated}
                                />
                                <label htmlFor={`q-${q.id}-${idx}`} className={optClass}>
                                    <div className="opt-indicator"></div>
                                    <span>{opt.text || opt}</span>
                                </label>
                            </div>
                        );
                    })}
                </div>
            )}

            {gradingMode === 'on_the_go' && !isEvaluated && (isMatching || isFIB || isWorkout) && (
                <button className="check-answer-btn" onClick={() => handleEvaluate(q.id)}><i className="fas fa-check-circle"></i> Check Answer</button>
            )}

            {isEvaluated && q.explanation && (
                <div className="ai-explanation-box" style={{marginTop: '15px'}}>
                    <div className="ai-exp-header"><i className="fas fa-sparkles"></i> Miron Synthesis</div>
                    <div className="ai-exp-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(q.explanation)) }} />
                </div>
            )}

            {hints[q.id]?.open && (
                <div className="rag-insight-container">
                    {hints[q.id].loading ? (
                        <div className="hint-loader"><i className="fas fa-circle-notch fa-spin"></i> Locating document source...</div>
                    ) : hints[q.id].data?.found ? (
                        <>
                            <div className="document-snapshot">
                                <div className="snapshot-topbar">
                                    <span><i className="fas fa-file-pdf"></i> {hints[q.id].data.book_title}</span>
                                    <span>Page {hints[q.id].data.page_number}</span>
                                </div>
                                <div className="snapshot-content">
                                    {hints[q.id].data.block ? renderBookBlock(hints[q.id].data.block, 0, {}) : <p>{hints[q.id].data.snippet}</p>}
                                </div>
                            </div>
                            <div className="insight-actions">
                                <button className="btn-insight-close" onClick={() => toggleHint(q.id)}>Close</button>
                                <button className="btn-insight-book" onClick={() => setActiveReferenceBook(hints[q.id].data)}>
                                    Show in Book <i className="fas fa-external-link-alt" style={{marginLeft: '4px'}}></i>
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="exp-not-found"><i className="fas fa-link-slash"></i> No direct textbook source mapped for this question.</div>
                    )}
                </div>
            )}
        </section>
    );
};

export default ExamQuestionCard;