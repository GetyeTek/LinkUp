import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './MironThreadSidebar.css';

const cleanThreadTitle = (rawTitle) => {
    if (!rawTitle) return "New Conversation";
    let cleaned = rawTitle;
    const inquiryMatch = cleaned.match(/\[Textbook Inquiry:\s*([^\|\]]+)/i);
    if (inquiryMatch) return inquiryMatch[1].trim();
    const quoteMatch = cleaned.match(/\[Book Quote:\s*([^\|\(\]]+)/i);
    if (quoteMatch) return `${quoteMatch[1].trim()} Excerpt`;
    const quizMatch = cleaned.match(/\[Quiz Submission:\s*([^\]]+)\]/i);
    if (quizMatch) return `${quizMatch[1].trim()} Quiz`;
    cleaned = cleaned.replace(/^\[[^\]]+\]\s*/g, '').trim();
    return cleaned || rawTitle;
};

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

    const { t } = usePlatform();
    const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 900;

    const handleSelect = (t) => {
        onSelectThread(t);
        if (!isDesktop) onClose();
    };

    const handleNew = () => {
        onNewThread();
        if (!isDesktop) onClose();
    };

    const formatThreadTime = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const diffInMins = Math.floor((now - date) / 60000);
        const diffInHours = Math.floor(diffInMins / 60);

        if (diffInMins < 1) return t('common_just_now', 'Just now');
        if (diffInMins < 60) return t('common_minutes_ago', '{m}m ago').replace('{m}', String(diffInMins));
        if (diffInHours < 24) return t('common_hours_ago', '{h}h ago').replace('{h}', String(diffInHours));
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    return (
        <div className="mts-overlay" onClick={!isDesktop ? onClose : undefined}>
            <div className="mts-drawer" onClick={e => e.stopPropagation()}>
                <header className="mts-header">
                    <h3>
                        <i className="fas fa-sparkles"></i> 
                        <span>{t('miron_history', 'Miron History')}</span>
                    </h3>
                    <button className="icon-button mts-close-btn" onClick={onClose} title={t('common_close', 'Close Sidebar')} style={{ width: '32px', height: '32px' }}>
                        <i className="fas fa-times"></i>
                    </button>
                </header>

                <button className="mts-new-btn" onClick={handleNew}>
                    <i className="fas fa-plus"></i> {t('miron_new_chat', 'New Conversation')}
                </button>

                <div className="mts-list">
                    {threads.length === 0 ? (
                        <div className="mts-empty">{t('miron_no_threads', 'No previous study threads.')}</div>
                    ) : (
                        threads.map(thread => (
                            <div 
                                key={thread.id} 
                                className={`mts-item ${thread.id === activeThreadId ? 'active' : ''}`}
                                onClick={() => handleSelect(thread)}
                            >
                                <div className="mts-info">
                                    <span className="mts-title">{cleanThreadTitle(thread.title)}</span>
                                    <div className="mts-meta">
                                        {thread.course_code && <span className="mts-badge">{thread.course_code}</span>}
                                        <span>{formatThreadTime(thread.last_message_at || thread.created_at)}</span>
                                    </div>
                                </div>
                                <button 
                                    className="mts-delete-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteThread(thread.id);
                                    }}
                                    title={t('miron_delete_thread', 'Delete Thread')}
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