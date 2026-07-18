import React from 'react';
import { getAvatarFallback } from '@linkup-platform/sdk-core';

const MessagesFeed = ({
    activeView,
    handleScroll,
    forwardTargetMsg,
    handleExecuteForward,
    shell,
    setIsNotesOpen,
    setToastNotice,
    conversations,
    handleChatClick,
    isSessionLive,
    onlineUsers,
    formatTime
}) => {
    return (
        <div id="messages-view" className={`hub-view ${activeView === 'messages' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
            <div className="messages-list">
                
                {/* Static Miron Entry (Bot) */}
                <div className="messages-list-item miron-chat-card" onClick={() => {
                    if (forwardTargetMsg) handleExecuteForward('miron');
                    else shell.openMiron(null);
                }}>
                    <div className="miron-avatar-orb">
                        <span className="material-symbols-outlined">auto_awesome</span>
                    </div>
                    <div className="message-info">
                        <div className="name">Miron</div>
                        <div className="typewriter-wrapper">
                            <span className="typewriter-text">Ask me anything about your courses...</span>
                            <span className="blinking-cursor"></span>
                        </div>
                    </div>
                </div>

                {/* My Notes Entry */}
                <div className="messages-list-item" style={{ background: 'rgba(66, 215, 184, 0.05)', border: '1px solid rgba(66, 215, 184, 0.2)' }} onClick={() => {
                    if (forwardTargetMsg) {
                        setToastNotice("Feature unavailable: Forwarding directly to Notes pending vault sync.");
                    } else {
                        setIsNotesOpen(true);
                    }
                }}>
                    <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#42d7b8', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                        <i className="fas fa-bookmark"></i>
                    </div>
                    <div className="message-info">
                        <div className="name" style={{ color: '#42d7b8' }}>My Notes</div>
                        <div className="last-message">
                            {(() => {
                                const note = conversations.find(c => c.type === 'notes');
                                if (!note) return 'Save thoughts, files, or links here...';
                                if (note.last_message_text?.trim()) return note.last_message_text;
                                if (note.last_message_at) return '📎 Note Attachment';
                                return 'Save thoughts, files, or links here...';
                            })()}
                        </div>
                    </div>
                </div>

                {conversations
                    .filter(c => c.type === 'dm' || c.type === 'group')
                    .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
                    .map(chat => {
                        const isDm = chat.type === 'dm';
                        const title = isDm ? chat.other_user_name : chat.title;
                        const avatar = isDm ? chat.other_user_avatar : chat.avatar_url;
                        return (
                            <div className="messages-list-item" key={chat.conversation_id} onClick={() => handleChatClick(chat)}>
                                <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                    {isDm ? (
                                        <img src={avatar || getAvatarFallback(title)} onError={(e) => { e.target.onerror = null; e.target.src = getAvatarFallback(title); }} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                                    ) : (
                                        <>
                                            {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring"></div>}
                                            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', position: 'relative', zIndex: 2 }}>
                                                {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-users"></i>}
                                            </div>
                                        </>
                                    )}
                                    {isDm && onlineUsers.has(chat.other_user_id) && (
                                        <div style={{ position: 'absolute', bottom: '0', right: '0', width: '12px', height: '12px', background: '#42d7b8', borderRadius: '50%', border: '2px solid #1e1e1e', zIndex: 3 }}></div>
                                    )}
                                </div>
                                <div className="message-info">
                                    <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {title}
                                        {!isDm && chat.metadata?.focus && (
                                            <span style={{ fontSize: '0.6rem', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>
                                                {chat.metadata.focus}
                                            </span>
                                        )}
                                    </div>
                                    <div className="last-message">
                                        {chat.last_message_text?.trim() 
                                            ? chat.last_message_text 
                                            : (chat.last_message_at 
                                                ? '📎 Photo or File' 
                                                : (isDm ? 'No messages yet' : 'Group established'))
                                        }
                                    </div>
                                </div>
                                <div className="message-meta">
                                    <span>{formatTime(chat.last_message_at)}</span>
                                    {chat.unread_count > 0 && <div className="unread-badge">{chat.unread_count}</div>}
                                </div>
                            </div>
                        )
                    })}
            </div>
        </div>
    );
};

export default MessagesFeed;