import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import { createPortal } from 'react-dom';
import { LiveKitRoom, useParticipants, RoomAudioRenderer } from 'https://esm.sh/@livekit/components-react@2.6.2?external=react,react-dom';
import AvatarCropperModal from '../../src/core/components/AvatarCropperModal.jsx';
import { invokeLiveToken } from './api.js';
import './GroupChat.css';

const FloatingLiveOrb = ({ hostAvatar, hostId, onClick }) => {
    const orbRef = useRef(null);
    const [pos, setPos] = useState({ x: window.innerWidth - 96, y: window.innerHeight - 240 });
    const dragStart = useRef(null);
    const participants = useParticipants();
    const hostParticipant = participants.find(p => p.identity === hostId);
    const isSpeaking = hostParticipant ? hostParticipant.isSpeaking : false;

    const handlePointerDown = (e) => {
        e.target.setPointerCapture(e.pointerId);
        dragStart.current = { 
            offsetX: e.clientX - pos.x, 
            offsetY: e.clientY - pos.y, 
            startX: e.clientX,
            startY: e.clientY,
            isDragging: false 
        };
    };

    const handlePointerMove = (e) => {
        if (!dragStart.current) return;
        
        const dx = Math.abs(e.clientX - dragStart.current.startX);
        const dy = Math.abs(e.clientY - dragStart.current.startY);
        
        // Touch jitter deadzone: Must move more than 8 pixels to be considered a drag
        if (dx > 8 || dy > 8) {
            dragStart.current.isDragging = true;
        }

        if (dragStart.current.isDragging) {
            const newX = e.clientX - dragStart.current.offsetX;
            const newY = e.clientY - dragStart.current.offsetY;
            setPos({ 
                x: Math.max(10, Math.min(newX, window.innerWidth - 86)), 
                y: Math.max(50, Math.min(newY, window.innerHeight - 100)) 
            });
        }
    };

    const handlePointerUp = (e) => {
        if (dragStart.current && !dragStart.current.isDragging) {
            onClick();
        }
        dragStart.current = null;
    };

    return (
        <div 
            className="floating-live-orb" 
            ref={orbRef} 
            style={{ left: pos.x, top: pos.y, display: 'flex' }}
            onPointerDown={handlePointerDown} 
            onPointerMove={handlePointerMove} 
            onPointerUp={handlePointerUp}
        >
            {isSpeaking && <div className="orb-pulse-ring"></div>}
            <img src={hostAvatar} className="floating-orb-host" alt="Live Host" />
            <div className="orb-expand-badge"><i className="fas fa-expand-alt"></i></div>
        </div>
    );
};

