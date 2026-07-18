import React, { useState, useEffect } from 'react';
import { supabase, getAvatarFallback } from '@linkup-platform/sdk-core';
import './DiscoveryScreen.css';

const DiscoveryScreen = ({ currentUser, onClose, onStartChat, onOpenSearch }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDiscovery = async () => {
            const { data } = await supabase.rpc('get_social_discovery', { req_user_id: currentUser.id });
            if (data) setSuggestions(data);
            setLoading(false);
        };
        fetchDiscovery();
    }, [currentUser.id]);

    return (
        <div className="discovery-screen">
            <header className="discovery-header">
                <button className="icon-button" onClick={onClose} style={{color: 'white'}}>
                    <i className="fas fa-chevron-left"></i>
                </button>
                <h2>Discover Peers</h2>
                <button className="icon-button" onClick={onOpenSearch} style={{color: 'white'}}>
                    <i className="fas fa-search"></i>
                </button>
            </header>

            <div className="discovery-body">
                <div className="add-friend-trigger" onClick={onOpenSearch}>
                    <div className="icon-box"><i className="fas fa-search"></i></div>
                    <div>
                        <div style={{fontSize: '1rem'}}>Global Search</div>
                        <div style={{fontSize: '0.75rem', color: '#888', fontWeight: '400'}}>Find users or public groups</div>
                    </div>
                </div>

                {suggestions.length > 0 && (
                    <div className="suggestion-section">
                        <h3 className="section-title" style={{marginBottom: '0.5rem'}}>Suggested Classmates</h3>
                        {suggestions.map(user => (
                            <div className="peer-card" key={user.id} onClick={() => onStartChat(user)}>
                                <img src={user.avatar_url || getAvatarFallback(user.full_name)} onError={(e) => { e.target.onerror = null; e.target.src = getAvatarFallback(user.full_name); }} className="peer-avatar" alt="Avatar" />
                                <div className="peer-info">
                                    <div className="peer-name">{user.full_name}</div>
                                    <div className="peer-meta">
                                        <span className={`peer-tier-badge tier-${user.tier}`}>
                                            {user.tier === 1 ? 'Classmate' : user.tier === 2 ? 'Campus' : 'Global'}
                                        </span>
                                        <span>@{user.username}</span>
                                    </div>
                                </div>
                                <i className="fas fa-paper-plane" style={{color: 'var(--text-secondary-dark)'}}></i>
                            </div>
                        ))}
                    </div>
                )}
                
                {!loading && suggestions.length === 0 && (
                    <div style={{textAlign: 'center', color: '#666', marginTop: '2rem', fontStyle: 'italic'}}>
                        No new suggestions right now.
                    </div>
                )}
            </div>
        </div>
    );
};

export default DiscoveryScreen;