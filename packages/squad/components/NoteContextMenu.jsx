import React from 'react';
import './NoteContextMenu.css';

const NoteContextMenu = ({ activeMenu, handleCopy, handleDownload, deleteNote, onForward }) => {
    if (!activeMenu) return null;
    
    return (
        <div className="notes-ctx-menu" style={{ left: activeMenu.x, top: activeMenu.y }}>
            {onForward && (
                <button className="notes-ctx-btn" onClick={() => onForward(activeMenu.msg)}>
                    <i className="fa-solid fa-share"></i> Forward Note
                </button>
            )}
            {activeMenu.msg.text && (
                <button className="notes-ctx-btn" onClick={() => handleCopy(activeMenu.msg.text)}>
                    <i className="fa-solid fa-copy"></i> Copy Text
                </button>
            )}
            {activeMenu.msg.attachments?.[0] && (
                <button className="notes-ctx-btn" onClick={() => handleDownload(activeMenu.msg.attachments[0].url, activeMenu.msg.attachments[0].name)}>
                    <i className="fa-solid fa-download"></i> Download File
                </button>
            )}
            <button className="notes-ctx-btn delete" onClick={() => deleteNote(activeMenu.msg.id)}>
                <i className="fa-solid fa-trash"></i> Delete Note
            </button>
        </div>
    );
};

export default NoteContextMenu;