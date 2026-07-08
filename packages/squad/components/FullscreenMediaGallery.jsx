import React from 'react';
import './FullscreenMediaGallery.css';

const FullscreenMediaGallery = ({ fullscreenGallery, setFullscreenGallery }) => {
    if (!fullscreenGallery) return null;

    return (
        <div className="fullscreen-gallery-overlay" onClick={() => setFullscreenGallery(null)}>
            <button className="fg-close" onClick={() => setFullscreenGallery(null)}>
                <i className="fas fa-chevron-down"></i>
            </button>
            
            {fullscreenGallery.items.length > 1 && (
                <button className="fg-nav prev" onClick={(e) => { e.stopPropagation(); setFullscreenGallery(p => ({ ...p, index: (p.index - 1 + p.items.length) % p.items.length })); }}>
                    <i className="fas fa-chevron-left"></i>
                </button>
            )}
            
            <div className="fg-content" onClick={e => e.stopPropagation()}>
                {fullscreenGallery.items[fullscreenGallery.index].type.startsWith('video/') ? (
                    <video src={fullscreenGallery.items[fullscreenGallery.index].url} controls autoPlay className="fg-item" />
                ) : (
                    <img src={fullscreenGallery.items[fullscreenGallery.index].url} alt="Fullscreen Media" className="fg-item" />
                )}
            </div>

            {fullscreenGallery.items.length > 1 && (
                <button className="fg-nav next" onClick={(e) => { e.stopPropagation(); setFullscreenGallery(p => ({ ...p, index: (p.index + 1) % p.items.length })); }}>
                    <i className="fas fa-chevron-right"></i>
                </button>
            )}
            
            {fullscreenGallery.items.length > 1 && (
                <div className="fg-counter">
                    {fullscreenGallery.index + 1} / {fullscreenGallery.items.length}
                </div>
            )}
        </div>
    );
};

export default FullscreenMediaGallery;