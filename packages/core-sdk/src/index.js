export { supabase } from './supabaseClient.js';
export { PlatformProvider, usePlatform } from './PlatformProvider.jsx';
export { registerComponent, getComponent } from './ComponentRegistry.js';
export { useGeminiAudio } from './hooks/useGeminiAudio.js';
export { useGlobalSwipe } from './hooks/useGlobalSwipe.js';

export const getAvatarFallback = (name) => {
    if (!name || name === 'Deleted Account' || name === 'Unknown User') {
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%231e1e1e"/><text x="50" y="65" font-size="45" text-anchor="middle">👻</text></svg>';
    }
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1e1e1e&color=42d7b8`;
};