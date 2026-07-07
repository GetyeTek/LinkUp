import React from 'react';

const LiveStageAttendantQs = ({ attendantViewQs, members, currentUser, questionsEndRef }) => {
    return (
        <div className="stage-questions-box">
            {attendantViewQs.map(q => {
                const isMe = q.sender_id === currentUser.id;
                return (
                    <div key={q.id} className="stage-question-card" style={{ opacity: isMe && (q.status === 'pending' || q.status === 'dropped') ? 0.6 : 1 }}>
                        <div className="sq-meta">
                            <span>{members[q.sender_id]?.name || 'Student'}</span>
                            {isMe ? (
                                q.status === 'pending' ? (
                                    <span className="q-status-badge">Pending Review <i className="fas fa-clock"></i></span>
                                ) : q.status === 'dropped' ? (
                                    <span className="q-status-badge" style={{background: 'rgba(255, 95, 95, 0.15)', color: '#ff5f5f', border: '1px solid rgba(255, 95, 95, 0.3)'}}>Dropped <i className="fas fa-times"></i></span>
                                ) : (
                                    <span className="q-status-badge" style={{background: 'rgba(66, 215, 184, 0.15)', color: 'var(--accent-teal)', border: '1px solid rgba(66, 215, 184, 0.3)'}}>Asked <i className="fas fa-check"></i></span>
                                )
                            ) : (
                                <span style={{ opacity: 0.8 }}>Question</span>
                            )}
                        </div>
                        <p className="sq-body-text" style={{ textDecoration: (isMe && q.status === 'dropped') ? 'line-through' : 'none' }}>{q.text}</p>
                    </div>
                );
            })}
            <div ref={questionsEndRef} />
        </div>
    );
};

export default LiveStageAttendantQs;