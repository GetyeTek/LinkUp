import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './GroupCreator.css';

const GroupCreator = ({ currentUser, onClose, onCreated }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [form, setForm] = useState({ type: '', title: '', focus: '', privacy: 'public', slug: '' });
    const [groupCount, setGroupCount] = useState(0);
    const [loadingCount, setLoadingCount] = useState(true);
    const [slugStatus, setSlugStatus] = useState('idle');

    useEffect(() => {
        const fetchCount = async () => {
            const { count, error } = await supabase
                .from('conversations')
                .select('*', { count: 'exact', head: true })
                .eq('owner_id', currentUser.id)
                .eq('type', 'group');
            
            if (!error) setGroupCount(count || 0);
            setLoadingCount(false);
        };
        fetchCount();
    }, [currentUser.id]);

    // Live debounced slug validator
    useEffect(() => {
        if (form.type !== 'class' || !form.slug) return;
        const cleanSlug = form.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (form.slug !== cleanSlug) setForm(f => ({ ...f, slug: cleanSlug }));
        if (cleanSlug.length < 3) {
            setSlugStatus('invalid');
            return;
        }
        const timer = setTimeout(async () => {
            setSlugStatus('checking');
            const { data } = await supabase.rpc('check_squad_slug_available', { req_slug: cleanSlug });
            setSlugStatus(data ? 'available' : 'taken');
        }, 500);
        return () => clearTimeout(timer);
    }, [form.slug, form.type]);

    const handleCreate = async () => {
        if (form.title.trim().length < 3) {
            setError("Name must be at least 3 characters.");
            return;
        }
        if (form.type === 'class' && slugStatus !== 'available') {
            setError("Please provide a valid and available link handle.");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const payload = {
                req_title: form.title,
                req_metadata: { focus: form.focus, privacy: form.privacy }
            };
            
            if (form.type === 'class' && form.slug) {
                payload.req_metadata.slug = form.slug;
            }

            const { data, error: rpcError } = await supabase.rpc('create_study_group', payload);
            if (rpcError) throw rpcError;
            onCreated();
        } catch (err) {
            setError(err.message || "Failed to create group.");
            setLoading(false);
        }
    };

    const getBaseUrl = () => {
        const cleanBase = (window.location.origin + window.location.pathname).split('?')[0].replace(/\/$/, '');
        return cleanBase;
    };

    return (
        <div className="gc-overlay">
            <div className="gc-card">
                <header className="gc-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
                    <button className="icon-button" onClick={onClose} disabled={loading}><i className="fas fa-chevron-left"></i></button>
                    <h2>Create New Group</h2>
                </header>

                <div className="gc-body">
                    {loadingCount ? (
                        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--accent-teal)' }}>
                            <i className="fas fa-circle-notch fa-spin fa-2x"></i>
                        </div>
                    ) : groupCount >= 3 ? (
                        <div className="gc-limit-reached">
                            <i className="fas fa-lock"></i>
                            <h3>Limit Reached</h3>
                            <p>You have already established <strong>{groupCount}</strong> study squads. To maintain the highest quality of collaboration across the platform, students are restricted to 3 active owned groups.</p>
                        </div>
                    ) : (
                        <>
                            {error && <div className="gc-error">{error}</div>}
                            
                            {step === 1 && (
                        <div className="gc-step animate-in">
                            <label className="gc-label" style={{textAlign: 'center', marginBottom: '1rem'}}>Select Format</label>
                            <div className="gc-type-grid">
                                <div className="gc-type-card" onClick={() => { setForm({ ...form, type: 'academic' }); setStep(2); }}>
                                    <i className="fas fa-book-open gc-type-icon"></i>
                                    <div className="gc-type-title">Study Squad</div>
                                    <div className="gc-type-desc">Subject-specific prep & collaboration</div>
                                </div>
                                <div className="gc-type-card" onClick={() => { setForm({ ...form, type: 'class', focus: 'Class', privacy: 'public' }); setStep(2); }}>
                                    <i className="fas fa-users-rectangle gc-type-icon"></i>
                                    <div className="gc-type-title">Official Class</div>
                                    <div className="gc-type-desc">Section coordination & batch announcements</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ACADEMIC PATH */}
                    {step === 2 && form.type === 'academic' && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Subject Classification</label>
                            <div className="gc-grid" style={{marginTop: '1rem'}}>
                                {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'CS', 'General'].map(f => (
                                    <div key={f} className={`gc-chip ${form.focus === f ? 'active' : ''}`} onClick={() => setForm({...form, focus: f})}>{f}</div>
                                ))}
                            </div>
                            <div className="gc-nav">
                                <button className="gc-btn secondary" onClick={() => setStep(1)}>Back</button>
                                <button className="gc-btn primary" onClick={() => setStep(3)} disabled={!form.focus}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && form.type === 'academic' && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Squad Name</label>
                            <input className="gc-input" placeholder="e.g. Physics Core 101" value={form.title} onChange={e => setForm({...form, title: e.target.value})} autoFocus />
                            <div className="gc-nav">
                                <button className="gc-btn secondary" onClick={() => setStep(2)}>Back</button>
                                <button className="gc-btn primary" disabled={form.title.length < 3} onClick={() => setStep(4)}>Continue</button>
                            </div>
                        </div>
                    )}

                    {step === 4 && form.type === 'academic' && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Access Control</label>
                            <div className="gc-privacy-options">
                                <div className={`gc-privacy-card ${form.privacy === 'public' ? 'active' : ''}`} onClick={() => setForm({...form, privacy: 'public'})}>
                                    <i className="fas fa-globe"></i>
                                    <div>
                                        <h4>Public Squad</h4>
                                        <p>Searchable by anyone on the platform.</p>
                                    </div>
                                </div>
                                <div className={`gc-privacy-card ${form.privacy === 'private' ? 'active' : ''}`} onClick={() => setForm({...form, privacy: 'private'})}>
                                    <i className="fas fa-lock"></i>
                                    <div>
                                        <h4>Private Squad</h4>
                                        <p>Access restricted to invitees only.</p>
                                    </div>
                                </div>
                            </div>
                            <div className="gc-nav">
                                <button className="gc-btn secondary" onClick={() => setStep(3)} disabled={loading}>Back</button>
                                <button className="gc-btn primary" onClick={handleCreate} disabled={loading}>
                                    {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Initialize"}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* CLASS PATH */}
                    {step === 2 && form.type === 'class' && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Class / Section Name</label>
                            <input className="gc-input" placeholder="e.g. Section B 2026" value={form.title} onChange={e => setForm({...form, title: e.target.value})} autoFocus />
                            <div className="gc-nav">
                                <button className="gc-btn secondary" onClick={() => setStep(1)}>Back</button>
                                <button className="gc-btn primary" disabled={form.title.length < 3} onClick={() => {
                                    if (!form.slug) {
                                        setForm({...form, slug: form.title.toLowerCase().replace(/[^a-z0-9]/g, '')});
                                    }
                                    setStep(3);
                                }}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && form.type === 'class' && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Secure Invitation Link</label>
                            <p style={{fontSize: '0.8rem', color: '#888', marginBottom: '0'}}>Customize the public link handle for your class.</p>
                            
                            <div className={`gc-slug-box ${slugStatus === 'available' ? 'available' : slugStatus === 'taken' || slugStatus === 'invalid' ? 'taken' : ''}`}>
                                <span className="gc-slug-prefix">{getBaseUrl()}?sq=</span>
                                <input 
                                    className="gc-slug-input" 
                                    value={form.slug} 
                                    onChange={e => setForm({...form, slug: e.target.value})} 
                                    maxLength={20}
                                />
                                <div className="gc-slug-status-icon">
                                    {slugStatus === 'checking' && <i className="fas fa-circle-notch fa-spin" style={{color: 'var(--accent-teal)'}}></i>}
                                    {slugStatus === 'available' && <i className="fas fa-check" style={{color: 'var(--accent-teal)'}}></i>}
                                    {(slugStatus === 'taken' || slugStatus === 'invalid') && <i className="fas fa-times" style={{color: '#ff5f5f'}}></i>}
                                </div>
                            </div>
                            
                            <div className="gc-slug-hint" style={{ color: slugStatus === 'taken' || slugStatus === 'invalid' ? '#ff5f5f' : 'var(--accent-teal)' }}>
                                {slugStatus === 'invalid' && "Must be at least 3 alphanumeric characters."}
                                {slugStatus === 'taken' && "This link handle is already taken by another group."}
                                {slugStatus === 'available' && "Looks great! Handle is available."}
                            </div>

                            <div className="gc-nav" style={{marginTop: '2rem'}}>
                                <button className="gc-btn secondary" onClick={() => setStep(2)} disabled={loading}>Back</button>
                                <button className="gc-btn primary" onClick={handleCreate} disabled={loading || slugStatus !== 'available'}>
                                    {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Establish Class"}
                                </button>
                            </div>
                        </div>
                    )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
export default GroupCreator;