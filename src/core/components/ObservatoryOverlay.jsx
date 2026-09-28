import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform, getAvatarFallback, GoldBadge } from '@linkup-platform/sdk-core';
import './ObservatoryOverlay.css';

const AnimatedValue = ({ target = 0, isActive }) => {
    const [val, setVal] = useState(0);
    useEffect(() => {
        if (isActive && target > 0) {
            let start = 0;
            const duration = 1400;
            const stepTime = 25;
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
            setVal(target || 0);
        }
    }, [isActive, target]);
    return <span>{val}</span>;
};

const DIVISION_CONFIG = {
    'Division I': { icon: 'fa-shield-halved', badgeClass: 'div-1', label: 'Division I', min: 3500 },
    'Division II': { icon: 'fa-crown', badgeClass: 'div-2', label: 'Division II', min: 2500 },
    'Division III': { icon: 'fa-medal', badgeClass: 'div-3', label: 'Division III', min: 1500 },
    'Division IV': { icon: 'fa-award', badgeClass: 'div-4', label: 'Division IV', min: 600 },
    'Division V': { icon: 'fa-seedling', badgeClass: 'div-5', label: 'Division V', min: 0 }
};

const ObservatoryOverlay = ({ isActive, onClose }) => {
    const { sessionUser } = usePlatform();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const starsRef = useRef(null);

    useEffect(() => {
        if (!isActive || !sessionUser?.id) return;
        setLoading(true);

        supabase.rpc('get_personal_observatory_data', { p_user_id: sessionUser.id })
            .then(({ data: res, error }) => {
                if (!error && res) {
                    setData(res);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error('[Observatory] Failed to load telemetry:', err);
                setLoading(false);
            });
    }, [isActive, sessionUser?.id]);

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
                    stars.push({ 
                        x: Math.random() * width, 
                        y: Math.random() * height, 
                        r: Math.random() * 1.5, 
                        s: Math.random() * 0.5 + 0.1 
                    });
                }
            };

            const animate = () => {
                if (!isActive) return;
                ctx.clearRect(0, 0, width, height);
                stars.forEach(s => {
                    s.y -= s.s;
                    if (s.y < 0) { s.y = height; s.x = Math.random() * width; }
                    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; ctx.fill();
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

    const activeDivKey = data?.division || 'Division V';
    const divMeta = DIVISION_CONFIG[activeDivKey] || DIVISION_CONFIG['Division V'];
    const heatmapCells = data?.heatmap || [];
    const weeklyBars = data?.weekly_velocity || [];
    const maxWeeklyHours = Math.max(...weeklyBars.map(b => b.hours || 0), 2.0);

    return (
        <div className={`fullscreen-overlay ${isActive ? 'is-active' : ''}`}>
            <canvas id="stars-bg" ref={starsRef}></canvas>
            <div className="overlay-content">
                <header className="overlay-header">
                    <h2 className="overlay-title">Study Analytics</h2>
                    <button className="close-btn" onClick={onClose}><i className="fas fa-times"></i></button>
                </header>
                <div className="overlay-inner-content">
                    {/* Top Stat Cards */}
                    <section className="dashboard-section fade-in-up" style={{ transitionDelay: '0.1s' }}>
                        <div className="dashboard-track duo-track">
                            <div className="dashboard-card mr-score-card">
                                <div className="icon"><i className="fas fa-chart-line"></i></div>
                                <div>
                                    <div className="value">
                                        <AnimatedValue target={data?.mastery_rating || 0} isActive={isActive} />
                                    </div>
                                    <div className="label">Mastery Rating (MR)</div>
                                </div>
                            </div>
                            <div className="dashboard-card">
                                <div className="icon" style={{ color: '#ffab40' }}><i className="fas fa-fire"></i></div>
                                <div>
                                    <div className="value">
                                        <AnimatedValue target={data?.current_streak || 0} isActive={isActive} />
                                    </div>
                                    <div className="label">Day Streak</div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Division Standing & Crest */}
                    <section className={`rank-showcase-card ${divMeta.badgeClass} fade-in-up`} style={{ transitionDelay: '0.2s' }}>
                        <header className="showcase-header">
                            <div className={`crest-emblem ${divMeta.badgeClass}`}>
                                <i className={`fas ${divMeta.icon}`}></i>
                            </div>
                            <h3 className="rank-title">{divMeta.label}</h3>
                            <p className="rank-standing-subtitle">
                                {data?.my_standing?.is_hidden 
                                    ? 'Global Rank: Hidden (Private)' 
                                    : `Global Rank #${data?.my_standing?.rank || '--'} of ${data?.my_standing?.total_scholars || '--'} Students`}
                            </p>
                        </header>

                        {/* Global Top 10 Ladder */}
                        <div className="ladder-header-bar">
                            <span>Global Top 10</span>
                            <span>Mastery Rating</span>
                        </div>
                        <div className="ladder-list">
                            {(data?.leaderboard || []).map((player) => (
                                <div 
                                    key={player.id} 
                                    className={`player-row ${player.is_user ? 'is-user' : ''} ${player.rank <= 3 ? `top-${player.rank}` : ''}`}
                                >
                                    <div className="player-rank">
                                        {player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : `#${player.rank}`}
                                    </div>
                                    <img 
                                        src={player.avatar_url || getAvatarFallback(player.name)} 
                                        alt={player.name} 
                                        className="player-avatar" 
                                    />
                                    <div className="player-details-col">
                                        <span className="player-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            {player.is_user ? 'You' : player.name}
                                            {player.is_pro && <GoldBadge size="sm" />}
                                        </span>
                                        <span className={`player-div-tag ${DIVISION_CONFIG[player.division]?.badgeClass || 'div-5'}`}>
                                            {player.division}
                                        </span>
                                    </div>
                                    <div className="player-score-tag">{player.mastery_rating} MR</div>
                                </div>
                            ))}

                            {/* User standing pin if outside top 10 */}
                            {data?.my_standing && !data.my_standing.is_top10 && (
                                <>
                                    <div className="ladder-divider-dots">• • •</div>
                                    <div className="player-row is-user pinned-user-row">
                                        <div className="player-rank">{data.my_standing.is_hidden ? '—' : `#${data.my_standing.rank}`}</div>
                                        <img 
                                            src={data.my_standing.avatar_url || getAvatarFallback(data.my_standing.name)} 
                                            alt="You" 
                                            className="player-avatar" 
                                        />
                                        <div className="player-details-col">
                                            <span className="player-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                You {(data.my_standing.is_pro || userProfile?.is_pro) && <GoldBadge size="sm" />} {data.my_standing.is_hidden && <span style={{ fontSize: '0.72rem', color: '#ffab40', fontWeight: 'normal' }}>(Unlisted)</span>}
                                            </span>
                                            <span className={`player-div-tag ${divMeta.badgeClass}`}>
                                                {data.my_standing.division}
                                            </span>
                                        </div>
                                        <div className="player-score-tag">{data.my_standing.mastery_rating} MR</div>
                                    </div>
                                </>
                            )}
                        </div>
                    </section>

                    {/* Analytics Suite (Universal Habit Ring & Weekly Bars) */}
                    <section className="analytics-suite fade-in-up" style={{ transitionDelay: '0.3s' }}>
                        <h2 className="section-title"><span>Weekly Study Analytics</span></h2>
                        
                        {(() => {
                            const totalHours = weeklyBars.reduce((acc, b) => acc + (Number(b.hours) || 0), 0);
                            const activeDays = weeklyBars.filter(b => (b.active_seconds || 0) > 0).length;
                            const dailyAvg = (totalHours / 7).toFixed(1);
                            const activePct = Math.round((activeDays / 7) * 100);
                            const strokeDash = Math.round((activePct / 100) * 220);

                            return (
                                <div className="analytics-grid">
                                    {/* Left: Universal Habit Gauge */}
                                    <div className="habit-gauge-panel">
                                        <h3 className="analytics-card-title">Weekly Consistency</h3>
                                        
                                        <div className="habit-gauge-content">
                                            <div className="habit-ring-box">
                                                <svg className="habit-ring-svg" viewBox="0 0 80 80">
                                                    <circle cx="40" cy="40" r="35" className="habit-ring-bg" />
                                                    <circle 
                                                        cx="40" cy="40" r="35" 
                                                        className="habit-ring-fill" 
                                                        style={{ strokeDasharray: `${strokeDash} 220` }}
                                                    />
                                                </svg>
                                                <div className="habit-ring-text">
                                                    <span className="habit-ring-num">{activeDays}/7</span>
                                                    <span className="habit-ring-sub">Days</span>
                                                </div>
                                            </div>

                                            <div className="habit-stats-col">
                                                <div className="habit-stat-row">
                                                    <span className="stat-lbl">Time Studied</span>
                                                    <span className="stat-val">{totalHours.toFixed(1)} hrs</span>
                                                </div>
                                                <div className="habit-stat-row">
                                                    <span className="stat-lbl">Daily Average</span>
                                                    <span className="stat-val">{dailyAvg} hrs/day</span>
                                                </div>
                                                <div className="habit-stat-row">
                                                    <span className="stat-lbl">Consistency</span>
                                                    <span className="stat-val" style={{ color: 'var(--accent-teal)' }}>{activePct}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Daily Hours Bar Chart */}
                                    <div className="velocity-bar-panel">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h3 className="analytics-card-title" style={{ margin: 0 }}>Daily Study Hours</h3>
                                            <span style={{ fontSize: '0.72rem', color: '#888', fontFamily: 'Roboto Mono, monospace' }}>
                                                Mon — Sun
                                            </span>
                                        </div>
                                        
                                        <div className="chart-bars">
                                            {weeklyBars.map((b, i) => {
                                                const pct = Math.min(100, Math.max(8, (b.hours / maxWeeklyHours) * 100));
                                                return (
                                                    <div key={i} className={`bar-group ${b.is_today ? 'is-today' : ''}`}>
                                                        {b.hours > 0 && (
                                                            <span className="bar-val-pill">{b.hours}h</span>
                                                        )}
                                                        <div 
                                                            className="bar" 
                                                            style={{ height: `${pct}%` }}
                                                            title={`${b.hours} hrs on ${b.day}`}
                                                        ></div>
                                                        <span className="bar-label">{b.day}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default ObservatoryOverlay;