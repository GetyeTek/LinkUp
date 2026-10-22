export { supabase } from './supabaseClient.js';
export { PlatformProvider, usePlatform } from './PlatformProvider.jsx';
export { registerComponent, getComponent } from './ComponentRegistry.js';
export { useGeminiAudio } from './hooks/useGeminiAudio.js';
export { useGlobalSwipe } from './hooks/useGlobalSwipe.js';
export { logQuestionAttempt, logBatchQuestionAttempts, evaluateQuestionAnswer } from './tracking.js';
export { telemetry } from './telemetry.js';
export { GoldBadge } from './components/GoldBadge.jsx';
export { default as FullscreenMediaGallery } from './components/FullscreenMediaGallery.jsx';
export * from './deviceSession.js';
import translations from './translations.json';
export { translations };
export const MIRON_AVATAR_URL = "https://linkup-gateway.getyeteklu2.workers.dev/storage/v1/object/public/avatars/Miron/20260706_101739.png";

export const getAvatarFallback = (name) => {
    if (!name || name === 'Deleted Account' || name === 'Unknown User') {
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%231e1e1e"/><text x="50" y="65" font-size="45" text-anchor="middle">👻</text></svg>';
    }
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1e1e1e&color=42d7b8`;
};

export const getCachedBook = (query) => {
    if (!query) return null;
    try {
        const raw = localStorage.getItem('linkup_books_catalog');
        if (!raw) return null;
        const list = JSON.parse(raw);
        const q = String(query).trim().toLowerCase();
        return list.find(b => 
            (b.id && b.id.toLowerCase() === q) || 
            (b.course_code && b.course_code.toLowerCase() === q) ||
            (b.title && b.title.toLowerCase() === q)
        ) || null;
    } catch (e) {
        return null;
    }
};

export const getCachedBookCover = (query) => {
    return getCachedBook(query)?.cover_url || null;
};

export const getAvailableCourseTags = () => {
    try {
        const raw = localStorage.getItem('linkup_books_catalog');
        if (!raw) return [];
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list
            .filter(b => !b.isExamTrigger && !b.isFlashcardTrigger)
            .map(b => ({
                code: b.course_code || '',
                name: b.friendly_name || (b.title || '').replace(/^General\s+/i, ''),
                title: b.title || '',
                icon: b.icon || 'fa-book-open'
            }))
            .filter((v, idx, arr) => arr.findIndex(t => t.name.toLowerCase() === v.name.toLowerCase()) === idx);
    } catch (e) {
        return [];
    }
};