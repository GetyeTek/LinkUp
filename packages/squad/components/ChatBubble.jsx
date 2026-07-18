import React from 'react';
import { getAvatarFallback } from '@linkup-platform/sdk-core';
import ChatMediaGallery from './ChatMediaGallery.jsx';
import InteractivePoll from './InteractivePoll.jsx';

const ChatBubble = ({
    msg,
    currentUser,
    isMine,
    isGroup,
    sender,
    isPreview,
    activeMenu,
    setActiveMenu,
    onOriginClick,
    onOpenUser,
    scrollToMessage,
    formatTime,
    setFullscreenGallery,
    handleDownload,
    repliedMsg,
    isMissingReply,
    resolvedReplyName,
    getMessageStatusIcon
}) => {
    const hasMedia = msg.attachments && msg.attachments.length > 0;
    const isNaked = hasMedia && (!msg.text || msg.text.trim() === '');
    const isMenuOpen = activeMenu?.msg?.id === msg.id;

    const handleBubbleClick = (e) => {
        e.stopPropagation();
        if (isPreview) return; // Read-only context for preview
        if (isMenuOpen) {
            setActiveMenu(null);
            return;
        }
        
        let x = e.clientX || (e.touches && e.touches[0].clientX);
        let y = e.clientY || (e.touches && e.touches[0].clientY);
        
        if (!x || !y) {
            const rect = e.currentTarget.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
        
        const menuW = 160;
        const menuH = 200;
        
        if (x + menuW > window.innerWidth - 20) x = window.innerWidth - menuW - 20;
        if (y + menuH > window.innerHeight - 80) y = window.innerHeight - menuH - 80;
        if (y < 80) y = 80;
        
        setActiveMenu({ msg, isMine, x, y });
    };

    const renderForward = () => (
        msg.forward_meta && (
            <div className="forward-indicator" onClick={(e) => { e.stopPropagation(); onOriginClick(msg.forward_meta); }}>
                <div className="forward-bar"></div>
                <div className="forward-info">
                    <span className="forward-label">Forwarded message</span>
                    <span className="forward-from">
                        <img src={msg.forward_meta.original_sender_avatar || getAvatarFallback(msg.forward_meta.original_sender_name)} onError={(e) => { e.target.onerror = null; e.target.src = getAvatarFallback(msg.forward_meta.original_sender_name); }} className="forward-avatar" alt="Avatar"/>
                        {msg.forward_meta.original_sender_name}
                    </span>
                </div>
            </div>
        )
    );

    const renderReply = () => {
        if (repliedMsg) {
            return (
                <div className={isGroup ? "squad-reply-quote" : "reply-quote"} onClick={(e) => { e.stopPropagation(); scrollToMessage(msg.reply_to_id); }}>
                    {!isGroup && <div className="reply-quote-bar"></div>}
                    <div className={isGroup ? "sq-quote-content" : "reply-quote-content"}>
                        <div className={isGroup ? "sq-quote-user" : "reply-quote-user"}>{resolvedReplyName}</div>
                        <div className={isGroup ? "sq-quote-text" : "reply-quote-text"}>{repliedMsg.text}</div>
                    </div>
                </div>
            );
        }
        if (isMissingReply) {
            return (
                <div className={isGroup ? "squad-reply-quote is-deleted" : "reply-quote is-deleted"}>
                    {!isGroup && <div className="reply-quote-bar"></div>}
                    <div className={isGroup ? "sq-quote-content" : "reply-quote-content"}>
                        <div className={isGroup ? "sq-quote-user" : "reply-quote-user"}>System</div>
                        <div className={isGroup ? "sq-quote-text" : "reply-quote-text"}><i>Original message deleted</i></div>
                    </div>
                </div>
            );
        }
        return null;
    };

    const renderBubbleContent = (baseClass) => {
        const pollAttachment = msg.attachments?.find(a => a.type === 'poll');
        
        if (pollAttachment) {
            return (
                <div className={baseClass} style={{ padding: 0, overflow: 'hidden', background: 'transparent', border: 'none', boxShadow: 'none' }}>
                    {renderForward()}
                    {renderReply()}
                    <InteractivePoll pollData={pollAttachment.poll_data} msgId={msg.id} currentUser={currentUser} />
                </div>
            );
        }

        const bubbleClass = `${baseClass} ${hasMedia ? (isNaked ? 'media-bubble naked' : 'media-bubble captioned') : ''}`;
        return (
            <div className={bubbleClass}>
                {renderForward()}
                {renderReply()}
                <ChatMediaGallery attachments={msg.attachments} setFullscreenGallery={setFullscreenGallery} handleDownload={handleDownload} />
                {msg.text && <div className="bubble-text-content">{msg.text}</div>}
                
                {isGroup && (
                    <div className={`squad-time-meta ${isMine ? 'mine-meta' : ''}`}>
                        {msg.is_edited && <span>edited</span>}
                        {formatTime(msg.created_at)}
                        {isMine && (
                            msg.status === 'pending' ? <i className="fa-solid fa-clock" style={{fontSize: '0.6rem'}}></i> : 
                            msg.status === 'failed' ? <i className="fa-solid fa-circle-exclamation" style={{color: '#ff5f5f', fontSize: '0.7rem'}} title="Message Failed"></i> : 
                            <i className="fa-solid fa-check"></i>
                        )}
                    </div>
                )}
            </div>
        );
    };

    if (isGroup) {
        return (
            <div 
                id={`sq-msg-${msg.id}`}
                className={`squad-msg-group ${isMine ? 'mine' : 'theirs'}`} 
                style={{ zIndex: isMenuOpen ? 100 : 1 }}
                onClick={handleBubbleClick}
            >
                {!isMine && (
                    <img src={sender.avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="squad-msg-avatar" onClick={(e) => { e.stopPropagation(); if(msg.sender_id) onOpenUser(msg.sender_id); }} style={{cursor: msg.sender_id ? 'pointer' : 'default'}} />
                )}
                <div className="squad-bubble-wrapper">
                    {!isMine && (
                        <div className="squad-sender-name">
                            {sender.name}
                            {sender.role === 'owner' && <i className="fas fa-crown admin-crown"></i>}
                        </div>
                    )}
                    {renderBubbleContent('squad-bubble')}
                </div>
            </div>
        );
    }

    return (
        <div 
            id={`msg-${msg.id}`} 
            className={`msg-prism-group ${isMine ? 'sent' : 'received'}`} 
            style={{ zIndex: isMenuOpen ? 100 : 1 }}
            onClick={handleBubbleClick}
        >
            {renderBubbleContent('prism-bubble')}
            <div className="prism-time">
                {msg.is_edited && <span className="edited-label">edited</span>}
                {formatTime(msg.created_at)}
                {isMine && <span style={{ marginLeft: '6px' }}>{getMessageStatusIcon(msg)}</span>}
            </div>
        </div>
    );
};

export default ChatBubble;