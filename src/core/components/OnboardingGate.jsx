import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import AvatarCropperModal from './AvatarCropperModal.jsx';
import ProfileAvatarPicker from './ProfileAvatarPicker.jsx';
import UsernameField from './UsernameField.jsx';
import { useUsernameCheck } from '../hooks/useUsernameCheck.js';
import { usePhoneCheck } from '../hooks/usePhoneCheck.js';
import './OnboardingGate.css';

const OnboardingGate = ({ userProfile, sessionUser, onComplete }) => {
    // Phase 1 State (Identity)
    const [phase, setPhase] = useState(1);
    const [sureName, setSureName] = useState('');
    const [fatherName, setFatherName] = useState('');
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const status = useUsernameCheck(username, '');
    const phoneStatus = usePhoneCheck(phone, userProfile?.phone || sessionUser?.user_metadata?.phone);
    const [loading, setLoading] = useState(false);
    const [claimError, setClaimError] = useState(null);
    const [initialized, setInitialized] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [croppedAvatar, setCroppedAvatar] = useState(null);

    const [localTelegramVerified, setLocalTelegramVerified] = useState(false);

    useEffect(() => {
        setLocalTelegramVerified(!!((userProfile?.registered_with_telegram || sessionUser?.user_metadata?.registered_with_telegram) && (userProfile?.phone || sessionUser?.user_metadata?.phone)));
    }, [userProfile, sessionUser]);

    // Realtime Listener for Auto-Magic Migration
    useEffect(() => {
        const targetId = userProfile?.id || sessionUser?.id;
        if (!targetId) return;

        const channel = supabase.channel('onboarding_profile_sync')
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'profiles', 
                filter: `id=eq.${targetId}` 
            }, (payload) => {
                const updatedProfile = payload.new;
                if (updatedProfile.registered_with_telegram && updatedProfile.phone) {
                    setPhone(updatedProfile.phone);
                    setLocalTelegramVerified(true);
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [userProfile?.id, sessionUser?.id]);
  
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

    setInitialized(true); // Lock instantly to prevent React 18 Strict Mode double-firing

    const resolveUsernameSuggestion = async () => {
        const tgUsername = userProfile?.telegram_username || sessionUser?.user_metadata?.telegram_username;
        
        if (tgUsername) {
            // Normalize Telegram's handle to match platform regex requirements
            let base = tgUsername.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 20);
            while (base.startsWith('_')) base = base.substring(1);
            if (base.length > 0 && base.length < 3) base = base.padEnd(3, 'x');
            
            // Check direct availability
            const { data: isAvailable } = await supabase.rpc('check_username_available', { req_username: base });
            if (isAvailable) {
                setUsername(base);
                return;
            }
            
            // Group and User naming collision resolution algorithm
            let counter = 1;
            while (true) {
                const suffix = counter.toString();
                const candidate = base.substring(0, 20 - suffix.length) + suffix;
                
                const { data: checkNext } = await supabase.rpc('check_username_available', { req_username: candidate });
                if (checkNext) {
                    setUsername(candidate);
                    break;
                }
                counter++;
                if (counter > 100) break; // Infinite loop block
            }
        } else {
            // Standard fallback suggestion
            let baseForUsername = initialFullName || sessionUser?.email?.split('@')[0] || '';
            let suggestion = baseForUsername.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 20);
            while(suggestion.startsWith('_')) suggestion = suggestion.substring(1);
            if (suggestion.length > 0 && suggestion.length < 3) suggestion = suggestion.padEnd(3, 'x');
            
            if (suggestion) {
                setUsername(suggestion);
            }
        }
    };

    resolveUsernameSuggestion();
  }, [userProfile, sessionUser, initialized]);
  
    useEffect(() => {
      if (username) {
          const cleanUsername = username.toLowerCase().trim();
          if (username !== cleanUsername) setUsername(cleanUsername);
      }
    }, [username]);
  
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
        if (status !== 'available' || sureName.trim().length < 2 || (!localTelegramVerified && phoneStatus !== 'available')) {
            if (!localTelegramVerified && phoneStatus !== 'available' && phone.length > 0) {
                setClaimError("Please provide a valid and available phone number.");
            }
            return;
        }
        setClaimError(null);
        setPhase(2);
    };
  
    const handleFinalSubmit = async () => {
        setLoading(true);
        setClaimError(null);
        
        const finalFullName = fatherName.trim() ? `${sureName.trim()} ${fatherName.trim()}` : sureName.trim();
        let finalAvatarUrl = userProfile?.avatar_url || sessionUser?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(finalFullName)}&background=1e1e1e&color=42d7b8&size=256`;
        
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
  
            let normalizedPhone = phone.replace(/\s+/g, '');
            if (normalizedPhone && !normalizedPhone.startsWith('+')) {
                if (normalizedPhone.startsWith('0')) {
                    normalizedPhone = '+251' + normalizedPhone.substring(1);
                } else {
                    normalizedPhone = '+' + normalizedPhone;
                }
            }

            const updatePayload = {
                username: username,
                full_name: finalFullName,
                avatar_url: finalAvatarUrl,
                phone: normalizedPhone || null,
                university_id: academicData.university_id || null,
                program: academicData.program || null,
                department: academicData.department || null,
                year: academicData.year || null,
                freshman_stream: academicData.stream || null,
                target_department: academicData.target_department || null
            };
  
            const targetId = userProfile?.id || sessionUser?.id;
            const { error } = await supabase.from('profiles').update(updatePayload).eq('id', targetId);
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
  
              <ProfileAvatarPicker 
                  displayAvatar={displayAvatar}
                  displayFullName={displayFullName}
                  username={username}
                  onFileSelect={setSelectedFile}
                  disabled={loading}
              />
  
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
  
                <UsernameField 
                    username={username}
                    setUsername={setUsername}
                    status={status}
                    disabled={loading}
                />
  
                <div className="input-group-sm">
                  <label>Phone Number</label>
                  <div className={`handle-input-wrapper status-${localTelegramVerified ? 'available' : phoneStatus}`}>
                    <span className="handle-prefix" style={{fontSize: '0.9rem'}}><i className="fas fa-phone"></i></span>
                    <input 
                      type="tel" 
                      placeholder="09... or +251..."
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      disabled={loading || localTelegramVerified}
                    />
                    <div className="handle-status-icon">
                      {localTelegramVerified ? (
                        <i className="fas fa-lock" style={{color: 'var(--accent-teal)'}}></i>
                      ) : (
                        phoneStatus === 'checking' ? <i className="fas fa-circle-notch fa-spin"></i> :
                        phoneStatus === 'available' ? <i className="fas fa-check"></i> :
                        phoneStatus === 'taken' ? <i className="fas fa-times"></i> :
                        phoneStatus === 'invalid' ? <i className="fas fa-exclamation"></i> : null
                      )}
                    </div>
                  </div>
                  
                  {!localTelegramVerified && phoneStatus === 'taken' ? (
                      <div className="commitment-note" style={{ marginTop: '10px', marginBottom: '0', background: 'rgba(255, 95, 95, 0.05)', borderColor: 'rgba(255, 95, 95, 0.2)' }}>
                          <i className="fas fa-exclamation-circle" style={{color: '#ff5f5f'}}></i>
                          <div style={{ flex: 1 }}>
                              <p style={{ color: '#ff5f5f', fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>Phone Already Linked</p>
                              <p style={{ color: '#ccc', marginBottom: '10px' }}>This number is already registered. Verify ownership via Telegram to securely merge your accounts, or sign out.</p>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  <button 
                                      onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}
                                      style={{ padding: '8px 12px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', fontSize: '0.8rem', cursor: 'pointer', flex: '1 1 auto' }}
                                  >
                                      Sign Out
                                  </button>
                                  <a 
                                      href={`https://t.me/linkupregistrationbot?start=verify_${userProfile?.id || sessionUser?.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(41, 169, 234, 0.1)', color: '#29A9EA', border: '1px solid rgba(41, 169, 234, 0.3)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flex: '2 1 auto' }}
                                  >
                                      <i className="fab fa-telegram"></i> Verify via Telegram
                                  </a>
                              </div>
                          </div>
                      </div>
                  ) : (
                      <>
                          {!localTelegramVerified && phoneStatus !== 'idle' && (
                              <div className="handle-hint" style={{marginTop: '4px', fontSize: '0.75rem', fontWeight: 500, color: phoneStatus === 'invalid' ? '#ff5f5f' : 'var(--accent-teal)', paddingLeft: '4px'}}>
                                  {phoneStatus === 'invalid' && "Enter a valid Ethiopian phone number (e.g. 09... or +251...)."}
                                  {phoneStatus === 'error' && "Connection error. Try again."}
                                  {phoneStatus === 'available' && "Looks great! Phone number is available."}
                              </div>
                          )}
                          <div className="commitment-note" style={{marginTop: '10px', marginBottom: '0'}}>
                              <i className={localTelegramVerified ? "fas fa-shield-halved" : "fas fa-circle-info"}></i>
                              <p>
                                {localTelegramVerified ? (
                                  <span>Verified and locked via Telegram login.</span>
                                ) : (
                                  <span>Used for <strong>rewards</strong> and secure account access.</span>
                                )}
                              </p>
                          </div>
                      </>
                  )}
                </div>
  
                {phase === 1 && claimError && <div className="onboarding-error-alert">{claimError}</div>}
  
                <button className="onboarding-submit-btn" disabled={status !== 'available' || sureName.trim().length < 2 || (!localTelegramVerified && phoneStatus !== 'available')} onClick={handleNextPhase}>
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