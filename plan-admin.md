# Admin Panel & Role-Based Auth — Execution Plan

## Stage 1: Database Schema (006_admin.sql)
- roles, user_roles, permissions, role_permissions tables
- audit_logs table with comprehensive fields
- system_health table for metrics
- admin RLS policies
- Seed default roles (user, admin, superadmin)

## Stage 2: Core Infrastructure
- Update src/types/index.ts with admin types
- Create src/lib/admin/auth.ts with role checks, session validation
- Create src/middleware.ts with route protection
- Create src/lib/admin/actions.ts server actions

## Stage 3: Admin API Routes
- src/app/api/admin/route.ts — main admin router/dispatcher
- src/app/api/admin/users/route.ts — CRUD
- src/app/api/admin/audit/route.ts — audit logs
- src/app/api/admin/health/route.ts — health metrics
- src/app/api/admin/tools/route.ts — tool config

## Stage 4: Admin UI Pages
- src/app/admin/layout.tsx — sidebar + auth guard
- src/app/admin/page.tsx — dashboard overview
- src/app/admin/users/page.tsx — user management table
- src/app/admin/audit/page.tsx — conversation audit viewer
- src/app/admin/memory/page.tsx — memory browser
- src/app/admin/health/page.tsx — system health monitor
- src/app/admin/tools/page.tsx — tool configuration UI

## Stage 5: Integration & Verification
- Ensure all files are typed with Zod
- Ensure async/await everywhere
- Verify all imports resolve
- Test compilation paths
