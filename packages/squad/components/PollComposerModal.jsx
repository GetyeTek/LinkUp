import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlatform } from '@linkup-platform/sdk-core';
import './PollComposerModal.css';

const PollComposerModal = ({ onClose, onSendPoll, initialPollData }) => {
    const { t } = usePlatform();
    const [question, setQuestion] = useState(initialPollData?.question || '');
    const [description, setDescription] = useState(initialPollData?.description || '');
    const [options, setOptions] = useState(initialPollData?.options?.map((text, i) => ({id: i + 1, text})) || [{ id: 1, text: '' }, { id: 2, text: '' }]);
    
    // Settings
    const [quizMode, setQuizMode] = useState(initialPollData?.quiz_mode || false);
    const [correctIndex, setCorrectIndex] = useState(initialPollData?.correct_option_index ?? null);
    const [multipleAnswers, setMultipleAnswers] = useState(initialPollData?.multiple_answers || false);
    const [allowRevote, setAllowRevote] = useState(initialPollData?.allow_revote ?? true);
    const [durationIdx, setDurationIdx] = useState(null); // null = infinite
    const [customDate, setCustomDate] = useState('');
    const [validationError, setValidationError] = useState('');

    const durations = [
        { label: '3h', hours: 3 },
        { label: '8h', hours: 8 },
        { label: '12h', hours: 12 },
        { label: '24h', hours: 24 },
        { label: '72h', hours: 72 }
    ];

    const handleAddOption = () => {
        if (options.length >= 10) return;
        setOptions([...options, { id: Date.now(), text: '' }]);
    };

    const handleUpdateOption = (id, text) => {
        setOptions(options.map(o => o.id === id ? { ...o, text } : o));
    };

    const handleRemoveOption = (idx) => {
        if (options.length <= 2) return;
        setOptions(options.filter((_, i) => i !== idx));
        if (correctIndex === idx) setCorrectIndex(null);
        else if (correctIndex > idx) setCorrectIndex(correctIndex - 1);
    };

    const handleSubmit = () => {
        const validOptions = options.map(o => o.text.trim()).filter(Boolean);
        
        if (!question.trim()) {
            setValidationError('Please enter a question to start the poll.');
            document.querySelector('.poll-comp-body').scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (validOptions.length < 2) {
            setValidationError('Please provide at least two valid options.');
            document.querySelector('.poll-comp-body').scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (quizMode && correctIndex === null) {
            setValidationError('Quiz mode requires a correct answer. Tap the circle next to an option to select it.');
            document.querySelector('.poll-comp-body').scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        
        setValidationError('');

        let deadline = null;
        if (durationIdx === 'custom' && customDate) {
            deadline = new Date(customDate).toISOString();
        } else if (durationIdx !== null && typeof durationIdx === 'number') {
            deadline = new Date(Date.now() + durations[durationIdx].hours * 3600000).toISOString();
        }

        const pollData = {
            question: question.trim(),
            description: description.trim() || null,
            options: validOptions,
            quiz_mode: quizMode,
            correct_option_index: quizMode ? correctIndex : null,
            multiple_answers: quizMode ? false : multipleAnswers,
            allow_revote: allowRevote,
            deadline
        };

        onSendPoll(pollData);
        onClose();
    };

    const validOptionCount = options.filter(o => o.text.trim()).length;
    // Button is deliberately kept enabled so the user can click it and see the guided validation error scroll
    const isValid = true;

            return createPortal(
        <div className="poll-composer-overlay" onClick={onClose}>
            <div className="poll-composer-sheet" onClick={e => e.stopPropagation()}>
                <header className="poll-comp-header">
                    <h2>{initialPollData ? t('poll_update_title', null, 'Update Poll') : t('poll_create_title', null, 'Create Poll')}</h2>
                    <button className="icon-button" style={{color: '#888'}} onClick={onClose}><i className="fas fa-times"></i></button>
                </header>

                <div className="poll-comp-body">
                    {validationError && (
                        <div className="pc-error-banner">
                            <i className="fas fa-exclamation-circle"></i>
                            {validationError}
                        </div>
                    )}
                    
                    <div className="pc-group">
                        <label className="pc-label">{t('poll_q_label', null, 'Question')}</label>
                        <input className="pc-input" type="text" placeholder={t('poll_q_placeholder', null, 'Ask a question...')} value={question} onChange={e => setQuestion(e.target.value)} autoFocus />
                    </div>

                    <div className="pc-group">
                        <label className="pc-label" style={{color: '#888'}}>{t('poll_desc_label', null, 'Description (Optional)')}</label>
                        <input className="pc-input" type="text" placeholder={t('poll_desc_placeholder', null, 'Add context or instructions...')} value={description} onChange={e => setDescription(e.target.value)} />
                    </div>

                    <div className="pc-group">
                        <label className="pc-label">{t('poll_opt_label', null, 'Options')}</label>
                        <div className="pc-options-list">
                            {options.map((opt, i) => (
                                <div className="pc-option-row" key={opt.id}>
                                    {quizMode && (
                                        <div className={`pc-quiz-radio ${correctIndex === i ? 'selected' : ''}`} onClick={() => setCorrectIndex(i)}></div>
                                    )}
                                    <input 
                                        className="pc-input" 
                                        style={{flex: 1}} 
                                        type="text" 
                                        placeholder={t('poll_opt_placeholder', null, 'Option {num}').replace('{num}', String(i + 1))} 
                                        value={opt.text} 
                                        onChange={e => handleUpdateOption(opt.id, e.target.value)} 
                                    />
                                    {options.length > 2 && (
                                        <button className="icon-button" style={{color: '#ff5f5f'}} onClick={() => handleRemoveOption(i)}><i className="fas fa-minus-circle"></i></button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {options.length < 10 && (
                            <button className="pc-add-btn" onClick={handleAddOption}>{t('poll_add_opt', null, '+ Add Option')}</button>
                        )}
                    </div>

                    <div className="pc-group">
                        <label className="pc-label">{t('poll_settings', null, 'Settings')}</label>
                        <div className="pc-settings-panel">
                            <div className="pc-setting-row" onClick={() => { 
                                const next = !quizMode;
                                setQuizMode(next); 
                                if(next) {
                                    setMultipleAnswers(false);
                                    setAllowRevote(false); // Quizzes are usually one-shot
                                }
                            }}>
                                <div className="pc-setting-info">
                                    <span className="pc-setting-title">{t('poll_quiz_mode', null, 'Quiz Mode')}</span>
                                    <span className="pc-setting-desc">{t('poll_quiz_desc', null, 'Set a correct answer')}</span>
                                </div>
                                <div className={`toggle-switch ${quizMode ? 'on' : 'off'}`}></div>
                            </div>

                            <div className="pc-setting-row" onClick={() => {
                                const next = !multipleAnswers;
                                setMultipleAnswers(next);
                                if(next) {
                                    setQuizMode(false);
                                    setAllowRevote(true); // Multiple answers mandates revoting
                                }
                            }}>
                                <div className="pc-setting-info">
                                    <span className="pc-setting-title">{t('poll_multi_ans', null, 'Multiple Answers')}</span>
                                    <span className="pc-setting-desc">{t('poll_multi_desc', null, 'Allow checking multiple options')}</span>
                                </div>
                                <div className={`toggle-switch ${multipleAnswers ? 'on' : 'off'}`}></div>
                            </div>

                            <div className="pc-setting-row" onClick={() => {
                                if (multipleAnswers) return; // Locked when Multiple Answers is active
                                setAllowRevote(!allowRevote);
                            }}>
                                <div className="pc-setting-info">
                                    <span className="pc-setting-title">{t('poll_allow_revote', null, 'Allow Revoting')}</span>
                                    <span className="pc-setting-desc">{t('poll_allow_desc', null, 'Users can change their answer')}</span>
                                </div>
                                <div className={`toggle-switch ${allowRevote ? 'on' : 'off'} ${multipleAnswers ? 'disabled' : ''}`}></div>
                            </div>

                            <div className="pc-setting-row" style={{flexDirection: 'column', alignItems: 'stretch'}}>
                                <div className="pc-setting-info">
                                    <span className="pc-setting-title">{t('poll_limit_dur', null, 'Limit Duration')}</span>
                                    <span className="pc-setting-desc">{t('poll_limit_desc', null, 'Poll ends automatically')}</span>
                                </div>
                                <div className="pc-duration-pills">
                                    <div className={`pc-duration-pill ${durationIdx === null ? 'active' : ''}`} onClick={() => setDurationIdx(null)}>{t('poll_infinite', null, 'Infinite')}</div>
                                    {durations.map((d, i) => (
                                        <div key={i} className={`pc-duration-pill ${durationIdx === i ? 'active' : ''}`} onClick={() => setDurationIdx(i)}>{d.label}</div>
                                    ))}
                                    <div className={`pc-duration-pill ${durationIdx === 'custom' ? 'active' : ''}`} onClick={() => setDurationIdx('custom')}>{t('poll_custom', null, 'Custom')}</div>
                                </div>
                                {durationIdx === 'custom' && (
                                    <input 
                                        type="datetime-local" 
                                        className="pc-input" 
                                        style={{marginTop: '10px'}}
                                        value={customDate}
                                        onChange={e => setCustomDate(e.target.value)}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <button className="poll-submit-btn" disabled={!isValid} onClick={handleSubmit}>{initialPollData ? t('poll_update_title', null, 'Update Poll') : t('poll_create_title', null, 'Create Poll')}</button>
            </div>
        </div>,
        document.body
    );
};

export default PollComposerModal;