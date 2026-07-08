import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import NoteCard from './components/NoteCard.jsx';
import NoteContextMenu from './components/NoteContextMenu.jsx';
import NoteInputDock from './components/NoteInputDock.jsx';
import GenericConfirmModal from './components/GenericConfirmModal.jsx';
import './Notes.css';

const Notes = ({ currentUser, onClose }) => {
    const [conversationId, setConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [activeMenu, setActiveMenu] = useState(null);
    const [alertNotice, setAlertNotice] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    
    const fileInputRef = useRef(null);
    const flowRef = useRef(null);

    useEffect(() => {
        const initNotes = async () => {
            // 1. Call RPC to get or create the Notes conversation
            const { data, error } = await supabase.rpc('get_or_create_notes', { req_user_id: currentUser.id });
            if (error) {
                console.error("Failed to init Notes:", error);
                return;
            }
            setConversationId(data);

            // 2. Fetch existing notes
            const { data: msgs } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', data)
                .order('created_at', { ascending: true });
            
            if (msgs) setMessages(msgs);
            setIsLoading(false);

            // 3. Realtime Subscription
            const channel = supabase.channel(`room_${data}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${data}` }, (payload) => {
                    setMessages(prev => {
                        if (prev.find(m => m.id === payload.new.id)) return prev;
                        return [...prev, payload.new];
                    });
                })
                .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${data}` }, (payload) => {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                })
                .subscribe();

            return () => supabase.removeChannel(channel);
        };

        initNotes();
    }, [currentUser.id]);

    useEffect(() => {
        if (flowRef.current) flowRef.current.scrollTop = flowRef.current.scrollHeight;
    }, [messages, isUploading]);

    const handleSend = async () => {
        if (!input.trim() || !conversationId) return;

        const msgText = input;
        setInput('');

        // Optimistic UI
        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: tempId, conversation_id: conversationId,
            sender_id: currentUser.id, text: msgText,
            attachments: [], created_at: new Date().toISOString()
        }]);

        const { data, error } = await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: currentUser.id,
            text: msgText
        }).select().maybeSingle();

        if (data) {
            setMessages(prev => prev.map(m => m.id === tempId ? data : m));
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !conversationId) return;

        if (file.size > 10 * 1024 * 1024) {
            setAlertNotice("File is too large. Please select a file smaller than 10MB.");
            e.target.value = null;
            return;
        }

        setIsUploading(true);
        try {
            // 1. Convert File to ArrayBuffer to prevent 'postMessage' cloning errors
            const arrayBuffer = await file.arrayBuffer();

            // 2. Upload to Supabase Storage
            const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const filePath = `${currentUser.id}/${Date.now()}_${safeName}`;
            
            const { error: uploadError } = await supabase.storage
                .from('user_notes')
                .upload(filePath, arrayBuffer, {
                    contentType: file.type,
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('user_notes')
                .getPublicUrl(filePath);

            // 3. Insert Message with Attachment Metadata
            const attachment = {
                name: file.name,
                url: publicUrl,
                path: filePath, // Store the path so we can delete it later
                type: file.type,
                size: file.size
            };

            await supabase.from('messages').insert({
                conversation_id: conversationId,
                sender_id: currentUser.id,
                text: '', // No text needed in the bubble
                attachments: [attachment]
            });

        } catch (err) {
            setAlertNotice("Media upload blocked. Ensure the file is under 10MB and is a supported format.");
        } finally {
            setIsUploading(false);
            e.target.value = null; // reset input
        }
    };

    const formatTime = (isoString) => {
        if (!isoString) return '';
        return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    const confirmAndDeleteNote = async () => {
        if (!deleteConfirm) return;
        const id = deleteConfirm;
        setDeleteConfirm(null);

        // 1. Find the message locally to check for attachments
        const noteToDelete = messages.find(m => m.id === id);
        
        // 2. Optimistic UI update
        setMessages(prev => prev.filter(m => m.id !== id));
        setActiveMenu(null);

        try {
            // 3. Cleanup Storage if files exist
            if (noteToDelete?.attachments && noteToDelete.attachments.length > 0) {
                const paths = noteToDelete.attachments
                    .map(att => att.path)
                    .filter(Boolean); // Only get valid paths

                if (paths.length > 0) {
                    console.log("[Squad:Vault] Purging associated storage files:", paths);
                    await supabase.storage.from('user_notes').remove(paths);
                }
            }

            // 4. Delete the database record
            const { error } = await supabase.from('messages').delete().eq('id', id);
            if (error) {
                setAlertNotice("Deletion failed. You may lack permission.");
                // Resync
                const { data } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
                if (data) setMessages(data);
            }
        } catch (err) {
            console.error("[Squad:Vault] Resource purge failed:", err);
        }
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setActiveMenu(null);
    };

    const handleDownload = async (url, filename) => {
        setActiveMenu(null);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Network response was not ok');
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } catch (e) {
            const link = document.createElement('a');
            link.href = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    return (
        <div className="notes-overlay">
            <header className="notes-header" style={{ justifyContent: 'flex-start', gap: '1.5rem' }}>
                <button className="icon-button" style={{color: 'white', marginLeft: '-0.5rem'}} onClick={onClose}>
                    <i className="fas fa-chevron-left"></i>
                </button>
                <div className="notes-title-box">
                    <div className="notes-icon"><i className="fas fa-bookmark"></i></div>
                    <div>
                        <h2>My Notes</h2>
                        <p>Personal cloud & quick clips</p>
                    </div>
                </div>
            </header>

            <main className="notes-flow" ref={flowRef} onClick={() => setActiveMenu(null)} onScroll={() => setActiveMenu(null)}>
                {isLoading ? (
                    <div className="notes-loader-container">
                        <i className="fas fa-circle-notch fa-spin"></i>
                        <p>Opening your notes...</p>
                    </div>
                ) : messages.length === 0 && !isUploading ? (
                    <div className="notes-empty-state">
                        <i className="fas fa-cloud-arrow-up"></i>
                        <p>Your secure space for links, files, and thoughts.</p>
                    </div>
                ) : (
                    messages.map(m => (
                        <NoteCard 
                            key={m.id} 
                            m={m} 
                            activeMenu={activeMenu} 
                            setActiveMenu={setActiveMenu} 
                            handleDownload={handleDownload} 
                            formatTime={formatTime} 
                        />
                    ))
                )}
                
                {isUploading && (
                    <div className="note-card" style={{opacity: 0.7}}>
                        <div className="note-file-box" style={{background: 'transparent', border: 'none'}}>
                            <i className="fas fa-circle-notch fa-spin note-file-icon"></i>
                            <div className="note-file-info"><span className="note-file-name">Uploading file...</span></div>
                        </div>
                    </div>
                )}
            </main>

            {alertNotice && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                    <div style={{ background: '#121212', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', width: '100%', maxWidth: '360px', padding: '1.5rem', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: alertNotice.success ? '#42d7b8' : '#ffab40', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {alertNotice.success ? <i className="fas fa-check-circle"></i> : <i className="fas fa-exclamation-circle"></i>} {alertNotice.title || 'Notice'}
                        </h3>
                        <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>{typeof alertNotice === 'string' ? alertNotice : alertNotice.msg}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: 600, fontFamily: 'Poppins, sans-serif', cursor: 'pointer', border: 'none', fontSize: '0.9rem', background: 'var(--accent-teal)', color: '#000' }} onClick={() => setAlertNotice(null)}>Okay</button>
                        </div>
                    </div>
                </div>
            )}

            <NoteContextMenu 
                activeMenu={activeMenu} 
                handleCopy={handleCopy} 
                handleDownload={handleDownload} 
                deleteNote={(id) => setDeleteConfirm(id)} 
            />

            {deleteConfirm && (
                <GenericConfirmModal
                    title="Delete Note"
                    description="Are you sure you want to permanently delete this note and its attachments?"
                    onConfirm={confirmAndDeleteNote}
                    onCancel={() => setDeleteConfirm(null)}
                    confirmText="Delete Note"
                    isDanger={true}
                />
            )}

            <NoteInputDock 
                fileInputRef={fileInputRef} 
                handleFileUpload={handleFileUpload} 
                isUploading={isUploading} 
                input={input} 
                setInput={setInput} 
                handleSend={handleSend} 
            />
        </div>
    );
};

export default Notes;