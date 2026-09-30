import React from 'react';
import './AnnouncementCard.css';

const AnnouncementCard = ({ event, onAction }) => {
    const isHigh = (event.weight ?? 10) > 80;

    return (
        <div 
            className={`announcement-card ${isHigh ? 'high-priority' : ''}`} 
            id={`feed-item-${event.id}`}
            onClick={() => onAction(event)}
        >
            {event.image_url ? (
                <img src={event.image_url} alt={event.title} className="ac-image" loading="lazy" />
            ) : (
                <div className="ac-fallback-header"></div>
            )}

            <div className="ac-content">
                <div className="ac-tag-row">
                    <span className="ac-tag" style={{ color: event.tag_color || 'var(--accent-teal)' }}>
                        <i className="fa-solid fa-bullhorn" style={{ marginRight: '6px' }}></i>
                        {event.tag_text || 'Campus Announcement'}
                    </span>
                    {isHigh && (
                        <span className="ac-weight-badge">
                            <i className="fa-solid fa-bolt"></i> Priority
                        </span>
                    )}
                </div>

                <h2 className="ac-headline">{event.title}</h2>
                {event.body && <p className="ac-body">{event.body}</p>}

                {event.button_text && (
                    <button 
                        type="button"
                        className="ac-action-btn"
                        style={{ 
                            background: event.button_color ? `${event.button_color}20` : 'rgba(66, 215, 184, 0.15)',
                            borderColor: event.button_color || 'var(--accent-teal)',
                            color: event.button_color || 'var(--accent-teal)'
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAction(event);
                        }}
                    >
                        <span>{event.button_text}</span>
                        <i className="fas fa-arrow-right"></i>
                    </button>
                )}
            </div>
        </div>
    );
};

export default AnnouncementCard;