import React from 'react';
import './ChatMediaGallery.css';

export const getFileIconProps = (filename) => {
    if (!filename) return { icon: 'fa-file', color: 'var(--accent-teal)' };
    const ext = filename.split('.').pop().toLowerCase();
    switch(ext) {
        case 'pdf': return { icon: 'fa-file-pdf', color: '#ff4757' };
        case 'doc': case 'docx': return { icon: 'fa-file-word', color: '#3498db' };
        case 'xls': case 'xlsx': case 'csv': return { icon: 'fa-file-excel', color: '#2ecc71' };
        case 'ppt': case 'pptx': return { icon: 'fa-file-powerpoint', color: '#e67e22' };
        case 'txt': return { icon: 'fa-file-lines', color: '#95a5a6' };
        case 'epub': return { icon: 'fa-book', color: '#9b59b6' };
        case 'zip': case 'rar': case '7z': return { icon: 'fa-file-zipper', color: '#f1c40f' };
        default: return { icon: 'fa-file', color: 'var(--accent-teal)' };
    }
};

const ChatMediaGallery = ({ attachments, setFullscreenGallery, handleDownload }) => {
    if (!attachments || attachments.length === 0) return null;
    
    const mediaItems = attachments.filter(a => a.type.startsWith('image/') || a.type.startsWith('video/'));
    const docItems = attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/'));
    const hasMoreMedia = mediaItems.length > 4;
    const displayMedia = mediaItems.slice(0, 4);

    return (
        <>
            {displayMedia.length > 0 && (
                <div className="media-gallery-grid" data-count={displayMedia.length} data-more={hasMoreMedia.toString()}>
                    {displayMedia.map((att, i) => {
                        const isLast = i === 4;
                        return (
                            <div key={i} className="gallery-item" onClick={(e) => { 
                                e.stopPropagation(); 
                                setFullscreenGallery({ items: mediaItems, index: i });
                            }}>
                                {att.type.startsWith('video/') ? (
                                    <video src={att.url} />
                                ) : (
                                    <img src={att.url} alt="Shared Image" />
                                )}
                                {isLast && hasMoreMedia && (
                                    <div className="gallery-more-overlay" data-more-count={(mediaItems.length - 4).toString()}></div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            
            {docItems.map((att, i) => {
                const iconData = getFileIconProps(att.name);
                return (
                <div key={i} className="bubble-attachment" style={{marginTop: i === 0 && displayMedia.length === 0 ? '0' : '4px'}}>
                    <div className="bubble-file-box" onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.name); }}>
                        <div className="bubble-file-icon" style={{color: iconData.color}}><i className={`fas ${iconData.icon}`}></i></div>
                        <div className="bubble-file-info">
                            <span className="bubble-file-name">{att.name}</span>
                            <span style={{fontSize: '0.65rem', color: '#888'}}>{(att.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                    </div>
                </div>
            )})}
        </>
    );
};

export default ChatMediaGallery;