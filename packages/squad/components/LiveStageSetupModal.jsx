import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
    const [devPayload, setDevPayload] = useState(JSON.stringify({
      action: "draw",
      elements: [
        {
          id: "bg-accent",
          text: "",
          type: "shape",
          x: "50%",
          y: "50%",
          animation: "fade-in",
          customStyles: {
            width: "90vw",
            height: "50vh",
            background: "radial-gradient(circle, rgba(155, 89, 182, 0.12) 0%, transparent 70%)",
            borderRadius: "50%",
            zIndex: "0"
          }
        },
        {
          id: "title",
          text: "Maxwell's Equations",
          type: "title",
          x: "50%",
          y: "20%",
          fontSize: "2.5rem",
          color: "#42d7b8",
          animation: "pop-in",
          fontWeight: "800",
          fontFamily: "serif",
          customStyles: {
            textShadow: "0 10px 30px rgba(66, 215, 184, 0.6)",
            letterSpacing: "2px",
            zIndex: "2"
          }
        },
        {
          id: "subtitle",
          text: "The Foundation of Electromagnetism",
          type: "body",
          x: "50%",
          y: "30%",
          fontSize: "1rem",
          color: "#ffab40",
          animation: "slide-up",
          fontWeight: "600",
          fontFamily: "sans-serif",
          customStyles: {
            textTransform: "uppercase",
            letterSpacing: "3px",
            zIndex: "2"
          }
        },
        {
          id: "equation-card",
          text: "∇ ⋅ E = ρ / ε₀\n∇ ⋅ B = 0\n∇ × E = -∂B/∂t\n∇ × B = μ₀(J + ε₀∂E/∂t)",
          type: "code",
          x: "50%",
          y: "55%",
          fontSize: "1.1rem",
          color: "#fff",
          animation: "pop-in",
          fontWeight: "bold",
          customStyles: {
            fontFamily: "monospace",
            background: "rgba(0, 0, 0, 0.6)",
            border: "1px solid rgba(66, 215, 184, 0.4)",
            padding: "1.5rem",
            borderRadius: "16px",
            boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
            lineHeight: "1.8",
            textAlign: "left",
            zIndex: "2",
            whiteSpace: "pre"
          }
        },
        {
          id: "footnote",
          text: "Notice how the equations unify electricity and magnetism into a single electromagnetic tensor.",
          type: "body",
          x: "50%",
          y: "85%",
          fontSize: "0.85rem",
          color: "#a0a0a0",
          animation: "fade-in",
          fontStyle: "italic",
          customStyles: {
            maxWidth: "400px",
            lineHeight: "1.6",
            zIndex: "2"
          }
        }
      ]
    }, null, 2));

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
        </div>,
        document.body
    );
};

export default LiveStageSetupModal;