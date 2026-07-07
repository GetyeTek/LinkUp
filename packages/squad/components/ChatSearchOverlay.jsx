import React, { useState } from 'react';
import './ChatSearchOverlay.css';

const ChatSearchOverlay = ({ isSearchActive, setIsSearchActive, messages, scrollToMessage, formatTime, resolveSenderName }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
    const [showSearchList, setShowSearchList] = useState(false);

    if (!isSearchActive) return null;

    const executeSearch = (query) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setSearchResults([]);
            setCurrentSearchIndex(-1);
            return;
        }
        const term = query.toLowerCase();
        const results = messages.filter(m => m.text && m.text.toLowerCase().includes(term)).reverse();
        setSearchResults(results);
        if (results.length > 0) {
            setCurrentSearchIndex(0);
            scrollToMessage(results[0].id);
        } else {
            setCurrentSearchIndex(-1);
        }
    };

    const searchOlder = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex + 1;
        if (newIdx >= searchResults.length) newIdx = 0;
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const searchNewer = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex - 1;
        if (newIdx < 0) newIdx = searchResults.length - 1;
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const getSnippet = (text, query) => {
        if (!query) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + query.length + 60);
        let snippet = text.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';
        return snippet;
    };

    return (
        <>
            <header className="chat-search-header">
                <button className="icon-button back-btn" onClick={() => { setIsSearchActive(false); setSearchQuery(''); }}>
                    <i className="fas fa-arrow-left"></i>
                </button>
                <div className="chat-search-input-wrapper">
                    <input 
                        type="text" 
                        className="chat-search-input" 
                        value={searchQuery} 
                        onChange={(e) => executeSearch(e.target.value)} 
                        placeholder="Search..." 
                        autoFocus 
                    />
                    <span className="search-count">
                        {searchResults.length > 0 ? `${currentSearchIndex + 1}/${searchResults.length}` : '0/0'}
                    </span>
                </div>
                <div className="chat-search-nav">
                    <button onClick={searchOlder} disabled={searchResults.length === 0}><i className="fas fa-chevron-up"></i></button>
                    <button onClick={searchNewer} disabled={searchResults.length === 0}><i className="fas fa-chevron-down"></i></button>
                    <button className="snippet-btn" onClick={() => setShowSearchList(true)} disabled={searchResults.length === 0}><i className="fas fa-list"></i></button>
                </div>
            </header>

            {showSearchList && (
                <div className="chat-search-modal-overlay" onClick={() => setShowSearchList(false)}>
                    <div className="chat-search-modal" onClick={e => e.stopPropagation()}>
                        <div className="csm-header">
                            <h3>Search Results</h3>
                            <button className="icon-button" onClick={() => setShowSearchList(false)}><i className="fas fa-times"></i></button>
                        </div>
                        <div className="csm-body">
                            {searchResults.length === 0 ? (
                                <div className="csm-empty">No matching records found.</div>
                            ) : searchResults.map((m, idx) => (
                                <div key={m.id} className="csm-snippet-card" onClick={() => {
                                    setCurrentSearchIndex(idx);
                                    setShowSearchList(false);
                                    scrollToMessage(m.id);
                                }}>
                                    <div className="csm-meta">
                                        <span>{resolveSenderName(m.sender_id)}</span>
                                        <span>{formatTime(m.created_at)}</span>
                                    </div>
                                    <div className="csm-text">
                                        {getSnippet(m.text, searchQuery).split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
                                            part.toLowerCase() === searchQuery.toLowerCase() ? 
                                            <span key={i} className="csm-highlight">{part}</span> : part
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default ChatSearchOverlay;