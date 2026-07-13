import React, { useState, useEffect, useRef } from 'react';
import { supabase, useGeminiAudio } from '@linkup-platform/sdk-core';
import { useParticipants, useLocalParticipant } from '@livekit/components-react';
import GenericConfirmModal from './GenericConfirmModal.jsx';
import FloatingLiveOrb from './FloatingLiveOrb.jsx';
import ConnectionRing from './ConnectionRing.jsx';
import LiveStageModPanel from './LiveStageModPanel.jsx';
import LiveStageAttendantQs from './LiveStageAttendantQs.jsx';
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
    
    const hostId = chatInfo.metadata?.live_host_id;
    const hostInfo = members[hostId] || { name: 'Host', avatar: 'https://via.placeholder.com/150' };
    const isMeHost = currentUser.id === hostId;
    
    const hostParticipant = participants.find(p => p.identity === hostId);
    const isHostSpeaking = hostParticipant ? hostParticipant.isSpeaking : false;
    const isHostPaused = !isMeHost && !hostParticipant;

    const questionsEndRef = useRef(null);

            // Interactive Board State
        const [boardMode, setBoardMode] = useState(false);
        const [boardElements, setBoardElements] = useState([]);
        const [boardEdges, setBoardEdges] = useState([]);

        // Draggable Board Canvas Engine with Self-Healing Camera & Zoom
        const [pan, setPan] = useState({ x: 0, y: 0 });
        const [boardScale, setBoardScale] = useState(1);
        const [isInteracting, setIsInteracting] = useState(false);
        const pointers = useRef(new Map());
        const pinchStart = useRef({ dist: 0, scale: 1, cx: 0, cy: 0, panX: 0, panY: 0 });
        const dragStartOffset = useRef({ x: 0, y: 0 });
        const canvasRef = useRef(null);
        const viewportDims = useRef({ w: 400, h: 800 });

        const parseCoord = (val, max) => {
            if (val === undefined || val === null) return max / 2;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                if (val.includes('%')) return (parseFloat(val) / 100) * max;
                if (val.includes('px')) return parseFloat(val);
                return parseFloat(val);
            }
            return max / 2;
        };

        useEffect(() => {
            if (!boardMode || boardElements.length === 0 || !canvasRef.current) return;

            const calibrateBoard = () => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const { width: W, height: H } = canvas.getBoundingClientRect();
                viewportDims.current = { w: W, h: H };

                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

                boardElements.forEach(el => {
                    const cx = parseCoord(el.x, W);
                    const cy = parseCoord(el.y, H);
                    
                    // Approximate bounding radii based on shape types
                    let rx = 100, ry = 100;
                    if (el.type === 'rectangle' || el.type === 'rect') { rx = 140; ry = 90; }
                    else if (el.type === 'text') { rx = 100; ry = 30; }

                    minX = Math.min(minX, cx - rx);
                    maxX = Math.max(maxX, cx + rx);
                    minY = Math.min(minY, cy - ry);
                    maxY = Math.max(maxY, cy + ry);
                });

                // Failsafe bounds
                if (minX === Infinity) { minX = 0; maxX = W; minY = 0; maxY = H; }
                if (maxX - minX < 100) { minX -= 50; maxX += 50; }
                if (maxY - minY < 100) { minY -= 50; maxY += 50; }

                const spanX = maxX - minX;
                const spanY = maxY - minY;

                // Calculate ideal scale (padding the viewport tightly)
                const scaleX = W / (spanX + 80);
                const scaleY = H / (spanY + 80);
                const idealScale = Math.min(scaleX, scaleY, 1.0);
                
                // Anti-Sky Safety Cap: Don't zoom out infinitely
                const finalScale = Math.max(0.45, idealScale);
                setBoardScale(finalScale);

                // Auto-center camera on content cluster
                const contentCenterX = (minX + maxX) / 2;
                const contentCenterY = (minY + maxY) / 2;

                setPan({
                    x: (W / 2) - (contentCenterX * finalScale),
                    y: (H / 2) - (contentCenterY * finalScale)
                });
            };

            // Run calibration on mount and when resizing the window
            calibrateBoard();
            const ro = new ResizeObserver(() => calibrateBoard());
            ro.observe(canvasRef.current);

            return () => ro.disconnect();
        }, [boardElements, boardMode]);

        const handleCanvasPointerDown = (e) => {
            if (e.target.closest('.close-board-btn')) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, e);
            setIsInteracting(true);

            if (pointers.current.size === 1) {
                dragStartOffset.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            } else if (pointers.current.size === 2) {
                const pts = Array.from(pointers.current.values());
                const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
                const cx = (pts[0].clientX + pts[1].clientX) / 2;
                const cy = (pts[0].clientY + pts[1].clientY) / 2;
                
                pinchStart.current = { dist, scale: boardScale, cx, cy, panX: pan.x, panY: pan.y };
            }
        };

        const handleCanvasPointerMove = (e) => {
            if (!pointers.current.has(e.pointerId)) return;
            pointers.current.set(e.pointerId, e);

            if (pointers.current.size === 1) {
                setPan({
                    x: e.clientX - dragStartOffset.current.x,
                    y: e.clientY - dragStartOffset.current.y
                });
            } else if (pointers.current.size === 2) {
                const pts = Array.from(pointers.current.values());
                const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
                
                const ratio = dist / pinchStart.current.dist;
                let newScale = pinchStart.current.scale * ratio;
                newScale = Math.max(0.15, Math.min(newScale, 4.0));

                const { cx, cy, panX, panY, scale: oldScale } = pinchStart.current;
                const viewportX = (cx - panX) / oldScale;
                const viewportY = (cy - panY) / oldScale;
                
                setPan({
                    x: cx - viewportX * newScale,
                    y: cy - viewportY * newScale
                });
                setBoardScale(newScale);
            }
        };

        const handleCanvasPointerUp = (e) => {
            pointers.current.delete(e.pointerId);
            e.currentTarget.releasePointerCapture(e.pointerId);

            if (pointers.current.size === 1) {
                const remainingPointer = Array.from(pointers.current.values())[0];
                dragStartOffset.current = { x: remainingPointer.clientX - pan.x, y: remainingPointer.clientY - pan.y };
            } else if (pointers.current.size === 0) {
                setIsInteracting(false);
            }
        };

        // Desktop Wheel Zoom Support
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas || !boardMode) return;

            let wheelTimeout;
            const handleWheel = (e) => {
                if (e.target.closest('.close-board-btn') || e.target.closest('.shape-text-scroller')) return;
                
                e.preventDefault();
                setIsInteracting(true);
                
                setBoardScale(prevScale => {
                    const zoomSensitivity = 0.005;
                    const delta = -e.deltaY * zoomSensitivity;
                    let newScale = prevScale * Math.exp(delta);
                    newScale = Math.max(0.15, Math.min(newScale, 4.0));
                    
                    setPan(prevPan => {
                        const cx = e.clientX;
                        const cy = e.clientY;
                        const viewportX = (cx - prevPan.x) / prevScale;
                        const viewportY = (cy - prevPan.y) / prevScale;
                        return {
                            x: cx - viewportX * newScale,
                            y: cy - viewportY * newScale
                        };
                    });
                    
                    return newScale;
                });

                clearTimeout(wheelTimeout);
                wheelTimeout = setTimeout(() => setIsInteracting(false), 150);
            };

            canvas.addEventListener('wheel', handleWheel, { passive: false });
            return () => {
                canvas.removeEventListener('wheel', handleWheel);
                clearTimeout(wheelTimeout);
            };
        }, [boardMode]);

    // --- AI Logical Flow Solver Engine ---
    const computeFlowLayout = (payload) => {
        const { layout = 'vertical-tree', nodes = [], edges = [] } = payload;
        let positionedNodes = [];
        
        // 1. Build adjacency list & calculate indegrees
        const adj = {};
        const inDegree = {};
        nodes.forEach(n => { adj[n.id] = []; inDegree[n.id] = 0; });
        edges.forEach(e => {
            if (adj[e.from]) adj[e.from].push(e.to);
            if (inDegree[e.to] !== undefined) inDegree[e.to]++;
        });

        // 2. Identify root nodes
        const roots = nodes.filter(n => inDegree[n.id] === 0);
        if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]); // Cycle fallback

        const Y_GAP = 280;
        const X_GAP = 350;

        const visited = new Set();
        const positions = {};

        // Recursive DFS Subtree Spacing Solver
        const layoutSubtree = (nodeId, px, py) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            positions[nodeId] = { x: px, y: py };

            const children = adj[nodeId] || [];
            const unvisitedChildren = children.filter(cid => !visited.has(cid));
            const N = unvisitedChildren.length;

            if (N > 0) {
                if (layout === 'vertical-tree') {
                    const totalWidth = (N - 1) * X_GAP;
                    const startX = px - (totalWidth / 2);
                    unvisitedChildren.forEach((childId, idx) => {
                        layoutSubtree(childId, startX + (idx * X_GAP), py + Y_GAP);
                    });
                } else if (layout === 'horizontal-process') {
                    const totalHeight = (N - 1) * Y_GAP;
                    const startY = py - (totalHeight / 2);
                    unvisitedChildren.forEach((childId, idx) => {
                        layoutSubtree(childId, px + X_GAP, startY + (idx * Y_GAP));
                    });
                }
            }
        };

        // 3. Position root elements. Symmetrically spread multiple roots.
        if (layout === 'vertical-tree') {
            const totalRootsWidth = (roots.length - 1) * X_GAP * 2;
            const startRootsX = -(totalRootsWidth / 2);
            roots.forEach((root, idx) => {
                layoutSubtree(root.id, startRootsX + (idx * X_GAP * 2), 0);
            });
        } else if (layout === 'horizontal-process') {
            const totalRootsHeight = (roots.length - 1) * Y_GAP * 2;
            const startRootsY = -(totalRootsHeight / 2);
            roots.forEach((root, idx) => {
                layoutSubtree(root.id, 0, startRootsY + (idx * Y_GAP * 2));
            });
        } else {
            // Radial Fan: Center root at 0,0 and fan children in a circle
            const rootId = roots[0]?.id;
            positions[rootId] = { x: 0, y: 0 };
            visited.add(rootId);
            const children = nodes.filter(n => n.id !== rootId);
            const radius = Math.max(250, children.length * 50);
            children.forEach((node, idx) => {
                const angle = (idx / children.length) * 2 * Math.PI;
                positions[node.id] = {
                    x: Math.cos(angle) * radius,
                    y: Math.sin(angle) * radius
                };
            });
        }

        // Failsafe for disconnected floating nodes
        nodes.forEach(n => {
            if (!positions[n.id]) {
                positions[n.id] = { x: 0, y: 0 };
            }
        });

        // Compile positioned coordinates back to state format
        positionedNodes = nodes.map(n => ({
            ...n,
            x: positions[n.id].x,
            y: positions[n.id].y,
            type: n.type || 'rectangle',
            animation: n.animation || 'pop-in'
        }));

        // --- Opposing Magnet Collision Solver Pass ---
        // Prevents direct node overlapping and sibling subtree packing
        const SAFE_GAP = 280; // Minimum physical pixel distance between node centers
        
        for (let pass = 0; pass < 3; pass++) {
            const levelsY = {};
            positionedNodes.forEach(node => {
                const y = node.y;
                if (!levelsY[y]) levelsY[y] = [];
                levelsY[y].push(node);
            });

            Object.keys(levelsY).forEach(yStr => {
                const rowNodes = levelsY[yStr];
                rowNodes.sort((a, b) => a.x - b.x); // Sort left-to-right

                for (let i = 0; i < rowNodes.length - 1; i++) {
                    const nodeA = rowNodes[i];
                    const nodeB = rowNodes[i + 1];
                    const distance = Math.abs(nodeB.x - nodeA.x);
                    
                    if (distance < SAFE_GAP) {
                        const overlap = SAFE_GAP - distance;
                        nodeA.x = nodeA.x - (overlap / 2);
                        nodeB.x = nodeB.x + (overlap / 2);
                    }
                }
            });
        }

        return { elements: positionedNodes, edges };
    };

    useEffect(() => {
        if (devBoardPayload) {
            setBoardMode(true);
            if (devBoardPayload.action === 'draw_flow') {
                const { elements, edges } = computeFlowLayout(devBoardPayload);
                setBoardElements(elements);
                setBoardEdges(edges);
            } else {
                setBoardElements(devBoardPayload.elements || []);
                setBoardEdges([]);
            }
        }
    }, [devBoardPayload]);

    const closeBoardMode = () => {
        setBoardMode(false);
        setBoardElements([]);
        setBoardEdges([]);
        setPan({ x: 0, y: 0 }); // Zero out pan offsets on close
        setBoardScale(1);       // Reset camera scale
        if (setDevBoardPayload) setDevBoardPayload(null);
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
        if (liveState !== 'full' || !isMeHost) return;
        const beat = () => {
            supabase.rpc('heartbeat_live_session', { conv_id: conversationId, req_host_id: currentUser.id });
        };
        beat(); // Initial pulse
        const int = setInterval(beat, 15000); // Pulse every 15s
        return () => clearInterval(int);
    }, [liveState, isMeHost, conversationId, currentUser.id]);



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
                    <div 
                        className="live-board-canvas"
                        ref={canvasRef}
                        onPointerDown={handleCanvasPointerDown}
                        onPointerMove={handleCanvasPointerMove}
                        onPointerUp={handleCanvasPointerUp}
                    >
                        <button className="close-board-btn" onClick={closeBoardMode} title="Close Board">
                            <i className="fas fa-times"></i>
                        </button>
                        <div 
                            className="live-board-viewport"
                            style={{ 
                                transformOrigin: '0 0',
                                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${boardScale})`,
                                transition: isInteracting ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)' 
                            }}
                        >
                            {/* SVG Connection Layer */}
                            {boardEdges.length > 0 && (
                                <svg style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', overflow: 'visible', zIndex: -1, pointerEvents: 'none' }}>
                                    <defs>
                                        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto">
                                            <polygon points="0 0, 8 3, 0 6" fill="var(--accent-teal)" />
                                        </marker>
                                        <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                                            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                                            <feMerge>
                                                <feMergeNode in="coloredBlur"/>
                                                <feMergeNode in="SourceGraphic"/>
                                            </feMerge>
                                        </filter>
                                    </defs>
                                    {boardEdges.map((edge, idx) => {
                                        const fromEl = boardElements.find(e => e.id === edge.from);
                                        const toEl = boardElements.find(e => e.id === edge.to);
                                        if (!fromEl || !toEl) return null;

                                        const W = viewportDims.current.w;
                                        const H = viewportDims.current.h;
                                        
                                        const x1 = typeof fromEl.x === 'number' ? fromEl.x : parseCoord(fromEl.x, W);
                                        const y1 = typeof fromEl.y === 'number' ? fromEl.y : parseCoord(fromEl.y, H);
                                        const x2 = typeof toEl.x === 'number' ? toEl.x : parseCoord(toEl.x, W);
                                        const y2 = typeof toEl.y === 'number' ? toEl.y : parseCoord(toEl.y, H);
                                        
                                        // Dynamic Bezier edge snapping calculation
                                        let pathData = '';
                                        if (devBoardPayload?.layout === 'vertical-tree') {
                                            const startOffsetY = ['circle', 'square'].includes(fromEl.type) ? 90 : 60;
                                            const endOffsetY = ['circle', 'square'].includes(toEl.type) ? 105 : 75; // Extra padding for arrow
                                            const startY = y1 + startOffsetY;
                                            const endY = y2 - endOffsetY;
                                            const offset = Math.abs(endY - startY) / 2;
                                            pathData = `M ${x1},${startY} C ${x1},${startY + offset} ${x2},${endY - offset} ${x2},${endY}`;
                                        } else if (devBoardPayload?.layout === 'horizontal-process') {
                                            const startOffsetX = ['circle', 'square'].includes(fromEl.type) ? 90 : 110;
                                            const endOffsetX = ['circle', 'square'].includes(toEl.type) ? 105 : 125;
                                            const startX = x1 + startOffsetX;
                                            const endX = x2 - endOffsetX;
                                            const offset = Math.abs(endX - startX) / 2;
                                            pathData = `M ${startX},${y1} C ${startX + offset},${y1} ${endX - offset},${y2} ${endX},${y2}`;
                                        } else {
                                            const angle = Math.atan2(y2 - y1, x2 - x1);
                                            const r1 = ['circle', 'square'].includes(fromEl.type) ? 90 : 110;
                                            const r2 = ['circle', 'square'].includes(toEl.type) ? 105 : 125;
                                            const startX = x1 + Math.cos(angle) * r1;
                                            const startY = y1 + Math.sin(angle) * r1;
                                            const endX = x2 - Math.cos(angle) * r2;
                                            const endY = y2 - Math.sin(angle) * r2;
                                            pathData = `M ${startX},${startY} Q ${(startX+endX)/2},${(startY+endY)/2 - 50} ${endX},${endY}`;
                                        }

                                        return (
                                            <g key={idx}>
                                                <path 
                                                    d={pathData} 
                                                    stroke={edge.color || 'var(--accent-teal)'} 
                                                    strokeWidth="3" 
                                                    fill="none" 
                                                    markerEnd="url(#arrowhead)" 
                                                    filter="url(#neonGlow)"
                                                    style={{ opacity: 0.6, animation: 'boardFadeIn 1s ease-out' }}
                                                />
                                                {edge.label && (
                                                    <text 
                                                        x={(x1 + x2) / 2} 
                                                        y={(y1 + y2) / 2} 
                                                        fill="#aaa" 
                                                        fontSize="13" 
                                                        fontWeight="600"
                                                        fontFamily="'Poppins', sans-serif"
                                                        textAnchor="middle" 
                                                        dy="-8"
                                                    >
                                                        {edge.label}
                                                    </text>
                                                )}
                                            </g>
                                        );
                                    })}
                                </svg>
                            )}

                            {boardElements.map(el => {
                                const isShape = ['circle', 'rect', 'rectangle', 'square', 'shape'].includes(el.type);
                                const shapeClass = isShape ? `board-shape-${el.type}` : 'board-shape-text';
                                return (
                                    <div
                                        key={el.id}
                                        className={`live-board-element anim-${el.animation || 'fade-in'} ${shapeClass}`}
                                        style={{
                                            left: typeof el.x === 'number' ? `${el.x}px` : (el.x !== undefined ? el.x : '50%'),
                                            top: typeof el.y === 'number' ? `${el.y}px` : (el.y !== undefined ? el.y : '50%'),
                                            transform: `translate(-50%, -50%)`, // Centered on precise anchor point
                                            color: el.color || 'var(--text-primary-dark)',
                                            fontSize: el.fontSize || '1rem',
                                            fontWeight: el.fontWeight || 'normal',
                                            fontFamily: el.fontFamily === 'serif' ? '"Newsreader", serif' : '"Poppins", sans-serif',
                                            fontStyle: el.fontStyle || 'normal',
                                            pointerEvents: 'auto', // Overrides general non-clickable text state
                                            ...el.customStyles
                                        }}
                                    >
                                        {isShape ? (
                                            <div className={`shape-container ${el.type}`} style={el.shapeStyles}>
                                                {el.title && <div className="shape-title-node">{el.title}</div>}
                                                {el.text && (
                                                    <div 
                                                        className="shape-text-scroller"
                                                        onPointerDown={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onTouchStart={(e) => e.stopPropagation()}
                                                    >
                                                        {el.text}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-element-node">{el.text}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
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