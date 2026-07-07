import React from 'react';
import './ForYouFeed.css';

const ForYouFeed = ({ activeView, handleScroll, peerQuestions, currentUser, timeAgo, setReplyTarget, liveSessions, handleJoinSquad, joiningSquadId }) => {
    return (
        <div id="for-you-view" className={`hub-view ${activeView === 'for-you' ? 'active' : ''}`} onScroll={handleScroll} style={{ overflowY: 'auto', height: '100%' }}>
            <div className="activity-list-container">
                {/* Dynamic Peer Questions Stream */}
                {peerQuestions.map(q => (
                    <div className="activity-card" key={q.id}>
                        <div className="activity-content" style={{ borderLeft: `4px solid ${q.asker_id === currentUser.id ? '#9b59b6' : 'var(--accent-teal)'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <div className="activity-tag" style={{ color: q.asker_id === currentUser.id ? '#9b59b6' : 'var(--accent-teal)', marginBottom: 0 }}>
                                    {q.course_tag}
                                </div>
                            </div>
                            <h2 className="activity-headline">{q.title}</h2>
                            <div style={{display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0'}}>
                                <img src={q.asker_avatar || 'https://via.placeholder.com/150'} style={{width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover'}} alt="Asker" />
                                <span style={{fontSize: '0.8rem', color: '#888'}}>
                                    {q.asker_id === currentUser.id ? 'Asked by You' : `Asked by ${q.asker_name}`} • {timeAgo(q.created_at)}
                                </span>
                            </div>
                            {q.body && <p className="activity-snippet">{q.body}</p>}
                            {q.asker_id !== currentUser.id && (
                                <button className="claim-btn claimable" style={{marginTop: '1rem'}} onClick={() => setReplyTarget(q)}>
                                    Reply <i className="fas fa-reply" style={{marginLeft: '6px'}}></i>
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                <div className="squads-delimiter"><span>Campus Highlights</span></div>

                {/* Dynamic Live Study Sessions computed via Miron & Proximity RPC */}
                {liveSessions.map(session => (
                    <div className="activity-card" key={session.session_id}>
                        <div className="activity-content" style={{borderLeft: '4px solid var(--accent-teal)'}}>
                            <div className="activity-tag">Live Study Group</div>
                            <h2 className="activity-headline">{session.course_name}: {session.lesson_topic}</h2>
                            <p className="activity-snippet">{session.dynamic_message}</p>
                            <button 
                                className="claim-btn claimable" 
                                style={{marginTop: '1rem', width: '100%'}}
                                onClick={(e) => handleJoinSquad(session.conversation_id, e)}
                                disabled={joiningSquadId === session.conversation_id}
                            >
                                {joiningSquadId === session.conversation_id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Session'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ForYouFeed;