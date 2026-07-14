-- ================================================================
-- Migration 000: Self-Hosted Auth Compatibility
-- Description: Creates auth schema and users table for self-hosted
-- PostgreSQL deployments where Supabase Auth is not available.
-- Must run BEFORE all other migrations.
-- ================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- Create auth schema if not exists
CREATE SCHEMA IF NOT EXISTS auth;

-- ------------------------------------------------------------------
-- 1. auth.users table (Supabase-compatible)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    encrypted_password TEXT,
    email_confirmed_at TIMESTAMPTZ,
    confirmation_sent_at TIMESTAMPTZ,
    confirmation_token TEXT,
    recovery_token TEXT,
    email_change TEXT,
    email_change_sent_at TIMESTAMPTZ,
    email_change_token TEXT,
    new_email TEXT,
    raw_app_meta_data JSONB DEFAULT '{}',
    raw_user_meta_data JSONB DEFAULT '{}',
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_sign_in_at TIMESTAMPTZ,
    phone TEXT,
    phone_confirmed_at TIMESTAMPTZ,
    phone_change TEXT,
    phone_change_token TEXT,
    phone_change_sent_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ GENERATED ALWAYS AS (
        LEAST(email_confirmed_at, phone_confirmed_at)
    ) STORED,
    email_confirmed_at TIMESTAMPTZ,
    aud TEXT DEFAULT 'authenticated',
    role TEXT DEFAULT 'authenticated',
    banned_until TIMESTAMPTZ
);

-- Index for auth lookups
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users(email);

-- ------------------------------------------------------------------
-- 2. auth.uid() function (used by RLS policies)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.role', TRUE), '')::TEXT;
$$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.email', TRUE), '')::TEXT;
$$;

-- ------------------------------------------------------------------
-- 3. Updated At Trigger for auth.users
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_auth_users_updated_at ON auth.users;
CREATE TRIGGER update_auth_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_updated_at_column();

-- ------------------------------------------------------------------
-- 4. Grant usage on auth schema
-- ------------------------------------------------------------------
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT SELECT ON auth.users TO PUBLIC;

-- ------------------------------------------------------------------
-- 5. Seed a default admin user (optional, for first login)
--    Password: 'shadowbrain-admin' (bcrypt hashed)
--    Change this in production!
-- ------------------------------------------------------------------
INSERT INTO auth.users (
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    role
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@shadowbrain.local',
    '$2a$10$abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstu', -- placeholder; will fail login
    NOW(),
    '{"provider":"email","providers":["email"]}',
    'authenticated'
)
ON CONFLICT (email) DO NOTHING;
