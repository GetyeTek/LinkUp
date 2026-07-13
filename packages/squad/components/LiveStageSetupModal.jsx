import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
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
    onDevInject,
    onInviteMiron,
    isStartingLive
}) => {
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState(null);

    // Dev Sandbox States
    const [isDevMode, setIsDevMode] = useState(false);
    const [devPayload, setDevPayload] = useState('{\n  "action": "draw",\n  "elements": [\n    {\n      "id": "1",\n      "text": "Thermodynamics",\n      "type": "title",\n      "x": "50%",\n      "y": "30%",\n      "fontSize": "2.5rem",\n      "color": "#42d7b8",\n      "animation": "pop-in",\n      "fontWeight": "bold"\n    },\n    {\n      "id": "2",\n      "text": "The branch of physical science that deals with the relations between heat and other forms of energy.",\n      "type": "body",\n      "x": "50%",\n      "y": "45%",\n      "fontSize": "1rem",\n      "color": "#e0e0e0",\n      "animation": "fade-in",\n      "fontFamily": "serif"\n    }\n  ]\n}');

    useEffect(() => {
        if (show) {
            if (mode === 'miron') {
                supabase.from('books').select('id, title, course_code, toc').order('title').then(({ data }) => {
                    if (data) setBooks(data);
                });
            }
        } else {
            // Reset state
            setSelectedBook(null);
            setSelectedNode(null);
            setGenError(null);
        }
    }, [show, mode]);

    if (!show) return null;

    const handlePrepareLecture = async () => {
        if (isDevMode && mode === 'miron' && onDevInject) {
            try {
                const parsed = JSON.parse(devPayload);
                onDevInject(parsed);
            } catch (e) {
                setGenError("Invalid JSON Payload: " + e.message);
            }
            return;
        }

        if (mode === 'miron') {
            if (!selectedBook || !selectedNode) return;
            setIsGenerating(true);
            setGenError(null);
            try {
                const res = await generateMironLecture({ book_id: selectedBook.id, chapter_title: selectedNode.title });
                if (res.error) throw new Error(res.error);
                
                if (onInviteMiron) {
                    await onInviteMiron(res.chunks, res.raw_text);
                }
                onClose();
            } catch (err) {
                setGenError(err.message || "Failed to generate lecture script.");
            }
            setIsGenerating(false);
        } else {
            onStartLive(liveSetupData, null);
            onClose();
        }
    };

    const isChildNode = selectedNode && (!selectedNode.children || selectedNode.children.length === 0);

    return (
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
                        {mode === 'miron' && (
                            <button 
                                className={`icon-button ${isDevMode ? 'active' : ''}`} 
                                style={{ color: isDevMode ? 'var(--accent-teal)' : '#888', background: isDevMode ? 'rgba(66, 215, 184, 0.1)' : 'transparent', borderRadius: '8px' }} 
                                onClick={() => setIsDevMode(!isDevMode)} 
                                title="Dev Mode: Board Injector"
                            >
                                <i className="fas fa-bug"></i>
                            </button>
                        )}
                        <button className="icon-button" style={{ color: '#888' }} onClick={onClose} disabled={isGenerating}><i className="fas fa-times"></i></button>
                    </div>
                </header>

                <div className="poll-comp-body" style={{ paddingBottom: '1rem', gap: '1rem' }}>
                    {genError && (
                        <div className="pc-error-banner" style={{ marginBottom: '10px' }}>
                            <i className="fas fa-exclamation-circle"></i> {genError}
                        </div>
                    )}

                    {mode === 'miron' && isDevMode ? (
                        <div className="pc-group" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <label className="pc-label">Dev: Inject Board Payload</label>
                            <textarea
                                className="pc-input dev-payload-textarea"
                                value={devPayload}
                                onChange={e => setDevPayload(e.target.value)}
                                style={{ flex: 1, minHeight: '260px', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical', lineHeight: '1.4' }}
                                spellCheck="false"
                            />
                        </div>
                    ) : mode === 'miron' ? (
                        <>
                            {!selectedBook ? (
                                <div className="books-grid">
                                    {books.map(b => (
                                        <div key={b.id} className="book-selector-card" onClick={() => setSelectedBook(b)}>
                                            <div className="book-icon-thumb"><i className="fas fa-book"></i></div>
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
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                                    {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'CS'].map(c => (
                                        <div key={c} className={`qa-pill ${liveSetupData.course === c ? 'active' : ''}`} onClick={() => setLiveSetupData({...liveSetupData, course: c})}>{c}</div>
                                    ))}
                                </div>
                                <input type="text" className="pc-input" placeholder="Or type custom course..." value={liveSetupData.course} onChange={e => setLiveSetupData({...liveSetupData, course: e.target.value})} />
                            </div>
                        </div>
                    )}
                </div>

                <button 
                    className="poll-submit-btn" 
                    onClick={handlePrepareLecture} 
                    disabled={isGenerating || isStartingLive || (!isDevMode && mode === 'miron' ? (!selectedBook || !isChildNode) : (!isDevMode && (!liveSetupData?.topic?.trim() || !liveSetupData?.course?.trim())))}
                >
                    {isDevMode ? 'Simulate Board' : (isStartingLive || isGenerating ? <i className="fas fa-circle-notch fa-spin"></i> : (mode === 'miron' ? 'Prepare Lecture & Invite' : 'Go Live'))}
                </button>
            </div>
        </div>
    );
};

export default LiveStageSetupModal;