import React, { useState, useEffect, useRef } from 'react';
import './TelegramCard.css';

const TelegramCard = ({ post }) => {
    const [expanded, setExpanded] = useState(false);
    const cardRef = useRef(null);

    // Auto-collapse logic via Intersection Observer
    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting && expanded) {
                setExpanded(false);
            }
        }, { threshold: 0 });

        if (cardRef.current) observer.observe(cardRef.current);
        return () => observer.disconnect();
    }, [expanded]);

    const isLong = post.full_text && post.full_text.length > 250;

    const hasImage = post.image_url || post.media_url || post.photo_url || post.image || post.thumbnail_url;
    const proxyImgUrl = hasImage 
        ? `https://linkup-gateway.getyeteklu2.workers.dev/telegram-image-proxy?channel=${encodeURIComponent(post.channel)}&id=${encodeURIComponent(post.telegram_id)}` 
        : null;
    
    return (
        <div className="telegram-card" ref={cardRef}>
            {proxyImgUrl && (
                <img 
                    src={proxyImgUrl} 
                    alt="News Media" 
                    className="tc-image" 
                    referrerPolicy="no-referrer" 
                />
            )}
            <div className="tc-content">
                <div className="tc-header">
                    <i className="fa-solid fa-satellite-dish"></i> GibiNews
                </div>
                <div className={`tc-text-wrapper ${expanded ? 'expanded' : (isLong ? 'collapsed' : '')}`}>
                    <div className="tc-text">{post.full_text}</div>
                    {!expanded && isLong && <div className="tc-fade"></div>}
                </div>
                {!expanded && isLong && (
                    <button className="tc-show-more" onClick={() => setExpanded(true)}>
                        Show more <i className="fas fa-chevron-down"></i>
                    </button>
                )}
                <div className="tc-footer">
                    <div className="tc-reference">
                        <i className="fa-solid fa-quote-left" style={{fontSize: '0.6rem'}}></i>
                        Ref: {post.channel === 'tikvahuniversity' ? 'Tikvah University' : post.channel}
                    </div>
                    <div className="tc-footer-bottom">
                        <a href={post.post_url} target="_blank" rel="noreferrer" className="tc-link">
                            <i className="fab fa-telegram"></i> Full Post
                        </a>
                        <span className="tc-time">{new Date(post.telegram_timestamp).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TelegramCard;