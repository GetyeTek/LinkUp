import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import AvatarCropperModal from './AvatarCropperModal.jsx';
import ProfileAvatarPicker from './ProfileAvatarPicker.jsx';
import UsernameField from './UsernameField.jsx';
import { useUsernameCheck } from '../hooks/useUsernameCheck.js';
import { usePhoneCheck } from '../hooks/usePhoneCheck.js';
import './ProfileEditor.css';

const DEPARTMENTS = ['Freshman', 'Computer Science', 'Software Engineering', 'Management', 'Economics', 'Electrical Engineering', 'Mechanical Engineering', 'Health', 'Other'];
const YEARS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const PROGRAMS = ['Regular', 'Extension'];
const STREAMS = ['Natural Science', 'Social Science'];

// Reusable Selection Field leading to Modal
const SelectionField = ({ label, value, fieldKey, onOpen }) => {
    return (
        <div className="input-group-sm" style={{ marginTop: '1rem' }}>
            <label>{label}</label>
            <div 
                className="pe-dropdown-summary" 
                onClick={() => onOpen(fieldKey, label)}
            >
                <span className={value ? 'has-value' : 'is-empty'}>{value || `Select ${label.toLowerCase()}...`}</span>
                <i className="fas fa-chevron-down"></i>
            </div>
        </div>
    );
};

