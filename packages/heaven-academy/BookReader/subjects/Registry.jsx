import React, { useState } from 'react';
import { resolveStyles, formatText, renderAIExtension, resolveAssetUrl } from './utils.jsx';

const bulletCharMap = {
    'arrow': '➢',
    'diamond': '❖',
    'check': '✓',
    'dot': '•',
    'star': '★',
    'square': '▪',
    'dash': '–',
    'default': '•'
};

const DynamicImage = ({ src, alt, className, style, bookTitle, svgCode }) => {
    const [hasError, setHasError] = useState(false);

    if (svgCode) {
        return <div className={className} dangerouslySetInnerHTML={{ __html: svgCode }} />;
    }

    if (!src || hasError) return null;

    const resolvedUrl = resolveAssetUrl(src, bookTitle);
    if (!resolvedUrl) return null;

    return (
        <img 
            src={resolvedUrl} 
            alt={alt || ""} 
            className={className} 
            decoding="async"
            style={style}
            onError={() => setHasError(true)}
        />
    );
};

export const renderBookBlock = (block, idx, actions) => {
    if (!block) return null;

    const style = resolveStyles(block);
    const bType = block.type || 'paragraph';
    const bookTitle = actions?.bookTitle || block.bookTitle || '';
    const customClass = block.className || '';
    const blockClass = `book-block type-${bType} ${customClass}`.trim();

    // 1. Spacers & Dividers
    if (bType === 'spacer') {
        return <div key={idx} className={blockClass} style={{ height: block.height || '20px', flexGrow: block.flex || 0, ...style }} />;
    }

    if (bType === 'divider' || bType.includes('line') || bType === 'hr') {
        return <hr key={idx} className={`book-divider type-${bType} ${customClass}`} style={style} />;
    }

    // 2. Media, Figures & Graphics (Zero phantom fetches - only runs on real URLs or SVGs)
    if (block.url || block.src || block.imageUrl || block.img || block.svgCode || bType === 'graphic' || bType === 'figure' || bType.includes('image')) {
        const imgUrl = block.url || block.src || block.imageUrl || block.img;
        return (
            <div key={idx} className={`book-graphic-container type-${bType} ${customClass}`} style={style}>
                <DynamicImage 
                    src={imgUrl} 
                    svgCode={block.svgCode} 
                    alt={block.caption || block.title || ""} 
                    className="book-graphic-img" 
                    bookTitle={bookTitle} 
                />
                {block.caption && <div className="book-graphic-caption">{formatText(block.caption)}</div>}
                {block.title && !block.caption && <div className="book-graphic-caption">{formatText(block.title)}</div>}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 3. Tables Matrix
    if (block.rows && Array.isArray(block.rows)) {
        return (
            <div key={idx} className={`book-table-wrapper type-${bType} ${customClass}`} style={style}>
                {block.title && <div className="book-table-title">{formatText(block.title)}</div>}
                <table className="book-table">
                    <tbody>
                        {block.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                                {Array.isArray(row) && row.map((cell, cIdx) => {
                                    const isHeader = (rIdx === 0 && block.headerStyle !== false);
                                    const Tag = isHeader ? 'th' : 'td';
                                    const cellContent = typeof cell === 'object' && cell !== null ? cell.text : cell;
                                    const cellStyle = typeof cell === 'object' && cell !== null ? {
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
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 4. Lists & Iterables (Strict text/Unicode bullets unless explicit image is defined)
    if (block.items && Array.isArray(block.items)) {
        const bChar = bulletCharMap[block.bullet] || bulletCharMap['default'];
        const explicitBulletImg = block.bulletImg || block.bulletUrl || null;

        return (
            <div key={idx} className={`book-list-container type-${bType} ${customClass}`} style={style}>
                {block.title && <div className="book-list-title">{formatText(block.title)}</div>}
                {block.subtitle && <div className="book-list-subtitle">{formatText(block.subtitle)}</div>}
                {block.items.map((item, bIdx) => {
                    const itemContent = typeof item === 'object' && item !== null ? item.text : item;
                    return (
                        <div key={bIdx} className="book-list-item">
                            {explicitBulletImg ? (
                                <DynamicImage src={explicitBulletImg} alt="•" className="book-bullet-img" bookTitle={bookTitle} />
                            ) : (
                                <div className="book-bullet-char">{bChar}</div>
                            )}
                            <div className="book-list-text">{formatText(itemContent)}</div>
                        </div>
                    );
                })}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 5. Key-Value Rows & TOC Dictionaries
    if (bType === 'kv-list' || (block.entries && Array.isArray(block.entries))) {
        const listItems = block.entries || block.items || [];
        return (
            <div key={idx} className={`book-kv-container type-${bType} ${customClass}`} style={style}>
                {listItems.map((row, rIdx) => (
                    <div key={rIdx} className="book-kv-row">
                        {row.label && <div className="book-kv-label">{formatText(row.label)}</div>}
                        {row.label && row.value && <div className="book-kv-separator">:</div>}
                        {row.value && <div className="book-kv-value">{formatText(row.value)}</div>}
                        {row.text && <div className="book-kv-text">{formatText(row.text)}</div>}
                        {row.page !== undefined && <div className="book-kv-page">{row.page}</div>}
                    </div>
                ))}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 6. Logic & Proof Arguments (Premises + Line + Conclusion)
    if (block.premises && Array.isArray(block.premises)) {
        return (
            <div key={idx} className={`book-argument-block type-${bType} ${customClass}`} style={style}>
                {block.premises.map((p, pIdx) => (
                    <div key={pIdx} className="book-argument-premise">{formatText(p)}</div>
                ))}
                <hr className="book-argument-line" />
                {block.conclusion && <div className="book-argument-conclusion">{formatText(block.conclusion)}</div>}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 7. Footers
    if (bType.includes('footer')) {
        return (
            <div key={idx} className={`book-footer type-${bType} ${customClass}`} style={style}>
                {block.authors && <span className="footer-authors">{formatText(block.authors)}</span>}
                {block.title && <span className="footer-title">{formatText(block.title)}</span>}
                <span className="footer-page">{formatText(block.val || block.page || '')}</span>
            </div>
        );
    }

    // 8. Universal Polymorphic Element (Handles all headings, paragraphs, callout boxes, notes, quotes)
    const mainText = block.body || block.text || block.main || block.question || null;
    const explicitIcon = block.iconUrl || block.icon || null;

    return (
        <div key={idx} className={blockClass} style={style}>
            {explicitIcon && (
                <div className="book-block-icon">
                    <DynamicImage src={explicitIcon} alt="" bookTitle={bookTitle} />
                </div>
            )}
            {block.number && <span className="book-block-number">{block.number}</span>}
            {block.label && <span className="book-block-label">{formatText(block.label)}</span>}
            {block.title && <h3 className="book-block-title">{formatText(block.title)}</h3>}
            {block.sub && <div className="book-block-sub">{formatText(block.sub)}</div>}
            {block.subtitle && <div className="book-block-subtitle">{formatText(block.subtitle)}</div>}
            {mainText && <div className="book-block-body">{formatText(mainText)}</div>}
            {block.contributors && <div className="book-block-contributors">{formatText(block.contributors)}</div>}
            {renderAIExtension(block, actions)}
        </div>
    );
};