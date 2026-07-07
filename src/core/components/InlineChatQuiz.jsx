import React, { useState } from 'react';
import './InlineChatQuiz.css';

const InlineChatQuiz = ({ quiz, onSubmit }) => {
    const [answers, setAnswers] = useState({});
    const [submitted, setSubmitted] = useState(false);

    const handleSelect = (qId, val) => {
        if (!submitted) setAnswers(prev => ({...prev, [qId]: val}));
    };

    const handleSubmit = () => {
        setSubmitted(true);
        const summary = quiz.questions.map((q, i) => `Q${i+1}: ${answers[q.id] || 'Skipped'}`).join('\n');
        onSubmit(`[Quiz Submission: ${quiz.title}]\n${summary}\n\nPlease evaluate my answers.`);
    };

    return (
        <div className="miron-quiz-card">
            <div className="mq-header"><i className="fas fa-clipboard-list"></i> {quiz.title}</div>
            <div className="mq-body">
                {quiz.questions.map((q, i) => (
                    <div key={q.id || i} className="mq-question">
                        <div className="mq-q-text"><span className="mq-q-num">{i+1}.</span> {q.text}</div>
                        
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
                                            <span>{optText}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
                <button className="mq-submit-btn" disabled={submitted} onClick={handleSubmit}>
                    {submitted ? 'Submitted for Grading' : 'Submit to Miron'} <i className="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    );
};

export default InlineChatQuiz;