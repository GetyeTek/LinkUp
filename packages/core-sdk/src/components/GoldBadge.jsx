import React from 'react';
import './GoldBadge.css';

export const GoldBadge = ({ size = 'md' }) => {
    return (
        <span className={`linkup-gold-badge ${size}`} title="LinkUp Gold Member">
            <i className="fa-solid fa-circle-check"></i>
        </span>
    );
};