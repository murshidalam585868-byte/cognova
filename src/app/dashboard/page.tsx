/**
 * Chief of Staff — BI Dashboard
 * =============================
 * Next.js App Router page displaying real-time pipeline metrics,
 * digest history, news ingestion stats, and queue health.
 *
 * Features:
 * - Server-side data fetching for initial metrics
 * - Client-side Recharts visualizations
 * - Digest preview cards
 * - Queue status indicators
 * - News volume by category
 */

import { Suspense } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import {
  Newspaper,
  FileText,
  Activity,
  Layers,
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
} from 'lucide-react';
import type { Digest } from '@/types';

// ---------------------------------------------------------------------------
// Server-side data fetching
// ---------------------------------------------------------------------------

async function fetchDashboardData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Parallel queries
  const [
    { data: newsItems },
    { data: digests },
    { data: queueJobs },
    { data: metrics },
    { data: sources },
  ] = await Promise.all([
    sb.from('news_items').select('id,category,fetched_at').gte('fetched_at', getNDaysAgo(7)).order('fetched_at', { ascending: true }),
    sb.from('digests').select('*').order('created_at', { ascending: false }).limit(20),
    sb.from('job_queue').select('state').order('created_at', { ascending: false }).limit(100),
    sb.from('dashboard_metrics').select('*').gte('recorded_at', getNDaysAgo(7)).order('recorded_at', { ascending: true }),
    sb.from('rss_sources').select('name,is_active,last_fetched_at').order('created_at', { ascending: false }),
  ]);

  return {
    newsItems: (newsItems || []) as Array<{ id: string; category: string; fetched_at: string }>,
    digests: (digests || []) as Digest[],
    queueJobs: (queueJobs || []) as Array<{ state: string }>,
    metrics: (metrics || []) as Array<{ metric_name: string; metric_value: number; dimension?: string; recorded_at: string }>,
    sources: (sources || []) as Array<{ name: string; is_active: boolean; last_fetched_at: string | null }>,
  };
}

function getNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const data = await fetchDashboardData();

  // --- Derived metrics ---
  const newsByDay = groupByDay(data.newsItems.map((n) => n.fetched_at));
  const newsByCategory = groupByCategory(data.newsItems.map((n) => n.category));
  const queueStats = countByState(data.queueJobs.map((j) => j.state));
  const digestByType = countByType(data.digests);
  const metricSeries = buildMetricSeries(data.metrics);

  const totalNews = data.newsItems.length;
  const totalDigests = data.digests.length;
  const activeSources = data.sources.filter((s) => s.is_active).length;
  const failedJobs = queueStats.find((s) => s.state === 'failed')?.count ?? 0;

  const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-sky-500" />
            Chief of Staff — Intelligence Dashboard
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Real-time overview of news ingestion, digest generation, and pipeline health.
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard
            title="News Items (7d)"
            value={totalNews}
            icon={<Newspaper className="w-5 h-5 text-sky-500" />}
            trend={totalNews > 100 ? 'up' : 'neutral'}
          />
          <KpiCard
            title="Digests Generated"
            value={totalDigests}
            icon={<FileText className="w-5 h-5 text-emerald-500" />}
            trend={totalDigests > 0 ? 'up' : 'neutral'}
          />
          <KpiCard
            title="Active RSS Sources"
            value={activeSources}
            icon={<Layers className="w-5 h-5 text-amber-500" />}
            trend="neutral"
          />
          <KpiCard
            title="Failed Jobs"
            value={failedJobs}
            icon={<AlertCircle className="w-5 h-5 text-red-500" />}
            trend={failedJobs > 0 ? 'down' : 'neutral'}
            alert={failedJobs > 0}
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* News Volume Over Time */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-sky-500" />
              News Volume (7 Days)
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={newsByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* News by Category */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-500" />
              News by Category
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={newsByCategory}
                    dataKey="count"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ category, percent }) => `${category} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {newsByCategory.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Queue Status */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-violet-500" />
              Job Queue Status
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={queueStats} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="state" type="category" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {queueStats.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.state === 'failed'
                            ? '#ef4444'
                            : entry.state === 'completed'
                            ? '#10b981'
                            : entry.state === 'active'
                            ? '#f59e0b'
                            : '#0ea5e9'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Digest Metrics Time Series */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              Pipeline Metrics (7 Days)
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metricSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="digests" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="news" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Digests Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-500" />
              Recent Digests
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Sources</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.digests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No digests generated yet. The pipeline runs daily at 07:00 UTC.
                    </td>
                  </tr>
                ) : (
                  data.digests.map((digest) => (
                    <tr key={digest.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">
                        {digest.title}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            digest.type === 'daily'
                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300'
                              : digest.type === 'weekly'
                              ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                          }`}
                        >
                          {digest.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                        {digest.sources?.slice(0, 3).join(', ')}
                        {(digest.sources?.length || 0) > 3 ? ' ...' : ''}
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                        {new Date(digest.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        {digest.sentAt ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" /> Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <Clock className="w-4 h-4" /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RSS Sources Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-amber-500" />
              RSS Feed Sources
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Last Fetched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.sources.map((source) => (
                  <tr key={source.name} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">
                      {source.name}
                    </td>
                    <td className="px-6 py-4">
                      {source.is_active ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
                          <AlertCircle className="w-4 h-4" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                      {source.last_fetched_at
                        ? new Date(source.last_fetched_at).toLocaleString()
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  icon,
  trend,
  alert,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  trend: 'up' | 'down' | 'neutral';
  alert?: boolean;
}) {
  const trendColor =
    trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-600' : 'text-gray-500';
  const borderColor = alert ? 'border-red-300 dark:border-red-700' : 'border-transparent';

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow p-5 border ${borderColor}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{value}</span>
        <span className={`text-xs font-medium ${trendColor}`}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data transformers
// ---------------------------------------------------------------------------

function groupByDay(dates: string[]): Array<{ day: string; count: number }> {
  const map = new Map<string, number>();
  for (const d of dates) {
    const day = new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    map.set(day, (map.get(day) || 0) + 1);
  }
  return Array.from(map.entries()).map(([day, count]) => ({ day, count }));
}

function groupByCategory(categories: string[]): Array<{ category: string; count: number }> {
  const map = new Map<string, number>();
  for (const c of categories) {
    const cat = c || 'general';
    map.set(cat, (map.get(cat) || 0) + 1);
  }
  return Array.from(map.entries()).map(([category, count]) => ({ category, count }));
}

function countByState(states: string[]): Array<{ state: string; count: number }> {
  const map = new Map<string, number>();
  for (const s of states) {
    map.set(s, (map.get(s) || 0) + 1);
  }
  return Array.from(map.entries()).map(([state, count]) => ({ state, count }));
}

function countByType(digests: Digest[]): Array<{ type: string; count: number }> {
  const map = new Map<string, number>();
  for (const d of digests) {
    map.set(d.type, (map.get(d.type) || 0) + 1);
  }
  return Array.from(map.entries()).map(([type, count]) => ({ type, count }));
}

function buildMetricSeries(
  metrics: Array<{ metric_name: string; metric_value: number; recorded_at: string }>
): Array<{ day: string; digests: number; news: number }> {
  const map = new Map<string, { digests: number; news: number }>();

  for (const m of metrics) {
    const day = new Date(m.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const entry = map.get(day) || { digests: 0, news: 0 };
    if (m.metric_name === 'digests_generated') entry.digests += m.metric_value;
    if (m.metric_name === 'news_items_ingested') entry.news += m.metric_value;
    map.set(day, entry);
  }

  return Array.from(map.entries()).map(([day, vals]) => ({ day, ...vals }));
}
