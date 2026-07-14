-- Migration: 007_upload.sql
-- Upload & Knowledge Base Schema
-- Tables: documents, chunks, ingest_jobs, learning_reports

-- ---------------------------------------------------------------------------
-- 1. Documents Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  text_content TEXT DEFAULT NULL,
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Chunks Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  index INTEGER NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  pinecone_id TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Ingest Jobs Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  stage TEXT NOT NULL DEFAULT 'upload',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error_message TEXT DEFAULT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Learning Reports Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  memories_consolidated INTEGER NOT NULL DEFAULT 0,
  vectors_re_embedded INTEGER NOT NULL DEFAULT 0,
  preferences_extracted JSONB DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON public.chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON public.chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_pinecone_id ON public.chunks(pinecone_id);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_document_id ON public.ingest_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON public.ingest_jobs(status);

CREATE INDEX IF NOT EXISTS idx_learning_reports_user_id ON public.learning_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_reports_date ON public.learning_reports(report_date);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own documents"
  ON public.documents
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own chunks"
  ON public.chunks
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own ingest jobs"
  ON public.ingest_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own learning reports"
  ON public.learning_reports
  FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. Triggers for updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ingest_jobs_updated_at
  BEFORE UPDATE ON public.ingest_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
