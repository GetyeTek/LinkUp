import React, { useState } from 'react';
import './PageQuestionsBlock.css';

const getNormalizedMatchingData = (q) => {
    if (q.matching_data && q.matching_data.left_column && q.matching_data.left_column.length > 0) {
        return q.matching_data;
    }

    let opts = q.options;
    if (typeof opts === 'string') {
        try { opts = JSON.parse(opts); } catch(e) {}
    }

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
    
    if (!questions || questions.length === 0) return null;
    const q = questions[qIndex];
    const ans = answers[q.id];
    
    const isMatching = (q.question_type && q.question_type.toLowerCase() === 'matching') || 
                       q.matching_data || 
                       (Array.isArray(q.options) && q.options.some(o => typeof o === 'string' && o.includes('Column A')));
    
    const matchData = isMatching ? getNormalizedMatchingData(q) : null;

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
                        <label className={`bpq-tf-btn ${ans === 'True' || ans?.text === 'True' ? 'active-true' : ''}`} style={{ pointerEvents: ans ? 'none' : 'auto', opacity: ans && ans !== 'True' && ans?.text !== 'True' ? 0.5 : 1 }}>
                            <input type="radio" hidden disabled={!!ans} onChange={() => !ans && setAnswers({...answers, [q.id]: 'True'})} />
                            <i className="fa-solid fa-check"></i> TRUE
                        </label>
                        <label className={`bpq-tf-btn ${ans === 'False' || ans?.text === 'False' ? 'active-false' : ''}`} style={{ pointerEvents: ans ? 'none' : 'auto', opacity: ans && ans !== 'False' && ans?.text !== 'False' ? 0.5 : 1 }}>
                            <input type="radio" hidden disabled={!!ans} onChange={() => !ans && setAnswers({...answers, [q.id]: 'False'})} />
                            <i className="fa-solid fa-xmark"></i> FALSE
                        </label>
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
                                
                                return (
                                    <div key={idx} className={`match-item-left ${isActive ? 'is-active' : ''} ${isPaired ? 'is-paired' : ''} ${isDisabled ? 'is-disabled' : ''}`} onClick={() => setActiveMatch(prev => ({ ...prev, [q.id]: isActive ? undefined : idx }))}>
                                        <span className="match-index">{idx + 1}.</span>
                                        <span className="match-text">{item.text || item}</span>
                                        {isPaired && <span className="match-badge">{String.fromCharCode(65 + qAnswers[idx])}</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className={`match-col match-right ${activeMatch[q.id] !== undefined ? 'is-listening' : ''}`}>
                            {matchData.right_column?.map((item, idx) => {
                                const qAnswers = ans || {};
                                const currentActive = activeMatch[q.id];
                                const usedByLeftIdx = Object.keys(qAnswers).find(k => qAnswers[k] === idx);
                                const isUsed = usedByLeftIdx !== undefined;

                                return (
                                    <div key={idx} className={`match-item-right ${isUsed ? 'is-used' : ''}`} onClick={() => {
                                        if (currentActive !== undefined) {
                                            const newAnswers = { ...qAnswers };
                                            if (isUsed) delete newAnswers[usedByLeftIdx];
                                            newAnswers[currentActive] = idx;
                                            setAnswers({...answers, [q.id]: newAnswers});
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
                ) : (
                    <div className="bpq-mc-pad">
                        {q.options?.map((opt, i) => {
                            const optText = opt.text || opt;
                            const ansText = ans?.text || ans;
                            const isSelected = ansText !== undefined && ansText === optText;
                            return (
                                <label key={i} className={`bpq-mc-btn ${isSelected ? 'active' : ''}`} style={{ pointerEvents: ans ? 'none' : 'auto', opacity: ans && !isSelected ? 0.5 : 1 }}>
                                    <input type="radio" hidden disabled={!!ans} onChange={() => !ans && setAnswers({...answers, [q.id]: opt})} />
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
                    <button className="bpq-btn-explain" onClick={() => onExplain(q.content_index)}>
                        <i className="fas fa-sparkles"></i> Explain
                    </button>
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