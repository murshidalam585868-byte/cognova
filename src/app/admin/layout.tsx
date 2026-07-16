/**
 * src/app/admin/layout.tsx
 * Admin Panel Layout
 *
 * Provides a persistent sidebar with navigation, auth guard,
 * and responsive design for the admin dashboard.
 */

import React from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Brain,
  Activity,
  Wrench,
  Shield,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { requireAdmin } from '@/lib/admin/auth';
import { getAdminFromCookie } from '@/lib/admin/auth-cookie';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Shadow Brain — Admin Panel',
  description: 'System administration and monitoring',
};

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/audit', label: 'Audit Logs', icon: ClipboardList },
  { href: '/admin/memory', label: 'Memory', icon: Brain },
  { href: '/admin/health', label: 'System Health', icon: Activity },
  { href: '/admin/tools', label: 'Tools', icon: Wrench },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth guard — try Supabase first, then fall back to cookie
  const user = (await requireAdmin()) ?? (await getAdminFromCookie());
  if (!user) {
    redirect('/admin-login');
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200 dark:border-gray-700">
          <Shield className="w-6 h-6 text-sky-600" />
          <div>
            <h1 className="text-sm font-bold text-gray-900 dark:text-white tracking-tight">
              Shadow Brain
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Admin Panel</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center text-sky-600 dark:text-sky-400 text-sm font-semibold">
              {user.email.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {user.email}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                {user.role}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
