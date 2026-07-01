import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import AvatarCropperModal from './components/AvatarCropperModal.jsx';
import './Profile.css';

const Profile = () => {
    const { user: userProfile } = usePlatform();
    const [overlays, setOverlays] = useState({ observatory: false, mission: false });
    
    const handleLogout = async () => {
        await supabase.auth.signOut();
    };
    const [activeMissionTab, setActiveMissionTab] = useState('daily');
    
    const plexusRef = useRef(null);
    const starsRef = useRef(null);
    const { sessionUser } = usePlatform();
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [universities, setUniversities] = useState([]);
    const [saving, setSaving] = useState(false);
    const [alertNotice, setAlertNotice] = useState(null); // Unified notice system
    const [originalForm, setOriginalForm] = useState(null);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

    // Constants for Dropdowns
    const DEPARTMENTS = ['Freshman', 'Computer Science', 'Software Engineering', 'Management', 'Economics', 'Electrical Engineering', 'Mechanical Engineering', 'Health', 'Other'];
    const YEARS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
    const PROGRAMS = ['Regular', 'Extension'];
    const STREAMS = ['Natural Science', 'Social Science'];

    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);
    const [usernameStatus, setUsernameStatus] = useState('idle');
    const [expandedField, setExpandedField] = useState(null); // Tracks which chip-dropdown is open
    const fileInputRef = useRef(null);

    // Host-managed Identity State
    const [editForm, setEditForm] = useState({
        sureName: '', fatherName: '', username: '', email: '', phone: '', university_id: '', 
        program: '', department: '', freshman_stream: '', target_department: '', year: ''
    });

    // Reusable Custom Chip Dropdown component
    const ChipDropdown = ({ label, value, options, fieldKey, singleCol }) => {
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

    useEffect(() => {
        supabase.from('universities').select('id, name').order('name')
            .then(({ data }) => { if (data) setUniversities(data); });
    }, []);

    useEffect(() => {
        if (userProfile) {
            const parts = (userProfile.full_name || '').trim().split(' ');
            const initialData = {
                sureName: parts[0] || '',
                fatherName: parts.slice(1).join(' ') || '',
                username: userProfile.username || '',
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
    }, [userProfile, sessionUser]);
    
    const handleCloseEditor = () => {
        if (JSON.stringify(editForm) !== JSON.stringify(originalForm) || croppedAvatar) {
            setShowDiscardConfirm(true);
        } else {
            setIsEditingProfile(false);
        }
    };

    useEffect(() => {
        if (!editForm.username) {
            setUsernameStatus('idle');
            return;
        }

        const cleanUsername = editForm.username.toLowerCase().trim();
        
        if (userProfile && cleanUsername === userProfile.username?.toLowerCase()) {
            setUsernameStatus('available');
            return;
        }

        if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
            setUsernameStatus('invalid');
            return;
        }

        const checkAvailability = async () => {
            setUsernameStatus('checking');
            const { data, error } = await supabase.rpc('check_username_available', { req_username: cleanUsername });
            if (error) setUsernameStatus('error');
            else setUsernameStatus(data ? 'available' : 'taken');
        };

        const timer = setTimeout(checkAvailability, 500);
        return () => clearTimeout(timer);
    }, [editForm.username, userProfile]);

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

        // Clean up redundant fields if department changes
        const isFreshman = editForm.department === 'Freshman';
        
        const profileData = {
            full_name: finalFullName,
            username: editForm.username.toLowerCase().trim(),
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
        } else {
            setAlertNotice({ title: "Update Failed", msg: error.message });
        }
    };

    // Helper to toggle overlays
    const toggleOverlay = (name, isOpen) => {
        setOverlays(prev => ({ ...prev, [name]: isOpen }));
    };

    // Plexus Animation (Portal Card)
    useEffect(() => {
        const canvas = plexusRef.current;
        let animationFrameId;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            let w = canvas.width = 100;
            let h = canvas.height = 100;
            let points = [];
            for(let i = 0; i < 15; i++) {
                points.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, r: Math.random() * 1.5 + 1 });
            }
            const animate = () => {
                ctx.clearRect(0, 0, w, h);
                points.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
                    if(p.x < 0 || p.x > w) p.vx *= -1;
                    if(p.y < 0 || p.y > h) p.vy *= -1;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(66, 215, 184, 0.5)'; ctx.fill();
                });
                for(let i = 0; i < points.length; i++) {
                    for(let j = i + 1; j < points.length; j++) {
                        const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
                        if(dist < 50) {
                            ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(points[j].x, points[j].y);
                            ctx.strokeStyle = `rgba(66, 215, 184, ${1 - dist / 50})`; ctx.stroke();
                        }
                    }
                }
                animationFrameId = requestAnimationFrame(animate);
            };
            animate();
        }
        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, []);

    // Stars Animation (Observatory Overlay)
    useEffect(() => {
        if (overlays.observatory && starsRef.current) {
            const canvas = starsRef.current;
            const ctx = canvas.getContext('2d');
            let stars = [], width, height;
            
            const resize = () => {
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;
            };
            
            const initStars = () => {
                stars = [];
                for (let i = 0; i < 150; i++) {
                    stars.push({ x: Math.random() * width, y: Math.random() * height, r: Math.random() * 1.5, s: Math.random() * 0.5 + 0.1 });
                }
            };

            const animate = () => {
                if (!overlays.observatory) return;
                ctx.clearRect(0, 0, width, height);
                stars.forEach(s => {
                    s.y -= s.s;
                    if (s.y < 0) { s.y = height; s.x = Math.random() * width; }
                    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'white'; ctx.fill();
                });
                requestAnimationFrame(animate);
            };

            resize();
            initStars();
            animate();
            window.addEventListener('resize', resize);
            return () => window.removeEventListener('resize', resize);
        }
    }, [overlays.observatory]);

    // Animated Counters Logic
    const AnimatedValue = ({ target }) => {
        const [val, setVal] = useState(0);
        useEffect(() => {
            if (overlays.observatory) {
                let start = 0;
                const duration = 2000;
                const stepTime = 20;
                const steps = duration / stepTime;
                const increment = target / steps;
                const timer = setInterval(() => {
                    start += increment;
                    if (start >= target) {
                        setVal(target);
                        clearInterval(timer);
                    } else {
                        setVal(Math.floor(start));
                    }
                }, stepTime);
                return () => clearInterval(timer);
            } else {
                setVal(0);
            }
        }, [overlays.observatory, target]);
        return <span>{val}</span>;
    };

    return (
        <div className="tab-content active" id="profile-content">
            <div className="scrollable-content">
                <div className="profile-hero">
                    <div className="profile-banner"></div>
                    <div className="hero-content">
                        <div className="profile-avatar-wrapper">
                            <img src={userProfile?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200'} alt="Profile" className="profile-avatar-large" />
                        </div>
                        <div className="user-info">
                            <h1 className="profile-name">{userProfile?.full_name || 'Scholar'}</h1>
                            <p className="profile-level">{userProfile?.level || 'Division I'}</p>
                            <div className="linkoin-balance-hero">
                                <i className="fas fa-coins linkoin-icon-sm"></i>
                                <span>{userProfile?.linkoin_balance || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="page-content">
                    <div className="portal-cards-container">
                        <div className="portal-card" onClick={() => toggleOverlay('observatory', true)}>
                            <div className="portal-window">
                                <canvas className="plexus-canvas" ref={plexusRef}></canvas>
                            </div>
                            <div className="portal-content">
                                <h2 className="portal-title">Personal Observatory</h2>
                                <p className="portal-subtitle">Explore your complete journey</p>
                            </div>
                        </div>
                        <div className="portal-card" id="mission-portal-card" onClick={() => toggleOverlay('mission', true)}>
                            <div className="portal-window" style={{ color: 'var(--linkoin-gold)' }}><i className="fas fa-tasks"></i></div>
                            <div className="portal-content">
                                <h2 className="portal-title">Mission Control</h2>
                                <p className="portal-subtitle">Earn rewards and level up</p>
                            </div>
                        </div>
                    </div>

                    <div className="settings-group">
                        <h2 className="section-title"><span>Settings</span></h2>
                        <div className="settings-list">
                            <a href="#" className="list-item" onClick={(e) => { e.preventDefault(); setIsEditingProfile(true); }}>
                                <i className="fas fa-user-pen list-item-icon"></i><span className="list-item-text">Account & Registry</span><i className="fas fa-chevron-right list-item-chevron"></i>
                            </a>
                            <a href="#" className="list-item"><i className="fas fa-palette list-item-icon"></i><span className="list-item-text">Appearance</span><i className="fas fa-chevron-right list-item-chevron"></i></a>
                            <a href="#" className="list-item"><i className="fas fa-shield-halved list-item-icon"></i><span className="list-item-text">Privacy & Security</span><i className="fas fa-chevron-right list-item-chevron"></i></a>
                            <a href="#" className="list-item"><i className="fas fa-info-circle list-item-icon"></i><span className="list-item-text">Support & About</span><i className="fas fa-chevron-right list-item-chevron"></i></a>
                            <a href="#" className="list-item" onClick={handleLogout} style={{ color: '#ff4757' }}><i className="fas fa-sign-out-alt list-item-icon" style={{ color: '#ff4757' }}></i><span className="list-item-text">Log Out</span></a>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- OBSERVATORY OVERLAY --- */}
            <div className={`fullscreen-overlay ${overlays.observatory ? 'is-active' : ''}`}>
                <canvas id="stars-bg" ref={starsRef}></canvas>
                <div className="overlay-content">
                    <header className="overlay-header">
                        <h2 className="overlay-title">Observatory</h2>
                        <button className="close-btn" onClick={() => toggleOverlay('observatory', false)}><i className="fas fa-times"></i></button>
                    </header>
                    <div className="overlay-inner-content">
                        <section className="dashboard-section fade-in-up" style={{ transitionDelay: '0.1s' }}>
                            <div className="dashboard-scroll-wrapper">
                                <div className="dashboard-track">
                                    <div className="dashboard-card brain-score-card">
                                        <div className="icon"><i className="fas fa-brain"></i></div>
                                        <div><div className="value"><AnimatedValue target={850} /></div><div className="label">Brain Score</div></div>
                                    </div>
                                    <div className="dashboard-card">
                                        <div className="icon"><i className="fas fa-fire"></i></div>
                                        <div><div className="value"><AnimatedValue target={28} /></div><div className="label">Day Streak</div></div>
                                    </div>
                                    <div className="dashboard-card">
                                        <div className="icon"><i className="fas fa-book"></i></div>
                                        <div><div className="value"><AnimatedValue target={12} /></div><div className="label">Topics Mastered</div></div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section className="rank-showcase-card fade-in-up" style={{ transitionDelay: '0.2s' }}>
                            <header className="showcase-header"><div className="crest-emblem"><i className="fas fa-dragon"></i></div><div className="rank-title">Bronze Lancer</div></header>
                            <div className="ladder-list">
                                <div className="player-row"><div className="player-rank">#421</div><img src="https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100" alt="Avatar" className="player-avatar" /><div className="player-name">S. Chen</div></div>
                                <div className="player-row is-user"><div className="player-rank">#422</div><img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100" alt="Avatar" className="player-avatar" /><div className="player-name">You</div></div>
                                <div className="player-row"><div className="player-rank">#423</div><img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100" alt="Avatar" className="player-avatar" /><div className="player-name">M. Grant</div></div>
                            </div>
                        </section>
                        <section className="analytics-suite fade-in-up" style={{ transitionDelay: '0.3s' }}>
                            <h2 className="section-title"><span>Analytics Suite</span></h2>
                            <div className="analytics-grid">
                                <div>
                                    <h3 className="analytics-card-title">Commitment</h3>
                                    <div className="heatmap-grid">
                                        {[...Array(49)].map((_, i) => <div key={i} className={`heatmap-cell ${Math.random() > 0.7 ? 'level-3' : ''}`}></div>)}
                                    </div>
                                </div>
                                <div>
                                    <h3 className="analytics-card-title">Weekly Activity</h3>
                                    <div className="chart-bars">
                                        <div className="bar-group"><div className="bar" style={{ height: '40%' }}></div><span className="bar-label">M</span></div>
                                        <div className="bar-group"><div className="bar" style={{ height: '75%' }}></div><span className="bar-label">T</span></div>
                                        <div className="bar-group"><div className="bar" style={{ height: '60%' }}></div><span className="bar-label">W</span></div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>

            {/* --- HOST APP: IDENTITY MANAGER --- */}
            {/* --- HOST APP: IDENTITY MANAGER --- */}
            {isEditingProfile && (
                <div className="profile-edit-overlay">
                    {showDiscardConfirm && (
                        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                            <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#ff5f5f' }}>Discard Changes?</h3>
                                <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>You have unsaved changes. Are you sure you want to leave?</p>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                    <button style={{ padding: '10px 18px', borderRadius: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer' }} onClick={() => setShowDiscardConfirm(false)}>Stay</button>
                                    <button style={{ padding: '10px 18px', borderRadius: '10px', background: '#ff5f5f', color: '#fff', border: 'none', cursor: 'pointer' }} onClick={() => { setShowDiscardConfirm(false); setIsEditingProfile(false); setCroppedAvatar(null); }}>Discard</button>
                                </div>
                            </div>
                        </div>
                    )}
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
                    <div className="profile-edit-card">
                        <header className="pe-header" style={{ justifyContent: 'flex-start', gap: '1.5rem' }}>
                            <button className="icon-button" onClick={handleCloseEditor} disabled={saving}>
                                <i className="fas fa-chevron-left"></i>
                            </button>
                            <h2>Account & Registry</h2>
                            <div style={{ width: '40px' }}></div>
                        </header>
                        
                        <div className="pe-body">
                            <div className="onboarding-preview">
                                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
                                    e.target.value = null;
                                }} />
                                <div className="onboarding-avatar-container" onClick={() => fileInputRef.current?.click()}>
                                    <div className="onboarding-avatar-wrapper">
                                        <img src={croppedAvatar?.url || userProfile?.avatar_url || 'https://via.placeholder.com/150'} alt="Profile Preview" />
                                    </div>
                                    <div className="avatar-edit-badge" title="Change Avatar"><i className="fas fa-pencil"></i></div>
                                </div>
                                <div className="preview-info">
                                    <h3>{editForm.sureName} {editForm.fatherName}</h3>
                                    <p>@{editForm.username}</p>
                                </div>
                            </div>
                            
                            <div className="onboarding-form" style={{ marginTop: '2rem' }}>
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

                                <div className="input-group-sm handle-group">
                                    <label>Username</label>
                                    <div className={`handle-input-wrapper status-${usernameStatus}`}>
                                        <span className="handle-prefix">@</span>
                                        <input type="text" value={editForm.username} onChange={e => setEditForm({...editForm, username: e.target.value})} disabled={saving} maxLength={20} />
                                        <div className="handle-status-icon">
                                            {usernameStatus === 'checking' && <i className="fas fa-circle-notch fa-spin"></i>}
                                            {usernameStatus === 'available' && <i className="fas fa-check"></i>}
                                            {usernameStatus === 'taken' && <i className="fas fa-times"></i>}
                                            {usernameStatus === 'invalid' && <i className="fas fa-exclamation"></i>}
                                        </div>
                                    </div>
                                    <div className="handle-hint">
                                        {usernameStatus === 'invalid' && "3-20 chars. Lowercase, numbers, underscores."}
                                        {usernameStatus === 'taken' && "This username is already taken."}
                                        {usernameStatus === 'error' && "Connection error. Try again."}
                                        {usernameStatus === 'available' && "Looks great! It's all yours."}
                                    </div>
                                </div>

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

                                <div className="input-group-sm" style={{ marginTop: '1rem' }}>
                                    <label>University</label>
                                    <select className="wizard-select" style={{ marginTop: '0.5rem' }} value={editForm.university_id} onChange={e => setEditForm({...editForm, university_id: e.target.value})}>
                                        <option value="" disabled>Select your university...</option>
                                        {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                    </select>
                                </div>

                                <ChipDropdown 
                                    label="Program Type" 
                                    value={editForm.program} 
                                    options={PROGRAMS} 
                                    fieldKey="program" 
                                    singleCol={true} 
                                />

                                <ChipDropdown 
                                    label="Department" 
                                    value={editForm.department} 
                                    options={DEPARTMENTS} 
                                    fieldKey="department" 
                                />

                                {editForm.department === 'Freshman' ? (
                                    <>
                                        <ChipDropdown 
                                            label="Freshman Stream" 
                                            value={editForm.freshman_stream} 
                                            options={STREAMS} 
                                            fieldKey="freshman_stream" 
                                            singleCol={true} 
                                        />
                                        <ChipDropdown 
                                            label="Target Department" 
                                            value={editForm.target_department} 
                                            options={DEPARTMENTS.filter(d => d !== 'Freshman')} 
                                            fieldKey="target_department" 
                                        />
                                    </>
                                ) : (
                                    <ChipDropdown 
                                        label="Year of Study" 
                                        value={editForm.year} 
                                        options={YEARS} 
                                        fieldKey="year" 
                                    />
                                )}
                            </div>
                        </div>
                        
                        <footer className="pe-footer">
                            <button className="pe-btn cancel" onClick={handleCloseEditor} disabled={saving}>Cancel</button>
                            <button className="pe-btn save" onClick={handleSaveProfile} disabled={saving || usernameStatus === 'taken' || usernameStatus === 'invalid'}>
                                {saving ? <i className="fas fa-circle-notch fa-spin"></i> : "Save Changes"}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {/* Custom Alert Notice for Profile */}
            {alertNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title}
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice.msg}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => {
                                const wasSuccess = alertNotice.success;
                                setAlertNotice(null);
                                if (wasSuccess) setIsEditingProfile(false);
                            }}>Okay</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MISSION CONTROL OVERLAY --- */}
            <div className={`fullscreen-overlay ${overlays.mission ? 'is-active' : ''}`} id="mission-overlay">
                <div className="overlay-content">
                    <header className="overlay-header">
                        <h2 className="overlay-title">Mission Control</h2>
                        <button className="close-btn" onClick={() => toggleOverlay('mission', false)}><i className="fas fa-times"></i></button>
                    </header>
                    <div className="overlay-inner-content">
                        <nav className="tasks-nav fade-in-up" style={{ transitionDelay: '0.1s' }}>
                            {['daily', 'weekly', 'milestones'].map(tab => (
                                <div 
                                    key={tab} 
                                    className={`nav-tab ${activeMissionTab === tab ? 'active' : ''}`} 
                                    onClick={() => setActiveMissionTab(tab)}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </div>
                            ))}
                            <div className="nav-indicator" style={{ 
                                width: '33.33%', 
                                transform: `translateX(${activeMissionTab === 'daily' ? '0%' : activeMissionTab === 'weekly' ? '100%' : '200%'})` 
                            }}></div>
                        </nav>
                        <div className="tasks-list-container fade-in-up" style={{ transitionDelay: '0.2s' }}>
                            {activeMissionTab === 'daily' && (
                                <ul className="tasks-list active">
                                    <li><div className="task-card"><div className="task-icon"><i className="fas fa-check"></i></div><div className="task-details"><div className="task-title">First of the Day</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 50</div><button className="claim-btn claimed"><i className="fas fa-check"></i></button></div></div></li>
                                    <li><div className="task-card"><div className="task-icon"><i className="fas fa-lightbulb"></i></div><div className="task-details"><div className="task-title">Quick Quiz</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 75</div><button className="claim-btn claimable">Claim</button></div></div></li>
                                </ul>
                            )}
                            {activeMissionTab === 'weekly' && (
                                <ul className="tasks-list active">
                                    <li><div className="task-card"><div className="task-icon"><i className="fas fa-fire"></i></div><div className="task-details"><div className="task-title">Maintain a Streak</div></div><div className="task-action"><div className="reward-amount"><i className="fas fa-coins"></i> 500</div><button className="claim-btn disabled">In Progress</button></div></div></li>
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;