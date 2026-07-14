-- ================================================================
-- Migration 005: AI CEO Office Schema
-- Phase 5: Multi-Agent Graph, Knowledge Graph, Workflow Engine,
--          SIEM-lite, Executive Briefings
-- ================================================================

-- -----------------------------------------------------------------
-- 1. Knowledge Graph: Entities
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kg_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable fuzzy text search on entity names
CREATE INDEX IF NOT EXISTS idx_kg_entities_name_trgm
    ON kg_entities USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_kg_entities_type
    ON kg_entities (type);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_kg_entities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kg_entities_updated_at ON kg_entities;
CREATE TRIGGER trg_kg_entities_updated_at
    BEFORE UPDATE ON kg_entities
    FOR EACH ROW
    EXECUTE FUNCTION update_kg_entities_updated_at();

-- -----------------------------------------------------------------
-- 2. Knowledge Graph: Relations
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kg_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_relations_source
    ON kg_relations (source_id);

CREATE INDEX IF NOT EXISTS idx_kg_relations_target
    ON kg_relations (target_id);

CREATE INDEX IF NOT EXISTS idx_kg_relations_type
    ON kg_relations (type);

-- -----------------------------------------------------------------
-- 3. Knowledge Graph: Triples (canonical S-P-O representation)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kg_triples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    predicate TEXT NOT NULL,
    object_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (subject_id, predicate, object_id)
);

CREATE INDEX IF NOT EXISTS idx_kg_triples_subject
    ON kg_triples (subject_id);

CREATE INDEX IF NOT EXISTS idx_kg_triples_predicate
    ON kg_triples (predicate);

CREATE INDEX IF NOT EXISTS idx_kg_triples_object
    ON kg_triples (object_id);

-- -----------------------------------------------------------------
-- 4. Workflow Definitions
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    nodes JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_workflows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflows_updated_at ON workflows;
CREATE TRIGGER trg_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_workflows_updated_at();

-- -----------------------------------------------------------------
-- 5. Workflow Executions
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused')),
    current_node_id TEXT,
    context JSONB DEFAULT '{}',
    node_results JSONB DEFAULT '{}',
    error_log JSONB DEFAULT '[]',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_exec_status
    ON workflow_executions (status);

CREATE INDEX IF NOT EXISTS idx_workflow_exec_workflow
    ON workflow_executions (workflow_id);

-- -----------------------------------------------------------------
-- 6. Security Events (SIEM)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    source TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_severity
    ON security_events (severity);

CREATE INDEX IF NOT EXISTS idx_security_events_source
    ON security_events (source);

CREATE INDEX IF NOT EXISTS idx_security_events_created
    ON security_events (created_at DESC);

-- -----------------------------------------------------------------
-- 7. SIEM Alert Rules
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS siem_alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    severity_threshold TEXT NOT NULL CHECK (severity_threshold IN ('low', 'medium', 'high', 'critical')),
    source_pattern TEXT,
    window_minutes INT NOT NULL DEFAULT 60,
    count_threshold INT NOT NULL DEFAULT 5,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_siem_alert_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_siem_alert_rules_updated_at ON siem_alert_rules;
CREATE TRIGGER trg_siem_alert_rules_updated_at
    BEFORE UPDATE ON siem_alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_siem_alert_rules_updated_at();

-- -----------------------------------------------------------------
-- 8. SIEM Alerts (generated by rule evaluation)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS siem_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES siem_alert_rules(id) ON DELETE CASCADE,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    message TEXT NOT NULL,
    event_ids JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_siem_alerts_unacknowledged
    ON siem_alerts (created_at DESC)
    WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_siem_alerts_rule
    ON siem_alerts (rule_id);

-- -----------------------------------------------------------------
-- 9. Executive Briefings
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS executive_briefings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'event', 'ad_hoc')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    sections JSONB NOT NULL DEFAULT '[]',
    generated_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_exec_briefings_user
    ON executive_briefings (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_briefings_type
    ON executive_briefings (type, generated_at DESC);

-- -----------------------------------------------------------------
-- 10. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_triples ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE siem_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE siem_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_briefings ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations for authenticated users.
-- In production, replace with user-specific or role-based policies.

CREATE POLICY kg_entities_all ON kg_entities
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY kg_relations_all ON kg_relations
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY kg_triples_all ON kg_triples
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY workflows_all ON workflows
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY workflow_executions_all ON workflow_executions
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY security_events_all ON security_events
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY siem_alert_rules_all ON siem_alert_rules
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY siem_alerts_all ON siem_alerts
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY executive_briefings_all ON executive_briefings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------
-- 11. Comments for documentation
-- -----------------------------------------------------------------

COMMENT ON TABLE kg_entities IS 'Knowledge graph nodes representing real-world entities (people, companies, products, etc.)';
COMMENT ON TABLE kg_relations IS 'Typed edges between entities in the knowledge graph';
COMMENT ON TABLE kg_triples IS 'Canonical subject-predicate-object triples for semantic querying';
COMMENT ON TABLE workflows IS 'Workflow definitions (DAGs) for the workflow engine';
COMMENT ON TABLE workflow_executions IS 'Runtime state of workflow instances';
COMMENT ON TABLE security_events IS 'Raw security events ingested by SIEM-lite';
COMMENT ON TABLE siem_alert_rules IS 'Threshold-based rules for automated alerting';
COMMENT ON TABLE siem_alerts IS 'Correlated alerts generated by SIEM rule evaluation';
COMMENT ON TABLE executive_briefings IS 'Generated executive briefings combining agent outputs, SIEM, and knowledge graph';
