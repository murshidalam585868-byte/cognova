'use client';

/**
 * src/app/knowledge/DocumentUploadForm.tsx
 * Client-side upload form with drag-and-drop, progress feedback, and status polling.
 */

import { useState, useCallback } from 'react';
import { Upload, FileText, X, CheckCircle2, AlertCircle } from 'lucide-react';

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  fileName?: string;
  message?: string;
  documentId?: string;
}

const SUPPORTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
];

const MAX_SIZE_MB = 50;

export function DocumentUploadForm() {
  const [dragActive, setDragActive] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [userId, setUserId] = useState('');

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!userId) {
      setUploadState({ status: 'error', message: 'Please enter a User ID before uploading.' });
      return;
    }

    if (!SUPPORTED_TYPES.includes(file.type)) {
      setUploadState({
        status: 'error',
        fileName: file.name,
        message: 'Unsupported file type. Please upload PDF, DOCX, TXT, or MD.',
      });
      return;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setUploadState({
        status: 'error',
        fileName: file.name,
        message: `File too large. Maximum size is ${MAX_SIZE_MB} MB.`,
      });
      return;
    }

    setUploadState({ status: 'uploading', fileName: file.name });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json().catch(() => ({ error: 'Invalid JSON response' }));

      if (!res.ok) {
        throw new Error(json.error || json.details || `Upload failed (${res.status})`);
      }

      setUploadState({
        status: 'success',
        fileName: file.name,
        documentId: json.documentId,
        message: `Uploaded with ${json.chunkCount} chunks.`,
      });

      // Refresh the page after a short delay to show the new document
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setUploadState({
        status: 'error',
        fileName: file.name,
        message: (err as Error).message,
      });
    }
  }, [userId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]);
    }
  }, [handleFile]);

  return (
    <div className="space-y-4">
      {/* User ID Input */}
      <div className="flex items-center gap-3">
        <label htmlFor="userId" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          User ID
        </label>
        <input
          id="userId"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
          className="flex-1 max-w-md px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      {/* Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${dragActive
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
            : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30'
          }
        `}
      >
        <input
          id="file-upload"
          type="file"
          accept=".pdf,.docx,.txt,.md"
          onChange={handleFileInput}
          className="hidden"
        />
        <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-3">
          <Upload className="w-10 h-10 text-gray-400 dark:text-gray-500" />
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              <span className="text-sky-600 dark:text-sky-400">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              PDF, DOCX, TXT, or MD (max {MAX_SIZE_MB} MB)
            </p>
          </div>
        </label>
      </div>

      {/* Status Feedback */}
      {uploadState.status !== 'idle' && (
        <div
          className={`
            flex items-center gap-3 rounded-md p-3 text-sm
            ${uploadState.status === 'uploading' && 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'}
            ${uploadState.status === 'success' && 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'}
            ${uploadState.status === 'error' && 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}
          `}
        >
          {uploadState.status === 'uploading' && <FileText className="w-5 h-5 animate-pulse" />}
          {uploadState.status === 'success' && <CheckCircle2 className="w-5 h-5" />}
          {uploadState.status === 'error' && <AlertCircle className="w-5 h-5" />}

          <div className="flex-1">
            <p className="font-medium">
              {uploadState.fileName && `${uploadState.fileName} — `}
              {uploadState.status === 'uploading' && 'Uploading...'}
              {uploadState.status === 'success' && 'Success'}
              {uploadState.status === 'error' && 'Error'}
            </p>
            {uploadState.message && (
              <p className="text-xs opacity-90 mt-0.5">{uploadState.message}</p>
            )}
          </div>

          <button
            onClick={() => setUploadState({ status: 'idle' })}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
