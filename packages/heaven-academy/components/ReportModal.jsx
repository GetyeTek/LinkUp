import React, { useState } from 'react';
import { invokeBookReader } from '../api.js';
import './ReportModal.css';

const ReportModal = ({ questionId, source, onClose }) => {
    const [text, setText] = useState('');
    const [status, setStatus] = useState('idle'); // idle, loading, success, error

    const handleSubmit = async () => {
        setStatus('loading');
        try {
            await invokeBookReader({ 
                action: 'submit_report', 
                question_id: questionId, 
                source, 
                report_text: text 
            });
            setStatus('success');
            setTimeout(onClose, 1500);
        } catch (error) {
            console.error(error);
            setStatus('error');
        }
    };

    return (
        <div className="report-modal-overlay">
            <div className="report-modal-card">
                <header className="report-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
                    <button className="report-close" onClick={onClose} disabled={status === 'loading'} style={{ marginLeft: '-0.5rem' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="report-title">
                        <i className="fas fa-triangle-exclamation"></i> Report Issue
                    </div>
                </header>
                
                <div className="report-body">
                    {status === 'success' ? (
                        <div className="report-success">
                            <div className="success-circle"><i className="fas fa-check"></i></div>
                            <p>Report submitted securely.</p>
                        </div>
                    ) : (
                        <>
                            <p className="report-desc">Did you find an error, typo, or invalid option? Describe the issue below (optional) and our AI/Moderators will review it.</p>
                            <textarea 
                                className="report-textarea"
                                placeholder="E.g. The correct answer should be Option B..."
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                disabled={status === 'loading'}
                            />
                            {status === 'error' && <div className="report-error">Failed to send report. Try again.</div>}
                        </>
                    )}
                </div>

                {status !== 'success' && (
                    <footer className="report-footer">
                        <button className="btn-cancel" onClick={onClose} disabled={status === 'loading'}>Cancel</button>
                        <button className="btn-submit" onClick={handleSubmit} disabled={status === 'loading'}>
                            {status === 'loading' ? <i className="fas fa-circle-notch fa-spin"></i> : 'Submit Report'}
                        </button>
                    </footer>
                )}
            </div>
        </div>
    );
};

export default ReportModal;