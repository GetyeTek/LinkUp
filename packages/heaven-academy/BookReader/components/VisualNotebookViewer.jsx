import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@linkup-platform/sdk-core';
import './VisualNotebookViewer.css';

// Session-level in-memory cache: key = `${courseCode}_${language}`
const notebookSheetsCache = new Map();

// --- UNIVERSAL IN-FLIGHT THEME NORMALIZERS (AI CHAOS DEFENSE) ---
const normalizeSheetCss = (rawCss) => {
  if (!rawCss) return '';
  return rawCss
    // 1. Sanitize font-family declarations so system-ui never hijacks Windows font-linking
    .replace(
      /font-family\s*:\s*[^;]+;/gi,
      "font-family: 'Noto Sans Ethiopic', 'Poppins', system-ui, -apple-system, sans-serif !important;"
    )
    // 2. Map all daylight pastels to dynamic theme variables (Expanded to catch ALL Hex A-F and RGB 150-255)
    .replace(
      /(background(?:-color)?\s*:\s*)(#(?:[a-fA-F8-9][a-fA-F0-9]{5}|[a-fA-F8-9][a-fA-F0-9]{2})\b|white\b|whitesmoke\b|snow\b|ivory\b|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1[5-9]\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1[5-9]\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1[5-9]\d)[^)]*\)|hsla?\(\s*\d+\s*,\s*(?:\d{1,2}%)\s*,\s*(?:7\d%|8\d%|9\d%|100%)[^)]*\))(?:\s*!important)?/gi,
      '$1var(--vn-card-bg, #1c1c24)'
    )
    // 3. Map light borders to dynamic theme variables
    .replace(
      /(border(?:-color)?\s*:\s*[^;]*?)(#(?:[c-fC-F][a-fA-F0-9]{5}|[c-fC-F][a-fA-F0-9]{2})\b|rgba?\(\s*(?:2[0-5]\d|1[89]\d)\s*,\s*(?:2[0-5]\d|1[89]\d)\s*,\s*(?:2[0-5]\d|1[89]\d)[^)]*\))/gi,
      '$1var(--vn-border, rgba(255, 255, 255, 0.08))'
    )
    // 4. Map hardcoded dark text colors to dynamic theme text variables (Mathematical Spectrum: Hex 0-D, RGB 0-199)
    .replace(
      /(color\s*:\s*)(#(?:[0-9a-dA-D][a-fA-F0-9]{5}|[0-9a-dA-D][a-fA-F0-9]{2})\b|black\b|rgba?\(\s*(?:1?\d{1,2})\s*,\s*(?:1?\d{1,2})\s*,\s*(?:1?\d{1,2})[^)]*\))(?:\s*!important)?/gi,
      '$1var(--vn-text-main, #f1f5f9)'
    );
};

const normalizeSheetHtml = (rawHtml) => {
  if (!rawHtml) return '';
  try {
    const clean = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      ADD_ATTR: ['style', 'class', 'aria-hidden', 'target', 'viewBox', 'fill', 'stroke', 'stroke-width', 'cx', 'cy', 'r', 'd', 'transform']
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${clean}</body>`, 'text/html');

    doc.body.querySelectorAll('*').forEach(el => {
      const style = el.getAttribute('style');
      if (style) {
        let s = style;
        
        // Neutralize all daylight pastels and near-white backgrounds (Expanded to catch ALL Hex A-F and RGB 150-255)
        s = s.replace(
          /(background(?:-color)?\s*:\s*)(#(?:[a-fA-F8-9][a-fA-F0-9]{5}|[a-fA-F8-9][a-fA-F0-9]{2})\b|white\b|whitesmoke\b|snow\b|ivory\b|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1[5-9]\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1[5-9]\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1[5-9]\d)[^)]*\)|hsla?\(\s*\d+\s*,\s*(?:\d{1,2}%)\s*,\s*(?:7\d%|8\d%|9\d%|100%)[^)]*\))(?:\s*!important)?/gi,
          '$1var(--vn-card-bg, #1c1c24)'
        );

        // Neutralize light borders
        s = s.replace(
          /(border(?:-color)?\s*:\s*[^;]*?)(#(?:[c-fC-F][a-fA-F0-9]{5}|[c-fC-F][a-fA-F0-9]{2})\b|rgba?\(\s*(?:2[0-5]\d|1[89]\d)\s*,\s*(?:2[0-5]\d|1[89]\d)\s*,\s*(?:2[0-5]\d|1[89]\d)[^)]*\))/gi,
          '$1var(--vn-border, rgba(255, 255, 255, 0.08))'
        );

        // Invert hardcoded dark text colors intended for white paper (Hex 0-D, RGB 0-199)
        s = s.replace(
          /(color\s*:\s*)(#(?:[0-9a-dA-D][a-fA-F0-9]{5}|[0-9a-dA-D][a-fA-F0-9]{2})\b|black\b|rgba?\(\s*(?:1?\d{1,2})\s*,\s*(?:1?\d{1,2})\s*,\s*(?:1?\d{1,2})[^)]*\))(?:\s*!important)?/gi,
          (match, prefix) => {
            const isHeading = el.tagName.match(/^H[1-6]$/) || 
                              s.includes('font-weight: 700') || 
                              s.includes('font-weight:700') || 
                              s.includes('font-weight: bold') ||
                              el.classList.contains('section-title') ||
                              el.classList.contains('card-heading') ||
                              el.classList.contains('card-title');
            return isHeading 
              ? `${prefix}var(--vn-heading-color, #38bdf8)` 
              : `${prefix}var(--vn-text-main, #f1f5f9)`;
          }
        );

        el.setAttribute('style', s);
      }
    });

    return doc.body.innerHTML;
  } catch (err) {
    console.warn('[VisualNotebook] HTML normalizer error:', err);
    return DOMPurify.sanitize(rawHtml);
  }
};

