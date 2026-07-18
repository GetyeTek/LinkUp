import React, { useState, useEffect } from 'react';
import { supabase, getAvatarFallback } from '@linkup-platform/sdk-core';
import './GlobalSearchOverlay.css';

const GlobalSearchOverlay = ({ currentUser, onClose, onSelectUser, onSelectGroup }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            return;
        }
        const fetchSearch = async () => {
            setIsSearching(true);
            const { data, error } = await supabase.rpc('global_network_search', { search_term: query.trim(), req_user_id: currentUser.id });
            if (data) setResults(data);
            setIsSearching(false);
        };
        const timer = setTimeout(fetchSearch, 400); // Debounce typing
        return () => clearTimeout(timer);
    }, [query, currentUser.id]);

    return (
        <div className="global-search-overlay">
            <header className="gs-header">
                <button className="icon-button" onClick={onClose}><i className="fas fa-chevron-left"></i></button>
                <div className="gs-input-box">
                    <i className="fas fa-search"></i>
                    <input 
                        type="text" 
                        className="gs-input" 
                        placeholder="Search names, usernames, or groups..." 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                    {isSearching && <i className="fas fa-circle-notch fa-spin" style={{color: 'var(--accent-teal)'}}></i>}
                </div>
            </header>
            <div className="gs-body">
                {query.trim() && results.length === 0 && !isSearching && (
                    <div className="not-found-state">
                        <i className="fas fa-search-minus" style={{fontSize: '2rem', display: 'block', marginBottom: '10px'}}></i>
                        No users or groups found matching "{query}".
                    </div>
                )}
                {results.map(res => (
                    <div className="gs-result-item" key={res.id + res.type} onClick={() => {
                        onClose();
                        if (res.type === 'user') onSelectUser({ id: res.id, full_name: res.title, username: res.subtitle, avatar_url: res.avatar_url });
                        else onSelectGroup({ conversation_id: res.id, type: 'group', title: res.title, metadata: res.metadata, is_preview: !res.is_member });
                    }}>
                        {res.type === 'user' ? (
                            <img src={res.avatar_url || getAvatarFallback(res.title)} onError={(e) => { e.target.onerror = null; e.target.src = getAvatarFallback(res.title); }} className="gs-avatar" alt="Avatar" />
                        ) : (
                            <div className="gs-icon-avatar"><i className="fas fa-users"></i></div>
                        )}
                        <div className="gs-info">
                            <div className="gs-name">{res.title}</div>
                            <div className="gs-meta">{res.type === 'user' ? `@${res.subtitle}` : res.subtitle}</div>
                        </div>
                        <div className={`gs-status ${!res.is_member ? 'unjoined' : ''}`}>
                            {res.type === 'user' ? (res.is_member ? 'Connected' : 'Connect') : (res.is_member ? 'Joined' : 'Join')}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default GlobalSearchOverlay;