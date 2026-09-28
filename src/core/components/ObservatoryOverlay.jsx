import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform, getAvatarFallback } from '@linkup-platform/sdk-core';
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
                    <h2 className="overlay-title">Personal Observatory</h2>
                    <button className="close-btn" onClick={onClose}><i className="fas fa-times"></i></button>
                </header>
                <div className="overlay-inner-content">
                    {/* Top Stat Cards */}
                    <section className="dashboard-section fade-in-up" style={{ transitionDelay: '0.1s' }}>
                        <div className="dashboard-scroll-wrapper">
                            <div className="dashboard-track">
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
                                <div className="dashboard-card">
                                    <div className="icon"><i className="fas fa-brain"></i></div>
                                    <div>
                                        <div className="value">
                                            <AnimatedValue target={data?.topics_mastered || 0} isActive={isActive} />
                                        </div>
                                        <div className="label">Topics Mastered</div>
                                    </div>
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
                                Global Rank #{data?.my_standing?.rank || '--'} of {data?.my_standing?.total_scholars || '--'} Scholars
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
                                        <span className="player-name">{player.is_user ? 'You' : player.name}</span>
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
                                        <div className="player-rank">#{data.my_standing.rank}</div>
                                        <img 
                                            src={data.my_standing.avatar_url || getAvatarFallback(data.my_standing.name)} 
                                            alt="You" 
                                            className="player-avatar" 
                                        />
                                        <div className="player-details-col">
                                            <span className="player-name">You</span>
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

                    {/* Analytics Suite (Real 49-Day Heatmap & Weekly Bars) */}
                    <section className="analytics-suite fade-in-up" style={{ transitionDelay: '0.3s' }}>
                        <h2 className="section-title"><span>Study Analytics</span></h2>
                        <div className="analytics-grid">
                            <div>
                                <h3 className="analytics-card-title">49-Day Commitment Grid</h3>
                                <div className="heatmap-grid">
                                    {heatmapCells.map((cell, i) => (
                                        <div 
                                            key={i} 
                                            className={`heatmap-cell level-${cell.level}`}
                                            title={`${cell.date}: ${Math.round((cell.active_seconds || 0) / 60)} mins (${cell.interactions || 0} actions)`}
                                        ></div>
                                    ))}
                                </div>
                                <div className="heatmap-legend">
                                    <span>Less</span>
                                    <span className="legend-cell level-0"></span>
                                    <span className="legend-cell level-1"></span>
                                    <span className="legend-cell level-2"></span>
                                    <span className="legend-cell level-3"></span>
                                    <span>More</span>
                                </div>
                            </div>
                            <div>
                                <h3 className="analytics-card-title">Weekly Study Velocity</h3>
                                <div className="chart-bars">
                                    {weeklyBars.map((b, i) => {
                                        const pct = Math.min(100, Math.max(8, (b.hours / maxWeeklyHours) * 100));
                                        return (
                                            <div key={i} className={`bar-group ${b.is_today ? 'is-today' : ''}`}>
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
                    </section>
                </div>
            </div>
        </div>
    );
};

export default ObservatoryOverlay;