import React from 'react';
import './NoteCard.css';

const NoteCard = ({ m, activeMenu, setActiveMenu, handleDownload, formatTime }) => {
    const isMenuOpen = activeMenu?.msg?.id === m.id;
    
    return (
        <div 
            className="note-card"
            style={{ zIndex: isMenuOpen ? 100 : 1 }}
            onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                    setActiveMenu(null);
                    return;
                }
                
                let x = e.clientX || (e.touches && e.touches[0].clientX);
                let y = e.clientY || (e.touches && e.touches[0].clientY);
                
                if (!x || !y) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    x = rect.left + rect.width / 2;
                    y = rect.top + rect.height / 2;
                }
                
                const menuW = 140;
                const menuH = 100;
                
                if (x + menuW > window.innerWidth - 20) x = window.innerWidth - menuW - 20;
                if (y + menuH > window.innerHeight - 80) y = window.innerHeight - menuH - 80;
                if (y < 80) y = 80;
                
                setActiveMenu({ msg: m, x, y });
            }}
        >
            {m.text && <div className="note-text">{m.text}</div>}
    
            {m.attachments?.map((att, i) => (
                <div key={i} className="note-attachment" style={{ width: '100%' }}>
                    {att.type === 'book_quote' ? (
                        <div className="chat-book-quote-card" style={{ marginTop: '6px' }}>
                            <div className="cbq-topbar">
                                <div className="cbq-book-info">
                                    <span className="cbq-type-badge"><i className="fas fa-bookmark"></i> TEXTBOOK EXCERPT</span>
                                    <span className="cbq-title">{att.book_title || att.course_code || 'Textbook'}</span>
                                </div>
                                <span className="cbq-page-pill">Page {att.page_number}</span>
                            </div>
                            <div className="cbq-body">
                                <p className="cbq-text">{att.text}</p>
                            </div>
                            {att.book_id && (
                                <div 
                                    className="cbq-footer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.dispatchEvent(new CustomEvent('navigate-tab', {
                                            detail: {
                                                tab: 'study',
                                                payload: {
                                                    action: 'resume_book',
                                                    book_id: att.book_id,
                                                    title: att.book_title,
                                                    course_code: att.course_code,
                                                    page: att.page_number
                                                }
                                            }
                                        }));
                                    }}
                                >
                                    <span>Read in Book</span>
                                    <i className="fas fa-arrow-right"></i>
                                </div>
                            )}
                        </div>
                    ) : att.type && att.type.startsWith('image/') ? (
                        <img src={att.url} alt="Note Attachment" className="note-image" />
                    ) : (
                        <div className="note-file-box" onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.name); }}>
                            <div className="note-file-icon"><i className="fas fa-file"></i></div>
                            <div className="note-file-info">
                                <span className="note-file-name">{att.name}</span>
                                <span className="note-file-size">{(att.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                        </div>
                    )}
                </div>
            ))}
            <span className="note-time">{formatTime(m.created_at)}</span>
        </div>
    );
};

export default NoteCard;