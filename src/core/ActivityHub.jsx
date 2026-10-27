import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './ActivityHub.css';

const ActivityHub = ({ onClose }) => {
    const { shell, sessionUser, user, t } = usePlatform();
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchNotifications = async () => {
            const { data } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', sessionUser.id)
                .order('created_at', { ascending: false })
                .limit(30);
            
            if (data) setNotifications(data);
            setLoading(false);
            
            // Mark all as read globally
            shell.markNotificationsRead();
        };

        fetchNotifications();
    }, [sessionUser.id]);

    const handleAction = (n) => {
        if (n.action_data?.action === 'open_chat') {
            window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'connect', payload: n.action_data } }));
            onClose();
        }
    };

    const formatTime = (isoString) => {
        const date = new Date(isoString);
        const diffInMins = Math.floor((new Date() - date) / 60000);
        if (diffInMins < 60) return `${diffInMins}m ago`;
        const diffInHours = Math.floor(diffInMins / 60);
        if (diffInHours < 24) return `${diffInHours}h ago`;
        return `${Math.floor(diffInHours / 24)}d ago`;
    };

    return (
        <div className="activity-overlay" onClick={onClose}>
            <div className="pulse-container" onClick={e => e.stopPropagation()}>
                <header className="pulse-header" style={{ justifyContent: 'flex-start', gap: '1.5rem', alignItems: 'center' }}>
                    <button className="icon-button" onClick={onClose}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h1 style={{ margin: 0, paddingBottom: '2px', color: 'var(--text-primary-dark)' }}>{t('activity_title', user?.sex, 'Activity')}</h1>
                </header>

                <main className="pulse-scroll">
                    <div className="pulse-section-label">{t('activity_recent', user?.sex, 'Recent Activity')}</div>
                    {loading ? (
                        <div style={{textAlign: 'center', padding: '2rem', color: '#888'}}><i className="fas fa-circle-notch fa-spin"></i> {t('activity_syncing', user?.sex, 'Synchronizing...')}</div>
                    ) : notifications.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '3rem', color: '#666'}}>
                            <i className="fas fa-bell-slash" style={{fontSize: '2rem', marginBottom: '1rem'}}></i>
                            <p>{t('activity_empty', user?.sex, 'No new activity right now.')}</p>
                        </div>
                    ) : notifications.map(n => (
                        <div key={n.id} className={`pulse-item type-${n.type} ${!n.is_read ? 'unread' : ''}`}>
                            <div className="p-icon-box"><i className={`fa-solid ${n.icon || 'fa-bell'}`}></i></div>
                            <div className="p-content">
                                <div className="p-meta">
                                    <h3>{n.title}</h3>
                                    <span className="p-time">{formatTime(n.created_at)}</span>
                                </div>
                                <p className="p-desc">{n.description}</p>
                                {n.insight && (
                                    <div className="miron-insight-box">"{n.insight}"</div>
                                )}
                                <div className="p-action-row">
                                    <button className="p-btn primary" onClick={() => handleAction(n)}>{t('activity_view', user?.sex, 'View')}</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </main>
            </div>
        </div>
    );
};

export default ActivityHub;