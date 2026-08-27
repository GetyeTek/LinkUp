import React, { useState } from 'react';
import katex from 'https://esm.sh/katex@0.16.11';
import DOMPurify from 'dompurify';
import { usePlatform, logQuestionAttempt } from '@linkup-platform/sdk-core';
import './InlineChatQuiz.css';

const renderMathText = (content) => {
    if (!content) return "";
    let str = String(content);
    const mathMap = new Map();
    let counter = 0;

    // 1. Display Equations ($...$ and \[...\])
    str = str.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (match, p1, p2) => {
        const math = p1 || p2;
        const key = `@@@QUIZ_MATH_DISP_${counter++}@@@`;
        try {
            const html = katex.renderToString(math.trim(), { displayMode: true, throwOnError: false, strict: false });
            mathMap.set(key, html);
            return key;
        } catch (e) {
            return match;
        }
    });

    // 2. Inline Math ($...$ and \(...\))
    str = str.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)/g, (match, p1, p2) => {
        const math = p1 || p2;
        const key = `@@@QUIZ_MATH_INL_${counter++}@@@`;
        try {
            const html = katex.renderToString(math.trim(), { displayMode: false, throwOnError: false, strict: false });
            mathMap.set(key, html);
            return key;
        } catch (e) {
            return match;
        }
    });

    let html = str;
    mathMap.forEach((katexHtml, key) => {
        html = html.split(key).join(katexHtml);
    });

    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, mathMl: true, svg: true }
    });
};

const InlineChatQuiz = ({ quiz, onSubmit }) => {
    const { sessionUser } = usePlatform();
    const [answers, setAnswers] = useState({});
    const [submitted, setSubmitted] = useState(false);

    const handleSelect = (qId, val) => {
        if (!submitted) setAnswers(prev => ({...prev, [qId]: val}));
    };

    const handleSubmit = () => {
        setSubmitted(true);
        const summary = quiz.questions.map((q, i) => `Q${i+1}: ${answers[q.id] || 'Skipped'}`).join('\n');
        onSubmit(`[Quiz Submission: ${quiz.title}]\n${summary}\n\nPlease evaluate my answers.`);

        if (sessionUser?.id) {
            quiz.questions.forEach(q => {
                const ans = answers[q.id];
                let isCorrect = null; // AI will evaluate, but we track the attempt
                
                if (q.correct_answer !== undefined) {
                    const qType = (q.question_type || '').toLowerCase();
                    if (qType === 'true_false') {
                        isCorrect = (ans === 'True' && q.correct_answer === true) || (ans === 'False' && q.correct_answer === false) || (ans === q.correct_answer);
                    } else {
                        isCorrect = ans === q.correct_answer;
                    }
                }

                const isUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

                logQuestionAttempt({
                    userId: sessionUser.id,
                    questionId: isUuid(q.id) ? q.id : null,
                    courseCode: quiz.course_code || 'Miron Chat',
                    topicTag: quiz.title || 'AI Quiz',
                    sourceType: 'miron_quiz',
                    sourceId: null,
                    questionSnapshot: { text: q.text, options: q.options, type: q.question_type },
                    userAnswer: ans,
                    isCorrect: !!isCorrect
                });
            });
        }
    };

    return (
        <div className="miron-quiz-card">
            <div className="mq-header"><i className="fas fa-clipboard-list"></i> {quiz.title}</div>
            <div className="mq-body">
                {quiz.questions.map((q, i) => (
                    <div key={q.id || i} className="mq-question">
                        <div className="mq-q-text">
                            <span className="mq-q-num">{i+1}.</span>
                            <span dangerouslySetInnerHTML={{ __html: renderMathText(q.text) }} />
                        </div>
                        
                        {q.question_type === 'true_false' ? (
                            <div className="mq-tf-pad">
                                <button className={`mq-tf-btn ${answers[q.id] === 'True' ? 'active-true' : ''}`} onClick={() => handleSelect(q.id, 'True')}>TRUE</button>
                                <button className={`mq-tf-btn ${answers[q.id] === 'False' ? 'active-false' : ''}`} onClick={() => handleSelect(q.id, 'False')}>FALSE</button>
                            </div>
                        ) : (
                            <div className="mq-options">
                                {q.options?.map((opt, oIdx) => {
                                    const optText = typeof opt === 'string' ? opt : opt.text;
                                    return (
                                        <button key={oIdx} className={`mq-opt-btn ${answers[q.id] === optText ? 'active' : ''}`} onClick={() => handleSelect(q.id, optText)}>
                                            <div className="mq-opt-ind"></div>
                                            <span dangerouslySetInnerHTML={{ __html: renderMathText(optText) }} />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
                <button className="mq-submit-btn" disabled={submitted} onClick={handleSubmit}>
                    {submitted ? 'Submitted' : 'Submit'} <i className="fas fa-check"></i>
                </button>
            </div>
        </div>
    );
};

export default InlineChatQuiz;