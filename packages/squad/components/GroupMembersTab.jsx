import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import { invokeSocial } from '../api.js';
import GenericConfirmModal from './GenericConfirmModal.jsx';
import PunishMemberModal from './PunishMemberModal.jsx';

const GroupMembersTab = ({ 
    conversationId, currentUser, members, setMembers, myRole, 
    onOpenUser, setIsProcessing, isProcessing, setAlertNotice, 
    showAddMember, setShowAddMember, activeMemberMenu, setActiveMemberMenu 
}) => {
    const [inviteContacts, setInviteContacts] = useState([]);
    const [confirmAddUser, setConfirmAddUser] = useState(null);
    const [confirmModal, setConfirmModal] = useState(null);
    const [punishConfig, setPunishConfig] = useState(null);

    // Fetch DM contacts for "Add Member" screen
    useEffect(() => {
        if (showAddMember) {
            supabase.rpc('get_user_conversations', { req_user_id: currentUser.id }).then(({data}) => {
                if (data) {
                    const contacts = data.filter(c => c.type === 'dm' && !members[c.other_user_id]);
                    setInviteContacts(contacts);
                }
            });
        }
    }, [showAddMember, currentUser.id, members]);

    const executeAddMember = async () => {
        if (!confirmAddUser) return;
        setIsProcessing(true);
        try {
            const res = await invokeSocial({ action: 'admin_add_member', conversation_id: conversationId, target_user_id: confirmAddUser.other_user_id });
            if (res.error) throw new Error(res.error);
            
            setMembers(prev => ({
                ...prev,
                [confirmAddUser.other_user_id]: { role: 'member', name: confirmAddUser.other_user_name, avatar: confirmAddUser.other_user_avatar, is_current_member: true }
            }));
            setAlertNotice({ title: "Member Added", msg: `${confirmAddUser.other_user_name} has joined the squad!`, success: true });
        } catch(e) {
            setAlertNotice({ title: "Permission Denied", msg: e.message || "You are not allowed to add members.", success: false });
        }
        setIsProcessing(false);
        setConfirmAddUser(null);
        setShowAddMember(false);
    };

    const executeKick = async (uid) => {
        setIsProcessing(true);
        const { error } = await supabase.rpc('squad_kick_member', { req_conv_id: conversationId, req_target_id: uid });
        setIsProcessing(false);
        if (error) {
            setAlertNotice({ title: "Action Failed", msg: error.message, success: false });
        } else {
            setMembers(prev => {
                const next = { ...prev };
                delete next[uid];
                return next;
            });
            setAlertNotice({ title: "Member Removed", msg: "The user has been kicked.", success: true });
        }
        setConfirmModal(null);
    };

    const executePunishment = async () => {
        setIsProcessing(true);
        const { uid, type, isTemp, duration, unit } = punishConfig;
        
        let until = null;
        if (isTemp) {
            const safeDuration = duration === '' || isNaN(duration) ? 1 : duration;
            const multipliers = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
            const ms = safeDuration * multipliers[unit];
            until = new Date(Date.now() + ms).toISOString();
        } else {
            until = type === 'mute' ? new Date(Date.now() + 3153600000000).toISOString() : null;
        }

        let error = null;
        if (type === 'ban') {
            const res = await supabase.rpc('squad_ban_member', { req_conv_id: conversationId, req_target_id: uid, req_banned_until: until });
            error = res.error;
            if (!error) {
                setMembers(prev => {
                    const next = { ...prev };
                    delete next[uid];
                    return next;
                });
            }
        } else {
            const res = await supabase.rpc('squad_mute_member', { req_conv_id: conversationId, req_target_id: uid, req_muted_until: until });
            error = res.error;
        }
        
        setIsProcessing(false);
        if (error) {
            setAlertNotice({ title: "Action Failed", msg: error.message, success: false });
        } else {
            setAlertNotice({ title: "Restriction Applied", msg: `The user has been successfully ${type === 'ban' ? 'banned' : 'restricted'}.`, success: true });
        }
        setPunishConfig(null);
    };

    return (
        <>
            <div className="si-directory">
                {Object.entries(members).filter(([_, m]) => m.is_current_member).map(([uid, m]) => (
                    <div className="si-member-row" key={uid} onClick={() => onOpenUser(uid)} style={{cursor: 'pointer'}}>
                        <img src={m.avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="si-member-avatar" />
                        <div className="si-member-info">
                            <div className="si-member-name">
                                {m.name} {uid === currentUser.id && <span style={{fontSize:'0.7rem', color:'#888'}}>(You)</span>}
                            </div>
                            <span className={`si-member-role ${m.role === 'owner' ? 'si-role-owner' : 'si-role-member'}`}>{m.role}</span>
                        </div>
                        {myRole === 'owner' && uid !== currentUser.id && (
                            <div className="si-member-actions" style={{ position: 'relative' }}>
                                <button className="si-action-btn" onClick={(e) => { e.stopPropagation(); setActiveMemberMenu(activeMemberMenu === uid ? null : uid); }}>
                                    <i className="fas fa-ellipsis-v"></i>
                                </button>
                                {activeMemberMenu === uid && (
                                    <div className="si-dropdown-menu" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => { setActiveMemberMenu(null); setConfirmModal({ uid, name: m.name }); }}>
                                            <i className="fas fa-user-minus"></i> Kick User
                                        </button>
                                        <button onClick={() => { setActiveMemberMenu(null); setPunishConfig({ uid, type: 'mute', isTemp: true, duration: 1, unit: 'days' }); }}>
                                            <i className="fas fa-comment-slash"></i> Restrict Writing
                                        </button>
                                        <button className="danger" onClick={() => { setActiveMemberMenu(null); setPunishConfig({ uid, type: 'ban', isTemp: true, duration: 1, unit: 'days' }); }}>
                                            <i className="fas fa-ban"></i> Ban User
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Full Screen Add Member Overlay */}
            {showAddMember && (
                <div className="si-fullscreen-overlay">
                    <header className="si-fs-header">
                        <button className="icon-button" onClick={() => setShowAddMember(false)}><i className="fas fa-chevron-left"></i></button>
                        <h2>Add Member</h2>
                        <div style={{width:'36px'}}></div>
                    </header>
                    <div className="si-fs-body">
                        {inviteContacts.length === 0 ? (
                            <div className="si-vault-empty">
                                <i className="fas fa-user-slash"></i>
                                <p>No eligible contacts found in your DMs.</p>
                            </div>
                        ) : (
                            inviteContacts.map(c => (
                                <div className="si-member-row" key={c.other_user_id} style={{cursor:'pointer'}} onClick={() => setConfirmAddUser(c)}>
                                    <img src={c.other_user_avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="si-member-avatar" />
                                    <div className="si-member-info">
                                        <div className="si-member-name">{c.other_user_name}</div>
                                        <span className="si-member-role si-role-member">Contact</span>
                                    </div>
                                    <i className="fas fa-plus" style={{color:'var(--accent-teal)'}}></i>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {confirmAddUser && (
                <GenericConfirmModal
                    title="Add to Squad"
                    description={<>Add <strong>{confirmAddUser.other_user_name}</strong> to the squad?</>}
                    onConfirm={executeAddMember}
                    onCancel={() => setConfirmAddUser(null)}
                    confirmText="Confirm Add"
                    isProcessing={isProcessing}
                    isDanger={false}
                />
            )}

            {confirmModal && (
                <GenericConfirmModal
                    title="Kick Member"
                    description={<>Are you sure you want to remove <strong>{confirmModal.name}</strong> from the squad? They can rejoin if the group is public.</>}
                    onConfirm={() => executeKick(confirmModal.uid)}
                    onCancel={() => setConfirmModal(null)}
                    confirmText="Kick User"
                    isProcessing={isProcessing}
                    isDanger={true}
                />
            )}

            <PunishMemberModal 
                punishConfig={punishConfig} 
                setPunishConfig={setPunishConfig} 
                executePunishment={executePunishment} 
                isProcessing={isProcessing} 
                members={members} 
            />
        </>
    );
};

export default GroupMembersTab;