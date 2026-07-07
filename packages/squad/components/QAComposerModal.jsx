import React, { useState } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './QAComposerModal.css';

const QAComposerModal = ({ currentUser, onClose, onSuccess, onError }) => {
    const [qForm, setQForm] = useState({ title: '', body: '', course: '' });
    const [isSubmittingQA, setIsSubmittingQA] = useState(false);

    const handlePostQuestion = async () => {
        if (!qForm.title.trim() || !qForm.course) return;
        setIsSubmittingQA(true);
        const { error } = await supabase.from('peer_questions').insert({
            user_id: currentUser.id,
            title: qForm.title.trim(),
            body: qForm.body.trim(),
            course_tag: qForm.course
        });
        setIsSubmittingQA(false);
        if (error) {
            onError("Failed to post question: " + error.message);
        } else {
            onSuccess("Question posted securely.");
            onClose();
        }
    };

    return (
        <div className="qa-composer-overlay" onClick={onClose}>
            <div className="qa-composer-card" onClick={e => e.stopPropagation()}>
                <header className="qa-composer-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
                    <button className="icon-button" onClick={onClose} style={{ color: 'white', opacity: 0.7 }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h2 style={{ fontSize: '1.1rem' }}>Ask a Question</h2>
                </header>
                <div className="qa-composer-body">
                    <input 
                        type="text" 
                        className="qa-input-main" 
                        placeholder="What's your main question?" 
                        value={qForm.title}
                        onChange={e => setQForm({...qForm, title: e.target.value})}
                        maxLength={100}
                        autoFocus
                    />
                    <textarea 
                        className="qa-input-details" 
                        placeholder="Add context, formulas, or what you're struggling with (optional)..."
                        value={qForm.body}
                        onChange={e => setQForm({...qForm, body: e.target.value})}
                    ></textarea>
                    <div>
                        <span style={{fontSize: '0.8rem', color: '#888', fontWeight: 600, textTransform: 'uppercase'}}>Select Course Tag</span>
                        <div className="qa-pills-wrap">
                            {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'CS', 'General'].map(c => (
                                <div key={c} className={`qa-pill ${qForm.course === c ? 'active' : ''}`} onClick={() => setQForm({...qForm, course: c})}>
                                    {c}
                                </div>
                            ))}
                        </div>
                    </div>
                    <button 
                        className="ui-save-btn" 
                        disabled={isSubmittingQA || !qForm.title.trim() || !qForm.course}
                        onClick={handlePostQuestion}
                        style={{marginTop: '0.5rem'}}
                    >
                        {isSubmittingQA ? <i className="fas fa-circle-notch fa-spin"></i> : 'Post Question'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QAComposerModal;