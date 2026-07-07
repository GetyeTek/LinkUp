import React, { useState } from 'react';
import './TableOfContents.css';

const TOCNode = ({ node, depth = 0, onNavigate, closeToc }) => {
    const [expanded, setExpanded] = useState(false);
    const hasChildren = node.children && node.children.length > 0;
    
    const handleItemClick = (e) => {
        e.stopPropagation();
        if (node.page) {
            onNavigate(node.page);
            closeToc();
        } else if (hasChildren) {
            setExpanded(!expanded);
        }
    };
    
    return (
        <div className="toc-node-wrapper">
            <div 
                className={`toc-item depth-${depth} ${hasChildren ? 'has-children' : ''}`} 
                onClick={handleItemClick}
                style={{ paddingLeft: `${depth * 15 + 20}px` }}
            >
                <span className="toc-node-title">{node.title}</span>
                {node.page && <span className="toc-page-num">{node.page}</span>}
                {hasChildren && (
                    <button className="toc-expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
                        <i className={`fas fa-chevron-${expanded ? 'down' : 'right'}`}></i>
                    </button>
                )}
            </div>
            {hasChildren && expanded && (
                <div className="toc-children-group">
                    {node.children.map((child, i) => (
                        <TOCNode key={i} node={child} depth={depth + 1} onNavigate={onNavigate} closeToc={closeToc} />
                    ))}
                </div>
            )}
        </div>
    );
};

const TableOfContents = ({ isTocOpen, setIsTocOpen, tocData, onNavigate }) => {
    return (
        <>
            {isTocOpen && <div className="toc-backdrop" onClick={() => setIsTocOpen(false)}></div>}
            <div className={`toc-drawer ${isTocOpen ? 'open' : ''}`} onTouchStart={e => e.stopPropagation()}>
                <div className="toc-header">
                    <h3><i className="fas fa-list"></i> Contents</h3>
                    <button className="icon-btn" style={{color: 'inherit'}} onClick={() => setIsTocOpen(false)}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>
                <div className="toc-content">
                    {tocData && tocData.length > 0 ? (
                        tocData.map((node, i) => (
                            <TOCNode 
                                key={i} 
                                node={node} 
                                onNavigate={onNavigate} 
                                closeToc={() => setIsTocOpen(false)} 
                            />
                        ))
                    ) : (
                        <div className="toc-empty">No Table of Contents available.</div>
                    )}
                </div>
            </div>
        </>
    );
};

export default TableOfContents;