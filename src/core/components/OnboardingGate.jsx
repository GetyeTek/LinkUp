import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import AvatarCropperModal from './AvatarCropperModal.jsx';
import './OnboardingGate.css';

const OnboardingGate = ({ userProfile, sessionUser, onComplete }) => {
    // Phase 1 State (Identity)
    const [phase, setPhase] = useState(1);
    const [sureName, setSureName] = useState('');
    const [fatherName, setFatherName] = useState('');
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [status, setStatus] = useState('idle');
    const [loading, setLoading] = useState(false);
    const [claimError, setClaimError] = useState(null);
    const [initialized, setInitialized] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);
    const fileInputRef = useRef(null);
  
    // Phase 2 State (Academic Wizard)
    const [stepIndex, setStepIndex] = useState(0);
    const [universities, setUniversities] = useState([]);
    const [academicData, setAcademicData] = useState({
        university_id: '',
        program: '',
        department: '',
        stream: '',
        target_department: '',
        year: ''
    });
  
    useEffect(() => {
        const fetchUnis = async () => {
            const { data } = await supabase.from('universities').select('id, name').order('name');
            if (data) setUniversities(data);
        };
        fetchUnis();
    }, []);
  
    useEffect(() => {
      if (initialized) return;
      
      const initialFullName = userProfile?.full_name || sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || '';
      const parts = initialFullName.trim().split(' ');
      
      let defaultSure = '';
      let defaultFather = '';
      
      if (parts.length > 0 && parts[0]) {
        defaultSure = parts[0];
        if (parts.length > 1) {
          defaultFather = parts.slice(1).join(' ');
        }
      }
      
      setSureName(defaultSure);
      setFatherName(defaultFather);
      setPhone(userProfile?.phone || sessionUser?.user_metadata?.phone || '');
  
      let baseForUsername = initialFullName || sessionUser?.email?.split('@')[0] || '';
      let suggestion = baseForUsername.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 20);
      while(suggestion.startsWith('_')) suggestion = suggestion.substring(1);
      if (suggestion.length > 0 && suggestion.length < 3) suggestion = suggestion.padEnd(3, 'x');
      
      if (suggestion) {
          setUsername(suggestion);
      }
      
      setInitialized(true);
    }, [userProfile, sessionUser, initialized]);
  
    useEffect(() => {
      if (!username) {
        setStatus('idle');
        return;
      }
  
      const cleanUsername = username.toLowerCase().trim();
      if (username !== cleanUsername) setUsername(cleanUsername);
  
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
        setStatus('invalid');
        return;
      }
  
      const checkAvailability = async () => {
        setStatus('checking');
        const { data, error } = await supabase.rpc('check_username_available', { req_username: cleanUsername });
        if (error) {
          setStatus('error');
        } else {
          setStatus(data ? 'available' : 'taken');
        }
      };
  
      const timer = setTimeout(checkAvailability, 500);
      return () => clearTimeout(timer);
    }, [username]);
  
    const handleFileChange = (e) => {
      if (e.target.files && e.target.files[0]) {
        setSelectedFile(e.target.files[0]);
      }
      e.target.value = null;
    };
  
    const getWizardSteps = () => {
        const base = ['intro', 'university', 'program', 'department'];
        if (!academicData.department) return base;
        if (academicData.department === 'Freshman') {
            return [...base, 'stream', 'target_department', 'finish'];
        } else {
            return [...base, 'year', 'finish'];
        }
    };
  
    const wizardSteps = getWizardSteps();
    const currentWizardId = wizardSteps[stepIndex];
  
    const handleNextPhase = () => {
        const cleanPhone = phone.replace(/\s/g, '');
        const isPhoneValid = /^(09|07)\d{8}$|^\+251[79]\d{8}$/.test(cleanPhone);
        
        if (status !== 'available' || sureName.trim().length < 2 || !isPhoneValid) {
            if (!isPhoneValid && phone.length > 0) setClaimError("Invalid phone. Use 09/07 (10 digits) or +251 (13 digits).");
            return;
        }
        setClaimError(null);
        setPhase(2);
    };
  
    const handleFinalSubmit = async () => {
        setLoading(true);
        setClaimError(null);
        
        const finalFullName = fatherName.trim() ? `${sureName.trim()} ${fatherName.trim()}` : sureName.trim();
        let finalAvatarUrl = sessionUser?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(finalFullName)}&background=1e1e1e&color=42d7b8&size=256`;
        
        try {
            if (croppedAvatar?.blob) {
                const arrayBuffer = await croppedAvatar.blob.arrayBuffer();
                const filePath = `${userProfile.id}/avatar_${Date.now()}.png`;
                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, arrayBuffer, { contentType: 'image/png', upsert: true });
                
                if (uploadError) throw uploadError;
                const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
                finalAvatarUrl = publicUrl;
            }
  
            const updatePayload = {
                username: username,
                full_name: finalFullName,
                avatar_url: finalAvatarUrl,
                phone: phone,
                university_id: academicData.university_id || null,
                program: academicData.program || null,
                department: academicData.department || null,
                year: academicData.year || null,
                freshman_stream: academicData.stream || null,
                target_department: academicData.target_department || null
            };
  
            const { error } = await supabase.from('profiles').update(updatePayload).eq('id', userProfile.id);
            if (error) throw error;
            
            onComplete(username, finalFullName, finalAvatarUrl);
        } catch (err) {
            console.error("Profile update failed:", err);
            setClaimError(err.message || "Failed to save profile. Please try again.");
            setLoading(false);
            setPhase(1);
        }
    };
  
    const displayAvatar = croppedAvatar?.url || userProfile?.avatar_url || sessionUser?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(sureName || 'Scholar')}&background=1e1e1e&color=42d7b8&size=256`;
    const displayFullName = `${sureName} ${fatherName}`.trim() || 'Scholar';
  
    const advanceWizard = () => setStepIndex(p => Math.min(p + 1, wizardSteps.length - 1));
    const backWizard = () => {
        if (stepIndex === 0) setPhase(1);
        else setStepIndex(p => Math.max(p - 1, 0));
    };
    const selectDataAndAdvance = (key, value) => {
        setAcademicData(p => ({ ...p, [key]: value }));
        setTimeout(advanceWizard, 250);
    };
  
    const DEPARTMENTS = ['Freshman', 'Computer Science', 'Software Engineering', 'Management', 'Economics', 'Electrical Engineering', 'Mechanical Engineering', 'Health', 'Other'];
    const YEARS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
  
    return (
      <div className="onboarding-overlay">
        {selectedFile && (
            <AvatarCropperModal 
                imageFile={selectedFile} 
                onCancel={() => setSelectedFile(null)} 
                onSave={(blob) => {
                    const url = URL.createObjectURL(blob);
                    setCroppedAvatar({ blob, url });
                    setSelectedFile(null);
                }}
            />
        )}
        
        <div className="ambient-elegant-bg"></div>
  
        {phase === 1 && (
            <div className="onboarding-card">
              <h2 className="onboarding-title">Set up your profile</h2>
              <p className="onboarding-subtitle">Review your details and secure your unique handle.</p>
  
              <div className="onboarding-preview">
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileChange} />
                <div className="onboarding-avatar-container" onClick={() => fileInputRef.current?.click()}>
                    <div className="onboarding-avatar-wrapper">
                        <img src={displayAvatar} alt="Profile Preview" />
                    </div>
                    <div className="avatar-edit-badge" title="Change Avatar"><i className="fas fa-pencil"></i></div>
                </div>
                <div className="preview-info">
                  <h3>{displayFullName}</h3>
                  <p>@{username || 'username'}</p>
                </div>
              </div>
  
              <div className="onboarding-form">
                <div className="input-row">
                  <div className="input-group-sm">
                    <label>Sure Name</label>
                    <input type="text" placeholder="First name" value={sureName} onChange={e => setSureName(e.target.value)} disabled={loading} />
                  </div>
                  <div className="input-group-sm">
                    <label>Father Name <span className="optional-tag">(Opt)</span></label>
                    <input type="text" placeholder="Last name" value={fatherName} onChange={e => setFatherName(e.target.value)} disabled={loading} />
                  </div>
                </div>
  
                <div className="input-group-sm handle-group">
                  <label>Username</label>
                  <div className={`handle-input-wrapper status-${status}`}>
                    <span className="handle-prefix">@</span>
                    <input type="text" placeholder="scholar_joe" value={username} onChange={e => setUsername(e.target.value)} disabled={loading} maxLength={20} />
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
  
                <div className="input-group-sm">
                  <label>Phone Number</label>
                  <div className={`handle-input-wrapper status-${phone.length > 0 ? (/^(09|07)\d{8}$|^\+251[79]\d{8}$/.test(phone.replace(/\s/g, '')) ? 'available' : 'invalid') : 'idle'}`}>
                    <span className="handle-prefix" style={{fontSize: '0.9rem'}}><i className="fas fa-phone"></i></span>
                    <input 
                      type="tel" 
                      placeholder="09... or +251..."
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      disabled={loading}
                    />
                    <div className="handle-status-icon">
                      {phone.length > 0 && /^(09|07)\d{8}$|^\+251[79]\d{8}$/.test(phone.replace(/\s/g, '')) && <i className="fas fa-check"></i>}
                    </div>
                  </div>
                  <div className="commitment-note" style={{marginTop: '10px', marginBottom: '0'}}>
                      <i className="fas fa-circle-info"></i>
                      <p>Used for <strong>rewards</strong> and secure account access.</p>
                  </div>
                </div>
  
                {phase === 1 && claimError && <div className="onboarding-error-alert">{claimError}</div>}
  
                <button className="onboarding-submit-btn" disabled={status !== 'available' || sureName.trim().length < 2} onClick={handleNextPhase}>
                  Continue <i className="fas fa-arrow-right" style={{marginLeft: '8px'}}></i>
                </button>
              </div>
            </div>
        )}
  
        {phase === 2 && (
            <div className="onboarding-card">
                <div className="wizard-progress-bar">
                    <div className="wizard-progress-fill" style={{ width: `${(stepIndex / (wizardSteps.length - 1)) * 100}%` }}></div>
                </div>
  
                {currentWizardId === 'intro' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Curate Your Space</h2>
                        <p className="onboarding-subtitle" style={{marginTop:'1rem'}}>To personalize your study materials, exams, and Miron AI tutor, we need a few details about your academic journey.</p>
                        <div style={{textAlign:'center', marginTop:'2rem', marginBottom: '1rem'}}>
                            <i className="fas fa-graduation-cap" style={{fontSize:'5rem', color:'var(--accent-teal)', filter: 'drop-shadow(0 0 20px rgba(66, 215, 184, 0.3))'}}></i>
                        </div>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard}>Let's Go</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'university' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Select University</h2>
                        <p className="onboarding-subtitle">Where are you studying?</p>
                        <select 
                            className="wizard-select" 
                            value={academicData.university_id} 
                            onChange={e => setAcademicData(p => ({...p, university_id: e.target.value}))}
                        >
                            <option value="" disabled>Choose your university...</option>
                            {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard} disabled={!academicData.university_id}>Next</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'program' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Program Type</h2>
                        <div className="wizard-options-grid single-col">
                            {['Regular', 'Extension'].map(o => (
                                <div key={o} className={`wizard-option-card ${academicData.program === o ? 'active' : ''}`} onClick={() => selectDataAndAdvance('program', o)}>{o}</div>
                            ))}
                        </div>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard} disabled={!academicData.program}>Next</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'department' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Department</h2>
                        <div className="wizard-options-grid">
                            {DEPARTMENTS.map(o => (
                                <div key={o} className={`wizard-option-card ${academicData.department === o ? 'active' : ''}`} onClick={() => selectDataAndAdvance('department', o)}>{o}</div>
                            ))}
                        </div>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard} disabled={!academicData.department}>Next</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'stream' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Freshman Stream</h2>
                        <div className="wizard-options-grid single-col">
                            {['Natural Science', 'Social Science'].map(o => (
                                <div key={o} className={`wizard-option-card ${academicData.stream === o ? 'active' : ''}`} onClick={() => selectDataAndAdvance('stream', o)}>{o}</div>
                            ))}
                        </div>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard} disabled={!academicData.stream}>Next</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'target_department' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Target Department</h2>
                        <p className="onboarding-subtitle">What do you want to join next year?</p>
                        <div className="wizard-options-grid">
                            {DEPARTMENTS.filter(d => d !== 'Freshman').map(o => (
                                <div key={o} className={`wizard-option-card ${academicData.target_department === o ? 'active' : ''}`} onClick={() => selectDataAndAdvance('target_department', o)}>{o}</div>
                            ))}
                        </div>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard} disabled={!academicData.target_department}>Next</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'year' && (
                    <div className="wizard-step">
                        <h2 className="onboarding-title">Current Year</h2>
                        <div className="wizard-options-grid">
                            {YEARS.map(o => (
                                <div key={o} className={`wizard-option-card ${academicData.year === o ? 'active' : ''}`} onClick={() => selectDataAndAdvance('year', o)}>{o}</div>
                            ))}
                        </div>
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={advanceWizard} disabled={!academicData.year}>Next</button>
                        </div>
                    </div>
                )}
  
                {currentWizardId === 'finish' && (
                    <div className="wizard-step">
                        <div className="wizard-finish-state">
                            {academicData.department === 'Freshman' ? (
                                <>
                                    <i className="fas fa-rocket wizard-finish-icon"></i>
                                    <h2 className="onboarding-title">You're all set!</h2>
                                    <p>Miron has prepared your Freshman {academicData.stream} resources. Your academic hub is ready.</p>
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-compass wizard-finish-icon" style={{color: '#ffab40', filter: 'drop-shadow(0 0 15px rgba(255, 171, 64, 0.4))'}}></i>
                                    <h2 className="onboarding-title">Welcome to LinkUp!</h2>
                                    <p>Curated resources for <strong style={{color:'#fff'}}>{academicData.department}</strong> are currently in development.<br/><br/>In the meantime, you have full access to Global Chat, Personal Notes, and Miron AI.</p>
                                </>
                            )}
                        </div>
                        
                        {claimError && <div className="onboarding-error-alert" style={{marginTop:'1.5rem'}}>{claimError}</div>}
                        
                        <div className="wizard-nav-row">
                            <button className="btn-wizard-back" onClick={backWizard} disabled={loading}><i className="fas fa-arrow-left"></i></button>
                            <button className="btn-wizard-next" onClick={handleFinalSubmit} disabled={loading}>
                                {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Enter Dashboard"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>
    );
};

export default OnboardingGate;