import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from '../api.js';
import { usePinchToZoom } from './hooks/usePinchToZoom.js';
import './BookReader.css';
import { renderBookBlock } from './subjects/Registry.jsx';
import { compileAIContext } from './subjects/utils.jsx';
import BookLoader from '../components/BookLoader.jsx';
import ReportModal from '../components/ReportModal.jsx';
import TableOfContents from './components/TableOfContents.jsx';
import PageQuestionsBlock from './components/PageQuestionsBlock.jsx';
import MiniMironOverlay from './components/MiniMironOverlay.jsx';
import BookReaderUI from './components/BookReaderUI.jsx';
import { usePlatform } from '@linkup-platform/sdk-core';

const BookReader = ({ book, onClose, targetPageNumber, targetBlockIndex, zIndexOverride }) => {
    const [loading, setLoading] = useState(true);
    const [pages, setPages] = useState([]);
    const [isUiVisible, setIsUiVisible] = useState(true);
    const [currentTheme, setCurrentTheme] = useState('dark');
    const [contextMenu, setContextMenu] = useState(null);
    const [mappedQuestions, setMappedQuestions] = useState({});
    const [activeExplanations, setActiveExplanations] = useState({});
    const [layoutReady, setLayoutReady] = useState(false);
    const [reportQuestionId, setReportQuestionId] = useState(null);
    
    // TOC & Scrubber States
    const [tocData, setTocData] = useState([]);
    const [isTocOpen, setIsTocOpen] = useState(false);
    const [isJumpMode, setIsJumpMode] = useState(false);
    const [pageOffset, setPageOffset] = useState(0);
    const [jumpInput, setJumpInput] = useState('');
    const scrubberRef = useRef(null);
    
    const savePosTimer = useRef(null);
    const viewportRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const layerRef = useRef(null);
    const pageCountRef = useRef(null);
    const menuRef = useRef(null);
    const miniFlowRef = useRef(null);

    const { shell } = usePlatform();

    // Mini Miron Local States
    const [miniMironText, setMiniMironText] = useState(null);
    
    const baseCanvasWidth = 794; 
    const currentScale = useRef(1.0);
    const minScale = useRef(1.0);
    const lastDisplayPage = useRef(1);
    const [currentDisplayPage, setCurrentDisplayPage] = useState(1);
    const cachedDocHeight = useRef(0);
    
    // Gestural Engine Refs
    const swipeRef = useRef({ startX: 0, startY: 0 });
    
    const pinchState = usePinchToZoom(viewportRef, scrollContainerRef, layerRef, currentScale, minScale, cachedDocHeight, baseCanvasWidth, setContextMenu);

    // 1. Fetch Pages
    useEffect(() => {
        const fetchPages = async () => {
            try {
                setLoading(true);
                const data = await invokeBookReader({ action: 'get_book_pages', book_id: book.id });
                if (data.pages && data.pages.length > 0) {
                    setPages(data.pages);
                    if (data.toc) setTocData(data.toc);
                    if (data.page_offset) setPageOffset(data.page_offset);
                } else {
                    setPages([{ id: 'mock-1', page_key: 'page-1', content_json: [
                        { type: 'title-page', main: book.title || "Untitled Document", sub: "Rendered via JSON Engine" },
                        { type: 'spacer', height: '100px'},
                        { type: 'paragraph', body: "This document is missing structured JSON data."}
                    ]}]);
                }
                
                // Fetch injected RAG questions for this book
                const qData = await invokeBookReader({ action: 'get_book_mapped_questions', book_id: book.id });
                if (qData.questions) {
                    const grouped = {};
                    qData.questions.forEach(q => {
                        if (!grouped[q.page_key]) grouped[q.page_key] = [];
                        grouped[q.page_key].push(q);
                    });
                    setMappedQuestions(grouped);
                }

            } catch (error) {
                console.error("Error loading JSON pages:", error);
            } finally {
                setLoading(false);
            }
        };
        if (book?.id) fetchPages();
    }, [book?.id]);

    // 2. Initial Setup & Adapting to Screen Size
    useEffect(() => {
        if (!loading && pages.length > 0) {
            requestAnimationFrame(() => {
                if (!layerRef.current || !scrollContainerRef.current) return;
                
                const vw = window.innerWidth;
                const fitScale = (vw - 20) / baseCanvasWidth;
                minScale.current = Math.min(fitScale, 1.0);
                currentScale.current = minScale.current;

                const unscaledH = layerRef.current.offsetHeight;
                cachedDocHeight.current = unscaledH;

                scrollContainerRef.current.style.width = `${baseCanvasWidth * currentScale.current}px`;
                scrollContainerRef.current.style.height = `${unscaledH * currentScale.current}px`;
                layerRef.current.style.transform = `scale(${currentScale.current})`;

                if (viewportRef.current) {
                    if (targetPageNumber === undefined) {
                        const savedPos = localStorage.getItem(`linkup_read_pos_${book.id}`);
                        if (savedPos) {
                            viewportRef.current.scrollTop = parseFloat(savedPos) * currentScale.current;
                        } else {
                            viewportRef.current.scrollTop = 0;
                        }
                    }
                    viewportRef.current.scrollLeft = 0;
                }
                
                // Slight delay ensures the browser paints the scale/scroll changes BEFORE making it visible
                setTimeout(() => setLayoutReady(true), 50);
            });
        }
    }, [loading, pages, targetPageNumber, book.id]);

    // 3. Smart ResizeObserver (Debounced to prevent layout thrashing)
    useEffect(() => {
        if (loading || !layerRef.current || !scrollContainerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const unscaledH = entry.target.offsetHeight;
                // Only update if height changed significantly (e.g. images loaded)
                if (unscaledH > 0 && Math.abs(unscaledH - cachedDocHeight.current) > 50) {
                    cachedDocHeight.current = unscaledH;
                    if (!pinchState.current.isPinching) {
                        scrollContainerRef.current.style.height = `${unscaledH * currentScale.current}px`;
                    }
                }
            }
        });
        ro.observe(layerRef.current);
        return () => ro.disconnect();
    }, [loading]);

    // 4. Position Recovery Debouncer (Native Scroll)
    let scrollTicking = false;
    const handleScroll = () => {
        if (pages.length === 0 || !viewportRef.current) return;
        
        if (!scrollTicking) {
            window.requestAnimationFrame(() => {
                const unscaledY = viewportRef.current.scrollTop / currentScale.current;
                
                clearTimeout(savePosTimer.current);
                savePosTimer.current = setTimeout(() => {
                    localStorage.setItem(`linkup_read_pos_${book.id}`, unscaledY);
                }, 500);

                scrollTicking = false;
            });
            scrollTicking = true;
        }
    };

    // 4b. Dynamic Page Tracking (Intersection Observer)
    useEffect(() => {
        if (loading || pages.length === 0 || !viewportRef.current) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const pageNum = parseInt(entry.target.getAttribute('data-page-number'));
                    if (pageNum && lastDisplayPage.current !== pageNum) {
                        lastDisplayPage.current = pageNum;
                        setCurrentDisplayPage(pageNum); // State update for Virtualization
                        
                        if (pageCountRef.current && !isJumpMode) {
                            pageCountRef.current.innerText = pageNum;
                        }
                        
                        if (scrubberRef.current) {
                            scrubberRef.current.value = pageNum;
                            const percent = pages.length > 1 ? ((pageNum - 1) / (pages.length - 1)) * 100 : 0;
                            scrubberRef.current.style.setProperty('--scrubber-fill', `${percent}%`);
                        }
                    }
                }
            });
        }, {
            root: viewportRef.current,
            rootMargin: "-15% 0px -45% 0px", // Trigger when the top of the page enters focal view
            threshold: 0.1
        });

        const targets = viewportRef.current.querySelectorAll('.page-wrapper');
        targets.forEach(t => observer.observe(t));

        return () => observer.disconnect();
    }, [loading, pages, isJumpMode]);

    // Jump Math & Scrubber Handlers
    const jumpToPage = (pageNum) => {
        if (!viewportRef.current || pages.length === 0) return;
        const target = Math.max(1, Math.min(parseInt(pageNum) || 1, pages.length));
        
        // Find the exact physical DOM element of the target page
        const pageNode = viewportRef.current.querySelector(`.page-wrapper[data-page-number="${target}"]`);
        
        if (pageNode) {
            // Read the hardware-accurate unscaled Y coordinate, multiply by the viewport scale
            const targetY = pageNode.offsetTop * currentScale.current;
            viewportRef.current.scrollTo({ top: targetY, behavior: 'auto' });
        } else {
            // Failsafe in case the DOM query fails
            const approxPageHeight = 1183;
            const targetY = (target - 1) * approxPageHeight * currentScale.current;
            viewportRef.current.scrollTo({ top: targetY, behavior: 'auto' });
        }
        setIsJumpMode(false);
    };

    const handleGestureStart = (e) => {
        if (e.touches.length === 1) {
            swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
        }
    };
    
    const handleGestureEnd = (e) => {
        if (e.changedTouches.length === 1 && !pinchState.current.isPinching) {
            const diffX = swipeRef.current.startX - e.changedTouches[0].clientX;
            const diffY = swipeRef.current.startY - e.changedTouches[0].clientY;
            
            // Detect horizontal swipe (Threshold: 80px width, mostly flat)
            if (Math.abs(diffX) > 80 && Math.abs(diffX) > Math.abs(diffY) * 2) {
                if (diffX > 0 && currentDisplayPage < pages.length) {
                    jumpToPage(currentDisplayPage + 1); // Swipe Left = Next Page
                } else if (diffX < 0 && currentDisplayPage > 1) {
                    jumpToPage(currentDisplayPage - 1); // Swipe Right = Prev Page
                }
            }
        }
    };

    const handleScrubberChange = (e) => {
        jumpToPage(e.target.value);
    };

    const handleScrubberInput = (e) => {
        // Immediate visual update while dragging (zero latency)
        const val = e.target.value;
        const percent = pages.length > 1 ? ((val - 1) / (pages.length - 1)) * 100 : 0;
        e.target.style.setProperty('--scrubber-fill', `${percent}%`);
        if (pageCountRef.current) pageCountRef.current.innerText = val;
    };

    // 6. Context Menu Logic (Zero-Latency Tracking)
    // 7. Context Menu Logic (500ms Solid Debounce Tracking)
    useEffect(() => {
        let debounceTimer;

        const checkSelection = () => {
            if (pinchState.current.isPinching) return;
            
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) {
                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) return;
                    
                    const menuWidth = 280; 
                    const menuHeight = 140; // Updated to account for the taller, overhauled UI
                    const verticalGap = 65; // High clearance to prevent overlapping OS teardrops/selection handles
                    
                    // Center the menu horizontally over the selection box
                    let x = rect.left + (rect.width / 2) - (menuWidth / 2);
                    let y = rect.top - menuHeight - verticalGap; 
                    
                    // Constrain horizontally to viewport boundaries
                    x = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
                    
                    // SMART VERTICAL COLLISION DETECTOR
                    if (rect.height > window.innerHeight - 150) {
                        // Case A: Page-spanning selection. Center the menu vertically on screen
                        // so it is always reachable and doesn't get pushed into off-screen voids.
                        y = (window.innerHeight - menuHeight) / 2;
                    } else if (y < 60) {
                        // Case B: Selection is too close to the top. Flip menu to render BELOW selection.
                        y = rect.bottom + verticalGap;
                        
                        // Failsafe: If flipping below also pushes it off the bottom of the screen, center it
                        if (y + menuHeight > window.innerHeight - 20) {
                            y = (window.innerHeight - menuHeight) / 2;
                        }
                    }
                    
                    setContextMenu({ x, y, text: selection.toString() });
                } catch(e) {}
            }
        };

        const handleSelectionChange = () => {
            // Instantly hide the menu while dragging.
            // Using a callback ensures we don't trigger unnecessary React re-renders if it's already null.
            setContextMenu(prev => prev !== null ? null : prev);
            
            clearTimeout(debounceTimer);
            
            // 500ms is the sweet spot for mobile. Because OS teardrops swallow touch events, 
            // we must wait exactly half a second of complete stillness to guarantee you stopped dragging.
            debounceTimer = setTimeout(checkSelection, 500);
        };

        const handleScrollOrTouch = (e) => {
            // Do not dismiss if the user is actually tapping the custom context menu itself
            if (e && e.target && e.target.closest && e.target.closest('.reader-ctx-menu')) return;
            setContextMenu(prev => prev !== null ? null : prev);
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('touchstart', handleScrollOrTouch, { passive: true });
        
        const viewport = viewportRef.current;
        if (viewport) {
            viewport.addEventListener('scroll', handleScrollOrTouch, { passive: true });
        }

        return () => { 
            clearTimeout(debounceTimer); 
            document.removeEventListener('selectionchange', handleSelectionChange); 
            document.removeEventListener('touchstart', handleScrollOrTouch);
            if (viewport) {
                viewport.removeEventListener('scroll', handleScrollOrTouch);
            }
        };
    }, []);

    // 8. Zero-Latency Hardware Accelerated Dragging (With Tactile Feedback)
    const handleDragStart = (e) => {
        const isTouch = e.type === 'touchstart';
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        
        if (!menuRef.current) return;

        // Progressive Enhancement: Micro-haptic tick on touch devices
        if (navigator.vibrate) {
            try {
                navigator.vibrate(12); // High-fidelity taptic "tick"
            } catch (err) {}
        }
        
        const rect = menuRef.current.getBoundingClientRect();
        
        const startX = clientX;
        const startY = clientY;
        const startLeft = rect.left;
        const startTop = rect.top;

        const onDragMove = (moveEvt) => {
            const moveTouch = moveEvt.type === 'touchmove';
            const moveX = moveTouch ? moveEvt.touches[0].clientX : moveEvt.clientX;
            const moveY = moveTouch ? moveEvt.touches[0].clientY : moveEvt.clientY;
            
            const dx = moveX - startX;
            const dy = moveY - startY;
            
            if (menuRef.current) {
                // Instantly update layout positions directly in the DOM for maximum speed
                menuRef.current.style.left = `${startLeft + dx}px`;
                menuRef.current.style.top = `${startTop + dy}px`;
            }
            
            if (moveEvt.cancelable) moveEvt.preventDefault();
            moveEvt.stopPropagation();
        };

        const onDragEnd = () => {
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchmove', onDragMove);
            document.removeEventListener('touchend', onDragEnd);
        };

        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
        
        e.stopPropagation();
    };

    const toggleTheme = () => {
        const themes = ['dark', 'sepia', 'light'];
        setCurrentTheme(themes[(themes.indexOf(currentTheme) + 1) % themes.length]);
    };

    const handleMenuAction = (action) => {
        if (!contextMenu) return; // Prevent crashes if selection clears milliseconds before tap
        if (action === 'ask_miron') {
            setMiniMironText(contextMenu.text);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
        }
        if (action === 'copy') {
            navigator.clipboard.writeText(contextMenu.text);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
        }
    };

    const handleAIExplore = (pageIdx, targetIdx) => {
        const combinedText = compileAIContext(pages, pageIdx, targetIdx);
        setMiniMironText(combinedText);
    };

    // Target Scrolling & Highlighting
    useEffect(() => {
        if (!loading && pages.length > 0 && targetPageNumber !== undefined) {
            const timer = setTimeout(() => {
                const targetId = `page-${targetPageNumber}-block-${targetBlockIndex}`;
                const targetEl = document.getElementById(targetId);
                if (targetEl && viewportRef.current) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetEl.classList.add('highlight-block-anim');
                    setTimeout(() => targetEl.classList.remove('highlight-block-anim'), 4000);
                }
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [loading, pages, targetPageNumber, targetBlockIndex]);

    return (
        <div className={`reader-root theme-${currentTheme}`} style={zIndexOverride ? { zIndex: zIndexOverride } : {}}>
            <div 
                id="viewport" 
                ref={viewportRef} 
                onScroll={handleScroll}
                onTouchStart={handleGestureStart}
                onTouchEnd={handleGestureEnd}
                onContextMenu={(e) => e.preventDefault()} /* Kills native right-click/long-press menu on Android/Desktop */
            >
                <div id="scroll-container" ref={scrollContainerRef} style={{ opacity: layoutReady ? 1 : 0, transition: 'opacity 0.3s ease' }}>
                    <div id="book-layer" ref={layerRef}>
                        {pages.map((page, pageIdx) => {
                            // Virtualization: Only render +/- 2 pages from current focus
                            const isVisible = Math.abs(page.page_number - currentDisplayPage) <= 2;
                            if (!isVisible) {
                                return <div key={page.id} className="page-wrapper" data-page-number={page.page_number} style={{ width: '794px', height: '1183px' }}></div>;
                            }
                            return (
                            <div key={page.id} className="page-wrapper" data-page-number={page.page_number}>
                                <div className="page-canvas">
                                    {page.manual_flag && <div className="manual-flag">{page.manual_flag}</div>}
                                    {(page.content_json || []).map((block, idx) => {
                                        const blockActions = {
                                            onAIExplore: () => handleAIExplore(pageIdx, idx)
                                        };
                                        const expKey = `${page.page_key}_${idx}`;
                                        const isFooter = block.type === 'footer' || block.type === 'logic-footer';
                                        return (
                                            <React.Fragment key={idx}>
                                                <div id={`page-${page.page_number}-block-${idx}`} className={`block-target-wrapper ${isFooter ? 'is-footer-wrapper' : ''}`}>
                                                    {renderBookBlock(block, idx, blockActions)}
                                                </div>
                                                {activeExplanations[expKey] && (
                                                    <div className="inline-book-explanation">
                                                        <div className="inline-exp-header">
                                                            <span><i className="fas fa-sparkles"></i> Miron Synthesis</span>
                                                            <button onClick={() => setActiveExplanations(p => ({...p, [expKey]: false}))}>
                                                                <i className="fas fa-times"></i>
                                                            </button>
                                                        </div>
                                                        <div className="inline-exp-body">
                                                            <p>This is where the AI-generated explanation will be wired up. Miron will synthesize the textbook snapshot above to clarify why a certain choice is correct, directly addressing common misconceptions in this topic.</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                                {mappedQuestions[page.page_key] && (
                                    <PageQuestionsBlock 
                                        questions={mappedQuestions[page.page_key]} 
                                        pageNumber={page.page_number}
                                        pageKey={page.page_key}
                                        onExplain={(contentIndex) => {
                                            const key = `${page.page_key}_${contentIndex}`;
                                            setActiveExplanations(prev => ({ ...prev, [key]: true }));
                                            setTimeout(() => {
                                                const el = document.getElementById(`page-${page.page_number}-block-${contentIndex}`);
                                                if (el) {
                                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                    el.classList.add('highlight-block-anim');
                                                    setTimeout(() => el.classList.remove('highlight-block-anim'), 4000);
                                                }
                                            }, 100);
                                        }}
                                        onReport={(qId) => setReportQuestionId(qId)}
                                    />
                                )}
                            </div>
                        )})}
                    </div>
                </div>
                {(!layoutReady) && (
                    <div className="loading-spinner">
                        <BookLoader />
                    </div>
                )}
            </div>

            {/* --- TOC DRAWER --- */}
            <TableOfContents 
                isTocOpen={isTocOpen} 
                setIsTocOpen={setIsTocOpen} 
                tocData={tocData} 
                onNavigate={(tocPage) => {
                    const targetIndex = Math.max(1, tocPage - pageOffset);
                    jumpToPage(targetIndex);
                }} 
            />

            {reportQuestionId && (
                <ReportModal 
                    questionId={reportQuestionId} 
                    source="book" 
                    onClose={() => setReportQuestionId(null)} 
                />
            )}

            {/* --- MINI MIRON OVERLAY --- */}
            {miniMironText && (
                <MiniMironOverlay 
                    textContext={miniMironText} 
                    onClose={() => setMiniMironText(null)} 
                />
            )}

            {contextMenu && (
                <div 
                    className="reader-ctx-menu" 
                    ref={menuRef}
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.stopPropagation()}
                >
                    <div 
                        className="ctx-drag-handle"
                        onMouseDown={handleDragStart}
                        onTouchStart={handleDragStart}
                    >
                        <div className="ctx-drag-bar"></div>
                    </div>
                    <div 
                        className="ctx-primary" 
                        onMouseDown={(e) => { e.preventDefault(); handleMenuAction('ask_miron'); }}
                        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleMenuAction('ask_miron'); }}
                    >
                        <i className="fa-solid fa-wand-magic-sparkles"></i> <span>Ask Miron</span>
                    </div>
                    <div className="ctx-grid" style={{marginTop: '8px'}}>
                        <div 
                            className="ctx-btn" 
                            onMouseDown={(e) => { e.preventDefault(); handleMenuAction('copy'); }}
                            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleMenuAction('copy'); }}
                        >
                            <i className="fa-regular fa-copy"></i><span>Copy</span>
                        </div>
                        <div className="ctx-btn"><i className="fa-solid fa-highlighter"></i><span>Highlight</span></div>
                        <div className="ctx-btn"><i className="fa-solid fa-share-nodes"></i><span>Share</span></div>
                    </div>
                </div>
            )}

            <BookReaderUI 
                book={book}
                isUiVisible={isUiVisible}
                setIsUiVisible={setIsUiVisible}
                toggleTheme={toggleTheme}
                onClose={onClose}
                isTocOpen={isTocOpen}
                setIsTocOpen={setIsTocOpen}
                pages={pages}
                scrubberRef={scrubberRef}
                handleScrubberChange={handleScrubberChange}
                handleScrubberInput={handleScrubberInput}
                isJumpMode={isJumpMode}
                setIsJumpMode={setIsJumpMode}
                jumpInput={jumpInput}
                setJumpInput={setJumpInput}
                jumpToPage={jumpToPage}
                lastDisplayPage={lastDisplayPage}
                pageCountRef={pageCountRef}
            />
        </div>
    );
};

export default BookReader;