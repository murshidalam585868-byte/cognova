-- =============================================================================
-- Shadow Brain — Phase 3: Chief of Staff Migration
-- Description: RSS/news ingestion, job queue, digest engine, BI dashboard
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. RSS Feed Sources Registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rss_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'general',
    is_active BOOLEAN NOT NULL DEFAULT true,
    fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_fetched_at TIMESTAMPTZ,
    last_etag TEXT,
    last_modified TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rss_sources IS 'Registered RSS/news feed sources for the Chief of Staff ingestion pipeline';

-- Default seed sources (business, tech, finance)
INSERT INTO public.rss_sources (name, url, category, fetch_interval_minutes)
VALUES
    ('TechCrunch', 'https://techcrunch.com/feed/', 'technology', 60),
    ('Reuters Business', 'https://www.reutersagency.com/feed/?taxonomy=markets&post_type=reuters-best', 'business', 60),
    ('WSJ Tech', 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml', 'business', 120),
    ('The Verge', 'https://www.theverge.com/rss/index.xml', 'technology', 60),
    ('Harvard Business Review', 'https://hbr.org/rss/articles', 'business', 240),
    ('Ars Technica', 'https://arstechnica.com/feed/', 'technology', 60)
ON CONFLICT (url) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. News Items (Ingested Articles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.news_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source_id UUID REFERENCES public.rss_sources(id) ON DELETE SET NULL,
    source_name TEXT,
    summary TEXT,
    content TEXT,
    author TEXT,
    category TEXT NOT NULL DEFAULT 'general',
    tags TEXT[] DEFAULT '{}',
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    embedding vector(1536),              -- Optional: for semantic search / similarity
    metadata JSONB DEFAULT '{}',
    is_processed BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(url)
);

COMMENT ON TABLE public.news_items IS 'Individual news articles ingested from RSS and news APIs';

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_news_items_source ON public.news_items(source_id);
CREATE INDEX IF NOT EXISTS idx_news_items_category ON public.news_items(category);
CREATE INDEX IF NOT EXISTS idx_news_items_fetched_at ON public.news_items(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON public.news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_processed ON public.news_items(is_processed) WHERE is_processed = false;
CREATE INDEX IF NOT EXISTS idx_news_items_tags ON public.news_items USING gin(tags);

-- Full-text search support (if available; falls back to trigram)
CREATE INDEX IF NOT EXISTS idx_news_items_fts ON public.news_items
    USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'')));

-- ---------------------------------------------------------------------------
-- 3. Digests (Generated Intelligence Briefings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'event')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT[] NOT NULL DEFAULT '{}',
    news_item_ids UUID[] DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.digests IS 'Generated intelligence digests delivered to users';

