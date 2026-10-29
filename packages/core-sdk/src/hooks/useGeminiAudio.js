import { useEffect, useRef } from 'react';

export const useGeminiAudio = (wsRef, isMicActive) => {
    const audioContextRef = useRef(null);
    const nextStartTimeRef = useRef(0);
    const isMicActiveRef = useRef(isMicActive);
    const activeSourcesRef = useRef(new Set());
    const scheduledTimersRef = useRef([]);
    const scheduledTimelineRef = useRef([]);

    useEffect(() => {
        isMicActiveRef.current = isMicActive;
    }, [isMicActive]);

    const resyncActiveAudioState = () => {
        if (!audioContextRef.current) return null;
        const now = audioContextRef.current.currentTime;
        // Prune expired timeline entries older than 1 second
        scheduledTimelineRef.current = scheduledTimelineRef.current.filter(item => item.end > now - 1.0);
        const activeEntry = scheduledTimelineRef.current.find(item => now >= item.start && now < item.end);
        if (activeEntry && activeEntry.onStart) {
            activeEntry.onStart();
            return activeEntry.target;
        }
        return null;
    };

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                resyncActiveAudioState();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

    const playAudioChunk = (base64Data, options = null) => {
        if (!base64Data) return;

        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        // 1. Fast PCM16 to Float32 Conversion
        const rawString = atob(base64Data);
        const len = rawString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = rawString.charCodeAt(i);

        const pcm16 = new Int16Array(bytes.buffer);
        const sampleCount = pcm16.length;
        if (sampleCount === 0) return;

        const float32 = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            float32[i] = pcm16[i] / 32768.0;
        }

        // 2. Micro Edge Smoothing (Anti-Pop / Click Eliminator at 24kHz)
        const fadeSamples = Math.min(36, Math.floor(sampleCount / 4)); // ~1.5ms
        for (let i = 0; i < fadeSamples; i++) {
            const factor = i / fadeSamples;
            float32[i] *= factor;
            float32[sampleCount - 1 - i] *= factor;
        }

        // 3. Audio Buffer Allocation & Source Creation
        const buffer = ctx.createBuffer(1, sampleCount, 24000);
        buffer.getChannelData(0).set(float32);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        activeSourcesRef.current.add(source);
        source.onended = () => {
            activeSourcesRef.current.delete(source);
            if (options?.onEnded) options.onEnded();
        };

        // 4. Adaptive Jitter Buffer Scheduling (120ms Pre-Roll Safety Cushion)
        const currentTime = ctx.currentTime;
        const INITIAL_BUFFER_OFFSET = 0.12;

        if (nextStartTimeRef.current < currentTime) {
            nextStartTimeRef.current = currentTime + INITIAL_BUFFER_OFFSET;
        }

        const scheduledStartTime = nextStartTimeRef.current;

        const chunkDuration = buffer.duration;
        const scheduledEndTime = scheduledStartTime + chunkDuration;

        // 5. Hardware-Locked Callback Synchronization & Timeline Entry
        if (options?.onStart || options?.target || options?.id) {
            const targetCoord = options.target || options.id || null;
            scheduledTimelineRef.current.push({
                start: scheduledStartTime,
                end: scheduledEndTime,
                target: targetCoord,
                onStart: options.onStart
            });

            if (options.onStart) {
                const delayMs = Math.max(0, (scheduledStartTime - currentTime) * 1000);
                console.log(`⏱️ [AudioClock] Scheduling onStart for target [${targetCoord || 'chunk'}] in ${delayMs.toFixed(1)}ms (AudioContext: ${currentTime.toFixed(3)}s -> ${scheduledStartTime.toFixed(3)}s)`);
                const timerId = setTimeout(() => {
                    console.log(`⚡ [AudioClock] Fired hardware-locked onStart for [${targetCoord || 'chunk'}] at AudioContext time ${ctx.currentTime.toFixed(3)}s`);
                    options.onStart();
                }, delayMs);
                scheduledTimersRef.current.push(timerId);
            }
        }

        source.start(scheduledStartTime);
        nextStartTimeRef.current += chunkDuration;
    };

    const stopAudio = () => {
        const timerCount = scheduledTimersRef.current.length;
        scheduledTimersRef.current.forEach(t => clearTimeout(t));
        scheduledTimersRef.current = [];
        scheduledTimelineRef.current = [];

        const sourceCount = activeSourcesRef.current.size;
        activeSourcesRef.current.forEach(source => {
            try {
                source.stop();
                source.disconnect();
            } catch (e) {}
        });
        activeSourcesRef.current.clear();

        if (audioContextRef.current) {
            nextStartTimeRef.current = audioContextRef.current.currentTime;
        } else {
            nextStartTimeRef.current = 0;
        }
        console.log(`🛑 [AudioClock] stopAudio executed: Purged ${sourceCount} active audio buffer source(s) and canceled ${timerCount} scheduled highlight timer(s).`);
    };

    useEffect(() => {
        return () => {
            activeSourcesRef.current.forEach(source => {
                try {
                    source.stop();
                    source.disconnect();
                } catch (e) {}
            });
            activeSourcesRef.current.clear();
        };
    }, []);

    useEffect(() => {
        let stream, ctx, processor;
        let isCancelled = false;

        if (isMicActive) {
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
                    if (!isMicActiveRef.current) return;

                    // Hardware Echo Cancellation: Drop mic frames if Miron is actively speaking
                    if (audioContextRef.current && audioContextRef.current.currentTime < nextStartTimeRef.current + 0.4) {
                        return; 
                    }
                    
                    try {
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
                    } catch(err) {
                        console.error("Audio processor error:", err);
                    }
                };
                
                source.connect(processor);
                processor.connect(ctx.destination);
            }).catch(err => console.error("Mic denied:", err));
        }

        return () => {
            isCancelled = true;
            if (processor) processor.disconnect();
            if (ctx && ctx.state !== 'closed') ctx.close();
            if (stream) stream.getTracks().forEach(t => t.stop());
        };
    }, [isMicActive, wsRef]);

    return { playAudioChunk, stopAudio, resyncActiveAudioState };
};