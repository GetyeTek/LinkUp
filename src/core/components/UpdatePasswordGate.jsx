import React, { useState } from 'react';
import { supabase } from '@linkup-platform/sdk-core';

const UpdatePasswordGate = ({ onComplete }) => {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
  
    const handleUpdate = async () => {
      if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      setLoading(false);
      if (error) {
        alert(error.message);
      } else {
        onComplete();
      }
    };
  
    return (
      <div className="onboarding-overlay">
        <div className="ambient-elegant-bg"></div>
        <div className="onboarding-card">
          <h2 className="onboarding-title">Secure your account</h2>
          <p className="onboarding-subtitle">Enter a new password for your account.</p>
  
          <div className="onboarding-form" style={{ marginTop: '1rem' }}>
            <div className="input-group-sm">
              <label>New Password</label>
              <input 
                type="password" 
                placeholder="Min. 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <button className="onboarding-submit-btn" disabled={loading} onClick={handleUpdate}>
              {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Update Password"}
            </button>
          </div>
        </div>
      </div>
    );
};

export default UpdatePasswordGate;