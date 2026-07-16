import React, { useState, useEffect, useRef } from 'react';
import { supabase, useGeminiAudio } from '@linkup-platform/sdk-core';
import DOMPurify from 'dompurify';
import { useParticipants, useLocalParticipant } from '@livekit/components-react';
import GenericConfirmModal from './GenericConfirmModal.jsx';
import FloatingLiveOrb from './FloatingLiveOrb.jsx';
import ConnectionRing from './ConnectionRing.jsx';
import LiveStageModPanel from './LiveStageModPanel.jsx';
import LiveStageAttendantQs from './LiveStageAttendantQs.jsx';
import InteractiveBoard from '../../../src/core/components/InteractiveBoard.jsx';
import { invokeSocial } from '../api.js';

const LiveStageContent = ({ conversationId, chatInfo, members, liveState, setLiveState, onLeave, currentUser, pendingChunks, setShowMironSetup, devBoardPayload, setDevBoardPayload }) => {
    const [qInput, setQInput] = useState('');
    const [liveQuestions, setLiveQuestions] = useState([]);
    const [aiConnected, setAiConnected] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [hostTab, setHostTab] = useState('pending');
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [modLoading, setModLoading] = useState(null);
    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();
    const [mironAvatarError, setMironAvatarError] = useState(false);
    const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";

    const [spokenText, setSpokenText] = useState("");
    const [activeBoardBlocks, setActiveBoardBlocks] = useState([]);
    const [boardMode, setBoardMode] = useState(false);

    const hostId = chatInfo.metadata?.live_host_id;
    const hostInfo = members[hostId] || { name: 'Host', avatar: 'https://via.placeholder.com/150' };
    const isMeHost = currentUser.id === hostId;
    
    const hostParticipant = participants.find(p => p.identity === hostId);
    const isHostSpeaking = hostParticipant ? hostParticipant.isSpeaking : false;
    const isHostPaused = !isMeHost && !hostParticipant;

    const questionsEndRef = useRef(null);

    useEffect(() => {
        if (devBoardPayload) setBoardMode(true);
    }, [devBoardPayload]);

    const closeBoardMode = () => {
        setBoardMode(false);
        if (setDevBoardPayload) setDevBoardPayload(null);
        setActiveBoardBlocks([]);
    };

    // AI Stage State
    const isAiHosting = chatInfo.metadata?.ai_hosting === true;
    const [stageMicEnabled, setStageMicEnabled] = useState(false);
    const [isMironSpeaking, setIsMironSpeaking] = useState(false);
    const aiSocketRef = useRef(null);

    const { playAudioChunk } = useGeminiAudio(aiSocketRef, isAiHosting && isMeHost && stageMicEnabled);

    // LiveKit Mic Control override
    useEffect(() => {
        if (isMeHost && localParticipant) {
            localParticipant.setMicrophoneEnabled(stageMicEnabled);
        }
    }, [stageMicEnabled, isMeHost, localParticipant]);

    // Heartbeat Engine (Host Only)
    useEffect(() => {
        if (liveState !== 'full' || !isMeHost || devBoardPayload) return;
        const beat = () => {
            supabase.rpc('heartbeat_live_session', { conv_id: conversationId, req_host_id: currentUser.id });
        };
        beat(); // Initial pulse
        const int = setInterval(beat, 15000); // Pulse every 15s
        return () => clearInterval(int);
    }, [liveState, isMeHost, conversationId, currentUser.id, devBoardPayload]);



    // AI Stage WebSocket Bridge
    useEffect(() => {
        if (liveState === 'full' && isAiHosting) {
            console.log(`[Client|Stage] Initializing AI Stage WS... Target: ${conversationId}`);
            const gatewayUrl = `wss://linkup-gateway.getyeteklu2.workers.dev/realtime-ai?agent=${conversationId}`;
            const ws = new WebSocket(gatewayUrl);
            aiSocketRef.current = ws;

            ws.onopen = () => {
                console.log("[Client|Stage] WS Connection Opened. Edge Worker handles Gemini configuration.");
                setAiConnected(true);
                
                // Trigger the DO state machine to fetch chunks from the DB and start lecturing
                if (isMeHost) {
                    console.log(`[Client|Stage] Triggering DO State Machine to start lecture.`);
                    ws.send(JSON.stringify({ action: "start_lecture" }));
                }
            };

            let timeoutId;
            
            ws.onerror = (error) => {
                console.error("[Client|Stage] ❌ WS Error:", error);
            };

            ws.onclose = (event) => {
                console.warn(`[Client|Stage] 🔌 WS Closed. Code: ${event.code}, Reason: ${event.reason}`);
                setAiConnected(false);
            };

            ws.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    
                    // Intercept Dynamic Board Synchronization
                    if (payload.type === "chunk_transition") {
                        setSpokenText("");
                        const rawChunk = payload.chunk || "";

                        // INTERCEPT PRE-RENDERED BOARD ASSET TAG
                        const boardMatch = rawChunk.match(/\[BOARD_([a-zA-Z0-9_\-]+)\]/i);
                        if (boardMatch) {
                            const boardId = boardMatch[1];
                            supabase.from('board_drawings').select('payload').eq('id', boardId).single().then(({data}) => {
                                if (data && data.payload) {
                                    setDevBoardPayload(data.payload);
                                }
                            });
                        }

                        const blocks = [];
                        const regex = /\[print\]([\s\S]*?)\[print\]/gi;
                        let match;
                        while ((match = regex.exec(rawChunk)) !== null) {
                            blocks.push(match[1]);
                        }
                        
                        if (blocks.length > 0) {
                            setBoardMode(true);
                            const parsed = blocks.map(blockStr => {
                                let currentStyles = { u: false, h: false, p: false, b: false, i: false, t: false };
                                const tokens = blockStr.split(/(\{[uhpbit]\})/i);
                                let spans = [];
                                for (const token of tokens) {
                                    const tagMatch = token.match(/^\{([uhpbit])\}$/i);
                                    if (tagMatch) {
                                        const tag = tagMatch[1].toLowerCase();
                                        currentStyles[tag] = !currentStyles[tag];
                                    } else if (token) {
                                        const subWords = token.split(/(\s+)/);
                                        for (const sw of subWords) {
                                            if (sw) spans.push({ text: sw, styles: { ...currentStyles } });
                                        }
                                    }
                                }
                                return spans;
                            });
                            setActiveBoardBlocks(parsed);
                        } else {
                            // If no print tags, clear the board text payload but maintain boardMode if dev payload is active
                            setActiveBoardBlocks([]);
                        }
                        return;
                    }
                    
                    // Intercept Moderation Flags from DO REST Compiler
                    if (payload.type === "moderation_warning") {
                        if (payload.flags && Array.isArray(payload.flags)) {
                            payload.flags.forEach((flag) => {
                                console.warn(`[Moderation] Miron flagged ${flag.sender_name} for: ${flag.reason}`);
                                // We could trigger an alert notice here to the Hostess UI
                                // e.g. "Miron flagged Spammer for offensive language."
                            });
                        }
                        return;
                    }

                    if (payload.serverContent?.modelTurn) {
                        console.log("[Client|Stage] 🗣️ Received Audio/Turn from Miron!");
                    } else if (payload.serverContent?.turnComplete) {
                        console.log("[Client|Stage] 🏁 Miron finished turn.");
                    } else if (payload.setupComplete) {
                        console.log("[Client|Stage] ✅ Miron Setup Complete intercepted at Client!");
                    } else if (payload.error) {
                        console.error("[Client|Stage] ❌ Gemini Error Payload:", payload.error);
                    } else {
                        console.log("[Client|Stage] 📩 Received payload:", payload);
                    }

                    if (payload.serverContent?.outputTranscription?.text) {
                        setSpokenText(prev => prev + " " + payload.serverContent.outputTranscription.text);
                    }

                    if (payload.serverContent?.modelTurn?.parts) {
                        for (const part of payload.serverContent.modelTurn.parts) {
                            if (part.inlineData?.data) {
                                playAudioChunk(part.inlineData.data);
                                setIsMironSpeaking(true);
                                clearTimeout(timeoutId);
                                timeoutId = setTimeout(() => setIsMironSpeaking(false), 800);
                            }
                        }
                    }
                } catch (e) {
                    console.warn("[Client|Stage] Non-JSON message or parse error:", event.data);
                }
            };

            return () => {
                ws.close();
                aiSocketRef.current = null;
            };
        }
    }, [liveState, isAiHosting, conversationId, isMeHost]);



    // Independent Live Questions Subscription (Robust CRUD support)
    useEffect(() => {
        const fetchQs = async () => {
            const startedAt = chatInfo.metadata?.live_started_at;
            
            let query = supabase.from('live_stage_questions')
                .select('*')
                .eq('conversation_id', conversationId);
                
            if (startedAt) {
                // Chronological Isolation: Only fetch questions asked during this session
                query = query.gte('created_at', startedAt);
            }

            const { data } = await query.order('created_at', { ascending: true });
            if (data) setLiveQuestions(data.slice(-30)); // Hold up to 30 to support moderation queues
        };
        fetchQs();

        const sub = supabase.channel(`live_qs_${conversationId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_stage_questions', filter: `conversation_id=eq.${conversationId}` }, payload => {
                const startedAt = chatInfo.metadata?.live_started_at;
                
                if (payload.eventType === 'INSERT' && startedAt && new Date(payload.new.created_at) < new Date(startedAt)) {
                    return;
                }

                setLiveQuestions(p => {
                    if (payload.eventType === 'INSERT') return [...p, payload.new].slice(-30);
                    if (payload.eventType === 'UPDATE') return p.map(q => q.id === payload.new.id ? payload.new : q);
                    if (payload.eventType === 'DELETE') return p.filter(q => q.id !== payload.old.id);
                    return p;
                });
            }).subscribe();
        
        return () => supabase.removeChannel(sub);
    }, [conversationId, chatInfo.metadata?.live_started_at]);

    useEffect(() => {
        if (questionsEndRef.current && !isMeHost) questionsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [liveQuestions, isMeHost]);

    const handleSendQuestion = async () => {
        if (!qInput.trim() || isSending) return;
        setIsSending(true);
        
        console.log(`[Client|Stage] 📝 handleSendQuestion triggered. Payload text: "${qInput.trim()}"`);
        
        // Queue the question in the DO Bucket silently if AI is hosting
        if (isAiHosting && aiSocketRef.current?.readyState === WebSocket.OPEN) {
            console.log("[Client|Stage] 🚀 Queuing question directly to DO Bucket.");
            aiSocketRef.current.send(JSON.stringify({
                action: "submit_question",
                user_id: currentUser.id,
                sender: members[currentUser.id]?.name || 'A student',
                text: qInput.trim()
            }));
        }

        const { error } = await supabase.from('live_stage_questions').insert({
            conversation_id: conversationId,
            sender_id: currentUser.id,
            text: qInput.trim(),
            status: 'pending'
        });
        if (!error) setQInput('');
        setIsSending(false);
    };

    const toggleMironState = async (turnOn) => {
        if (turnOn) {
            setShowMironSetup(true);
        } else {
            if (stageMicEnabled) setStageMicEnabled(false);
            try {
                const res = await invokeSocial({ action: 'toggle_miron', conversation_id: conversationId, ai_hosting: false });
                if (res.error) throw new Error(res.error);
            } catch(e) {
                console.error("Failed to toggle Miron:", e.message);
            }
        }
    };

    // Moderation Actions
    const handleModAction = async (id, action, updates) => {
        setModLoading({ id, action });
        const { error } = await supabase.from('live_stage_questions').update(updates).eq('id', id);
        if (!error) {
            setLiveQuestions(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
            
            // Intercept Pin Action and inject question into DO State Machine
            if (action === 'pin' && isAiHosting && aiSocketRef.current?.readyState === WebSocket.OPEN) {
                const q = liveQuestions.find(x => x.id === id);
                if (q) {
                    const senderName = members[q.sender_id]?.name || 'A student';
                    console.log(`[Client|Stage] Injecting Question into DO State Machine.`);
                    aiSocketRef.current.send(JSON.stringify({
                        action: "inject_question",
                        text: q.text,
                        sender: senderName
                    }));
                }
            }
        } else {
            console.error("Moderation action failed:", error);
        }
        setModLoading(null);
    };

    // Hostess Views
    const pinnedQ = liveQuestions.find(q => q.is_pinned);
    const pendingQs = liveQuestions.filter(q => q.status === 'pending' && !q.is_pinned);
    const approvedQs = liveQuestions.filter(q => q.status === 'approved' && !q.is_pinned);
    
    // Attendant View
    const attendantViewQs = liveQuestions.filter(q => !q.is_pinned);
    const shouldCompressStage = !!pinnedQ || liveQuestions.length > 0;
    const isConnected = isAiHosting ? aiConnected : !isHostPaused;

    const renderBoardBlocks = () => {
        const spokenWords = spokenText.split(/\s+/).map(cleanWord).filter(Boolean);
        
        return activeBoardBlocks.map((spans, bIdx) => {
            let targetWords = spans.filter(s => s.text.trim()).map(s => cleanWord(s.text));
            let revealedIndex = -1;
            let sIdx = 0;
            
            for (let tIdx = 0; tIdx < targetWords.length; tIdx++) {
                const target = targetWords[tIdx];
                if (!target) {
                    revealedIndex = tIdx; 
                    continue;
                }
                let found = false;
                for (let i = sIdx; i < Math.min(sIdx + 10, spokenWords.length); i++) {
                    if (spokenWords[i] === target || spokenWords[i].includes(target) || target.includes(spokenWords[i])) {
                        found = true;
                        sIdx = i + 1;
                        revealedIndex = tIdx;
                        break;
                    }
                }
                if (!found) break;
            }
            
            let spanWordCounter = 0;
            return (
                <div key={bIdx} className="dynamic-blackboard-block">
                    {spans.map((span, sIdx) => {
                        const isSpace = !span.text.trim();
                        let isRevealed = false;
                        if (!isSpace) {
                            isRevealed = spanWordCounter <= revealedIndex;
                            spanWordCounter++;
                        } else {
                            isRevealed = spanWordCounter - 1 <= revealedIndex;
                        }
                        
                        let cls = `bb-span ${isRevealed ? 'revealed' : 'ghost'}`;
                        if (isRevealed) {
                            if (span.styles.u) cls += ' bb-u';
                            if (span.styles.h) cls += ' bb-h';
                            if (span.styles.p) cls += ' bb-p';
                            if (span.styles.b) cls += ' bb-b';
                            if (span.styles.i) cls += ' bb-i';
                            if (span.styles.t) cls += ' bb-t';
                        }
                        
                        return <span key={sIdx} className={cls}>{span.text}</span>
                    })}
                </div>
            );
        });
    };

    if (liveState === 'minimized') {
        return <FloatingLiveOrb hostAvatar={hostInfo.avatar} hostId={hostId} isConnected={isConnected} onClick={() => setLiveState('full')} />;
    }

    return (
        <div className="live-immersive-overlay" style={{ display: 'flex' }}>
            <div className="immersive-ambient"></div>
            
            {showEndConfirm && (
                <GenericConfirmModal
                    title="End Live Session"
                    description="Are you sure you want to end the broadcast? This will disconnect all listeners and close the stage."
                    onConfirm={() => { setShowEndConfirm(false); onLeave(true); }}
                    onCancel={() => setShowEndConfirm(false)}
                    confirmText="End Session"
                    isDanger={true}
                />
            )}

            <header className="immersive-header">
                <div className="header-left-cluster">
                    <div className="header-host-indicator">
                        {isAiHosting ? (
                            <div className="header-miron-orb" style={{ overflow: 'hidden' }}>
                                {!mironAvatarError ? (
                                    <img 
                                        src={mironAvatarUrl} 
                                        alt="Miron" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} 
                                        onError={() => setMironAvatarError(true)} 
                                    />
                                ) : (
                                    <i className="fas fa-sparkles"></i>
                                )}
                            </div>
                        ) : (
                            <img src={hostInfo.avatar} className="header-host-avatar" alt="Host" style={{ filter: isHostPaused ? 'grayscale(100%) opacity(0.5)' : 'none' }} />
                        )}
                    </div>
                    <div className="stage-title-wrap">
                        <h2 className="stage-topic-title" title={chatInfo.metadata?.live_topic || chatInfo.title}>{chatInfo.metadata?.live_topic || chatInfo.title}</h2>
                        <div className="stage-meta-indicator">
                            <span className="stage-live-dot"></span> {participants.length} Attending
                        </div>
                    </div>
                </div>
                
                <div className="header-right-cluster">
                    {isMeHost && (
                        <button 
                            className={`miron-header-toggle ${isAiHosting ? 'active' : ''}`} 
                            onClick={() => toggleMironState(!isAiHosting)}
                            title={isAiHosting ? "Disconnect Miron" : "Let Miron Host"}
                            style={{ position: 'relative', width: '38px', height: '38px', borderRadius: '50%', padding: 0, overflow: 'visible', background: 'transparent', border: 'none' }}
                        >
                            {isAiHosting && <ConnectionRing isConnected={aiConnected} />}
                            <div className="toggle-avatar-wrapper" style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', position: 'relative', border: isAiHosting ? 'none' : '1px solid rgba(255,255,255,0.2)' }}>
                                <img 
                                    src={mironAvatarUrl} 
                                    alt="Miron Toggle" 
                                    style={{ 
                                        width: '100%', 
                                        height: '100%', 
                                        objectFit: 'cover', 
                                        filter: isAiHosting ? 'none' : 'grayscale(100%) opacity(0.6)',
                                        transition: 'filter 0.3s ease'
                                    }} 
                                />
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isAiHosting ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.1)', color: 'white', fontSize: '0.8rem' }}>
                                    {isAiHosting ? <i className="fas fa-pause text-white"></i> : <i className="fas fa-sparkles text-zinc-300"></i>}
                                </div>
                            </div>
                        </button>
                    )}
                    <button className="minimize-stage-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLiveState('minimized'); }}>
                        <i className="fas fa-compress-alt"></i>
                    </button>
                    <button 
                        className="minimize-stage-btn" 
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); isMeHost ? setShowEndConfirm(true) : onLeave(); }} 
                        style={{color: '#ff5f5f'}}
                    >
                        <i className="fas fa-phone-slash"></i>
                    </button>
                </div>
            </header>

            <main className={`stage-core ${shouldCompressStage && !boardMode ? 'compact-stage-mode' : ''} ${boardMode ? 'board-active' : ''}`}>
                
                {boardMode && (
                    <InteractiveBoard
                        payload={devBoardPayload}
                        spokenText={spokenText}
                        activeBoardBlocks={activeBoardBlocks}
                        onClose={closeBoardMode}
                    />
                )}

                <div className="stage-host-node">
                    <div className="stage-host-avatar-wrapper">
                        <ConnectionRing isConnected={isConnected} />
                        {isConnected && (
                            <>
                                <div className={`voice-halo-ring ${isAiHosting ? 'miron-halo' : ''}`}></div>
                                <div className={`voice-halo-ring ${isAiHosting ? 'miron-halo' : ''}`} style={{animationDelay: '0.6s'}}></div>
                            </>
                        )}
                        {isAiHosting ? (
                            <div className="miron-host-orb" style={{ overflow: 'hidden', width: '100%', height: '100%', margin: 0, position: 'relative', zIndex: 2 }}>
                                {!mironAvatarError ? (
                                    <img 
                                        src={mironAvatarUrl} 
                                        alt="Miron" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} 
                                        onError={() => setMironAvatarError(true)} 
                                    />
                                ) : (
                                    <i className="fas fa-sparkles"></i>
                                )}
                            </div>
                        ) : (
                            <>
                                <img src={hostInfo.avatar} className="host-image-clip" style={{ filter: isHostPaused ? 'grayscale(100%) opacity(0.5)' : 'none', width: '100%', height: '100%', margin: 0, position: 'relative', zIndex: 2 }} alt="Host" />
                                {isHostPaused && (
                                    <div className="host-offline-veil" style={{borderRadius: '50%'}}>
                                        <i className="fas fa-satellite-dish"></i>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="stage-host-label">
                    <h2>{isAiHosting ? 'Miron Athena' : hostInfo.name}</h2>
                    <p>{isAiHosting ? 'AI Study Guide • Hosting' : (isHostPaused ? "Connecting..." : "Broadcasting • Host")}</p>
                </div>

                {isMeHost && (
                    <div className="hostess-ai-controls" style={{ width: '100%', maxWidth: '340px', margin: '0 auto' }}>
                        <button 
                            className={`big-mic-btn ${stageMicEnabled ? 'active-mic' : ''}`}
                            onClick={() => setStageMicEnabled(!stageMicEnabled)}
                        >
                            <i className={`fas fa-microphone${stageMicEnabled ? '' : '-slash'}`}></i> 
                            {stageMicEnabled ? 'Transmitting Audio...' : 'Tap to Start Talking'}
                        </button>
                    </div>
                )}

                {pinnedQ && (
                    <div className="pinned-hero-card">
                        <div className="ph-header">
                            <span className="ph-label"><i className="fas fa-thumbtack"></i> Pinned Topic</span>
                            {isMeHost && (
                                <button className="icon-button ph-unpin" onClick={() => handleModAction(pinnedQ.id, 'unpin', { is_pinned: false })} disabled={modLoading?.id === pinnedQ.id}>
                                    {modLoading?.id === pinnedQ.id && modLoading?.action === 'unpin' ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-times"></i>}
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
                    <LiveStageModPanel 
                        hostTab={hostTab}
                        setHostTab={setHostTab}
                        pendingQs={pendingQs}
                        approvedQs={approvedQs}
                        members={members}
                        handleModAction={handleModAction}
                        modLoading={modLoading}
                    />
                ) : (
                    <LiveStageAttendantQs 
                        attendantViewQs={attendantViewQs}
                        members={members}
                        currentUser={currentUser}
                        questionsEndRef={questionsEndRef}
                    />
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

export default LiveStageContent;