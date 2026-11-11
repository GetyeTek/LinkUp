import React, { useState } from 'react';

const MironQuizCard = ({ quizData, onComplete }) => {
    // Support single question object or question array
    const questions = Array.isArray(quizData) ? quizData : (quizData?.questions || [quizData]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showHint, setShowHint] = useState(false);
    const [userAnswers, setUserAnswers] = useState({});

    const currentQ = questions[currentIndex] || questions[0];
    if (!currentQ) return null;

    const isTF = currentQ.type === 'tf' || 
        (Array.isArray(currentQ.options) && currentQ.options.length === 2 && 
         currentQ.options.some(o => String(o.id).toLowerCase() === 'true' || String(o.text).toLowerCase() === 'true'));

    const currentAnswer = userAnswers[currentQ.id || currentIndex];
    const isAnswered = currentAnswer !== undefined;

    const handleSelectOption = (opt) => {
        if (isAnswered) return; // Prevent re-answering once locked
        setUserAnswers(prev => ({
            ...prev,
            [currentQ.id || currentIndex]: opt.id
        }));
    };

    const handlePrev = (e) => {
        e.stopPropagation();
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
            setShowHint(false);
        }
    };

    const handleNext = (e) => {
        e.stopPropagation();
        if (currentIndex < questions.length - 1) {
            setCurrentIndex(prev => prev + 1);
            setShowHint(false);
        }
    };

    const isLastQuestion = currentIndex === questions.length - 1;
    const selectedOpt = currentQ.options?.find(o => o.id === currentAnswer);
    const activeDescription = selectedOpt?.description || selectedOpt?.explanation || currentQ.explanation;

    return (
        <div className="ml-quiz-card-wrapper" onClick={(e) => e.stopPropagation()}>
            <div className="ml-quiz-card">
                {/* Header Row: Checkpoint Tag + Lamp Hint Button */}
                <div className="ml-quiz-header">
                    <div className="ml-quiz-tag-pill">
                        <i className="fas fa-brain"></i>
                        <span>CHECKPOINT {questions.length > 1 ? `(${currentIndex + 1}/${questions.length})` : 'QUIZ'}</span>
                    </div>

                    {currentQ.hint && (
                        <button 
                            className={`ml-quiz-lamp-btn ${showHint ? 'active' : ''}`}
                            onClick={() => setShowHint(prev => !prev)}
                            title="Toggle Hint"
                        >
                            <i className="fas fa-lightbulb"></i>
                            <span>Hint</span>
                        </button>
                    )}
                </div>

                {/* Animated Lamp Hint Pill */}
                {showHint && currentQ.hint && (
                    <div className="ml-quiz-hint-box">
                        <i className="fas fa-lightbulb"></i>
                        <p>{currentQ.hint}</p>
                    </div>
                )}

                {/* Question Prompt */}
                <h3 className="ml-quiz-prompt">{currentQ.prompt}</h3>

                {/* Options List (Stacked for MC, Split Grid for TF) */}
                <div className={`ml-quiz-options-container ${isTF ? 'tf-grid' : 'mc-stack'}`}>
                    {(currentQ.options || []).map((opt, oIdx) => {
                        const isSelected = currentAnswer === opt.id;
                        const isCorrect = Boolean(opt.correct);
                        
                        let stateClass = '';
                        if (isAnswered) {
                            if (isSelected && isCorrect) stateClass = 'is-correct is-selected';
                            else if (isSelected && !isCorrect) stateClass = 'is-wrong is-selected';
                            else if (isCorrect) stateClass = 'is-revealed-correct';
                            else stateClass = 'is-dimmed';
                        }

                        return (
                            <button
                                key={opt.id || oIdx}
                                className={`ml-quiz-option-btn ${stateClass}`}
                                onClick={() => handleSelectOption(opt)}
                                disabled={isAnswered}
                            >
                                <div className="ml-option-left">
                                    <span className="ml-option-letter">
                                        {isTF 
                                            ? (String(opt.id).toLowerCase() === 'true' || String(opt.text).toLowerCase() === 'true' ? 'T' : 'F') 
                                            : (['A', 'B', 'C', 'D', 'E'][oIdx] || String.fromCharCode(65 + oIdx))}
                                    </span>
                                    <span className="ml-option-text">{opt.text}</span>
                                </div>

                                <div className="ml-option-status-glyph">
                                    {isAnswered && isSelected && isCorrect && <i className="fas fa-circle-check"></i>}
                                    {isAnswered && isSelected && !isCorrect && <i className="fas fa-circle-xmark"></i>}
                                    {isAnswered && !isSelected && isCorrect && <i className="fas fa-check"></i>}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Instant Feedback Description Box */}
                {isAnswered && activeDescription && (
                    <div className={`ml-quiz-feedback-box ${selectedOpt?.correct ? 'is-correct' : 'is-wrong'}`}>
                        <div className="ml-feedback-header">
                            <i className={`fas fa-${selectedOpt?.correct ? 'circle-check' : 'circle-exclamation'}`}></i>
                            <span>{selectedOpt?.correct ? 'Spot On!' : 'Not Quite!'}</span>
                        </div>
                        <p className="ml-feedback-body">{activeDescription}</p>
                    </div>
                )}

                {/* Navigation Chevrons & Resume Footer */}
                <div className="ml-quiz-footer">
                    <button 
                        className="ml-quiz-chevron-btn" 
                        onClick={handlePrev} 
                        disabled={currentIndex === 0}
                        title="Previous Question"
                    >
                        <i className="fas fa-chevron-left"></i>
                    </button>

                    <div className="ml-quiz-stepper-dots">
                        {questions.length > 1 && questions.map((_, dotIdx) => (
                            <span 
                                key={dotIdx} 
                                className={`ml-stepper-dot ${dotIdx === currentIndex ? 'active' : ''} ${userAnswers[questions[dotIdx].id || dotIdx] !== undefined ? 'answered' : ''}`}
                            ></span>
                        ))}
                    </div>

                    {isLastQuestion ? (
                        <button 
                            className={`ml-quiz-continue-btn ${isAnswered ? 'is-ready' : ''}`}
                            onClick={onComplete}
                            title="Continue Lecture"
                        >
                            <span>Continue Lecture</span>
                            <i className="fas fa-play"></i>
                        </button>
                    ) : (
                        <button 
                            className="ml-quiz-chevron-btn next" 
                            onClick={handleNext}
                            title="Next Question"
                        >
                            <i className="fas fa-chevron-right"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MironQuizCard;