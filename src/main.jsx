import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './core/App.jsx'
import './index.css'



const rootElement = document.getElementById('root');
if (!rootElement) console.error("FATAL: Could not find #root element!");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)