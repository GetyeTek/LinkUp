import React from 'react';

const SquadsFeed = ({
    activeView,
    handleScroll,
    setIsGroupCreatorOpen,
    conversations,
    suggestedSquads,
    campusClasses,
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
    
    const myClasses = conversations.filter(c => c.type === 'group' && c.metadata?.focus === 'Class');
    const mySquads = conversations.filter(c => c.type === 'group' && c.metadata?.focus !== 'Class');

    const handlePreviewJoin = (chat) => {
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
    };

    return (
        <div id="squads-view" className={`hub-view ${activeView === 'squads' || activeView === 'class' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>
                    {activeView === 'class' ? 'Your Classes' : 'Your Groups'}
                </h3>
                <button style={{ background: 'var(--accent-teal)', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }} onClick={() => setIsGroupCreatorOpen(true)}>
                    <i className="fas fa-plus"></i> New {activeView === 'class' ? 'Class' : 'Group'}
                </button>
            </div>

            <div className="messages-list" style={{ padding: 0 }}>
                {activeView === 'class' ? (
                    /* --- CLASS VIEW PORT --- */
                    <>
                        {myClasses.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', padding: '2rem 1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                You haven't joined any official classes yet.
                            </div>
                        ) : (
                            myClasses.map(chat => (
                                <div className="messages-list-item" key={chat.conversation_id} onClick={() => handleChatClick(chat)}>
                                    <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                        {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring square"></div>}
                                        <div style={{ width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', overflow: 'hidden' }}>
                                            {chat.avatar_url ? <img src={chat.avatar_url} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-users-rectangle"></i>}
                                        </div>
                                    </div>
                                    <div className="message-info">
                                        <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            {chat.title} 
                                        </div>
                                        <div className="last-message">{chat.last_message_text || 'Class established'}</div>
                                    </div>
                                    <div className="message-meta">
                                        <span>{formatTime(chat.last_message_at)}</span>
                                    </div>
                                </div>
                            ))
                        )}

                        <div className="squads-delimiter"><span>Campus Classes</span></div>
                        
                        {campusClasses.filter(c => !c.is_member).length > 0 ? (
                            campusClasses.filter(c => !c.is_member).map(chat => (
                                <div className="messages-list-item suggested" key={chat.conversation_id} onClick={() => handlePreviewJoin(chat)}>
                                    <div style={{ position: 'relative', width: '50px', height: '50px', flexShrink: 0 }}>
                                        {isSessionLive(chat.metadata) && <div className="list-live-pulse-ring square"></div>}
                                        <div style={{ width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(66, 215, 184, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: 'var(--accent-teal)', overflow: 'hidden' }}>
                                            {chat.owner_avatar ? <img src={chat.owner_avatar} style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Group" /> : <i className="fas fa-landmark"></i>}
                                        </div>
                                    </div>
                                    <div className="message-info">
                                        <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                                            {chat.title} 
                                            {chat.relevance_score >= 10 ? (
                                                <span style={{ fontSize: '0.65rem', background: 'rgba(255, 171, 64, 0.15)', color: '#ffab40', padding: '2px 6px', borderRadius: '4px' }}>Friend</span>
                                            ) : chat.relevance_score >= 5 ? (
                                                <span style={{ fontSize: '0.65rem', background: 'rgba(66, 215, 184, 0.15)', color: 'var(--accent-teal)', padding: '2px 6px', borderRadius: '4px' }}>Department</span>
                                            ) : null}
                                        </div>
                                        <div className="last-message" style={{color: '#888'}}>
                                            <i className="fas fa-user-circle" style={{marginRight: '4px'}}></i> By {chat.owner_name}
                                        </div>
                                    </div>
                                    <button className="squad-join-btn" style={{ minWidth: '70px', textAlign: 'center' }} onClick={(e) => handleJoinSquad(chat.conversation_id, e)} disabled={joiningSquadId === chat.conversation_id}>
                                        {joiningSquadId === chat.conversation_id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join'}
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div style={{ textAlign: 'center', color: '#666', padding: '1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                No new classes available on your campus right now.
                            </div>
                        )}
                        
                        <div style={{ marginTop: '2rem', textAlign: 'center', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                            <p style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#aaa' }}>Can't find your class section?</p>
                            <button style={{ background: 'transparent', color: 'var(--accent-teal)', border: '1px solid var(--accent-teal)', padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }} onClick={() => setIsGroupCreatorOpen(true)}>
                                Create it and invite your batchmates
                            </button>
                        </div>
                    </>
                ) : (
                    /* --- STUDY GROUPS VIEW PORT --- */
                    <>
                        {mySquads.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#666', padding: '2rem 1rem', fontStyle: 'italic', fontSize: '0.85rem' }}>
                                You haven't joined any academic groups yet.
                            </div>
                        ) : (
                            mySquads.map(chat => (
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
                                <div className="messages-list-item suggested" key={chat.conversation_id} onClick={() => handlePreviewJoin(chat)}>
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
                                No public study groups available right now. Be the first to create one!
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default SquadsFeed;