const VisualNotebookViewer = ({ 
  courseCode, 
  language = 'en', 
  currentPage = 1, 
  onCloseVariant, 
  onSyncTextbookPage,
  zoomScale = 1,
  onSheetsLoaded,
  onActiveSheetChange,
  targetSheetIndex = null
}) => {
  const cacheKey = `${courseCode}_${language}`;

  // Instant hydration from cache (zero spinner flash on remount)
  const [sheets, setSheets] = useState(() => (
    courseCode && notebookSheetsCache.has(cacheKey) ? notebookSheetsCache.get(cacheKey) : []
  ));
  const [loading, setLoading] = useState(() => (
    courseCode ? !notebookSheetsCache.has(cacheKey) : false
  ));
  const styleTagRef = useRef(null);
  const containerRef = useRef(null);

  // 1. Fetch all visual sheets for this course and language, ordered by page number
  useEffect(() => {
    let isMounted = true;

    if (!courseCode) {
      setSheets([]);
      setLoading(false);
      return;
    }

    // Fast-path: Cache hit bypasses Supabase completely
    if (notebookSheetsCache.has(cacheKey)) {
      const cached = notebookSheetsCache.get(cacheKey);
      setSheets(cached);
      setLoading(false);
      onSheetsLoaded?.(cached);
      return;
    }

    setLoading(true);

    const loadSheets = async () => {
      try {
        const { data, error } = await supabase
          .from('course_visual_notebooks')
          .select('id, topic_title, html_body, scoped_css, page_number')
          .eq('course_code', courseCode)
          .eq('language', language)
          .order('page_number', { ascending: true });

        if (error) throw error;

        const resultSheets = (data || []).map(sheet => ({
          ...sheet,
          normalized_html: normalizeSheetHtml(sheet.html_body || '')
        }));
        notebookSheetsCache.set(cacheKey, resultSheets);

        if (isMounted) {
          setSheets(resultSheets);
          setLoading(false);
          onSheetsLoaded?.(resultSheets);
        }
      } catch (err) {
        console.error('[VisualNotebook] Backend fetch error:', err);
        if (isMounted) {
          setSheets([]);
          setLoading(false);
        }
      }
    };

    loadSheets();
    return () => { isMounted = false; };
  }, [courseCode, language, cacheKey]);

  // 2. Inject combined scoped styles dynamically into head (with in-flight color & font sanitization)
  useEffect(() => {
    if (sheets.length > 0) {
      const combinedCss = sheets
        .map(s => s.scoped_css ? normalizeSheetCss(s.scoped_css) : '')
        .filter(Boolean)
        .join('\n\n');

      if (combinedCss) {
        if (!styleTagRef.current) {
          const tag = document.createElement('style');
          tag.id = 'v-notebook-dynamic-style';
          document.head.appendChild(tag);
          styleTagRef.current = tag;
        }
        styleTagRef.current.textContent = combinedCss;
      }
    }

    return () => {
      if (styleTagRef.current) {
        styleTagRef.current.remove();
        styleTagRef.current = null;
      }
    };
  }, [sheets]);

  // 2b. Verbose Diagnostic Typography Auditor
  useEffect(() => {
    if (sheets.length === 0) return;

    const auditTypography = () => {
      console.groupCollapsed(`%c[VisualNotebook:FontAudit] 🔤 Typography & Font-Family Diagnostic (${courseCode} [${language}])`, 'color: #42d7b8; font-weight: bold;');
      
      const isFontLoaded = document.fonts ? document.fonts.check('16px "Noto Sans Ethiopic"') : 'API unsupported';
      console.log(`📡 'Noto Sans Ethiopic' in document.fonts:`, isFontLoaded ? '✅ LOADED' : '❌ NOT LOADED YET');
      
      const rootEl = containerRef.current;
      if (rootEl) {
        const rootFont = window.getComputedStyle(rootEl).fontFamily;
        console.log(`📐 Computed font-family on .v-notebook-root:`, rootFont);
        
        const canvasEl = rootEl.querySelector('.sheet-canvas');
        if (canvasEl) {
          const canvasFont = window.getComputedStyle(canvasEl).fontFamily;
          console.log(`📄 Computed font-family on .sheet-canvas:`, canvasFont);
        }

        const sampleP = rootEl.querySelector('p, h1, h2, h3, .pillar-title, .welcome-card');
        if (sampleP) {
          const sampleFont = window.getComputedStyle(sampleP).fontFamily;
          console.log(`📝 Computed font-family on sample text (${sampleP.tagName.toLowerCase()}):`, sampleFont);
          console.log(`   Sample text preview: "${sampleP.innerText.slice(0, 50)}..."`);
        }
      }

      console.log(`💡 DevTools Tip: To verify the physical font glyph file, inspect any Amharic word in DevTools > Elements > Computed tab, and scroll to the bottom to view 'Rendered Fonts'.`);
      console.groupEnd();
    };

    auditTypography();

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        console.log(`%c[VisualNotebook:FontAudit] 🚀 document.fonts.ready resolved. Re-verifying...`, 'color: #38bdf8;');
        auditTypography();
      });
    }
  }, [sheets, courseCode, language]);

  // 3. Teleport Snapper: Smoothly navigate to the sheet closest to the active textbook page
  const scrollToAnchorSheet = (targetPage, smooth = true) => {
    if (!sheets || sheets.length === 0 || !containerRef.current) return;

    let targetSheet = sheets[0];
    for (const sheet of sheets) {
      if (sheet.page_number <= targetPage) {
        targetSheet = sheet;
      } else {
        break;
      }
    }

    if (targetSheet) {
      const el = containerRef.current.querySelector(`[data-page-number="${targetSheet.page_number}"]`);
      if (el) {
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
        el.classList.add('sheet-landed-glow');
        setTimeout(() => el.classList.remove('sheet-landed-glow'), 2200);
      }
    }
  };

  useEffect(() => {
    if (!loading && sheets.length > 0) {
      const timer = setTimeout(() => {
        scrollToAnchorSheet(currentPage, false);
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [loading, sheets]);

  // Decouple external callbacks from the scroll engine to prevent re-render tearing
  const callbacksRef = useRef({ onActiveSheetChange, onSyncTextbookPage });
  useEffect(() => {
    callbacksRef.current = { onActiveSheetChange, onSyncTextbookPage };
  }, [onActiveSheetChange, onSyncTextbookPage]);

  // 4. Bi-Directional Tracker: High-Frequency Scroll Focal Point Calculator
  useEffect(() => {
    if (loading || sheets.length === 0 || !containerRef.current) return;

    const container = containerRef.current;
    let ticking = false;
    let activeIdxCache = -1;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          // Focal point: 30% down from the top of the scrolling viewport
          const focalY = container.scrollTop + (container.clientHeight * 0.3);
          const sheetEls = container.querySelectorAll('.v-notebook-sheet');
          
          for (let i = 0; i < sheetEls.length; i++) {
            const el = sheetEls[i];
            const elTop = el.offsetTop;
            const elBottom = elTop + el.offsetHeight;
            
            if (focalY >= elTop && focalY < elBottom) {
              const sheetIdx = parseInt(el.getAttribute('data-sheet-index'), 10);
              const pageNum = parseInt(el.getAttribute('data-page-number'), 10);
              
              if (sheetIdx !== activeIdxCache && !isNaN(sheetIdx)) {
                activeIdxCache = sheetIdx;
                if (callbacksRef.current.onActiveSheetChange) {
                    callbacksRef.current.onActiveSheetChange(sheetIdx);
                }
                if (pageNum && callbacksRef.current.onSyncTextbookPage) {
                    callbacksRef.current.onSyncTextbookPage(pageNum);
                }
              }
              break;
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    // Trigger once on mount to establish baseline
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading, sheets]);

  // Handle direct Segmented Scrubber jumps
  useEffect(() => {
    if (targetSheetIndex !== null && targetSheetIndex !== undefined && sheets[targetSheetIndex] && containerRef.current) {
      const el = containerRef.current.querySelector(`[data-sheet-index="${targetSheetIndex}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('sheet-landed-glow');
        setTimeout(() => el.classList.remove('sheet-landed-glow'), 2200);
      }
    }
  }, [targetSheetIndex, sheets]);

  if (loading) {
    return (
      <div className="v-notebook-root" style={{ justifyContent: 'center' }}>
        <i className="fas fa-circle-notch fa-spin fa-2x" style={{ color: 'var(--accent-teal)' }}></i>
      </div>
    );
  }

  if (!sheets || sheets.length === 0) {
    return (
      <div className={`v-notebook-root lang-${language}`} style={{ justifyContent: 'center' }}>
        <div className="v-card" style={{ maxWidth: '440px', textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(66, 215, 184, 0.1)', color: 'var(--accent-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', margin: '0 auto 1rem' }}>
            <i className="fas fa-palette"></i>
          </div>
          <span className="v-tag cyber">{courseCode}</span>
          <h3>{language === 'am' ? 'የእይታ መማሪያ በመዘጋጀት ላይ ነው' : 'Visual Guide in Development'}</h3>
          <p style={{ color: '#aaa', fontSize: '0.88rem', margin: '8px 0 1.5rem 0', lineHeight: 1.5 }}>
            {language === 'am' 
              ? `ለ${courseCode} የተቀናጀ የእይታ እና የማጠቃለያ መማሪያ ገጾች በቅርቡ ይጫናሉ። መደበኛውን መጽሐፍ ማንበብ መቀጠል ይችላሉ።`
              : `Visual summary companions for ${courseCode} are currently in development. You can continue with the standard textbook.`}
          </p>
          <button 
            className="variant-toggle-btn active" 
            onClick={onCloseVariant}
            style={{ margin: '0 auto', padding: '8px 18px', fontSize: '0.85rem' }}
          >
            <i className="fas fa-book-open"></i> {language === 'am' ? 'ወደ መጽሐፉ ተመለስ' : 'Return to Textbook'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`v-notebook-root lang-${language}`} ref={containerRef}>
              <div 
          className="v-bento-canvas"
          style={{ 
            scale: zoomScale !== 1 ? zoomScale : 1,
            transform: zoomScale !== 1 ? `scale(${zoomScale})` : 'none',
            transformOrigin: 'top center',
            transition: 'scale 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
        {sheets.map((sheet, sIdx) => (
          <article 
            key={sheet.id || sheet.page_number}
            className="v-notebook-sheet"
            id={`vn-sheet-page-${sheet.page_number}`}
            data-page-number={sheet.page_number}
            data-sheet-index={sIdx}
          >
            <div className="v-sheet-anchor-bar">
              <span className="anchor-pill">
                <i className="fas fa-bookmark"></i> Textbook Page {sheet.page_number}
              </span>
              {sheet.topic_title && (
                <span className="anchor-title">{sheet.topic_title}</span>
              )}
            </div>

            <div 
              className="v-notebook-content-body"
              dangerouslySetInnerHTML={{ 
                __html: sheet.normalized_html || normalizeSheetHtml(sheet.html_body || '')
              }}
            />
          </article>
        ))}
      </div>
    </div>
  );
};

export default VisualNotebookViewer;