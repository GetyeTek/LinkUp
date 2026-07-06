import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'https://esm.sh/marked';
import { invokeMiron } from '../config/api.js';
import { getComponent, usePlatform } from '@linkup-platform/sdk-core';
import DOMPurify from 'dompurify';
import './MironChat.css';

const MironLiveSession = ({ onClose, mironAvatarUrl }) => {
    const { sessionUser } = usePlatform();
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

        ws.onopen = () => console.log("[Miron Live] Secure Neural Link Established");

        ws.onmessage = (e) => {
            try {
                const payload = JSON.parse(e.data);
                
                if (payload.serverContent?.modelTurn?.parts) {
                    let textChunk = "";
                    for (const part of payload.serverContent.modelTurn.parts) {
                        if (part.text) textChunk += part.text;
                        if (part.inlineData?.data) {
                            playAudioChunk(part.inlineData.data);
                            setIsMironSpeaking(true);
                            clearTimeout(speakingTimeout.current);
                            speakingTimeout.current = setTimeout(() => setIsMironSpeaking(false), 800);
                        }
                    }

                    // Dynamically append text chunks to the active Miron bubble
                    if (textChunk) {
                        setTranscripts(prev => {
                            const last = prev[prev.length - 1];
                            if (last && last.role === 'miron' && !last.isFinal) {
                                const updated = [...prev];
                                updated[updated.length - 1] = { ...last, text: last.text + textChunk };
                                return updated;
                            } else {
                                return [...prev, { id: Date.now(), role: 'miron', text: textChunk, isFinal: false }];
                            }
                        });
                    }
                }

                // Lock the bubble when the turn is over
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
            } catch (err) {
                console.error("WS Parse error", err);
            }
        };

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

    // 4. Web Speech API (Generates UI Transcript for User Audio)
    useEffect(() => {
        if (!micActive) {
            if (recognitionRef.current) recognitionRef.current.stop();
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognitionRef.current = recognition;
            recognition.continuous = true;
            recognition.interimResults = true;
            
            recognition.onresult = (e) => {
                let interim = '';
                let final = '';
                for (let i = e.resultIndex; i < e.results.length; ++i) {
                    if (e.results[i].isFinal) final += e.results[i][0].transcript;
                    else interim += e.results[i][0].transcript;
                }
                
                setTranscripts(prev => {
                    const last = prev[prev.length - 1];
                    const newText = final + interim;
                    
                    if (last && last.role === 'user' && !last.isFinal) {
                        const updated = [...prev];
                        updated[updated.length - 1] = { ...last, text: newText, isFinal: !!final };
                        return updated;
                    } else {
                        return [...prev, { id: Date.now(), role: 'user', text: newText, isFinal: !!final }];
                    }
                });
            };
            
            recognition.onend = () => {
                if (micActiveRef.current) recognition.start(); // Continuous listener revival
            };

            recognition.start();
        }

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.onend = null;
                recognitionRef.current.stop();
            }
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

    return (
        <div className="ml-overlay">
            <div className="ml-ambient"></div>
            
            <header className="ml-header">
                <button className="athena-close" onClick={onClose}><i className="fas fa-chevron-down"></i></button>
                <div className="ml-status">
                    <span className="live-dot"></span> Live Voice Session
                </div>
                <div style={{width: '36px'}}></div>
            </header>

            <div className="ml-stage">
                <div className={`ml-avatar-container ${isMironSpeaking ? 'speaking' : ''}`}>
                    <div className="ml-halo"></div>
                    <div className="ml-halo"></div>
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

const InlineChatQuiz = ({ quiz, onSubmit }) => {
    const [answers, setAnswers] = useState({});
    const [submitted, setSubmitted] = useState(false);

    const handleSelect = (qId, val) => {
        if (!submitted) setAnswers(prev => ({...prev, [qId]: val}));
    };

    const handleSubmit = () => {
        setSubmitted(true);
        const summary = quiz.questions.map((q, i) => `Q${i+1}: ${answers[q.id] || 'Skipped'}`).join('\n');
        onSubmit(`[Quiz Submission: ${quiz.title}]\n${summary}\n\nPlease evaluate my answers.`);
    };

    return (
        <div className="miron-quiz-card">
            <div className="mq-header"><i className="fas fa-clipboard-list"></i> {quiz.title}</div>
            <div className="mq-body">
                {quiz.questions.map((q, i) => (
                    <div key={q.id || i} className="mq-question">
                        <div className="mq-q-text"><span className="mq-q-num">{i+1}.</span> {q.text}</div>
                        
                        {q.question_type === 'true_false' ? (
                            <div className="mq-tf-pad">
                                <button className={`mq-tf-btn ${answers[q.id] === 'True' ? 'active-true' : ''}`} onClick={() => handleSelect(q.id, 'True')}>TRUE</button>
                                <button className={`mq-tf-btn ${answers[q.id] === 'False' ? 'active-false' : ''}`} onClick={() => handleSelect(q.id, 'False')}>FALSE</button>
                            </div>
                        ) : (
                            <div className="mq-options">
                                {q.options?.map((opt, oIdx) => {
                                    const optText = typeof opt === 'string' ? opt : opt.text;
                                    return (
                                        <button key={oIdx} className={`mq-opt-btn ${answers[q.id] === optText ? 'active' : ''}`} onClick={() => handleSelect(q.id, optText)}>
                                            <div className="mq-opt-ind"></div>
                                            <span>{optText}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
                <button className="mq-submit-btn" disabled={submitted} onClick={handleSubmit}>
                    {submitted ? 'Submitted for Grading' : 'Submit to Miron'} <i className="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    );
};

const MironChat = ({ onClose, initialContext }) => {
    const [avatarError, setAvatarError] = useState(false);
    const [isLiveMode, setIsLiveMode] = useState(false);
    const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";
    
    useEffect(() => {
        const handleOpenLive = () => setIsLiveMode(true);
        window.addEventListener('miron:open-live-session', handleOpenLive);
        return () => window.removeEventListener('miron:open-live-session', handleOpenLive);
    }, []);

    const [messages, setMessages] = useState(() => {
        const base = [
            {
                id: 1,
                side: 'miron',
                text: "I'm monitoring your cognitive path. Let's explore.",
                thought: null
            }
        ];
        
        if (initialContext) {
            base.push({
                id: 2,
                side: 'user',
                text: `Regarding this passage: "${initialContext}"`
            });
            base.push({
                id: 3,
                side: 'miron',
                thought: "Analyzing literature node...",
                text: "Ah, yes. This relation contains a deep thermodynamic constraint. Let's dissect the mathematical properties together."
            });
        }
        return base;
    });
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const flowRef = useRef(null);

    const mironThoughts = [
        "Synthesizing knowledge nodes...",
        "Tracing cognitive patterns...",
        "Formulating elegant solutions..."
    ];

    useEffect(() => {
        if (flowRef.current) {
            flowRef.current.scrollTo({
                top: flowRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [messages, isTyping]);

    const sendMessage = async (textToSend) => {
        if (!textToSend.trim()) return;

        const userMsg = { id: Date.now(), side: 'user', text: textToSend };
        const currentHistory = [...messages];
        
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        try {
            const data = await invokeMiron({
                prompt: textToSend,
                history: currentHistory,
                context: initialContext
            });

            const thoughtText = data.thoughts && data.thoughts.length > 0 
                ? data.thoughts.join(" | ") 
                : "Synthesizing response...";

            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: thoughtText,
                text: data.response,
                snapshots: data.snapshots,
                quizzes: data.quizzes
            }]);

            if (data.ui_command && data.ui_command.action === 'open_page') {
                console.log("Miron instructed UI to open page:", data.ui_command);
            }

        } catch (error) {
            console.error("Miron Communication Error:", error);
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                side: 'miron',
                thought: "Connection unstable...",
                text: "My cognitive link to the mainframe encountered an anomaly. Please try asking again."
            }]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = () => {
        sendMessage(input);
        setInput('');
    };

    return (
        <div className="miron-chat-overlay">
            <div className="athena-bg"></div>

            <header className="athena-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button className="athena-close" onClick={onClose} style={{ background: 'transparent' }}>
                        <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="athena-brand">
                        <div className="athena-orb" style={{ overflow: 'hidden' }}>
                            {!avatarError ? (
                                <img 
                                    src={mironAvatarUrl} 
                                    alt="Miron" 
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} 
                                    onError={() => setAvatarError(true)} 
                                />
                            ) : (
                                <i className="fa-solid fa-sparkles" style={{fontSize: '0.8rem'}}></i>
                            )}
                        </div>
                        <h1 className="athena-title">Miron</h1>
                    </div>
                </div>
                
                <button 
                    className="athena-live-btn"
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('miron:open-live-session'));
                    }}
                    style={{ background: 'transparent', padding: 0, border: 'none', borderRadius: 0, width: '38px', height: '38px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
                      <defs>
                        <linearGradient id="miron-live-pulse-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#0b0f19" />
                          <stop offset="100%" stopColor="#1e293b" />
                        </linearGradient>

                        <linearGradient id="miron-neon-cyan-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#00f0ff" />
                          <stop offset="100%" stopColor="#0066ff" />
                        </linearGradient>

                        <filter id="miron-neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="2.5" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>

                        <filter id="miron-red-dot-glow" x="-30%" y="-30%" width="160%" height="160%">
                          <feGaussianBlur stdDeviation="1.5" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      {/* Button Container (Squircle) */}
                      <rect x="2" y="2" width="96" height="96" rx="26" fill="url(#miron-live-pulse-bg)" stroke="#1e293b" strokeWidth="2.5" />

                      {/* Background Chat Bubble Frame (Subtle outline) */}
                      <path d="M 22,50 C 22,34.5 34.5,22 50,22 C 65.5,22 78,34.5 78,50 C 78,65.5 65.5,78 50,78 C 45,78 40,76.5 36,74 L 18,78 L 22,64 C 20.7,60 22,55 22,50 Z" 
                            fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />

                      {/* Glow effect duplicate for EKG line (creates the base ambient light) */}
                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                            fill="none" stroke="#00f0ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" filter="url(#miron-neon-glow)" />

                      {/* Crisp Main ECG Heartbeat Line (Zigzag) */}
                      <path d="M 16,53 L 34,53 L 41,31 L 48,69 L 54,44 L 59,53 L 84,53" 
                            fill="none" stroke="url(#miron-neon-cyan-grad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                      {/* Active "LIVE" Red Status Indicator Dot */}
                      <circle cx="35" cy="37" r="3.5" fill="#ef4444" filter="url(#miron-red-dot-glow)" />

                      {/* Modern bold status text */}
                      <text x="57" y="41" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="12" letterSpacing="1" textAnchor="middle">LIVE</text>
                    </svg>
                </button>
            </header>

            <main className="athena-flow" ref={flowRef}>
                {messages.map(m => (
                                        <div key={m.id} className={`chat-node ${m.side}`}>
                        {m.side === 'miron' && m.thought && (
                            <span className="miron-thought">{m.thought}</span>
                        )}
                        <div className="athena-bubble">
                            {m.text.split(/(\[SNAPSHOT_\d+\]|\[QUIZ_\d+\])/g).map((part, idx) => {
                                const quizMatch = part.match(/\[QUIZ_(\d+)\]/);
                                if (quizMatch) {
                                    const quizId = parseInt(quizMatch[1], 10);
                                    const quiz = m.quizzes?.find(q => q.id === quizId);
                                    if (!quiz) return <span key={idx} style={{color:'red'}}>[Quiz Error]</span>;
                                    return <InlineChatQuiz key={idx} quiz={quiz} onSubmit={sendMessage} />;
                                }

                                const snapMatch = part.match(/\[SNAPSHOT_(\d+)\]/);
                                if (snapMatch) {
                                    const snapId = parseInt(snapMatch[1], 10);
                                    const snap = m.snapshots?.find(s => s.id === snapId);
                                    if (!snap) return null;
                                    
                                    return (
                                        <div key={idx} className="inline-chat-snapshot">
                                            <div className="snapshot-topbar">
                                                <span><i className="fas fa-file-pdf"></i> {snap.book_title || snap.course_code}</span>
                                                <span>Page {snap.page_number}</span>
                                            </div>
                                            <div className="snapshot-content">
                                                {snap.blocks.map((b, i) => {
                                                    const Renderer = getComponent('book-block-renderer');
                                                    if (Renderer) return Renderer(b, i, {});
                                                    return <div key={i} style={{color: 'red'}}>[Rendering Engine Disconnected]</div>;
                                                })}
                                            </div>
                                        </div>
                                    );
                                }
                                
                                // Render Markdown Text safely via Marked.js
                                if (!part.trim()) return null;
                                return (
                                    <div 
                                        key={idx} 
                                        className="miron-markdown-chunk"
                                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(part)) }} 
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
                
                {isTyping && (
                    <div className="chat-node miron">
                        <div className="athena-typing">
                            <div className="dot"></div>
                            <div className="dot"></div>
                            <div className="dot"></div>
                        </div>
                    </div>
                )}
            </main>

            <footer className="athena-input-area">
                <div className="capsule-dock">
                    <input 
                        type="text" 
                        placeholder="Message Miron..." 
                        value={input} 
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    />
                    <button className="capsule-send" onClick={handleSend}>
                        <i className="fa-solid fa-arrow-up"></i>
                    </button>
                </div>
            </footer>
            
            {isLiveMode && <MironLiveSession onClose={() => setIsLiveMode(false)} mironAvatarUrl={mironAvatarUrl} />}
        </div>
    );
};

export default MironChat;