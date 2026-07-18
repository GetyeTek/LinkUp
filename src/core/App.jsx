import React, { useState, useEffect, useRef } from 'react';
import { supabase, PlatformProvider } from '@linkup-platform/sdk-core';
import Auth from './Auth.jsx';
// Modules & Sub-Apps
import Home from './Home.jsx';
import Profile from './Profile.jsx';
import ActivityHub from './ActivityHub.jsx';
import { lazy, Suspense } from 'react';
import OnboardingGate from './components/OnboardingGate.jsx';
import UpdatePasswordGate from './components/UpdatePasswordGate.jsx';
import MironChat from './MironChat.jsx';
import MironLiveSession from './components/MironLiveSession.jsx';
import BottomNavigation from './components/BottomNavigation.jsx';
import { useGlobalSwipe } from '@linkup-platform/sdk-core';

const Discover = lazy(() => import('@linkup/gibi-news'));
const Study = lazy(() => import('@linkup/heaven-academy'));
const Connect = lazy(() => import('@linkup/squad'));

const App = () => {
  
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showOfflineBanner, setShowOfflineBanner] = useState(!navigator.onLine);
      const [unreadCount, setUnreadCount] = useState(0);
      const [routePayload, setRoutePayload] = useState(null);
      const [isMironLive, setIsMironLive] = useState(false);
      const [theme, setTheme] = useState(localStorage.getItem('linkup_theme') || 'dark');
      const mironAvatarUrl = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";

      useEffect(() => {
          document.documentElement.className = `theme-${theme}`;
      }, [theme]);

      const toggleTheme = async () => {
          const newTheme = theme === 'dark' ? 'light' : 'dark';
          setTheme(newTheme);
          localStorage.setItem('linkup_theme', newTheme);
          if (session?.user?.id) {
              await supabase.from('profiles').update({ theme: newTheme }).eq('id', session.user.id);
          }
      };

      useEffect(() => {
        const handleOpenLive = () => setIsMironLive(true);
        window.addEventListener('miron:open-live-session', handleOpenLive);
        return () => window.removeEventListener('miron:open-live-session', handleOpenLive);
      }, []);

      useEffect(() => {
        const handleOnline = () => { 
        setIsOffline(false); 
        setTimeout(() => setShowOfflineBanner(false), 3000); 
    };
    const handleOffline = () => { 
        setIsOffline(true); 
        setShowOfflineBanner(true); 
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Intercept Deep Links on Boot
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('squad') || params.has('sq') || params.has('invite')) {
        setActiveTab('connect');
    }
  }, []);

  // Global Tab Navigation Listener
  useEffect(() => {
    const handleNav = (e) => {
        setActiveTab(e.detail.tab);
        if (e.detail.payload) setRoutePayload(e.detail.payload);
    };
    window.addEventListener('navigate-tab', handleNav);
    return () => window.removeEventListener('navigate-tab', handleNav);
  }, []);

  // Swipe Engine State Decoupled
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useGlobalSwipe(activeTab, setActiveTab);

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

            const fetchProfile = async (userId, retries = 3) => {
          if (!navigator.onLine) {
              setTimeout(() => fetchProfile(userId, retries), 2000);
              return;
          }

          try {
              const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
              
              if (error) {
                  // Network drop or database timeout. Do NOT decrement retries. Wait and try again.
                  console.warn("[Platform] Profile fetch transient error. Pausing...", error.message);
                  setTimeout(() => fetchProfile(userId, retries), 2000);
                  return;
              }

              if (data) {
                  setUserProfile(data);
                  if (data.theme && data.theme !== theme) {
                      setTheme(data.theme);
                      localStorage.setItem('linkup_theme', data.theme);
                  }
                  setIsProfileLoaded(true);
              } else if (retries > 0) {
                  // Data is null and Error is null. DB responded successfully but found 0 rows.
                  // This might be a replication delay. Decrement retries.
                  setTimeout(() => fetchProfile(userId, retries - 1), 1000);
              } else {
                  // GHOST SESSION DETECTED: DB profile is permanently missing, but local JWT exists.
                  console.warn("[Security] Ghost session detected. Backend user likely deleted. Forcing local logout.");
                  await supabase.auth.signOut();
                  setSession(null);
                  setUserProfile(null);
                  setIsProfileLoaded(true);
              }
          } catch (err) {
              console.error("[Platform] Critical fetch error", err);
              setTimeout(() => fetchProfile(userId, retries), 2000);
          }
        };

    const updateLastSeen = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      }
    };

    const fetchNotificationsCount = async (userId) => {
        const { count } = await supabase.from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false);
        setUnreadCount(count || 0);
    };

    const resolveReferralStorage = (sessionObj) => {
        const refUsername = localStorage.getItem('linkup_ref');
        if (sessionObj && refUsername) {
            // Silently link the referral on the backend and clear the cache
            supabase.rpc('register_referral', { referrer_username: refUsername }).then(() => {
                localStorage.removeItem('linkup_ref');
            });
        }
    };

    // 1. Check active session on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        resolveReferralStorage(session);
        fetchProfile(session.user.id);
        updateLastSeen();
        fetchNotificationsCount(session.user.id);
      }
      setIsCheckingAuth(false);
    });

    // Sync last seen every 2 minutes while active
    const presenceInterval = setInterval(() => {
      updateLastSeen();
      supabase.rpc('update_user_streak').then(({ error }) => {
          if (error) console.error("Streak sync failed:", error);
      });
    }, 120000);

    // Initial streak bump on load
    supabase.rpc('update_user_streak').then(({ error }) => {
        if (error) console.error("Streak init failed:", error);
    });

    // 2. Listen for login/logout events in realtime
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (_event === 'PASSWORD_RECOVERY') {
        setRequiresPasswordReset(true);
      }
      if (session) {
        resolveReferralStorage(session);
        fetchProfile(session.user.id);
        fetchNotificationsCount(session.user.id);
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

  // Realtime Notifications Listener
  useEffect(() => {
      if (!session) return;
      const notifChannel = supabase.channel('global_notifications')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => {
            // Re-fetch count on any notification table change
            supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', session.user.id).eq('is_read', false)
            .then(({ count }) => setUnreadCount(count || 0));
        }).subscribe();

      return () => supabase.removeChannel(notifChannel);
  }, [session]);

  // 3. BACKGROUND PREFETCHING (The Enterprise Secret)
  // Silently downloads the Micro-Frontend modules into RAM 3 seconds after the user logs in.
  // This eliminates the network delay on slow connections while maintaining architectural separation.
  useEffect(() => {
    if (!session) return;
    
    const prefetchTimer = setTimeout(() => {
      console.log("%c[Platform:Shell] Initiating federated module prefetch sequence...", "color: #888;");
      import('@linkup/gibi-news').catch(() => {});
      import('@linkup/heaven-academy').catch(() => {});
      import('@linkup/squad').catch(() => {});
    }, 3000);
    
    return () => clearTimeout(prefetchTimer);
  }, [session]);

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
  
  const Fallback = () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#42d7b8', flexDirection: 'column', gap: '1rem' }}>
      <i className="fas fa-circle-notch fa-spin" style={{ fontSize: '2rem' }}></i>
      <div style={{ fontFamily: 'Roboto Mono, monospace', fontSize: '0.9rem', letterSpacing: '2px' }}>LOADING MODULE</div>
    </div>
  );

  const renderContent = () => {
    return (
      <>
        <div style={{ display: activeTab === 'home' ? 'flex' : 'none', height: '100%', width: '100%', flexDirection: 'column' }}>
          <Suspense fallback={<Fallback />}><Home /></Suspense>
        </div>
        <div style={{ display: activeTab === 'discover' ? 'flex' : 'none', height: '100%', width: '100%', flexDirection: 'column' }}>
          <Suspense fallback={<Fallback />}><Discover /></Suspense>
        </div>
        <div style={{ display: activeTab === 'study' ? 'flex' : 'none', height: '100%', width: '100%', flexDirection: 'column' }}>
          <Suspense fallback={<Fallback />}><Study /></Suspense>
        </div>
        <div style={{ display: activeTab === 'connect' ? 'flex' : 'none', height: '100%', width: '100%', flexDirection: 'column' }}>
          <Suspense fallback={<Fallback />}><Connect /></Suspense>
        </div>
        <div style={{ display: activeTab === 'profile' ? 'flex' : 'none', height: '100%', width: '100%', flexDirection: 'column' }}>
          <Suspense fallback={<Fallback />}><Profile /></Suspense>
        </div>
      </>
    );
  };

  // The Minimalist Auth Gate Loader
  if (isCheckingAuth || (session && !isProfileLoaded)) {
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-dark)', color: 'var(--accent-teal)', flexDirection: 'column', gap: '1rem' }}>
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
  if (!userProfile || !userProfile.username) {
    return <OnboardingGate userProfile={userProfile} sessionUser={session?.user} onComplete={(newUsername, newFullName, newAvatarUrl) => {
      setUserProfile({ id: session?.user?.id, ...userProfile, username: newUsername, full_name: newFullName, avatar_url: newAvatarUrl });
    }} />;
  }

  return (
    <div className="app-container">
      {showOfflineBanner && (
          <div className={`global-offline-banner ${!isOffline ? 'restored' : ''}`}>
              {isOffline ? (
                  <><i className="fas fa-wifi-slash"></i> <span>Offline. Waiting for network...</span></>
              ) : (
                  <><i className="fas fa-wifi" style={{color: '#42d7b8'}}></i> <span style={{color: '#42d7b8'}}>Connection restored.</span></>
              )}
              <button className="close-btn" onClick={() => setShowOfflineBanner(false)}><i className="fas fa-times"></i></button>
          </div>
      )}
      <PlatformProvider value={{ 
          user: userProfile, 
          sessionUser: session?.user, 
          unreadCount,
          routePayload,
          theme,
          toggleTheme,
          clearRoutePayload: () => setRoutePayload(null),
          shell: { 
              openActivity: () => setIsActivityOpen(true), 
              openMiron: (text) => setMironContext({ text }),
              markNotificationsRead: async () => {
                  setUnreadCount(0); // Optimistic UI
                  await supabase.from('notifications').update({ is_read: true }).eq('user_id', session?.user?.id).eq('is_read', false);
              }
          } 
      }}>
      <main 
        className="main-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {renderContent()}
      </main>
      {isActivityOpen && <ActivityHub onClose={() => setIsActivityOpen(false)} />}
                                  {mironContext && (
                      <MironChat 
                        initialContext={mironContext.text} 
                        onClose={() => setMironContext(null)} 
                      />
                  )}

                  {isMironLive && (
                      <MironLiveSession 
                        onClose={() => setIsMironLive(false)} 
                        mironAvatarUrl={mironAvatarUrl} 
                      />
                  )}

                  <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
          </PlatformProvider>
        </div>
      );
};

export default App;
