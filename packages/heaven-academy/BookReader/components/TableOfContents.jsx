import React, { useState, useEffect } from 'react';
import './TableOfContents.css';

const buildSheetHierarchy = (bookToc, sheets, activeIdx, onJump) => {
    if (!sheets || sheets.length === 0) return [];

    if (!bookToc || !Array.isArray(bookToc) || bookToc.length === 0) {
        return sheets.map((s, idx) => ({
            title: s.topic_title || `Sheet ${idx + 1}`,
            badge: `p. ${s.page_number}`,
            isCurrent: idx === activeIdx,
            onSelect: () => onJump(idx)
        }));
    }

    const chapters = bookToc.map((node, i) => {
        const next = bookToc[i + 1];
        return {
            title: node.title,
            startPage: node.page || 0,
            endPage: next && next.page ? next.page : Infinity,
            sheets: []
        };
    });

    sheets.forEach((s, idx) => {
        const pageNum = s.page_number || 0;
        let ch = chapters.find(c => pageNum >= c.startPage && pageNum < c.endPage);
        if (!ch) {
            if (pageNum < chapters[0].startPage) ch = chapters[0];
            else ch = chapters[chapters.length - 1];
        }
        if (ch) {
            ch.sheets.push({
                title: s.topic_title || `Sheet ${idx + 1}`,
                badge: `p. ${s.page_number}`,
                sheetIndex: idx,
                isCurrent: idx === activeIdx,
                onSelect: () => onJump(idx)
            });
        }
    });

    const activeChapters = chapters.filter(c => c.sheets.length > 0);

    return activeChapters.map(c => {
        const hasCurrent = c.sheets.some(s => s.isCurrent);
        return {
            title: c.title,
            badge: `${c.sheets.length} Sheet${c.sheets.length > 1 ? 's' : ''}`,
            isParent: true,
            defaultExpanded: hasCurrent || activeChapters.length <= 2,
            children: c.sheets
        };
    });
};

const TOCNode = ({ node, depth = 0, onNavigate, closeToc }) => {
    const hasChildren = node.children && node.children.length > 0;
    const [expanded, setExpanded] = useState(node.defaultExpanded || false);

    useEffect(() => {
        if (node.defaultExpanded) setExpanded(true);
    }, [node.defaultExpanded]);
    
    const handleItemClick = (e) => {
        e.stopPropagation();
        if (node.onSelect) {
            node.onSelect();
            closeToc();
        } else if (node.page !== undefined && !hasChildren) {
            onNavigate(node.page);
            closeToc();
        } else if (hasChildren) {
            setExpanded(!expanded);
        }
    };
    
    return (
        <div className="toc-node-wrapper">
            <div 
                className={`toc-item depth-${depth} ${hasChildren ? 'has-children' : ''} ${node.isCurrent ? 'active-sheet-node' : ''}`} 
                onClick={handleItemClick}
                style={{ paddingLeft: `${depth * 15 + 20}px` }}
            >
                <span className="toc-node-title">
                    {node.isCurrent && <i className="fas fa-bookmark" style={{ color: 'var(--accent, #42d7b8)', marginRight: '6px', fontSize: '0.75rem' }}></i>}
                    {node.title}
                </span>
                {(node.badge || node.page) && (
                    <span className={`toc-page-num ${node.isParent ? 'toc-chapter-badge' : ''}`}>
                        {node.badge || node.page}
                    </span>
                )}
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

const TableOfContents = ({ 
    isTocOpen, 
    setIsTocOpen, 
    tocData, 
    isSheetMode = false,
    visualSheets = [],
    activeSheetIndex = 0,
    onJumpToSheet,
    onNavigate 
}) => {
    const displayNodes = isSheetMode
        ? buildSheetHierarchy(tocData, visualSheets, activeSheetIndex, onJumpToSheet)
        : tocData;

    return (
        <>
            {isTocOpen && <div className="toc-backdrop" onClick={() => setIsTocOpen(false)}></div>}
            <div className={`toc-drawer ${isTocOpen ? 'open' : ''}`} onTouchStart={e => e.stopPropagation()}>
                <div className="toc-header">
                    <h3>
                        <i className={`fas ${isSheetMode ? 'fa-layer-group' : 'fa-list'}`} style={isSheetMode ? { color: 'var(--accent-teal, #42d7b8)' } : {}}></i>
                        <span>{isSheetMode ? 'Note Outline' : 'Contents'}</span>
                    </h3>
                    <button className="toc-close-btn" onClick={() => setIsTocOpen(false)} title="Close">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
                <div className="toc-content">
                    {displayNodes && displayNodes.length > 0 ? (
                        displayNodes.map((node, i) => (
                            <TOCNode 
                                key={i} 
                                node={node} 
                                onNavigate={onNavigate} 
                                closeToc={() => setIsTocOpen(false)} 
                            />
                        ))
                    ) : (
                        <div className="toc-empty">
                            {isSheetMode ? 'No note sheets staged for this course.' : 'No Table of Contents available.'}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default TableOfContents;