CREATE INDEX IF NOT EXISTS idx_digests_user ON public.digests(user_id);
CREATE INDEX IF NOT EXISTS idx_digests_type ON public.digests(type);
CREATE INDEX IF NOT EXISTS idx_digests_created_at ON public.digests(created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Job Queue (pg-boss compatible schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'completed', 'failed', 'cancelled', 'retry')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    priority INTEGER NOT NULL DEFAULT 0,
    output JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_queue IS 'Serverless-compatible job queue for async task processing';

CREATE INDEX IF NOT EXISTS idx_job_queue_state_scheduled ON public.job_queue(state, scheduled_for)
    WHERE state IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_job_queue_name ON public.job_queue(name);
CREATE INDEX IF NOT EXISTS idx_job_queue_created_at ON public.job_queue(created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Dashboard Metrics (Time-Series for BI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name TEXT NOT NULL,
    metric_value NUMERIC NOT NULL,
    dimension TEXT,
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dashboard_metrics IS 'Time-series metrics for the BI dashboard';

CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_name_time ON public.dashboard_metrics(metric_name, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_dimension ON public.dashboard_metrics(dimension);

-- ---------------------------------------------------------------------------
-- 6. Digest Subscriptions (Per-User Preferences)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.digest_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'daily' CHECK (type IN ('daily', 'weekly', 'event')),
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    channels JSONB NOT NULL DEFAULT '["email","slack"]', -- array of delivery channels
    schedule_cron TEXT NOT NULL DEFAULT '0 7 * * *',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    categories TEXT[] DEFAULT '{"general","business","technology"}',
    max_items INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, type)
);

COMMENT ON TABLE public.digest_subscriptions IS 'User subscriptions for automated digest delivery';

CREATE INDEX IF NOT EXISTS idx_digest_subscriptions_user ON public.digest_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_digest_subscriptions_enabled ON public.digest_subscriptions(is_enabled) WHERE is_enabled = true;

-- ---------------------------------------------------------------------------
-- 7. Row Level Security (RLS) Policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_subscriptions ENABLE ROW LEVEL SECURITY;

-- News items: readable by all authenticated users (shared intelligence)
CREATE POLICY "news_items_select_all" ON public.news_items
    FOR SELECT USING (true);

-- Digests: users can only see their own
CREATE POLICY "digests_select_own" ON public.digests
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "digests_insert_own" ON public.digests
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "digests_update_own" ON public.digests
    FOR UPDATE USING (auth.uid() = user_id);

-- Dashboard metrics: readable by all authenticated users
CREATE POLICY "dashboard_metrics_select_all" ON public.dashboard_metrics
    FOR SELECT USING (true);

-- Digest subscriptions: users manage their own
CREATE POLICY "digest_subscriptions_select_own" ON public.digest_subscriptions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "digest_subscriptions_insert_own" ON public.digest_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "digest_subscriptions_update_own" ON public.digest_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "digest_subscriptions_delete_own" ON public.digest_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 8. Helper Functions
-- ---------------------------------------------------------------------------

-- Atomic job fetch-and-lock (dequeue next available job)
CREATE OR REPLACE FUNCTION public.fetch_and_lock_job(job_name TEXT)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.job_queue
    SET state = 'active', started_at = now()
    WHERE id = (
        SELECT id FROM public.job_queue
        WHERE name = job_name
          AND state IN ('pending', 'retry')
          AND scheduled_for <= now()
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
END;
$$;

-- Complete a job
CREATE OR REPLACE FUNCTION public.complete_job(job_id UUID, job_output JSONB DEFAULT '{}')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.job_queue
    SET state = 'completed', output = job_output, completed_at = now()
    WHERE id = job_id;
END;
$$;

-- Fail a job with optional retry
CREATE OR REPLACE FUNCTION public.fail_job(job_id UUID, err_message TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    j public.job_queue%ROWTYPE;
BEGIN
    SELECT * INTO j FROM public.job_queue WHERE id = job_id;
    IF j.retry_count < j.max_retries THEN
        UPDATE public.job_queue
        SET state = 'retry', retry_count = retry_count + 1, error_message = err_message,
            scheduled_for = now() + (retry_count + 1) * interval '5 minutes'
        WHERE id = job_id;
    ELSE
        UPDATE public.job_queue
        SET state = 'failed', error_message = err_message, completed_at = now()
        WHERE id = job_id;
    END IF;
END;
$$;

-- Record a dashboard metric (convenience wrapper)
CREATE OR REPLACE FUNCTION public.record_metric(
    p_metric_name TEXT,
    p_metric_value NUMERIC,
    p_dimension TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.dashboard_metrics (metric_name, metric_value, dimension, metadata)
    VALUES (p_metric_name, p_metric_value, p_dimension, p_metadata);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Triggers: Auto-update updated_at columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_rss_sources
    BEFORE UPDATE ON public.rss_sources
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_digests
    BEFORE UPDATE ON public.digests
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TRIGGER set_timestamp_digest_subscriptions
    BEFORE UPDATE ON public.digest_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
