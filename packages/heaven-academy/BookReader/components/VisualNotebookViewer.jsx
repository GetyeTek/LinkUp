import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '@linkup-platform/sdk-core';
import './VisualNotebookViewer.css';

// Flagship General Physics (PHYS 1011) Showcase Payloads
const SHOWCASE_PHYSICS_PAGES = {
  en: {
    title: "Newton's Laws & Momentum Dynamics",
    scoped_css: `
      .physics-glow-card { background: linear-gradient(135deg, rgba(20, 20, 25, 0.95), rgba(10, 15, 20, 0.95)); border-color: rgba(66, 215, 184, 0.3); }
      .physics-formula-pill { font-family: 'Roboto Mono', monospace; font-size: 1.3rem; font-weight: 700; color: #42d7b8; background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 12px; display: inline-block; border: 1px solid rgba(66,215,184,0.3); margin: 8px 0; }
      .law-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin: 16px 0; }
      .law-box { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 14px; border-radius: 14px; }
      .law-box h4 { color: #f1c40f; margin-bottom: 6px; font-size: 0.95rem; }
    `,
    html_body: `
      <div class="v-bento-canvas">
        <div class="v-card physics-glow-card">
          <span class="v-tag cyber"><i class="fas fa-atom"></i> PHYS 1011 • Core Dynamics</span>
          <h2>Newton's Laws of Motion & Momentum</h2>
          <p>Classical mechanics describes the relationship between the forces acting on a body and its motion. The fundamental bridge is linear momentum (\\(\\vec{p} = m\\vec{v}\\)).</p>
          
          <div class="law-grid">
            <div class="law-box">
              <h4>1st Law: Inertia</h4>
              <p>An object remains at rest or in uniform velocity unless acted upon by a net external force: \\(\\Sigma \\vec{F} = 0 \\implies \\Delta\\vec{v} = 0\\).</p>
            </div>
            <div class="law-box">
              <h4>2nd Law: Acceleration</h4>
              <p>The rate of change of momentum is proportional to the net force applied: \\(\\vec{F}_{net} = \\frac{d\\vec{p}}{dt} = m\\vec{a}\\).</p>
            </div>
            <div class="law-box">
              <h4>3rd Law: Action & Reaction</h4>
              <p>Forces always occur in matched pairs: \\(\\vec{F}_{AB} = -\\vec{F}_{BA}\\). They act on <em>different</em> bodies.</p>
            </div>
          </div>

          <div class="v-diagram-box">
            <svg viewBox="0 0 340 160" width="340" height="160">
              <!-- Ground & Incline -->
              <line x1="20" y1="140" x2="320" y2="140" stroke="#555" stroke-width="2" />
              <polygon points="50,140 270,140 270,60" fill="rgba(255,255,255,0.05)" stroke="#666" stroke-width="1.5" />
              
              <!-- Block on slope -->
              <g transform="translate(160, 95) rotate(-22)">
                <rect x="-24" y="-24" width="48" height="48" rx="4" fill="#1e1e24" stroke="#42d7b8" stroke-width="2" />
                <!-- Force vectors -->
                <!-- Normal Force -->
                <line x1="0" y1="0" x2="0" y2="-50" stroke="#42d7b8" stroke-width="2.5" marker-end="url(#arrow)" />
                <text x="8" y="-45" fill="#42d7b8" font-size="11" font-family="monospace">F_N</text>
                
                <!-- Friction -->
                <line x1="0" y1="20" x2="-45" y2="20" stroke="#f1c40f" stroke-width="2.5" />
                <text x="-55" y="15" fill="#f1c40f" font-size="11" font-family="monospace">f_k</text>
              </g>
              <!-- Gravity Vector -->
              <line x1="160" y1="100" x2="160" y2="150" stroke="#ff5f5f" stroke-width="2.5" />
              <text x="170" y="145" fill="#ff5f5f" font-size="11" font-family="monospace">F_g = mg</text>
            </svg>
          </div>

          <div class="v-callout miron-insight">
            <div class="v-callout-icon"><i class="fas fa-sparkles"></i></div>
            <div>
              <strong>Miron's Exam Insight:</strong> Freshman physics exams routinely try to trick students into claiming Action-Reaction pairs cancel each other out. They <em>never cancel</em> because each force acts on a completely separate object!
            </div>
          </div>
        </div>
      </div>
    `
  },
  am: {
    title: "የኒውተን የእንቅስቃሴ ህጎች እና የሞመንተም መርህ",
    scoped_css: `
      .amharic-visual-card { background: linear-gradient(135deg, #181920 0%, #101216 100%); border-color: rgba(241, 196, 15, 0.35); }
      .am-law-item { background: rgba(255, 255, 255, 0.04); border-radius: 14px; padding: 16px; margin: 12px 0; border-left: 3px solid #42d7b8; }
      .am-law-item h4 { color: #f1c40f; margin-bottom: 4px; font-size: 1.1rem; }
    `,
    html_body: `
      <div class="v-bento-canvas">
        <div class="v-card amharic-visual-card">
          <span class="v-tag gold"><i class="fas fa-landmark"></i> ፊዚክስ • ምዕራፍ ፫ ማጠቃለያ</span>
          <h2>የኒውተን የእንቅስቃሴ ህጎች እና ሞመንተም</h2>
          <p>የጥንታዊ መካኒክስ (Classical Mechanics) መሠረት የሆኑት የኒውተን ሦስቱ የእንቅስቃሴ ህጎች ጉልበት (Force) በአካላት እንቅስቃሴ ላይ የሚያሳድረውን ተጽዕኖ በስሌት ያሳያሉ።</p>

          <div class="am-law-item">
            <h4>፩. የመጀመሪያው ህግ (Inertia - ድንዛዜ)</h4>
            <p>አንድ አካል ውጫዊ ጉልበት ካላረፈበት በስተቀር ባለበት ይቆያል፤ ወይም በቀጥታ መስመር በቋሚ ፍጥነት ጉዞውን ይቀጥላል (\\(\\Sigma \\vec{F} = 0\\))።</p>
          </div>

          <div class="am-law-item">
            <h4>፪. ሁለተኛው ህግ (Force & Acceleration)</h4>
            <p>የአንድ አካል የፍጥነት ለውጥ (Acceleration) ከተደረገበት የተጣራ ጉልበት ጋር ቀጥተኛ ተዛምዶ ሲኖረው፣ ከክብደቱ ጋር ደግሞ የተገላቢጦሽ ነው፡ <strong>\\(\\vec{F} = m\\vec{a}\\)</strong>።</p>
          </div>

          <div class="am-law-item">
            <h4>፫. ሦስተኛው ህግ (Action & Reaction)</h4>
            <p>ለማንኛውም ድርጊት ሁሌም እኩል እና ተቃራኒ አቅጣጫ ያለው ምላሽ አለ (\\(\\vec{F}_{AB} = -\\vec{F}_{BA}\\))።</p>
          </div>

          <!-- Cultural Analogy Callout -->
          <div class="v-callout cultural-analogy">
            <div class="v-callout-icon">🇪🇹</div>
            <div>
              <strong>የዕለት ተዕለት ምሳሌ (የአንጦጦ ቁልቁለት)፡</strong> ሙሉ ጭነት የጫነ አይሱዙ መኪና ከአንጦጦ ቁልቁለት ሲወርድ ብሬክ ቢይዝም ወዲያው መቆም የማይችለው በከፍተኛ ሞመንተም (Momentum) እና ድንዛዜ (Inertia) ምክንያት ነው። ባጃጅ ግን ክብደቷ አነስተኛ ስለሆነ በቀላሉ ትቆማለች።
            </div>
          </div>

          <div class="v-callout miron-insight">
            <div class="v-callout-icon"><i class="fas fa-lightbulb"></i></div>
            <div>
              <strong>የፈተና ሚስጥር፡</strong> ድርጊትና ግብረ-መልስ (Action and Reaction) ኃይሎች የሚያርፉት በተለያዩ ሁለት አካላት ላይ እንጂ በአንድ አካል ላይ ስላልሆነ በምንም ተአምር እርስ በእርስ አይሰረዙም (Never cancel each other out)!
            </div>
          </div>
        </div>
      </div>
    `
  }
};

const VisualNotebookViewer = ({ courseCode, language = 'en', currentPage = 1, onCloseVariant }) => {
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const styleTagRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadPage = async () => {
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