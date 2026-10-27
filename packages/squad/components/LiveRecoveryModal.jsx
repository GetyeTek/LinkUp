import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';

const LiveRecoveryModal = ({ onEnd, onResume, isStartingLive }) => {
    const { t } = usePlatform();
    return (
    <div className="custom-modal-overlay">
        <div className="custom-modal-card">
            <h3>{t('live_active_detected', null, 'Active Session Detected')}</h3>
            <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>
                {t('live_active_desc', null, 'You previously started a live broadcast. Would you like to resume your session or end it?')}
            </p>
            <div className="cm-footer">
                <button className="cm-btn-danger" onClick={onEnd} disabled={isStartingLive}>{t('live_end_session', null, 'End Session')}</button>
                <button className="cm-btn-primary" onClick={onResume} disabled={isStartingLive}>
                    {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : t('live_resume', null, 'Resume')}
                </button>
            </div>
        </div>
    </div>
    );
};

export default LiveRecoveryModal;