import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
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

    // Constants for Dropdowns
    const DEPARTMENTS = ['Freshman', 'Computer Science', 'Software Engineering', 'Management', 'Economics', 'Electrical Engineering', 'Mechanical Engineering', 'Health', 'Other'];
    const YEARS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
    const PROGRAMS = ['Regular', 'Extension'];
    const STREAMS = ['Natural Science', 'Social Science'];

    // Host-managed Identity State
    const [editForm, setEditForm] = useState({
        full_name: '', username: '', email: '', phone: '', university_id: '', 
        program: '', department: '', freshman_stream: '', target_department: '', year: ''
    });

    useEffect(() => {
        // Fetch Universities list
        supabase.from('universities').select('id, name').order('name')
            .then(({ data }) => { if (data) setUniversities(data); });
    }, []);

    useEffect(() => {
        if (userProfile) {
            setEditForm({
                full_name: userProfile.full_name || '',
                username: userProfile.username || '',
                email: sessionUser?.email || '',
                phone: userProfile.phone || '',
                university_id: userProfile.university_id || '',
                program: userProfile.program || '',
                department: userProfile.department || '',
                freshman_stream: userProfile.freshman_stream || '',
                target_department: userProfile.target_department || '',
                year: userProfile.year || ''
            });
        }
    }, [userProfile, sessionUser]);

    const handleSaveProfile = async () => {
        setSaving(true);
        // Handle Email Update separately via Auth API
        if (editForm.email !== sessionUser?.email) {
            const { error: authError } = await supabase.auth.updateUser({ email: editForm.email });
            if (authError) {
                alert(`Email update failed: ${authError.message}`);
                setSaving(false);
                return;
            } else {
                alert('Email change requested. Please check your inbox for verification links.');
            }
        }

        // Profile Table Update
        const profileData = {
            full_name: editForm.full_name,
            phone: editForm.phone,
            university_id: editForm.university_id || null,
            program: editForm.program || null,
            department: editForm.department || null,
            freshman_stream: editForm.freshman_stream || null,
            target_department: editForm.target_department || null,
            year: editForm.year || null
        };

        const { error } = await supabase.from('profiles').update(profileData).eq('id', userProfile.id);
        
        setSaving(false);
        if (!error) {
            setIsEditingProfile(false);
            window.location.reload(); 
        } else {
            alert(error.message);
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
                    <div className="profile-edit-card">
                        <header className="pe-header">
                            <h2>Account Settings</h2>
                            <button className="icon-button" onClick={() => setIsEditingProfile(false)} disabled={saving}><i className="fas fa-times"></i></button>
                        </header>
                        
                        <div className="pe-body">
                            <div className="pe-avatar-section">
                                <img src={userProfile?.avatar_url || 'https://via.placeholder.com/150'} alt="Profile" className="pe-avatar-preview" />
                                <div className="pe-avatar-info">
                                    <h3>{editForm.full_name || 'Scholar'}</h3>
                                    <p>@{editForm.username}</p>
                                </div>
                            </div>

                            <div className="pe-form-grid">
                                <div className="pe-input-group pe-full-width">
                                    <label>Full Name</label>
                                    <input className="pe-input" value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} />
                                </div>
                                
                                <div className="pe-input-group">
                                    <label>Email Address</label>
                                    <input className="pe-input" type="email" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                                </div>
                                
                                <div className="pe-input-group">
                                    <label>Phone Number</label>
                                    <input className="pe-input" type="tel" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                                </div>

                                <div className="pe-input-group pe-full-width">
                                    <label>University</label>
                                    <select className="pe-select" value={editForm.university_id} onChange={e => setEditForm({...editForm, university_id: e.target.value})}>
                                        <option value="" disabled>Select your university...</option>
                                        {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                    </select>
                                </div>

                                <div className="pe-input-group">
                                    <label>Program Type</label>
                                    <select className="pe-select" value={editForm.program} onChange={e => setEditForm({...editForm, program: e.target.value})}>
                                        <option value="" disabled>Select program...</option>
                                        {PROGRAMS.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>

                                <div className="pe-input-group">
                                    <label>Department</label>
                                    <select className="pe-select" value={editForm.department} onChange={e => setEditForm({...editForm, department: e.target.value})}>
                                        <option value="" disabled>Select department...</option>
                                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>

                                {editForm.department === 'Freshman' ? (
                                    <>
                                        <div className="pe-input-group">
                                            <label>Freshman Stream</label>
                                            <select className="pe-select" value={editForm.freshman_stream} onChange={e => setEditForm({...editForm, freshman_stream: e.target.value})}>
                                                <option value="" disabled>Select stream...</option>
                                                {STREAMS.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                        <div className="pe-input-group">
                                            <label>Target Department</label>
                                            <select className="pe-select" value={editForm.target_department} onChange={e => setEditForm({...editForm, target_department: e.target.value})}>
                                                <option value="" disabled>Select target...</option>
                                                {DEPARTMENTS.filter(d => d !== 'Freshman').map(d => <option key={d} value={d}>{d}</option>)}
                                            </select>
                                        </div>
                                    </>
                                ) : (
                                    <div className="pe-input-group">
                                        <label>Year of Study</label>
                                        <select className="pe-select" value={editForm.year} onChange={e => setEditForm({...editForm, year: e.target.value})}>
                                            <option value="" disabled>Select year...</option>
                                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <footer className="pe-footer">
                            <button className="pe-btn cancel" onClick={() => setIsEditingProfile(false)} disabled={saving}>Cancel</button>
                            <button className="pe-btn save" onClick={handleSaveProfile} disabled={saving}>
                                {saving ? <i className="fas fa-circle-notch fa-spin"></i> : "Save Changes"}
                            </button>
                        </footer>
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