#!/bin/sh
# ============================================================
# Shadow Brain — PostgREST Role Initialization
# Creates authenticator and anon roles for PostgREST/Supabase
# compatibility in self-hosted deployments.
# Runs automatically in postgres container via docker-entrypoint-initdb.d
# ============================================================

set -e

psql -v ON_ERROR_STOP=1 \
  -v "password=${POSTGRES_PASSWORD}" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  <<-'EOSQL'
    -- Create authenticator role (PostgREST connects with this)
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
            CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD :'password';
        ELSE
            ALTER ROLE authenticator WITH PASSWORD :'password';
        END IF;
    END
    $$;

    -- Create anon role (unauthenticated requests)
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
        END IF;
    END
    $$;

    -- Grant authenticator permission to switch to anon
    GRANT anon TO authenticator;

    -- Grant anon basic schema usage
    GRANT USAGE ON SCHEMA public TO anon;
    GRANT USAGE ON SCHEMA auth TO anon;

    -- Grant anon CRUD on all existing tables in public schema
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

    -- Grant anon read on auth.users (for RLS compatibility)
    GRANT SELECT ON auth.users TO anon;

    -- Default privileges for future tables
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

    -- Create service_role (for admin/service operations)
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role NOLOGIN;
        END IF;
    END
    $$;

    GRANT service_role TO authenticator;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
EOSQL

echo "PostgREST roles initialized successfully."
