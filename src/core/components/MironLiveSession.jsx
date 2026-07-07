import React, { useState, useEffect, useRef } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import FloatingMironOrb from './FloatingMironOrb.jsx';
import MironConnectionRing from './MironConnectionRing.jsx';
import './MironLiveSession.css';

const MironLiveSession = ({ onClose, mironAvatarUrl }) => {
    const { sessionUser } = usePlatform();
    const [viewState, setViewState] = useState('full');
    const [isConnected, setIsConnected] = useState(false);
    const [micActive, setMicActive] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [transcripts, setTranscripts] = useState([]);
    const [isMironSpeaking, setIsMironSpeaking] = useState(false);

    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const nextStartTimeRef = useRef(0);
    const recognitionRef = useRef(null);
    const micActiveRef = useRef(false);
    const speakingTimeout = useRef(null);
    const transcriptRef = useRef(null);

    useEffect(() => { micActiveRef.current = micActive; }, [micActive]);

    // Auto-scroll transcripts smoothly
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTo({
                top: transcriptRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [transcripts]);

    // 1. Core WebSocket Connection to Gemini DO
    useEffect(() => {
        if (!sessionUser?.id) return;
        const agentId = `miron-personal-${sessionUser.id}`;
        const ws = new WebSocket(`wss://linkup-gateway.getyeteklu2.workers.dev/realtime-ai?agent=${agentId}`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("[Miron Live] Secure Neural Link Established");
            setIsConnected(true);
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
            } catch (err) {
                console.error("WS Parse error", err);
            }
        };

        ws.onclose = () => setIsConnected(false);

        return () => ws.close();
    }, [sessionUser?.id]);

    // 2. Hardware Audio Playback Engine
    const playAudioChunk = (base64Data) => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        
        const rawString = atob(base64Data);
        const array = new Uint8Array(new ArrayBuffer(rawString.length));
        for (let i = 0; i < rawString.length; i++) array[i] = rawString.charCodeAt(i);
        const pcm16 = new Int16Array(array.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

        const buffer = ctx.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        
        const currTime = ctx.currentTime;
        if (nextStartTimeRef.current < currTime) nextStartTimeRef.current = currTime;
        
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;
    };

    // 3. Audio Capture & Hardware Echo Cancellation
    useEffect(() => {
        let stream, ctx, processor;
        let isCancelled = false;

        if (micActive) {
            navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            }).then(s => {
                if (isCancelled) {
                    s.getTracks().forEach(t => t.stop());
                    return;
                }
                stream = s;
                ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                const source = ctx.createMediaStreamSource(stream);
                processor = ctx.createScriptProcessor(2048, 1, 1);
                
                processor.onaudioprocess = (e) => {
                    if (!micActiveRef.current) return;
                    // Hardware Echo Cancellation: Drop mic frames if Miron is actively speaking
                    if (audioContextRef.current && audioContextRef.current.currentTime < nextStartTimeRef.current + 0.4) {
                        return; 
                    }
                    
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                    }
                    
                    let binary = '';
                    const bytes = new Uint8Array(pcmData.buffer);
                    const chunkSize = 0x8000;
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                    }
                    const base64Audio = btoa(binary);
                    
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                            realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } }
                        }));
                    }
                };
                
                source.connect(processor);
                processor.connect(ctx.destination);
            }).catch(err => console.error("Mic denied", err));
        }

        return () => {
            isCancelled = true;
            if (processor) processor.disconnect();
            if (ctx && ctx.state !== 'closed') ctx.close();
            if (stream) stream.getTracks().forEach(t => t.stop());
        };
    }, [micActive]);

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

    if (viewState === 'minimized') {
        return <FloatingMironOrb mironAvatarUrl={mironAvatarUrl} onClick={() => setViewState('full')} />;
    }

    return (
        <div className="ml-overlay">
            <div className="ml-ambient"></div>
            
            <header className="ml-header">
                <button className="athena-close" onClick={() => setViewState('minimized')}><i className="fas fa-chevron-down"></i></button>
                <div className="ml-status">
                    <span className="live-dot"></span> Live Voice Session
                </div>
                <button className="athena-close" onClick={onClose} style={{color: '#ff5f5f'}}><i className="fas fa-phone-slash"></i></button>
            </header>

            <div className="ml-stage">
                <div className="ml-avatar-container">
                    <MironConnectionRing isConnected={isConnected} />
                    {isConnected && (
                        <>
                            <div className="ml-halo"></div>
                            <div className="ml-halo" style={{animationDelay: '0.6s'}}></div>
                        </>
                    )}
                    <img src={mironAvatarUrl} alt="Miron" className="ml-avatar" />
                </div>
            </div>

            <div className="ml-transcript-area">
                <div className="ml-transcript-scroll" ref={transcriptRef}>
                    {transcripts.length === 0 && (
                        <div className="ml-empty-prompt">Listening...</div>
                    )}
                    {transcripts.map(t => (
                        <div key={t.id} className={`ml-bubble-wrap ${t.role}`}>
                            <div className="ml-bubble">
                                {t.text || <span className="ml-typing-dots">...</span>}
                            </div>
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