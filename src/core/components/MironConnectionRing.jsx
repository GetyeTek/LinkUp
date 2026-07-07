import React from 'react';
import './MironConnectionRing.css';

const MironConnectionRing = ({ isConnected }) => (
    <svg className="connection-ring-svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="48" className={`ring-path ${isConnected ? 'connected' : 'connecting'}`} />
    </svg>
);

export default MironConnectionRing;