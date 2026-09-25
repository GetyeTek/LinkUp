import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@linkup-platform/sdk-core';
import './VisualNotebookViewer.css';

const VisualNotebookViewer = ({ courseCode, language = 'en', currentPage = 1, onCloseVariant }) => {
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const styleTagRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadPage = async () => {
      if (!courseCode) {
        if (isMounted) {
          setPageData(null);
          setLoading(false);
        }
        return;
      }

      try {
        // 1. Nearest-Topic Query: Snap to active chapter/topic based on current textbook page
        let { data, error } = await supabase
          .from('course_visual_notebooks')
          .select('topic_title, html_body, scoped_css, page_number')
          .eq('course_code', courseCode)
          .eq('language', language)
          .lte('page_number', currentPage)
          .order('page_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        // 2. Fallback: If user is on an introductory page before page 1, fetch the earliest guide
        if (!data) {
          const { data: firstTopic } = await supabase
            .from('course_visual_notebooks')
            .select('topic_title, html_body, scoped_css, page_number')
            .eq('course_code', courseCode)
            .eq('language', language)
            .order('page_number', { ascending: true })
            .limit(1)
            .maybeSingle();
          data = firstTopic;
        }

        if (isMounted) {
          setPageData(data || null);
          setLoading(false);
        }
      } catch (err) {
        console.error('[VisualNotebook] Backend fetch error:', err);
        if (isMounted) {
          setPageData(null);
          setLoading(false);
        }
      }
    };

    loadPage();
    return () => { isMounted = false; };
  }, [courseCode, language, currentPage]);
  // Inject dynamic scoped CSS from backend cleanly
  useEffect(() => {
    if (pageData?.scoped_css) {
      if (!styleTagRef.current) {
        const tag = document.createElement('style');
        tag.id = 'v-notebook-dynamic-style';
        document.head.appendChild(tag);
        styleTagRef.current = tag;
      }
      styleTagRef.current.textContent = pageData.scoped_css;
    }

    return () => {
      if (styleTagRef.current) {
        styleTagRef.current.remove();
        styleTagRef.current = null;
      }
    };
  }, [pageData?.scoped_css]);

  if (loading) {
    return (
      <div className="v-notebook-root" style={{ justifyContent: 'center' }}>
        <i className="fas fa-circle-notch fa-spin fa-2x" style={{ color: 'var(--accent-teal)' }}></i>
      </div>
    );
  }

  if (!pageData) {
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
    <div className={`v-notebook-root lang-${language}`}>
      <div 
        className="v-notebook-content-body"
        dangerouslySetInnerHTML={{ 
          __html: DOMPurify.sanitize(pageData.html_body || '', { 
            USE_PROFILES: { html: true, svg: true, mathMl: true } 
          }) 
        }}
      />
    </div>
  );
};

export default VisualNotebookViewer;