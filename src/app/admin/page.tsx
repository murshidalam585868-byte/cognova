/**
 * src/app/admin/page.tsx
 * Admin Dashboard — Overview
 *
 * Displays key system metrics, quick stats, and navigation cards.
 * Server-side rendered with data from Supabase.
 */

import React from 'react';
import Link from 'next/link';
import {
  Users,
  MessageSquare,
  Brain,
  Activity,
  Wrench,
  ClipboardList,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import { getDashboardStats } from '@/lib/admin/actions';
import type { AdminDashboardStats } from '@/types';

export const metadata = {
  title: 'Admin Dashboard — Hazard Brain',
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchStats(): Promise<AdminDashboardStats> {
  try {
    return await getDashboardStats();
  } catch {
    return {
      totalUsers: 0,
      totalConversations: 0,
      totalMessages: 0,
      totalMemories: 0,
      activeUsers24h: 0,
      failedJobs: 0,
      openAlerts: 0,
      systemStatus: 'healthy',
    };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default async function AdminDashboardPage(): Promise<React.ReactElement> {
  const stats = await fetchStats();

  const statCards = [
    {
      label: 'Total Users',
      value: stats.totalUsers,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      href: '/admin/users',
    },
    {
      label: 'Conversations',
      value: stats.totalConversations,
      icon: MessageSquare,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      href: '/admin/audit',
    },
    {
      label: 'Memories',
      value: stats.totalMemories,
      icon: Brain,
      color: 'text-violet-600',
      bg: 'bg-violet-50 dark:bg-violet-900/20',
      href: '/admin/memory',
    },
    {
      label: 'Messages',
      value: stats.totalMessages,
      icon: TrendingUp,
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      href: '/admin/audit',
    },
  ];

  const statusCards = [
    {
      label: 'Active Users (24h)',
      value: stats.activeUsers24h,
      icon: CheckCircle,
      color: 'text-emerald-600',
    },
    {
      label: 'Failed Jobs',
      value: stats.failedJobs,
      icon: AlertTriangle,
      color: stats.failedJobs > 0 ? 'text-red-600' : 'text-gray-400',
    },
    {
      label: 'Open Alerts',
      value: stats.openAlerts,
      icon: AlertTriangle,
      color: stats.openAlerts > 0 ? 'text-amber-600' : 'text-gray-400',
    },
    {
      label: 'System Status',
      value: stats.systemStatus,
      icon: Activity,
      color:
        stats.systemStatus === 'healthy'
          ? 'text-emerald-600'
          : stats.systemStatus === 'degraded'
          ? 'text-amber-600'
          : 'text-red-600',
    },
  ];

  const quickLinks = [
    { label: 'Manage Users', description: 'View and manage user accounts and roles', href: '/admin/users', icon: Users },
    { label: 'Audit Logs', description: 'Review system activity and conversation history', href: '/admin/audit', icon: ClipboardList },
    { label: 'Memory Browser', description: 'Inspect and manage memory entries', href: '/admin/memory', icon: Brain },
    { label: 'System Health', description: 'Monitor system metrics and performance', href: '/admin/health', icon: Activity },
    { label: 'Tool Configuration', description: 'Configure API tools and rate limits', href: '/admin/tools', icon: Wrench },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Admin Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Overview of system activity, user metrics, and health status.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {card.label}
              </span>
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {card.value.toLocaleString()}
              </span>
              <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statusCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {card.label}
              </span>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </div>
            <span className="text-xl font-semibold text-gray-900 dark:text-white capitalize">
              {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
            </span>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Quick Navigation
          </h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700">
                <link.icon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {link.label}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {link.description}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-400" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
