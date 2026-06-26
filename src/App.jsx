import React, { useState, useEffect } from 'react';
import { supabase } from './config/supabaseClient.js';
import Auth from './views/Auth.jsx';

// Gatekeeper for claiming usernames
const UsernameGate = ({ userProfile, onComplete }) => {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('idle'); // idle, checking, available, taken, invalid, error
  const [loading, setLoading] = useState(false);

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

  const handleClaim = async () => {
    if (status !== 'available') return;
    setLoading(true);
    const { error } = await supabase.from('profiles')
      .update({ username })
      .eq('id', userProfile.id);

    if (error) {
      console.error(error);
      setStatus('error');
      setLoading(false);
    } else {
      onComplete(username);
    }
  };

  return (
    <div className="username-gate-overlay">
      <div className="ambient-elegant-bg"></div>
      <div className="username-gate-card">
        <div className="gate-icon"><i className="fas fa-at"></i></div>
        <h2>Claim Your Handle</h2>
        <p>Your unique identity on LinkUp. Use letters, numbers, and underscores.</p>
        
        <div className={`gate-input-wrapper status-${status}`}>
          <span className="gate-prefix">@</span>
          <input 
            type="text" 
            placeholder="scholar_joe"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={loading}
            maxLength={20}
          />
          <div className="gate-status-icon">
            {status === 'checking' && <i className="fas fa-circle-notch fa-spin"></i>}
            {status === 'available' && <i className="fas fa-check"></i>}
            {status === 'taken' && <i className="fas fa-times"></i>}
            {status === 'invalid' && <i className="fas fa-exclamation"></i>}
          </div>
        </div>

        <div className="gate-hint">
          {status === 'invalid' && "3-20 characters. Lowercase, numbers, underscores only."}
          {status === 'taken' && "This handle is already taken."}
          {status === 'error' && "Connection error. Try again."}
          {status === 'available' && "Looks great! It's all yours."}
          {status === 'idle' && "Choose wisely."}
        </div>

        <button 
          className="gate-submit-btn" 
          disabled={status !== 'available' || loading}
          onClick={handleClaim}
        >
          {loading ? <i className="fas fa-circle-notch fa-spin"></i> : "Secure Handle"}
        </button>
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

const App = () => {
  console.log("App Component Rendering...");
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
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
        if (accessToken && refreshToken) {
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          window.parent.history.replaceState(null, '', window.parent.location.pathname + window.parent.location.search);
        }
      }
    } catch (e) {}

    const fetchProfile = async (userId) => {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (data) setUserProfile(data);
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
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
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
  if (isCheckingAuth) {
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

  // The Username Gatekeeper (Catches both legacy and new users without a handle)
  if (userProfile && !userProfile.username) {
    return <UsernameGate userProfile={userProfile} onComplete={(newUsername) => {
      setUserProfile({ ...userProfile, username: newUsername });
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
