import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';

const PunishMemberModal = ({ punishConfig, setPunishConfig, executePunishment, isProcessing, members }) => {
    const { t } = usePlatform();
    if (!punishConfig) return null;

    return (
        <div className="custom-modal-overlay">
            <div className="custom-modal-card">
                <h3>{punishConfig.type === 'ban' ? t('punish_ban_title', null, 'Ban Member') : t('punish_restrict_title', null, 'Restrict Writing')}</h3>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#aaa' }}>
                    {t('punish_configure', null, 'Configure restriction for')} <strong>{members[punishConfig.uid]?.name}</strong>:
                </p>
                
                <div className="cm-radio-group">
                    <label className="cm-radio-label">
                        <input type="radio" checked={punishConfig.isTemp} onChange={() => setPunishConfig({...punishConfig, isTemp: true})} />
                        {t('punish_temp', null, 'Temporary')}
                    </label>
                    <label className="cm-radio-label">
                        <input type="radio" checked={!punishConfig.isTemp} onChange={() => setPunishConfig({...punishConfig, isTemp: false})} />
                        {t('punish_perm', null, 'Permanent')}
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
                            <option value="minutes">{t('punish_minutes', null, 'Minutes')}</option>
                            <option value="hours">{t('punish_hours', null, 'Hours')}</option>
                            <option value="days">{t('punish_days', null, 'Days')}</option>
                            <option value="weeks">{t('punish_weeks', null, 'Weeks')}</option>
                            <option value="months">{t('punish_months', null, 'Months')}</option>
                        </select>
                    </div>
                )}

                <div className="cm-footer">
                    <button className="cm-btn-cancel" onClick={() => setPunishConfig(null)} disabled={isProcessing}>{t('common_cancel', null, 'Cancel')}</button>
                    <button className="cm-btn-danger" onClick={executePunishment} disabled={isProcessing}>
                        {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : (punishConfig.type === 'ban' ? t('punish_apply_ban', null, 'Apply Restriction') : t('punish_apply_restrict', null, 'Apply Restriction'))}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PunishMemberModal;