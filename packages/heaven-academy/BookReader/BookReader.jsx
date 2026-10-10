import React, { useState, useEffect, useRef } from 'react';
import { invokeBookReader } from '../api.js';
import { usePinchToZoom } from './hooks/usePinchToZoom.js';
import { marked } from 'https://esm.sh/marked';
import DOMPurify from 'dompurify';
import { useTextSelectionMenu } from './hooks/useTextSelectionMenu.js';
import { useDraggable } from './hooks/useDraggable.js';
import './BookReader.css';
import { renderBookBlock } from './subjects/Registry.jsx';
import { compileAIContext, extractTextFromBlock } from './subjects/utils.jsx';
import BookLoader from '../components/BookLoader.jsx';
import ReportModal from '../components/ReportModal.jsx';
import TableOfContents from './components/TableOfContents.jsx';
import PageQuestionsBlock from './components/PageQuestionsBlock.jsx';
import MiniMironOverlay from './components/MiniMironOverlay.jsx';
import BookReaderUI from './components/BookReaderUI.jsx';
import VisualNotebookViewer from './components/VisualNotebookViewer.jsx';
import { usePlatform, telemetry, supabase } from '@linkup-platform/sdk-core';

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

    // Course Variant Modes: 'text' (standard PDF/JSON) | 'visual_en' | 'visual_am'
    const [viewMode, setViewMode] = useState('text');
    const [visualLangs, setVisualLangs] = useState([]);
    
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

    const { shell, t } = usePlatform();

    // Mini Miron Local States
    const [miniMironText, setMiniMironText] = useState(null);
    
    const baseCanvasWidth = 794; 
    const currentScale = useRef(1.0);
    const minScale = useRef(1.0);
    const lastDisplayPage = useRef(targetPageNumber || 1);
    const [currentDisplayPage, setCurrentDisplayPage] = useState(targetPageNumber || 1);
    const cachedDocHeight = useRef(0);
    const [zoomDisplay, setZoomDisplay] = useState(100);

    const applyScale = (newScale) => {
        if (!layerRef.current || !scrollContainerRef.current || !viewportRef.current) return;
        const clamped = Math.max(0.4, Math.min(newScale, 2.5));
        const oldScale = currentScale.current;
        const viewport = viewportRef.current;

        const focusY = (viewport.scrollTop + viewport.clientHeight / 2) / oldScale;
        const focusX = (viewport.scrollLeft + viewport.clientWidth / 2) / oldScale;

        currentScale.current = clamped;
        setZoomDisplay(Math.round(clamped * 100));

        scrollContainerRef.current.style.width = `${baseCanvasWidth * clamped}px`;
        scrollContainerRef.current.style.height = `${cachedDocHeight.current * clamped}px`;
        layerRef.current.style.transform = `scale(${clamped})`;

        viewport.scrollTop = (focusY * clamped) - (viewport.clientHeight / 2);
        viewport.scrollLeft = (focusX * clamped) - (viewport.clientWidth / 2);
    };

    const handleZoomIn = () => applyScale(currentScale.current + 0.15);
    const handleZoomOut = () => applyScale(currentScale.current - 0.15);
    const handleZoomFit = () => {
        if (viewportRef.current) {
            const vw = viewportRef.current.clientWidth;
            const fitScale = (vw - 40) / baseCanvasWidth;
            applyScale(Math.min(fitScale, 1.8));
        }
    };
    const handleZoomReset = () => applyScale(minScale.current);
    
    // Gestural Engine Refs
    const swipeRef = useRef({ startX: 0, startY: 0 });
    
    const pinchState = usePinchToZoom(viewportRef, scrollContainerRef, layerRef, currentScale, minScale, cachedDocHeight, baseCanvasWidth, setContextMenu);

    // Semantic TOC Resolver: Maps current page number to Chapter and Sub-Section titles
    const resolveTocSection = (toc, pageNum) => {
        if (!toc || !Array.isArray(toc) || toc.length === 0 || !pageNum) {
            return { chapterTitle: null, sectionTitle: null };
        }

        let currentChapter = null;
        let currentSection = null;

        const traverse = (nodes, parentChapter = null) => {
            for (const node of nodes) {
                const nodePage = node.page || 0;
                if (nodePage <= pageNum) {
                    if (!parentChapter) {
                        currentChapter = node.title;
                        currentSection = null;
                    } else {
                        currentSection = node.title;
                    }
                    if (node.children && node.children.length > 0) {
                        traverse(node.children, currentChapter || node.title);
                    }
                }
            }
        };

        traverse(toc);
        return { chapterTitle: currentChapter, sectionTitle: currentSection };
    };

    // Telemetry Dwell-Time Tracking & Lifecycle Hook
    useEffect(() => {
        telemetry.switchFeature('books');
        return () => {
            telemetry.flush();
            telemetry.clearBookContext();
            telemetry.restorePreviousFeature();
        };
    }, []);

    // Resynchronize physical textbook position when returning from Visual Notebook
    useEffect(() => {
        if (viewMode === 'text' && layoutReady && currentDisplayPage) {
            requestAnimationFrame(() => {
                jumpToPage(currentDisplayPage);
            });
        }
    }, [viewMode]);

    // Course Progress Telemetry Sync with Dwell Debounce (15s verified dwell threshold)
    useEffect(() => {
        if (!book?.id || pages.length === 0) return;

        // Persist last-read anchor for Home tab quick resume
        try {
            localStorage.setItem('linkup_last_book', JSON.stringify({
                id: book.id,
                title: book.title || 'Course Textbook',
                course_code: book.course_code || '',
                page: currentDisplayPage || 1
            }));
        } catch (e) {}

        const timer = setTimeout(() => {
            const { chapterTitle, sectionTitle } = resolveTocSection(tocData, currentDisplayPage);
            telemetry.setBookContext({
                book_id: book.id,
                course_code: book.course_code || null,
                current_page: currentDisplayPage,
                chapter_title: chapterTitle,
                section_title: sectionTitle,
                total_pages: pages.length
            });
        }, 15000);

        return () => clearTimeout(timer);
    }, [currentDisplayPage, tocData, book?.id, book?.course_code, pages.length]);

    // Probe available visual notebook languages for current course
    useEffect(() => {
        if (!book?.course_code) return;
        supabase
            .from('course_visual_notebooks')
            .select('language')
            .eq('course_code', book.course_code)
            .limit(10)
            .then(({ data, error }) => {
                if (!error && data) {
                    const unique = [...new Set(data.map(d => d.language).filter(Boolean))];
                    setVisualLangs(unique);
                }
            })
            .catch(() => {});
    }, [book?.course_code]);

    // 1. Fetch Pages and Mount Dynamic Custom CSS
    useEffect(() => {
        let styleTag = null;

        const fetchPages = async () => {
            try {
                setLoading(true);
                const data = await invokeBookReader({ action: 'get_book_pages', book_id: book.id });
                
                if (data.custom_css) {
                    const styleId = `dynamic-book-style-${book.id}`;
                    styleTag = document.getElementById(styleId);
                    if (!styleTag) {
                        styleTag = document.createElement('style');
                        styleTag.id = styleId;
                        document.head.appendChild(styleTag);
                    }
                    styleTag.textContent = data.custom_css;
                }

                if (data.pages && data.pages.length > 0) {
                    setPages(data.pages);
                    if (data.toc) setTocData(data.toc);
                    if (data.page_offset) setPageOffset(data.page_offset);

                    // --- ASSET DIAGNOSTIC AUDIT LOG ---
                    console.group(`%c[BookReader:Audit] 📚 Opened: ${book.title || data.title} (${data.course_code || 'No Code'})`, 'color: #42d7b8; font-size: 13px; font-weight: bold;');
                    console.log('Book ID:', book.id);
                    console.log('Custom CSS Present:', !!data.custom_css, `(${data.custom_css?.length || 0} chars)`);
                    console.log('Total Pages Received:', data.pages.length);
                    console.log('Page Offset:', data.page_offset);

                    const assetInventory = [];
                    data.pages.forEach(p => {
                        (p.content_json || []).forEach((b, bIdx) => {
                            const imgUrl = b?.url || b?.src || b?.imageUrl || b?.iconUrl || b?.img;
                            const isFig = b?.type && typeof b.type === 'string' && (b.type.includes('figure') || b.type.includes('graphic') || b.type.includes('image'));
                            if (imgUrl || isFig) {
                                assetInventory.push({
                                    page: p.page_number,
                                    block_idx: bIdx,
                                    type: b.type,
                                    url: imgUrl || 'MISSING_URL_FIELD',
                                    caption: b.caption || b.title || null
                                });
                            }
                        });
                    });

                    console.log(`🖼️ Discovered ${assetInventory.length} image/figure assets:`, assetInventory);
                    console.groupEnd();

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

        return () => {
            const el = document.getElementById(`dynamic-book-style-${book?.id}`);
            if (el) el.remove();
        };
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
                setZoomDisplay(Math.round(minScale.current * 100));

                const unscaledH = layerRef.current.offsetHeight;
                cachedDocHeight.current = unscaledH;

                scrollContainerRef.current.style.width = `${baseCanvasWidth * currentScale.current}px`;
                scrollContainerRef.current.style.height = `${unscaledH * currentScale.current}px`;
                layerRef.current.style.transform = `scale(${currentScale.current})`;

                if (viewportRef.current) {
                    if (targetPageNumber !== undefined) {
                        // Instantly snap to the target page's raw physical layout offset
                        const pageNode = viewportRef.current.querySelector(`.page-wrapper[data-page-number="${targetPageNumber}"]`);
                        if (pageNode) {
                            viewportRef.current.scrollTop = pageNode.offsetTop * currentScale.current;
                        } else {
                            // Failsafe virtual height projection
                            viewportRef.current.scrollTop = (targetPageNumber - 1) * 1183 * currentScale.current;
                        }
                    } else {
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

    // 6. Context Menu Logic (Zero-Latency Tracking & Boundary Mathematics)
    useTextSelectionMenu(viewportRef, pinchState, setContextMenu);

    // 7. Zero-Latency Hardware Accelerated Dragging
    const handleDragStart = useDraggable(menuRef);

    const toggleTheme = () => {
        const themes = ['dark', 'sepia', 'light'];
        setCurrentTheme(themes[(themes.indexOf(currentTheme) + 1) % themes.length]);
    };

    const handleMenuAction = (action) => {
        if (!contextMenu) return; // Prevent crashes if selection clears milliseconds before tap
        if (action === 'ask_miron') {
            const selectedText = contextMenu.text;
            const { chapterTitle, sectionTitle } = resolveTocSection(tocData, currentDisplayPage);
            const bookTitle = book?.title || 'Course Textbook';
            const courseCode = book?.course_code || '';
            const sectionInfo = [chapterTitle, sectionTitle].filter(Boolean).join(' > ');
            
            const currentPageObj = pages.find(p => p.page_number === currentDisplayPage);
            const fullPageText = (currentPageObj?.content_json || [])
                .map(extractTextFromBlock)
                .filter(Boolean)
                .join('\n\n');

            const mironPrompt = `[Textbook Inquiry: ${bookTitle}${courseCode ? ` (${courseCode})` : ''} | Page ${currentDisplayPage}${sectionInfo ? ` | Section: ${sectionInfo}` : ''}]

Highlighted Passage:
"${selectedText}"

${fullPageText ? `Surrounding Page Context:\n"""\n${fullPageText.slice(0, 1800)}\n"""\n\n` : ''}Could you explain this concept in detail? Please break down the formulas, definitions, and reasoning clearly in your conversational tone.`;

            const mironContextPayload = {
                selectedText,
                bookTitle,
                courseCode,
                pageNumber: currentDisplayPage,
                sectionInfo,
                surroundingText: fullPageText ? fullPageText.slice(0, 1800) : '',
                fullPrompt: mironPrompt
            };

            setMiniMironText(mironContextPayload);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
        }
        if (action === 'copy') {
            navigator.clipboard.writeText(contextMenu.text);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
        }
        if (action === 'share') {
            const selectedText = contextMenu.text;
            const quotePayload = {
                action: 'share_book_quote',
                quote: {
                    book_id: book?.id,
                    book_title: book?.title || 'Textbook',
                    course_code: book?.course_code || '',
                    page_number: currentDisplayPage || 1,
                    text: selectedText
                }
            };
            console.log("[SharePipeline:1] Captured quote from book:", quotePayload.quote);
            window.getSelection()?.removeAllRanges();
            setContextMenu(null);
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('navigate-tab', {
                    detail: {
                        tab: 'connect',
                        payload: quotePayload
                    }
                }));
            }, 50);
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
            {viewMode !== 'text' && (
                <VisualNotebookViewer 
                    courseCode={book?.course_code}
                    language={viewMode === 'visual_am' ? 'am' : 'en'}
                    currentPage={currentDisplayPage}
                    onCloseVariant={() => setViewMode('text')}
                    onSyncTextbookPage={(pageNum) => {
                        lastDisplayPage.current = pageNum;
                        setCurrentDisplayPage(pageNum);
                    }}
                />
            )}

            <div 
                id="viewport" 
                ref={viewportRef} 
                onScroll={handleScroll}
                onTouchStart={handleGestureStart}
                onTouchEnd={handleGestureEnd}
                onContextMenu={(e) => {
                    const sel = window.getSelection();
                    const text = sel ? sel.toString().trim() : '';
                    const isInsideCanvas = !!e.target.closest('.page-canvas');
                    if (text.length > 0 && isInsideCanvas) {
                        e.preventDefault();
                        const menuWidth = 280;
                        const menuHeight = 140;
                        let x = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth - 10));
                        let y = Math.max(10, Math.min(e.clientY - menuHeight - 10, window.innerHeight - menuHeight - 10));
                        if (y < 60) y = e.clientY + 15;
                        setContextMenu({ x, y, text });
                    }
                }}
                style={{ display: viewMode === 'text' ? 'block' : 'none' }}
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
                                            bookTitle: book?.title || '',
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
                                                        <div className="inline-exp-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(activeExplanations[expKey] === true ? 'Processing...' : (activeExplanations[expKey] || ''))) }}>
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
                                        onExplain={(contentIndex, explanationText) => {
                                            const key = `${page.page_key}_${contentIndex}`;
                                            setActiveExplanations(prev => ({ ...prev, [key]: explanationText || "No explanation provided for this question." }));
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
                    const targetIndex = Math.max(1, tocPage + pageOffset);
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
                    context={miniMironText} 
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
                        <i className="fa-solid fa-wand-magic-sparkles"></i> <span>{t('ask_miron', 'Ask Miron')}</span>
                    </div>
                    <div className="ctx-grid" style={{marginTop: '8px'}}>
                        <div 
                            className="ctx-btn" 
                            onMouseDown={(e) => { e.preventDefault(); handleMenuAction('copy'); }}
                            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); handleMenuAction('copy'); }}
                        >
                            <i className="fa-regular fa-copy"></i><span>{t('copy', 'Copy')}</span>
                        </div>
                        <div className="ctx-btn"><i className="fa-solid fa-highlighter"></i><span>{t('highlight', 'Highlight')}</span></div>
                        <div 
                            className="ctx-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMenuAction('share'); }}
                        >
                            <i className="fa-solid fa-share-nodes"></i><span>{t('share', 'Share')}</span>
                        </div>
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
                viewMode={viewMode}
                setViewMode={setViewMode}
                currentTheme={currentTheme}
                zoomDisplay={zoomDisplay}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomFit={handleZoomFit}
                onZoomReset={handleZoomReset}
                visualLangs={visualLangs}
            />
        </div>
    );
};

export default BookReader;