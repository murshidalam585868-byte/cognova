'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Settings,
  BarChart3,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export interface AppShellProps {
  brand: { productName: string };
  children: React.ReactNode;
}

export function AppShell({ brand, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside
        className={cn(
          'relative flex flex-col border-r border-white/10 bg-surface transition-all duration-300',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="flex h-16 items-center justify-between px-4 border-b border-white/10">
          {!collapsed && (
            <Link
              href="/landing"
              className="flex items-center gap-2 font-bold text-lg tracking-tight"
            >
              <Sparkles className="text-indigo-400" size={20} />
              <span className="text-gradient">{brand.productName}</span>
            </Link>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              'p-1.5 rounded-md hover:bg-white/10 transition-colors text-foreground-muted',
              collapsed && 'mx-auto'
            )}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/10 text-foreground'
                    : 'text-foreground-muted hover:bg-white/5 hover:text-foreground',
                  collapsed && 'justify-center px-0'
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 text-xs text-foreground-muted text-center">
          {!collapsed && `${brand.productName} v2.0`}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
