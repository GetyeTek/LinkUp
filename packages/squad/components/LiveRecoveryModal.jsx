import React from 'react';

const LiveRecoveryModal = ({ onEnd, onResume, isStartingLive }) => (
    <div className="custom-modal-overlay">
        <div className="custom-modal-card">
            <h3>Active Session Detected</h3>
            <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>
                You previously started a live broadcast. Would you like to resume your session or end it?
            </p>
            <div className="cm-footer">
                <button className="cm-btn-danger" onClick={onEnd} disabled={isStartingLive}>End Session</button>
                <button className="cm-btn-primary" onClick={onResume} disabled={isStartingLive}>
                    {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Resume'}
                </button>
            </div>
        </div>
    </div>
);

export default LiveRecoveryModal;