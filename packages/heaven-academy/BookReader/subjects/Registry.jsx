import React from 'react';
import { resolveStyles, formatText, renderAIExtension } from './utils.jsx';
import { renderLogicBlock } from './Logic/LogicBlocks.jsx';
import { renderCoreBlock } from './Core/CoreBlocks.jsx';

const bulletCharMap = { 'arrow': '➢', 'diamond': '❖', 'check': '✓', 'dot': '•', 'star': '★', 'square': '▪', 'default': '•' };

export const renderBookBlock = (block, idx, actions) => {
    const style = resolveStyles(block);
    const bType = block.type || 'paragraph';

    // 1. Backward compatibility for legacy Logic engine blocks
    if (bType.startsWith('logic-')) {
        return renderLogicBlock(block, idx, actions);
    }

    // 2. Core structural blocks
    if (bType === 'spacer') {
        return <div key={idx} style={{ height: block.height || '20px', flexGrow: block.flex || 0, ...style }} />;
    }

    if (bType === 'paragraph') {
        return <div key={idx} className="univ-p-block" style={style}>{formatText(block.body || block.text)}{renderAIExtension(block, actions)}</div>;
    }

    if (bType === 'header') {
        return <div key={idx} className="univ-h-block" style={style}>{formatText(block.body || block.title || block.text)}{renderAIExtension(block, actions)}</div>;
    }

    if (bType === 'footer') {
        return <div key={idx} className="univ-footer" style={style}>{formatText(block.val || block.page || '')}</div>;
    }

    // 3. Unit & Chapter Headers
    if (bType === 'unit-header' || bType === 'chapter-header' || bType === 'chapter-title') {
        return (
            <div key={idx} className={`anthro-unit-header ${bType} ${block.className || ''}`} style={style}>
                {block.number && <span className="anthro-unit-label">Unit {block.number}</span>}
                {block.title && <span className="anthro-unit-title">{formatText(block.title)}</span>}
                {block.hours && <span className="anthro-unit-hours">Study Hours: {block.hours}</span>}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 4. Outcomes & Learning Objectives
    if (bType === 'unit-outcomes' || bType === 'outcomes' || bType === 'learning-outcomes') {
        return (
            <div key={idx} className={`anthro-outcomes-box ${bType} ${block.className || ''}`} style={style}>
                <span className="anthro-outcomes-title">{formatText(block.title || 'Unit learning outcomes:')}</span>
                <span className="anthro-outcomes-sub">{formatText(block.subtitle || 'Up on the successful completion of this unit, you will be able to:')}</span>
                {block.body && <div>{formatText(block.body)}</div>}
                {block.items && (
                    <div className="anthro-list">
                        {block.items.map((it, i) => (
                            <div key={i} className="anthro-list-item">
                                <div className="anthro-bullet-char">•</div>
                                <div>{formatText(typeof it === 'object' ? it.text : it)}</div>
                            </div>
                        ))}
                    </div>
                )}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 5. Callouts, Reflection & Reading Boxes
    if (bType === 'callout-box' || bType === 'reflection-box' || bType === 'reading-box' || bType === 'reflection' || bType === 'prompt-box' || bType === 'case-box') {
        const defaultTitle = bType.includes('reflection') ? 'Reflect your views on the following questions.' : (bType.includes('reading') ? 'Reading & Discussion' : '');
        const boxClass = bType.includes('reflection') ? 'anthro-reflection-box' : (bType.includes('reading') ? 'anthro-reading-box' : 'anthro-callout');
        const titleClass = bType.includes('reflection') ? 'anthro-reflection-title' : (bType.includes('reading') ? 'anthro-reading-title' : 'anthro-callout-title');
        
        return (
            <div key={idx} className={`${boxClass} ${bType} ${block.className || ''}`} style={style}>
                <div className="anthro-callout-content" style={{ width: '100%' }}>
                    {(block.label || block.title || defaultTitle) && (
                        <span className={titleClass}>{formatText(block.label || block.title || defaultTitle)}</span>
                    )}
                    {block.body && <div>{formatText(block.body)}</div>}
                    {(block.items || block.questions) && (
                        <div className="anthro-list">
                            {(block.items || block.questions).map((it, i) => (
                                <div key={i} className="anthro-list-item">
                                    <div className="anthro-bullet-char">•</div>
                                    <div>{formatText(typeof it === 'object' ? it.text : it)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 6. Bullet & Numbered Lists
    if (bType === 'bullet-list' || bType.endsWith('-bullet-list') || bType === 'anthro-list') {
        const bChar = bulletCharMap[block.bullet] || bulletCharMap['default'];
        return (
            <div key={idx} className={`anthro-list ${bType} ${block.className || ''}`} style={style}>
                {(block.items || []).map((txt, bIdx) => (
                    <div key={bIdx} className="anthro-list-item">
                        <div className="anthro-bullet-char">{bChar}</div>
                        <div>{formatText(typeof txt === 'object' ? txt.text : txt)}</div>
                    </div>
                ))}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 7. Key-Value Rows
    if (bType === 'kv-list' || bType === 'anthro-kv') {
        return (
            <div key={idx} className={`anthro-kv-container ${block.className || ''}`} style={style}>
                {(block.items || []).map((row, rIdx) => (
                    <div key={rIdx} className="anthro-kv-row">
                        <div className="anthro-kv-label">{formatText(row.label)}</div>
                        <div className="anthro-kv-separator">:</div>
                        <div className="anthro-kv-value">{formatText(row.value)}</div>
                    </div>
                ))}
            </div>
        );
    }

    // 8. Tables
    if (bType === 'anthro-table' || bType === 'table' || bType.endsWith('-table')) {
        return (
            <div key={idx} style={{ width: '100%', margin: '15px 0', ...style }}>
                {block.title && <div style={{ fontWeight: 'bold', fontSize: '15px', margin: '12px 0 6px 0', color: '#000' }}>{formatText(block.title)}</div>}
                <table className={`anthro-table univ-table ${block.tableClass || ''}`}>
                    <tbody>
                        {(block.rows || []).map((row, rIdx) => (
                            <tr key={rIdx}>
                                {row.map((cell, cIdx) => {
                                    const isHeader = (rIdx === 0 && block.headerStyle !== false);
                                    const Tag = isHeader ? 'th' : 'td';
                                    const cellContent = typeof cell === 'object' ? cell.text : cell;
                                    const cellStyle = typeof cell === 'object' ? {
                                        backgroundColor: cell.bg || undefined,
                                        color: cell.color || undefined,
                                        textAlign: cell.align || undefined,
                                        fontWeight: cell.bold ? 'bold' : undefined,
                                        fontStyle: cell.italic ? 'italic' : undefined
                                    } : {};
                                    return (
                                        <Tag key={cIdx} colSpan={cell?.colSpan} rowSpan={cell?.rowSpan} style={cellStyle}>
                                            {formatText(cellContent)}
                                        </Tag>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    // 9. TOC & Title Blocks
    if (bType === 'anthro-toc') {
        return (
            <div key={idx} className="anthro-toc-container" style={style}>
                {(block.items || block.entries || []).map((i, tIdx) => (
                    <div key={tIdx} className={`anthro-toc-item anthro-toc-level-${i.level || 0}`}>
                        <span>{formatText(i.text || i.label)}</span>
                        <div className="anthro-toc-dots"></div>
                        <span className="anthro-toc-page">{i.page || ''}</span>
                    </div>
                ))}
            </div>
        );
    }

    if (bType === 'title-block' || bType === 'title-page') {
        return (
            <div key={idx} className="anthro-title-block" style={style}>
                {block.top && <div className="anthro-title-sub">{formatText(block.top)}</div>}
                <div className="anthro-title-main">{formatText(block.main || block.title)}</div>
                {block.bottom && <div className="anthro-title-sub">{formatText(block.bottom)}</div>}
            </div>
        );
    }

    if (bType === 'footnote') {
        return (
            <div key={idx} className="anthro-footnote" style={style}>
                <sup>{block.number || ''}</sup> {formatText(block.body)}
            </div>
        );
    }

    if (bType === 'reference-item') {
        return <div key={idx} className="anthro-reference" style={style}>{formatText(block.body)}</div>;
    }

    if (bType === 'term-header') {
        return <div key={idx} className="anthro-term" style={style}>{formatText(block.body || block.text)}</div>;
    }

    // 10. Universal Polymorphic Fallback for all 195+ subject-specific types
    return (
        <div key={idx} className={`univ-block ${bType} ${block.className || ''}`} style={style}>
            {block.number && <span className="block-number">{block.number}</span>}
            {block.title && <div className="block-title">{formatText(block.title)}</div>}
            {block.label && <span className="block-label">{formatText(block.label)}</span>}
            {block.body && <div className="block-body">{formatText(block.body)}</div>}
            {block.text && <div className="block-text">{formatText(block.text)}</div>}
            {block.items && Array.isArray(block.items) && (
                <ul className="block-items-list">
                    {block.items.map((item, i) => (
                        <li key={i}>{formatText(typeof item === 'object' ? item.text : item)}</li>
                    ))}
                </ul>
            )}
            {renderAIExtension(block, actions)}
        </div>
    );
};