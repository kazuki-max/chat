-- Complete User Account Deletion Function
-- This function deletes the user from auth.users table directly
-- Must be run in Supabase Dashboard > SQL Editor

-- First, create an extension function if not exists
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create a function to completely delete user including auth record
-- This requires SECURITY DEFINER to access auth.users
CREATE OR REPLACE FUNCTION delete_user_completely()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    target_user_id UUID;
BEGIN
    -- Get the current user's ID
    target_user_id := auth.uid();
    
    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Delete from public tables first (order matters due to foreign keys)
    
    -- Delete friends relationships
    DELETE FROM public.friends WHERE user_id = target_user_id;
    DELETE FROM public.friends WHERE friend_id = target_user_id;

    -- Delete friend requests
    DELETE FROM public.friend_requests WHERE from_user_id = target_user_id;
    DELETE FROM public.friend_requests WHERE to_user_id = target_user_id;

    -- Delete messages sent by the user
    DELETE FROM public.messages WHERE sender_id = target_user_id;

    -- Delete chat memberships
    DELETE FROM public.chat_members WHERE user_id = target_user_id;

    -- Delete profile
    DELETE FROM public.profiles WHERE id = target_user_id;

    -- Delete the auth user (this is the key part!)
    DELETE FROM auth.users WHERE id = target_user_id;
    
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_user_completely() TO authenticated;

-- Verify the function exists
SELECT 'Function created successfully. Users can now call: supabase.rpc("delete_user_completely")' as status;
