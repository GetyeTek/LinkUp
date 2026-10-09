import React from 'react';
import { createPortal } from 'react-dom';

const GenericConfirmModal = ({ title, description, onConfirm, onCancel, confirmText, cancelText = "Cancel", isProcessing = false, isDanger = true }) => {
    return createPortal(
        <div className="custom-modal-overlay" style={{ zIndex: 100001 }}>
            <div className="custom-modal-card">
                <h3 style={{ color: isDanger ? '#ff5f5f' : '#fff' }}>{title}</h3>
                <div style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: '#aaa', lineHeight: 1.5 }}>
                    {description}
                </div>
                <div className="cm-footer">
                    <button className="cm-btn-cancel" onClick={onCancel} disabled={isProcessing}>{cancelText}</button>
                    <button className={isDanger ? "cm-btn-danger" : "cm-btn-primary"} onClick={onConfirm} disabled={isProcessing}>
                        {isProcessing ? <i className="fas fa-circle-notch fa-spin"></i> : confirmText}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default GenericConfirmModal;