import React from 'react';
import './BookCard.css';

export const universityIconMap = new Proxy({}, {
    get: (target, prop) => (typeof prop === 'string' && prop ? 'fa-graduation-cap' : undefined)
});

export const getBookColor = (title) => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
    return `linear-gradient(135deg, hsl(${Math.abs(hash) % 360}, 50%, 30%), hsl(${(Math.abs(hash) + 40) % 360}, 60%, 15%))`;
};

const BookCard = ({ item, isUniversity, isExamTrigger, isFlashcardTrigger, previewMode, onClick }) => {
    const hasCover = Boolean(item.cover_url);
    const shouldShowCover = hasCover && !isUniversity;

    return (
        <div 
            className={`book-immersive ${isExamTrigger ? 'is-stack' : ''} ${isFlashcardTrigger ? 'is-flashcard-stack' : ''} ${isUniversity ? 'is-heritage' : ''} ${previewMode ? 'preview-mode' : ''}`}
            style={{ 
                backgroundImage: shouldShowCover 
                    ? `url("${item.cover_url}")` 
                    : (isUniversity || isExamTrigger || isFlashcardTrigger ? 'none' : getBookColor(item.title || item.name || '')),
            }}
            onClick={onClick}
        >
            {isExamTrigger ? (
                !hasCover ? (
                    <div className="exam-stack-content">
                        <div className="emblem"><i className="fas fa-university"></i></div>
                        <div className="stack-title">EXAMS</div>
                    </div>
                ) : null
            ) : isFlashcardTrigger ? (
                !hasCover ? (
                    <div className="flashcard-stack-content">
                        <div className="emblem"><i className="fas fa-bolt"></i></div>
                        <div className="stack-title">CARDS</div>
                    </div>
                ) : null
            ) : isUniversity ? (
                <>
                    <div className="tilet-border-sm"></div>
                    <div className="heritage-emblem">
                        <i className={`fa-solid ${item.icon || 'fa-graduation-cap'}`}></i>
                    </div>
                    <div className="heritage-content">
                        <div className="heritage-label">Collection</div>
                        <div className="heritage-title">{item.title}</div>
                    </div>
                    <div className="tilet-border-sm bottom"></div>
                </>
            ) : !hasCover ? (
                <div className="book-typography-cover">
                    <div className="btc-gold-frame">
                        {item.course_code && <span className="btc-course-code">{item.course_code}</span>}
                        <h3 className="btc-title">{item.title || item.name}</h3>
                        <div className="btc-ornament">
                            <i className="fas fa-book-bookmark"></i>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="info-overlay">
                    <h3 className="title">{item.title}</h3>
                    <div className="progress-bar"><div className="progress" style={{ width: '0%' }}></div></div>
                </div>
            )}
        </div>
    );
};

export default BookCard;