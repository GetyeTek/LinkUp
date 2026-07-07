import { useEffect, useRef } from 'react';

export const useGeminiAudio = (wsRef, isMicActive) => {
    const audioContextRef = useRef(null);
    const nextStartTimeRef = useRef(0);
    const isMicActiveRef = useRef(isMicActive);

    useEffect(() => {
        isMicActiveRef.current = isMicActive;
    }, [isMicActive]);

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

    return { playAudioChunk };
};