-- Shadow Brain — Phase 4: AI Business Partner
-- Database Migration 004
--
-- Tables:
--   experiments          — Experiment tracking (A/B tests, growth initiatives)
--   experiment_results   — Metric results per experiment
--   partner_api_keys     — API keys for external CRM/webhook integrations
--   market_research_cache — Cached research findings (deduplication & speed)
--   partner_audit_log    — Audit trail for all partner subsystem actions
--
-- Indexes and RLS policies included.

-- ── Enable Required Extensions ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy text search

-- ── Experiments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  description TEXT,
  owner TEXT, -- email
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'cancelled', 'archived')),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  control_group JSONB,
  treatment_group JSONB,
  primary_metric TEXT NOT NULL,
  secondary_metrics TEXT[] DEFAULT '{}',
  success_criteria TEXT,
  target_sample_size INTEGER,
  tags TEXT[] DEFAULT '{}',
  metrics JSONB DEFAULT '{}',
  notes TEXT,
  conclusion TEXT,
  recommendation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_owner ON experiments(owner);
CREATE INDEX IF NOT EXISTS idx_experiments_tags ON experiments USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiments_name_trgm ON experiments USING GIN(name gin_trgm_ops);

-- ── Experiment Results ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiment_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  control_value NUMERIC NOT NULL,
  treatment_value NUMERIC NOT NULL,
  uplift NUMERIC NOT NULL,
  p_value NUMERIC,
  confidence_interval NUMERIC[], -- [lower, upper]
  sample_size INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment_id ON experiment_results(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_results_recorded_at ON experiment_results(recorded_at DESC);

-- ── Partner API Keys (for CRM webhook auth, external integrations) ─────────
CREATE TABLE IF NOT EXISTS partner_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, -- bcrypt hash of the API key
  scopes TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_api_keys_key_hash ON partner_api_keys(key_hash);

-- ── Market Research Cache ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_research_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_hash TEXT NOT NULL UNIQUE, -- SHA-256 of normalized query
  query JSONB NOT NULL,
  report JSONB NOT NULL,
  findings_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_research_cache_query_hash ON market_research_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_market_research_cache_expires_at ON market_research_cache(expires_at);

-- ── Partner Audit Log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action TEXT NOT NULL, -- e.g., 'reasoning', 'sheets_write', 'crm_webhook', 'experiment_create'
  actor TEXT, -- user email or api key name
  entity_type TEXT, -- e.g., 'experiment', 'contact', 'deal', 'sheet'
  entity_id TEXT,
  payload JSONB,
  result TEXT, -- 'success' | 'failure'
  error_message TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_audit_log_action ON partner_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_partner_audit_log_entity ON partner_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_partner_audit_log_created_at ON partner_audit_log(created_at DESC);

-- ── Updated At Trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_experiments_updated_at ON experiments;
CREATE TRIGGER trg_experiments_updated_at
  BEFORE UPDATE ON experiments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security (RLS) ───────────────────────────────────────────────
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_research_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: experiments — owners see their own; admins see all
CREATE POLICY experiments_owner_select ON experiments
  FOR SELECT USING (auth.uid()::text = owner OR auth.role() = 'service_role');

CREATE POLICY experiments_owner_all ON experiments
  FOR ALL USING (auth.uid()::text = owner OR auth.role() = 'service_role');

-- Policy: experiment_results — cascade from experiments
CREATE POLICY experiment_results_select ON experiment_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM experiments e
      WHERE e.id = experiment_results.experiment_id
      AND (e.owner = auth.uid()::text OR auth.role() = 'service_role')
    )
  );

-- Policy: partner_api_keys — service_role only
CREATE POLICY partner_api_keys_service ON partner_api_keys
  FOR ALL USING (auth.role() = 'service_role');

-- Policy: market_research_cache — open read for cached data
CREATE POLICY market_research_cache_select ON market_research_cache
  FOR SELECT USING (true);

CREATE POLICY market_research_cache_service ON market_research_cache
  FOR ALL USING (auth.role() = 'service_role');

-- Policy: audit_log — append-only for all authenticated; read for service_role
CREATE POLICY partner_audit_log_insert ON partner_audit_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY partner_audit_log_select ON partner_audit_log
  FOR SELECT USING (auth.role() = 'service_role');

-- ── Comments ───────────────────────────────────────────────────────────────
COMMENT ON TABLE experiments IS 'Tracks business experiments, A/B tests, and growth initiatives.';
COMMENT ON TABLE experiment_results IS 'Statistical results for each experiment.';
COMMENT ON TABLE partner_api_keys IS 'API keys for CRM webhooks and external integrations.';
COMMENT ON TABLE market_research_cache IS '24-hour cache for market research queries to reduce API costs.';
COMMENT ON TABLE partner_audit_log IS 'Immutable audit trail for the AI Business Partner subsystem.';
