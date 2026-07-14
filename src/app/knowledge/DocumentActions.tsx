'use client';

/**
 * src/app/knowledge/DocumentActions.tsx
 * Client-side delete button for knowledge base documents.
 */

import { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';

interface DocumentActionsProps {
  documentId: string;
  userId: string;
}

export function DocumentActions({ documentId, userId }: DocumentActionsProps) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this document and all its chunks?')) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, userId }),
      });

      const json = await res.json().catch(() => ({ error: 'Unknown error' }));

      if (!res.ok) {
        throw new Error(json.error || json.details || 'Delete failed');
      }

      window.location.reload();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors disabled:opacity-50"
      title="Delete document"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
    </button>
  );
}
