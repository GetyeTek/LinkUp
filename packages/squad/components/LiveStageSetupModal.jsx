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
    showLiveSetup,
    setShowLiveSetup,
    liveSetupData,
    setLiveSetupData,
    startLiveSession,
    isStartingLive
}) => {
    const [setupMode, setSetupMode] = useState('guided'); // 'guided' | 'manual'
    const [books, setBooks] = useState([]);
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState(null);

    useEffect(() => {
        if (showLiveSetup) {
            supabase.from('books').select('id, title, course_code, toc').order('title').then(({ data }) => {
                if (data) setBooks(data);
            });
        } else {
            // Reset state
            setSelectedBook(null);
            setSelectedNode(null);
            setGenError(null);
        }
    }, [showLiveSetup]);

    if (!showLiveSetup) return null;

    const handlePrepareLecture = async () => {
        if (setupMode === 'guided') {
            if (!selectedBook || !selectedNode) return;
            setIsGenerating(true);
            setGenError(null);
            try {
                const res = await generateMironLecture({ book_id: selectedBook.id, chapter_title: selectedNode.title });
                if (res.error) throw new Error(res.error);
                
                const metaData = { topic: selectedNode.title, course: selectedBook.course_code || selectedBook.title };
                startLiveSession(metaData, res.chunks);
                setShowLiveSetup(false);
            } catch (err) {
                setGenError(err.message || "Failed to generate lecture script.");
            }
            setIsGenerating(false);
        } else {
            startLiveSession(liveSetupData, null);
            setShowLiveSetup(false);
        }
    };

    return (
        <div className="poll-composer-overlay" onClick={() => !isGenerating && setShowLiveSetup(false)}>
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
                        <i className="fas fa-broadcast-tower" style={{ color: 'var(--accent-teal)' }}></i> Host Live Session
                    </h2>
                    <button className="icon-button" style={{ color: '#888' }} onClick={() => setShowLiveSetup(false)} disabled={isGenerating}><i className="fas fa-times"></i></button>
                </header>

                <div className="explorer-tabs">
                    <button className={setupMode === 'guided' ? 'active' : ''} onClick={() => setSetupMode('guided')}>📚 Guided Lecture</button>
                    <button className={setupMode === 'manual' ? 'active' : ''} onClick={() => setSetupMode('manual')}>⚡ Quick Stage</button>
                </div>

                <div className="poll-comp-body" style={{ paddingBottom: '1rem', gap: '1rem' }}>
                    {genError && (
                        <div className="pc-error-banner" style={{ marginBottom: '10px' }}>
                            <i className="fas fa-exclamation-circle"></i> {genError}
                        </div>
                    )}

                    {setupMode === 'guided' ? (
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
                    disabled={isGenerating || isStartingLive || (setupMode === 'guided' ? (!selectedBook || !selectedNode) : (!liveSetupData.topic?.trim() || !liveSetupData.course?.trim()))}
                >
                    {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : (setupMode === 'guided' ? 'Prepare Lecture & Go Live' : 'Go Live')}
                </button>
            </div>
        </div>
    );
};

export default LiveStageSetupModal;