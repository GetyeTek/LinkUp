import React, { useState } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './ReplyFullScreen.css';

const ReplyFullScreen = ({ replyTarget, onClose, onSuccess, onError }) => {
    const [replyText, setReplyText] = useState('');
    const [isSubmittingQA, setIsSubmittingQA] = useState(false);

    const handleSendReply = async () => {
        if (!replyText.trim() || !replyTarget) return;
        setIsSubmittingQA(true);
        const { error } = await supabase.rpc('reply_to_peer_question', {
            req_question_id: replyTarget.id,
            req_reply_text: replyText.trim()
        });
        setIsSubmittingQA(false);
        if (error) {
            onError("Failed to route reply: " + error.message);
        } else {
            onSuccess("Reply sent to their DMs!");
            onClose();
        }
    };

    return (
        <div className="reply-fs-overlay">
            <header className="reply-fs-header">
                <button className="icon-button" onClick={onClose}>
                    <i className="fas fa-times"></i>
                </button>
                <h2 style={{color: '#fff', fontSize: '1.1rem', margin: 0}}>Reply to {replyTarget.asker_name}</h2>
                <button className="icon-button" style={{color: 'var(--accent-teal)'}} onClick={handleSendReply} disabled={isSubmittingQA || !replyText.trim()}>
                    {isSubmittingQA ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
                </button>
            </header>
            <div className="reply-fs-body">
                <div className="reply-ref-card">
                    <div className="reply-ref-asker">{replyTarget.course_tag} • Asked by {replyTarget.asker_name}</div>
                    <div className="reply-ref-title">{replyTarget.title}</div>
                    {replyTarget.body && <div className="reply-ref-body">{replyTarget.body}</div>}
                </div>
                <textarea 
                    className="reply-textarea" 
                    placeholder="Write your explanation or answer here..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    autoFocus
                ></textarea>
            </div>
        </div>
    );
};

export default ReplyFullScreen;