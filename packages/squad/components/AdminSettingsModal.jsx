import React from 'react';

const AdminSettingsModal = ({ localChatInfo, toggleAdminSetting, onClose }) => {
    return (
        <div className="custom-modal-overlay" onClick={onClose}>
            <div className="custom-modal-card" onClick={e => e.stopPropagation()}>
                <h3 style={{marginBottom: '1.5rem'}}><i className="fas fa-key" style={{color: 'var(--accent-teal)', marginRight: '8px'}}></i> Admin Controls</h3>
                
                <div className="cm-privacy-options">
                    <div className="si-settings-row" style={{marginBottom: '10px'}} onClick={() => toggleAdminSetting('members_can_add', localChatInfo.metadata?.members_can_add)}>
                        <div className="sr-info">
                            <h4 style={{fontSize: '0.95rem'}}>Members can add members</h4>
                            <p style={{fontSize: '0.8rem'}}>Allow everyone to invite others</p>
                        </div>
                        <div className="sr-val">
                            <div className={`toggle-switch ${(localChatInfo.metadata?.members_can_add !== false) ? 'on' : 'off'}`}></div>
                        </div>
                    </div>

                    <div className="si-settings-row" style={{marginBottom: '10px'}} onClick={() => toggleAdminSetting('members_can_post', localChatInfo.metadata?.members_can_post)}>
                        <div className="sr-info">
                            <h4 style={{fontSize: '0.95rem'}}>Members can post</h4>
                            <p style={{fontSize: '0.8rem'}}>Allow everyone to send messages</p>
                        </div>
                        <div className="sr-val">
                            <div className={`toggle-switch ${(localChatInfo.metadata?.members_can_post !== false) ? 'on' : 'off'}`}></div>
                        </div>
                    </div>

                    <div className="si-settings-row" style={{marginBottom: '10px'}} onClick={() => toggleAdminSetting('members_can_poll', localChatInfo.metadata?.members_can_poll)}>
                        <div className="sr-info">
                            <h4 style={{fontSize: '0.95rem'}}>Members can attach polls</h4>
                            <p style={{fontSize: '0.8rem'}}>Allow everyone to create polls</p>
                        </div>
                        <div className="sr-val">
                            <div className={`toggle-switch ${(localChatInfo.metadata?.members_can_poll !== false) ? 'on' : 'off'}`}></div>
                        </div>
                    </div>
                    
                    <div className="si-settings-row" style={{marginBottom: '0'}} onClick={() => toggleAdminSetting('hide_members', localChatInfo.metadata?.hide_members)}>
                        <div className="sr-info">
                            <h4 style={{fontSize: '0.95rem'}}>Hide member list</h4>
                            <p style={{fontSize: '0.8rem'}}>Only owners can view the directory</p>
                        </div>
                        <div className="sr-val">
                            <div className={`toggle-switch ${(localChatInfo.metadata?.hide_members === true) ? 'on' : 'off'}`}></div>
                        </div>
                    </div>
                </div>
                
                <div className="cm-footer" style={{marginTop: '2rem'}}>
                    <button className="cm-btn-primary" style={{width: '100%'}} onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
};

export default AdminSettingsModal;