const LiveStageContent = ({ conversationId, chatInfo, members, liveState, setLiveState, onLeave, currentUser }) => {
    const [qInput, setQInput] = useState('');
    const [liveQuestions, setLiveQuestions] = useState([]);
    const [isSending, setIsSending] = useState(false);
    const [hostTab, setHostTab] = useState('pending'); // 'pending' | 'approved'
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const participants = useParticipants();
    
    const hostId = chatInfo.metadata?.live_host_id;
    const hostInfo = members[hostId] || { name: 'Host', avatar: 'https://via.placeholder.com/150' };
    const isMeHost = currentUser.id === hostId;
    
    const hostParticipant = participants.find(p => p.identity === hostId);
    const isHostSpeaking = hostParticipant ? hostParticipant.isSpeaking : false;

    // Derived Pause State based on WebRTC presence (fixes clock skew and DB sync delays)
    const isHostPaused = !isMeHost && !hostParticipant;

    const questionsEndRef = useRef(null);

    // Heartbeat Engine (Host Only)
    useEffect(() => {
        if (liveState !== 'full' || !isMeHost) return;
        const beat = () => {
            supabase.rpc('heartbeat_live_session', { conv_id: conversationId, req_host_id: currentUser.id });
        };
        beat(); // Initial pulse
        const int = setInterval(beat, 15000); // Pulse every 15s
        return () => clearInterval(int);
    }, [liveState, isMeHost, conversationId, currentUser.id]);

    // Independent Live Questions Subscription (Robust CRUD support)
    useEffect(() => {
        const fetchQs = async () => {
            const { data } = await supabase.from('live_stage_questions')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });
            if (data) setLiveQuestions(data.slice(-30)); // Hold up to 30 to support moderation queues
        };
        fetchQs();

        const sub = supabase.channel(`live_qs_${conversationId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_stage_questions', filter: `conversation_id=eq.${conversationId}` }, payload => {
                setLiveQuestions(p => {
                    if (payload.eventType === 'INSERT') return [...p, payload.new].slice(-30);
                    if (payload.eventType === 'UPDATE') return p.map(q => q.id === payload.new.id ? payload.new : q);
                    if (payload.eventType === 'DELETE') return p.filter(q => q.id !== payload.old.id);
                    return p;
                });
            }).subscribe();
        
        return () => supabase.removeChannel(sub);
    }, [conversationId]);

    useEffect(() => {
        if (questionsEndRef.current && !isMeHost) questionsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [liveQuestions, isMeHost]);

    const handleSendQuestion = async () => {
        if (!qInput.trim() || isSending) return;
        setIsSending(true);
        const { error } = await supabase.from('live_stage_questions').insert({
            conversation_id: conversationId,
            sender_id: currentUser.id,
            text: qInput.trim(),
            status: 'pending' // Defaults to pending
        });
        if (!error) setQInput('');
        setIsSending(false);
    };

    // Moderation Actions
    const updateQuestion = async (id, updates) => {
        setLiveQuestions(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
        const { error } = await supabase.from('live_stage_questions').update(updates).eq('id', id);
        if (error) console.error("Update failed:", error);
    };
    const deleteQuestion = async (id) => {
        setLiveQuestions(prev => prev.filter(q => q.id !== id));
        const { error } = await supabase.from('live_stage_questions').delete().eq('id', id);
        if (error) console.error("Drop failed:", error);
    };

    const pinnedQ = liveQuestions.find(q => q.is_pinned);
    const pendingQs = liveQuestions.filter(q => q.status === 'pending');
    const approvedQs = liveQuestions.filter(q => q.status === 'approved' && !q.is_pinned);
    // Attendants see approved/pinned, and their OWN pending questions
    const attendantViewQs = liveQuestions.filter(q => !q.is_pinned && (q.status === 'approved' || (q.status === 'pending' && q.sender_id === currentUser.id)));

    if (liveState === 'minimized') {
        return <FloatingLiveOrb hostAvatar={hostInfo.avatar} hostId={hostId} onClick={() => setLiveState('full')} />;
    }

    return (
        <div className="live-immersive-overlay" style={{ display: 'flex' }}>
            <div className="immersive-ambient"></div>
            
            {showEndConfirm && (
                <div className="custom-modal-overlay" style={{ zIndex: 10001 }}>
                    <div className="custom-modal-card">
                        <h3>End Live Session</h3>
                        <p>Are you sure you want to end the broadcast? This will disconnect all listeners and close the stage.</p>
                        <div className="cm-footer">
                            <button className="cm-btn-cancel" onClick={() => setShowEndConfirm(false)}>Cancel</button>
                            <button className="cm-btn-danger" onClick={() => { setShowEndConfirm(false); onLeave(true); }}>End Session</button>
                        </div>
                    </div>
                </div>
            )}

            <header className="immersive-header">
                <button className="minimize-stage-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLiveState('minimized'); }}><i className="fas fa-compress-alt"></i></button>
                <div className="stage-title-wrap">
                    <div className="stage-meta-indicator">
                        <span className="stage-live-dot"></span> Live Stage
                    </div>
                    <h2 className="stage-topic-title">{chatInfo.title}</h2>
                </div>
                <button 
                    className="minimize-stage-btn" 
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); isMeHost ? setShowEndConfirm(true) : onLeave(); }} 
                    style={{color: '#ff5f5f'}}
                >
                    <i className="fas fa-phone-slash"></i>
                </button>
            </header>

            <main className="stage-core">
                <div className="stage-host-node">
                    {isHostSpeaking && !isHostPaused && (
                        <>
                            <div className="voice-halo-ring"></div>
                            <div className="voice-halo-ring"></div>
                        </>
                    )}
                    
                    <img src={hostInfo.avatar} className="host-image-clip" style={{ filter: isHostPaused ? 'grayscale(100%) opacity(0.5)' : 'none' }} alt="Host" />
                    
                    {isHostPaused && (
                        <div className="host-offline-veil">
                            <i className="fas fa-satellite-dish"></i>
                        </div>
                    )}
                </div>

                <div className="stage-host-label">
                    <h2>{hostInfo.name}</h2>
                    <p>{isHostPaused ? "Connecting..." : "Broadcasting • Host"}</p>
                </div>

                {pinnedQ && (
                    <div className="pinned-hero-card">
                        <div className="ph-header">
                            <span className="ph-label"><i className="fas fa-thumbtack"></i> Pinned Topic</span>
                            {isMeHost && (
                                <button className="icon-button ph-unpin" onClick={() => updateQuestion(pinnedQ.id, { is_pinned: false })}>
                                    <i className="fas fa-times"></i>
                                </button>
                            )}
                        </div>
                        <div className="ph-asker">{members[pinnedQ.sender_id]?.name || 'Student'} asks:</div>
                        <div className="ph-text">{pinnedQ.text}</div>
                    </div>
                )}

                <div className="immersive-listeners-panel">
                    <span className="listeners-title">{participants.length} Listening</span>
                    <div className="listeners-row">
                        {participants.slice(0, 4).map((p, i) => (
                            <img key={p.identity || i} src={members[p.identity]?.avatar || 'https://via.placeholder.com/150'} alt="Listener" />
                        ))}
                        {participants.length > 4 && <div className="listeners-overflow">+{participants.length - 4}</div>}
                    </div>
                </div>

                {isMeHost ? (
                    <div className="host-mod-panel">
                        <div className="mod-tabs">
                            <button className={hostTab === 'pending' ? 'active' : ''} onClick={() => setHostTab('pending')}>
                                Pending Review ({pendingQs.length})
                            </button>
                            <button className={hostTab === 'approved' ? 'active' : ''} onClick={() => setHostTab('approved')}>
                                Approved Log
                            </button>
                        </div>
                        <div className="mod-q-list">
                            {(hostTab === 'pending' ? pendingQs : approvedQs).map(q => (
                                <div key={q.id} className="mod-q-card">
                                    <div className="mqc-header">{members[q.sender_id]?.name || 'Student'}</div>
                                    <div className="mqc-text">{q.text}</div>
                                    <div className="mqc-actions">
                                        <button className="mod-btn pin" onClick={() => updateQuestion(q.id, { is_pinned: true, status: 'approved' })}>
                                            <i className="fas fa-thumbtack"></i> Pin
                                        </button>
                                        {hostTab === 'pending' && (
                                            <button className="mod-btn approve" onClick={() => updateQuestion(q.id, { status: 'approved' })}>
                                                <i className="fas fa-check"></i> Approve
                                            </button>
                                        )}
                                        <button className="mod-btn dismiss" onClick={() => deleteQuestion(q.id)}>
                                            <i className="fas fa-trash"></i> Drop
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(hostTab === 'pending' ? pendingQs : approvedQs).length === 0 && (
                                <div className="mod-empty">No questions in this queue.</div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="stage-questions-box">
                        {attendantViewQs.map(q => (
                            <div key={q.id} className="stage-question-card" style={{ opacity: q.status === 'pending' ? 0.6 : 1 }}>
                                <div className="sq-meta">
                                    <span>{members[q.sender_id]?.name || 'Student'}</span>
                                    {q.status === 'pending' ? (
                                        <span className="q-status-badge">Pending Review <i className="fas fa-clock"></i></span>
                                    ) : (
                                        <span>Question</span>
                                    )}
                                </div>
                                <p className="sq-body-text">{q.text}</p>
                            </div>
                        ))}
                        <div ref={questionsEndRef} />
                    </div>
                )}
            </main>

            {!isMeHost && (
                <footer className="immersive-input-area">
                    <div className="immersive-dock">
                        <input 
                            type="text" 
                            placeholder={`Shoot a question to ${hostInfo.name.split(' ')[0]}...`} 
                            value={qInput} 
                            onChange={e => setQInput(e.target.value)} 
                            onKeyPress={e => { if (e.key === 'Enter') handleSendQuestion(); }} 
                            disabled={isSending}
                        />
                        <button className="question-send-btn" onClick={handleSendQuestion} disabled={!qInput.trim() || isSending}>
                            {isSending ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-arrow-up"></i>}
                        </button>
                    </div>
                </footer>
            )}
        </div>
    );
};

const GroupInfoPanel = ({ chatInfo, conversationId, currentUser, members, setMembers, messages, myRole, onClose, onUpdateInfo, onDisband, onOpenAdminSettings, onOpenUser }) => {
    const canSeeMembers = myRole === 'owner' || myRole === 'admin' || chatInfo.metadata?.hide_members !== true;
    
    const [activeTab, setActiveTab] = useState(canSeeMembers ? 'members' : 'media');
    const [mediaSubTab, setMediaSubTab] = useState('media'); // files, media, links
    
    useEffect(() => {
        if (!canSeeMembers && activeTab === 'members') {
            setActiveTab('media');
        }
    }, [canSeeMembers, activeTab]);
    
    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);
    const fileInputRef = useRef(null);
    
    const [editTitle, setEditTitle] = useState(chatInfo.title || '');
    const [nameStatus, setNameStatus] = useState('idle'); // idle, saving, success, error
    const [nameError, setNameError] = useState('');
    const [editSlug, setEditSlug] = useState(chatInfo.metadata?.slug || '');
    const [slugStatus, setSlugStatus] = useState('idle'); // idle, saving, success, error
    const [slugError, setSlugError] = useState('');
    const [editBio, setEditBio] = useState(chatInfo.metadata?.bio || '');
    const [bioStatus, setBioStatus] = useState('idle');
    const [editPrivacy, setEditPrivacy] = useState(chatInfo.metadata?.privacy || 'public');
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [alertNotice, setAlertNotice] = useState(null); // Unified Toast/Notice
    const [avatarError, setAvatarError] = useState(false);

    // Auto-hide success toasts after 3 seconds for premium UX
    useEffect(() => {
        if (alertNotice?.success) {
            const timer = setTimeout(() => setAlertNotice(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [alertNotice]);

    // Sync state if chatInfo metadata updates after initial mount
    useEffect(() => {
        setEditTitle(chatInfo.title || '');
        setEditSlug(chatInfo.metadata?.slug || '');
        setEditPrivacy(chatInfo.metadata?.privacy || 'public');
        setEditBio(chatInfo.metadata?.bio || '');
    }, [chatInfo.title, chatInfo.metadata]);

    // Reset avatar error state if the avatar URL actually changes
    useEffect(() => setAvatarError(false), [croppedAvatar, chatInfo.avatar_url]);

    // Menus & Modals
    const [showOptions, setShowOptions] = useState(false);
    const [showAddMember, setShowAddMember] = useState(false);
    const [inviteContacts, setInviteContacts] = useState([]);
    const [confirmAddUser, setConfirmAddUser] = useState(null);
    const [privacyModal, setPrivacyModal] = useState(false);
    const [tempPrivacy, setTempPrivacy] = useState(editPrivacy);
    const [inviteCopied, setInviteCopied] = useState(false);

    const [activeMemberMenu, setActiveMemberMenu] = useState(null);
    const [confirmModal, setConfirmModal] = useState(null);
    const [disbandModal, setDisbandModal] = useState(false);
    const [disbandInput, setDisbandInput] = useState('');
    const [punishConfig, setPunishConfig] = useState(null);

    // Auto-scrape Media Assets from Messages
    const mediaAssets = messages.flatMap(m => m.attachments ? m.attachments.filter(a => a.type.startsWith('image/') || a.type.startsWith('video/')) : []);
    const docFiles = messages.flatMap(m => m.attachments ? m.attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/')) : []);
    const sharedLinks = messages.flatMap(m => {
        if (!m.text) return [];
        const urls = m.text.match(/(https?:\/\/[^\s]+)/g) || [];
        return urls.map(url => ({ url, sender: members[m.sender_id]?.name || 'Unknown', time: m.created_at }));
    });

    // Strict DB truth. No front-end guessing.
    const squadHandle = chatInfo.metadata?.slug;
    
    let rawBase = window.location.origin + window.location.pathname;
    // Fix for Blob URLs generated by the IDE Preview environment
    if (window.location.href.startsWith('blob:')) {
        try { 
            rawBase = window.top.location.origin + window.top.location.pathname; 
        } catch (e) { 
            rawBase = window.location.origin + '/'; 
        }
    }
    const cleanBase = rawBase.split('?')[0].replace(/\/$/, '');
    
    const inviteLink = squadHandle ? `${cleanBase}?sq=${squadHandle}` : 'Fetching invitation link...';

    const isPublic = !chatInfo.metadata?.privacy || chatInfo.metadata.privacy === 'public';

    const handleCopyInvite = () => {
        navigator.clipboard.writeText(inviteLink);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
    };

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
        const { error } = await supabase.from('conversation_members').insert({
            conversation_id: conversationId, user_id: confirmAddUser.other_user_id, role: 'member'
        });
        setIsProcessing(false);
        
        if (error) {
            setAlertNotice({ title: "Permission Denied", msg: "You are not allowed to add members.", success: false });
        } else {
            setMembers(prev => ({
                ...prev,
                [confirmAddUser.other_user_id]: { role: 'member', name: confirmAddUser.other_user_name, avatar: confirmAddUser.other_user_avatar }
            }));
            setAlertNotice({ title: "Member Added", msg: `${confirmAddUser.other_user_name} has joined the squad!`, success: true });
        }
        setConfirmAddUser(null);
        setShowAddMember(false);
    };

    const updateSquadPrivacy = async (val) => {
        setIsProcessing(true);
        const newMeta = { ...chatInfo.metadata, privacy: val };
        const { data: updatedRows, error } = await supabase
            .from('conversations')
            .update({ metadata: newMeta })
            .eq('id', conversationId)
            .select();
        setIsProcessing(false);
            
        if (error || !updatedRows || updatedRows.length === 0) {
            setAlertNotice({ title: "Permission Denied", msg: "You are not authorized to update this group's settings.", success: false });
            setPrivacyModal(false);
            return;
        }
        
        const finalMeta = updatedRows[0].metadata;
        onUpdateInfo({ ...chatInfo, metadata: finalMeta });
        setEditPrivacy(val);
        setEditSlug(finalMeta.slug || '');
        setPrivacyModal(false);
        setAlertNotice({ title: "Privacy Updated", msg: `The group is now ${val}.`, success: true });
    };

    const updateSquadName = async () => {
        if (!editTitle.trim() || editTitle === chatInfo.title) return;
        
        setNameStatus('saving');
        const { data: updatedRows, error } = await supabase
            .from('conversations')
            .update({ title: editTitle })
            .eq('id', conversationId)
            .select();
            
        if (error || !updatedRows || updatedRows.length === 0) {
            setNameStatus('error');
            setNameError("Permission denied.");
            setEditTitle(chatInfo.title); // Revert UI
            return;
        }
        
        onUpdateInfo({ ...chatInfo, title: editTitle });
        setNameStatus('success');
        setTimeout(() => setNameStatus('idle'), 3000);
    };

    const updateSquadBio = async () => {
        const cleanBio = editBio.trim();
        if (cleanBio === (chatInfo.metadata?.bio || '')) return;
        
        setBioStatus('saving');

        const newMeta = { ...chatInfo.metadata, bio: cleanBio };
        const { data: updatedRows, error } = await supabase
            .from('conversations')
            .update({ metadata: newMeta })
            .eq('id', conversationId)
            .select();
        
        if (error || !updatedRows || updatedRows.length === 0) {
            setBioStatus('error');
            setAlertNotice({ title: "Permission Denied", msg: "You do not have permission to edit this group.", success: false });
            setEditBio(chatInfo.metadata?.bio || '');
            return;
        }

        onUpdateInfo({ ...chatInfo, metadata: newMeta });
        setBioStatus('success');
        setTimeout(() => setBioStatus('idle'), 3000);
    };

    const updateSquadSlug = async () => {
        const cleanSlug = editSlug.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!cleanSlug || cleanSlug === chatInfo.metadata?.slug) return;
        
        setSlugStatus('saving');

        // 1. Manually enforce uniqueness across the JSONB column
        const { data: existing } = await supabase
            .from('conversations')
            .select('id')
            .contains('metadata', { slug: cleanSlug })
            .neq('id', conversationId)
            .maybeSingle();

        if (existing) {
            setSlugStatus('error');
            setSlugError("Handle is already taken by another group.");
            return;
        }

        // 2. Perform Update and force response data to verify RLS success
        const newMeta = { ...chatInfo.metadata, slug: cleanSlug };
        const { data: updatedRows, error } = await supabase
            .from('conversations')
            .update({ metadata: newMeta })
            .eq('id', conversationId)
            .select();
        
        if (error || !updatedRows || updatedRows.length === 0) {
            setSlugStatus('error');
            setSlugError("Permission denied. Update rejected.");
            setEditSlug(chatInfo.metadata?.slug || ''); // Revert UI to truth
            return;
        }

        onUpdateInfo({ ...chatInfo, metadata: newMeta });
        setEditSlug(cleanSlug);
        setSlugStatus('success');
        setTimeout(() => setSlugStatus('idle'), 3000);
    };

    const handleAvatarUpdate = async (blob) => {
        const url = URL.createObjectURL(blob);
        setCroppedAvatar({ blob, url });
        setSelectedFile(null);

        // Auto-upload and save avatar immediately
        setIsSaving(true);
        const arrayBuffer = await blob.arrayBuffer();
        const filePath = `group_avatars/${conversationId}/avatar_${Date.now()}.png`;
        await supabase.storage.from('chat_media').upload(filePath, arrayBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabase.storage.from('chat_media').getPublicUrl(filePath);
        
        await supabase.from('conversations').update({ avatar_url: publicUrl }).eq('id', conversationId);
        onUpdateInfo({ ...chatInfo, avatar_url: publicUrl });
        setIsSaving(false);
        setCroppedAvatar(null);
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

    const executeDisband = async () => {
        if (disbandInput !== chatInfo.title) return;
        setIsProcessing(true);
        const { error } = await supabase.from('conversations').delete().eq('id', conversationId);
        setIsProcessing(false);
        if (error) {
            setAlertNotice({ title: "Action Failed", msg: error.message, success: false });
            setDisbandModal(false);
        } else {
            onDisband();
        }
    };

    const displayAvatar = croppedAvatar?.url || chatInfo.avatar_url;

    return (
        <div className="si-overlay" onClick={() => { setActiveMemberMenu(null); setShowOptions(false); }}>
            {selectedFile && (
                <AvatarCropperModal 
                    imageFile={selectedFile} 
                    onCancel={() => setSelectedFile(null)} 
                    onSave={handleAvatarUpdate}
                />
            )}
            <div className="si-sheet" onClick={(e) => { e.stopPropagation(); setShowOptions(false); setActiveMemberMenu(null); }}>
                <div className="si-hero">
                    <button className="si-back" onClick={onClose}><i className="fas fa-chevron-left"></i></button>
                    <div className="si-options-wrapper" style={{ display: 'flex', gap: '8px' }}>
                        {myRole === 'owner' && (
                            <button className="si-options" onClick={onOpenAdminSettings} title="Admin Controls">
                                <i className="fas fa-key"></i>
                            </button>
                        )}
                        {(myRole === 'owner' || myRole === 'admin' || chatInfo.metadata?.members_can_add !== false) && (
                            <>
                                <button className="si-options" onClick={(e) => { e.stopPropagation(); setShowOptions(!showOptions); setActiveMemberMenu(null); }}>
                                    <i className="fas fa-ellipsis-v"></i>
                                </button>
                                {showOptions && (
                                    <div className="si-dropdown-menu" style={{top: '40px', right: '0'}}>
                                        <button onClick={() => { setShowOptions(false); setShowAddMember(true); }}><i className="fas fa-user-plus"></i> Add Members</button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => {
                        if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
                        e.target.value = null;
                    }} />
                    <div className="si-avatar-container" onClick={() => myRole === 'owner' && fileInputRef.current?.click()} style={{cursor: myRole === 'owner' ? 'pointer' : 'default'}}>
                        <div className="si-avatar">
                            {displayAvatar && !avatarError ? <img src={displayAvatar} alt="Squad" onError={() => setAvatarError(true)} /> : <i className="fas fa-users"></i>}
                        </div>
                        {myRole === 'owner' && <div className="si-avatar-edit"><i className="fas fa-pencil"></i></div>}
                    </div>
                    <h2 className="si-title">{chatInfo.title}</h2>
                    <div className="si-ppn">#{conversationId.substring(0,8).toUpperCase()}</div>
                    <div className="si-badges">
                        <span className={`si-badge ${!isPublic ? 'private' : 'public'}`}>
                            <i className={`fas fa-${!isPublic ? 'lock' : 'globe'}`}></i> {!isPublic ? 'private' : 'public'}
                        </span>
                        {chatInfo.metadata?.focus && (
                            <span className="si-badge" style={{background: 'rgba(255,255,255,0.1)', color: '#ccc'}}>{chatInfo.metadata.focus}</span>
                        )}
                    </div>

                    {chatInfo.metadata?.bio && (
                        <div className="si-bio-display">
                            {chatInfo.metadata.bio}
                        </div>
                    )}

                    {isPublic && (
                        <div className="si-invite-box">
                            <div className="si-invite-url">{inviteLink}</div>
                            <button className="si-invite-copy-btn" onClick={handleCopyInvite}>
                                {inviteCopied ? <i className="fas fa-check"></i> : <i className="fas fa-copy"></i>}
                            </button>
                        </div>
                    )}
                </div>

                <div className="si-tabs">
                    {canSeeMembers && <div className={`si-tab ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>Members</div>}
                    <div className={`si-tab ${activeTab === 'media' ? 'active' : ''}`} onClick={() => setActiveTab('media')}>Media</div>
                    {myRole === 'owner' && <div className={`si-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Control Panel</div>}
                </div>

                <div className="si-body">
                    {activeTab === 'members' && canSeeMembers && (
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
                    )}

                    {activeTab === 'media' && (
                        <div className="si-vault">
                            <div className="si-media-pills">
                                <div className={`si-media-pill ${mediaSubTab === 'media' ? 'active' : ''}`} onClick={() => setMediaSubTab('media')}>Media</div>
                                <div className={`si-media-pill ${mediaSubTab === 'files' ? 'active' : ''}`} onClick={() => setMediaSubTab('files')}>Files</div>
                                <div className={`si-media-pill ${mediaSubTab === 'links' ? 'active' : ''}`} onClick={() => setMediaSubTab('links')}>Links</div>
                            </div>

                            <div className="si-media-content">
                                {mediaSubTab === 'media' && (
                                    mediaAssets.length > 0 ? (
                                        <div className="si-media-grid">
                                            {mediaAssets.map((m, i) => (
                                                <a href={m.url} target="_blank" rel="noopener noreferrer" className="si-media-thumb" key={i}>
                                                    <img src={m.url} alt="Media" />
                                                </a>
                                            ))}
                                        </div>
                                    ) : <div className="si-vault-empty"><i className="fas fa-image"></i><p>No photos or videos yet.</p></div>
                                )}

                                {mediaSubTab === 'files' && (
                                    docFiles.length > 0 ? (
                                        <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                                            {docFiles.map((f, i) => (
                                                <a href={f.url} target="_blank" rel="noopener noreferrer" className="si-vault-item" key={i}>
                                                    <div className="si-vault-icon"><i className="fas fa-file-pdf"></i></div>
                                                    <div className="si-vault-info">
                                                        <div className="si-vault-name">{f.name}</div>
                                                        <div className="si-vault-meta">{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                                                    </div>
                                                </a>
                                            ))}
                                        </div>
                                    ) : <div className="si-vault-empty"><i className="fas fa-file-alt"></i><p>No documents shared yet.</p></div>
                                )}

                                {mediaSubTab === 'links' && (
                                    sharedLinks.length > 0 ? (
                                        <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                                            {sharedLinks.map((l, i) => (
                                                <a href={l.url} target="_blank" rel="noopener noreferrer" className="si-vault-item" key={i}>
                                                    <div className="si-vault-icon link"><i className="fas fa-link"></i></div>
                                                    <div className="si-vault-info">
                                                        <div className="si-vault-name link">{l.url}</div>
                                                        <div className="si-vault-meta">From {l.sender}</div>
                                                    </div>
                                                </a>
                                            ))}
                                        </div>
                                    ) : <div className="si-vault-empty"><i className="fas fa-link"></i><p>No links shared yet.</p></div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'settings' && myRole === 'owner' && (
                        <div className="si-settings">
                            <div className="si-settings-group">
                                <label className="si-label">Group Name</label>
                                <div className="si-input-wrapper">
                                    <input 
                                        type="text" 
                                        className="si-input" 
                                        value={editTitle} 
                                        onChange={e => { setEditTitle(e.target.value); setNameStatus('idle'); }} 
                                        onKeyPress={e => e.key === 'Enter' && updateSquadName()}
                                    />
                                </div>
                                {(editTitle !== chatInfo.title || nameStatus !== 'idle') && (
                                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', minHeight: '30px' }}>
                                        {editTitle !== chatInfo.title && (
                                            <button className="si-save-slug-btn" onClick={updateSquadName} disabled={nameStatus === 'saving' || !editTitle.trim()}>
                                                {nameStatus === 'saving' ? 'Saving...' : 'Save Name'}
                                            </button>
                                        )}
                                        {nameStatus === 'error' && <span style={{ color: '#ff5f5f', fontSize: '0.8rem' }}><i className="fas fa-exclamation-triangle"></i> {nameError}</span>}
                                        {nameStatus === 'success' && <span style={{ color: '#42d7b8', fontSize: '0.8rem', animation: 'fadeIn 0.3s ease' }}><i className="fas fa-check-circle"></i> Name updated!</span>}
                                    </div>
                                )}
                            </div>

                            <div className="si-settings-group">
                                <label className="si-label">Group Description / Rules</label>
                                <div className="si-input-wrapper">
                                    <textarea 
                                        className="si-textarea" 
                                        value={editBio} 
                                        onChange={e => { setEditBio(e.target.value); setBioStatus('idle'); }} 
                                        placeholder="What is this group about?"
                                        maxLength={500}
                                        rows={3}
                                    />
                                </div>
                                {(editBio !== (chatInfo.metadata?.bio || '') || bioStatus !== 'idle') && (
                                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', minHeight: '30px' }}>
                                        {editBio !== (chatInfo.metadata?.bio || '') && (
                                            <button className="si-save-slug-btn" onClick={updateSquadBio} disabled={bioStatus === 'saving' || editBio.trim() === (chatInfo.metadata?.bio || '')}>
                                                {bioStatus === 'saving' ? 'Saving...' : 'Save Description'}
                                            </button>
                                        )}
                                        {bioStatus === 'error' && <span style={{ color: '#ff5f5f', fontSize: '0.8rem' }}><i className="fas fa-exclamation-triangle"></i> Failed</span>}
                                        {bioStatus === 'success' && <span style={{ color: '#42d7b8', fontSize: '0.8rem', animation: 'fadeIn 0.3s ease' }}><i className="fas fa-check-circle"></i> Saved!</span>}
                                    </div>
                                )}
                            </div>

                            {chatInfo.metadata?.privacy !== 'private' && (
                            <div className="si-settings-group">
                                <label className="si-label">Group Link Handle</label>
                                <div className="si-slug-container">
                                    <span className="si-slug-prefix">{cleanBase}?sq=</span>
                                    <input 
                                        type="text" 
                                        className="si-slug-input" 
                                        value={editSlug} 
                                        onChange={e => { setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '')); setSlugStatus('idle'); }} 
                                        onKeyPress={e => e.key === 'Enter' && updateSquadSlug()}
                                    />
                                </div>
                                {(editSlug !== (chatInfo.metadata?.slug || '') || slugStatus !== 'idle') && (
                                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', minHeight: '30px' }}>
                                        {editSlug !== (chatInfo.metadata?.slug || '') && (
                                            <button className="si-save-slug-btn" onClick={updateSquadSlug} disabled={slugStatus === 'saving' || !editSlug.trim()}>
                                                {slugStatus === 'saving' ? 'Saving...' : 'Save Handle'}
                                            </button>
                                        )}
                                        {slugStatus === 'error' && <span style={{ color: '#ff5f5f', fontSize: '0.8rem' }}><i className="fas fa-exclamation-triangle"></i> {slugError}</span>}
                                        {slugStatus === 'success' && <span style={{ color: '#42d7b8', fontSize: '0.8rem', animation: 'fadeIn 0.3s ease' }}><i className="fas fa-check-circle"></i> Handle updated!</span>}
                                    </div>
                                )}
                            </div>
                            )}

                            <div className="si-settings-row" onClick={() => setPrivacyModal(true)}>
                                <div className="sr-info">
                                    <h4>Privacy Status</h4>
                                    <p>{chatInfo.metadata?.privacy === 'public' ? 'Anyone can find and join' : 'Invite only'}</p>
                                </div>
                                <div className="sr-val">{chatInfo.metadata?.privacy} <i className="fas fa-chevron-right"></i></div>
                            </div>

                            <hr style={{border:'none', borderTop:'1px solid rgba(255,255,255,0.05)', margin:'2rem 0'}}/>

                            <div className="si-settings-group">
                                <label className="si-label" style={{color:'#ff5f5f'}}>Danger Zone</label>
                                <p style={{fontSize:'0.8rem', color:'#888', marginBottom:'1rem'}}>Deleting this group will permanently remove all associated messages, files, and links. This action is irreversible.</p>
                                <button className="si-disband-btn" onClick={() => setDisbandModal(true)}>
                                    <i className="fas fa-triangle-exclamation"></i> Delete Group
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Privacy Configuration Modal */}
            {privacyModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Squad Privacy</h3>
                        <p>Configure how others discover and join this group.</p>
                        <div className="cm-privacy-options">
                            <div className={`cm-privacy-card ${tempPrivacy === 'public' ? 'active' : ''}`} onClick={() => setTempPrivacy('public')}>
                                <i className="fas fa-globe"></i>
                                <div>
                                    <h4>Public</h4>
                                    <p>Searchable and accessible via Invite Link.</p>
                                </div>
                            </div>
                            <div className={`cm-privacy-card ${tempPrivacy === 'private' ? 'active' : ''}`} onClick={() => setTempPrivacy('private')}>
                                <i className="fas fa-lock"></i>
                                <div>
                                    <h4>Private</h4>
                                    <p>Hidden. Members must be added by Admin.</p>
                                </div>
                            </div>
                        </div>
                        <div className="cm-footer" style={{marginTop: '1rem'}}>
                            <button className="cm-btn-cancel" onClick={() => { setTempPrivacy(chatInfo.metadata?.privacy); setPrivacyModal(false); }} disabled={isProcessing}>Cancel</button>
                            <button className="cm-btn-primary" onClick={() => updateSquadPrivacy(tempPrivacy)} disabled={isProcessing}>
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : 'Confirm Status'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

            {/* Confirm Add Member Modal */}
            {confirmAddUser && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Add to Squad</h3>
                        <p>Add <strong>{confirmAddUser.other_user_name}</strong> to the squad?</p>
                        <div className="cm-footer">
                            <button className="cm-btn-cancel" onClick={() => setConfirmAddUser(null)} disabled={isProcessing}>Cancel</button>
                            <button className="cm-btn-primary" onClick={executeAddMember} disabled={isProcessing}>
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : 'Confirm Add'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Kick Confirmation Modal */}
            {confirmModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Kick Member</h3>
                        <p>Are you sure you want to remove <strong>{confirmModal.name}</strong> from the squad? They can rejoin if the group is public.</p>
                        <div className="cm-footer">
                            <button className="cm-btn-cancel" onClick={() => setConfirmModal(null)} disabled={isProcessing}>Cancel</button>
                            <button className="cm-btn-danger" onClick={() => executeKick(confirmModal.uid)} disabled={isProcessing}>
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : 'Kick User'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Ban/Mute Configuration Modal */}
            {punishConfig && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>{punishConfig.type === 'ban' ? 'Ban Member' : 'Restrict Writing'}</h3>
                        <p>Configure restriction for <strong>{members[punishConfig.uid]?.name}</strong>:</p>
                        
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
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : `Apply ${punishConfig.type === 'ban' ? 'Ban' : 'Restriction'}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Elegant Status Toast / Notice */}
            {alertNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title || 'Notice'}
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice.msg || alertNotice}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Disband Modal */}
            {disbandModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3 style={{color: '#ff5f5f'}}>Delete Group</h3>
                        <p>This action is irreversible. All messages, files, and links will be permanently deleted.</p>
                        <p style={{fontSize: '0.8rem', color: '#aaa', marginTop: '10px'}}>Type <strong>{chatInfo.title}</strong> to confirm:</p>
                        <input 
                            type="text" 
                            className="cm-text-input" 
                            placeholder={chatInfo.title}
                            value={disbandInput}
                            onChange={e => setDisbandInput(e.target.value)}
                        />
                        <div className="cm-footer" style={{marginTop: '1rem'}}>
                            <button className="cm-btn-cancel" onClick={() => { setDisbandModal(false); setDisbandInput(''); }} disabled={isProcessing}>Cancel</button>
                            <button className="cm-btn-danger" onClick={executeDisband} disabled={disbandInput !== chatInfo.title || isProcessing}>
                                {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : 'Delete Group'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const GroupChat = ({ chat, currentUser, isHidden, targetMessageId, onClose, onMinimize, onJoin, isJoining, onForward, onOriginClick, onOpenUser }) => {
    const { user: userProfile } = usePlatform();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [members, setMembers] = useState({});
    const [myRole, setMyRole] = useState('member');
    const [activeMenu, setActiveMenu] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [fullscreenGallery, setFullscreenGallery] = useState(null);
    const fileInputRef = useRef(null);

    const [alertNotice, setAlertNotice] = useState(null); // Parent Error Trapper
    const [typingUsers, setTypingUsers] = useState([]);
    // Group Hub State
    const [localChatInfo, setLocalChatInfo] = useState({ title: chat.title, avatar_url: chat.avatar_url, metadata: chat.metadata });
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    
    // Auto-hide success toasts on parent
    useEffect(() => {
        if (alertNotice?.success) {
            const timer = setTimeout(() => setAlertNotice(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [alertNotice]);
    
    // Moderation State
    const [myMutedUntil, setMyMutedUntil] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // ID of message to delete
    const [kickedNotice, setKickedNotice] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const [showAdminSettings, setShowAdminSettings] = useState(false);

    // Reset header avatar error state if URL changes
    useEffect(() => setAvatarError(false), [localChatInfo.avatar_url]);

    const toggleAdminSetting = async (key, currentVal) => {
        let defaultVal = false;
        if (key === 'members_can_post' || key === 'members_can_add') defaultVal = true;
        
        const actualVal = currentVal ?? defaultVal;
        const newMeta = { ...localChatInfo.metadata, [key]: !actualVal };
        
        // Optimistic UI Update
        setLocalChatInfo(prev => ({ ...prev, metadata: newMeta }));
        
        const { error } = await supabase.from('conversations').update({ metadata: newMeta }).eq('id', chat.conversation_id);
        if (error) {
            // Revert on error
            setLocalChatInfo(prev => ({ ...prev, metadata: { ...prev.metadata, [key]: actualVal } }));
            setAlertNotice("Action denied. You do not have permission to alter group settings.");
        }
    };

    const membersCanPost = localChatInfo.metadata?.members_can_post !== false;
    const canPost = myRole === 'owner' || myRole === 'admin' || membersCanPost;

    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    // LiveKit Immersive State
    const [liveState, setLiveState] = useState('none'); // 'none', 'full', 'minimized'
    const [liveCredentials, setLiveCredentials] = useState(null); // { token, url }
    const [isStartingLive, setIsStartingLive] = useState(false);
    const [showRecoveryModal, setShowRecoveryModal] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
    const [showSearchList, setShowSearchList] = useState(false);

    const flowRef = useRef(null);
    const channelRef = useRef(null);
    const isAutoScrollEnabled = useRef(true);
    const typingTimeoutRef = useRef(null);
    const localTypingRef = useRef(false);

    // Session Recovery & Heartbeat Diagnostics
    const heartBeatTime = localChatInfo.metadata?.live_heartbeat 
        ? new Date(localChatInfo.metadata.live_heartbeat).getTime() 
        : Date.now(); // Default to now to prevent instant death for fresh sessions
        
    const timeSinceBeat = Date.now() - heartBeatTime;
    
    // Allow a generous 15-minute window for session death to mitigate minor client clock skews
    const isLiveDead = timeSinceBeat > 15 * 60 * 1000; 

    const isLiveActive = localChatInfo.metadata?.is_live && !isLiveDead;
    const isMeHost = localChatInfo.metadata?.live_host_id === currentUser.id;
    const hasRecoverableSession = isLiveActive && isMeHost && liveState === 'none';
    
    // Show banner as long as the session is technically active in DB. 
    // (If the host is dropping packets, attendants can wait inside the room).
    const showLiveBanner = isLiveActive;

    useEffect(() => {
        if (localChatInfo.metadata?.is_live && isMeHost && liveState === 'none') {
            if (isLiveDead) {
                // Auto-cleanup dead sessions
                supabase.rpc('kill_live_session', { conv_id: chat.conversation_id });
            } else {
                setShowRecoveryModal(true);
            }
        }
    }, [localChatInfo.metadata?.is_live, isMeHost, liveState, isLiveDead, chat.conversation_id]);

    const startLiveSession = async () => {
        setIsStartingLive(true);
        try {
            const res = await invokeLiveToken({ conversation_id: chat.conversation_id });
            if (res.error) throw new Error(res.error);
            setLiveCredentials({ token: res.token, url: res.ws_url });
            
            // Broadcast live state to DB immediately with heartbeat
            await supabase.rpc('heartbeat_live_session', { conv_id: chat.conversation_id, req_host_id: currentUser.id });
            
            // Optimistic Local State Update
            setLocalChatInfo(prev => ({ 
                ...prev, 
                metadata: { ...prev.metadata, is_live: true, live_host_id: currentUser.id, live_status: 'active', live_heartbeat: new Date().toISOString() } 
            }));
            
            setLiveState('full');
            setShowRecoveryModal(false);
        } catch (err) {
            setAlertNotice({ title: "Stage Error", msg: err.message, success: false });
        }
        setIsStartingLive(false);
    };

    const joinLiveSession = async () => {
        setIsStartingLive(true);
        try {
            const res = await invokeLiveToken({ conversation_id: chat.conversation_id });
            if (res.error) throw new Error(res.error);
            setLiveCredentials({ token: res.token, url: res.ws_url });
            setLiveState('full');
        } catch (err) {
            setAlertNotice({ title: "Connection Error", msg: err.message, success: false });
        }
        setIsStartingLive(false);
    };

    const endLiveSession = async (forceKill = false) => {
        // ROBUST OPTIMISTIC UPDATE:
        // Clear metadata immediately so the Recovery Modal Effect doesn't see a "crashed" state
        if (isMeHost || forceKill) {
            setLocalChatInfo(prev => {
                const nextMeta = { ...prev.metadata };
                delete nextMeta.is_live;
                delete nextMeta.live_host_id;
                delete nextMeta.live_status;
                delete nextMeta.live_heartbeat;
                return { ...prev, metadata: nextMeta };
            });
        }

        setLiveState('none');
        setLiveCredentials(null);
        setShowRecoveryModal(false);
        
        if (isMeHost || forceKill) {
            // Background cleanup in DB
            await supabase.rpc('kill_live_session', { conv_id: chat.conversation_id });
        }
    };

    const markAsRead = async () => {
        if (!chat.conversation_id) return;
        // Anti-Clock-Skew: Offset by 5 seconds into the future to ensure server trusts we read it
        const skewAdjustedTime = new Date(Date.now() + 5000).toISOString();
        
        await supabase.from('conversation_members')
            .update({ last_read_at: skewAdjustedTime })
            .eq('conversation_id', chat.conversation_id)
            .eq('user_id', currentUser.id);
    };

    const fetchMessages = async () => {
        if (!chat.conversation_id) return;
        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', chat.conversation_id)
            .order('created_at', { ascending: true });
        if (data) setMessages(data.map(m => ({ ...m, status: 'sent' })));
    };

    useEffect(() => {
        const fetchState = async () => {
            // OPTIMIZATION: Fire the heavy queries in parallel instead of sequentially
            const [msgResponse, memResponse, convResponse] = await Promise.all([
                supabase.from('messages')
                    .select('*')
                    .eq('conversation_id', chat.conversation_id)
                    .order('created_at', { ascending: true }),
                supabase.from('conversation_members')
                    .select('user_id, role, muted_until')
                    .eq('conversation_id', chat.conversation_id),
                supabase.from('conversations')
                    .select('title, avatar_url, metadata')
                    .eq('id', chat.conversation_id)
                    .maybeSingle()
            ]);

            if (convResponse.data) {
                setLocalChatInfo(prev => ({
                    ...prev,
                    title: convResponse.data.title,
                    avatar_url: convResponse.data.avatar_url,
                    metadata: convResponse.data.metadata
                }));
            }

            let memMap = {};
            const memberIds = memResponse.data ? memResponse.data.map(m => m.user_id) : [];
            const senderIds = msgResponse.data ? msgResponse.data.map(m => m.sender_id).filter(Boolean) : [];
            
            // Combine members and historical message senders to ensure we have profile data for everyone
            const allUserIds = Array.from(new Set([...memberIds, ...senderIds]));

            if (allUserIds.length > 0) {
                // Securely fetch public profiles bypassing RLS
                const { data: profiles } = await supabase.rpc('get_public_profiles', { user_ids: allUserIds });

                allUserIds.forEach(uid => {
                    const prof = profiles?.find(p => p.id === uid);
                    const memData = memResponse.data?.find(m => m.user_id === uid);
                    
                    memMap[uid] = { 
                        role: memData ? memData.role : null, 
                        is_current_member: !!memData,
                        name: prof?.full_name || 'Unknown User', 
                        avatar: prof?.avatar_url || '' 
                    };
                    
                    if (uid === currentUser.id && memData) {
                        setMyRole(memData.role);
                        setMyMutedUntil(memData.muted_until);
                    }
                });
                setMembers(memMap);
            }

            // Immediately set the messages that we fetched concurrently
            if (msgResponse.data) {
                setMessages(msgResponse.data.map(m => ({ ...m, status: 'sent' })));
            }
            
            setIsLoading(false);
            markAsRead(); // Clear badges on load
        };

        fetchState();

        const channel = supabase.channel(`group_${chat.conversation_id}`, {
            config: { presence: { key: currentUser.id } }
        });

        channelRef.current = channel;

        channel
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}` }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, { ...payload.new, status: 'sent' }];
                    });
                    // Suppress badge increments if we are actively viewing the chat
                    markAsRead(); // Unconditionally mark as read to clear badges
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                const activeTypers = [];
                
                Object.keys(state).forEach(uid => {
                    if (uid !== currentUser.id) {
                        let latest = null;
                        state[uid].forEach(p => {
                            if (!latest || (p.updatedAt || 0) > (latest.updatedAt || 0)) latest = p;
                        });
                        
                        if (latest && latest.isTyping) {
                            activeTypers.push(uid);
                        }
                    }
                });
                
                setTypingUsers(activeTypers);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ isTyping: false, updatedAt: Date.now() });
                }
            });

        const memberChannel = supabase.channel(`members_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${chat.conversation_id}`
            }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    // Optimistic UI insert to trigger the live counter instantly
                    setMembers(prev => ({...prev, [payload.new.user_id]: { role: payload.new.role, name: 'Loading...', avatar: '' }}));
                    
                    // Fetch real profile silently via secure RPC
                    supabase.rpc('get_user_profile_public', { target_user_id: payload.new.user_id })
                        .then(({data}) => {
                            if (data) {
                                setMembers(prev => ({...prev, [payload.new.user_id]: { role: payload.new.role, is_current_member: true, name: data.full_name, avatar: data.avatar_url }}));
                            }
                        });
                } else if (payload.eventType === 'UPDATE') {
                    if (payload.new.user_id === currentUser.id) {
                        setMyMutedUntil(payload.new.muted_until);
                        setMyRole(payload.new.role);
                    } else {
                        setMembers(prev => ({...prev, [payload.new.user_id]: { ...prev[payload.new.user_id], role: payload.new.role }}));
                    }
                } else if (payload.eventType === 'DELETE') {
                    if (payload.old.user_id === currentUser.id) {
                        setKickedNotice(true);
                    } else {
                        setMembers(prev => {
                            const next = {...prev};
                            delete next[payload.old.user_id];
                            return next;
                        });
                    }
                }
            })
            .subscribe();

        // Listen for Global Meta Changes (like Admin toggling write-access)
        const convChannel = supabase.channel(`conv_${chat.conversation_id}`)
            .on('postgres_changes', { 
                event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${chat.conversation_id}`
            }, (payload) => {
                setLocalChatInfo(prev => ({
                    ...prev,
                    title: payload.new.title,
                    avatar_url: payload.new.avatar_url,
                    metadata: payload.new.metadata
                }));
            })
            .subscribe();

        // Explicitly untrack to instantly kill ghosts instead of waiting for Supabase heartbeat timeout
        const handleBeforeUnload = () => {
            channel.untrack();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            channel.untrack(); // Force drop presence
            supabase.removeChannel(channel);
            supabase.removeChannel(memberChannel);
            supabase.removeChannel(convChannel);
        };
    }, [chat.conversation_id]);

    // Handle deep linking scroll injection
    useEffect(() => {
        if (targetMessageId && messages.length > 0) {
            setTimeout(() => {
                scrollToMessage(targetMessageId);
            }, 300); // Allow DOM paint to finish
        }
    }, [targetMessageId, messages.length]);

    useEffect(() => {
        // Smart Scroll: Only yank down if the user is already near the bottom (or on initial load)
        if (flowRef.current && !isSearchActive) {
            if (isAutoScrollEnabled.current) {
                flowRef.current.scrollTop = flowRef.current.scrollHeight;
            }
        }
    }, [messages, isSearchActive]);
    
    const executeSearch = (query) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setSearchResults([]);
            setCurrentSearchIndex(-1);
            return;
        }
        const term = query.toLowerCase();
        // Reverse array so newest messages (bottom) are index 0
        const results = messages.filter(m => m.text && m.text.toLowerCase().includes(term)).reverse();
        setSearchResults(results);
        if (results.length > 0) {
            setCurrentSearchIndex(0);
            scrollToMessage(results[0].id);
        } else {
            setCurrentSearchIndex(-1);
        }
    };

    const searchOlder = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex + 1;
        if (newIdx >= searchResults.length) newIdx = 0; // Wrap around
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const searchNewer = () => {
        if (searchResults.length === 0) return;
        let newIdx = currentSearchIndex - 1;
        if (newIdx < 0) newIdx = searchResults.length - 1; // Wrap around
        setCurrentSearchIndex(newIdx);
        scrollToMessage(searchResults[newIdx].id);
    };

    const getSnippet = (text, query) => {
        if (!query) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + query.length + 60);
        let snippet = text.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';
        return snippet;
    };

    const handleInputChange = (val) => {
        setInput(val);
        if (channelRef.current && !chat.is_preview) {
            const isTypingNow = val.length > 0;
            
            if (isTypingNow && !localTypingRef.current) {
                channelRef.current.track({ isTyping: true, updatedAt: Date.now() }).catch(e => console.error("[GroupChat] Track error:", e));
                localTypingRef.current = true;
            } else if (!isTypingNow && localTypingRef.current) {
                channelRef.current.track({ isTyping: false, updatedAt: Date.now() }).catch(e => console.error("[GroupChat] Track error:", e));
                localTypingRef.current = false;
            }
            
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (isTypingNow) {
                typingTimeoutRef.current = setTimeout(() => {
                    if (channelRef.current) channelRef.current.track({ isTyping: false, updatedAt: Date.now() });
                    localTypingRef.current = false;
                }, 2500);
            }
        }
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        
        let validFiles = files;
        if (pendingAttachments.length + files.length > 10) {
            setAlertNotice({ title: "Limit Reached", msg: "You can only attach up to 10 files at once." });
            const remainingSlots = 10 - pendingAttachments.length;
            validFiles = files.slice(0, remainingSlots);
        }
        
        const oversized = validFiles.find(f => f.size > 10 * 1024 * 1024);
        if (oversized) {
            setAlertNotice({ title: "File too large", msg: "One or more files exceed the 10MB limit." });
            e.target.value = null;
            return;
        }
        
        const processed = validFiles.map(file => ({
            file,
            previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null
        }));
        
        setPendingAttachments(prev => [...prev, ...processed]);
        e.target.value = null;
    };

    const getFileIconProps = (filename) => {
        if (!filename) return { icon: 'fa-file', color: 'var(--accent-teal)' };
        const ext = filename.split('.').pop().toLowerCase();
        switch(ext) {
            case 'pdf': return { icon: 'fa-file-pdf', color: '#ff4757' };
            case 'doc': case 'docx': return { icon: 'fa-file-word', color: '#3498db' };
            case 'xls': case 'xlsx': case 'csv': return { icon: 'fa-file-excel', color: '#2ecc71' };
            case 'ppt': case 'pptx': return { icon: 'fa-file-powerpoint', color: '#e67e22' };
            case 'txt': return { icon: 'fa-file-lines', color: '#95a5a6' };
            case 'epub': return { icon: 'fa-book', color: '#9b59b6' };
            case 'zip': case 'rar': case '7z': return { icon: 'fa-file-zipper', color: '#f1c40f' };
            default: return { icon: 'fa-file', color: 'var(--accent-teal)' };
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && pendingAttachments.length === 0) || isUploading) return;
        
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (channelRef.current && localTypingRef.current) {
            channelRef.current.track({ isTyping: false, updatedAt: Date.now() });
            localTypingRef.current = false;
        }

        const msgText = input;
        const currentAttachments = [...pendingAttachments];
        
        setInput('');
        setPendingAttachments([]);

        if (editingMessage) {
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, is_edited: true } : m));
            await supabase.from('messages').update({ text: msgText, is_edited: true }).eq('id', editingMessage.id);
            setEditingMessage(null);
            return;
        }

        const currentReplyId = replyingTo?.id;
        setReplyingTo(null);

        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: tempId, conversation_id: chat.conversation_id,
            sender_id: currentUser.id, text: msgText,
            reply_to_id: currentReplyId,
            attachments: currentAttachments.map(a => ({ name: a.file.name, type: a.file.type, url: a.previewUrl || '' })),
            created_at: new Date().toISOString(), status: 'pending'
        }]);

        let finalAttachments = [];

        if (currentAttachments.length > 0) {
            setIsUploading(true);
            setUploadProgress(0);
            const totalFiles = currentAttachments.length;
            let completedFiles = 0;

            const { data: { session } } = await supabase.auth.getSession();
            const GATEWAY = 'https://linkup-gateway.getyeteklu2.workers.dev';
            const DUMMY_KEY = 'sq_pub_2d66a1b8c9e08d9e0a2f8d73b';

            for (const att of currentAttachments) {
                try {
                    const file = att.file;
                    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                    const filePath = `groups/${chat.conversation_id}/${currentUser.id}/${Date.now()}_${safeName}`;
                    let publicUrl = '';

                    for (let retry = 0; retry < 3; retry++) {
                        try {
                            await new Promise((resolve, reject) => {
                                const xhr = new XMLHttpRequest();
                                xhr.upload.addEventListener('progress', (e) => {
                                    if (e.lengthComputable) {
                                        const fileProg = e.loaded / e.total;
                                        const globalProg = Math.round(((completedFiles + fileProg) / totalFiles) * 100);
                                        setUploadProgress(globalProg);
                                    }
                                });
                                xhr.addEventListener('load', () => {
                                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                                    else reject(new Error(`HTTP ${xhr.status}`));
                                });
                                xhr.addEventListener('error', () => reject(new Error("Network Error")));
                                xhr.addEventListener('abort', () => reject(new Error("Aborted")));
                                xhr.open('POST', `${GATEWAY}/storage/v1/object/chat_media/${filePath}`);
                                xhr.setRequestHeader('apikey', DUMMY_KEY);
                                xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
                                xhr.setRequestHeader('x-linkup-client', 'linkup-secure-client-2026');
                                xhr.setRequestHeader('Content-Type', file.type);
                                xhr.send(file);
                            });
                            const { data } = supabase.storage.from('chat_media').getPublicUrl(filePath);
                            publicUrl = data.publicUrl;
                            break;
                        } catch (err) {
                            if (retry === 2) throw err;
                            await new Promise(r => setTimeout(r, 1500));
                        }
                    }
                    
                    finalAttachments.push({ name: file.name, url: publicUrl, path: filePath, type: file.type, size: file.size, previewUrl: att.previewUrl });
                    completedFiles++;
                    setUploadProgress(Math.round((completedFiles / totalFiles) * 100));

                } catch (err) {
                    setAlertNotice({ title: "Partial Upload Failure", msg: `Failed to upload ${att.file.name}. Sending successfully uploaded files.` });
                }
            }
            
            setIsUploading(false);
            if (finalAttachments.length === 0) {
                setMessages(prev => prev.filter(m => m.id !== tempId));
                return;
            }
        }

        const { data, error } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId,
            attachments: finalAttachments
        }).select().maybeSingle();
        
        if (error) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
            setAlertNotice({ title: "Action Blocked", msg: error.message || "Message failed to send. You may lack permission.", success: false });
        } else if (data) {
            if (finalAttachments.length > 0) {
                data.attachments = data.attachments.map(dbAtt => {
                    const localMatch = finalAttachments.find(fa => fa.name === dbAtt.name);
                    if (localMatch && localMatch.previewUrl) {
                        return { ...dbAtt, url: localMatch.previewUrl };
                    }
                    return dbAtt;
                });
            }
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'sent' } : m));
        }
    };

    const deleteMessage = (msgId) => {
        setDeleteConfirm(msgId);
        setActiveMenu(null);
    };

    const confirmAndDelete = async () => {
        if (!deleteConfirm) return;
        const msgId = deleteConfirm;
        setDeleteConfirm(null);
        
        console.group(`[Squad:Chat] Executing DELETE for node: ${msgId}`);
        const msgToDelete = messages.find(m => m.id === msgId);
        
        // 1. Optimistic UI removal
        setMessages(prev => prev.filter(m => m.id !== msgId));
        
        try {
            // 2. Storage Cleanup
            if (msgToDelete?.attachments && msgToDelete.attachments.length > 0) {
                const paths = msgToDelete.attachments.map(att => att.path).filter(Boolean);
                if (paths.length > 0) {
                    await supabase.storage.from('chat_media').remove(paths);
                }
            }
            // 3. Database Deletion
            const { error } = await supabase.from('messages').delete().eq('id', msgId);
            if (error) {
                setAlertNotice("Deletion failed. You do not have permission to delete this message.");
                fetchMessages(); // Resync state
            }
        } catch (err) {
            console.error("[Squad:Chat] Deletion failed:", err);
            fetchMessages(); // Resync state
        }
        console.groupEnd();
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenu(null);
    };

    const handleDownload = (url, filename) => {
        setActiveMenu(null);
        const downloadUrl = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.target = '_self'; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDownloadAll = (attachments) => {
        setActiveMenu(null);
        attachments.forEach((att, index) => {
            setTimeout(() => {
                handleDownload(att.url, att.name);
            }, index * 400); // Stagger to avoid browser popup blocks
        });
    };

    const startEditing = (msg) => {
        setEditingMessage(msg);
        setInput(msg.text);
        setActiveMenu(null);
    };

    const startReply = (msg) => {
        setReplyingTo(msg);
        setActiveMenu(null);
    };

    const scrollToMessage = (id) => {
        const el = document.getElementById(`sq-msg-${id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('squad-msg-highlight-flash');
        setTimeout(() => el.classList.remove('squad-msg-highlight-flash'), 2500);
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const isMember = !!members[currentUser.id];

    const handleBack = () => {
        if (liveState !== 'none') onMinimize();
        else onClose();
    };

    return (
        <>
        <div className="squad-chat-overlay" style={{ display: isHidden ? 'none' : 'flex' }} onTouchStart={e => e.stopPropagation()}>
            <div className="ambient-prism-light"></div>

            {kickedNotice && (
                <div className="kicked-overlay">
                    <i className="fas fa-user-slash"></i>
                    <h2>Access Revoked</h2>
                    <p>You have been removed or banned from this group by an administrator.</p>
                    <button className="cm-btn-primary" onClick={onClose}>Return to Hub</button>
                </div>
            )}

            {/* Master UI Alert Catch for Main Chat Window */}
            {alertNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title || 'Notice'}
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{alertNotice.msg || alertNotice}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                        </div>
                    </div>
                </div>
            )}

            {isSearchActive ? (
                <header className="chat-search-header">
                    <button className="icon-button back-btn" onClick={() => { setIsSearchActive(false); setSearchQuery(''); }}><i className="fas fa-arrow-left"></i></button>
                    <div className="chat-search-input-wrapper">
                        <input 
                            type="text" 
                            className="chat-search-input" 
                            value={searchQuery} 
                            onChange={(e) => executeSearch(e.target.value)} 
                            placeholder="Search..." 
                            autoFocus 
                        />
                        <span className="search-count">
                            {searchResults.length > 0 ? `${currentSearchIndex + 1}/${searchResults.length}` : '0/0'}
                        </span>
                    </div>
                    <div className="chat-search-nav">
                        <button onClick={searchOlder} disabled={searchResults.length === 0}><i className="fas fa-chevron-up"></i></button>
                        <button onClick={searchNewer} disabled={searchResults.length === 0}><i className="fas fa-chevron-down"></i></button>
                        <button className="snippet-btn" onClick={() => setShowSearchList(true)} disabled={searchResults.length === 0}><i className="fas fa-list"></i></button>
                    </div>
                </header>
            ) : (
                <header className="squad-header" style={{ justifyContent: 'flex-start', gap: '1.2rem' }}>
                    <button className="icon-button back-btn" onClick={handleBack}><i className="fas fa-chevron-left"></i></button>
                    <div className="squad-contact-profile" onClick={() => setIsInfoOpen(true)} style={{cursor: 'pointer'}}>
                        <div className="squad-avatar-ring">
                            {localChatInfo.avatar_url && !avatarError ? (
                                <img src={localChatInfo.avatar_url} alt="Squad Avatar" onError={() => setAvatarError(true)} />
                            ) : (
                                <div className="squad-default-avatar"><i className="fas fa-users"></i></div>
                            )}
                        </div>
                        <div className="squad-header-info">
                            <h2>{localChatInfo.title}</h2>
                            {typingUsers.length > 0 ? (
                                <div style={{ color: '#42d7b8', fontSize: '0.75rem' }}>
                                    {typingUsers.length === 1 ? `${members[typingUsers[0]]?.name.split(' ')[0] || 'Someone'} is typing...` : `${typingUsers.length} people are typing...`}
                                </div>
                            ) : (
                            <div className="squad-meta-tags">
                                <span className="squad-badge focus">{localChatInfo.metadata?.focus || 'General'}</span>
                                <span className="squad-badge count"><i className="fas fa-user"></i> {Object.keys(members).length}</span>
                            </div>
                            )}
                        </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button className="icon-button" onClick={() => setIsSearchActive(true)}><i className="fas fa-search"></i></button>
                    </div>
                </header>
            )}

            {showLiveBanner && liveState === 'none' && (
                <div className="live-stage-banner" style={{ display: 'flex' }}>
                    <div className="live-banner-left">
                        <div className="pulse-indicator"></div>
                        <div className="live-banner-text">
                            <div>{isMeHost ? "You're Live" : "Squad is Live"}</div>
                            <div>{isMeHost ? "Broadcasting to the group" : `${members[localChatInfo.metadata.live_host_id]?.name || 'Host'} is speaking`}</div>
                        </div>
                    </div>
                    {isMeHost ? (
                        <button className="join-stage-action-btn" onClick={startLiveSession} disabled={isStartingLive}>
                            {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Resume Stage'}
                        </button>
                    ) : (
                        <button className="join-stage-action-btn" onClick={joinLiveSession} disabled={isStartingLive}>
                            {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Stage'}
                        </button>
                    )}
                </div>
            )}
            
            {showRecoveryModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Active Session Detected</h3>
                        <p>You previously started a live broadcast. Would you like to resume your session or end it?</p>
                        <div className="cm-footer">
                            <button className="cm-btn-danger" onClick={() => endLiveSession(true)} disabled={isStartingLive}>End Session</button>
                            <button className="cm-btn-primary" onClick={startLiveSession} disabled={isStartingLive}>
                                {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : 'Resume'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="squad-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={(e) => {
                setActiveMenu(null);
                const { scrollHeight, scrollTop, clientHeight } = e.currentTarget;
                isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 250;
            }}>
                {isLoading ? (
                    <div className="squad-loading-state">
                        <i className="fas fa-circle-notch fa-spin"></i>
                        <p>Syncing Squad comms...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="squad-empty-state">
                        <i className="fas fa-user-group"></i>
                        <p>{chat.is_preview && !isMember ? "No messages yet. Join to start the discussion!" : "No messages yet. Start the discussion!"}</p>
                    </div>
                ) : (
                    messages.map(m => {
                        const isMine = m.sender_id === currentUser.id;
                        const isDeletedAccount = !m.sender_id;
                        const sender = isDeletedAccount 
                            ? { name: 'Deleted Account', role: 'member' } 
                            : (members[m.sender_id] || { name: 'Unknown User', role: 'member' });
                        const isMenuOpen = activeMenu?.msg?.id === m.id;
                        
                        const repliedMsg = m.reply_to_id ? messages.find(msg => msg.id === m.reply_to_id) : null;
                        const isMissingReply = m.reply_to_id && !repliedMsg;

                        return (
                            <div 
                                key={m.id} 
                                id={`sq-msg-${m.id}`}
                                className={`squad-msg-group ${isMine ? 'mine' : 'theirs'}`} 
                                style={{ zIndex: isMenuOpen ? 100 : 1 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (chat.is_preview) return; // Read-only context for preview
                                    if (isMenuOpen) {
                                        setActiveMenu(null);
                                        return;
                                    }
                                    
                                    let x = e.clientX || (e.touches && e.touches[0].clientX);
                                    let y = e.clientY || (e.touches && e.touches[0].clientY);
                                    
                                    if (!x || !y) {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        x = rect.left + rect.width / 2;
                                        y = rect.top + rect.height / 2;
                                    }
                                    
                                    const menuW = 160;
                                    const menuH = 200;
                                    
                                    if (x + menuW > window.innerWidth - 20) x = window.innerWidth - menuW - 20;
                                    if (y + menuH > window.innerHeight - 80) y = window.innerHeight - menuH - 80;
                                    if (y < 80) y = 80;
                                    
                                    setActiveMenu({ msg: m, isMine, x, y });
                                }}
                            >
                                {!isMine && (
                                    <img src={sender.avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="squad-msg-avatar" onClick={(e) => { e.stopPropagation(); if(m.sender_id) onOpenUser(m.sender_id); }} style={{cursor: m.sender_id ? 'pointer' : 'default'}} />
                                )}
                                <div className="squad-bubble-wrapper">
                                    {!isMine && (
                                        <div className="squad-sender-name">
                                            {sender.name}
                                            {sender.role === 'owner' && <i className="fas fa-crown admin-crown"></i>}
                                        </div>
                                    )}
                                    {(() => {
                                        const hasMedia = m.attachments && m.attachments.length > 0;
                                        const isNaked = hasMedia && (!m.text || m.text.trim() === '');
                                        const bubbleClass = `squad-bubble ${hasMedia ? (isNaked ? 'media-bubble naked' : 'media-bubble captioned') : ''}`;
                                        return (
                                    <div className={bubbleClass}>
                                    {m.forward_meta && (
                                        <div className="forward-indicator" onClick={(e) => { e.stopPropagation(); onOriginClick(m.forward_meta); }}>
                                            <div className="forward-bar"></div>
                                            <div className="forward-info">
                                                <span className="forward-label">Forwarded message</span>
                                                <span className="forward-from">
                                                    {m.forward_meta.original_sender_avatar && <img src={m.forward_meta.original_sender_avatar} className="forward-avatar" alt="Avatar"/>}
                                                    {m.forward_meta.original_sender_name}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    {repliedMsg ? (
                                        <div className="squad-reply-quote" onClick={(e) => { e.stopPropagation(); scrollToMessage(m.reply_to_id); }}>
                                            <div className="sq-quote-content">
                                                <div className="sq-quote-user">
    {!repliedMsg.sender_id ? 'Deleted Account' : (members[repliedMsg.sender_id]?.name || 'Unknown User')}
</div>
                                                <div className="sq-quote-text">{repliedMsg.text}</div>
                                            </div>
                                        </div>
                                    ) : isMissingReply ? (
                                        <div className="squad-reply-quote is-deleted">
                                            <div className="sq-quote-content">
                                                <div className="sq-quote-user">System</div>
                                                <div className="sq-quote-text"><i>Original message deleted</i></div>
                                            </div>
                                        </div>
                                    ) : null}
                                    
                                    {(() => {
                                        if (!m.attachments || m.attachments.length === 0) return null;
                                        
                                        const mediaItems = m.attachments.filter(a => a.type.startsWith('image/') || a.type.startsWith('video/'));
                                        const docItems = m.attachments.filter(a => !a.type.startsWith('image/') && !a.type.startsWith('video/'));
                                        const hasMoreMedia = mediaItems.length > 5;
                                        const displayMedia = mediaItems.slice(0, 5);

                                        return (
                                            <>
                                                {displayMedia.length > 0 && (
                                                    <div className="media-gallery-grid" data-count={displayMedia.length} data-more={hasMoreMedia.toString()}>
                                                        {displayMedia.map((att, i) => {
                                                            const isLast = i === 4;
                                                            return (
                                                                <div key={i} className="gallery-item" onClick={(e) => { 
                                                                    e.stopPropagation(); 
                                                                    setFullscreenGallery({ items: mediaItems, index: i });
                                                                }}>
                                                                    {att.type.startsWith('video/') ? (
                                                                        <video src={att.url} />
                                                                    ) : (
                                                                        <img src={att.url} alt="Shared Image" />
                                                                    )}
                                                                    {isLast && hasMoreMedia && (
                                                                        <div className="gallery-more-overlay" data-more-count={(mediaItems.length - 5).toString()}></div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                
                                                {docItems.map((att, i) => {
                                                    const iconData = getFileIconProps(att.name);
                                                    return (
                                                    <div key={i} className="bubble-attachment" style={{marginTop: i === 0 && displayMedia.length === 0 ? '0' : '4px'}}>
                                                        <div className="bubble-file-box" onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.name); }}>
                                                            <div className="bubble-file-icon" style={{color: iconData.color}}><i className={`fas ${iconData.icon}`}></i></div>
                                                            <div className="bubble-file-info">
                                                                <span className="bubble-file-name">{att.name}</span>
                                                                <span style={{fontSize: '0.65rem', color: '#888'}}>{(att.size / 1024 / 1024).toFixed(2)} MB</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )})}
                                            </>
                                        );
                                    })()}

                                    {m.text && <div className="bubble-text-content">{m.text}</div>}
                                    
                                    <div className={`squad-time-meta ${isMine ? 'mine-meta' : ''}`}>
                                        {m.is_edited && <span>edited</span>}
                                        {formatTime(m.created_at)}
                                        {isMine && (
                                            m.status === 'pending' ? <i className="fa-solid fa-clock" style={{fontSize: '0.6rem'}}></i> : 
                                            m.status === 'failed' ? <i className="fa-solid fa-circle-exclamation" style={{color: '#ff5f5f', fontSize: '0.7rem'}} title="Message Failed"></i> : 
                                            <i className="fa-solid fa-check"></i>
                                        )}
                                    </div>
                                </div>
                                    );
                                })()}
                                </div>
                            </div>
                        );
                    })
                )}
            </main>

            {activeMenu && (
                <div className="squad-ctx-menu" style={{ left: activeMenu.x, top: activeMenu.y }}>
                    {!activeMenu.isMine && (
                        <button className="squad-ctx-btn" onClick={() => startReply(activeMenu.msg)}>
                            <i className="fa-solid fa-reply"></i> Reply
                        </button>
                    )}
                    {activeMenu.msg.text && (
                        <button className="squad-ctx-btn" onClick={() => handleCopy(activeMenu.msg.text)}>
                            <i className="fa-solid fa-copy"></i> Copy Text
                        </button>
                    )}
                    {chat.metadata?.privacy !== 'private' && activeMenu.msg.attachments && activeMenu.msg.attachments.length > 0 && (
                        <button className="squad-ctx-btn" onClick={() => {
                            if (activeMenu.msg.attachments.length > 1) {
                                if(window.confirm(`Download all ${activeMenu.msg.attachments.length} files?`)) {
                                    handleDownloadAll(activeMenu.msg.attachments);
                                }
                            } else {
                                handleDownload(activeMenu.msg.attachments[0].url, activeMenu.msg.attachments[0].name);
                            }
                        }}>
                            <i className="fa-solid fa-download"></i> {activeMenu.msg.attachments.length > 1 ? 'Download All Files' : 'Download File'}
                        </button>
                    )}
                    {(!chat.metadata || chat.metadata.privacy !== 'private') && (
                        <button className="squad-ctx-btn" onClick={() => { 
                            onForward({
                                ...activeMenu.msg, 
                                resolved_sender_name: activeMenu.isMine ? userProfile?.full_name : members[activeMenu.msg.sender_id]?.name || 'Unknown',
                                resolved_sender_avatar: activeMenu.isMine ? userProfile?.avatar_url : members[activeMenu.msg.sender_id]?.avatar || ''
                            }); 
                            setActiveMenu(null); 
                        }}>
                            <i className="fa-solid fa-share"></i> Forward
                        </button>
                    )}
                    {activeMenu.isMine && (
                        <button className="squad-ctx-btn" onClick={() => startEditing(activeMenu.msg)}>
                            <i className="fa-solid fa-pen"></i> Edit
                        </button>
                    )}
                    {(activeMenu.isMine || myRole === 'owner' || myRole === 'admin') && (
                        <button className="squad-ctx-btn delete" onClick={() => { setDeleteConfirm(activeMenu.msg.id); setActiveMenu(null); }}>
                            <i className="fa-solid fa-trash"></i> {activeMenu.isMine ? 'Delete' : 'Admin Delete'}
                        </button>
                    )}
                </div>
            )}

            <footer className="squad-input-area" style={{ padding: '0 1.5rem calc(1rem + env(safe-area-inset-bottom))', background: 'linear-gradient(to top, #08080c 80%, transparent)' }}>
                {chat.is_preview && !isMember ? (
                    <button className="squad-join-full-btn" onClick={() => onJoin(chat.conversation_id)} disabled={isJoining}>
                        {isJoining ? <i className="fas fa-circle-notch fa-spin"></i> : 'Join Squad'}
                    </button>
                ) : (
                    <>
                        {editingMessage && (
                            <div className="squad-input-mode-header edit-mode">
                                <div className="mode-border"></div>
                                <div className="squad-mode-icon"><i className="fa-solid fa-pen"></i></div>
                                <div className="mode-info">
                                    <span className="mode-user">Editing message</span>
                                    <span className="mode-text">{editingMessage.text}</span>
                                </div>
                                <button className="icon-button" onClick={() => { setEditingMessage(null); setInput(''); }}>
                                    <i className="fa-solid fa-times"></i>
                                </button>
                            </div>
                        )}
                        {replyingTo && (
                            <div className="squad-input-mode-header">
                                <div className="mode-border"></div>
                                <div className="mode-info" onClick={() => scrollToMessage(replyingTo.id)}>
                                    <span className="mode-user">
            Replying to {!replyingTo.sender_id ? 'Deleted Account' : (members[replyingTo.sender_id]?.name || 'Unknown User')}
        </span>
                                    <span className="mode-text">{replyingTo.text}</span>
                                </div>
                                <button className="icon-button" onClick={() => setReplyingTo(null)}>
                                    <i className="fa-solid fa-times"></i>
                                </button>
                            </div>
                        )}
                        {pendingAttachments.length > 0 && (
                            <div className="squad-input-mode-header staging-mode">
                                <div className="mode-border staging-preview-border"></div>
                                <div className="staging-preview-content" style={{ overflowX: 'auto', display: 'flex', gap: '8px' }}>
                                    {pendingAttachments.map((pa, idx) => {
                                        const iconData = getFileIconProps(pa.file.name);
                                        return (
                                        <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                                            {pa.previewUrl ? (
                                                <img src={pa.previewUrl} alt="Preview" className="staging-thumb" />
                                            ) : (
                                                <div className="staging-file-icon" style={{color: iconData.color}}><i className={`fas ${iconData.icon}`}></i></div>
                                            )}
                                            <button 
                                                className="icon-button" 
                                                style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'rgba(0,0,0,0.8)', width: '20px', height: '20px', fontSize: '0.6rem', border: '1px solid rgba(255,255,255,0.2)' }} 
                                                onClick={() => setPendingAttachments(p => p.filter((_, i) => i !== idx))}
                                            >
                                                <i className="fa-solid fa-times"></i>
                                            </button>
                                        </div>
                                    )})}
                                </div>
                                <button className="icon-button" onClick={() => setPendingAttachments([])} style={{color: '#ff5f5f', background: 'rgba(255,95,95,0.1)', width: '30px', height: '30px', flexShrink: 0}}>
                                    <i className="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        )}
                        {myMutedUntil && new Date(myMutedUntil) > new Date() ? (
                            <div className="squad-muted-notice">
                                <i className="fas fa-microphone-slash"></i>
                                {new Date(myMutedUntil).getFullYear() > 2100 ? "You have been permanently restricted from posting." : `You are restricted from posting until ${new Date(myMutedUntil).toLocaleString()}.`}
                            </div>
                        ) : !canPost ? (
                            <div className="squad-muted-notice" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#aaa', justifyContent: 'center' }}>
                                <i className="fas fa-lock"></i> Only admins can send messages right now.
                            </div>
                        ) : (
                            <div className="squad-dock">
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    style={{display: 'none'}} 
                                    onChange={handleFileSelect} 
                                />
                                <button className="add-btn" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                                    <i className="fa-solid fa-paperclip"></i>
                                </button>
                                <input 
                                    type="text" 
                                    placeholder="Squad message..." 
                                    disabled={isUploading}
                                    value={input}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                                />
                                {isUploading ? (
                                    <div className="circular-progress-btn">
                                        <svg viewBox="0 0 36 36">
                                            <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                            <path className="circle-fill" strokeDasharray={`${uploadProgress}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                        </svg>
                                        <span className="prog-text">{uploadProgress}%</span>
                                    </div>
                                ) : hasRecoverableSession ? (
                                    <button className="live-trigger-btn" style={{ background: '#ffab40' }} onClick={() => setShowRecoveryModal(true)}>
                                        <i className="fas fa-play"></i>
                                    </button>
                                ) : (!input.trim() && pendingAttachments.length === 0 && !editingMessage && (myRole === 'owner' || myRole === 'admin') && !isLiveActive) ? (
                                    <button className="live-trigger-btn" onClick={startLiveSession} disabled={isStartingLive}>
                                        {isStartingLive ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-broadcast-tower"></i>}
                                    </button>
                                ) : (
                                    <button className="squad-send-btn" onClick={handleSend} disabled={!input.trim() && pendingAttachments.length === 0}>
                                        <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </footer>

            {/* Admin Quick Settings Modal */}
            {showAdminSettings && (
                <div className="custom-modal-overlay" onClick={() => setShowAdminSettings(false)}>
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
                            <button className="cm-btn-primary" style={{width: '100%'}} onClick={() => setShowAdminSettings(false)}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Generic Message Delete Confirm Modal */}
            {deleteConfirm && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Delete Message</h3>
                        <p>Are you sure you want to permanently delete this message for everyone?</p>
                        <div className="cm-footer">
                            <button className="cm-btn-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="cm-btn-danger" onClick={confirmAndDelete}>Purge Message</button>
                        </div>
                    </div>
                </div>
            )}
            {showSearchList && (
                <div className="chat-search-modal-overlay" onClick={() => setShowSearchList(false)}>
                    <div className="chat-search-modal" onClick={e => e.stopPropagation()}>
                        <div className="csm-header">
                            <h3>Search Results</h3>
                            <button className="icon-button" onClick={() => setShowSearchList(false)}><i className="fas fa-times"></i></button>
                        </div>
                        <div className="csm-body">
                            {searchResults.length === 0 ? (
                                <div className="csm-empty">No matching records found.</div>
                            ) : searchResults.map((m, idx) => (
                                <div key={m.id} className="csm-snippet-card" onClick={() => {
                                    setCurrentSearchIndex(idx);
                                    setShowSearchList(false);
                                    scrollToMessage(m.id);
                                }}>
                                    <div className="csm-meta">
                                        <span>{m.sender_id === currentUser.id ? 'You' : (members[m.sender_id]?.name || 'User')}</span>
                                        <span>{formatTime(m.created_at)}</span>
                                    </div>
                                                                <div className="csm-text">
                                {getSnippet(m.text, searchQuery).split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
                                    part.toLowerCase() === searchQuery.toLowerCase() ? 
                                    <span key={i} className="csm-highlight">{part}</span> : part
                                )}
                            </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            
            {isInfoOpen && (
                <GroupInfoPanel 
                    chatInfo={localChatInfo}
                    conversationId={chat.conversation_id}
                    currentUser={currentUser}
                    members={members}
                    setMembers={setMembers}
                    messages={messages}
                    myRole={myRole}
                    onClose={() => setIsInfoOpen(false)}
                    onUpdateInfo={setLocalChatInfo}
                    onDisband={onClose}
                    onOpenAdminSettings={() => setShowAdminSettings(true)}
                    onOpenUser={onOpenUser}
                />
            )}
            {fullscreenGallery && (
                <div className="fullscreen-gallery-overlay" onClick={() => setFullscreenGallery(null)}>
                    <button className="fg-close" onClick={() => setFullscreenGallery(null)}>
                        <i className="fas fa-times"></i>
                    </button>
                    
                    {fullscreenGallery.items.length > 1 && (
                        <button className="fg-nav prev" onClick={(e) => { e.stopPropagation(); setFullscreenGallery(p => ({ ...p, index: (p.index - 1 + p.items.length) % p.items.length })); }}>
                            <i className="fas fa-chevron-left"></i>
                        </button>
                    )}
                    
                    <div className="fg-content" onClick={e => e.stopPropagation()}>
                        {fullscreenGallery.items[fullscreenGallery.index].type.startsWith('video/') ? (
                            <video src={fullscreenGallery.items[fullscreenGallery.index].url} controls autoPlay className="fg-item" />
                        ) : (
                            <img src={fullscreenGallery.items[fullscreenGallery.index].url} alt="Fullscreen Media" className="fg-item" />
                        )}
                    </div>

                    {fullscreenGallery.items.length > 1 && (
                        <button className="fg-nav next" onClick={(e) => { e.stopPropagation(); setFullscreenGallery(p => ({ ...p, index: (p.index + 1) % p.items.length })); }}>
                            <i className="fas fa-chevron-right"></i>
                        </button>
                    )}
                    
                    {fullscreenGallery.items.length > 1 && (
                        <div className="fg-counter">
                            {fullscreenGallery.index + 1} / {fullscreenGallery.items.length}
                        </div>
                    )}
                </div>
            )}

        </div>
        
        {/* React Portal escapes the Hidden Window boundary to float across the entire app */}
        {liveState !== 'none' && liveCredentials && createPortal(
            <LiveKitRoom
                serverUrl={liveCredentials.url}
                token={liveCredentials.token}
                connect={true}
                audio={isMeHost}
                video={false}
                options={{
                    webAudioMix: true,
                    publishDefaults: {
                        audioBitrate: 48000,
                        dtx: true
                    }
                }}
            >
                <LiveStageContent 
                    conversationId={chat.conversation_id}
                    chatInfo={localChatInfo}
                    members={members}
                    liveState={liveState}
                    setLiveState={setLiveState}
                    onLeave={endLiveSession}
                    currentUser={currentUser}
                />
                <RoomAudioRenderer />
            </LiveKitRoom>,
            document.body
        )}
        </>
    );
};
export default GroupChat;