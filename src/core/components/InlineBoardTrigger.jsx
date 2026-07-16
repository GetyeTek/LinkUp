import React, { useState } from 'react';
import { supabase } from '@linkup-platform/sdk-core';

const InlineBoardTrigger = ({ boardId, onOpen }) => {
    const [loading, setLoading] = useState(false);

    const handleOpen = async () => {
        setLoading(true);
        const { data } = await supabase.from('board_drawings').select('payload').eq('id', boardId).single();
        if (data && data.payload) {
            onOpen(data.payload);
        } else {
            console.error("Board asset not found.");
        }
        setLoading(false);
    };

    return (
        <button 
            onClick={handleOpen} 
            disabled={loading}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(66, 215, 184, 0.1)',
                border: '1px solid var(--accent-teal)',
                color: 'var(--accent-teal)',
                padding: '10px 16px',
                borderRadius: '12px',
                fontFamily: 'Poppins, sans-serif',
                fontWeight: '600',
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                marginTop: '10px'
            }}
        >
            {loading ? <i className="fas fa-circle-notch fa-spin"></i> : <i className="fas fa-project-diagram"></i>}
            {loading ? 'Fetching Asset...' : 'View Diagram / Board'}
        </button>
    );
};

export default InlineBoardTrigger;