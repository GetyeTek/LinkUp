import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-encoding, x-linkup-client",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action } = body;
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace('Bearer ', '');

    // Execute using Service Role to handle complex multi-table logic safely
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    
    // 1. Establish True Identity
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("Invalid JWT token");
    
    const requesterId = user.id;

    // 2. Strict Privilege Gatekeeper
    const verifyAdmin = async (conversationId: string, allowAdmin = true) => {
        const { data: member } = await supabase
            .from('conversation_members')
            .select('role')
            .eq('conversation_id', conversationId)
            .eq('user_id', requesterId)
            .single();
            
        if (!member) throw new Error("You are not a member of this group.");
        if (member.role === 'owner') return member.role;
        if (allowAdmin && member.role === 'admin') return member.role;
        throw new Error("Administrative privileges required.");
    };

    // --- SECURE ROUTES ---

    if (action === 'admin_add_member') {
        const { conversation_id, target_user_id } = body;
        await verifyAdmin(conversation_id, true);
        
        const { error } = await supabase.from('conversation_members').insert({
            conversation_id, user_id: target_user_id, role: 'member'
        });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'update_group_meta') {
        const { conversation_id, updates } = body;
        // Only owners can change core group identity
        await verifyAdmin(conversation_id, false); 
        
        const { data: conv } = await supabase.from('conversations').select('title, metadata').eq('id', conversation_id).single();
        if (!conv) throw new Error("Group not found");
        
        let currentMeta = conv.metadata || {};
        let newTitle = updates.title !== undefined ? updates.title : conv.title;
        
        if (updates.bio !== undefined) currentMeta.bio = updates.bio;
        if (updates.privacy !== undefined) currentMeta.privacy = updates.privacy;
        
        if (updates.slug !== undefined) {
            // Verify uniqueness natively
            if (updates.slug !== currentMeta.slug) {
                const { data: existing } = await supabase.from('conversations').select('id').contains('metadata', { slug: updates.slug }).neq('id', conversation_id).maybeSingle();
                if (existing) throw new Error("Handle is already taken by another group.");
                currentMeta.slug = updates.slug;
            }
        }

        const { error } = await supabase.from('conversations').update({ title: newTitle, metadata: currentMeta }).eq('id', conversation_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, metadata: currentMeta, title: newTitle }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'toggle_admin_setting') {
        const { conversation_id, key, value } = body;
        // Only owners can change structural rules
        await verifyAdmin(conversation_id, false); 
        
        const { data: conv } = await supabase.from('conversations').select('metadata').eq('id', conversation_id).single();
        let currentMeta = conv?.metadata || {};
        currentMeta[key] = value;
        
        const { error } = await supabase.from('conversations').update({ metadata: currentMeta }).eq('id', conversation_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, metadata: currentMeta }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'start_live_session') {
        const { conversation_id, setupData, lecture_chunks, raw_source_text } = body;
        await verifyAdmin(conversation_id, true); // Admins CAN host live sessions
        
        // Let backend RPC handle the heartbeat timestamping
        const { error: hbError } = await supabase.rpc('heartbeat_live_session', { conv_id: conversation_id, req_host_id: requesterId });

        const { data: conv } = await supabase.from('conversations').select('metadata').eq('id', conversation_id).single();
        let meta = conv?.metadata || {};
        
        if (setupData?.topic) meta.live_topic = setupData.topic;
        delete meta.ai_hosting; // Force human host natively
        
        await supabase.from('conversations').update({ metadata: meta }).eq('id', conversation_id);

        if (setupData) {
            await supabase.from('live_study_sessions').delete().eq('conversation_id', conversation_id);
            await supabase.from('live_study_sessions').insert({
                conversation_id: conversation_id,
                course_name: setupData.course || 'General Study',
                lesson_topic: setupData.topic,
                active_user_ids: [requesterId],
                last_updated_at: new Date().toISOString(),
                lecture_chunks: lecture_chunks || null,
                raw_source_text: raw_source_text || null
            });
        }
        }

        return new Response(JSON.stringify({ success: true, metadata: meta }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'pin_message') {
        const { conversation_id, pinned_message } = body;
        await verifyAdmin(conversation_id, true); // Admins CAN pin
        
        const { data: conv } = await supabase.from('conversations').select('metadata').eq('id', conversation_id).single();
        let meta = conv?.metadata || {};
        
        if (pinned_message) meta.pinned_message = pinned_message;
        else delete meta.pinned_message;
        
        const { error } = await supabase.from('conversations').update({ metadata: meta }).eq('id', conversation_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, metadata: meta }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'toggle_miron') {
        const { conversation_id, ai_hosting } = body;
        await verifyAdmin(conversation_id, true); // Admins CAN toggle AI during their session
        
        const { data: conv } = await supabase.from('conversations').select('metadata').eq('id', conversation_id).single();
        let meta = conv?.metadata || {};
        
        if (ai_hosting) meta.ai_hosting = true;
        else delete meta.ai_hosting;
        
        const { error } = await supabase.from('conversations').update({ metadata: meta }).eq('id', conversation_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, metadata: meta }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});