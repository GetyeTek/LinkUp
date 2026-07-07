import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import AvatarCropperModal from './AvatarCropperModal.jsx';
import ProfileAvatarPicker from './ProfileAvatarPicker.jsx';
import UsernameField from './UsernameField.jsx';
import { useUsernameCheck } from '../hooks/useUsernameCheck.js';
import './ProfileEditor.css';

const DEPARTMENTS = ['Freshman', 'Computer Science', 'Software Engineering', 'Management', 'Economics', 'Electrical Engineering', 'Mechanical Engineering', 'Health', 'Other'];
const YEARS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const PROGRAMS = ['Regular', 'Extension'];
const STREAMS = ['Natural Science', 'Social Science'];

// Reusable Custom Chip Dropdown component
const ChipDropdown = ({ label, value, options, fieldKey, singleCol, expandedField, setExpandedField, setEditForm }) => {
    const isExpanded = expandedField === fieldKey;
    return (
        <div className="input-group-sm" style={{ marginTop: '1rem' }}>
            <label>{label}</label>
            <div 
                className={`pe-dropdown-summary ${isExpanded ? 'expanded' : ''}`} 
                onClick={() => setExpandedField(isExpanded ? null : fieldKey)}
            >
                <span className={value ? 'has-value' : 'is-empty'}>{value || `Select ${label.toLowerCase()}...`}</span>
                <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
            </div>
            
            {isExpanded && (
                <div className={`wizard-options-grid ${singleCol ? 'single-col' : ''}`} style={{ marginTop: '0.75rem' }}>
                    {options.map(o => (
                        <div 
                            key={o} 
                            className={`wizard-option-card ${value === o ? 'active' : ''}`} 
                            onClick={() => {
                                setEditForm(prev => ({ ...prev, [fieldKey]: o }));
                                setExpandedField(null); // Auto-collapse on selection
                            }}
                        >
                            {o}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const ProfileEditor = ({ isOpen, onClose, userProfile, sessionUser }) => {
    const [universities, setUniversities] = useState([]);
    const [saving, setSaving] = useState(false);
    const [alertNotice, setAlertNotice] = useState(null);
    const [originalForm, setOriginalForm] = useState(null);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    
    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);
    const [expandedField, setExpandedField] = useState(null);

    const [editForm, setEditForm] = useState({
        sureName: '', fatherName: '', username: '', bio: '', email: '', phone: '', university_id: '', 
        program: '', department: '', freshman_stream: '', target_department: '', year: ''
    });
    
    const usernameStatus = useUsernameCheck(editForm.username, userProfile?.username);

    useEffect(() => {
        if (!isOpen) return;
        supabase.from('universities').select('id, name').order('name')
            .then(({ data }) => { if (data) setUniversities(data); });
    }, [isOpen]);

    useEffect(() => {
        if (userProfile && isOpen) {
            const parts = (userProfile.full_name || '').trim().split(' ');
            const initialData = {
                sureName: parts[0] || '',
                fatherName: parts.slice(1).join(' ') || '',
                username: userProfile.username || '',
                bio: userProfile.bio || '',
                email: sessionUser?.email || '',
                phone: userProfile.phone || '',
                university_id: userProfile.university_id || '',
                program: userProfile.program || '',
                department: userProfile.department || '',
                freshman_stream: userProfile.freshman_stream || '',
                target_department: userProfile.target_department || '',
                year: userProfile.year || ''
            };
            setEditForm(initialData);
            setOriginalForm(initialData);
        }
    }, [userProfile, sessionUser, isOpen]);
    
    const handleCloseEditor = () => {
        if (JSON.stringify(editForm) !== JSON.stringify(originalForm) || croppedAvatar) {
            setShowDiscardConfirm(true);
        } else {
            onClose();
        }
    };

    const handleSaveProfile = async () => {
        setSaving(true);

        let finalAvatarUrl = userProfile.avatar_url;
        
        if (croppedAvatar?.blob) {
            const arrayBuffer = await croppedAvatar.blob.arrayBuffer();
            const filePath = `${userProfile.id}/avatar_${Date.now()}.png`;
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, arrayBuffer, { contentType: 'image/png', upsert: true });
            
            if (uploadError) {
                setAlertNotice({ title: "Upload Blocked", msg: "Avatar upload failed. Ensure the image is under 10MB." });
                setSaving(false);
                return;
            }
            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
            finalAvatarUrl = publicUrl;
        }

        if (editForm.email !== sessionUser?.email) {
            const { error: authError } = await supabase.auth.updateUser({ email: editForm.email });
            if (authError) {
                setAlertNotice({ title: "Email Error", msg: authError.message });
                setSaving(false);
                return;
            } else {
                setAlertNotice({ title: "Email Verification", msg: "Email change requested. Please check your new inbox for a verification link." });
            }
        }

        const finalFullName = editForm.fatherName.trim() ? `${editForm.sureName.trim()} ${editForm.fatherName.trim()}` : editForm.sureName.trim();

        const isFreshman = editForm.department === 'Freshman';
        
        const profileData = {
            full_name: finalFullName,
            username: editForm.username.toLowerCase().trim(),
            bio: editForm.bio.trim(),
            avatar_url: finalAvatarUrl,
            phone: editForm.phone,
            university_id: editForm.university_id || null,
            program: editForm.program || null,
            department: editForm.department || null,
            freshman_stream: isFreshman ? (editForm.freshman_stream || null) : null,
            target_department: isFreshman ? (editForm.target_department || null) : null,
            year: !isFreshman ? (editForm.year || null) : null
        };

        const { error } = await supabase.from('profiles').update(profileData).eq('id', userProfile.id);
        
        setSaving(false);
        if (!error) {
            setAlertNotice({ title: "Success", msg: "Your profile has been securely updated.", success: true });
            setTimeout(() => {
                setAlertNotice(null);
                onClose();
            }, 1500);
        } else {
            setAlertNotice({ title: "Update Failed", msg: error.message });
        }
    };

    if (!isOpen) return null;

    const displayAvatar = croppedAvatar?.url || userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(editForm.sureName || 'Scholar')}&background=1e1e1e&color=42d7b8&size=256`;

    return (
        <div className="profile-edit-overlay">
            {selectedFile && (
                <AvatarCropperModal 
                    imageFile={selectedFile} 
                    onCancel={() => setSelectedFile(null)} 
                    onSave={(blob) => {
                        const url = URL.createObjectURL(blob);
                        setCroppedAvatar({ blob, url });
                        setSelectedFile(null);
                    }}
                />
            )}
            
            {showDiscardConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 6000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justify-content: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#ff5f5f' }}>Discard Changes?</h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>You have unsaved changes. Are you sure you want to leave?</p>
                        <div style={{ display: 'flex', justify-content: 'flex-end', gap: '10px' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer' }} onClick={() => setShowDiscardConfirm(false)}>Stay</button>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', background: '#ff5f5f', color: '#fff', border: 'none', cursor: 'pointer' }} onClick={() => { setShowDiscardConfirm(false); setCroppedAvatar(null); onClose(); }}>Discard</button>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="profile-edit-card">
                <header className="pe-header" style={{ justify-content: 'flex-start', gap: '1.5rem' }}>
                    <button className="icon-button" onClick={handleCloseEditor} disabled={saving}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h2>Account & Registry</h2>
                    <div style={{ width: '40px' }}></div>
                </header>
                
                <div className="pe-body">
                    <ProfileAvatarPicker 
                        displayAvatar={displayAvatar}
                        displayFullName={`${editForm.sureName} ${editForm.fatherName}`.trim()}
                        username={editForm.username}
                        onFileSelect={setSelectedFile}
                        disabled={saving}
                    />
                    
                    <div className="onboarding-form" style={{ marginTop: '2rem' }}>
                        <h3 className="section-title">Identity & Bio</h3>
                        <div className="input-row">
                            <div className="input-group-sm">
                                <label>Sure Name</label>
                                <input type="text" value={editForm.sureName} onChange={e => setEditForm({...editForm, sureName: e.target.value})} disabled={saving} />
                            </div>
                            <div className="input-group-sm">
                                <label>Father Name <span className="optional-tag">(Opt)</span></label>
                                <input type="text" value={editForm.fatherName} onChange={e => setEditForm({...editForm, fatherName: e.target.value})} disabled={saving} />
                            </div>
                        </div>

                        <UsernameField 
                            username={editForm.username}
                            setUsername={(val) => setEditForm({...editForm, username: val})}
                            status={usernameStatus}
                            disabled={saving}
                        />
                        
                        <div className="input-group-sm" style={{ marginTop: '0.5rem' }}>
                            <label>About Me</label>
                            <textarea 
                                className="ui-textarea" 
                                placeholder="Write a short bio..."
                                value={editForm.bio}
                                onChange={e => setEditForm({...editForm, bio: e.target.value})}
                                disabled={saving}
                                maxLength={150}
                                rows={3}
                            />
                            <div style={{fontSize: '0.7rem', color: '#888', textAlign: 'right', marginTop: '4px'}}>{editForm.bio.length}/150</div>
                        </div>

                        <h3 className="section-title" style={{marginTop: '1.5rem'}}>Security Details</h3>
                        <div className="input-row">
                            <div className="input-group-sm">
                                <label>Email Address</label>
                                <input type="email" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} disabled={saving} />
                            </div>
                            <div className="input-group-sm">
                                <label>Phone Number</label>
                                <input type="tel" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} disabled={saving} />
                            </div>
                        </div>

                        <h3 className="section-title" style={{marginTop: '1.5rem'}}>Academic Registry</h3>
                        <div className="input-group-sm">
                            <label>University</label>
                            <select className="wizard-select" style={{ marginTop: '0.5rem' }} value={editForm.university_id} onChange={e => setEditForm({...editForm, university_id: e.target.value})}>
                                <option value="" disabled>Select your university...</option>
                                {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                        </div>

                        <ChipDropdown label="Program Type" value={editForm.program} options={PROGRAMS} fieldKey="program" singleCol={true} expandedField={expandedField} setExpandedField={setExpandedField} setEditForm={setEditForm} />
                        <ChipDropdown label="Department" value={editForm.department} options={DEPARTMENTS} fieldKey="department" expandedField={expandedField} setExpandedField={setExpandedField} setEditForm={setEditForm} />

                        {editForm.department === 'Freshman' ? (
                            <>
                                <ChipDropdown label="Freshman Stream" value={editForm.freshman_stream} options={STREAMS} fieldKey="freshman_stream" singleCol={true} expandedField={expandedField} setExpandedField={setExpandedField} setEditForm={setEditForm} />
                                <ChipDropdown label="Target Department" value={editForm.target_department} options={DEPARTMENTS.filter(d => d !== 'Freshman')} fieldKey="target_department" expandedField={expandedField} setExpandedField={setExpandedField} setEditForm={setEditForm} />
                            </>
                        ) : (
                            <ChipDropdown label="Year of Study" value={editForm.year} options={YEARS} fieldKey="year" expandedField={expandedField} setExpandedField={setExpandedField} setEditForm={setEditForm} />
                        )}
                    </div>
                </div>
                
                {alertNotice && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justify-content: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                        <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', box-shadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title}
                            </h3>
                            <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice.msg}</p>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button style={{ padding: '10px 18px', border-radius: '10px', font-weight: 600, font-family: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', font-size: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                            </div>
                        </div>
                    </div>
                )}

                <footer className="pe-footer">
                    <button className="pe-btn cancel" onClick={handleCloseEditor} disabled={saving}>Cancel</button>
                    <button className="pe-btn save" onClick={handleSaveProfile} disabled={saving || usernameStatus === 'taken' || usernameStatus === 'invalid'}>
                        {saving ? <i className="fas fa-circle-notch fa-spin"></i> : "Save Changes"}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default ProfileEditor;