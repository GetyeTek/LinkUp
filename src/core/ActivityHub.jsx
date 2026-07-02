import React, { useState, useEffect } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import './ActivityHub.css';

const ActivityHub = ({ onClose }) => {
    const { shell, sessionUser } = usePlatform();
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
                    <button className="icon-button" onClick={onClose} style={{ color: 'white' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h1 style={{ margin: 0, paddingBottom: '2px' }}>Activity</h1>
                </header>

                <main className="pulse-scroll">
                    <div className="pulse-section-label">Recent Activity</div>
                    {loading ? (
                        <div style={{textAlign: 'center', padding: '2rem', color: '#888'}}><i className="fas fa-circle-notch fa-spin"></i> Synchronizing...</div>
                    ) : notifications.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '3rem', color: '#666'}}>
                            <i className="fas fa-bell-slash" style={{fontSize: '2rem', marginBottom: '1rem'}}></i>
                            <p>No new activity right now.</p>
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
                            </div>
                        </div>
                    ))}
                </main>
            </div>
        </div>
    );
};

export default ActivityHub;