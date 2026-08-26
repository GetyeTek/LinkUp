import React, { useState, useEffect } from 'react';
import { invokePlanMyDay } from '../api.js';
import './PlanMyDayModal.css';

const PlanMyDayModal = ({ isOpen, onClose, onExecuteTask }) => {
    const [loading, setLoading] = useState(true);
    const [planData, setPlanData] = useState(null);
    const [error, setError] = useState(null);
    const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        setError(null);

        invokePlanMyDay()
            .then(res => {
                if (res.success && res.plan) {
                    setPlanData(res.plan);
                } else {
                    throw new Error(res.error || "Failed to synthesize daily plan.");
                }
            })
            .catch(err => {
                console.error("[PlanMyDayModal] Error:", err);
                setError(err.message || "Failed to reach Miron. Please check connection.");
            })
            .finally(() => setLoading(false));
    }, [isOpen]);

    // Prevent background page scroll while fullscreen modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleExecute = (block) => {
        onExecuteTask(block);
        onClose();
    };

    const blocks = planData?.schedule_blocks || [];

    return (
        <div className="pmd-overlay" onClick={onClose}>
            <div className="pmd-ambient-canvas"></div>
            
            <main className="pmd-viewport-frame" onClick={e => e.stopPropagation()}>
                
                {/* Top Minimal Header */}
                <header className="pmd-top-header">
                    <div className="pmd-miron-identity">
                        <div className="pmd-miron-avatar-circle">
                            <img src={mironAvatarUrl} alt="Miron" onError={(e) => { e.target.style.display = 'none'; }} />
                        </div>
                        <div>
                            <div className="pmd-miron-tag-title">Miron Flight Control</div>
                        </div>
                    </div>
                    <button className="pmd-close-screen-btn" onClick={onClose} aria-label="Close">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </header>

                {/* Canvas Scroll Area */}
                <div className="pmd-canvas-scroll-area">
                    {loading ? (
                        <div className="pmd-loading-state">
                            <div className="pmd-orb-pulse">
                                <i className="fa-solid fa-sparkles"></i>
                            </div>
                            <h3 style={{ fontSize: '1.2rem', margin: '1rem 0 0.25rem 0', color: '#fff' }}>Calibrating Flight Plan...</h3>
                            <p style={{ fontSize: '0.85rem', color: '#888', maxWidth: '320px', lineHeight: 1.4 }}>
                                Analyzing semester timeline, syllabus pacing, and personal question accuracy.
                            </p>
                        </div>
                    ) : error ? (
                        <div className="pmd-error-state">
                            <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '2.5rem', color: '#ff5f5f', marginBottom: '1rem' }}></i>
                            <p style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '1.5rem' }}>{error}</p>
                            <button 
                                className="pmd-step-start-btn" 
                                onClick={() => {
                                    setLoading(true);
                                    setError(null);
                                    invokePlanMyDay().then(res => setPlanData(res.plan)).catch(e => setError(e.message)).finally(() => setLoading(false));
                                }}
                            >
                                <i className="fa-solid fa-rotate-right"></i> Retry
                            </button>
                        </div>
                    ) : planData ? (
                        <>
                            {/* Direct Typography Hero Briefing (Unboxed) */}
                            <div className="pmd-hero-briefing-unboxed">
                                <h1 className="pmd-hero-greeting">{planData.greeting_title || 'Good morning!'}</h1>
                                <p className="pmd-hero-speech">{planData.miron_briefing}</p>
                                <div className="pmd-hero-stats-line">
                                    <span>EST. TIME: <strong style={{ color: '#fff' }}>{planData.estimated_total_minutes || 60} MINS</strong></span>
                                    {planData.vibe_tag && (
                                        <>
                                            <span>•</span>
                                            <span className="pmd-vibe-pill">{planData.vibe_tag}</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Integrated Vertical Step-Chain Rail */}
                            <div className="pmd-step-chain-rail">
                                {blocks.map((block, idx) => {
                                    const isFirst = idx === 0;
                                    return (
                                        <div 
                                            key={idx} 
                                            className={`pmd-step-item ${isFirst ? 'is-active' : 'is-locked'}`}
                                        >
                                            <div className="pmd-node-circle">{idx + 1}</div>
                                            <div className="pmd-step-content">
                                                <span className="pmd-step-phase-tag">
                                                    {block.time_label || `PHASE ${idx + 1}`} • {block.duration_minutes || 25} MINS
                                                </span>
                                                <div className="pmd-step-subject-sub">
                                                    {block.course_title || block.course_code} {block.action?.page_number ? `• Page ${block.action.page_number}` : ''}
                                                </div>
                                                <h2 className="pmd-step-topic-title">
                                                    {block.lesson_title || block.chapter_title}
                                                </h2>
                                                {block.focus_summary && (
                                                    <p className="pmd-step-instructions">{block.focus_summary}</p>
                                                )}
                                                <div className="pmd-step-action-row">
                                                    {isFirst ? (
                                                        <button 
                                                            className="pmd-step-start-btn" 
                                                            onClick={() => handleExecute(block)}
                                                        >
                                                            <span>{block.task_type === 'drill' ? 'Start Practice' : 'Start Reading'}</span>
                                                            <i className="fa-solid fa-arrow-right"></i>
                                                        </button>
                                                    ) : (
                                                        <button className="pmd-step-start-btn" disabled>
                                                            <span><i className="fa-solid fa-lock" style={{ marginRight: '4px' }}></i> Up Next</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    ) : null}
                </div>

                {/* Floating Master Launch HUD */}
                {planData && !loading && blocks.length > 0 && (
                    <footer className="pmd-bottom-hud">
                        <div className="pmd-hud-summary">
                            <span className="pmd-hud-lbl">NEXT ACTION</span>
                            <span className="pmd-hud-val">{blocks[0]?.course_title || 'Phase 1'}</span>
                        </div>

                        <button className="pmd-master-launch-btn" onClick={() => handleExecute(blocks[0])}>
                            <span>🚀 Launch Session</span>
                            <i className="fa-solid fa-arrow-right"></i>
                        </button>
                    </footer>
                )}
            </main>
        </div>
    );
};

export default PlanMyDayModal;