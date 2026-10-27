import React, { useState, useEffect } from 'react';
import { supabase, getAvailableCourseTags } from '@linkup-platform/sdk-core';
import './QAComposerModal.css';

const QAComposerModal = ({ currentUser, onClose, onSuccess, onError }) => {
    const [qForm, setQForm] = useState({ title: '', body: '', course: '' });
    const [isSubmittingQA, setIsSubmittingQA] = useState(false);
    const [courseTags, setCourseTags] = useState(() => getAvailableCourseTags());

    useEffect(() => {
        if (courseTags.length === 0) {
            supabase.from('books')
                .select('course_code, title, friendly_name, icon')
                .eq('is_published', true)
                .order('title')
                .then(({ data }) => {
                    if (data && data.length > 0) {
                        const tags = data.map(b => ({
                            code: b.course_code || '',
                            name: b.friendly_name || (b.title || '').replace(/^General\s+/i, ''),
                            title: b.title,
                            icon: b.icon || 'fa-book-open'
                        })).filter((v, idx, arr) => arr.findIndex(t => t.name.toLowerCase() === v.name.toLowerCase()) === idx);
                        setCourseTags(tags);
                    }
                });
        }
    }, [courseTags.length]);

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
                    <button className="icon-button" onClick={onClose} style={{ color: 'var(--text-primary-dark)' }}>
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
                            {courseTags.map(c => (
                                <div key={c.name} className={`qa-pill ${qForm.course === c.name ? 'active' : ''}`} onClick={() => setQForm({...qForm, course: c.name})}>
                                    <i className={`fas ${c.icon}`} style={{ marginRight: '5px' }}></i>
                                    {c.name}
                                </div>
                            ))}
                            <div className={`qa-pill ${qForm.course === 'General' ? 'active' : ''}`} onClick={() => setQForm({...qForm, course: 'General'})}>
                                General
                            </div>
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