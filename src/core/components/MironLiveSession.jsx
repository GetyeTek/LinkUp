import React, { useState, useEffect, useRef } from 'react';
import { usePlatform, useGeminiAudio, supabase } from '@linkup-platform/sdk-core';
import FloatingMironOrb from './FloatingMironOrb.jsx';
import MironConnectionRing from './MironConnectionRing.jsx';
import './MironLiveSession.css';

const MironLiveSession = ({ onClose, mironAvatarUrl }) => {
    const { sessionUser } = usePlatform();
    const [sessionId] = useState(() => crypto.randomUUID());
    const [viewState, setViewState] = useState('full');
    const [isConnected, setIsConnected] = useState(false);
    const [micActive, setMicActive] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [transcripts, setTranscripts] = useState([]);
    const [isMironSpeaking, setIsMironSpeaking] = useState(false);

    const wsRef = useRef(null);
    const recognitionRef = useRef(null);
    const speakingTimeout = useRef(null);
    const transcriptRef = useRef(null);
    const isHangingUpRef = useRef(false);

    const { playAudioChunk } = useGeminiAudio(wsRef, micActive);

    // Auto-scroll transcripts smoothly
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTo({
                top: transcriptRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [transcripts]);

    const [isConsulting, setIsConsulting] = useState(false);

    // 1. Core WebSocket Connection to Gemini DO
    useEffect(() => {
        if (!sessionUser?.id) return;
        const agentId = `miron-personal-${sessionUser.id}-${sessionId}`;
        const studentName = sessionUser.user_metadata?.full_name?.split(' ')[0] || "Scholar";
        const url = `wss://linkup-gateway.getyeteklu2.workers.dev/realtime-ai?agent=${agentId}&name=${encodeURIComponent(studentName)}&uid=${sessionUser.id}`;
        
        let ws = null;
        let isMounted = true;
        let reconnectTimer = null;

        const connectWS = async () => {
            if (!isMounted || isHangingUpRef.current) return;
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token || '';
            ws = new WebSocket(url, ["access_token", token]);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log("[Miron Live] Secure Neural Link Established");
                setIsConnected(true);
            };

            ws.onclose = () => {
                setIsConnected(false);
                if (isMounted && !isHangingUpRef.current) {
                    console.log("[Miron Live] Connection lost. Reconnecting in 2 seconds...");
                    reconnectTimer = setTimeout(connectWS, 2000);
                }
            };

            ws.onmessage = (e) => {
            try {
                const payload = JSON.parse(e.data);
                
                // 1. Intercept User Speech Transcript natively from Gemini
                if (payload.serverContent?.inputTranscription?.text) {
                    const userText = payload.serverContent.inputTranscription.text;
                    setTranscripts(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'user' && !last.isFinal) {
                            const updated = [...prev];
                            updated[updated.length - 1] = { ...last, text: userText, isFinal: true };
                            return updated;
                        } else {
                            return [...prev, { id: Date.now(), role: 'user', text: userText, isFinal: true }];
                        }
                    });
                }

                // 2. Intercept Gemini Speech Transcript natively
                if (payload.serverContent?.outputTranscription?.text) {
                    const mironText = payload.serverContent.outputTranscription.text;
                    setTranscripts(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'miron' && !last.isFinal) {
                            const updated = [...prev];
                            updated[updated.length - 1] = { ...last, text: last.text + mironText };
                            return updated;
                        } else {
                            return [...prev, { id: Date.now(), role: 'miron', text: mironText, isFinal: false }];
                        }
                    });
                }

                // 3. Lock the bubble when the turn is over
                if (payload.serverContent?.turnComplete) {
                    setTranscripts(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'miron') {
                            const updated = [...prev];
                            updated[updated.length - 1] = { ...last, isFinal: true };
                            return updated;
                        }
                        return prev;
                    });
                }

                // 4. Play Voice Output Chunks (Failsafe sequential flow)
                if (payload.serverContent?.modelTurn?.parts) {
                    for (const part of payload.serverContent.modelTurn.parts) {
                        if (part.inlineData?.data) {
                            playAudioChunk(part.inlineData.data);
                            setIsMironSpeaking(true);
                            clearTimeout(speakingTimeout.current);
                            speakingTimeout.current = setTimeout(() => setIsMironSpeaking(false), 800);
                        }
                    }
                }

                // 5. Intercept consulting state from Durable Object
                if (payload.type === "tool_call_state") {
                    setIsConsulting(payload.executing);
                }

                // 6. Billing Guard
                if (payload.event === "billing_error" || (payload.error && (payload.error.includes('INSUFFICIENT_CREDITS') || payload.error.toLowerCase().includes('insufficient linkup credits')))) {
                    setTranscripts(prev => [...prev, { 
                        id: Date.now(), 
                        role: 'miron', 
                        text: "You have used all your LinkUp Credits for live voice study sessions. Upgrade to LinkUp Gold for unlimited 24/7 AI stages, audio tutoring, and full exam archives.", 
                        isFinal: true, 
                        isBroke: true 
                    }]);
                    setIsMironSpeaking(false);
                    ws.close();
                }
            } catch (err) {
                console.error("WS Parse error", err);
            }
        };
        };

        connectWS();

        return () => {
            isMounted = false;
            clearTimeout(reconnectTimer);
            if (ws) ws.close();
        };
    }, [sessionUser?.id]);



    // 5. Explicit Text Injection
    const handleSendText = () => {
        if (!textInput.trim()) return;
        const text = textInput.trim();
        setTextInput('');
        
        setTranscripts(prev => [...prev, { id: Date.now(), role: 'user', text, isFinal: true }]);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                clientContent: {
                    turns: [{ role: "user", parts: [{ text }] }],
                    turnComplete: true
                }
            }));
        }
    };

    const handleHangup = () => {
        isHangingUpRef.current = true;
        if (wsRef.current) {
            try {
                wsRef.current.close(1000, "User ended session");
            } catch (e) {}
        }
        onClose();
    };

    if (viewState === 'minimized') {
        return <FloatingMironOrb mironAvatarUrl={mironAvatarUrl} isConnected={isConnected} onClick={() => setViewState('full')} />;
    }

    return (
        <div className="ml-overlay">
            <div className="ml-ambient"></div>
            
            <header className="ml-header">
                <button className="athena-close" onClick={() => setViewState('minimized')}><i className="fas fa-chevron-down"></i></button>
                <div className="ml-status">
                    <span className="live-dot"></span> Live Voice Session
                </div>
                <button className="athena-close" onClick={handleHangup} style={{color: '#ff5f5f'}}><i className="fas fa-phone-slash"></i></button>
            </header>

            <div className="ml-stage">
                <div className="ml-avatar-container">
                    <MironConnectionRing isConnected={isConnected} />
                    {isConnected && !isConsulting && (
                        <>
                            <div className="ml-halo"></div>
                            <div className="ml-halo" style={{animationDelay: '0.6s'}}></div>
                        </>
                    )}
                    {isConsulting && (
                        <>
                            <div className="ml-consulting-pulse-1"></div>
                            <div className="ml-consulting-pulse-2"></div>
                            <div className="ml-consulting-label">Consulting textbook...</div>
                        </>
                    )}
                    <img src={mironAvatarUrl} alt="Miron" className={`ml-avatar ${isConsulting ? 'consulting-mode' : ''}`} />
                </div>
            </div>

            <div className="ml-transcript-area">
                <div className="ml-transcript-scroll" ref={transcriptRef}>
                    <div style={{ minHeight: '60vh', flexShrink: 0 }}></div>
                    {transcripts.length === 0 && (
                        <div className="ml-empty-prompt">Listening...</div>
                    )}
                    {transcripts.map(t => (
                        <div key={t.id} className={`ml-bubble-wrap ${t.role}`}>
                            {t.isBroke ? (
                                <div className="miron-credit-out-card live-mode">
                                    <div className="mcoc-header">
                                        <div className="mcoc-crown-badge">
                                            <i className="fa-solid fa-crown"></i>
                                        </div>
                                        <span className="mcoc-title">Credits Exhausted</span>
                                    </div>
                                    <p className="mcoc-text">{t.text}</p>
                                    <button 
                                        className="mcoc-upgrade-btn" 
                                        onClick={() => window.dispatchEvent(new CustomEvent('open-premium-modal'))}
                                    >
                                        <i className="fa-solid fa-crown"></i>
                                        <span>Upgrade to LinkUp Gold</span>
                                        <i className="fa-solid fa-arrow-right"></i>
                                    </button>
                                </div>
                            ) : (
                                <div className="ml-bubble">
                                    {t.text || <span className="ml-typing-dots">...</span>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="ml-dock-container">
                <div className="ml-dock">
                    <input 
                        type="text" 
                        placeholder="Type to Miron..." 
                        value={textInput}
                        onChange={e => setTextInput(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && handleSendText()}
                    />
                    {textInput.trim() ? (
                        <button className="ml-action-btn ml-send-btn" onClick={handleSendText}>
                            <i className="fas fa-arrow-up"></i>
                        </button>
                    ) : (
                        <button className={`ml-action-btn ml-mic-btn ${micActive ? 'active' : ''}`} onClick={() => setMicActive(!micActive)}>
                            <i className={`fas fa-microphone${micActive ? '' : '-slash'}`}></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MironLiveSession;