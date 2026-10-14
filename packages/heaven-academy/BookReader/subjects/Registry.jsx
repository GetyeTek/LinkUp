import React, { useState } from 'react';
import DOMPurify from 'dompurify';
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

const COURSE_PREFIX_MAP = {
    'ANTH 1012': 'anthro',
    'BIOL 1012': 'biol',
    'CHEM 1012': 'chem',
    'ECON 1011': 'econ',
    'EMTE 1012': 'emte',
    'GEES 1011': 'geog',
    'GLTR 1012': 'glaf',
    'HIST 1012': 'history',
    'INCL 1012': 'snie',
    'MATH 1011': 'math',
    'MATH 1012': 'math',
    'MCIE 1012': 'mced',
    'MGMT 1012': 'entre',
    'PHYS 1011': 'phys',
    'PSYC 1011': 'psych'
};

export const resolveBookPrefix = (courseCode, bookTitle) => {
    if (courseCode && COURSE_PREFIX_MAP[courseCode.toUpperCase().trim()]) {
        return COURSE_PREFIX_MAP[courseCode.toUpperCase().trim()];
    }
    const title = (bookTitle || '').toLowerCase();
    if (title.includes('anthro')) return 'anthro';
    if (title.includes('biol')) return 'biol';
    if (title.includes('chem')) return 'chem';
    if (title.includes('econ')) return 'econ';
    if (title.includes('emerging') || title.includes('emte')) return 'emte';
    if (title.includes('geog')) return 'geog';
    if (title.includes('global') || title.includes('glaf')) return 'glaf';
    if (title.includes('hist')) return 'history';
    if (title.includes('inclus') || title.includes('snie')) return 'snie';
    if (title.includes('math')) return 'math';
    if (title.includes('civic') || title.includes('moral') || title.includes('mced')) return 'mced';
    if (title.includes('entre') || title.includes('mgmt')) return 'entre';
    if (title.includes('phys')) return 'phys';
    if (title.includes('psyc')) return 'psych';
    return '';
};

