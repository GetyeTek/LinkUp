import React, { useRef } from 'react';
import './ProfileAvatarPicker.css';

const ProfileAvatarPicker = ({ displayAvatar, displayFullName, username, onFileSelect, disabled }) => {
    const fileInputRef = useRef(null);

    return (
        <div className="onboarding-preview">
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept="image/*" 
                onChange={(e) => {
                    if (e.target.files && e.target.files[0]) onFileSelect(e.target.files[0]);
                    e.target.value = null;
                }} 
                disabled={disabled} 
            />
            <div 
                className="onboarding-avatar-container" 
                onClick={() => !disabled && fileInputRef.current?.click()} 
                style={{cursor: disabled ? 'default' : 'pointer'}}
            >
                <div className="onboarding-avatar-wrapper">
                    <img src={displayAvatar} alt="Profile Preview" />
                </div>
                {!disabled && <div className="avatar-edit-badge" title="Change Avatar"><i className="fas fa-pencil"></i></div>}
            </div>
            <div className="preview-info">
                <h3>{displayFullName}</h3>
                <p>@{username || 'username'}</p>
            </div>
        </div>
    );
};

export default ProfileAvatarPicker;