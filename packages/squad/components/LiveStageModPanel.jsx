import React from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';

const LiveStageModPanel = ({ hostTab, setHostTab, pendingQs, approvedQs, members, handleModAction, modLoading }) => {
    const { t } = usePlatform();
    return (
        <div className="host-mod-panel">
            <div className="mod-tabs">
                <button className={hostTab === 'pending' ? 'active' : ''} onClick={() => setHostTab('pending')}>
                    {t('mod_inbox', null, 'Inbox')} {pendingQs.length > 0 && <span className="tab-counter-badge">{pendingQs.length}</span>}
                </button>
                <button className={hostTab === 'approved' ? 'active' : ''} onClick={() => setHostTab('approved')}>
                    {t('mod_approved', null, 'Approved')} {approvedQs.length > 0 && <span className="tab-counter-badge">{approvedQs.length}</span>}
                </button>
            </div>
            <div className="mod-q-list">
                {(hostTab === 'pending' ? pendingQs : approvedQs).map(q => (
                    <div key={q.id} className="mod-q-card">
                        <div className="mqc-header">{members[q.sender_id]?.name || 'Student'}</div>
                        <div className="mqc-text">{q.text}</div>
                        <div className="mqc-actions">
                            <button className="mod-btn pin" onClick={() => handleModAction(q.id, 'pin', { is_pinned: true, status: 'approved' })} disabled={modLoading?.id === q.id}>
                                {modLoading?.id === q.id && modLoading?.action === 'pin' ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-thumbtack"></i> {t('mod_pin', null, 'Pin')}</>}
                            </button>
                            {hostTab === 'pending' && (
                                <button className="mod-btn approve" onClick={() => handleModAction(q.id, 'approve', { status: 'approved' })} disabled={modLoading?.id === q.id}>
                                    {modLoading?.id === q.id && modLoading?.action === 'approve' ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-check"></i> {t('mod_approve', null, 'Approve')}</>}
                                </button>
                            )}
                            <button className="mod-btn dismiss" onClick={() => handleModAction(q.id, 'drop', { status: 'dropped', is_pinned: false })} disabled={modLoading?.id === q.id}>
                                {modLoading?.id === q.id && modLoading?.action === 'drop' ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-trash"></i> {t('mod_drop', null, 'Drop')}</>}
                            </button>
                        </div>
                    </div>
                ))}
                {(hostTab === 'pending' ? pendingQs : approvedQs).length === 0 && (
                    <div className="mod-empty">{t('mod_no_q', null, 'No questions in this queue.')}</div>
                )}
            </div>
        </div>
    );
};

export default LiveStageModPanel;