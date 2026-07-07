import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import ProfileEditor from './components/ProfileEditor.jsx';
import ObservatoryOverlay from './components/ObservatoryOverlay.jsx';
import MissionControlOverlay from './components/MissionControlOverlay.jsx';
import './Profile.css';

const Profile = () => {
    const { user: userProfile, sessionUser } = usePlatform();
    const [overlays, setOverlays] = useState({ observatory: false, mission: false });
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    
    const handleLogout = async () => {
        await supabase.auth.signOut();
    };
    
    const plexusRef = useRef(null);

    // Global Listener to open the Profile Editor externally
    useEffect(() => {
        const handleOpenEditor = () => setIsEditingProfile(true);
        window.addEventListener('open-profile-editor', handleOpenEditor);
        return () => window.removeEventListener('open-profile-editor', handleOpenEditor);
    }, []);

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
            
            const update = () => {
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
                animationFrameId = requestAnimationFrame(update);
            };
            update();
        }
        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <div className="tab-content active" id="profile-content">
            <div className="scrollable-content">
                <div className="profile-hero">
                    <div className="profile-banner"></div>
                    <div className="hero-content">
                        <div className="profile-avatar-wrapper">
                            <img src={userProfile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile?.full_name || 'Scholar')}&background=1e1e1e&color=42d7b8`} alt="Profile" className="profile-avatar-large" />
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

            <ObservatoryOverlay isActive={overlays.observatory} onClose={() => toggleOverlay('observatory', false)} />
            
            <ProfileEditor 
                isOpen={isEditingProfile} 
                onClose={() => setIsEditingProfile(false)} 
                userProfile={userProfile} 
                sessionUser={sessionUser} 
            />

            <MissionControlOverlay isActive={overlays.mission} onClose={() => toggleOverlay('mission', false)} />
        </div>
    );
};

export default Profile;