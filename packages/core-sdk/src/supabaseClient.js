import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- SECURE PROXY ROUTING ---
// NOTE: Replace this placeholder with the actual URL Cloudflare gives you after deployment
const supabaseUrl = 'https://linkup-gateway.getyeteklu2.workers.dev';

// Fake proprietary key to mask Supabase signature.
// The Cloudflare Worker intercepts this and injects the real Supabase key server-side.
const supabaseAnonKey = 'lk_live_9a38f2e7b1c4d9e0a2f8d73b';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);