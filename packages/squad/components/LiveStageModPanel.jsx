import React from 'react';

const LiveStageModPanel = ({ hostTab, setHostTab, pendingQs, approvedQs, members, handleModAction, modLoading }) => {
    return (
        <div className="host-mod-panel">
            <div className="mod-tabs">
                <button className={hostTab === 'pending' ? 'active' : ''} onClick={() => setHostTab('pending')}>
                    Inbox {pendingQs.length > 0 && <span className="tab-counter-badge">{pendingQs.length}</span>}
                </button>
                <button className={hostTab === 'approved' ? 'active' : ''} onClick={() => setHostTab('approved')}>
                    Approved {approvedQs.length > 0 && <span className="tab-counter-badge">{approvedQs.length}</span>}
                </button>
            </div>
            <div className="mod-q-list">
                {(hostTab === 'pending' ? pendingQs : approvedQs).map(q => (
                    <div key={q.id} className="mod-q-card">
                        <div className="mqc-header">{members[q.sender_id]?.name || 'Student'}</div>
                        <div className="mqc-text">{q.text}</div>
                        <div className="mqc-actions">
                            <button className="mod-btn pin" onClick={() => handleModAction(q.id, 'pin', { is_pinned: true, status: 'approved' })} disabled={modLoading?.id === q.id}>
                                {modLoading?.id === q.id && modLoading?.action === 'pin' ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-thumbtack"></i> Pin</>}
                            </button>
                            {hostTab === 'pending' && (
                                <button className="mod-btn approve" onClick={() => handleModAction(q.id, 'approve', { status: 'approved' })} disabled={modLoading?.id === q.id}>
                                    {modLoading?.id === q.id && modLoading?.action === 'approve' ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-check"></i> Approve</>}
                                </button>
                            )}
                            <button className="mod-btn dismiss" onClick={() => handleModAction(q.id, 'drop', { status: 'dropped', is_pinned: false })} disabled={modLoading?.id === q.id}>
                                {modLoading?.id === q.id && modLoading?.action === 'drop' ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-trash"></i> Drop</>}
                            </button>
                        </div>
                    </div>
                ))}
                {(hostTab === 'pending' ? pendingQs : approvedQs).length === 0 && (
                    <div className="mod-empty">No questions in this queue.</div>
                )}
            </div>
        </div>
    );
};

export default LiveStageModPanel;