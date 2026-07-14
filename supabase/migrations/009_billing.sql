-- Shadow Brain Billing & Monetization Schema
-- Creates tables for Stripe subscriptions, invoices, and usage tracking.
-- Supports Free / Pro / Enterprise tiers with metered billing.

-- ---------------------------------------------------------------------------
-- Enum helpers (as text check constraints for portability)
-- ---------------------------------------------------------------------------

-- Subscription tier definitions
CREATE TABLE IF NOT EXISTS public.subscription_tiers (
    id TEXT PRIMARY KEY CHECK (id IN ('free', 'pro', 'enterprise')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    stripe_price_id TEXT,
    monthly_price_cents INTEGER NOT NULL DEFAULT 0,
    yearly_price_cents INTEGER,
    features JSONB NOT NULL DEFAULT '{}',
    limits JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default tiers
INSERT INTO public.subscription_tiers (id, name, description, monthly_price_cents, features, limits)
VALUES
    ('free', 'Free', 'Personal use with basic limits.', 0,
     '{"ai_messages":500,"storage_mb":100,"integrations":2,"support":"community","analytics":false}'::jsonb,
     '{"ai_messages_per_month":500,"storage_mb":100,"max_integrations":2,"max_team_members":1}'::jsonb),
    ('pro', 'Pro', 'Power users and small teams.', 2900,
     '{"ai_messages":10000,"storage_mb":5000,"integrations":10,"support":"email","analytics":true,"api_access":true}'::jsonb,
     '{"ai_messages_per_month":10000,"storage_mb":5000,"max_integrations":10,"max_team_members":5}'::jsonb),
    ('enterprise', 'Enterprise', 'Custom plans for large organizations.', 0,
     '{"ai_messages":-1,"storage_mb":-1,"integrations":-1,"support":"dedicated","analytics":true,"api_access":true,"sso":true,"audit_logs":true}'::jsonb,
     '{"ai_messages_per_month":-1,"storage_mb":-1,"max_integrations":-1,"max_team_members":-1}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    tier_id TEXT NOT NULL REFERENCES public.subscription_tiers(id) ON DELETE RESTRICT,

    -- Stripe fields
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,
    stripe_product_id TEXT,

    -- Billing cycle
    status TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,

    -- Stripe fields
    stripe_invoice_id TEXT UNIQUE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_charge_id TEXT,

    -- Invoice details
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'open', 'paid', 'uncollectible', 'void')),
    currency TEXT NOT NULL DEFAULT 'usd',
    amount_due_cents INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    amount_remaining_cents INTEGER NOT NULL DEFAULT 0,
    invoice_pdf_url TEXT,
    invoice_number TEXT,
    description TEXT,

    -- Period
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    due_date TIMESTAMPTZ,

    -- Metadata
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription_id ON public.invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_invoice_id ON public.invoices(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON public.invoices(created_at DESC);

-- ---------------------------------------------------------------------------
-- Usage Tracking (metered billing)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.usage_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,

    -- Metric
    metric_name TEXT NOT NULL,
    metric_value NUMERIC NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'count',

    -- Billing period context
    billing_period_start TIMESTAMPTZ NOT NULL,
    billing_period_end TIMESTAMPTZ NOT NULL,

    -- Source / context
    source TEXT NOT NULL DEFAULT 'api',
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_id ON public.usage_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_subscription_id ON public.usage_tracking(subscription_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_metric_name ON public.usage_tracking(metric_name);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_period ON public.usage_tracking(billing_period_start, billing_period_end);

-- ---------------------------------------------------------------------------
-- Usage Aggregates (pre-computed for fast tier limit checks)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.usage_aggregates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,

    metric_name TEXT NOT NULL,
    total_value NUMERIC NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'count',

    billing_period_start TIMESTAMPTZ NOT NULL,
    billing_period_end TIMESTAMPTZ NOT NULL,

    last_event_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, metric_name, billing_period_start, billing_period_end)
);

CREATE INDEX IF NOT EXISTS idx_usage_aggregates_lookup ON public.usage_aggregates(user_id, metric_name, billing_period_start, billing_period_end);

-- ---------------------------------------------------------------------------
-- Functions & Triggers
-- ---------------------------------------------------------------------------

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoices_updated_at ON public.invoices;
CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_usage_aggregates_updated_at ON public.usage_aggregates;
CREATE TRIGGER update_usage_aggregates_updated_at
    BEFORE UPDATE ON public.usage_aggregates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscription_tiers_updated_at ON public.subscription_tiers;
CREATE TRIGGER update_subscription_tiers_updated_at
    BEFORE UPDATE ON public.subscription_tiers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Upsert usage aggregate on new usage_tracking insert
CREATE OR REPLACE FUNCTION public.upsert_usage_aggregate()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.usage_aggregates (
        user_id, subscription_id, metric_name, total_value, unit,
        billing_period_start, billing_period_end, last_event_at, updated_at
    )
    VALUES (
        NEW.user_id, NEW.subscription_id, NEW.metric_name, NEW.metric_value, NEW.unit,
        NEW.billing_period_start, NEW.billing_period_end, NEW.created_at, NOW()
    )
    ON CONFLICT (user_id, metric_name, billing_period_start, billing_period_end)
    DO UPDATE SET
        total_value = public.usage_aggregates.total_value + EXCLUDED.total_value,
        last_event_at = EXCLUDED.last_event_at,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_upsert_usage_aggregate ON public.usage_tracking;
CREATE TRIGGER trigger_upsert_usage_aggregate
    AFTER INSERT ON public.usage_tracking
    FOR EACH ROW
    EXECUTE FUNCTION public.upsert_usage_aggregate();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ---------------------------------------------------------------------------

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;

-- Allow all users to read tiers (needed for pricing page)
DROP POLICY IF EXISTS "Tiers are readable by all" ON public.subscription_tiers;
CREATE POLICY "Tiers are readable by all" ON public.subscription_tiers
    FOR SELECT USING (TRUE);

-- Users can only see their own subscriptions
DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage subscriptions" ON public.subscriptions;
CREATE POLICY "Service role can manage subscriptions" ON public.subscriptions
    FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Users can only see their own invoices
DROP POLICY IF EXISTS "Users can view own invoices" ON public.invoices;
CREATE POLICY "Users can view own invoices" ON public.invoices
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage invoices" ON public.invoices;
CREATE POLICY "Service role can manage invoices" ON public.invoices
    FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Users can only see their own usage
DROP POLICY IF EXISTS "Users can view own usage" ON public.usage_tracking;
CREATE POLICY "Users can view own usage" ON public.usage_tracking
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage usage" ON public.usage_tracking;
CREATE POLICY "Service role can manage usage" ON public.usage_tracking
    FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Users can view own aggregates" ON public.usage_aggregates;
CREATE POLICY "Users can view own aggregates" ON public.usage_aggregates
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage aggregates" ON public.usage_aggregates;
CREATE POLICY "Service role can manage aggregates" ON public.usage_aggregates
    FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.subscription_tiers IS 'Stripe-linked subscription tiers (Free, Pro, Enterprise) with feature gates and limits.';
COMMENT ON TABLE public.subscriptions IS 'User subscription records synced from Stripe.';
COMMENT ON TABLE public.invoices IS 'Stripe invoice mirror for billing history.';
COMMENT ON TABLE public.usage_tracking IS 'Granular metered usage events for AI messages, storage, and API calls.';
COMMENT ON TABLE public.usage_aggregates IS 'Pre-aggregated usage totals per billing period for fast limit enforcement.';
