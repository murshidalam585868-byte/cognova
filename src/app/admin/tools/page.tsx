/**
 * src/app/admin/tools/page.tsx
 * Tool Configuration UI
 *
 * Features:
 *   - List all tool admin configs
 *   - Toggle tool enable/disable
 *   - Adjust rate limits and timeouts
 *   - Save changes with audit logging
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench,
  Save,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Clock,
  Gauge,
  AlertTriangle,
} from 'lucide-react';
import { listToolConfigs, updateToolConfig } from '@/lib/admin/actions';
import type { ToolAdminConfig } from '@/types';

export default function ToolsPage(): React.ReactElement {
  const [configs, setConfigs] = useState<ToolAdminConfig[]>([]);
  const [editing, setEditing] = useState<Record<string, Partial<ToolAdminConfig>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listToolConfigs();
      setConfigs(data);
      const initialEdits: Record<string, Partial<ToolAdminConfig>> = {};
      data.forEach((c) => {
        initialEdits[c.toolName] = {
          isEnabled: c.isEnabled,
          rateLimitPerMinute: c.rateLimitPerMinute,
          globalTimeoutMs: c.globalTimeoutMs,
          config: { ...c.config },
        };
      });
      setEditing(initialEdits);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleToggle = (toolName: string) => {
    setEditing((prev) => ({
      ...prev,
      [toolName]: {
        ...prev[toolName],
        isEnabled: !prev[toolName]?.isEnabled,
      },
    }));
  };

  const handleNumberChange = (toolName: string, field: 'rateLimitPerMinute' | 'globalTimeoutMs', value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    setEditing((prev) => ({
      ...prev,
      [toolName]: {
        ...prev[toolName],
        [field]: num,
      },
    }));
  };

  const handleSave = async (toolName: string) => {
    const edit = editing[toolName];
    if (!edit) return;

    setSaving((prev) => ({ ...prev, [toolName]: true }));
    setError(null);

    try {
      await updateToolConfig({
        toolName,
        isEnabled: edit.isEnabled ?? true,
        rateLimitPerMinute: edit.rateLimitPerMinute ?? 60,
        globalTimeoutMs: edit.globalTimeoutMs ?? 30000,
        config: edit.config ?? {},
      });
      await fetchConfigs();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving((prev) => ({ ...prev, [toolName]: false }));
    }
  };

  const hasChanges = (toolName: string, original: ToolAdminConfig): boolean => {
    const edit = editing[toolName];
    if (!edit) return false;
    return (
      edit.isEnabled !== original.isEnabled ||
      edit.rateLimitPerMinute !== original.rateLimitPerMinute ||
      edit.globalTimeoutMs !== original.globalTimeoutMs
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Wrench className="w-6 h-6 text-amber-600" />
          Tool Configuration
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage API tool settings, rate limits, and availability.
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading && configs.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map((config) => {
            const edit = editing[config.toolName] ?? {};
            const changed = hasChanges(config.toolName, config);

            return (
              <div
                key={config.toolName}
                className={`bg-white dark:bg-gray-800 rounded-xl border ${
                  changed ? 'border-amber-300 dark:border-amber-700' : 'border-gray-200 dark:border-gray-700'
                } p-6`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${edit.isEnabled ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-100 dark:bg-gray-700'}`}>
                      <Wrench className={`w-5 h-5 ${edit.isEnabled ? 'text-emerald-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white capitalize">
                        {config.toolName}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Last updated: {new Date(config.updatedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggle(config.toolName)}
                    className="flex items-center gap-2"
                    title={edit.isEnabled ? 'Disable tool' : 'Enable tool'}
                  >
                    {edit.isEnabled ? (
                      <ToggleRight className="w-8 h-8 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="w-8 h-8 text-gray-400" />
                    )}
                  </button>
                </div>

                {!edit.isEnabled && (
                  <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    This tool is currently disabled and will not be available to users.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      <Gauge className="w-4 h-4" />
                      Rate Limit (per minute)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={edit.rateLimitPerMinute ?? config.rateLimitPerMinute}
                      onChange={(e) => handleNumberChange(config.toolName, 'rateLimitPerMinute', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      <Clock className="w-4 h-4" />
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      max={300000}
                      step={1000}
                      value={edit.globalTimeoutMs ?? config.globalTimeoutMs}
                      onChange={(e) => handleNumberChange(config.toolName, 'globalTimeoutMs', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {changed && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSave(config.toolName)}
                      disabled={saving[config.toolName]}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                    >
                      {saving[config.toolName] ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Save Changes
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
