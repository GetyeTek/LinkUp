import React from 'react';
import './NoteInputDock.css';

const NoteInputDock = ({ 
    fileInputRef, handleFileUpload, isUploading, 
    input, setInput, handleSend 
}) => {
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
                    className="notes-input" 
                    placeholder="Save a note or link..." 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
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