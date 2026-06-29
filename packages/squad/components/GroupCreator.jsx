import React, { useState } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './GroupCreator.css';

const GroupCreator = ({ currentUser, onClose, onCreated }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [form, setForm] = useState({ title: '', focus: 'General', privacy: 'public' });

    const handleCreate = async () => {
        if (form.title.trim().length < 3) {
            setError("Group name must be at least 3 characters.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabase.rpc('create_study_group', {
                req_title: form.title,
                req_metadata: { focus: form.focus, privacy: form.privacy },
                req_owner_id: currentUser.id
            });
            if (rpcError) throw rpcError;
            onCreated();
        } catch (err) {
            setError(err.message || "Failed to create group.");
            setLoading(false);
        }
    };

    return (
        <div className="gc-overlay">
            <div className="gc-card">
                <header className="gc-header">
                    <h2>Launch New Squad</h2>
                    <button className="icon-button" onClick={onClose} disabled={loading}><i className="fas fa-times"></i></button>
                </header>

                <div className="gc-body">
                    {error && <div className="gc-error">{error}</div>}
                    
                    {step === 1 && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Squad Name</label>
                            <input className="gc-input" placeholder="e.g. Physics Core 101" value={form.title} onChange={e => setForm({...form, title: e.target.value})} autoFocus />
                            <div className="gc-nav">
                                <button className="gc-btn primary" disabled={form.title.length < 3} onClick={() => setStep(2)}>Continue</button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="gc-step animate-in">
                            <label className="gc-label">Curriculum Focus</label>
                            <div className="gc-grid">
                                {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'CS', 'General'].map(f => (
                                    <div key={f} className={`gc-chip ${form.focus === f ? 'active' : ''}`} onClick={() => setForm({...form, focus: f})}>{f}</div>
                                ))}
                            </div>
                            <div className="gc-nav">
                                <button className="gc-btn secondary" onClick={() => setStep(1)}>Back</button>
                                <button className="gc-btn primary" onClick={() => setStep(3)}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
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
                                        <h4>Private Vault</h4>
                                        <p>Access restricted to invitees only.</p>
                                    </div>
                                </div>
                            </div>
                            <div className="gc-nav">
                                <button className="gc-btn secondary" onClick={() => setStep(2)} disabled={loading}>Back</button>
                                <button className="gc-btn primary" onClick={handleCreate} disabled={loading}>
                                    {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Initialize"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
export default GroupCreator;