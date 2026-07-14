-- ================================================================
-- Migration 008: Continuous Learning & Self-Improvement Engine
-- Phase 6: Feedback Loop, Preference Drift, Memory Consolidation,
--          Skill Discovery, Training Dataset Preparation
-- ================================================================

-- -----------------------------------------------------------------
-- 1. Feedback Entries
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    feedback TEXT NOT NULL CHECK (feedback IN ('positive', 'negative', 'neutral')),
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_message_id ON public.feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_feedback_conversation_id ON public.feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_tags ON public.feedback USING gin (tags);

-- -----------------------------------------------------------------
-- 2. Preference Snapshots
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preference_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}',
    source TEXT NOT NULL CHECK (source IN ('explicit', 'extracted', 'inferred')) DEFAULT 'inferred',
    confidence NUMERIC NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preference_snapshots_user_id ON public.preference_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_preference_snapshots_created_at ON public.preference_snapshots(created_at DESC);

-- -----------------------------------------------------------------
-- 3. Preference Drift Reports
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preference_drift_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    snapshot_ids UUID[] NOT NULL DEFAULT '{}',
    drifted_fields JSONB NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')) DEFAULT 'low',
    recommended_action TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drift_reports_user_id ON public.preference_drift_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_drift_reports_created_at ON public.preference_drift_reports(created_at DESC);

-- -----------------------------------------------------------------
-- 4. Memory Summaries (Consolidated Conversations)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memory_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    conversation_ids UUID[] NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL,
    key_facts TEXT[] NOT NULL DEFAULT '{}',
    topics TEXT[] NOT NULL DEFAULT '{}',
    namespace TEXT NOT NULL DEFAULT 'memory-summaries',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_summaries_user_id ON public.memory_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_namespace ON public.memory_summaries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_created_at ON public.memory_summaries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_topics ON public.memory_summaries USING gin (topics);

-- -----------------------------------------------------------------
-- 5. Discovered Skills
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discovered_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    evidence TEXT[] NOT NULL DEFAULT '{}',
    category TEXT NOT NULL DEFAULT 'other',
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    status TEXT NOT NULL CHECK (status IN ('discovered', 'evaluated', 'implemented', 'rejected')) DEFAULT 'discovered',
    implementation_notes TEXT,
    confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_discovered_skills_user_id ON public.discovered_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_discovered_skills_status ON public.discovered_skills(status);
CREATE INDEX IF NOT EXISTS idx_discovered_skills_priority ON public.discovered_skills(priority);
CREATE INDEX IF NOT EXISTS idx_discovered_skills_category ON public.discovered_skills(category);
CREATE INDEX IF NOT EXISTS idx_discovered_skills_created_at ON public.discovered_skills(created_at DESC);

-- -----------------------------------------------------------------
-- 6. Training Examples
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    messages JSONB NOT NULL DEFAULT '[]',
    feedback_id UUID REFERENCES public.feedback(id) ON DELETE SET NULL,
    quality_score NUMERIC NOT NULL DEFAULT 0.5 CHECK (quality_score >= 0 AND quality_score <= 1),
    tags TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_examples_user_id ON public.training_examples(user_id);
CREATE INDEX IF NOT EXISTS idx_training_examples_conversation_id ON public.training_examples(conversation_id);
CREATE INDEX IF NOT EXISTS idx_training_examples_quality ON public.training_examples(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_training_examples_tags ON public.training_examples USING gin (tags);

-- -----------------------------------------------------------------
-- 7. Training Datasets
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    example_ids UUID[] NOT NULL DEFAULT '{}',
    format TEXT NOT NULL CHECK (format IN ('openai', 'anthropic', 'generic')) DEFAULT 'openai',
    quality_threshold NUMERIC NOT NULL DEFAULT 0.7 CHECK (quality_threshold >= 0 AND quality_threshold <= 1),
    tag_filter TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exported_at TIMESTAMPTZ,
    file_size_bytes INT DEFAULT 0,
    file_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_datasets_user_id ON public.training_datasets(user_id);
CREATE INDEX IF NOT EXISTS idx_training_datasets_created_at ON public.training_datasets(created_at DESC);

-- -----------------------------------------------------------------
-- 8. Auto-update updated_at triggers for tables with updated_at
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_discovered_skills_updated_at ON public.discovered_skills;
CREATE TRIGGER trg_discovered_skills_updated_at
    BEFORE UPDATE ON public.discovered_skills
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------
-- 9. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preference_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preference_drift_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovered_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_datasets ENABLE ROW LEVEL SECURITY;

-- For authenticated users (production: replace with user-specific policies)
CREATE POLICY feedback_all ON public.feedback
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY preference_snapshots_all ON public.preference_snapshots
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY drift_reports_all ON public.preference_drift_reports
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY memory_summaries_all ON public.memory_summaries
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY discovered_skills_all ON public.discovered_skills
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY training_examples_all ON public.training_examples
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY training_datasets_all ON public.training_datasets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------
-- 10. Comments for documentation
-- -----------------------------------------------------------------
COMMENT ON TABLE public.feedback IS 'User feedback (thumbs up/down, ratings, comments) on AI responses';
COMMENT ON TABLE public.preference_snapshots IS 'Periodic snapshots of user preferences for drift detection';
COMMENT ON TABLE public.preference_drift_reports IS 'Reports generated when preference drift is detected between snapshots';
COMMENT ON TABLE public.memory_summaries IS 'LLM-generated summaries of consolidated old conversations for long-term memory';
COMMENT ON TABLE public.discovered_skills IS 'Skills or capabilities identified as needed by the user through conversation analysis';
COMMENT ON TABLE public.training_examples IS 'Individual conversation examples curated for fine-tuning';
COMMENT ON TABLE public.training_datasets IS 'Exported collections of training examples ready for fine-tuning pipelines';
