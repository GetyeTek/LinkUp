import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@linkup-platform/sdk-core';
import './VisualNotebookViewer.css';

const VisualNotebookViewer = ({ 
  courseCode, 
  language = 'en', 
  currentPage = 1, 
  onCloseVariant, 
  onSyncTextbookPage 
}) => {
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const styleTagRef = useRef(null);
  const containerRef = useRef(null);

  // 1. Fetch all visual sheets for this course and language, ordered by page number
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadSheets = async () => {
      if (!courseCode) {
        if (isMounted) {
          setSheets([]);
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('course_visual_notebooks')
          .select('id, topic_title, html_body, scoped_css, page_number')
          .eq('course_code', courseCode)
          .eq('language', language)
          .order('page_number', { ascending: true });

        if (error) throw error;

        if (isMounted) {
          setSheets(data || []);
          setLoading(false);
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
  }, [courseCode, language]);

  // 2. Inject combined scoped styles dynamically into head
  useEffect(() => {
    if (sheets.length > 0) {
      const combinedCss = sheets
        .map(s => s.scoped_css)
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

  // 4. Bi-Directional Tracker: Updates the underlying textbook cursor as the student scrolls
  useEffect(() => {
    if (loading || sheets.length === 0 || !containerRef.current || !onSyncTextbookPage) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.getAttribute('data-page-number'), 10);
          if (pageNum) {
            onSyncTextbookPage(pageNum);
          }
        }
      });
    }, {
      root: containerRef.current,
      rootMargin: "-15% 0px -55% 0px",
      threshold: 0.1
    });

    const targets = containerRef.current.querySelectorAll('.v-notebook-sheet');
    targets.forEach(t => observer.observe(t));

    return () => observer.disconnect();
  }, [loading, sheets, onSyncTextbookPage]);

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
      <div className="v-bento-canvas">
        {sheets.map((sheet) => (
          <article 
            key={sheet.id || sheet.page_number}
            className="v-notebook-sheet"
            id={`vn-sheet-page-${sheet.page_number}`}
            data-page-number={sheet.page_number}
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
                __html: DOMPurify.sanitize(sheet.html_body || '', { 
                  USE_PROFILES: { html: true, svg: true, mathMl: true } 
                }) 
              }}
            />
          </article>
        ))}
      </div>
    </div>
  );
};

export default VisualNotebookViewer;