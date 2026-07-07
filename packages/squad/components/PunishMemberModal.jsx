import React from 'react';

const PunishMemberModal = ({ punishConfig, setPunishConfig, executePunishment, isProcessing, members }) => {
    if (!punishConfig) return null;

    return (
        <div className="custom-modal-overlay">
            <div className="custom-modal-card">
                <h3>{punishConfig.type === 'ban' ? 'Ban Member' : 'Restrict Writing'}</h3>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#aaa' }}>
                    Configure restriction for <strong>{members[punishConfig.uid]?.name}</strong>:
                </p>
                
                <div className="cm-radio-group">
                    <label className="cm-radio-label">
                        <input type="radio" checked={punishConfig.isTemp} onChange={() => setPunishConfig({...punishConfig, isTemp: true})} />
                        Temporary
                    </label>
                    <label className="cm-radio-label">
                        <input type="radio" checked={!punishConfig.isTemp} onChange={() => setPunishConfig({...punishConfig, isTemp: false})} />
                        Permanent
                    </label>
                </div>

                {punishConfig.isTemp && (
                    <div className="cm-duration-inputs">
                        <input 
                            type="number" 
                            min="1" 
                            value={punishConfig.duration} 
                            onChange={e => setPunishConfig({...punishConfig, duration: e.target.value === '' ? '' : parseInt(e.target.value)})} 
                        />
                        <select value={punishConfig.unit} onChange={e => setPunishConfig({...punishConfig, unit: e.target.value})}>
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                        </select>
                    </div>
                )}

                <div className="cm-footer">
                    <button className="cm-btn-cancel" onClick={() => setPunishConfig(null)} disabled={isProcessing}>Cancel</button>
                    <button className="cm-btn-danger" onClick={executePunishment} disabled={isProcessing}>
                        {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : `Apply ${punishConfig.type === 'ban' ? 'Restriction' : 'Restriction'}`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PunishMemberModal;