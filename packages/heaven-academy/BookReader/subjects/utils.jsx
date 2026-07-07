import React from 'react';

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
    return <span dangerouslySetInnerHTML={{__html: text.replace(/\^\{(.*?)\}/g, '<sup>$1</sup>').replace(/_\{(.*?)\}/g, '<sub>$1</sub>')}} />;
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