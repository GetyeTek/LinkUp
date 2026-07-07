import React, { useState, useEffect, useRef } from 'react';
import './ObservatoryOverlay.css';

const AnimatedValue = ({ target, isActive }) => {
    const [val, setVal] = useState(0);
    useEffect(() => {
        if (isActive) {
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
    }, [isActive, target]);
    return <span>{val}</span>;
};

const ObservatoryOverlay = ({ isActive, onClose }) => {
    const starsRef = useRef(null);

    useEffect(() => {
        if (isActive && starsRef.current) {
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
                if (!isActive) return;
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
    }, [isActive]);

    return (
        <div className={`fullscreen-overlay ${isActive ? 'is-active' : ''}`}>
            <canvas id="stars-bg" ref={starsRef}></canvas>
            <div className="overlay-content">
                <header className="overlay-header">
                    <h2 className="overlay-title">Observatory</h2>
                    <button className="close-btn" onClick={onClose}><i className="fas fa-times"></i></button>
                </header>
                <div className="overlay-inner-content">
                    <section className="dashboard-section fade-in-up" style={{ transitionDelay: '0.1s' }}>
                        <div className="dashboard-scroll-wrapper">
                            <div className="dashboard-track">
                                <div className="dashboard-card brain-score-card">
                                    <div className="icon"><i className="fas fa-brain"></i></div>
                                    <div><div className="value"><AnimatedValue target={850} isActive={isActive} /></div><div className="label">Brain Score</div></div>
                                </div>
                                <div className="dashboard-card">
                                    <div className="icon"><i className="fas fa-fire"></i></div>
                                    <div><div className="value"><AnimatedValue target={28} isActive={isActive} /></div><div className="label">Day Streak</div></div>
                                </div>
                                <div className="dashboard-card">
                                    <div className="icon"><i className="fas fa-book"></i></div>
                                    <div><div className="value"><AnimatedValue target={12} isActive={isActive} /></div><div className="label">Topics Mastered</div></div>
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
    );
};

export default ObservatoryOverlay;