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
        console.log(`[Social Core] Admin successfully added target user ${target_user_id} to conversation ${conversation_id}`);
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
        console.log(`[Social Core] Successfully updated group metadata for conversation ${conversation_id}. Title: "${newTitle}"`);
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
        console.log(`[Social Core] Successfully toggled admin setting "${key}" to "${value}" for conversation ${conversation_id}`);
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
            const { error: delErr } = await supabase.from('live_study_sessions').delete().eq('conversation_id', conversation_id);
            if (delErr) throw delErr;

            const { error: insErr } = await supabase.from('live_study_sessions').insert({
                conversation_id: conversation_id,
                course_name: setupData.course || 'General Study',
                lesson_topic: setupData.topic,
                active_user_ids: [requesterId],
                last_updated_at: new Date().toISOString(),
                lecture_chunks: lecture_chunks || null,
                raw_source_text: raw_source_text || null
            });
            if (insErr) throw insErr;
            console.log(`[Social Core] Successfully saved live study session context to database for conversation ${conversation_id}. Topic: "${setupData.topic}"`);
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
        console.log(`[Social Core] Successfully updated pin message status for conversation ${conversation_id}`);
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
        console.log(`[Social Core] Successfully toggled AI hosting (ai_hosting: ${ai_hosting}) for conversation ${conversation_id}`);
        return new Response(JSON.stringify({ success: true, metadata: meta }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'get_target_tg_group') {
        const targetGroup = Deno.env.get('TARGET_TG_GROUP') || '@linkup_official_squad';
        return new Response(JSON.stringify({ success: true, target_group: targetGroup }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === 'verify_tg_group_join') {
        const targetGroup = Deno.env.get('TARGET_TG_GROUP') || '@linkup_official_squad';
        const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
        
        if (!botToken) throw new Error("Bot token not configured on server.");

        const { data: profile } = await supabase.from('profiles').select('telegram_id, registered_with_telegram').eq('id', requesterId).single();
        if (!profile?.registered_with_telegram || !profile?.telegram_id) {
            throw new Error("You must verify your Telegram account first.");
        }

        const idempotencyKey = `tg_group_join_reward_${requesterId}`;
        const { data: tx } = await supabase.from('linkoin_transactions').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
        if (tx) throw new Error("Reward already claimed.");

        // Query Telegram Bot API securely from the backend
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${targetGroup}&user_id=${profile.telegram_id}`);
        const tgData = await tgRes.json();

        if (!tgData.ok) {
            console.error("[Social Core] TG API Error:", tgData);
            throw new Error("Could not verify membership. Are you sure you joined the correct group?");
        }

        const status = tgData.result.status;
        if (!['member', 'administrator', 'creator'].includes(status)) {
            throw new Error("You have not joined the group yet, or you left.");
        }

        const { error: insertErr } = await supabase.from('linkoin_transactions').insert({
            user_id: requesterId,
            amount: 30,
            transaction_type: 'reward',
            description: `Joined Official Telegram Group: ${targetGroup}`,
            idempotency_key: idempotencyKey
        });

        if (insertErr) throw insertErr;

        return new Response(JSON.stringify({ success: true, amount: 30 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});