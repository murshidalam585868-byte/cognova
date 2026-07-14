/**
 * src/app/admin/health/page.tsx
 * System Health Monitor
 *
 * Features:
 *   - Real-time health snapshot display
 *   - Historical health chart (Recharts)
 *   - Manual health snapshot recording
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  HeartPulse,
  Server,
  Database,
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { getSystemHealth, recordHealthSnapshot } from '@/lib/admin/actions';
import type { SystemHealthSnapshot } from '@/types';

export default function HealthPage(): React.ReactElement {
  const [snapshots, setSnapshots] = useState<SystemHealthSnapshot[]>([]);
  const [latest, setLatest] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSystemHealth();
      setSnapshots(res.snapshots);
      setLatest(res.latest);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth, refreshKey]);

  const handleRecord = async () => {
    setRecording(true);
    try {
      await recordHealthSnapshot({
        status: latest?.status ?? 'healthy',
        details: { manually_recorded: true },
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecording(false);
    }
  };

  const chartData = snapshots
    .slice()
    .reverse()
    .map((s) => ({
      time: new Date(s.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cpu: s.cpuPercent ?? 0,
      memory: s.memoryPercent ?? 0,
      latency: s.apiLatencyMs ?? 0,
      queue: s.queueDepth ?? 0,
    }));

  const statusConfig = {
    healthy: { color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: CheckCircle },
    degraded: { color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: AlertTriangle },
    critical: { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', icon: AlertTriangle },
  };

  const currentStatus = latest?.status ?? 'healthy';
  const status = statusConfig[currentStatus];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-600" />
            System Health
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Monitor system performance, resource usage, and availability.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleRecord}
            disabled={recording}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {recording ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartPulse className="w-4 h-4" />}
            Record Snapshot
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Status Card */}
      <div className={`rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6 ${status.bg}`}>
        <div className="flex items-center gap-4">
          <status.icon className={`w-8 h-8 ${status.color}`} />
          <div>
            <p className={`text-lg font-semibold capitalize ${status.color}`}>
              {currentStatus}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {latest
                ? `Last checked: ${new Date(latest.recordedAt).toLocaleString()}`
                : 'No health data recorded yet'}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'CPU', value: latest?.cpuPercent, unit: '%', icon: Server, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { label: 'Memory', value: latest?.memoryPercent, unit: '%', icon: Database, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
          { label: 'API Latency', value: latest?.apiLatencyMs, unit: 'ms', icon: Activity, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Queue Depth', value: latest?.queueDepth, unit: '', icon: Server, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        ].map((metric) => (
          <div key={metric.label} className={`rounded-xl border border-gray-200 dark:border-gray-700 p-5 ${metric.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{metric.label}</span>
              <metric.icon className={`w-4 h-4 ${metric.color}`} />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {metric.value !== undefined ? `${metric.value.toFixed(1)}${metric.unit}` : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
            CPU & Memory Over Time
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                />
                <Legend />
                <Area type="monotone" dataKey="cpu" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.1} name="CPU %" />
                <Area type="monotone" dataKey="memory" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} name="Memory %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
            API Latency & Queue Depth
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                />
                <Legend />
                <Line type="monotone" dataKey="latency" stroke="#f59e0b" strokeWidth={2} dot={false} name="Latency (ms)" />
                <Line type="monotone" dataKey="queue" stroke="#10b981" strokeWidth={2} dot={false} name="Queue Depth" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Snapshots Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Recent Snapshots</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400">
              <tr>
                <th className="px-6 py-3 font-medium">Recorded</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">CPU</th>
                <th className="px-6 py-3 font-medium">Memory</th>
                <th className="px-6 py-3 font-medium">Latency</th>
                <th className="px-6 py-3 font-medium">Queue</th>
                <th className="px-6 py-3 font-medium">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                  </td>
                </tr>
              ) : snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    No health snapshots recorded. Click "Record Snapshot" to begin.
                  </td>
                </tr>
              ) : (
                snapshots.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(s.recordedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        s.status === 'healthy'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : s.status === 'degraded'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-900 dark:text-white">{s.cpuPercent?.toFixed(1) ?? '—'}%</td>
                    <td className="px-6 py-3 text-gray-900 dark:text-white">{s.memoryPercent?.toFixed(1) ?? '—'}%</td>
                    <td className="px-6 py-3 text-gray-900 dark:text-white">{s.apiLatencyMs?.toFixed(0) ?? '—'} ms</td>
                    <td className="px-6 py-3 text-gray-900 dark:text-white">{s.queueDepth ?? '—'}</td>
                    <td className="px-6 py-3 text-gray-900 dark:text-white">{s.openAlerts ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
