-- Supabase Database Updates for Settings and Soft Delete
-- Run these in Supabase Dashboard > SQL Editor

-- ================================================================
-- 1. Add settings and soft delete columns to profiles table
-- ================================================================

-- Add settings column (JSONB for flexible settings storage)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Add soft delete columns
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add privacy column
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;

-- ================================================================
-- 2. Update Row Level Security for soft-deleted users
-- ================================================================

-- Users who are soft-deleted should not appear in searches
CREATE OR REPLACE FUNCTION is_profile_visible(profile_row profiles)
RETURNS BOOLEAN AS $$
BEGIN
    -- Not visible if deleted
    IF profile_row.deleted_at IS NOT NULL THEN
        RETURN false;
    END IF;
    
    -- Not visible if inactive
    IF profile_row.is_active = false THEN
        RETURN false;
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- 3. Cleanup function - Run periodically (e.g., daily via pg_cron)
-- This deletes users who have been soft-deleted for 10+ days
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_deleted_users()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    deleted_count INTEGER := 0;
    user_record RECORD;
BEGIN
    -- Find users who have been deleted for more than 10 days
    FOR user_record IN 
        SELECT id FROM public.profiles 
        WHERE deleted_at IS NOT NULL 
        AND deleted_at < NOW() - INTERVAL '10 days'
    LOOP
        -- Delete all related data
        DELETE FROM public.friends WHERE user_id = user_record.id;
        DELETE FROM public.friends WHERE friend_id = user_record.id;
        DELETE FROM public.friend_requests WHERE from_user_id = user_record.id;
        DELETE FROM public.friend_requests WHERE to_user_id = user_record.id;
        DELETE FROM public.messages WHERE sender_id = user_record.id;
        DELETE FROM public.chat_members WHERE user_id = user_record.id;
        DELETE FROM public.profiles WHERE id = user_record.id;
        
        -- Delete from auth.users
        DELETE FROM auth.users WHERE id = user_record.id;
        
        deleted_count := deleted_count + 1;
    END LOOP;
    
    RETURN deleted_count;
END;
$$;

-- Grant execute permission (for manual execution or scheduled jobs)
GRANT EXECUTE ON FUNCTION cleanup_deleted_users() TO service_role;

-- ================================================================
-- 4. Function to restore a soft-deleted account (for support use)
-- ================================================================

CREATE OR REPLACE FUNCTION restore_deleted_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.profiles 
    SET deleted_at = NULL, is_active = true
    WHERE id = target_user_id 
    AND deleted_at IS NOT NULL;
    
    RETURN FOUND;
END;
$$;

-- Grant to service_role only (admin/support function)
GRANT EXECUTE ON FUNCTION restore_deleted_user(UUID) TO service_role;

-- ================================================================
-- 5. View for finding users pending permanent deletion
-- ================================================================

CREATE OR REPLACE VIEW pending_deletion_users AS
SELECT 
    id,
    full_name,
    deleted_at,
    deleted_at + INTERVAL '10 days' AS permanent_deletion_date,
    EXTRACT(DAY FROM (deleted_at + INTERVAL '10 days' - NOW())) AS days_remaining
FROM public.profiles
WHERE deleted_at IS NOT NULL
ORDER BY deleted_at ASC;

-- ================================================================
-- Verification
-- ================================================================

SELECT 'Database updates completed successfully!' as status;
SELECT 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN ('settings', 'deleted_at', 'is_active', 'is_private');
