import React from 'react';
import './MessageContextMenu.css';

const MessageContextMenu = ({
    activeMenu,
    onClose,
    onReply,
    onCopy,
    onDownload,
    onDownloadAllRequest,
    onForward,
    onEdit,
    onPin,
    onDeleteRequest,
    canDownload = true,
    canForward = true,
    canPin = false,
    canDeleteAny = false
}) => {
    if (!activeMenu) return null;
    const { msg, isMine, x, y } = activeMenu;

    return (
        <div className="unified-ctx-menu" style={{ left: x, top: y }}>
            {!isMine && (
                <button className="unified-ctx-btn" onClick={() => { onReply(msg); onClose(); }}>
                    <i className="fa-solid fa-reply"></i> Reply
                </button>
            )}
            {msg.text && (
                <button className="unified-ctx-btn" onClick={() => { onCopy(msg.text); onClose(); }}>
                    <i className="fa-solid fa-copy"></i> Copy Text
                </button>
            )}
            {(() => {
                const downloadableAttachments = msg.attachments?.filter(a => a.type !== 'poll') || [];
                return canDownload && downloadableAttachments.length > 0 && (
                    <button className="unified-ctx-btn" onClick={() => {
                        if (downloadableAttachments.length > 1) {
                            onDownloadAllRequest(downloadableAttachments);
                        } else {
                            onDownload(downloadableAttachments[0].url, downloadableAttachments[0].name);
                        }
                        onClose();
                    }}>
                        <i className="fa-solid fa-download"></i> {downloadableAttachments.length > 1 ? 'Download All Files' : 'Download File'}
                    </button>
                );
            })()}
            {canForward && (
                <button className="unified-ctx-btn" onClick={() => { onForward(msg); onClose(); }}>
                    <i className="fa-solid fa-share"></i> Forward
                </button>
            )}
            {isMine && (
                <button className="unified-ctx-btn" onClick={() => { onEdit(msg); onClose(); }}>
                    <i className="fa-solid fa-pen"></i> Edit
                </button>
            )}
            {canPin && (
                <button className="unified-ctx-btn" onClick={() => { onPin(msg); onClose(); }}>
                    <i className="fa-solid fa-thumbtack"></i> Pin
                </button>
            )}
            {(() => {
                const isPoll = msg.attachments && msg.attachments.length > 0 && msg.attachments[0].type === 'poll';
                const pollData = isPoll ? msg.attachments[0].poll_data : null;
                return isPoll && (isMine || canDeleteAny) && !pollData?.is_stopped && (
                    <button className="unified-ctx-btn" onClick={() => { onDeleteRequest(msg.id, true); onClose(); }}>
                        <i className="fa-solid fa-stop-circle"></i> Stop Poll
                    </button>
                );
            })()}
            {(isMine || canDeleteAny) && (
                <button className="unified-ctx-btn delete" onClick={() => { onDeleteRequest(msg.id, false); onClose(); }}>
                    <i className="fa-solid fa-trash"></i> {isMine ? 'Delete' : 'Admin Delete'}
                </button>
            )}
        </div>
    );
};

export default MessageContextMenu;