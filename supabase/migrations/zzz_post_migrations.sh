#!/bin/sh
# ============================================================
# Shadow Brain — Post-Migration Grants & Cleanup
# Runs AFTER all SQL migrations to ensure roles have proper
# permissions on all tables, sequences, and functions.
# Alphabetically last (zzz_) to guarantee execution order.
# ============================================================

set -e

echo "Applying post-migration grants..."

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  <<-'EOSQL'
    -- Ensure anon can access all public tables
    GRANT USAGE ON SCHEMA public TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

    -- Ensure service_role has full access
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO service_role;

    -- Grant function execution
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

    -- Future objects
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
EOSQL

echo "Post-migration grants applied successfully."
