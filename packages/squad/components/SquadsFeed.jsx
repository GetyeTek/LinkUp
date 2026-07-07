import React from 'react';

const SquadsFeed = ({
    activeView,
    handleScroll,
    setIsGroupCreatorOpen,
    conversations,
    suggestedSquads,
    handleChatClick,
    isSessionLive,
    formatTime,
    forwardTargetMsg,
    setToastNotice,
    setGlobalNotice,
    setMountedChats,
    setActiveChatId,
    handleJoinSquad,
    joiningSquadId
}) => {
    return (
        <div id="squads-view" className={`hub-view ${activeView === 'squads' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Your Groups</h3>
                <button style={{ background: 'var(--accent-teal)', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }} onClick={() => setIsGroupCreatorOpen(true)}>
                    <i className="fas fa-plus"></i> New Group
                </button>
            </div>
            <div className="messages-list" style={{ padding: 0 }}>
                {conversations.filter(c => c.type === 'group').length === 0 && suggestedSquads.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#666', padding: '3rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                        <i className="fas fa-users-slash" style={{fontSize: '2.5rem', opacity: 0.5}}></i>
                        <p style={{margin: 0, fontSize: '0.95rem'}}>You don't have any active groups and there are no suggestions available right now.</p>
                        <p style={{margin: 0, fontSize: '0.85rem', fontStyle: 'italic'}}>Be the first to create a group and invite your peers!</p>
                    </div>
                ) : (
                    <>
                        {conversations.filter(c => c.type === 'group').length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', padding: '2rem 1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                You haven't joined any groups yet.
                            </div>
                        ) : (
                            conversations.filter(c => c.type === 'group').map(chat => (
                                <div className="messages-list-item" key={chat.conversation_id} onClick={() => handleChatClick(chat)}>
                                    <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                        {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring square"></div>}
                                        <div style={{ width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', overflow: 'hidden' }}>
                                            {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-users"></i>}
                                        </div>
                                    </div>
                                    <div className="message-info">
                                        <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            {chat.title} 
                                            {chat.metadata?.focus && <span style={{ fontSize: '0.65rem', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', padding: '2px 6px', borderRadius: '4px' }}>{chat.metadata.focus}</span>}
                                        </div>
                                        <div className="last-message">{chat.last_message_text || 'Group established'}</div>
                                    </div>
                                    <div className="message-meta">
                                        <span>{formatTime(chat.last_message_at)}</span>
                                    </div>
                                </div>
                            ))
                        )}

                        <div className="squads-delimiter"><span>Suggested Groups</span></div>
                        
                        {suggestedSquads.length > 0 ? (
                            suggestedSquads.map(chat => (
                                <div className="messages-list-item suggested" key={chat.conversation_id} onClick={() => {
                                    if (forwardTargetMsg) {
                                        setToastNotice("You must join this group first to forward messages.");
                                        return;
                                    }
                                    if (chat.metadata?.privacy === 'private') {
                                        setGlobalNotice("This group is private. You need an invite link to join.");
                                        return;
                                    }
                                    const previewChat = {
                                        conversation_id: chat.conversation_id,
                                        type: 'group',
                                        title: chat.title,
                                        metadata: chat.metadata,
                                        is_preview: true
                                    };
                                    setMountedChats(prev => ({ ...prev, [chat.conversation_id]: previewChat }));
                                    setActiveChatId(chat.conversation_id);
                                }}>
                                    <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                        {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring square"></div>}
                                        <div style={{ width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(66, 215, 184, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', overflow: 'hidden' }}>
                                            {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-globe"></i>}
                                        </div>
                                    </div>
                                    <div className="message-info">
                                        <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                                            {chat.title} 
                                            {chat.metadata?.focus && <span style={{ fontSize: '0.65rem', background: 'rgba(255, 255, 255, 0.1)', color: '#ccc', padding: '2px 6px', borderRadius: '4px' }}>{chat.metadata.focus}</span>}
                                        </div>
                                        <div className="last-message" style={{color: '#888'}}>
                                            <i className="fas fa-user" style={{marginRight: '4px'}}></i> {chat.member_count} Members
                                        </div>
                                    </div>
                                    <button className="squad-join-btn" style={{ minWidth: '70px', textAlign: 'center' }} onClick={(e) => handleJoinSquad(chat.conversation_id, e)} disabled={joiningSquadId === chat.conversation_id}>
                                        {joiningSquadId === chat.conversation_id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join'}
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div style={{ textAlign: 'center', color: '#666', padding: '1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                No public groups available right now. Be the first to create one!
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default SquadsFeed;