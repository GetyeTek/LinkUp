import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import AvatarCropperModal from '../../../src/core/components/AvatarCropperModal.jsx';
import './UserInfoPanel.css';

const UserInfoPanel = ({ userId, currentUser, onClose }) => {
    const isMe = userId === currentUser.id;
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editForm, setEditForm] = useState({ name: '', username: '', bio: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [statusMsg, setStatusMsg] = useState(null); // { text, type }
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        const fetchUser = async () => {
            try {
                let profileData = null;
                
                if (isMe) {
                    // Full access to own profile
                    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
                    profileData = data;
                } else {
                    // Secure RPC access to public fields for peers
                    const { data, error } = await supabase.rpc('get_user_profile_public', { target_user_id: userId });
                    if (!error && data) {
                        profileData = data;
                    }
                }
                
                if (profileData) {
                    setProfile(profileData);
                    setEditForm({ name: profileData.full_name || '', username: profileData.username || '', bio: profileData.bio || '' });
                }
            } catch (err) {
                console.error("Profile fetch error:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchUser();
    }, [userId, isMe]);

    const handleSave = async () => {
        if (!isMe) return;
        setIsSaving(true);
        setStatusMsg(null);
        
        const cleanUsername = editForm.username.toLowerCase().trim();
        
        try {
            const { error } = await supabase.from('profiles').update({
                full_name: editForm.name.trim(),
                username: cleanUsername,
                bio: editForm.bio.trim()
            }).eq('id', currentUser.id);
            
            if (error) throw error;
            setStatusMsg({ text: "Profile updated successfully.", type: "success" });
            setProfile(prev => ({ ...prev, full_name: editForm.name.trim(), username: cleanUsername, bio: editForm.bio.trim() }));
        } catch (err) {
            setStatusMsg({ text: err.message || "Failed to update profile.", type: "error" });
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpdate = async (blob) => {
        setSelectedFile(null);
        setIsSaving(true);
        setStatusMsg({ text: "Uploading avatar...", type: "success" });
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const filePath = `${currentUser.id}/avatar_${Date.now()}.png`;
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, arrayBuffer, { contentType: 'image/png', upsert: true });
            if (uploadError) throw uploadError;
            
            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
            const { error: dbError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
            if (dbError) throw dbError;

            setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
            setStatusMsg({ text: "Avatar updated successfully!", type: "success" });
        } catch (err) {
            console.error("Personal avatar update error:", err);
            setStatusMsg({ text: err.message || "Failed to upload avatar.", type: "error" });
        } finally {
            setIsSaving(false);
        }
    };

    const navigateToSettings = () => {
        onClose();
        window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab: 'profile' } }));
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-profile-editor'));
        }, 100); // Slight delay ensures tab switches before overlay triggers
    };

    if (loading) return (
        <div className="user-info-overlay" style={{alignItems: 'center', justifyContent: 'center'}}>
            <i className="fas fa-circle-notch fa-spin" style={{fontSize: '2rem', color: 'var(--accent-teal)'}}></i>
        </div>
    );

    if (!profile) return (
        <div className="user-info-overlay" style={{alignItems: 'center', justifyContent: 'center'}}>
            <p style={{color: '#888'}}>User not found.</p>
            <button className="ui-back" style={{position: 'static', marginTop: '1rem'}} onClick={onClose}><i className="fas fa-arrow-left"></i></button>
        </div>
    );

    const hasChanges = isMe && (editForm.name !== profile.full_name || editForm.username !== profile.username || editForm.bio !== (profile.bio || ''));

    return (
        <div className="user-info-overlay">
            {selectedFile && (
                <AvatarCropperModal 
                    imageFile={selectedFile} 
                    onCancel={() => setSelectedFile(null)} 
                    onSave={handleAvatarUpdate}
                />
            )}
            <div className="ui-hero">
                <button className="ui-back" onClick={onClose} disabled={isSaving}><i className="fas fa-chevron-left"></i></button>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => {
                    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
                    e.target.value = null;
                }} />
                <div className="ui-avatar-container" onClick={() => isMe && fileInputRef.current?.click()} style={{cursor: isMe ? 'pointer' : 'default'}}>
                    <div className="ui-avatar">
                        <img src={profile.avatar_url || 'https://via.placeholder.com/150'} alt="Avatar" />
                    </div>
                    {isMe && <div className="ui-avatar-edit"><i className="fas fa-pencil"></i></div>}
                </div>
            </div>
            <div className="ui-body">
                <div className="ui-input-group">
                    <label>Full Name</label>
                    <input 
                        type="text" 
                        className="ui-input" 
                        value={isMe ? editForm.name : profile.full_name} 
                        onChange={e => setEditForm({...editForm, name: e.target.value})} 
                        disabled={!isMe || isSaving} 
                    />
                </div>
                <div className="ui-input-group">
                    <label>Username</label>
                    <div className="handle-input-wrapper status-idle" style={{background: !isMe ? 'transparent' : '', borderColor: !isMe ? 'transparent' : '', paddingLeft: !isMe ? '0' : ''}}>
                        <span className="handle-prefix">@</span>
                        <input 
                            type="text" 
                            value={isMe ? editForm.username : profile.username} 
                            onChange={e => setEditForm({...editForm, username: e.target.value})} 
                            disabled={!isMe || isSaving} 
                            style={{background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '100%', padding: '12px 8px', fontSize: isMe ? '1rem' : '1.1rem', fontWeight: !isMe ? '500' : 'normal'}}
                        />
                    </div>
                </div>

                <div className="ui-input-group">
                    <label>About</label>
                    {isMe ? (
                        <>
                            <textarea 
                                className="ui-textarea" 
                                placeholder="Write a short bio..."
                                value={editForm.bio}
                                onChange={e => setEditForm({...editForm, bio: e.target.value})}
                                disabled={isSaving}
                                maxLength={150}
                                rows={3}
                            />
                            <div className="bio-char-count">{editForm.bio.length}/150</div>
                        </>
                    ) : (
                        <div className="ui-bio-text">
                            {profile.bio ? profile.bio : <span style={{color: '#666', fontStyle: 'italic'}}>No bio provided.</span>}
                        </div>
                    )}
                </div>

                {statusMsg && <div className={`ui-status-text ${statusMsg.type}`}>{statusMsg.text}</div>}

                {isMe && hasChanges && (
                    <button className="ui-save-btn" onClick={handleSave} disabled={isSaving || !editForm.name.trim() || !editForm.username.trim()}>
                        {isSaving ? <i className="fas fa-circle-notch fa-spin"></i> : "Save Changes"}
                    </button>
                )}

                <div style={{marginTop: '1rem'}}>
                    {profile.department && (
                        <div className="ui-meta-card">
                            <div className="ui-meta-icon"><i className="fas fa-graduation-cap"></i></div>
                            <div className="ui-meta-info">
                                <h4>Academic Program</h4>
                                <p>{profile.department}</p>
                            </div>
                        </div>
                    )}
                </div>

                {isMe && (
                    <button className="ui-full-settings-btn" onClick={navigateToSettings}>
                        <i className="fas fa-sliders-h"></i> Full Account & Registry Settings
                    </button>
                )}
            </div>
        </div>
    );
};

export default UserInfoPanel;