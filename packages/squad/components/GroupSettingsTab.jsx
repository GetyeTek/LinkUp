import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import { invokeSocial } from '../api.js';

const GroupSettingsTab = ({ chatInfo, conversationId, onUpdateInfo, onDisband, isProcessing, setIsProcessing, setAlertNotice, cleanBase }) => {
    const [editTitle, setEditTitle] = useState(chatInfo.title || '');
    const [nameStatus, setNameStatus] = useState('idle');
    const [nameError, setNameError] = useState('');
    const [editSlug, setEditSlug] = useState(chatInfo.metadata?.slug || '');
    const [slugStatus, setSlugStatus] = useState('idle');
    const [slugError, setSlugError] = useState('');
    const [editBio, setEditBio] = useState(chatInfo.metadata?.bio || '');
    const [bioStatus, setBioStatus] = useState('idle');
    
    const [privacyModal, setPrivacyModal] = useState(false);
    const [tempPrivacy, setTempPrivacy] = useState(chatInfo.metadata?.privacy || 'public');
    const [disbandModal, setDisbandModal] = useState(false);
    const [disbandInput, setDisbandInput] = useState('');

    useEffect(() => {
        setEditTitle(chatInfo.title || '');
        setEditSlug(chatInfo.metadata?.slug || '');
        setEditBio(chatInfo.metadata?.bio || '');
        setTempPrivacy(chatInfo.metadata?.privacy || 'public');
    }, [chatInfo.title, chatInfo.metadata]);

    const updateSquadName = async () => {
        if (!editTitle.trim() || editTitle === chatInfo.title) return;
        setNameStatus('saving');
        try {
            const res = await invokeSocial({ action: 'update_group_meta', conversation_id: conversationId, updates: { title: editTitle } });
            if (res.error) throw new Error(res.error);
            onUpdateInfo({ ...chatInfo, title: res.title, metadata: res.metadata });
            setNameStatus('success');
            setTimeout(() => setNameStatus('idle'), 3000);
        } catch(e) {
            setNameStatus('error');
            setNameError(e.message);
            setEditTitle(chatInfo.title);
        }
    };

    const updateSquadBio = async () => {
        const cleanBio = editBio.trim();
        if (cleanBio === (chatInfo.metadata?.bio || '')) return;
        setBioStatus('saving');
        try {
            const res = await invokeSocial({ action: 'update_group_meta', conversation_id: conversationId, updates: { bio: cleanBio } });
            if (res.error) throw new Error(res.error);
            onUpdateInfo({ ...chatInfo, metadata: res.metadata });
            setBioStatus('success');
            setTimeout(() => setBioStatus('idle'), 3000);
        } catch(e) {
            setBioStatus('error');
            setAlertNotice({ title: "Permission Denied", msg: e.message, success: false });
            setEditBio(chatInfo.metadata?.bio || '');
        }
    };

    const updateSquadSlug = async () => {
        const cleanSlug = editSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!cleanSlug || cleanSlug === chatInfo.metadata?.slug) return;
        setSlugStatus('saving');
        try {
            const res = await invokeSocial({ action: 'update_group_meta', conversation_id: conversationId, updates: { slug: cleanSlug } });
            if (res.error) throw new Error(res.error);
            onUpdateInfo({ ...chatInfo, metadata: res.metadata });
            setEditSlug(cleanSlug);
            setSlugStatus('success');
            setTimeout(() => setSlugStatus('idle'), 3000);
        } catch(e) {
            setSlugStatus('error');
            setSlugError(e.message);
            setEditSlug(chatInfo.metadata?.slug || '');
        }
    };

    const updateSquadPrivacy = async (val) => {
        setIsProcessing(true);
        try {
            const res = await invokeSocial({ action: 'update_group_meta', conversation_id: conversationId, updates: { privacy: val } });
            if (res.error) throw new Error(res.error);
            onUpdateInfo({ ...chatInfo, metadata: res.metadata });
            setPrivacyModal(false);
            setAlertNotice({ title: "Privacy Updated", msg: `The group is now ${val}.`, success: true });
        } catch(e) {
            setAlertNotice({ title: "Permission Denied", msg: e.message, success: false });
            setPrivacyModal(false);
        }
        setIsProcessing(false);
    };

    const executeDisband = async () => {
        if (disbandInput !== chatInfo.title) return;
        setIsProcessing(true);
        const { error } = await supabase.from('conversations').delete().eq('id', conversationId);
        setIsProcessing(false);
        if (error) {
            setAlertNotice({ title: "Action Failed", msg: error.message, success: false });
            setDisbandModal(false);
        } else {
            onDisband();
        }
    };

    return (
        <>
            <div className="si-settings">
                <div className="si-settings-group">
                    <label className="si-label">Group Name</label>
                    <div className="si-input-wrapper">
                        <input 
                            type="text" 
                            className="si-input" 
                            value={editTitle} 
                            onChange={e => { setEditTitle(e.target.value); setNameStatus('idle'); }} 
                            onKeyPress={e => e.key === 'Enter' && updateSquadName()}
                        />
                    </div>
                    {(editTitle !== chatInfo.title || nameStatus !== 'idle') && (
                        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', minHeight: '30px' }}>
                            {editTitle !== chatInfo.title && (
                                <button className="si-save-slug-btn" onClick={updateSquadName} disabled={nameStatus === 'saving' || !editTitle.trim()}>
                                    {nameStatus === 'saving' ? 'Saving...' : 'Save Name'}
                                </button>
                            )}
                            {nameStatus === 'error' && <span style={{ color: '#ff5f5f', fontSize: '0.8rem' }}><i className="fas fa-exclamation-triangle"></i> {nameError}</span>}
                            {nameStatus === 'success' && <span style={{ color: '#42d7b8', fontSize: '0.8rem', animation: 'fadeIn 0.3s ease' }}><i className="fas fa-check-circle"></i> Name updated!</span>}
                        </div>
                    )}
                </div>

                <div className="si-settings-group">
                    <label className="si-label">Group Description / Rules</label>
                    <div className="si-input-wrapper">
                        <textarea 
                            className="si-textarea" 
                            value={editBio} 
                            onChange={e => { setEditBio(e.target.value); setBioStatus('idle'); }} 
                            placeholder="What is this group about?"
                            maxLength={500}
                            rows={3}
                        />
                    </div>
                    {(editBio !== (chatInfo.metadata?.bio || '') || bioStatus !== 'idle') && (
                        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', minHeight: '30px' }}>
                            {editBio !== (chatInfo.metadata?.bio || '') && (
                                <button className="si-save-slug-btn" onClick={updateSquadBio} disabled={bioStatus === 'saving' || editBio.trim() === (chatInfo.metadata?.bio || '')}>
                                    {bioStatus === 'saving' ? 'Saving...' : 'Save Description'}
                                </button>
                            )}
                            {bioStatus === 'error' && <span style={{ color: '#ff5f5f', fontSize: '0.8rem' }}><i className="fas fa-exclamation-triangle"></i> Failed</span>}
                            {bioStatus === 'success' && <span style={{ color: '#42d7b8', fontSize: '0.8rem', animation: 'fadeIn 0.3s ease' }}><i className="fas fa-check-circle"></i> Saved!</span>}
                        </div>
                    )}
                </div>

                {chatInfo.metadata?.privacy !== 'private' && (
                <div className="si-settings-group">
                    <label className="si-label">Group Link Handle</label>
                    <div className="si-slug-container">
                        <span className="si-slug-prefix">{cleanBase}?sq=</span>
                        <input 
                            type="text" 
                            className="si-slug-input" 
                            value={editSlug} 
                            onChange={e => { setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '')); setSlugStatus('idle'); }} 
                            onKeyPress={e => e.key === 'Enter' && updateSquadSlug()}
                        />
                    </div>
                    {(editSlug !== (chatInfo.metadata?.slug || '') || slugStatus !== 'idle') && (
                        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', minHeight: '30px' }}>
                            {editSlug !== (chatInfo.metadata?.slug || '') && (
                                <button className="si-save-slug-btn" onClick={updateSquadSlug} disabled={slugStatus === 'saving' || !editSlug.trim()}>
                                    {slugStatus === 'saving' ? 'Saving...' : 'Save Handle'}
                                </button>
                            )}
                            {slugStatus === 'error' && <span style={{ color: '#ff5f5f', fontSize: '0.8rem' }}><i className="fas fa-exclamation-triangle"></i> {slugError}</span>}
                            {slugStatus === 'success' && <span style={{ color: '#42d7b8', fontSize: '0.8rem', animation: 'fadeIn 0.3s ease' }}><i className="fas fa-check-circle"></i> Handle updated!</span>}
                        </div>
                    )}
                </div>
                )}

                <div className="si-settings-row" onClick={() => setPrivacyModal(true)}>
                    <div className="sr-info">
                        <h4>Privacy Status</h4>
                        <p>{chatInfo.metadata?.privacy === 'public' ? 'Anyone can find and join' : 'Invite only'}</p>
                    </div>
                    <div className="sr-val">{chatInfo.metadata?.privacy || 'public'} <i className="fas fa-chevron-right"></i></div>
                </div>

                <hr style={{border:'none', borderTop:'1px solid rgba(255,255,255,0.05)', margin:'2rem 0'}}/>

                <div className="si-settings-group">
                    <label className="si-label" style={{color:'#ff5f5f'}}>Danger Zone</label>
                    <p style={{fontSize:'0.8rem', color:'#888', marginBottom:'1rem'}}>Deleting this group will permanently remove all associated messages, files, and links. This action is irreversible.</p>
                    <button className="si-disband-btn" onClick={() => setDisbandModal(true)}>
                        <i className="fas fa-triangle-exclamation"></i> Delete Group
                    </button>
                </div>
            </div>

            {/* Privacy Configuration Modal */}
            {privacyModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Squad Privacy</h3>
                        <p>Configure how others discover and join this group.</p>
                        <div className="cm-privacy-options">
                            <div className={`cm-privacy-card ${tempPrivacy === 'public' ? 'active' : ''}`} onClick={() => setTempPrivacy('public')}>
                                <i className="fas fa-globe"></i>
                                <div>
                                    <h4>Public</h4>
                                    <p>Searchable and accessible via Invite Link.</p>
                                </div>
                            </div>
                            <div className={`cm-privacy-card ${tempPrivacy === 'private' ? 'active' : ''}`} onClick={() => setTempPrivacy('private')}>
                                <i className="fas fa-lock"></i>
                                <div>
                                    <h4>Private</h4>
                                    <p>Hidden. Members must be added by Admin.</p>
                                </div>
                            </div>
                        </div>
                        <div className="cm-footer" style={{marginTop: '1rem'}}>
                            <button className="cm-btn-cancel" onClick={() => { setTempPrivacy(chatInfo.metadata?.privacy || 'public'); setPrivacyModal(false); }} disabled={isProcessing}>Cancel</button>
                            <button className="cm-btn-primary" onClick={() => updateSquadPrivacy(tempPrivacy)} disabled={isProcessing}>
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : 'Confirm Status'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Disband Modal */}
            {disbandModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3 style={{color: '#ff5f5f'}}>Delete Group</h3>
                        <p>This action is irreversible. All messages, files, and links will be permanently deleted.</p>
                        <p style={{fontSize: '0.8rem', color: '#aaa', marginTop: '10px'}}>Type <strong>{chatInfo.title}</strong> to confirm:</p>
                        <input 
                            type="text" 
                            className="cm-text-input" 
                            placeholder={chatInfo.title}
                            value={disbandInput}
                            onChange={e => setDisbandInput(e.target.value)}
                        />
                        <div className="cm-footer" style={{marginTop: '1rem'}}>
                            <button className="cm-btn-cancel" onClick={() => { setDisbandModal(false); setDisbandInput(''); }} disabled={isProcessing}>Cancel</button>
                            <button className="cm-btn-danger" onClick={executeDisband} disabled={disbandInput !== chatInfo.title || isProcessing}>
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : 'Delete Group'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default GroupSettingsTab;