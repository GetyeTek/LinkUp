import React, { useState, useEffect, useRef } from 'react';
import { supabase, usePlatform } from '@linkup-platform/sdk-core';
import AvatarCropperModal from '../../src/core/components/AvatarCropperModal.jsx';
import './GroupChat.css';

const GroupInfoPanel = ({ chatInfo, conversationId, currentUser, members, setMembers, messages, myRole, onClose, onUpdateInfo, onDisband }) => {
    const [activeTab, setActiveTab] = useState('directory');
    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);
    const fileInputRef = useRef(null);
    
    const [editTitle, setEditTitle] = useState(chatInfo.title || '');
    const [editPrivacy, setEditPrivacy] = useState(chatInfo.metadata?.privacy || 'public');
    const [isSaving, setIsSaving] = useState(false);

    // Modals & Menus
    const [activeMemberMenu, setActiveMemberMenu] = useState(null);
    const [confirmModal, setConfirmModal] = useState(null);
    const [disbandModal, setDisbandModal] = useState(false);
    const [disbandInput, setDisbandInput] = useState('');
    const [punishConfig, setPunishConfig] = useState(null); // { uid, type: 'ban'|'mute', isTemp: true, duration: 1, unit: 'days' }

    // Auto-scrape Vault Assets from Messages
    const vaultFiles = messages.flatMap(m => m.attachments || []);
    const vaultLinks = messages.flatMap(m => {
        if (!m.text) return [];
        const urls = m.text.match(/(https?:\/\/[^\s]+)/g) || [];
        return urls.map(url => ({ url, sender: members[m.sender_id]?.name || 'Unknown', time: m.created_at }));
    });

    const handleSaveSettings = async () => {
        setIsSaving(true);
        let newAvatarUrl = chatInfo.avatar_url;
        
        if (croppedAvatar?.blob) {
            const arrayBuffer = await croppedAvatar.blob.arrayBuffer();
            const filePath = `group_avatars/${conversationId}/avatar_${Date.now()}.png`;
            await supabase.storage.from('chat_media').upload(filePath, arrayBuffer, { contentType: 'image/png', upsert: true });
            const { data: { publicUrl } } = supabase.storage.from('chat_media').getPublicUrl(filePath);
            newAvatarUrl = publicUrl;
        }

        const newMeta = { ...chatInfo.metadata, privacy: editPrivacy };
        await supabase.from('conversations').update({ title: editTitle, avatar_url: newAvatarUrl, metadata: newMeta }).eq('id', conversationId);
        
        onUpdateInfo({ ...chatInfo, title: editTitle, avatar_url: newAvatarUrl, metadata: newMeta });
        setIsSaving(false);
        setCroppedAvatar(null);
    };

    const executeKick = async (uid) => {
        setConfirmModal(null);
        await supabase.rpc('squad_kick_member', { req_conv_id: conversationId, req_target_id: uid, req_admin_id: currentUser.id });
        setMembers(prev => {
            const next = { ...prev };
            delete next[uid];
            return next;
        });
    };

    const executePunishment = async () => {
        const { uid, type, isTemp, duration, unit } = punishConfig;
        
        let until = null;
        if (isTemp) {
            const multipliers = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
            const ms = duration * multipliers[unit];
            until = new Date(Date.now() + ms).toISOString();
        } else {
            // For permanent mute, set a date 100 years in the future. For ban, null means permanent.
            until = type === 'mute' ? new Date(Date.now() + 3153600000000).toISOString() : null;
        }

        if (type === 'ban') {
            await supabase.rpc('squad_ban_member', { req_conv_id: conversationId, req_target_id: uid, req_admin_id: currentUser.id, req_banned_until: until });
            setMembers(prev => {
                const next = { ...prev };
                delete next[uid];
                return next;
            });
        } else {
            await supabase.rpc('squad_mute_member', { req_conv_id: conversationId, req_target_id: uid, req_admin_id: currentUser.id, req_muted_until: until });
        }
        setPunishConfig(null);
    };

    const executeDisband = async () => {
        if (disbandInput !== chatInfo.title) return;
        await supabase.from('conversations').delete().eq('id', conversationId);
        onDisband();
    };

    const displayAvatar = croppedAvatar?.url || chatInfo.avatar_url;

    return (
        <div className="si-overlay" onClick={() => setActiveMemberMenu(null)}>
            {selectedFile && (
                <AvatarCropperModal 
                    imageFile={selectedFile} 
                    onCancel={() => setSelectedFile(null)} 
                    onSave={(blob) => {
                        const url = URL.createObjectURL(blob);
                        setCroppedAvatar({ blob, url });
                        setSelectedFile(null);
                    }}
                />
            )}
            <div className="si-sheet" onClick={e => e.stopPropagation()}>
                <div className="si-hero">
                    <button className="si-close" onClick={onClose}><i className="fas fa-times"></i></button>
                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => {
                        if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
                        e.target.value = null;
                    }} />
                    <div className="si-avatar-container" onClick={() => myRole === 'owner' && fileInputRef.current?.click()} style={{cursor: myRole === 'owner' ? 'pointer' : 'default'}}>
                        <div className="si-avatar">
                            {displayAvatar ? <img src={displayAvatar} alt="Squad" /> : <i className="fas fa-users"></i>}
                        </div>
                        {myRole === 'owner' && <div className="si-avatar-edit"><i className="fas fa-pencil"></i></div>}
                    </div>
                    <h2 className="si-title">{chatInfo.title}</h2>
                    <div className="si-ppn">#{conversationId.substring(0,8).toUpperCase()}</div>
                    <div className="si-badges">
                        <span className={`si-badge ${chatInfo.metadata?.privacy === 'private' ? 'private' : 'public'}`}>
                            <i className={`fas fa-${chatInfo.metadata?.privacy === 'private' ? 'lock' : 'globe'}`}></i> {chatInfo.metadata?.privacy || 'public'}
                        </span>
                        {chatInfo.metadata?.focus && (
                            <span className="si-badge" style={{background: 'rgba(255,255,255,0.1)', color: '#ccc'}}>{chatInfo.metadata.focus}</span>
                        )}
                    </div>
                </div>

                <div className="si-tabs">
                    <div className={`si-tab ${activeTab === 'directory' ? 'active' : ''}`} onClick={() => setActiveTab('directory')}>Directory</div>
                    <div className={`si-tab ${activeTab === 'vault' ? 'active' : ''}`} onClick={() => setActiveTab('vault')}>Vault</div>
                    {myRole === 'owner' && <div className={`si-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Control Panel</div>}
                </div>

                <div className="si-body">
                    {activeTab === 'directory' && (
                        <div className="si-directory">
                            {Object.entries(members).map(([uid, m]) => (
                                <div className="si-member-row" key={uid}>
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

                    {activeTab === 'vault' && (
                        <div className="si-vault">
                            {vaultFiles.length > 0 && (
                                <div className="si-vault-section">
                                    <h4 className="si-vault-title">Files & Documents</h4>
                                    <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                                        {vaultFiles.map((f, i) => (
                                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="si-vault-item" key={i}>
                                                <div className="si-vault-icon"><i className="fas fa-file"></i></div>
                                                <div className="si-vault-info">
                                                    <div className="si-vault-name">{f.name}</div>
                                                    <div className="si-vault-meta">Shared File</div>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                            
                            {vaultLinks.length > 0 && (
                                <div className="si-vault-section">
                                    <h4 className="si-vault-title">Shared Links</h4>
                                    <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                                        {vaultLinks.map((l, i) => (
                                            <a href={l.url} target="_blank" rel="noopener noreferrer" className="si-vault-item" key={i}>
                                                <div className="si-vault-icon link"><i className="fas fa-link"></i></div>
                                                <div className="si-vault-info">
                                                    <div className="si-vault-name link">{l.url}</div>
                                                    <div className="si-vault-meta">From {l.sender}</div>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {vaultFiles.length === 0 && vaultLinks.length === 0 && (
                                <div className="si-vault-empty">
                                    <i className="fas fa-box-open"></i>
                                    <p>The vault is empty.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'settings' && myRole === 'owner' && (
                        <div className="si-settings">
                            <div className="si-settings-group">
                                <label className="si-label">Squad Name</label>
                                <input type="text" className="si-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                            </div>
                            <div className="si-settings-group">
                                <label className="si-label">Privacy Control</label>
                                <div className="si-privacy-toggle">
                                    <button className={`si-pt-btn ${editPrivacy === 'public' ? 'active' : ''}`} onClick={() => setEditPrivacy('public')}>
                                        <i className="fas fa-globe"></i> Public
                                    </button>
                                    <button className={`si-pt-btn ${editPrivacy === 'private' ? 'active' : ''}`} onClick={() => setEditPrivacy('private')}>
                                        <i className="fas fa-lock"></i> Private
                                    </button>
                                </div>
                            </div>
                            <button className="si-save-btn" onClick={handleSaveSettings} disabled={isSaving || !editTitle.trim()}>
                                {isSaving ? <i className="fas fa-circle-notch fa-spin"></i> : "Update Settings"}
                            </button>

                            <hr style={{border:'none', borderTop:'1px solid rgba(255,255,255,0.05)', margin:'2rem 0'}}/>

                            <div className="si-settings-group">
                                <label className="si-label" style={{color:'#ff5f5f'}}>Danger Zone</label>
                                <p style={{fontSize:'0.8rem', color:'#888', marginBottom:'1rem'}}>Disbanding the squad will permanently delete all messages, files, and links. This action cannot be undone.</p>
                                <button className="si-disband-btn" onClick={() => setDisbandModal(true)}>
                                    <i className="fas fa-triangle-exclamation"></i> Disband Squad
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Kick Confirmation Modal */}
            {confirmModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3>Kick Member</h3>
                        <p>Are you sure you want to remove <strong>{confirmModal.name}</strong> from the squad? They can rejoin if the group is public.</p>
                        <div className="cm-footer">
                            <button className="cm-btn-cancel" onClick={() => setConfirmModal(null)}>Cancel</button>
                            <button className="cm-btn-danger" onClick={() => executeKick(confirmModal.uid)}>Kick User</button>
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
                                <input type="number" min="1" value={punishConfig.duration} onChange={e => setPunishConfig({...punishConfig, duration: parseInt(e.target.value) || 1})} />
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
                            <button className="cm-btn-cancel" onClick={() => setPunishConfig(null)}>Cancel</button>
                            <button className="cm-btn-danger" onClick={executePunishment}>Apply {punishConfig.type === 'ban' ? 'Ban' : 'Restriction'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Disband Modal */}
            {disbandModal && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-card">
                        <h3 style={{color: '#ff5f5f'}}>Disband Squad</h3>
                        <p>This action is irreversible. All messages, files, and links will be destroyed.</p>
                        <p style={{fontSize: '0.8rem', color: '#aaa', marginTop: '10px'}}>Type <strong>{chatInfo.title}</strong> to confirm:</p>
                        <input 
                            type="text" 
                            className="cm-text-input" 
                            placeholder={chatInfo.title}
                            value={disbandInput}
                            onChange={e => setDisbandInput(e.target.value)}
                        />
                        <div className="cm-footer" style={{marginTop: '1rem'}}>
                            <button className="cm-btn-cancel" onClick={() => { setDisbandModal(false); setDisbandInput(''); }}>Cancel</button>
                            <button className="cm-btn-danger" onClick={executeDisband} disabled={disbandInput !== chatInfo.title}>Disband Forever</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const GroupChat = ({ chat, currentUser, onClose, onJoin, isJoining }) => {
    const { user: userProfile } = usePlatform();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [members, setMembers] = useState({});
    const [myRole, setMyRole] = useState('member');
    const [activeMenu, setActiveMenu] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);

    // Group Hub State
    const [localChatInfo, setLocalChatInfo] = useState({ title: chat.title, avatar_url: chat.avatar_url, metadata: chat.metadata });
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    
    // Moderation State
    const [myMutedUntil, setMyMutedUntil] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // ID of message to delete

    // Search State
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
    const [showSearchList, setShowSearchList] = useState(false);

    const flowRef = useRef(null);

    useEffect(() => {
        const fetchState = async () => {
            // OPTIMIZATION: Fire the heavy queries in parallel instead of sequentially
            const [msgResponse, memResponse] = await Promise.all([
                supabase.from('messages')
                    .select('*')
                    .eq('conversation_id', chat.conversation_id)
                    .order('created_at', { ascending: true }),
                supabase.from('conversation_members')
                    .select('user_id, role, muted_until')
                    .eq('conversation_id', chat.conversation_id)
            ]);

            let memMap = {};

            // If we have members, fetch their profile metadata
            if (memResponse.data && memResponse.data.length > 0) {
                const userIds = memResponse.data.map(m => m.user_id);
                
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, avatar_url')
                    .in('id', userIds);

                memResponse.data.forEach(m => {
                    const prof = profiles?.find(p => p.id === m.user_id);
                    memMap[m.user_id] = { role: m.role, name: prof?.full_name, avatar: prof?.avatar_url };
                    if (m.user_id === currentUser.id) {
                        setMyRole(m.role);
                        setMyMutedUntil(m.muted_until);
                    }
                });
                setMembers(memMap);
            }

            // Immediately set the messages that we fetched concurrently
            if (msgResponse.data) {
                setMessages(msgResponse.data.map(m => ({ ...m, status: 'sent' })));
            }
            
            setIsLoading(false);
        };

        fetchState();

        const channel = supabase.channel(`group_${chat.conversation_id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}` }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, { ...payload.new, status: 'sent' }];
                    });
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, status: 'sent' } : m));
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [chat.conversation_id]);

    useEffect(() => {
        if (flowRef.current && !isSearchActive) {
            flowRef.current.scrollTop = flowRef.current.scrollHeight;
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

    const handleSend = async () => {
        if (!input.trim()) return;
        const msgText = input;
        setInput('');

        // Handle Edit
        if (editingMessage) {
            setMessages(prev => prev.map(m => m.id === editingMessage.id ? { ...m, text: msgText, is_edited: true } : m));
            await supabase.from('messages').update({ text: msgText, is_edited: true }).eq('id', editingMessage.id);
            setEditingMessage(null);
            return;
        }

        const currentReplyId = replyingTo?.id;
        setReplyingTo(null);

        // Optimistic UI temp message
        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: tempId, conversation_id: chat.conversation_id,
            sender_id: currentUser.id, text: msgText,
            reply_to_id: currentReplyId,
            created_at: new Date().toISOString(), status: 'pending'
        }]);

        const { data } = await supabase.from('messages').insert({
            conversation_id: chat.conversation_id,
            sender_id: currentUser.id,
            text: msgText,
            reply_to_id: currentReplyId
        }).select().single();

        if (data) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...data, status: 'sent' } : m));
        }
    };

    const confirmAndDelete = async () => {
        if (!deleteConfirm) return;
        const msgId = deleteConfirm;
        setDeleteConfirm(null);
        
        setMessages(prev => prev.filter(m => m.id !== msgId));
        await supabase.from('messages').delete().eq('id', msgId);
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenu(null);
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

    return (
        <div className="squad-chat-overlay">
            <div className="squad-bg-pattern"></div>
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
                    <button className="icon-button back-btn" onClick={onClose}><i className="fas fa-chevron-left"></i></button>
                    <div className="squad-contact-profile" onClick={() => !chat.is_preview && setIsInfoOpen(true)} style={{cursor: chat.is_preview ? 'default' : 'pointer'}}>
                        <div className="squad-avatar-ring">
                            {localChatInfo.avatar_url ? (
                                <img src={localChatInfo.avatar_url} alt="Squad Avatar" />
                            ) : (
                                <div className="squad-default-avatar"><i className="fas fa-users"></i></div>
                            )}
                        </div>
                        <div className="squad-header-info">
                            <h2>{localChatInfo.title}</h2>
                            <div className="squad-meta-tags">
                                <span className="squad-badge focus">{localChatInfo.metadata?.focus || 'General'}</span>
                                <span className="squad-badge count"><i className="fas fa-user"></i> {Object.keys(members).length}</span>
                            </div>
                        </div>
                    </div>
                    <button className="icon-button" style={{marginLeft: 'auto'}} onClick={() => setIsSearchActive(true)}><i className="fas fa-search"></i></button>
                </header>
            )}

            <main className="squad-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={() => setActiveMenu(null)}>
                {isLoading ? (
                    <div className="squad-loading-state">
                        <i className="fas fa-circle-notch fa-spin"></i>
                        <p>Syncing Squad comms...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="squad-empty-state">
                        <i className="fas fa-user-group"></i>
                        <p>{chat.is_preview ? "No messages yet. Join to start the discussion!" : "No messages yet. Start the discussion!"}</p>
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
                                    <img src={sender.avatar || 'https://via.placeholder.com/150'} alt="Avatar" className="squad-msg-avatar" />
                                )}
                                <div className="squad-bubble-wrapper">
                                    {!isMine && (
                                        <div className="squad-sender-name">
                                            {sender.name}
                                            {sender.role === 'owner' && <i className="fas fa-crown admin-crown"></i>}
                                        </div>
                                    )}
                                    <div className="squad-bubble">
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
                                    
                                    {m.text}
                                    
                                    <div className={`squad-time-meta ${isMine ? 'mine-meta' : ''}`}>
                                        {m.is_edited && <span>edited</span>}
                                        {formatTime(m.created_at)}
                                        {isMine && (m.status === 'pending' ? <i className="fa-solid fa-clock" style={{fontSize: '0.6rem'}}></i> : <i className="fa-solid fa-check"></i>)}
                                    </div>
                                </div>
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
                {chat.is_preview ? (
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
                        
                        {myMutedUntil && new Date(myMutedUntil) > new Date() ? (
                            <div className="squad-muted-notice">
                                <i className="fas fa-microphone-slash"></i>
                                {new Date(myMutedUntil).getFullYear() > 2100 ? "You have been permanently restricted from posting." : `You are restricted from posting until ${new Date(myMutedUntil).toLocaleString()}.`}
                            </div>
                        ) : (
                            <div className="squad-dock">
                                <input 
                                    type="text" 
                                    placeholder="Squad message..." 
                                    value={input} 
                                    onChange={e => setInput(e.target.value)} 
                                    onKeyPress={e => e.key === 'Enter' && handleSend()} 
                                />
                                <button className="squad-send-btn" onClick={handleSend} disabled={!input.trim()}>
                                    <i className={`fa-solid ${editingMessage ? 'fa-check' : 'fa-arrow-up'}`}></i>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </footer>

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
                />
            )}
        </div>
    );
};
export default GroupChat;