const DynamicImage = ({ src, alt, className, style, bookTitle, svgCode }) => {
    const [hasError, setHasError] = useState(false);

    if (svgCode) {
        const safeSvg = DOMPurify.sanitize(svgCode, { USE_PROFILES: { svg: true, svgFilters: true } });
        return <div className={className} dangerouslySetInnerHTML={{ __html: safeSvg }} />;
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
    const bType = (typeof block.type === 'string' ? block.type : '') || 'paragraph';
    const bookTitle = actions?.bookTitle || block.bookTitle || '';
    const courseCode = actions?.courseCode || block.course_code || '';
    const prefix = resolveBookPrefix(courseCode, bookTitle);
    const customClass = block.className || '';

    // Dynamic Class Synthesis: Base + Universal + Subject-Specific
    const subjectClass = prefix ? `${prefix}-${bType}` : '';
    const univClass = bType === 'paragraph' ? 'univ-p-block' : (bType === 'header' || bType.includes('head') ? 'univ-h-block' : '');
    const blockClass = `book-block type-${bType} ${univClass} ${subjectClass} ${customClass}`.trim();

    // 0. Universal Unit & Chapter Headers for All Subjects
    const isUnitOrChapter = 
        (bType.includes('unit') && !bType.includes('outcomes') && !bType.includes('summary')) || 
        (bType.includes('chapter') && !bType.includes('outcomes') && !bType.includes('summary')) || 
        bType === 'title-page' ||
        (block.number && (block.title || bType === 'header' || bType.includes('head'))) ||
        (typeof block.body === 'string' && /^(chapter|unit)\s+([0-9]+|[a-z]+)\b/i.test(block.body.trim()));

    if (isUnitOrChapter) {
        const rawNum = String(block.number || block.label || '').trim();
        const isSubSection = /^\d+(\.\d+)+$/.test(rawNum);
        
        let formattedLabel = rawNum;
        if (!isSubSection && rawNum) {
            const hasPrefix = /^(unit|chapter|part|module)\b/i.test(rawNum);
            if (!hasPrefix) {
                // Deduce whether this subject is divided into Units or Chapters
                const usesUnit = ['anthro', 'history', 'snie', 'mced'].includes(prefix) || bType.includes('unit');
                const term = usesUnit ? 'Unit' : 'Chapter';
                formattedLabel = `${term} ${rawNum}`;
            }
        }

        const mainTitle = block.title || (isSubSection ? '' : block.body) || block.main || '';
        const isChapter = bType.includes('chapter');

        return (
            <div 
                key={idx} 
                className={`book-block type-unit-header type-chapter-header chapter-header ${prefix ? (isChapter ? `${prefix}-chapter-header` : `${prefix}-unit-header`) : ''} ${customClass}`} 
                style={style}
            >
                {formattedLabel && (
                    <div className={`book-block-label chapter-number ${prefix ? `${prefix}-unit-label ${prefix}-chapter-num` : ''}`}>
                        {formatText(formattedLabel)}
                    </div>
                )}
                {mainTitle && (
                    <h1 className={`book-block-title chapter-title ${prefix ? `${prefix}-unit-title ${prefix}-chapter-title` : ''}`}>
                        {formatText(mainTitle)}
                    </h1>
                )}
                {block.hours && (
                    <div className={`book-block-hours ${prefix ? `${prefix}-unit-hours` : ''}`}>
                        {formatText(block.hours)}
                    </div>
                )}
                {block.sub && (
                    <div className={`book-block-sub ${prefix ? `${prefix}-unit-sub ${prefix}-sub-header` : ''} ${block.level ? `level-${block.level}` : ''}`}>
                        {formatText(block.sub)}
                    </div>
                )}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 0b. Cover Pages & Sophisticated Title Layouts
    if (bType === 'cover' || bType.includes('-cover')) {
        let coverInner;

        if (prefix === 'math') {
            return (
                <div key={idx} className={`book-cover-container ${prefix}-cover-container ${block.socialTheme ? 'social-theme' : ''} ${customClass}`} style={style}>
                    {block.topTitle && <div className={`${prefix}-cover-top`}>{formatText(block.topTitle)}</div>}
                    <div className={`${prefix}-cover-main`}>
                        {block.title && <h1 className={`${prefix}-cover-title`}>{formatText(block.title)}</h1>}
                        {block.prepared && <div className={`${prefix}-cover-prepared`}>{formatText(block.prepared)}</div>}
                        {block.authors && <div className={`${prefix}-cover-authors`}>{formatText(block.authors)}</div>}
                        {block.moshe && <div className={`${prefix}-cover-moshe`}>{formatText(block.moshe)}</div>}
                    </div>
                    <div className={`${prefix}-cover-grid`}>
                        <div className={`${prefix}-cover-maroon`}></div>
                        <div className={`${prefix}-cover-teal`}></div>
                    </div>
                    {block.bottomTitle && <div className={`${prefix}-cover-bottom`}>{formatText(block.bottomTitle)}</div>}
                    {renderAIExtension(block, actions)}
                </div>
            );
        }

        coverInner = (
            <>
                {block.topTitle && <div className={`${prefix}-cover-top`}>{formatText(block.topTitle)}</div>}
                {block.logos && (
                    <div className={`${prefix}-cover-logos`}>
                        {block.logos.map((l, i) => <DynamicImage key={i} src={l.src} alt="Logo" bookTitle={bookTitle} />)}
                    </div>
                )}
                {block.title && <h1 className={`${prefix}-cover-title`}>{formatText(block.title)}</h1>}
                {block.subtitle && <h2 className={`${prefix}-cover-subtitle`}>{formatText(block.subtitle)}</h2>}
                {block.code && <div className={`${prefix}-cover-code`}>{formatText(block.code)}</div>}
                {block.institution && <div className={`${prefix}-cover-institution`}>{formatText(block.institution)}</div>}

                {prefix === 'mced' && block.authorGrid ? (
                    <table className={`${prefix}-cover-author-grid`}>
                        <tbody>
                            {block.authorGrid.map((r, rI) => (
                                <tr key={rI}>
                                    <td className="author-name">{formatText(r.name)}</td>
                                    <td className="author-title">{formatText(r.title)}</td>
                                    <td className="author-inst">{formatText(r.inst)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : prefix === 'psych' && block.contributorsList ? (
                    <div className={`${prefix}-cover-contributors`}>
                        {block.contributorsList.map((c, cI) => (
                            <div key={cI} className="contributor-item">
                                <span className="contributor-name">{formatText(c.name)}</span>
                                <span className="contributor-detail">{formatText(c.detail)}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    block.authors && <div className={`${prefix}-cover-authors ${prefix}-cover-authors-box`}>
                        {block.authorsTitle && <span className={`${prefix}-cover-authors-title`}>{formatText(block.authorsTitle)}</span>}
                        {Array.isArray(block.authors) ? (
                            <ul className={`${prefix}-cover-authors-list`}>
                                {block.authors.map((a, i) => <li key={i}>{formatText(a)}</li>)}
                            </ul>
                        ) : (
                            formatText(block.authors)
                        )}
                    </div>
                )}

                {block.overview && <div className={`${prefix}-cover-overview`}>{formatText(block.overview)}</div>}
                {block.credits && <div className={`${prefix}-cover-credits`} dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(block.credits)}} />}
                {block.location && <div className={`${prefix}-cover-location`}>{formatText(block.location)}</div>}
                {block.date && <div className={`${prefix}-cover-date`}>{formatText(block.date)}</div>}
                {renderAIExtension(block, actions)}
            </>
        );

        return (
            <div key={idx} className={`book-cover-container ${prefix}-cover-container ${customClass}`} style={style}>
                {prefix === 'history' ? (
                    <div className={`${prefix}-cover-frame`}>
                        <div className={`${prefix}-bolt`} style={{top: -10, left: -10}}></div>
                        <div className={`${prefix}-bolt`} style={{top: -10, right: -10}}></div>
                        <div className={`${prefix}-bolt`} style={{bottom: -10, left: -10}}></div>
                        <div className={`${prefix}-bolt`} style={{bottom: -10, right: -10}}></div>
                        {coverInner}
                    </div>
                ) : coverInner}
            </div>
        );
    }

    // 0c. Bespoke STEM & Analytical Blocks
    if (bType === 'equation-row' || block.equationRow) {
        return (
            <div key={idx} className={`book-equation-row ${prefix ? `${prefix}-equation-row` : ''} ${customClass}`} style={style}>
                <div className={`book-eq-body ${prefix ? `${prefix}-eq-body` : ''}`}>{formatText(block.body || block.text)}</div>
                {block.num && <div className={`book-eq-num ${prefix ? `${prefix}-eq-num` : ''}`}>({block.num})</div>}
            </div>
        );
    }

    if (bType === 'factor-chain' && prefix === 'chem') {
        return (
            <div key={idx} className="chem-factor-chain">
                {block.chain.map((item, i) => (
                    <span key={i} className={item.op ? 'chem-factor-op' : 'chem-factor-term'}>{formatText(item.text || item)}</span>
                ))}
            </div>
        );
    }

    if (bType === 'orbital-diagram' && prefix === 'chem') {
        return (
            <div key={idx} className="chem-orbital-diagram">
                {block.symbol && <div className="chem-orbital-symbol">{formatText(block.symbol)}</div>}
                {block.groups?.map((g, i) => (
                    <div key={i} className="chem-orbital-group">
                        <div className="chem-orbital-boxes">
                            {g.boxes?.map((b, bi) => <div key={bi} className="chem-orbital-box">{formatText(b)}</div>)}
                        </div>
                        {g.label && <div className="chem-orbital-label">{formatText(g.label)}</div>}
                    </div>
                ))}
            </div>
        );
    }

    if (bType === 'ansoff-matrix' && prefix === 'entre') {
        return (
            <div key={idx} className="entre-ansoff-matrix">
                {block.quadrants?.map((q, i) => (
                    <div key={i} className="entre-ansoff-quadrant">
                        <div className="entre-label-axis">{formatText(q.label)}</div>
                        <div>{formatText(q.text)}</div>
                    </div>
                ))}
            </div>
        );
    }

    if (bType === 'form-row' && prefix === 'entre') {
        return (
            <div key={idx} className="entre-form-row">
                <span className="entre-form-label">{formatText(block.label)}</span>
                <span className="entre-form-line"></span>
            </div>
        );
    }

    if (bType === 'trio-portraits' && prefix === 'glaf') {
        return (
            <div key={idx} className="glaf-trio-portraits">
                {block.images?.map((img, i) => (
                    <div key={i} className="glaf-trio-item">
                        <DynamicImage src={img.src} alt={img.caption} bookTitle={bookTitle} />
                        {img.caption && <div>{formatText(img.caption)}</div>}
                    </div>
                ))}
            </div>
        );
    }

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
        const captionText = block.caption || block.title || '';
        return (
            <div key={idx} className={`book-graphic-container univ-graphic-container type-${bType} ${prefix ? `${prefix}-figure ${prefix}-${bType}` : ''} ${customClass}`} style={style}>
                <DynamicImage 
                    src={imgUrl} 
                    svgCode={block.svgCode} 
                    alt={captionText || ""} 
                    className="book-graphic-img" 
                    bookTitle={bookTitle} 
                />
                {captionText && (
                    <div className={`book-graphic-caption univ-graphic-caption ${prefix ? `${prefix}-figure-caption` : ''}`}>
                        {formatText(captionText)}
                    </div>
                )}
                {block.source && (
                    <div className={`book-graphic-source ${prefix ? `${prefix}-source-line` : ''}`}>
                        {formatText(block.source)}
                    </div>
                )}
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 3. Tables Matrix
    if (block.rows && Array.isArray(block.rows)) {
        return (
            <div key={idx} className={`book-table-wrapper type-${bType} ${customClass}`} style={style}>
                {block.title && (
                    <div className={`book-table-title ${prefix ? `${prefix}-table-caption` : ''}`}>
                        {formatText(block.title)}
                    </div>
                )}
                <table className={`book-table univ-table ${prefix ? `${prefix}-table ${prefix}-${bType}` : ''} ${customClass}`}>
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

    // 4. Lists & Iterables (Strict text/Unicode bullets, Callout/Reflection/Outcomes boxes)
    if (block.items && Array.isArray(block.items)) {
        const bChar = bulletCharMap[block.bullet] || bulletCharMap['default'];
        const explicitBulletImg = block.bulletImg || block.bulletUrl || null;
        const explicitIcon = block.iconUrl || block.icon || null;
        const isBox = bType.includes('box') || bType.includes('outcomes') || bType.includes('objective') || bType.includes('review') || bType.includes('callout') || bType.includes('prompt') || bType.includes('summary') || bType.includes('reflection') || bType.includes('activity');
        const baseBType = bType.replace(/-box$/, '');
        const coreBType = baseBType.replace(/^unit-/, '').replace(/^chapter-/, '');
        const boxClass = isBox ? (prefix ? `${prefix}-${bType} ${prefix}-${baseBType}-box ${prefix}-${coreBType}-box book-box-container` : 'book-box-container') : '';
        const titleClass = isBox ? (prefix ? `${prefix}-${bType}-title ${prefix}-${baseBType}-title ${prefix}-${coreBType}-title ${prefix}-${baseBType}-tag ${prefix}-${baseBType}-header ${prefix}-sub-header book-box-title` : 'book-box-title') : 'book-list-title';

        return (
            <div key={idx} className={`book-list-container univ-list-block type-${bType} ${boxClass} ${customClass}`} style={style}>
                {explicitIcon && (
                    <div className={`book-block-icon ${prefix ? `${prefix}-callout-icon` : ''}`}>
                        <DynamicImage src={explicitIcon} alt="" bookTitle={bookTitle} />
                    </div>
                )}
                <div className={`book-block-content ${explicitIcon || isBox ? (prefix ? `${prefix}-${baseBType}-content ${prefix}-${coreBType}-content ${prefix}-callout-content` : 'book-block-content') : ''}`}>
                    {block.title && <div className={titleClass}>{formatText(block.title)}</div>}
                    {block.subtitle && <div className={`book-list-subtitle ${prefix ? `${prefix}-${baseBType}-subtitle ${prefix}-sub-header` : ''}`}>{formatText(block.subtitle)}</div>}
                    {block.items.map((item, bIdx) => {
                        const itemContent = typeof item === 'object' && item !== null ? item.text : item;
                        return (
                            <div key={bIdx} className={`book-list-item ${prefix ? `${prefix}-list-item ${prefix}-bullet-item ${prefix}-arrow-list` : ''}`}>
                                {explicitBulletImg ? (
                                    <DynamicImage src={explicitBulletImg} alt="•" className={`book-bullet-img ${prefix ? `${prefix}-bullet-img` : ''}`} bookTitle={bookTitle} />
                                ) : isBox && !block.bullet ? null : (
                                    <div className={`book-bullet-char ${prefix ? `${prefix}-bullet-char` : ''}`}>{bChar}</div>
                                )}
                                <div className="book-list-text">
                                    {formatText(itemContent)}
                                    {item.subquestions && Array.isArray(item.subquestions) && (
                                        <ol className={`${prefix ? `${prefix}-review-subquestions` : 'review-subquestions'}`}>
                                            {item.subquestions.map((sq, sqIdx) => (
                                                <li key={sqIdx}>{formatText(typeof sq === 'object' && sq !== null ? sq.text : sq)}</li>
                                            ))}
                                        </ol>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {renderAIExtension(block, actions)}
            </div>
        );
    }

    // 5. Key-Value Rows & TOC Dictionaries
    if (bType === 'kv-list' || bType.includes('toc') || (block.entries && Array.isArray(block.entries))) {
        const listItems = block.entries || block.items || [];
        const isToc = bType.includes('toc');
        const containerClass = isToc 
            ? `book-toc-container ${prefix ? `${prefix}-toc-container toc-container` : 'toc-container'}`
            : `book-kv-container ${prefix ? `${prefix}-kv-container` : ''}`;

        return (
            <div key={idx} className={`${containerClass} type-${bType} ${customClass}`} style={style}>
                {listItems.map((row, rIdx) => {
                    if (isToc || row.page !== undefined) {
                        const level = row.level || 0;
                        const levelClass = prefix ? `${prefix}-toc-level-${level} level-${level}` : `level-${level}`;
                        return (
                            <div key={rIdx} className={`book-toc-item ${prefix ? `${prefix}-toc-item toc-entry` : 'toc-entry'} ${levelClass}`}>
                                <span className={`book-toc-text ${prefix ? `${prefix}-toc-text toc-text` : 'toc-text'}`}>{formatText(row.text || row.label || row.title)}</span>
                                <span className={`book-toc-dots ${prefix ? `${prefix}-toc-dots toc-dots` : 'toc-dots'}`}></span>
                                <span className={`book-toc-page ${prefix ? `${prefix}-toc-page toc-page` : 'toc-page'}`}>{row.page}</span>
                            </div>
                        );
                    }
                    return (
                        <div key={rIdx} className={`book-kv-row ${prefix ? `${prefix}-kv-row` : ''}`}>
                            {row.label && <div className={`book-kv-label ${prefix ? `${prefix}-kv-label` : ''}`}>{formatText(row.label)}</div>}
                            {row.label && row.value && <div className={`book-kv-separator ${prefix ? `${prefix}-kv-separator` : ''}`}>:</div>}
                            {row.value && <div className={`book-kv-value ${prefix ? `${prefix}-kv-value` : ''}`}>{formatText(row.value)}</div>}
                            {row.text && <div className="book-kv-text">{formatText(row.text)}</div>}
                        </div>
                    );
                })}
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
            <div key={idx} className={`book-footer univ-footer type-${bType} ${prefix ? `${prefix}-footer` : ''} ${customClass}`} style={style}>
                {block.authors && <span className="footer-authors">{formatText(block.authors)}</span>}
                {block.title && <span className="footer-title">{formatText(block.title)}</span>}
                <span className="footer-page">{formatText(block.val || block.page || '')}</span>
            </div>
        );
    }

    // 8. Universal Polymorphic Element (Handles headings, paragraphs, callouts, notes, quotes)
    const mainText = block.body || block.text || block.main || block.question || null;
    const explicitIcon = block.iconUrl || block.icon || null;
    const isHeading = bType === 'header' || bType === 'sub-header' || bType === 'term-header' || bType.includes('head');
    const isRefOrBib = bType === 'reference' || bType.includes('bib');
    const isFootnote = bType === 'footnote';
    const isTerm = bType.includes('term');
    const isCalloutBox = bType.includes('callout') || bType.includes('box') || bType.includes('reflection') || bType.includes('reading') || bType.includes('review') || bType.includes('outcomes') || bType.includes('objective') || bType.includes('activity');
    const isEquation = bType.includes('equation') || bType === 'formula';
    const baseBType = bType.replace(/-box$/, '');

    const enhancedClass = [
        blockClass,
        isRefOrBib ? (prefix ? `${prefix}-reference ${prefix}-bib-item reference-block` : 'reference-block') : '',
        isFootnote ? (prefix ? `${prefix}-footnote` : '') : '',
        isTerm ? (prefix ? `${prefix}-term` : '') : '',
        isEquation ? (prefix ? `${prefix}-equation-box ${prefix}-formula-box` : '') : '',
        isCalloutBox ? (prefix ? `${prefix}-${baseBType}-box` : '') : '',
        bType.includes('brainstorm') ? (prefix ? `${prefix}-brainstorm-box` : '') : '',
        bType.includes('selftest') ? (prefix ? `${prefix}-selftest-box` : '') : '',
        bType.includes('prompt') ? (prefix ? `${prefix}-prompt-bar ${prefix}-prompt-box` : '') : '',
        bType.includes('summary') ? (prefix ? `${prefix}-summary-box summary-block` : 'summary-block') : ''
    ].filter(Boolean).join(' ');

    const titleClass = [
        'book-block-title',
        isHeading ? (prefix ? `${prefix}-sub-header ${prefix}-unit-title` : '') : '',
        isCalloutBox ? (prefix ? `${prefix}-${bType}-title ${prefix}-${baseBType}-title ${prefix}-${baseBType}-header ${prefix}-callout-title ${prefix}-reflection-title ${prefix}-reading-title` : '') : '',
        bType.includes('activity') ? (prefix ? `${prefix}-activity-tag` : '') : '',
        bType.includes('brainstorm') ? (prefix ? `${prefix}-brainstorm-title` : '') : '',
        bType.includes('selftest') ? (prefix ? `${prefix}-selftest-title` : '') : '',
        bType.includes('summary') ? (prefix ? `${prefix}-summary-title ${prefix}-summary-header summary-label` : 'summary-label') : ''
    ].filter(Boolean).join(' ');

    return (
        <div key={idx} className={enhancedClass} style={style}>
            {explicitIcon && (
                <div className={`book-block-icon ${prefix ? `${prefix}-callout-icon` : ''}`}>
                    <DynamicImage src={explicitIcon} alt="" bookTitle={bookTitle} />
                </div>
            )}
            <div className={`book-block-content ${explicitIcon || isCalloutBox ? (prefix ? `${prefix}-${bType}-content ${prefix}-callout-content` : 'book-block-content') : ''}`}>
                {(block.number || block.label) && (
                    <span className={`book-block-number ${prefix ? `${prefix}-chapter-num ${prefix}-sub-header-num ${prefix}-unit-label` : ''}`}>
                        {formatText(block.number || block.label)}
                    </span>
                )}
                {block.title && (
                    <h3 className={titleClass}>
                        {formatText(block.title)}
                    </h3>
                )}
                {block.sub && <div className={`book-block-sub ${prefix ? `${prefix}-sub-header` : ''} ${block.level ? `level-${block.level}` : ''}`}>{formatText(block.sub)}</div>}
                {block.subtitle && <div className={`book-block-subtitle ${prefix ? `${prefix}-sub-header` : ''} ${block.level ? `level-${block.level}` : ''}`}>{formatText(block.subtitle)}</div>}
                {mainText && (
                    <div className={`book-block-body ${isHeading ? (prefix ? `${prefix}-sub-header` : 'book-block-title') : 'univ-p-block'}`}>
                        {formatText(mainText)}
                    </div>
                )}
                {block.contributors && <div className="book-block-contributors">{formatText(block.contributors)}</div>}
                {renderAIExtension(block, actions)}
            </div>
        </div>
    );
};