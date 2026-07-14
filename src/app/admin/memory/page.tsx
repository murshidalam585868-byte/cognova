/**
 * src/app/admin/memory/page.tsx
 * Memory Browser
 *
 * Features:
 *   - Paginated memory entry table
 *   - Filter by user ID and namespace
 *   - Search by content
 *   - Delete memory entries (with permission check)
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Brain, ChevronLeft, ChevronRight, Loader2, Trash2, Tag } from 'lucide-react';
import { listMemories, deleteMemory } from '@/lib/admin/actions';
import type { MemoryEntry } from '@/types';

export default function MemoryPage(): React.ReactElement {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [userId, setUserId] = useState('');
  const [namespace, setNamespace] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMemories({
        page,
        perPage,
        userId: userId || undefined,
        namespace: namespace || undefined,
        search: search || undefined,
      });
      setMemories(res.memories);
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, perPage, userId, namespace, search]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory entry?')) return;
    setDeletingId(id);
    try {
      await deleteMemory({ memoryId: id });
      await fetchMemories();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-violet-600" />
          Memory Browser
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Inspect and manage vector memory entries across users.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search content..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <input
          type="text"
          placeholder="Filter by user ID..."
          value={userId}
          onChange={(e) => { setUserId(e.target.value); setPage(1); }}
          className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <input
          type="text"
          placeholder="Namespace..."
          value={namespace}
          onChange={(e) => { setNamespace(e.target.value); setPage(1); }}
          className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400">
              <tr>
                <th className="px-6 py-3 font-medium">Content</th>
                <th className="px-6 py-3 font-medium">Namespace</th>
                <th className="px-6 py-3 font-medium">User ID</th>
                <th className="px-6 py-3 font-medium">Created</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && memories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                  </td>
                </tr>
              ) : memories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    No memory entries found.
                  </td>
                </tr>
              ) : (
                memories.map((mem) => (
                  <tr key={mem.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-6 py-3">
                      <p className="text-gray-900 dark:text-white max-w-md truncate" title={mem.content}>
                        {mem.content}
                      </p>
                      {mem.metadata && Object.keys(mem.metadata).length > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {JSON.stringify(mem.metadata).slice(0, 80)}...
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-medium">
                        <Tag className="w-3 h-3" />
                        {mem.namespace}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">
                      {mem.userId.slice(0, 8)}...
                    </td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(mem.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => handleDelete(mem.id)}
                        disabled={deletingId === mem.id}
                        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Delete memory"
                      >
                        {deletingId === mem.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {page} of {totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
