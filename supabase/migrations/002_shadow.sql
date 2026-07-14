-- Migration: 002_shadow.sql
-- Phase 2: Digital Shadow Self
-- User preference extraction, memory metadata, pipeline observability, and evaluation tracking.

-- ------------------------------------------------------------------
-- 1. User Preferences Table
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Extracted preference fields
  tone text,
  verbosity text,
  response_style text,
  timezone text DEFAULT 'UTC',
  language text DEFAULT 'en',
  topics_of_interest text[] DEFAULT '{}',
  industries text[] DEFAULT '{}',

  -- Raw JSON for forward compatibility and audit
  raw_json jsonb DEFAULT '{}',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT user_preferences_user_id_unique UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences"
  ON public.user_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 2. Memory Metadata Table
-- ------------------------------------------------------------------
-- Tracks vectors stored in Pinecone for audit, recovery, and listing.
CREATE TABLE IF NOT EXISTS public.memory_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  namespace text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',
  pinecone_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_metadata_user_id
  ON public.memory_metadata(user_id);

ALTER TABLE public.memory_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own memory metadata"
  ON public.memory_metadata
  FOR SELECT
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 3. Shadow Pipeline Runs Table
-- ------------------------------------------------------------------
-- Observability log for each pipeline execution.
CREATE TABLE IF NOT EXISTS public.shadow_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error text,
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_status
  ON public.shadow_pipeline_runs(user_id, status);

ALTER TABLE public.shadow_pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pipeline runs"
  ON public.shadow_pipeline_runs
  FOR SELECT
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 4. Shadow Evaluations Table
-- ------------------------------------------------------------------
-- Stores evaluation run results for the extraction engine.
CREATE TABLE IF NOT EXISTS public.shadow_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz DEFAULT now(),
  passed boolean NOT NULL DEFAULT false,
  metrics jsonb DEFAULT '{}',
  details jsonb DEFAULT '{}'
);

ALTER TABLE public.shadow_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read evaluations"
  ON public.shadow_evaluations
  FOR SELECT
  USING (true);

-- ------------------------------------------------------------------
-- 5. Utility: Auto-update updated_at column
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_preferences_updated_at
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
