import React from 'react';

const GATEWAY_BASE = 'https://linkup-gateway.getyeteklu2.workers.dev';

// One-Tap Cache Purger for Eruda / Dev Console
if (typeof window !== 'undefined') {
    window.purgeBookCache = async () => {
        if ('caches' in window) {
            try {
                const keys = await window.caches.keys();
                await Promise.all(keys.map(k => window.caches.delete(k)));
            } catch (e) {}
        }
        const newEpoch = Date.now().toString();
        localStorage.setItem('linkup_asset_epoch', newEpoch);
        console.log(`%c[LinkUp:Cache] 🧹 All book asset caches purged! Asset epoch set to: ${newEpoch}. Reloading...`, 'color: #42d7b8; font-weight: bold;');
        window.location.reload();
    };
}

export const resolveAssetUrl = (url, bookTitle = '') => {
    if (!url) return '';
    let clean = String(url).trim();
    const epoch = (typeof localStorage !== 'undefined' && localStorage.getItem('linkup_asset_epoch')) || '1';

    // 1. Scrub leaked raw Supabase URLs and repair double-prefix corruption
    if (clean.includes('supabase.co')) {
        clean = clean.replace(/https:\/\/[^/]+\.supabase\.co/gi, GATEWAY_BASE);
        clean = clean.replace(/.*?book-(https:\/\/)/i, '$1');
        return clean.includes('?') ? `${clean}&v=${epoch}` : `${clean}?v=${epoch}`;
    }

    // 2. If already routed through Gateway, return with active cache epoch
    if (clean.startsWith(GATEWAY_BASE)) {
        return clean.includes('?') ? `${clean}&v=${epoch}` : `${clean}?v=${epoch}`;
    }

    // 3. Resolve relative paths using the current book's actual title folder
    const filename = clean.replace(/^(\.\/|\/)?assets\//i, '').replace(/^(\.\/|\/)/, '');
    const cleanBookTitle = (bookTitle || '').replace(/\.pdf$/i, '').trim();
    const folderPart = cleanBookTitle ? `${encodeURIComponent(cleanBookTitle)}.pdf/` : '';
    const base = `${GATEWAY_BASE}/storage/v1/object/public/book-assets/${folderPart}${filename}`;
    return `${base}?v=${epoch}`;
};

export const resolveStyles = (item) => {
    const rawStyle = item.style || {};
    const resolved = { ...rawStyle };

    if (rawStyle.align) {
        resolved.textAlign = rawStyle.align;
        if (rawStyle.align === 'center') {
            resolved.marginLeft = 'auto';
            resolved.marginRight = 'auto';
        } else if (rawStyle.align === 'right') {
            resolved.marginLeft = 'auto';
            resolved.marginRight = '0';
        }
    }

    if (rawStyle.bold) resolved.fontWeight = 'bold';
    if (rawStyle.italic) resolved.fontStyle = 'italic';
    if (rawStyle.underline) resolved.textDecoration = 'underline';
    if (rawStyle.transform) resolved.textTransform = rawStyle.transform;
    if (rawStyle.size) resolved.fontSize = rawStyle.size;

    return resolved;
};

export const formatText = (text) => {
    if (!text) return null;
    let cleaned = String(text)
        .replace(//g, '➢')
        .replace(//g, '✓')
        .replace(//g, '▪')
        .replace(//g, '❖')
        .replace(//g, '•')
        .replace(//g, '☞')
        .replace(//g, '✍')
        .replace(//g, '➔')
        .replace(//g, '★')
        .replace(//g, '☑')
        .replace(/\\Delta/g, 'Δ')
        .replace(/\\alpha/g, 'α')
        .replace(/\\beta/g, 'β')
        .replace(/\\theta/g, 'θ')
        .replace(/\\phi/g, 'ϕ')
        .replace(/\\omega/g, 'ω')
        .replace(/\\Omega/g, 'Ω')
        .replace(/\\nu/g, 'ν')
        .replace(/\\lambda/g, 'λ')
        .replace(/\\mu/g, 'µ')
        .replace(/\\rho/g, 'ρ')
        .replace(/\\sigma/g, 'σ')
        .replace(/\\tau/g, 'τ')
        .replace(/\\epsilon_0|\\varepsilon_0/g, 'ε₀')
        .replace(/\\epsilon|\\varepsilon/g, 'ε')
        .replace(/\\pi/g, 'π')
        .replace(/\\sum/g, '∑')
        .replace(/\\times/g, '×')
        .replace(/\\cdot/g, '·')
        .replace(/\\pm/g, '±')
        .replace(/\\approx/g, '≈')
        .replace(/\\propto/g, '∝')
        .replace(/\\le(q)?/g, '≤')
        .replace(/\\ge(q)?/g, '≥')
        .replace(/\\neq/g, '≠')
        .replace(/\\infty/g, '∞')
        .replace(/\\deg(ree)?/g, '°')
        .replace(/\\partial/g, '∂')
        .replace(/\\to/g, '→')
        .replace(/\\leftrightarrow/g, '↔')
        .replace(/\\Rightarrow/g, '⇒')
        .replace(/\\Pi/g, '∏')
        .replace(/\[iso:\s*([^:]+)\s*:\s*([^:]+)\s*:\s*([^\]]+)\s*\]/g, '<span class="chem-isotope"><span class="iso-sub">$2</span><span class="iso-super">$1</span></span>$3')
        .replace(/\^\{([^{}]+)\}_\{([^{}]+)\}([A-Za-z0-9\(\)]+)/g, '<span class="chem-isotope"><span class="iso-sub">$2</span><span class="iso-super">$1</span></span>$3')
        .replace(/\[vec:\s*([^\]]+)\s*\]/g, '<span class="math-vec"><span class="vec-arrow">→</span><span class="vec-base">$1</span></span>')
        .replace(/\\vec\{([^{}]+)\}/g, '<span class="math-vec"><span class="vec-arrow">→</span><span class="vec-base">$1</span></span>')
        .replace(/\[hat:\s*([^\]]+)\s*\]/g, '<span class="math-hat"><span class="hat-accent">^</span><span class="hat-base">$1</span></span>')
        .replace(/\\hat\{([^{}]+)\}/g, '<span class="math-hat"><span class="hat-accent">^</span><span class="hat-base">$1</span></span>')
        .replace(/\[sqrt:\s*([^\]]+)\s*\]/g, '<span class="math-sqrt"><span class="sqrt-radical">√</span><span class="sqrt-stem">$1</span></span>')
        .replace(/\\sqrt\{([^{}]+)\}/g, '<span class="math-sqrt"><span class="sqrt-radical">√</span><span class="sqrt-stem">$1</span></span>')
        .replace(/\[frac:\s*([^|\]]+)\s*\|\s*([^\]]+)\s*\]/g, '<span class="math-fraction"><span class="numerator">$1</span><span class="denominator">$2</span></span>')
        .replace(/\[cancel:\s*([^\]]+)\s*\]/g, '<span class="chem-cancel">$1</span>')
        .replace(/\[arrow:\s*([^\]]+)\s*\]/g, '<span class="chem-arrow-wrap"><span class="chem-arrow-cond">$1</span><span class="chem-arrow-symbol">⟶</span></span>')
        .replace(/\[arrow\]/g, '<span class="chem-arrow-symbol">⟶</span>')
        .replace(/\[rev-arrow:\s*([^\]]+)\s*\]/g, '<span class="chem-arrow-wrap"><span class="chem-arrow-cond">$1</span><span class="chem-arrow-symbol">⇌</span></span>')
        .replace(/\[rev-arrow\]/g, '<span class="chem-arrow-symbol">⇌</span>')
        .replace(/\^\{(.*?)\}/g, '<sup>$1</sup>')
        .replace(/_\{(.*?)\}/g, '<sub>$1</sub>');

    let prev;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="math-fraction"><span class="numerator">$1</span><span class="denominator">$2</span></span>');
    } while (cleaned !== prev);

    return <span dangerouslySetInnerHTML={{ __html: cleaned }} />;
};

export const renderAIExtension = (b, actions) => {
    if (b.ai_ready) {
        return <button className="ai-btn-inline" onClick={actions?.onAIExplore}>✨ AI Explore</button>;
    }
    return null;
};

export const extractTextFromBlock = (b) => {
    if (!b) return '';
    let text = [];
    if (b.main) text.push(b.main);
    if (b.sub) text.push(b.sub);
    if (b.title) text.push(b.title);
    if (b.body) text.push(b.body);
    if (b.text) text.push(b.text);
    if (b.items && Array.isArray(b.items)) text.push(b.items.join(' '));
    if (b.premises) text.push(b.premises.join(' '));
    if (b.conclusion) text.push(b.conclusion);
    if (b.question) text.push(b.question);
    
    return text.join(' ').replace(/<[^>]+>/g, '').trim(); 
};

export const compileAIContext = (pages, pageIdx, targetIdx) => {
    console.group(`%c[Academy-RAG]%c Context Sync: Page ${pageIdx + 1} | Block ${targetIdx}`, 'color: #42d7b8', 'color: inherit');
    
    const pageContent = pages[pageIdx].content_json || [];
    const collectedBlocks = [];
    let topReached = targetIdx;
    
    collectedBlocks.push(pageContent[targetIdx]);
    
    for (let i = targetIdx - 1; i >= 0; i--) {
        if (pageContent[i].ai_ready) break;
        collectedBlocks.unshift(pageContent[i]);
        topReached = i;
    }
    console.log(`[Climb UP] Reached block index: ${topReached}`);
    
    let bottomReached = targetIdx;
    for (let i = targetIdx + 1; i < pageContent.length; i++) {
        if (pageContent[i].ai_ready) break;
        collectedBlocks.push(pageContent[i]);
        bottomReached = i;
    }
    console.log(`[Climb DOWN] Reached block index: ${bottomReached}`);
    
    let combinedText = collectedBlocks
        .map(extractTextFromBlock)
        .filter(t => t.length > 0)
        .join('\n\n');

    if (topReached === 0 && pageIdx > 0) {
        console.log(`[Boundary Event] Hit top of Page ${pageIdx + 1}. Analyzing Page ${pageIdx}...`);
        const prevPageContent = pages[pageIdx - 1].content_json || [];
        
        let lastRealText = '';
        for (let j = prevPageContent.length - 1; j >= 0; j--) {
            const tempText = extractTextFromBlock(prevPageContent[j]).trim();
            if (tempText) {
                lastRealText = tempText;
                console.log(`[Boundary Data] Found actual text at block ${j} of previous page.`);
                break;
            }
        }

        if (lastRealText) {
            const hasTerminalPunctuation = /[.!?]['"]?$/.test(lastRealText);
            console.log(`[Punctuation Check] String: "...${lastRealText.slice(-15)}"`);
            console.log(`[Punctuation Check] Has terminal punctuation? ${hasTerminalPunctuation}`);
            
            if (!hasTerminalPunctuation) {
                console.log(`[Action] Sentence is fractured! Stitching previous paragraph to current context.`);
                combinedText = lastRealText + ' ' + combinedText;
            } else {
                console.log(`[Action] Sentence is whole. No cross-page stitching required.`);
            }
        } else {
            console.log(`[Boundary Data] Previous page contained no viable text blocks.`);
        }
    }
    
    console.log(`[Final Output] ${combinedText.substring(0, 100)}...`);
    console.groupEnd();
    
    return combinedText;
};