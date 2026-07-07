import React from 'react';
import './UsernameField.css';

const UsernameField = ({ username, setUsername, status, disabled }) => {
    return (
        <div className="handle-group">
            <label>Username</label>
            <div className={`handle-input-wrapper status-${status}`}>
                <span className="handle-prefix">@</span>
                <input 
                    type="text" 
                    placeholder="scholar_joe" 
                    value={username} 
                    onChange={e => setUsername(e.target.value)} 
                    disabled={disabled} 
                    maxLength={20} 
                />
                <div className="handle-status-icon">
                    {status === 'checking' && <i className="fas fa-circle-notch fa-spin"></i>}
                    {status === 'available' && <i className="fas fa-check"></i>}
                    {status === 'taken' && <i className="fas fa-times"></i>}
                    {status === 'invalid' && <i className="fas fa-exclamation"></i>}
                </div>
            </div>
            <div className="handle-hint">
                {status === 'invalid' && "3-20 chars. Lowercase, numbers, underscores."}
                {status === 'taken' && "This username is already taken."}
                {status === 'error' && "Connection error. Try again."}
                {status === 'available' && "Looks great! It's all yours."}
                {status === 'idle' && "Choose your unique identity."}
            </div>
        </div>
    );
};

export default UsernameField;