import React from 'react';
import './MironThreadSidebar.css';

const MironThreadSidebar = ({
    isOpen,
    onClose,
    threads,
    activeThreadId,
    onSelectThread,
    onNewThread,
    onDeleteThread
}) => {
    if (!isOpen) return null;

    const formatThreadTime = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const diffInMins = Math.floor((now - date) / 60000);
        const diffInHours = Math.floor(diffInMins / 60);

        if (diffInMins < 1) return 'Just now';
        if (diffInMins < 60) return `${diffInMins}m ago`;
        if (diffInHours < 24) return `${diffInHours}h ago`;
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    return (
        <div className="mts-overlay" onClick={onClose}>
            <div className="mts-drawer" onClick={e => e.stopPropagation()}>
                <header className="mts-header">
                    <h3><i className="fas fa-sparkles"></i> Miron History</h3>
                    <button className="icon-button" onClick={onClose} style={{ width: '32px', height: '32px' }}>
                        <i className="fas fa-times"></i>
                    </button>
                </header>

                <button className="mts-new-btn" onClick={() => { onNewThread(); onClose(); }}>
                    <i className="fas fa-plus"></i> New Conversation
                </button>

                <div className="mts-list">
                    {threads.length === 0 ? (
                        <div className="mts-empty">No previous study threads.</div>
                    ) : (
                        threads.map(t => (
                            <div 
                                key={t.id} 
                                className={`mts-item ${t.id === activeThreadId ? 'active' : ''}`}
                                onClick={() => { onSelectThread(t); onClose(); }}
                            >
                                <div className="mts-info">
                                    <span className="mts-title">{t.title || 'Untitled Session'}</span>
                                    <div className="mts-meta">
                                        {t.course_code && <span className="mts-badge">{t.course_code}</span>}
                                        <span>{formatThreadTime(t.last_message_at || t.created_at)}</span>
                                    </div>
                                </div>
                                <button 
                                    className="mts-delete-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteThread(t.id);
                                    }}
                                    title="Delete Thread"
                                >
                                    <i className="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default MironThreadSidebar;