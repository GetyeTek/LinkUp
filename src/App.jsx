import React, { useState, useEffect } from 'react';
import { supabase } from './config/supabaseClient.js';
import Auth from './views/Auth.jsx';

// Zero-Dependency HTML5 Canvas Avatar Cropper
const AvatarCropperModal = ({ imageFile, onCancel, onSave }) => {
  const [src, setSrc] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef(null);

  useEffect(() => {
      const url = URL.createObjectURL(imageFile);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const handleStart = (clientX, clientY) => {
      setIsDragging(true);
      dragStart.current = { x: clientX - pos.x, y: clientY - pos.y };
  };

  const handleMove = (clientX, clientY) => {
      if (!isDragging) return;
      setPos({ x: clientX - dragStart.current.x, y: clientY - dragStart.current.y });
  };

  const handleEnd = () => setIsDragging(false);

  const generateCrop = () => {
      if (!imgRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      
      const img = imgRef.current;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const scaleBase = Math.max(256 / nw, 256 / nh);
      const rw = nw * scaleBase;
      const rh = nh * scaleBase;

      ctx.clearRect(0, 0, 256, 256);
      ctx.translate(128, 128); // center of canvas
      ctx.scale(zoom, zoom);
      ctx.translate(pos.x, pos.y);
      ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);

      canvas.toBlob((blob) => {
          onSave(blob);
      }, 'image/png');
  };

  return (
      <div className="cropper-overlay">
          <div className="cropper-card">
              <h3>Adjust Profile Picture</h3>
              <div 
                  className="cropper-viewport"
                  onMouseDown={e => handleStart(e.clientX, e.clientY)}
                  onMouseMove={e => handleMove(e.clientX, e.clientY)}
                  onMouseUp={handleEnd}
                  onMouseLeave={handleEnd}
                  onTouchStart={e => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchMove={e => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchEnd={handleEnd}
              >
                  <img 
                      ref={imgRef}
                      src={src} 
                      draggable={false}
                      style={{
                          transform: `translate(calc(-50% + ${pos.x * zoom}px), calc(-50% + ${pos.y * zoom}px)) scale(${zoom})`
                      }}
                      className="cropper-image"
                      alt="Crop Source"
                  />
                  <div className="cropper-mask"></div>
              </div>
              <div className="cropper-controls">
                  <i className="fas fa-search-minus"></i>
                  <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} />
                  <i className="fas fa-search-plus"></i>
              </div>
              <div className="cropper-actions">
                  <button className="btn-crop-cancel" onClick={onCancel}>Cancel</button>
                  <button className="btn-crop-save" onClick={generateCrop}>Apply</button>
              </div>
          </div>
      </div>
  );
};

// Unified Onboarding Gatekeeper (Handles Display Name & Username)
const OnboardingGate = ({ userProfile, sessionUser, onComplete }) => {
  const [sureName, setSureName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [croppedAvatar, setCroppedAvatar] = useState(null);
  const fileInputRef = useRef(null);
  const [fatherName, setFatherName] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('idle'); // idle, checking, available, taken, invalid, error
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    
    // 1. Extract existing full name from profile or session metadata
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

    // 2. Generate a smart username suggestion
    let baseForUsername = initialFullName || sessionUser?.email?.split('@')[0] || '';
    let suggestion = baseForUsername.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 20);
    // Trim leading underscores
    while(suggestion.startsWith('_')) suggestion = suggestion.substring(1);
    // Pad if too short
    if (suggestion.length > 0 && suggestion.length < 3) suggestion = suggestion.padEnd(3, 'x');
    
    if (suggestion) {
        setUsername(suggestion);
    }
    
    setInitialized(true);
  }, [userProfile, sessionUser, initialized]);

  // Handle Username Validation
  useEffect(() => {
    if (!username) {
      setStatus('idle');
      return;
    }

    const cleanUsername = username.toLowerCase().trim();
    if (username !== cleanUsername) setUsername(cleanUsername);

    // Regex check matching our DB constraint
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

  const handleClaim = async () => {
    if (status !== 'available' || sureName.trim().length < 2) return;
    setLoading(true);
    
    const finalFullName = fatherName.trim() ? `${sureName.trim()} ${fatherName.trim()}` : sureName.trim();
    
    // Dynamic Fallback: Use Google Auth avatar, or generate a beautiful initial-based placeholder
    let finalAvatarUrl = sessionUser?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(finalFullName)}&background=1e1e1e&color=42d7b8&size=256`;
    
    try {
        if (croppedAvatar?.blob) {
            const filePath = `${userProfile.id}/avatar_${Date.now()}.png`;
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, croppedAvatar.blob, { contentType: 'image/png', upsert: true });
            
            if (uploadError) throw uploadError;
            
            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
            finalAvatarUrl = publicUrl;
        }

        const { error } = await supabase.from('profiles')
          .update({ 
              username: username,
              full_name: finalFullName,
              avatar_url: finalAvatarUrl
          })
          .eq('id', userProfile.id);

        if (error) throw error;
        onComplete(username, finalFullName);
    } catch (err) {
        console.error("Profile update failed:", err);
        setStatus('error');
        setLoading(false);
    }
  };

  const displayAvatar = croppedAvatar?.url || userProfile?.avatar_url || sessionUser?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(sureName || 'Scholar')}&background=1e1e1e&color=42d7b8&size=256`;
  const displayFullName = `${sureName} ${fatherName}`.trim() || 'Scholar';

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
      <div className="onboarding-card">
        <h2 className="onboarding-title">Set up your profile</h2>
        <p className="onboarding-subtitle">Review your details and secure your unique handle.</p>

        <div className="onboarding-preview">
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileChange} />
          <div className="onboarding-avatar-wrapper" onClick={() => fileInputRef.current?.click()}>
              <img src={displayAvatar} alt="Profile Preview" />
              <div className="avatar-edit-overlay"><i className="fas fa-camera"></i></div>
          </div>
          <div className="preview-info">
            <h3>{displayFullName}</h3>
            <p>@{username || 'handle'}</p>
          </div>
        </div>

        <div className="onboarding-form">
          <div className="input-row">
            <div className="input-group-sm">
              <label>Sure Name</label>
              <input 
                type="text" 
                placeholder="First name"
                value={sureName}
                onChange={e => setSureName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-group-sm">
              <label>Father Name <span className="optional-tag">(Opt)</span></label>
              <input 
                type="text" 
                placeholder="Last name"
                value={fatherName}
                onChange={e => setFatherName(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="input-group-sm handle-group">
            <label>LinkUp Handle</label>
            <div className={`handle-input-wrapper status-${status}`}>
              <span className="handle-prefix">@</span>
              <input 
                type="text" 
                placeholder="scholar_joe"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
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
              {status === 'taken' && "This handle is already taken."}
              {status === 'error' && "Connection error. Try again."}
              {status === 'available' && "Looks great! It's all yours."}
              {status === 'idle' && "Choose your unique identity."}
            </div>
          </div>

          <button 
            className="onboarding-submit-btn" 
            disabled={status !== 'available' || sureName.trim().length < 2 || loading}
            onClick={handleClaim}
          >
            {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Enter LinkUp"}
          </button>
        </div>
      </div>
    </div>
  );
};

// Placeholder imports for views we will create in the next session
import Home from './views/Home.jsx';
import Discover from './views/Discover.jsx';
import Study from './views/Study.jsx';
import Connect from './views/Connect.jsx';
import Profile from './views/Profile.jsx';

import ActivityHub from './views/ActivityHub.jsx';
import MironChat from './views/MironChat.jsx';

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

const App = () => {
  console.log("App Component Rendering...");
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    // 0. Conduit OAuth Popup Interceptor
    const handleMessage = (e) => {
      if (e.data?.type === 'CONDUIT_OAUTH_TOKEN' && e.data.hash) {
        const hashParams = new URLSearchParams(e.data.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // Legacy fallback for parent window hash (just in case)
    try {
      if (window.IS_CONDUIT_PREVIEW && window.parent && window.parent.location.hash.includes('access_token')) {
        const hashParams = new URLSearchParams(window.parent.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        
        if (accessToken && refreshToken) {
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          
          // Manually intercept the recovery flag since Supabase listener can't see the parent URL
          if (type === 'recovery') {
            setRequiresPasswordReset(true);
          }
          
          // Clear the hash from the IDE URL bar so it doesn't trigger again on reload
          window.parent.history.replaceState(null, '', window.parent.location.pathname + window.parent.location.search);
        }
      }
    } catch (e) {}

    const fetchProfile = async (userId) => {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (data) setUserProfile(data);
      setIsProfileLoaded(true);
    };

    const updateLastSeen = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      }
    };

    // 1. Check active session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        updateLastSeen();
      }
      setIsCheckingAuth(false);
    });

    // Sync last seen every 2 minutes while active
    const presenceInterval = setInterval(() => {
      updateLastSeen();
    }, 120000);

    // 2. Listen for login/logout events in realtime
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (_event === 'PASSWORD_RECOVERY') {
        setRequiresPasswordReset(true);
      }
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
        setIsProfileLoaded(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('message', handleMessage);
      clearInterval(presenceInterval);
    };
  }, []);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [mironContext, setMironContext] = useState(null); // null means closed, object holds selection context

  useEffect(() => {
    const handleGlobalMironRequest = (e) => {
      const text = e.detail?.text || null;
      setMironContext({ text });
    };
    window.addEventListener('open-full-miron-chat', handleGlobalMironRequest);
    return () => window.removeEventListener('open-full-miron-chat', handleGlobalMironRequest);
  }, []);
  
  // Maps tab IDs to their index for the mobile indicator animation
  const tabIndex = {
    'home': 0,
    'discover': 1,
    'study': 2,
    'connect': 3,
    'profile': 4
  };

  const renderContent = () => {
    switch(activeTab) {
      case 'home': return <Home onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      case 'discover': return <Discover onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      case 'study': return <Study onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      case 'connect': return <Connect onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} currentUser={session?.user} />;
      case 'profile': return <Profile onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
      default: return <Home onOpenActivity={() => setIsActivityOpen(true)} userProfile={userProfile} />;
    }
  };

  // The Minimalist Auth Gate Loader
  if (isCheckingAuth || (session && !isProfileLoaded)) {
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0c', color: '#42d7b8', flexDirection: 'column', gap: '1rem' }}>
        <i className="fas fa-circle-notch fa-spin" style={{ fontSize: '2rem' }}></i>
        <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: '0.9rem', letterSpacing: '2px' }}>INITIALIZING LINKUP</div>
      </div>
    );
  }

  // The Auth Gateway Interceptor
  if (!session) {
    return <Auth />;
  }

  // Password Reset Interceptor
  if (requiresPasswordReset) {
    return <UpdatePasswordGate onComplete={() => setRequiresPasswordReset(false)} />;
  }

  // The Onboarding Gatekeeper (Unified name and handle verification)
  if (userProfile && !userProfile.username) {
    return <OnboardingGate userProfile={userProfile} sessionUser={session?.user} onComplete={(newUsername, newFullName) => {
      setUserProfile({ ...userProfile, username: newUsername, full_name: newFullName });
    }} />;
  }

  return (
    <div className="app-container">
      <main className="main-content">
        {renderContent()}
      </main>
      {isActivityOpen && <ActivityHub onClose={() => setIsActivityOpen(false)} />}
      {mironContext && (
        <MironChat 
          initialContext={mironContext.text} 
          onClose={() => setMironContext(null)} 
        />
      )}

      <footer className="navigation-magic">
        <nav>
          {/* Mobile Indicator - Moves based on active index (20% width per item) */}
          <div 
            className="indicator" 
            style={{ 
              transform: `translateX(${tabIndex[activeTab] * 100}%)`, 
              left: '0' 
            }}
          ></div>

          <li 
            className={`list ${activeTab === 'home' ? 'active' : ''}`} 
            onClick={() => setActiveTab('home')}
          >
            <a>
              <span className="icon"><i className="fas fa-home"></i></span>
              <span className="text">Home</span>
            </a>
          </li>
          
          <li 
            className={`list ${activeTab === 'discover' ? 'active' : ''}`} 
            onClick={() => setActiveTab('discover')}
          >
            <a>
              <span className="icon"><i className="fas fa-compass"></i></span>
              <span className="text">Discover</span>
            </a>
          </li>

          <li 
            className={`list ${activeTab === 'study' ? 'active' : ''}`} 
            onClick={() => setActiveTab('study')}
          >
            <a>
              <span className="icon"><i className="fas fa-book-open"></i></span>
              <span className="text">Study</span>
            </a>
          </li>

          <li 
            className={`list ${activeTab === 'connect' ? 'active' : ''}`} 
            onClick={() => setActiveTab('connect')}
          >
            <a>
              <span className="icon"><i className="fas fa-users"></i></span>
              <span className="text">Connect</span>
            </a>
          </li>

          <li 
            className={`list ${activeTab === 'profile' ? 'active' : ''}`} 
            onClick={() => setActiveTab('profile')}
          >
            <a>
              <span className="icon"><i className="fas fa-user"></i></span>
              <span className="text">Profile</span>
            </a>
          </li>
        </nav>
      </footer>
    </div>
  );
};

export default App;
