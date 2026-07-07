import { useState, useRef } from 'react';

export const useChatInputState = (presenceChannelRef, setAlertNotice) => {
    const [input, setInput] = useState('');
    const [pendingAttachments, setPendingAttachments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    
    const typingTimeoutRef = useRef(null);
    const localTypingRef = useRef(false);

    const handleInputChange = (val) => {
        setInput(val);
        if (presenceChannelRef.current) {
            const isTypingNow = val.length > 0;
            
            if (isTypingNow && !localTypingRef.current) {
                presenceChannelRef.current.track({ isTyping: true, updatedAt: Date.now() }).catch(e => console.error("Track error:", e));
                localTypingRef.current = true;
            } else if (!isTypingNow && localTypingRef.current) {
                presenceChannelRef.current.track({ isTyping: false, updatedAt: Date.now() }).catch(e => console.error("Track error:", e));
                localTypingRef.current = false;
            }
            
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (isTypingNow) {
                typingTimeoutRef.current = setTimeout(() => {
                    if (presenceChannelRef.current) presenceChannelRef.current.track({ isTyping: false, updatedAt: Date.now() });
                    localTypingRef.current = false;
                }, 2500);
            }
        }
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        
        let validFiles = files;
        if (pendingAttachments.length + files.length > 10) {
            setAlertNotice({ title: "Limit Reached", msg: "You can only attach up to 10 files at once." });
            const remainingSlots = 10 - pendingAttachments.length;
            validFiles = files.slice(0, remainingSlots);
        }
        
        const oversized = validFiles.find(f => f.size > 10 * 1024 * 1024);
        if (oversized) {
            setAlertNotice({ title: "File too large", msg: "One or more files exceed the 10MB limit." });
            e.target.value = null;
            return;
        }
        
        const processed = validFiles.map(file => ({
            file,
            previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null
        }));
        
        setPendingAttachments(prev => [...prev, ...processed]);
        e.target.value = null;
    };

    const clearTypingPresence = () => {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (presenceChannelRef.current && localTypingRef.current) {
            presenceChannelRef.current.track({ isTyping: false, updatedAt: Date.now() });
            localTypingRef.current = false;
        }
    };

    return {
        input, setInput,
        pendingAttachments, setPendingAttachments,
        isUploading, setIsUploading,
        uploadProgress, setUploadProgress,
        handleInputChange, handleFileSelect, clearTypingPresence
    };
};