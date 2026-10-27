import React, { useRef, useEffect } from 'react';
import { usePlatform } from '@linkup-platform/sdk-core';
import './NoteInputDock.css';

const NoteInputDock = ({ 
    fileInputRef, handleFileUpload, isUploading, 
    input, setInput, handleSend 
}) => {
    const { t } = usePlatform();
    const noteTextareaRef = useRef(null);

    useEffect(() => {
        if (noteTextareaRef.current) {
            noteTextareaRef.current.style.height = 'auto';
            noteTextareaRef.current.style.height = `${Math.min(noteTextareaRef.current.scrollHeight, 220)}px`;
        }
    }, [input]);

    return (
        <footer className="notes-dock-wrap">
            <div className="notes-dock">
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{display: 'none'}} 
                    onChange={handleFileUpload} 
                />
                <button className="dock-btn attach" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                    <i className="fas fa-paperclip"></i>
                </button>
                <textarea 
                    ref={noteTextareaRef}
                    className="notes-input" 
                    placeholder={t('notes_placeholder', 'Save a note or link...')} 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    rows="1"
                />
                <button className="dock-btn send" onClick={handleSend} disabled={!input.trim() || isUploading}>
                    <i className="fas fa-arrow-up"></i>
                </button>
            </div>
        </footer>
    );
};

export default NoteInputDock;