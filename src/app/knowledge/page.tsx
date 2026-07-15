/**
 * src/app/knowledge/page.tsx
 * Knowledge Base Management UI
 *
 * Server component that fetches the user's document list and renders:
 * - Upload area (drag-and-drop, client-side)
 * - Document table with status, size, type, chunks, actions
 * - Real-time status polling via client component
 */

import { createClient } from '@supabase/supabase-js';
import {
  FileText,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  HardDrive,
} from 'lucide-react';
import type { Document } from '@/types';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentActions } from './DocumentActions';

// ---------------------------------------------------------------------------
// Server-side data fetching
// ---------------------------------------------------------------------------

async function fetchDocuments(): Promise<(Document & { chunkCount: number })[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await sb
    .from('documents')
    .select('*, chunks(count)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    textContent: String(row.text_content || ''),
    metadata: (row.metadata as Record<string, unknown>) || {},
    status: row.status as Document['status'],
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    chunkCount: Number(row.chunks?.count || 0),
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default async function KnowledgePage() {
  const documents = await fetchDocuments();

  const totalDocs = documents.length;
  const completedDocs = documents.filter((d) => d.status === 'completed').length;
  const failedDocs = documents.filter((d) => d.status === 'failed').length;
  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Layers className="w-8 h-8 text-sky-500" />
            Knowledge Base
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Upload, manage, and monitor your documents. Supported formats: PDF, DOCX, TXT, MD.
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard
            title="Total Documents"
            value={totalDocs}
            icon={<FileText className="w-5 h-5 text-sky-500" />}
            trend="neutral"
          />
          <KpiCard
            title="Completed"
            value={completedDocs}
            icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
            trend="neutral"
          />
          <KpiCard
            title="Failed"
            value={failedDocs}
            icon={<AlertCircle className="w-5 h-5 text-red-500" />}
            trend={failedDocs > 0 ? 'down' : 'neutral'}
            alert={failedDocs > 0}
          />
          <KpiCard
            title="Total Chunks"
            value={totalChunks}
            icon={<HardDrive className="w-5 h-5 text-violet-500" />}
            trend="neutral"
          />
        </div>

        {/* Upload Area */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-sky-500" />
            Upload Document
          </h3>
          <DocumentUploadForm />
        </div>

        {/* Documents Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-500" />
              Documents
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Size</th>
                  <th className="px-6 py-3 font-medium">Chunks</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No documents yet. Upload your first file above.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} />
                  ))
                )}
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

function DocumentRow({ doc }: { doc: Document & { chunkCount: number } }) {
  const sizeMB = (doc.sizeBytes / 1024 / 1024).toFixed(2);

  const statusBadge = {
    pending: (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <Clock className="w-4 h-4" /> Pending
      </span>
    ),
    processing: (
      <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
        <RefreshCw className="w-4 h-4 animate-spin" /> Processing
      </span>
    ),
    running: (
      <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
        <RefreshCw className="w-4 h-4 animate-spin" /> Running
      </span>
    ),
    completed: (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-4 h-4" /> Completed
      </span>
    ),
    failed: (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400" title={doc.errorMessage}>
        <AlertCircle className="w-4 h-4" /> Failed
      </span>
    ),
  };

  const typeLabel = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'text/plain': 'TXT',
    'text/markdown': 'MD',
    'text/x-markdown': 'MD',
  }[doc.mimeType] || doc.mimeType;

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
      <td className="px-6 py-4 text-gray-900 dark:text-gray-100 font-medium max-w-xs truncate">
        {doc.fileName}
      </td>
      <td className="px-6 py-4">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
          {typeLabel}
        </span>
      </td>
      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{sizeMB} MB</td>
      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{doc.chunkCount}</td>
      <td className="px-6 py-4">{statusBadge[doc.status]}</td>
      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
        {new Date(doc.createdAt).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <DocumentActions documentId={doc.id} userId={doc.userId} />
        </div>
      </td>
    </tr>
  );
}
