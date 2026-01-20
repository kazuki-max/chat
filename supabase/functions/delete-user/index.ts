// Supabase Edge Function to delete user account
// This function uses the service role key to delete auth users

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Get user JWT from authorization header
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'No authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Create Supabase client with service role key (admin access)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        // Create client with user's JWT to get their ID
        const supabaseUser = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            {
                global: {
                    headers: { Authorization: authHeader }
                }
            }
        )

        // Get the user from their JWT
        const { data: { user }, error: userError } = await supabaseUser.auth.getUser()

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid user token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const userId = user.id

        // Delete user data from all tables using admin client
        // Delete friends relationships
        await supabaseAdmin.from('friends').delete().eq('user_id', userId)
        await supabaseAdmin.from('friends').delete().eq('friend_id', userId)

        // Delete friend requests
        await supabaseAdmin.from('friend_requests').delete().eq('from_user_id', userId)
        await supabaseAdmin.from('friend_requests').delete().eq('to_user_id', userId)

        // Delete messages sent by user
        await supabaseAdmin.from('messages').delete().eq('sender_id', userId)

        // Delete chat memberships
        await supabaseAdmin.from('chat_members').delete().eq('user_id', userId)

        // Delete profile
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', userId)

        if (profileError) {
            console.error('Profile deletion error:', profileError)
        }

        // Delete the auth user using admin API
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

        if (deleteError) {
            console.error('Auth user deletion error:', deleteError)
            return new Response(
                JSON.stringify({ error: 'Failed to delete auth user', details: deleteError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, message: 'Account deleted successfully' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Delete account error:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error', details: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
