import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './core/App.jsx'
import './index.css'



// Register Persistent Book Assets Service Worker (Cache-First Offline Guard)
if ('serviceWorker' in navigator && !window.IS_CONDUIT_PREVIEW) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL || '/'}sw.js`;
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL || '/' })
      .then((reg) => {
        console.log('[Platform:SW] Book asset offline cache active. Scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[Platform:SW] Registration failed:', err.message);
      });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) console.error("FATAL: Could not find #root element!");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)