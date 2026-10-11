import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- SECURE PROXY ROUTING ---
// NOTE: Replace this placeholder with the actual URL Cloudflare gives you after deployment
const supabaseUrl = 'https://linkup-gateway.getyeteklu2.workers.dev';

const supabaseAnonKey = 'sb_publishable_B9mxFwLJl8WWw_Y9C28LtA_AfKYATEc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);