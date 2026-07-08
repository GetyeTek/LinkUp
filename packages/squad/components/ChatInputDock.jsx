import React, { useState } from 'react';
import './ChatInputDock.css';
import { getFileIconProps } from './ChatMediaGallery.jsx';
import PollComposerModal from './PollComposerModal.jsx';

const ChatInputDock = ({
    canPoll = true,
    editingMessage, setEditingMessage, setInput,
    replyingTo, setReplyingTo, scrollToMessage, resolveReplyUser,
    pendingAttachments, setPendingAttachments,
    isUploading, uploadProgress, fileInputRef,
    input,     handleInputChange, handleSend, handleFileSelect,
    restrictedNotice
}) => {
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [showPollComposer, setShowPollComposer] = useState(false);

    const pollAttachment = editingMessage?.attachments?.find(a => a.type === 'poll');

    React.useEffect(() => {
        if (pollAttachment) {
            setShowPollComposer(true);
        }
    }, [editingMessage]);

    // Click-away listener for popover
    React.useEffect(() => {
        const hide = () => setShowAttachMenu(false);
        if (showAttachMenu) document.addEventListener('click', hide);
        return () => document.removeEventListener('click', hide);
    }, [showAttachMenu]);

    const handleSendPoll = (pollData) => {
        const attachment = { type: 'poll', poll_data: pollData };
        handleSend({ text: '', attachments: [attachment] });
    };

    return (
        <footer className="unified-input-wrapper">
            {restrictedNotice ? (
                restrictedNotice
            ) : (
                <>
                    {editingMessage && (
                        <div className="unified-input-mode-header edit-mode">
                            <div className="mode-border"></div>
                            <div className="unified-mode-icon"><i className="fa-solid fa-pen"></i></div>
                            <div className="mode-info">
                                <span className="mode-user">Editing message</span>
                                <span className="mode-text">{editingMessage.text}</span>
                            </div>
                            <button className="icon-button" onClick={() => { setEditingMessage(null); setInput(''); }}>
                                <i className="fa-solid fa-times"></i>
                            </button>
                        </div>
                    )}
                    {replyingTo && (
                        <div className="unified-input-mode-header">
                            <div className="mode-border"></div>
                            <div className="mode-info" onClick={() => scrollToMessage(replyingTo.id)}>
                                <span className="mode-user">Replying to {resolveReplyUser(replyingTo.sender_id)}</span>
                                <span className="mode-text">{replyingTo.text}</span>
                            </div>
                            <button className="icon-button" onClick={() => setReplyingTo(null)}>
                                <i className="fa-solid fa-times"></i>
                            </button>
                        </div>
                    )}
                    {pendingAttachments.length > 0 && (
                        <div className="unified-input-mode-header staging-mode">
                            <div className="mode-border"></div>
                            <div className="staging-preview-content">
                                {pendingAttachments.map((pa, idx) => {
                                    const iconData = getFileIconProps(pa.file.name);
                                    return (
                                    <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                                        {pa.previewUrl ? (
                                            <img src={pa.previewUrl} alt="Preview" className="staging-thumb" />
                                        ) : (
                                            <div className="staging-file-icon" style={{color: iconData.color}}><i className={`fas ${iconData.icon}`}></i></div>
                                        )}
                                        <button 
                                            className="icon-button" 
                                            style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'rgba(0,0,0,0.8)', width: '20px', height: '20px', fontSize: '0.6rem', border: '1px solid rgba(255,255,255,0.2)' }} 
                                            onClick={() => setPendingAttachments(p => p.filter((_, i) => i !== idx))}
                                        >
                                            <i className="fa-solid fa-times"></i>
                                        </button>
                                    </div>
                                )})}
                            </div>
                            <button className="icon-button" onClick={() => setPendingAttachments([])} style={{color: '#ff5f5f', background: 'rgba(255,95,95,0.1)', width: '30px', height: '30px', flexShrink: 0}}>
                                <i className="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    )}
                    <div className="unified-dock">
                        <input 
                            type="file" 
                            multiple
                            ref={fileInputRef} 
                            style={{display: 'none'}} 
                            onChange={handleFileSelect} 
                        />
                        <button className="unified-add-btn" onClick={(e) => { e.stopPropagation(); setShowAttachMenu(!showAttachMenu); }} disabled={isUploading}>
                            <i className="fa-solid fa-paperclip"></i>
                            {showAttachMenu && (
                                <div className="attach-popover-menu" onClick={e => e.stopPropagation()}>
                                    <button onClick={() => { setShowAttachMenu(false); fileInputRef.current.click(); }}>
                                        <i className="fas fa-file-alt"></i> Files & Media
                                    </button>
                                    {canPoll && (
                                        <button onClick={() => { setShowAttachMenu(false); setShowPollComposer(true); }}>
                                            <i className="fas fa-chart-bar"></i> Create Poll
                                        </button>
                                    )}
                                </div>
                            )}
                        </button>
                        <input 
                            type="text" 
                            placeholder="Message..." 
                            disabled={isUploading}
                            value={input}
                            onChange={(e) => handleInputChange(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                        />
                        {isUploading ? (
                            <div className="circular-progress-btn">
                                <svg viewBox="0 0 36 36">
                                    <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                    <path className="circle-fill" strokeDasharray={`${uploadProgress}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                </svg>
                                <span className="prog-text">{uploadProgress}%</span>
                            </div>
                        ) : (
                            <button className="unified-send-btn" onClick={handleSend} disabled={!input.trim() && pendingAttachments.length === 0}>
                                <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                            </button>
                        )}
                    </div>
                </>
            )}
            {showPollComposer && (
                <PollComposerModal 
                    onClose={() => { 
                        setShowPollComposer(false); 
                        if (pollAttachment) setEditingMessage(null); 
                    }} 
                    onSendPoll={handleSendPoll} 
                    initialPollData={pollAttachment?.poll_data}
                />
            )}
        </footer>
    );
};

export default ChatInputDock;