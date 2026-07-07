import React from 'react';

const LiveStageSetupModal = ({
    showLiveSetup,
    setShowLiveSetup,
    liveSetupData,
    setLiveSetupData,
    startLiveSession,
    isStartingLive
}) => {
    if (!showLiveSetup) return null;

    return (
        <div className="custom-modal-overlay" onClick={() => setShowLiveSetup(false)}>
            <div className="custom-modal-card" onClick={e => e.stopPropagation()}>
                <h3 style={{marginBottom: '1rem'}}><i className="fas fa-broadcast-tower" style={{color: 'var(--accent-teal)', marginRight: '8px'}}></i> Host Live Session</h3>
                
                <div className="si-settings-group">
                    <label className="si-label">Main Topic</label>
                    <input 
                        type="text" 
                        className="cm-text-input" 
                        placeholder="e.g. Thermodynamics Review"
                        value={liveSetupData.topic}
                        onChange={e => setLiveSetupData({...liveSetupData, topic: e.target.value})}
                        style={{marginBottom: '1rem'}}
                    />
                    
                    <label className="si-label">Description (Optional)</label>
                    <input 
                        type="text" 
                        className="cm-text-input" 
                        placeholder="e.g. Chapters 3-5"
                        value={liveSetupData.description}
                        onChange={e => setLiveSetupData({...liveSetupData, description: e.target.value})}
                        style={{marginBottom: '1rem'}}
                    />

                    <label className="si-label">Course</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                        {['Physics', 'Chemistry', 'Mathematics', 'Biology', 'CS', 'General'].map(c => (
                            <div 
                                key={c} 
                                className={`qa-pill ${liveSetupData.course === c ? 'active' : ''}`} 
                                onClick={() => setLiveSetupData({...liveSetupData, course: c})}
                            >
                                {c}
                            </div>
                        ))}
                    </div>
                    <input 
                        type="text" 
                        className="cm-text-input" 
                        placeholder="Or type custom course..."
                        value={liveSetupData.course}
                        onChange={e => setLiveSetupData({...liveSetupData, course: e.target.value})}
                    />
                </div>
                
                <div className="cm-footer" style={{marginTop: '1rem'}}>
                    <button className="cm-btn-cancel" onClick={() => setShowLiveSetup(false)}>Cancel</button>
                    <button 
                        className="cm-btn-primary" 
                        onClick={() => { setShowLiveSetup(false); startLiveSession(liveSetupData); }} 
                        disabled={!liveSetupData.topic?.trim() || !liveSetupData.course?.trim() || isStartingLive}
                    >
                        {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Go Live'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LiveStageSetupModal;