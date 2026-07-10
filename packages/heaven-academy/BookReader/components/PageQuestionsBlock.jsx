import React, { useState } from 'react';
import './PageQuestionsBlock.css';

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

const PageQuestionsBlock = ({ questions, pageNumber, pageKey, onExplain, onReport }) => {
    const [qIndex, setQIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    const [activeMatch, setActiveMatch] = useState({});
    const [gradedQs, setGradedQs] = useState({});
    
    if (!questions || questions.length === 0) return null;
    const q = questions[qIndex];
    const ans = answers[q.id];
    const isGraded = gradedQs[q.id];
    
    const isMatching = (q.question_type && q.question_type.toLowerCase() === 'matching') || q.matching_data || (Array.isArray(q.options) && q.options.some(o => typeof o === 'string' && o.includes('Column A')));
    const isFIB = q.question_type?.toLowerCase() === 'fill_in_the_blank';
    const isWorkout = q.question_type?.toLowerCase() === 'workout' || q.question_type?.toLowerCase() === 'short_answer';

    const matchData = isMatching ? getNormalizedMatchingData(q) : null;

    const checkAnswer = () => {
        setGradedQs(prev => ({...prev, [q.id]: true}));
    };

    const handleLocalSelect = (newAns) => {
        setAnswers({...answers, [q.id]: newAns});
        if (q.question_type === 'multiple_choice' || q.question_type === 'true_false' || q.question_type === 'reading_comprehension') {
            setGradedQs(prev => ({...prev, [q.id]: true}));
        }
    };

    return (
        <div className="bpq-container">
            <div className="bpq-header">
                <div className="bpq-title"><i className="fas fa-clipboard-check"></i> Knowledge Check</div>
                <div className="bpq-counter">{qIndex + 1} of {questions.length}</div>
            </div>
            <div className="bpq-body">
                <div className="bpq-text">{q.text}</div>
                {(q.question_type && q.question_type.toLowerCase() === 'true_false') ? (
                    <div className="bpq-tf-pad">
                        {(() => {
                            const boolAns = ans;
                            const isTrueSelected = boolAns === 'True' || boolAns?.text === 'True';
                            const isFalseSelected = boolAns === 'False' || boolAns?.text === 'False';
                            const correctBool = q.correct_answer;
    
                            let trueClass = "bpq-tf-btn";
                            let falseClass = "bpq-tf-btn";
    
                            if (isGraded) {
                                if (correctBool === true) trueClass += " correct-highlight";
                                if (correctBool === false) falseClass += " correct-highlight";
                                if (isTrueSelected && correctBool !== true) trueClass += " wrong-highlight";
                                if (isFalseSelected && correctBool !== false) falseClass += " wrong-highlight";
                            } else {
                                if (isTrueSelected) trueClass += " active-true";
                                if (isFalseSelected) falseClass += " active-false";
                            }

                            return (
                                <>
                                    <label className={trueClass} style={{ pointerEvents: isGraded ? 'none' : 'auto', opacity: isGraded || isTrueSelected ? 1 : 0.5 }}>
                                        <input type="radio" hidden disabled={isGraded} onChange={() => handleLocalSelect('True')} />
                                        <i className="fa-solid fa-check"></i> TRUE
                                    </label>
                                    <label className={falseClass} style={{ pointerEvents: isGraded ? 'none' : 'auto', opacity: isGraded || isFalseSelected ? 1 : 0.5 }}>
                                        <input type="radio" hidden disabled={isGraded} onChange={() => handleLocalSelect('False')} />
                                        <i className="fa-solid fa-xmark"></i> FALSE
                                    </label>
                                </>
                            );
                        })()}
                    </div>
                ) : (matchData && matchData.left_column?.length > 0) ? (
                    <div className={`interactive-match-container ${(matchData.right_column?.some(r => (r.text || r).length > 45) || matchData.left_column?.some(l => (l.text || l).length > 45)) ? 'vertical-match' : ''}`}>
                        <div className="match-col match-left">
                            {matchData.left_column?.map((item, idx) => {
                                const qAnswers = ans || {};
                                const currentActive = activeMatch[q.id];
                                const isPaired = qAnswers[idx] !== undefined;
                                const isActive = currentActive === idx;
                                const isDisabled = currentActive !== undefined && currentActive !== idx;
                                const isCorrectMatch = qAnswers[idx] === (q.correct_answer ? q.correct_answer[idx] : undefined);

                                const pairGraded = isGraded || isPaired;
                                const correctRightIdx = q.correct_answer ? q.correct_answer[idx] : undefined;

                                let leftClass = `match-item-left ${isActive ? 'is-active' : ''} ${isPaired ? 'is-paired' : ''}`;
                                if (isDisabled && !pairGraded) leftClass += ' is-disabled';
                                if (pairGraded) leftClass += isCorrectMatch ? ' correct-match' : ' wrong-match';

                                return (
                                    <div key={idx} className={leftClass} onClick={() => !pairGraded && setActiveMatch(prev => ({ ...prev, [q.id]: isActive ? undefined : idx }))}>
                                        <span className="match-index">{idx + 1}.</span>
                                        <span className="match-text">{item.text || item}</span>
                                        {isPaired && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                                                {pairGraded && !isCorrectMatch ? (
                                                    <>
                                                        <span className="match-badge wrong-badge" style={{ textDecoration: 'line-through', background: '#ff5f5f', color: '#fff', opacity: 0.8 }}>
                                                            {String.fromCharCode(65 + qAnswers[idx])}
                                                        </span>
                                                        <span className="match-badge-arrow" style={{ color: '#42d7b8', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>
                                                            <i className="fas fa-arrow-right"></i>
                                                        </span>
                                                        <span className="match-badge correct-badge" style={{ background: '#42d7b8', color: '#000' }}>
                                                            {correctRightIdx !== undefined ? String.fromCharCode(65 + correctRightIdx) : '?'}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="match-badge">{String.fromCharCode(65 + qAnswers[idx])}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className={`match-col match-right ${activeMatch[q.id] !== undefined && !isGraded ? 'is-listening' : ''}`}>
                            {matchData.right_column?.map((item, idx) => {
                                const qAnswers = ans || {};
                                const currentActive = activeMatch[q.id];
                                const usedByLeftIdx = Object.keys(qAnswers).find(k => qAnswers[k] === idx);
                                const isUsed = usedByLeftIdx !== undefined;

                                return (
                                    <div key={idx} className={`match-item-right ${isUsed ? 'is-used' : ''}`} onClick={() => {
                                        if (currentActive !== undefined) {
                                            const pairGraded = isGraded || qAnswers[currentActive] !== undefined;
                                            if (!pairGraded) {
                                                const newAnswers = { ...qAnswers };
                                                if (isUsed) delete newAnswers[usedByLeftIdx];
                                                newAnswers[currentActive] = idx;
                                                setAnswers({...answers, [q.id]: newAnswers});
                                                setActiveMatch(prev => ({ ...prev, [q.id]: undefined }));
                                                
                                                if (matchData.left_column) {
                                                    const pairedCount = Object.keys(newAnswers).length;
                                                    if (pairedCount === matchData.left_column.length) {
                                                        setGradedQs(prev => ({...prev, [q.id]: true}));
                                                    }
                                                }
                                            }
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
                            const val = ans?.[i] || '';
                            let inputClass = "fib-input";
                            if (isGraded) {
                                const isCorrect = val.toLowerCase().trim() === (q.correct_answer?.[i] || '').toLowerCase().trim();
                                inputClass += isCorrect ? " correct" : " wrong";
                            }
                            return (
                                <input 
                                    key={i} type="text" placeholder={`Blank ${i+1}`} value={val} disabled={isGraded} className={inputClass}
                                    onChange={(e) => {
                                        const newAns = [...(ans || [])];
                                        newAns[i] = e.target.value;
                                        setAnswers({...answers, [q.id]: newAns});
                                    }}
                                />
                            );
                        })}
                    </div>
                ) : isWorkout ? (
                    <textarea 
                        className="workout-textarea" 
                        placeholder="Show your work or write your answer here..."
                        value={ans || ''}
                        onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
                        disabled={isGraded}
                    />
                ) : (
                        <div className="bpq-mc-pad">
                        {q.options?.map((opt, i) => {
                            const optText = opt.text || opt;
                            const ansText = ans?.text || ans;
                            const isSelected = ansText !== undefined && ansText === optText;
                            
                            const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer;
                            const isThisOptionCorrect = isGraded && i === correctIdx;
                            const isThisOptionWrong = isGraded && isSelected && !isThisOptionCorrect;

                            let optClass = "bpq-mc-btn";
                            if (isThisOptionCorrect) optClass += " correct-highlight";
                            else if (isThisOptionWrong) optClass += " wrong-highlight";
                            else if (isSelected && !isGraded) optClass += " active";

                            return (
                                <label key={i} className={optClass} style={{ pointerEvents: isGraded ? 'none' : 'auto', opacity: isGraded || isSelected ? 1 : 0.5 }}>
                                    <input type="radio" hidden disabled={isGraded} onChange={() => handleLocalSelect(opt)} />
                                    <div className="bpq-mc-indicator"></div> <span>{optText}</span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="bpq-footer">
                <div className="bpq-nav">
                    <button disabled={qIndex === 0} onClick={() => setQIndex(qIndex - 1)}><i className="fas fa-chevron-left"></i></button>
                    <button disabled={qIndex === questions.length - 1} onClick={() => setQIndex(qIndex + 1)}><i className="fas fa-chevron-right"></i></button>
                </div>
                <div className="bpq-actions">
                    <button className="bpq-btn-report" onClick={() => onReport(q.id)} title="Report an issue">
                        <i className="fas fa-triangle-exclamation"></i>
                    </button>
                    {!isGraded && (isFIB || isWorkout) && (
                        <button className="check-answer-btn" onClick={checkAnswer} style={{margin:0}}><i className="fas fa-check-circle"></i> Check</button>
                    )}
                    {isGraded && (
                        <button className="bpq-btn-explain" onClick={() => onExplain(q.content_index, q.explanation)}>
                            <i className="fas fa-book-open"></i> Explain
                        </button>
                    )}
                    {q.exam_meta && (
                        <button className="bpq-btn-goto" onClick={() => window.dispatchEvent(new CustomEvent('heaven-academy:open-exam', { detail: { exam: q.exam_meta } }))}>
                            Go To Exam <i className="fas fa-arrow-right"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PageQuestionsBlock;