import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { computeFlowLayout } from '../hooks/useBoardLayout.js';
import './InteractiveBoard.css';

const InteractiveBoard = ({ payload, spokenText = "", activeBoardBlocks = [], onClose }) => {
    const [boardElements, setBoardElements] = useState([]);
    const [boardEdges, setBoardEdges] = useState([]);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [boardScale, setBoardScale] = useState(1);
    const [isInteracting, setIsInteracting] = useState(false);

    const pointers = useRef(new Map());
    const pinchStart = useRef({ dist: 0, scale: 1, cx: 0, cy: 0, panX: 0, panY: 0 });
    const dragStartOffset = useRef({ x: 0, y: 0 });
    const canvasRef = useRef(null);
    const viewportDims = useRef({ w: 400, h: 800 });

    const parseCoord = (val, max) => {
        if (val === undefined || val === null) return max / 2;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (val.includes('%')) return (parseFloat(val) / 100) * max;
            if (val.includes('px')) return parseFloat(val);
            return parseFloat(val);
        }
        return max / 2;
    };

    useEffect(() => {
        if (payload) {
            if (payload.action === 'draw_flow' || payload.action === 'draw') {
                const { elements, edges } = computeFlowLayout(payload);
                setBoardElements(elements);
                setBoardEdges(edges);
            } else {
                setBoardElements(payload.elements || []);
                setBoardEdges([]);
            }
        } else {
            setBoardElements([]);
            setBoardEdges([]);
        }
    }, [payload]);

    useEffect(() => {
        if (boardElements.length === 0 || !canvasRef.current) return;

        const calibrateBoard = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const { width: W, height: H } = canvas.getBoundingClientRect();
            viewportDims.current = { w: W, h: H };

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

            boardElements.forEach(el => {
                const cx = parseCoord(el.x, W);
                const cy = parseCoord(el.y, H);
                let rx = 100, ry = 100;
                if (el.type === 'rectangle' || el.type === 'rect') { rx = 140; ry = 90; }
                else if (el.type === 'text') { rx = 100; ry = 30; }

                minX = Math.min(minX, cx - rx);
                maxX = Math.max(maxX, cx + rx);
                minY = Math.min(minY, cy - ry);
                maxY = Math.max(maxY, cy + ry);
            });

            if (minX === Infinity) { minX = 0; maxX = W; minY = 0; maxY = H; }
            if (maxX - minX < 100) { minX -= 50; maxX += 50; }
            if (maxY - minY < 100) { minY -= 50; maxY += 50; }

            const spanX = maxX - minX;
            const spanY = maxY - minY;

            const scaleX = W / (spanX + 80);
            const scaleY = H / (spanY + 80);
            const idealScale = Math.min(scaleX, scaleY, 1.0);
            const finalScale = Math.max(0.45, idealScale);
            setBoardScale(finalScale);

            const contentCenterX = (minX + maxX) / 2;
            const contentCenterY = (minY + maxY) / 2;

            setPan({
                x: (W / 2) - (contentCenterX * finalScale),
                y: (H / 2) - (contentCenterY * finalScale)
            });
        };

        calibrateBoard();
        const ro = new ResizeObserver(() => calibrateBoard());
        ro.observe(canvasRef.current);

        return () => ro.disconnect();
    }, [boardElements]);

    const handleCanvasPointerDown = (e) => {
        if (e.target.closest('.close-board-btn')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, e);
        setIsInteracting(true);

        if (pointers.current.size === 1) {
            dragStartOffset.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        } else if (pointers.current.size === 2) {
            const pts = Array.from(pointers.current.values());
            const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
            const cx = (pts[0].clientX + pts[1].clientX) / 2;
            const cy = (pts[0].clientY + pts[1].clientY) / 2;
            pinchStart.current = { dist, scale: boardScale, cx, cy, panX: pan.x, panY: pan.y };
        }
    };

    const handleCanvasPointerMove = (e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, e);

        if (pointers.current.size === 1) {
            setPan({
                x: e.clientX - dragStartOffset.current.x,
                y: e.clientY - dragStartOffset.current.y
            });
        } else if (pointers.current.size === 2) {
            const pts = Array.from(pointers.current.values());
            const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
            const ratio = dist / pinchStart.current.dist;
            let newScale = pinchStart.current.scale * ratio;
            newScale = Math.max(0.15, Math.min(newScale, 4.0));

            const { cx, cy, panX, panY, scale: oldScale } = pinchStart.current;
            const viewportX = (cx - panX) / oldScale;
            const viewportY = (cy - panY) / oldScale;
            
            setPan({
                x: cx - viewportX * newScale,
                y: cy - viewportY * newScale
            });
            setBoardScale(newScale);
        }
    };

    const handleCanvasPointerUp = (e) => {
        pointers.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);

        if (pointers.current.size === 1) {
            const remainingPointer = Array.from(pointers.current.values())[0];
            dragStartOffset.current = { x: remainingPointer.clientX - pan.x, y: remainingPointer.clientY - pan.y };
        } else if (pointers.current.size === 0) {
            setIsInteracting(false);
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let wheelTimeout;
        const handleWheel = (e) => {
            if (e.target.closest('.close-board-btn') || e.target.closest('.shape-text-scroller')) return;
            
            e.preventDefault();
            setIsInteracting(true);
            
            setBoardScale(prevScale => {
                const zoomSensitivity = 0.005;
                const delta = -e.deltaY * zoomSensitivity;
                let newScale = prevScale * Math.exp(delta);
                newScale = Math.max(0.15, Math.min(newScale, 4.0));
                
                setPan(prevPan => {
                    const cx = e.clientX;
                    const cy = e.clientY;
                    const viewportX = (cx - prevPan.x) / prevScale;
                    const viewportY = (cy - prevPan.y) / prevScale;
                    return {
                        x: cx - viewportX * newScale,
                        y: cy - viewportY * newScale
                    };
                });
                
                return newScale;
            });

            clearTimeout(wheelTimeout);
            wheelTimeout = setTimeout(() => setIsInteracting(false), 150);
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', handleWheel);
            clearTimeout(wheelTimeout);
        };
    }, []);

    const cleanWord = (word) => {
        if (!word) return "";
        return word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?።፡]/g, "").trim();
    };

    const prevBulletCount = useRef(0);
    const groupsContainerRef = useRef(null);

    const renderBoardBlocks = () => {
        if (!activeBoardBlocks || activeBoardBlocks.length === 0) return null;

        // NEW JSON BULLET STRUCTURE
        if (activeBoardBlocks[0] && typeof activeBoardBlocks[0] === 'object' && !Array.isArray(activeBoardBlocks[0])) {
            const chunks = activeBoardBlocks;
            const lastChunk = chunks[chunks.length - 1];
            let isLastChunkRevealed = false;
            
            if (spokenText) {
                const targetWords = lastChunk.spoken_text.split(/\s+/).map(cleanWord).filter(w => w.length > 4);
                const recentSpoken = spokenText.split(/\s+/).slice(-20).map(cleanWord);
                
                let matchCount = 0;
                for (const tw of targetWords) {
                    if (recentSpoken.includes(tw)) matchCount++;
                }
                
                const threshold = Math.min(2, targetWords.length);
                if (matchCount >= threshold || targetWords.length === 0) {
                    isLastChunkRevealed = true;
                }
            }
            
            const groups = [];
            let currentGroup = null;
            let currentBulletCount = 0;
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const isRevealed = i < chunks.length - 1 || isLastChunkRevealed;
                
                if (!isRevealed) continue;
                
                const inst = chunk.visual_instruction;
                if (inst) {
                    if (inst.action === 'create_group') {
                        currentGroup = {
                            id: `group-${i}`,
                            title: inst.group_title,
                            bullets: inst.bullet_point ? [inst.bullet_point] : []
                        };
                        groups.push(currentGroup);
                        if (inst.bullet_point) currentBulletCount++;
                    } else if (inst.action === 'append_bullet' && currentGroup) {
                        if (inst.bullet_point) {
                            currentGroup.bullets.push(inst.bullet_point);
                            currentBulletCount++;
                        }
                    } else if (inst.action === 'clear') {
                        groups.length = 0;
                        currentGroup = null;
                        currentBulletCount = 0;
                    }
                }
            }

            // Trigger pan side-effect only when bullet count increases
            if (currentBulletCount > prevBulletCount.current) {
                prevBulletCount.current = currentBulletCount;
                setTimeout(() => {
                    if (groupsContainerRef.current) {
                        const contentHeight = groupsContainerRef.current.offsetHeight;
                        const viewportH = viewportDims.current.h;
                        // Set pan so the bottom of the content sits comfortably near the bottom of the viewport
                        const targetY = (viewportH * 0.7) - (contentHeight * boardScale);
                        setPan(p => ({ ...p, y: targetY }));
                    }
                }, 50);
            } else if (currentBulletCount < prevBulletCount.current) {
                prevBulletCount.current = currentBulletCount; // Handle clear
            }
            
            return (
                <div className="board-groups-container" ref={groupsContainerRef}>
                    {groups.map((g) => (
                        <div key={g.id} className="board-group">
                            {g.title && <div className="board-group-title">{g.title}</div>}
                            <ul className="board-group-bullets">
                                {g.bullets.map((b, bIdx) => (
                                    <li key={bIdx} className="board-bullet-item">{b}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            );
        }

        // LEGACY STRING ARRAY PARSING
        const spokenWords = spokenText.split(/\s+/).map(cleanWord).filter(Boolean);
        
        return (
            <div className="dynamic-blackboard-container">
                {activeBoardBlocks.map((spans, bIdx) => {
                    let targetWords = spans.filter(s => s.text.trim()).map(s => cleanWord(s.text));
                    let revealedIndex = -1;
                    let sIdx = 0;
                    
                    for (let tIdx = 0; tIdx < targetWords.length; tIdx++) {
                        const target = targetWords[tIdx];
                        if (!target) {
                            revealedIndex = tIdx; 
                            continue;
                        }
                        let found = false;
                        for (let i = sIdx; i < Math.min(sIdx + 10, spokenWords.length); i++) {
                            if (spokenWords[i] === target || spokenWords[i].includes(target) || target.includes(spokenWords[i])) {
                                found = true;
                                sIdx = i + 1;
                                revealedIndex = tIdx;
                                break;
                            }
                        }
                        if (!found) break;
                    }
                    
                    let spanWordCounter = 0;
                    return (
                        <div key={bIdx} className="dynamic-blackboard-block">
                            {spans.map((span, sIdx) => {
                                const isSpace = !span.text.trim();
                                let isRevealed = false;
                                if (!isSpace) {
                                    isRevealed = spanWordCounter <= revealedIndex;
                                    spanWordCounter++;
                                } else {
                                    isRevealed = spanWordCounter - 1 <= revealedIndex;
                                }
                                
                                let cls = `bb-span ${isRevealed ? 'revealed' : 'ghost'}`;
                                if (isRevealed) {
                                    if (span.styles.u) cls += ' bb-u';
                                    if (span.styles.h) cls += ' bb-h';
                                    if (span.styles.p) cls += ' bb-p';
                                    if (span.styles.b) cls += ' bb-b';
                                    if (span.styles.i) cls += ' bb-i';
                                    if (span.styles.t) cls += ' bb-t';
                                }
                                
                                return <span key={sIdx} className={cls}>{span.text}</span>
                            })}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div 
            className="live-board-canvas"
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            style={{ position: 'absolute', inset: 0, zIndex: 100 }}
        >
            <button className="close-board-btn" onClick={onClose} title="Close Board">
                <i className="fas fa-times"></i>
            </button>
            <div 
                className="live-board-viewport"
                style={{ 
                    transformOrigin: '0 0',
                    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${boardScale})`,
                    transition: isInteracting ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)' 
                }}
            >
                {boardEdges.length > 0 && (
                    <svg style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', overflow: 'visible', zIndex: -1, pointerEvents: 'none' }}>
                        <defs>
                            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto">
                                <polygon points="0 0, 8 3, 0 6" fill="var(--accent-teal)" />
                            </marker>
                            <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                                <feMerge>
                                    <feMergeNode in="coloredBlur"/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                        </defs>
                        {boardEdges.map((edge, idx) => {
                            const fromEl = boardElements.find(e => e.id === edge.from);
                            const toEl = boardElements.find(e => e.id === edge.to);
                            if (!fromEl || !toEl) return null;

                            const W = viewportDims.current.w;
                            const H = viewportDims.current.h;
                            
                            const x1 = typeof fromEl.x === 'number' ? fromEl.x : parseCoord(fromEl.x, W);
                            const y1 = typeof fromEl.y === 'number' ? fromEl.y : parseCoord(fromEl.y, H);
                            const x2 = typeof toEl.x === 'number' ? toEl.x : parseCoord(toEl.x, W);
                            const y2 = typeof toEl.y === 'number' ? toEl.y : parseCoord(toEl.y, H);
                            
                            let pathData = '';
                            if (payload?.layout === 'vertical-tree') {
                                const startOffsetY = ['circle', 'square'].includes(fromEl.type) ? 90 : 60;
                                const endOffsetY = ['circle', 'square'].includes(toEl.type) ? 105 : 75;
                                const startY = y1 + startOffsetY;
                                const endY = y2 - endOffsetY;
                                const offset = Math.abs(endY - startY) / 2;
                                pathData = `M ${x1},${startY} C ${x1},${startY + offset} ${x2},${endY - offset} ${x2},${endY}`;
                            } else if (payload?.layout === 'horizontal-process') {
                                const startOffsetX = ['circle', 'square'].includes(fromEl.type) ? 90 : 110;
                                const endOffsetX = ['circle', 'square'].includes(toEl.type) ? 105 : 125;
                                const startX = x1 + startOffsetX;
                                const endX = x2 - endOffsetX;
                                const offset = Math.abs(endX - startX) / 2;
                                pathData = `M ${startX},${y1} C ${startX + offset},${y1} ${endX - offset},${y2} ${endX},${y2}`;
                            } else if (payload?.layout === 'comparison-split') {
                                const isLeftToRight = x1 <= x2;
                                const startOffsetX = ['circle', 'square'].includes(fromEl.type) ? 90 : 140;
                                const endOffsetX = ['circle', 'square'].includes(toEl.type) ? 105 : 140;
                                const startX = isLeftToRight ? x1 + startOffsetX : x1 - startOffsetX;
                                const endX = isLeftToRight ? x2 - endOffsetX : x2 + endOffsetX;
                                pathData = `M ${startX},${y1} C ${(startX+endX)/2},${y1} ${(startX+endX)/2},${y2} ${endX},${y2}`;
                            } else if (payload?.layout === 'split-list') {
                                const isLeftToRight = x1 <= x2;
                                const startOffsetX = ['circle', 'square'].includes(fromEl.type) ? 90 : 90;
                                const endOffsetX = ['circle', 'square'].includes(toEl.type) ? 105 : 160;
                                const startX = isLeftToRight ? x1 + startOffsetX : x1 - startOffsetX;
                                const endX = isLeftToRight ? x2 - endOffsetX : x2 + endOffsetX;
                                pathData = `M ${startX},${y1} L ${endX},${y2}`;
                            } else {
                                const angle = Math.atan2(y2 - y1, x2 - x1);
                                const r1 = ['circle', 'square'].includes(fromEl.type) ? 90 : 110;
                                const r2 = ['circle', 'square'].includes(toEl.type) ? 105 : 125;
                                const startX = x1 + Math.cos(angle) * r1;
                                const startY = y1 + Math.sin(angle) * r1;
                                const endX = x2 - Math.cos(angle) * r2;
                                const endY = y2 - Math.sin(angle) * r2;
                                pathData = `M ${startX},${startY} Q ${(startX+endX)/2},${(startY+endY)/2 - 50} ${endX},${endY}`;
                            }

                            return (
                                <g key={idx}>
                                    <path 
                                        d={pathData} 
                                        stroke={edge.color || 'var(--accent-teal)'} 
                                        strokeWidth="3" 
                                        strokeDasharray={edge.style === 'dashed' ? '8,8' : 'none'}
                                        fill="none" 
                                        markerEnd={edge.style === 'dashed' ? 'none' : "url(#arrowhead)"} 
                                        filter="url(#neonGlow)"
                                        style={{ opacity: 0.6, animation: 'boardFadeIn 1s ease-out' }}
                                    />
                                    {edge.label && (
                                        <g transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2})`}>
                                            {edge.style === 'dashed' && (
                                                <rect x="-16" y="-12" width="32" height="24" rx="12" fill="var(--bg-dark)" stroke={edge.color || 'var(--accent-teal)'} strokeWidth="2" />
                                            )}
                                            <text 
                                                x="0" 
                                                y={edge.style === 'dashed' ? 4 : -8} 
                                                fill={edge.style === 'dashed' ? (edge.color || 'var(--accent-teal)') : '#aaa'} 
                                                fontSize={edge.style === 'dashed' ? "11" : "13"} 
                                                fontWeight="800"
                                                fontFamily="'Poppins', sans-serif"
                                                textAnchor="middle" 
                                            >
                                                {edge.label}
                                            </text>
                                        </g>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                )}

                {activeBoardBlocks.length > 0 && (
                    <>
                        {renderBoardBlocks()}
                    </>
                )}

                {boardElements.map(el => {
                    const isShape = ['circle', 'rect', 'rectangle', 'square', 'shape', 'image', 'svg'].includes(el.type);
                    const shapeClass = isShape ? `board-shape-${el.type}` : 'board-shape-text';
                    const isSplitListLeft = payload?.layout === 'split-list' && el.side === 'left';
                    const isSplitListRight = payload?.layout === 'split-list' && el.side === 'right';
                    
                    return (
                        <div
                            key={el.id}
                            className={`live-board-element anim-${el.animation || 'fade-in'} ${shapeClass}`}
                            style={{
                                left: typeof el.x === 'number' ? `${el.x}px` : (el.x !== undefined ? el.x : '50%'),
                                top: typeof el.y === 'number' ? `${el.y}px` : (el.y !== undefined ? el.y : '50%'),
                                transform: `translate(-50%, -50%)`,
                                color: el.color || 'var(--text-primary-dark)',
                                fontSize: el.fontSize || '1rem',
                                fontWeight: el.fontWeight || 'normal',
                                fontFamily: el.fontFamily === 'serif' ? '"Newsreader", serif' : '"Poppins", sans-serif',
                                fontStyle: el.fontStyle || 'normal',
                                pointerEvents: 'auto',
                                ...el.customStyles
                            }}
                        >
                            {isShape ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    {isSplitListLeft && el.title && (
                                        <div className="shape-title-outside-above">{el.title}</div>
                                    )}
                                    <div 
                                        className={`shape-container ${el.type} ${isSplitListLeft ? 'is-split-list-left' : ''} ${isSplitListRight ? 'is-split-list-right' : ''}`} 
                                        style={el.shapeStyles}
                                    >
                                        {el.title && !isSplitListLeft && <div className="shape-title-node">{el.title}</div>}
                                        
                                        {el.imageUrl && (
                                            <div className="shape-image-wrapper">
                                                <img 
                                                    src={el.imageUrl} 
                                                    alt={el.title || "Visual Guide"} 
                                                    className="shape-image-node" 
                                                    draggable="false"
                                                    onContextMenu={(e) => e.preventDefault()}
                                                />
                                            </div>
                                        )}

                                        {el.svgCode && (
                                            <div 
                                                className="shape-svg-wrapper"
                                                dangerouslySetInnerHTML={{ 
                                                    __html: DOMPurify.sanitize(el.svgCode, { USE_PROFILES: { svg: true, svgFilters: true } }) 
                                                }}
                                            />
                                        )}

                                        {el.text && (
                                            <div 
                                                className="shape-text-scroller"
                                                onPointerDown={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onTouchStart={(e) => e.stopPropagation()}
                                            >
                                                {el.text}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-element-node">{el.text}</div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default InteractiveBoard;