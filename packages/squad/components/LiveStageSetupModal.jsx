import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import { generateMironLecture } from '../api.js';
import './LiveStageSetupModal.css';

const TOCNode = ({ node, selectedNode, setSelectedNode, depth = 0 }) => {
    const [isOpen, setIsOpen] = useState(false);
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedNode?.title === node.title;

    return (
        <div className="toc-node-wrapper">
            <div 
                className={`toc-node ${isSelected ? 'selected' : ''}`} 
                onClick={() => {
                    if (hasChildren) setIsOpen(!isOpen);
                    setSelectedNode(node);
                }}
            >
                <div className="toc-node-left">
                    {hasChildren ? <i className={`fas fa-chevron-right ${isOpen ? 'open' : ''}`}></i> : <i className="fas fa-circle" style={{fontSize: '4px'}}></i>}
                    <span>{node.title}</span>
                </div>
            </div>
            {hasChildren && isOpen && (
                <div className="toc-children">
                    {node.children.map((child, i) => (
                        <TOCNode key={i} node={child} selectedNode={selectedNode} setSelectedNode={setSelectedNode} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

const LiveStageSetupModal = ({
    mode = 'host',
    show,
    onClose,
    liveSetupData,
    setLiveSetupData,
    onStartLive,
    onInviteMiron,
    isStartingLive,
    conversation_id
}) => {
    const { user: userProfile } = usePlatform();
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState(null);

    useEffect(() => {
        if (show) {
            if (mode === 'miron') {
                const hasEnoughCredits = (userProfile?.linkoin_balance || 0) >= 20;
                if (!userProfile?.is_pro && !hasEnoughCredits) {
                    window.dispatchEvent(new CustomEvent('open-premium-modal'));
                    onClose();
                    return;
                }
                supabase.from('books').select('id, title, course_code, toc, cover_url').eq('is_published', true).order('title').then(({ data }) => {
                    if (data) setBooks(data);
                });
            }
        } else {
            setSelectedBook(null);
            setSelectedNode(null);
            setGenError(null);
        }
    }, [show, mode, userProfile?.is_pro, userProfile?.linkoin_balance]);

    if (!show) return null;

    const handlePrepareLecture = async () => {
        if (mode === 'miron' && !userProfile?.is_pro && (userProfile?.linkoin_balance || 0) < 20) {
            setGenError("Insufficient Credits. Miron group live hosting requires 20 LinkUp Credits per session. Upgrade to LinkUp Gold for unlimited sessions.");
            return;
        }

        if (mode === 'miron') {
            if (!selectedBook || !selectedNode) return;
            setIsGenerating(true);
            setGenError(null);
            try {
                // Batch 1: Generate the first 50 chunks (approx. 15s)
                const res = await generateMironLecture({ 
                    book_id: selectedBook.id, 
                    chapter_title: selectedNode.title,
                    conversation_id 
                });
                if (res.error) throw new Error(res.error);
                
                // Instantly boot Miron on stage with Batch 1 chunks
                if (onInviteMiron) {
                    await onInviteMiron(res.chunks, res.raw_text);
                }
                onClose();

                // Batch 2: Background process generates chunks 51-100 immediately
                generateMironLecture({ 
                    book_id: selectedBook.id, 
                    chapter_title: selectedNode.title,
                    conversation_id 
                }).catch(err => {
                    console.error("[SetupModal] Background Batch 2 generation failed:", err);
                });

            } catch (err) {
                const lower = String(err.message || '').toLowerCase();
                if (lower.includes('api key') || lower.includes('no_api_keys') || lower.includes('gemini') || lower.includes('capacity')) {
                    setGenError("Miron is currently operating at maximum capacity across campus networks. Please try again in a few moments.");
                } else if (lower.includes('insufficient_credits')) {
                    setGenError("Insufficient LinkUp Credits. Upgrade to LinkUp Gold for unlimited sessions.");
                } else {
                    setGenError(err.message || "Failed to generate lecture script.");
                }
            }
            setIsGenerating(false);
        } else {
            onStartLive(liveSetupData, null);
            onClose();
        }
    };

    const isChildNode = selectedNode && (!selectedNode.children || selectedNode.children.length === 0);

    return createPortal(
        <div className="poll-composer-overlay" style={{ zIndex: 100000 }} onClick={() => !isGenerating && onClose()}>
            <div className="poll-composer-sheet" style={{position: 'relative'}} onClick={e => e.stopPropagation()}>
                
                {isGenerating && (
                    <div className="ls-preparing-overlay">
                        <i className="fas fa-satellite-dish fa-spin"></i>
                        <h3>Miron is Parsing...</h3>
                        <p>Scanning the textbook and compiling a conversational peer-to-peer lecture.</p>
                    </div>
                )}

                <header className="poll-comp-header" style={{ marginBottom: '1rem' }}>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {mode === 'miron' ? (
                            <><i className="fas fa-sparkles" style={{ color: 'var(--accent-teal)' }}></i> Invite Miron</>
                        ) : (
                            <><i className="fas fa-broadcast-tower" style={{ color: 'var(--accent-teal)' }}></i> Host Live Session</>
                        )}
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button className="icon-button" style={{ color: '#888' }} onClick={onClose} disabled={isGenerating}><i className="fas fa-times"></i></button>
                    </div>
                </header>

                <div className="poll-comp-body" style={{ paddingBottom: '1rem', gap: '1rem' }}>
                    {genError && (
                        <div className="pc-error-banner" style={{ marginBottom: '10px' }}>
                            <i className="fas fa-exclamation-circle"></i> {genError}
                        </div>
                    )}

                    {mode === 'miron' ? (
                        <>
                            {!selectedBook ? (
                                <div className="books-grid">
                                    {books.map(b => (
                                        <div key={b.id} className="book-selector-card" onClick={() => setSelectedBook(b)}>
                                            <div className="book-icon-thumb">
                                                {b.cover_url ? (
                                                    <img src={b.cover_url} alt="" className="book-thumb-cover-img" />
                                                ) : (
                                                    <i className="fas fa-book"></i>
                                                )}
                                            </div>
                                            <div className="book-meta-info">
                                                <h4>{b.title}</h4>
                                                <p>{b.course_code || 'General'}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {books.length === 0 && <p style={{color: '#888', gridColumn: 'span 2', textAlign: 'center', margin: '2rem 0'}}>Loading library...</p>}
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
                                        <button className="icon-button" style={{ background: 'var(--surface-dark)', width: '30px', height: '30px', borderRadius: '8px', fontSize: '0.9rem' }} onClick={() => { setSelectedBook(null); setSelectedNode(null); }}>
                                            <i className="fas fa-arrow-left"></i>
                                        </button>
                                        <span style={{ fontWeight: 600, color: 'var(--accent-teal)' }}>{selectedBook.title}</span>
                                    </div>
                                    <div className="toc-tree-container">
                                        {(selectedBook.toc || []).map((node, i) => (
                                            <TOCNode key={i} node={node} selectedNode={selectedNode} setSelectedNode={setSelectedNode} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            <div className="pc-group">
                                <label className="pc-label">Main Topic</label>
                                <input type="text" className="pc-input" placeholder="e.g. Thermodynamics Review" value={liveSetupData.topic} onChange={e => setLiveSetupData({...liveSetupData, topic: e.target.value})} />
                            </div>
                            <div className="pc-group">
                                <label className="pc-label">Course</label>
                                <div className="ls-course-pills-wrap">
                                    {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Computer Science', 'General'].map(c => (
                                        <div 
                                            key={c} 
                                            className={`ls-course-pill ${liveSetupData.course === c ? 'active' : ''}`} 
                                            onClick={() => setLiveSetupData({...liveSetupData, course: c})}
                                        >
                                            <i className={`fas ${
                                                c === 'Physics' ? 'fa-bolt' :
                                                c === 'Chemistry' ? 'fa-flask' :
                                                c === 'Mathematics' ? 'fa-square-root-variable' :
                                                c === 'Biology' ? 'fa-dna' :
                                                c === 'Computer Science' ? 'fa-laptop-code' :
                                                'fa-book-open'
                                            }`}></i>
                                            <span>{c}</span>
                                        </div>
                                    ))}
                                </div>
                                <input type="text" className="pc-input" placeholder="Or type custom course name..." value={liveSetupData.course} onChange={e => setLiveSetupData({...liveSetupData, course: e.target.value})} />
                            </div>
                        </div>
                    )}
                </div>

                <button 
                    className="poll-submit-btn" 
                    onClick={handlePrepareLecture} 
                    disabled={isGenerating || isStartingLive || (mode === 'miron' ? (!selectedBook || !isChildNode) : (!liveSetupData?.topic?.trim() || !liveSetupData?.course?.trim()))}
                >
                    {isStartingLive || isGenerating ? <i className="fas fa-circle-notch fa-spin"></i> : (mode === 'miron' ? 'Prepare Lecture & Invite' : 'Go Live')}
                </button>
            </div>
        </div>,
        document.body
    );
};

export default LiveStageSetupModal;