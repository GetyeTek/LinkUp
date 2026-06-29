import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './GroupChat.css';

const GroupChat = ({ chat, currentUser, onClose }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [members, setMembers] = useState({});
    const [myRole, setMyRole] = useState('member');
    const [activeMenu, setActiveMenu] = useState(null);
    const flowRef = useRef(null);

    useEffect(() => {
        const fetchState = async () => {
            const { data: memData } = await supabase
                .from('conversation_members')
                .select('user_id, role, profiles(full_name, avatar_url)')
                .eq('conversation_id', chat.conversation_id);
            
            if (memData) {
                const memMap = {};
                memData.forEach(m => {
                    memMap[m.user_id] = { role: m.role, name: m.profiles?.full_name, avatar: m.profiles?.avatar_url };
                    if (m.user_id === currentUser.id) setMyRole(m.role);
                });
                setMembers(memMap);
            }

            const { data: msgData } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', chat.conversation_id)
                .order('created_at', { ascending: true });
            if (msgData) setMessages(msgData);
        };

        fetchState();

        const channel = supabase.channel(`group_${chat.conversation_id}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}` }, (payload) => {
                setMessages(prev => {
                    if (prev.find(m => m.id === payload.new.id)) return prev;
                    return [...prev, payload.new];
                });
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${chat.conversation_id}` }, (payload) => {
                setMessages(prev => prev.filter(m => m.id !== payload.old.id));
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [chat.conversation_id]);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim()) return;
        const text = input;
        setInput('');
        await supabase.from('messages').insert({ conversation_id: chat.conversation_id, sender_id: currentUser.id, text });
    };

    const handleDelete = async (msgId) => {
        if (!window.confirm("Purge this entry?")) return;
        setActiveMenu(null);
        await supabase.from('messages').delete().eq('id', msgId);
    };

    return (
        <div className="squad-chat-overlay">
            <div className="squad-bg-pattern"></div>
            <header className="squad-header" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
                <button className="icon-button" onClick={onClose}><i className="fas fa-chevron-left"></i></button>
                <div className="squad-header-info">
                    <h2>{chat.title}</h2>
                    <div className="squad-meta-tags">
                        <span className="squad-badge focus">{chat.metadata?.focus || 'General'}</span>
                        <span className="squad-badge count"><i className="fas fa-users"></i> {Object.keys(members).length}</span>
                    </div>
                </div>
            </header>

            <main className="squad-flow" ref={flowRef} onClick={() => setActiveMenu(null)}>
                {messages.length === 0 && (
                    <div className="squad-empty-state">
                        <i className="fas fa-user-group"></i>
                        <p>Squad Online. Awaiting synchronization.</p>
                    </div>
                )}
                {messages.map(m => {
                    const isMine = m.sender_id === currentUser.id;
                    const sender = members[m.sender_id] || { name: 'Portal Guest', role: 'member' };
                    return (
                        <div key={m.id} className={`squad-msg-group ${isMine ? 'mine' : 'theirs'}`} onClick={(e) => {
                            e.stopPropagation();
                            if (isMine || myRole === 'owner' || myRole === 'admin') {
                                setActiveMenu({ msgId: m.id, x: e.clientX, y: e.clientY });
                            }
                        }}>
                            {!isMine && (
                                <div className="squad-sender-name">
                                    {sender.name}
                                    {sender.role === 'owner' && <i className="fas fa-crown admin-crown"></i>}
                                </div>
                            )}
                            <div className="squad-bubble">{m.text}</div>
                        </div>
                    );
                })}
            </main>

            {activeMenu && (
                <div className="squad-ctx-menu" style={{ left: activeMenu.x, top: activeMenu.y }}>
                    <button className="squad-ctx-btn delete" onClick={() => handleDelete(activeMenu.msgId)}>
                        <i className="fas fa-trash"></i> {myRole !== 'member' && !messages.find(m => m.id === activeMenu.msgId)?.sender_id === currentUser.id ? 'Admin Delete' : 'Delete'}
                    </button>
                </div>
            )}

            <footer className="squad-input-area">
                <div className="squad-dock">
                    <input type="text" placeholder="Squad message..." value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSend()} />
                    <button className="squad-send-btn" onClick={handleSend} disabled={!input.trim()}><i className="fas fa-paper-plane"></i></button>
                </div>
            </footer>
        </div>
    );
};
export default GroupChat;