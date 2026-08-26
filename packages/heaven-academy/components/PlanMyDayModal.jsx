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

    if (!isOpen) return null;

    const handleExecute = (block) => {
        onExecuteTask(block);
        onClose();
    };

    return (
        <div className="pmd-overlay" onClick={onClose}>
            <div className="pmd-card" onClick={e => e.stopPropagation()}>
                
                <header className="pmd-header">
                    <div className="pmd-brand">
                        <img src={mironAvatarUrl} alt="Miron" className="pmd-miron-avatar" onError={(e) => { e.target.style.display = 'none'; }} />
                        <div>
                            <h2>Plan My Day</h2>
                            <span>Miron Academic Flight Control</span>
                        </div>
                    </div>
                    <button className="pmd-close-btn" onClick={onClose} aria-label="Close">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </header>

                <div className="pmd-body">
                    {loading ? (
                        <div className="pmd-loading-state">
                            <div className="pmd-orb-pulse">
                                <i className="fa-solid fa-sparkles"></i>
                            </div>
                            <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Miron is Calibrating...</h3>
                            <p style={{ fontSize: '0.82rem', color: '#888', maxWidth: '300px', lineHeight: 1.4 }}>
                                Analyzing semester calendar, syllabus pacing, and personal question accuracy.
                            </p>
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: '#ff5f5f' }}>
                            <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '2.5rem', marginBottom: '1rem' }}></i>
                            <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>{error}</p>
                            <button 
                                className="pmd-single-start-btn" 
                                style={{ margin: '0 auto', background: '#ff5f5f', color: '#fff' }}
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
                            {/* Miron Hero Briefing */}
                            <div className="pmd-hero-briefing">
                                <div className="pmd-greeting-title">{planData.greeting_title}</div>
                                <div className="pmd-briefing-text">{planData.miron_briefing}</div>
                                <div className="pmd-meta-ribbon">
                                    <span className="pmd-vibe-badge">{planData.vibe_tag || '⚡ Focused Sprint'}</span>
                                    <span className="pmd-duration-tag">
                                        <i className="fa-regular fa-clock"></i> ~{planData.estimated_total_minutes || 60}m Total
                                    </span>
                                </div>
                            </div>

                            {/* Visual Timeline Cards */}
                            <div className="pmd-timeline">
                                {(planData.schedule_blocks || []).map((block, idx) => (
                                    <div key={idx} className="pmd-phase-card">
                                        <div className="pmd-phase-header">
                                            <span className="pmd-phase-label">
                                                <i className={`fa-solid ${block.task_type === 'drill' ? 'fa-bolt' : block.task_type === 'read' ? 'fa-book-open' : 'fa-sparkles'}`}></i>
                                                {block.time_label || `Phase ${idx + 1}`}
                                            </span>
                                            <span className="pmd-phase-time">{block.duration_minutes}m</span>
                                        </div>

                                        <div className="pmd-phase-content">
                                            <span className="pmd-course-code">{block.course_code} • {block.course_title}</span>
                                            <div className="pmd-lesson-title">{block.lesson_title || block.chapter_title}</div>
                                            {block.chapter_title && block.lesson_title && (
                                                <span className="pmd-chapter-sub">{block.chapter_title}</span>
                                            )}
                                        </div>

                                        {block.focus_summary && (
                                            <div className="pmd-focus-summary">
                                                {block.focus_summary}
                                            </div>
                                        )}

                                        <button className="pmd-single-start-btn" onClick={() => handleExecute(block)}>
                                            <span>Start Phase</span>
                                            <i className="fa-solid fa-arrow-right"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>

                {planData && !loading && (
                    <footer className="pmd-footer">
                        <button className="pmd-master-cta" onClick={() => handleExecute(planData.schedule_blocks?.[0])}>
                            <span>🚀 Start Session (Phase 1)</span>
                            <i className="fa-solid fa-arrow-right"></i>
                        </button>
                        {planData.motivational_closer && (
                            <div className="pmd-closer-note">{planData.motivational_closer}</div>
                        )}
                    </footer>
                )}
            </div>
        </div>
    );
};

export default PlanMyDayModal;