const ProfileEditor = ({ isOpen, onClose, userProfile, sessionUser, onProfileUpdated, highlightTarget }) => {
    const [universities, setUniversities] = useState([]);
    const [saving, setSaving] = useState(false);
    const [alertNotice, setAlertNotice] = useState(null);
    const [originalForm, setOriginalForm] = useState(null);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    
    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);
    
    const [activeSelectionModal, setActiveSelectionModal] = useState(null); // { fieldKey, title, options }

    const [editForm, setEditForm] = useState({
        sureName: '', fatherName: '', username: '', bio: '', email: '', phone: '', sex: '', university_id: '', 
        program: '', department: '', freshman_stream: '', target_department: '', year: ''
    });
    const [isLinkingPhone, setIsLinkingPhone] = useState(false);

    const handleInitiateBotPhoneChange = async () => {
        setIsLinkingPhone(true);
        try {
            const { data, error } = await supabase.rpc('generate_telegram_link_token');
            if (error || !data) throw new Error("Could not generate verification token.");
            window.open(`https://t.me/linkupregistrationbot?start=link_${data}`, '_blank', 'noopener,noreferrer');
        } catch (err) {
            setAlertNotice({ title: "Transfer Failed", msg: err.message || "Could not connect to Telegram bot." });
        } finally {
            setIsLinkingPhone(false);
        }
    };
    
    const usernameStatus = useUsernameCheck(editForm.username, userProfile?.username);
    const { status: phoneStatus } = usePhoneCheck(editForm.phone, userProfile?.phone);

    useEffect(() => {
        if (!isOpen) return;
        supabase.from('universities').select('id, name').order('name')
            .then(({ data }) => { if (data) setUniversities(data); });
    }, [isOpen]);

    // Auto-scroll and spotlight the missing field
    useEffect(() => {
        if (isOpen && highlightTarget) {
            const timer = setTimeout(() => {
                const targetEl = document.getElementById(`pe-field-${highlightTarget}`);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetEl.classList.add('pe-target-spotlight');
                    setTimeout(() => targetEl.classList.remove('pe-target-spotlight'), 3200);
                }
            }, 250);
            return () => clearTimeout(timer);
        }
    }, [isOpen, highlightTarget]);

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
                sex: userProfile.sex || '',
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

        let normalizedPhone = editForm.phone.replace(/\s+/g, '');
        if (normalizedPhone && !normalizedPhone.startsWith('+')) {
            if (normalizedPhone.startsWith('0')) {
                normalizedPhone = '+251' + normalizedPhone.substring(1);
            } else {
                normalizedPhone = '+' + normalizedPhone;
            }
        }

        const isPhoneChanged = (normalizedPhone || '') !== (userProfile?.phone || '').replace(/\s+/g, '');
        const isFreshman = editForm.department === 'Freshman';
        const isVerifiedTelegram = Boolean(userProfile?.registered_with_telegram);
        
        const profileData = {
            full_name: finalFullName,
            username: editForm.username.toLowerCase().trim(),
            bio: editForm.bio.trim(),
            avatar_url: finalAvatarUrl,
            // If verified, retain ground-truth phone number; otherwise accept normalized input
            phone: isVerifiedTelegram ? (userProfile?.phone || null) : (normalizedPhone || null),
            sex: editForm.sex || null,
            university_id: editForm.university_id || null,
            program: editForm.program || null,
            department: editForm.department || null,
            freshman_stream: isFreshman ? (editForm.freshman_stream || null) : null,
            target_department: isFreshman ? (editForm.target_department || null) : null,
            year: !isFreshman ? (editForm.year || null) : null
        };

        const { data: updatedProfile, error } = await supabase
            .from('profiles')
            .update(profileData)
            .eq('id', sessionUser.id)
            .select()
            .single();
        
        setSaving(false);
        if (!error && updatedProfile) {
            onProfileUpdated?.(updatedProfile);
            setAlertNotice({ 
                title: "Success", 
                msg: isPhoneChanged && userProfile?.registered_with_telegram 
                    ? "Phone number updated. Your Telegram verification has been reset—please re-verify your new number in Privacy & Security."
                    : "Your profile has been securely updated.", 
                success: true 
            });
            setTimeout(() => {
                setAlertNotice(null);
                onClose();
            }, 1800);
        } else {
            setAlertNotice({ title: "Update Failed", msg: error?.message || "Failed to save profile." });
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
                <div style={{ position: 'fixed', inset: 0, zIndex: 6000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: 'var(--surface-dark)', border: '1px solid var(--border-color)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#ff5f5f' }}>Discard Changes?</h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>You have unsaved changes. Are you sure you want to leave?</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer' }} onClick={() => setShowDiscardConfirm(false)}>Stay</button>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', background: '#ff5f5f', color: '#fff', border: 'none', cursor: 'pointer' }} onClick={() => { setShowDiscardConfirm(false); setCroppedAvatar(null); onClose(); }}>Discard</button>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="profile-edit-card">
                <header className="pe-header" style={{ justifyContent: 'flex-start', gap: '1.5rem' }}>
                    <button className="icon-button" onClick={handleCloseEditor} disabled={saving}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <h2>Account Settings</h2>
                    <div style={{ width: '40px' }}></div>
                </header>
                
                <div className="pe-body">
                    <div id="pe-field-avatar">
                        <ProfileAvatarPicker 
                            displayAvatar={displayAvatar}
                            displayFullName={`${editForm.sureName} ${editForm.fatherName}`.trim()}
                            username={editForm.username}
                            onFileSelect={setSelectedFile}
                            disabled={saving}
                        />
                    </div>
                    
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

                        <div className="input-group-sm" id="pe-field-sex" style={{ marginTop: '0.5rem' }}>
                            <label>Gender / ጾታ</label>
                            <div className="sex-selector-row">
                                <button
                                    type="button"
                                    className={`sex-card ${editForm.sex === 'male' ? 'active' : ''}`}
                                    onClick={() => setEditForm(prev => ({ ...prev, sex: 'male' }))}
                                    disabled={saving}
                                >
                                    <span className="sex-icon">👨</span>
                                    <div className="sex-labels">
                                        <span className="sex-primary">ወንድ</span>
                                        <span className="sex-sub">Male</span>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    className={`sex-card ${editForm.sex === 'female' ? 'active' : ''}`}
                                    onClick={() => setEditForm(prev => ({ ...prev, sex: 'female' }))}
                                    disabled={saving}
                                >
                                    <span className="sex-icon">👩</span>
                                    <div className="sex-labels">
                                        <span className="sex-primary">ሴት</span>
                                        <span className="sex-sub">Female</span>
                                    </div>
                                </button>
                            </div>
                        </div>
                        
                        <div className="input-group-sm" id="pe-field-bio" style={{ marginTop: '0.5rem' }}>
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
                                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Phone Number</span>
                                    {userProfile?.registered_with_telegram && (
                                        <span style={{ fontSize: '0.65rem', color: 'var(--accent-teal)', fontWeight: 700, textTransform: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <i className="fas fa-shield-check"></i> Verified with Telegram
                                        </span>
                                    )}
                                </label>
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <input 
                                        type="tel" 
                                        value={editForm.phone} 
                                        onChange={e => !userProfile?.registered_with_telegram && setEditForm({...editForm, phone: e.target.value})} 
                                        disabled={saving || userProfile?.registered_with_telegram}
                                        readOnly={userProfile?.registered_with_telegram}
                                        placeholder="09... or +251..."
                                        style={{
                                            paddingRight: userProfile?.registered_with_telegram ? '40px' : '16px',
                                            ...(phoneStatus === 'taken' || phoneStatus === 'invalid' ? { borderColor: '#ff5f5f' } : {})
                                        }}
                                    />
                                    {userProfile?.registered_with_telegram && (
                                        <span style={{ position: 'absolute', right: '14px', color: 'var(--accent-teal)', fontSize: '0.9rem' }}>
                                            <i className="fas fa-lock"></i>
                                        </span>
                                    )}
                                </div>
                                {userProfile?.registered_with_telegram ? (
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                        <span style={{ fontSize: '0.72rem', color: '#888' }}>
                                            Verified numbers are locked. To transfer to a new SIM, update via bot.
                                        </span>
                                        <button
                                            type="button"
                                            disabled={isLinkingPhone}
                                            onClick={handleInitiateBotPhoneChange}
                                            style={{
                                                background: 'rgba(41, 169, 234, 0.12)',
                                                border: '1px solid rgba(41, 169, 234, 0.35)',
                                                color: '#29A9EA',
                                                padding: '5px 10px',
                                                borderRadius: '8px',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {isLinkingPhone ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fab fa-telegram"></i> Change via Bot</>}
                                        </button>
                                    </div>
                                ) : (
                                    editForm.phone && phoneStatus !== 'idle' && (
                                        <div style={{ marginTop: '4px', fontSize: '0.75rem', fontWeight: 500, color: phoneStatus === 'taken' || phoneStatus === 'invalid' ? '#ff5f5f' : 'var(--accent-teal)' }}>
                                            {phoneStatus === 'checking' && <><i className="fas fa-circle-notch fa-spin"></i> Checking availability...</>}
                                            {phoneStatus === 'taken' && <><i className="fas fa-times-circle"></i> This phone number is already registered to another account.</>}
                                            {phoneStatus === 'invalid' && <><i className="fas fa-exclamation-circle"></i> Enter a valid phone number (e.g. 09... or +251...).</>}
                                            {phoneStatus === 'available' && <><i className="fas fa-check-circle"></i> Phone number available.</>}
                                        </div>
                                    )
                                )}
                            </div>
                        </div>

                        <h3 className="section-title" style={{marginTop: '1.5rem'}}>Academic Information</h3>
                        <div className="input-group-sm" id="pe-field-university">
                            <label>University</label>
                            <select className="wizard-select" style={{ marginTop: '0.5rem' }} value={editForm.university_id} onChange={e => setEditForm({...editForm, university_id: e.target.value})}>
                                <option value="" disabled>Select your university...</option>
                                {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                        </div>

                        <div id="pe-field-program">
                            <SelectionField label="Program Type" value={editForm.program} fieldKey="program" onOpen={(key, title) => setActiveSelectionModal({ fieldKey: key, title, options: PROGRAMS })} />
                        </div>
                        
                        <div id="pe-field-department">
                            <SelectionField label="Department" value={editForm.department} fieldKey="department" onOpen={(key, title) => setActiveSelectionModal({ fieldKey: key, title, options: DEPARTMENTS })} />
                        </div>

                        <div id="pe-field-academic_sub">
                            {editForm.department === 'Freshman' ? (
                                <>
                                    <SelectionField label="Freshman Stream" value={editForm.freshman_stream} fieldKey="freshman_stream" onOpen={(key, title) => setActiveSelectionModal({ fieldKey: key, title, options: STREAMS })} />
                                    <SelectionField label="Target Department" value={editForm.target_department} fieldKey="target_department" onOpen={(key, title) => setActiveSelectionModal({ fieldKey: key, title, options: DEPARTMENTS.filter(d => d !== 'Freshman') })} />
                                </>
                            ) : (
                                <SelectionField label="Year of Study" value={editForm.year} fieldKey="year" onOpen={(key, title) => setActiveSelectionModal({ fieldKey: key, title, options: YEARS })} />
                            )}
                        </div>
                    </div>
                </div>
                
                {alertNotice && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                        <div style={{ background: 'var(--surface-dark)', border: '1px solid var(--border-color)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title}
                            </h3>
                            <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice.msg}</p>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                            </div>
                        </div>
                    </div>
                )}

                <footer className="pe-footer">
                    <button className="pe-btn cancel" onClick={handleCloseEditor} disabled={saving}>Cancel</button>
                    <button 
                        className="pe-btn save" 
                        onClick={handleSaveProfile} 
                        disabled={
                            saving || 
                            usernameStatus === 'taken' || 
                            usernameStatus === 'invalid' || 
                            usernameStatus === 'checking' ||
                            (Boolean(editForm.phone.trim()) && (phoneStatus === 'taken' || phoneStatus === 'invalid' || phoneStatus === 'checking'))
                        }
                    >
                        {saving ? <i className="fas fa-circle-notch fa-spin"></i> : "Save Changes"}
                    </button>
                </footer>
            </div>

            {/* Reusable Full-Screen / Bottom Sheet Selection Modal */}
            {activeSelectionModal && (
                <div className="custom-modal-overlay" onClick={() => setActiveSelectionModal(null)} style={{ zIndex: 7000 }}>
                    <div className="custom-modal-card selection-modal-card" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-primary-dark)' }}>{activeSelectionModal.title}</h3>
                            <button className="icon-button" onClick={() => setActiveSelectionModal(null)} style={{ width: '32px', height: '32px', color: 'var(--text-secondary-dark)' }}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="sm-options-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
                            {activeSelectionModal.options.map(opt => {
                                const isSelected = editForm[activeSelectionModal.fieldKey] === opt;
                                return (
                                    <div 
                                        key={opt} 
                                        className={`sm-option-row ${isSelected ? 'active' : ''}`}
                                        onClick={() => {
                                            setEditForm(prev => ({ ...prev, [activeSelectionModal.fieldKey]: opt }));
                                            setActiveSelectionModal(null);
                                        }}
                                    >
                                        <span>{opt}</span>
                                        {isSelected && <i className="fas fa-check"></i>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfileEditor;