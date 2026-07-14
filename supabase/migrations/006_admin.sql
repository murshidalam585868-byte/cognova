-- =============================================================================
-- Migration 006: Admin Panel & Role-Based Access Control
-- Phase 6: Production-grade admin infrastructure
-- Tables: roles, user_roles, permissions, role_permissions, audit_logs,
--          system_health_snapshots, admin_sessions
-- =============================================================================

-- -----------------------------------------------------------------
-- 1. Roles Enum Table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE CHECK (name IN ('user', 'admin', 'superadmin')),
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.roles IS 'Canonical role definitions for RBAC';

-- Seed default roles
INSERT INTO public.roles (name, description, is_system_role)
VALUES
    ('user', 'Standard user with access to their own data', true),
    ('admin', 'Administrator with access to user management and audit logs', true),
    ('superadmin', 'Super administrator with full system access', true)
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------
-- 2. User Roles (Many-to-one: user can have one primary role)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- optional role expiration (e.g., temp admin)
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON public.user_roles(role_id);

COMMENT ON TABLE public.user_roles IS 'Primary role assignment per user. One role per user.';

-- -----------------------------------------------------------------
-- 3. Permissions Table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    resource TEXT NOT NULL, -- e.g., 'users', 'conversations', 'system'
    action TEXT NOT NULL, -- e.g., 'read', 'write', 'delete', 'manage'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.permissions IS 'Granular permission definitions for RBAC';

-- Seed permissions
INSERT INTO public.permissions (code, name, description, resource, action)
VALUES
    ('users:read', 'Read Users', 'View user profiles and lists', 'users', 'read'),
    ('users:write', 'Write Users', 'Create and update user profiles', 'users', 'write'),
    ('users:delete', 'Delete Users', 'Delete user accounts', 'users', 'delete'),
    ('users:manage', 'Manage Users', 'Change user roles and permissions', 'users', 'manage'),
    ('conversations:read', 'Read Conversations', 'View all conversations', 'conversations', 'read'),
    ('conversations:delete', 'Delete Conversations', 'Delete any conversation', 'conversations', 'delete'),
    ('audit:read', 'Read Audit Logs', 'View audit and activity logs', 'audit', 'read'),
    ('memory:read', 'Read Memories', 'View all memory entries', 'memory', 'read'),
    ('memory:delete', 'Delete Memories', 'Delete memory entries', 'memory', 'delete'),
    ('system:read', 'Read System Health', 'View system health and metrics', 'system', 'read'),
    ('system:manage', 'Manage System', 'Change system configuration', 'system', 'manage'),
    ('tools:read', 'Read Tools', 'View tool configurations', 'tools', 'read'),
    ('tools:write', 'Write Tools', 'Update tool configurations', 'tools', 'write')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------
-- 4. Role Permissions (Many-to-many mapping)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role_id);

COMMENT ON TABLE public.role_permissions IS 'Maps roles to their granted permissions';

-- Seed role-permission mappings
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'superadmin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
    'users:read', 'users:write', 'conversations:read', 'audit:read',
    'memory:read', 'system:read', 'tools:read', 'tools:write'
)
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
    'conversations:read', 'memory:read'
)
WHERE r.name = 'user'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------
-- 5. Audit Logs (Comprehensive Activity Trail)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email TEXT,
    actor_role TEXT,
    action TEXT NOT NULL, -- e.g., 'login', 'logout', 'user.create', 'conversation.delete', 'tool.update'
    resource_type TEXT NOT NULL, -- 'user', 'conversation', 'message', 'memory', 'tool', 'system'
    resource_id TEXT,
    payload JSONB DEFAULT '{}',
    result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'failure', 'blocked')),
    error_message TEXT,
    ip_address INET,
    user_agent TEXT,
    session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_result ON public.audit_logs(result) WHERE result = 'failure';

COMMENT ON TABLE public.audit_logs IS 'Immutable audit trail for all admin and system actions';

-- -----------------------------------------------------------------
-- 6. System Health Snapshots
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_health_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cpu_percent NUMERIC,
    memory_percent NUMERIC,
    disk_percent NUMERIC,
    active_connections INTEGER,
    queue_depth INTEGER,
    api_latency_ms NUMERIC,
    error_rate_5m NUMERIC,
    open_alerts INTEGER,
    status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'critical')),
    details JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_status ON public.system_health_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_health_recorded_at ON public.system_health_snapshots(recorded_at DESC);

COMMENT ON TABLE public.system_health_snapshots IS 'Time-series system health metrics for monitoring';

-- -----------------------------------------------------------------
-- 7. Admin Sessions (for session tracking and revocation)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_token_hash TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON public.admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON public.admin_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_active ON public.admin_sessions(user_id, revoked_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.admin_sessions IS 'Admin session tracking for audit and revocation';

-- -----------------------------------------------------------------
-- 8. Tool Configuration Override (admin-level tool settings)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_admin_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name TEXT NOT NULL CHECK (tool_name IN ('gmail', 'calendar', 'notion', 'slack', 'pinecone', 'openai')),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    rate_limit_per_minute INTEGER DEFAULT 60,
    global_timeout_ms INTEGER DEFAULT 30000,
    config JSONB DEFAULT '{}',
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tool_name)
);

INSERT INTO public.tool_admin_configs (tool_name, is_enabled, rate_limit_per_minute, global_timeout_ms, config)
VALUES
    ('gmail', true, 60, 30000, '{}'),
    ('calendar', true, 60, 30000, '{}'),
    ('notion', true, 60, 30000, '{}'),
    ('slack', true, 60, 30000, '{}'),
    ('pinecone', true, 120, 30000, '{}'),
    ('openai', true, 120, 60000, '{}')
ON CONFLICT (tool_name) DO NOTHING;

COMMENT ON TABLE public.tool_admin_configs IS 'Admin-level tool configuration overrides';

-- -----------------------------------------------------------------
-- 9. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_admin_configs ENABLE ROW LEVEL SECURITY;

-- Roles: readable by all authenticated, writable by superadmin only
CREATE POLICY roles_select ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY roles_manage ON public.roles FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name = 'superadmin')
);

-- User roles: admins can read all, users can read their own, superadmins can manage
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_roles_select_admin ON public.user_roles FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'superadmin'))
);
CREATE POLICY user_roles_manage ON public.user_roles FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name = 'superadmin')
);

-- Permissions: readable by all authenticated
CREATE POLICY permissions_select ON public.permissions FOR SELECT TO authenticated USING (true);

-- Role permissions: readable by all authenticated, writable by superadmin
CREATE POLICY role_permissions_select ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY role_permissions_manage ON public.role_permissions FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name = 'superadmin')
);

-- Audit logs: readable by admin/superadmin, insertable by all (for app logging)
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY audit_logs_select_admin ON public.audit_logs FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'superadmin'))
);

-- System health: readable by admin/superadmin, writable by service_role
CREATE POLICY health_select_admin ON public.system_health_snapshots FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'superadmin'))
);
CREATE POLICY health_insert_service ON public.system_health_snapshots FOR INSERT TO service_role WITH CHECK (true);

-- Admin sessions: readable by own user + admin, writable by service_role
CREATE POLICY admin_sessions_select_own ON public.admin_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY admin_sessions_select_admin ON public.admin_sessions FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'superadmin'))
);
CREATE POLICY admin_sessions_insert_service ON public.admin_sessions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY admin_sessions_update_service ON public.admin_sessions FOR UPDATE TO service_role USING (true);

-- Tool admin configs: readable by admin/superadmin, writable by admin/superadmin
CREATE POLICY tool_admin_select ON public.tool_admin_configs FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'superadmin'))
);
CREATE POLICY tool_admin_write ON public.tool_admin_configs FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = auth.uid() AND r.name IN ('admin', 'superadmin'))
);

-- -----------------------------------------------------------------
-- 10. Helper Functions
-- -----------------------------------------------------------------

-- Get user role name
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT r.name INTO v_role
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id;
    RETURN COALESCE(v_role, 'user');
END;
$$;

-- Check if user has permission
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id UUID, p_permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_has_permission BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        JOIN public.role_permissions rp ON rp.role_id = r.id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = p_user_id AND p.code = p_permission_code
    ) INTO v_has_permission;
    RETURN v_has_permission;
END;
$$;

-- Log audit event (convenience function)
CREATE OR REPLACE FUNCTION public.log_audit_event(
    p_actor_id UUID,
    p_action TEXT,
    p_resource_type TEXT,
    p_resource_id TEXT DEFAULT NULL,
    p_payload JSONB DEFAULT '{}',
    p_result TEXT DEFAULT 'success',
    p_error_message TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
    v_email TEXT;
    v_role TEXT;
BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = p_actor_id;
    SELECT public.get_user_role(p_actor_id) INTO v_role;

    INSERT INTO public.audit_logs (
        actor_id, actor_email, actor_role, action, resource_type, resource_id,
        payload, result, error_message, ip_address, user_agent, session_id
    )
    VALUES (
        p_actor_id, v_email, v_role, p_action, p_resource_type, p_resource_id,
        p_payload, p_result, p_error_message, p_ip_address, p_user_agent, p_session_id
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- Record health snapshot (convenience function)
CREATE OR REPLACE FUNCTION public.record_health_snapshot(
    p_status TEXT DEFAULT 'healthy',
    p_details JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.system_health_snapshots (status, details)
    VALUES (p_status, p_details)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------
-- 11. Trigger: Auto-update tool_admin_configs.updated_at
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tool_admin_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tool_admin_configs_updated_at ON public.tool_admin_configs;
CREATE TRIGGER trg_tool_admin_configs_updated_at
    BEFORE UPDATE ON public.tool_admin_configs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_tool_admin_configs_updated_at();

-- -----------------------------------------------------------------
-- 12. Comments
-- -----------------------------------------------------------------
COMMENT ON FUNCTION public.get_user_role IS 'Returns the primary role name for a given user ID';
COMMENT ON FUNCTION public.user_has_permission IS 'Checks if a user has a specific permission code';
COMMENT ON FUNCTION public.log_audit_event IS 'Convenience function for inserting audit log entries';
COMMENT ON FUNCTION public.record_health_snapshot IS 'Convenience function for recording system health snapshots';
