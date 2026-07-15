/**
 * SIEM-lite — Security Information and Event Management (Lightweight)
 *
 * Ingests security events, correlates them, assigns severity, and
 * triggers alerts when thresholds are breached. Backed by Supabase.
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import type { SecurityEvent } from '@/types';

// ------------------------------------------------------------------
// Schemas
// ------------------------------------------------------------------

export const SIEMEventInputSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  source: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  metadata: z.record(z.unknown()).default({}),
});

export type SIEMEventInput = z.infer<typeof SIEMEventInputSchema>;

export const AlertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  severityThreshold: z.enum(['low', 'medium', 'high', 'critical']),
  sourcePattern: z.string().optional(), // regex or substring match
  windowMinutes: z.number().int().min(1).max(1440).default(60),
  countThreshold: z.number().int().min(1).default(5),
  enabled: z.boolean().default(true),
});

export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const SIEMAlertSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().uuid(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  message: z.string(),
  eventIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().optional(),
});

export type SIEMAlert = z.infer<typeof SIEMAlertSchema>;

// ------------------------------------------------------------------
// SIEM Engine
// ------------------------------------------------------------------

export class SIEMEngine {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    if (client) {
      this.client = client;
    } else {
      const config = loadConfig();
      this.client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: { persistSession: false },
      });
    }
  }

  // ------------------ Event Ingestion ------------------

  /**
   * Ingest a security event into the SIEM.
   */
  async ingestEvent(input: SIEMEventInput): Promise<SecurityEvent> {
    const validated = SIEMEventInputSchema.parse(input);
    const { data, error } = await this.client
      .from('security_events')
      .insert({
        severity: validated.severity,
        source: validated.source,
        description: validated.description,
        metadata: validated.metadata,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to ingest event: ${error.message}`);
    return data as SecurityEvent;
  }

  /**
   * Batch ingest multiple events.
   */
  async ingestBatch(inputs: SIEMEventInput[]): Promise<SecurityEvent[]> {
    const rows = inputs.map((i) => SIEMEventInputSchema.parse(i));
    const { data, error } = await this.client
      .from('security_events')
      .insert(rows)
      .select();

    if (error) throw new Error(`Failed to ingest batch: ${error.message}`);
    return (data ?? []) as SecurityEvent[];
  }

  // ------------------ Query & Analysis ------------------

  /**
   * Query events with filters.
   */
  async queryEvents(opts: {
    severity?: SecurityEvent['severity'];
    source?: string;
    startTime?: string; // ISO datetime
    endTime?: string;
    limit?: number;
    offset?: number;
  }): Promise<SecurityEvent[]> {
    let builder = this.client.from('security_events').select('*');

    if (opts.severity) builder = builder.eq('severity', opts.severity);
    if (opts.source) builder = builder.eq('source', opts.source);
    if (opts.startTime) builder = builder.gte('created_at', opts.startTime);
    if (opts.endTime) builder = builder.lte('created_at', opts.endTime);

    builder = builder
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 50)
      .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50) - 1);

    const { data, error } = await builder;
    if (error) throw new Error(`Failed to query events: ${error.message}`);
    return (data ?? []) as SecurityEvent[];
  }

  /**
   * Get a severity distribution summary.
   */
  async getSeveritySummary(opts?: {
    startTime?: string;
    endTime?: string;
  }): Promise<Record<SecurityEvent['severity'], number>> {
    let builder = this.client.from('security_events').select('severity');
    if (opts?.startTime) builder = builder.gte('created_at', opts.startTime);
    if (opts?.endTime) builder = builder.lte('created_at', opts.endTime);

    const { data, error } = await builder;
    if (error) throw new Error(`Failed to get summary: ${error.message}`);

    const summary: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const row of data ?? []) {
      const sev = (row as { severity: string }).severity;
      if (sev in summary) summary[sev]++;
    }
    return summary as Record<SecurityEvent['severity'], number>;
  }

  // ------------------ Alert Rules ------------------

  /**
   * Create an alert rule.
   */
  async createAlertRule(input: Omit<AlertRule, 'id'> & { id?: string }): Promise<AlertRule> {
    const validated = AlertRuleSchema.parse(input);
    const { data, error } = await this.client
      .from('siem_alert_rules')
      .insert({
        id: validated.id ?? crypto.randomUUID(),
        name: validated.name,
        severity_threshold: validated.severityThreshold,
        source_pattern: validated.sourcePattern ?? null,
        window_minutes: validated.windowMinutes,
        count_threshold: validated.countThreshold,
        enabled: validated.enabled,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create alert rule: ${error.message}`);
    return AlertRuleSchema.parse(data);
  }

  /**
   * List all alert rules.
   */
  async listAlertRules(): Promise<AlertRule[]> {
    const { data, error } = await this.client.from('siem_alert_rules').select('*');
    if (error) throw new Error(`Failed to list alert rules: ${error.message}`);
    return (data ?? []).map((r) => AlertRuleSchema.parse(r));
  }

  // ------------------ Correlation & Alerting ------------------

  /**
   * Evaluate all enabled alert rules against recent events and
   * generate alerts where thresholds are breached.
   */
  async evaluateRules(): Promise<SIEMAlert[]> {
    const rules = await this.listAlertRules();
    const alerts: SIEMAlert[] = [];

    for (const rule of rules.filter((r) => r.enabled)) {
      const since = new Date(Date.now() - rule.windowMinutes * 60 * 1000).toISOString();
      let builder = this.client
        .from('security_events')
        .select('*')
        .gte('created_at', since);

      // Severity filter: include events at or above the threshold
      const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
      const thresholdRank = severityRank[rule.severityThreshold];
      const allowedSeverities = (Object.keys(severityRank) as Array<keyof typeof severityRank>).filter(
        (k) => severityRank[k] >= thresholdRank
      );
      builder = builder.in('severity', allowedSeverities);

      if (rule.sourcePattern) {
        builder = builder.ilike('source', `%${rule.sourcePattern}%`);
      }

      const { data, error } = await builder;
      if (error) {
        console.error(`Rule evaluation error for ${rule.name}:`, error.message);
        continue;
      }

      const events = (data ?? []) as SecurityEvent[];
      if (events.length >= rule.countThreshold) {
        const alert = await this.createAlert(rule.id ?? 'unknown', events);
        alerts.push(alert);
      }
    }

    return alerts;
  }

  private async createAlert(ruleId: string, events: SecurityEvent[]): Promise<SIEMAlert> {
    const maxSeverity = events.reduce((max, e) => {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      return rank[e.severity] > rank[max] ? e.severity : max;
    }, 'low' as SecurityEvent['severity']);

    const sources = [...new Set(events.map((e) => e.source))];
    const message = `Alert triggered by ${events.length} events from: ${sources.join(', ')}`;

    const { data, error } = await this.client
      .from('siem_alerts')
      .insert({
        rule_id: ruleId,
        severity: maxSeverity,
        message,
        event_ids: events.map((e) => e.id),
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create alert: ${error.message}`);
    return SIEMAlertSchema.parse(data);
  }

  /**
   * Acknowledge an alert.
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    const { error } = await this.client
      .from('siem_alerts')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', alertId);

    if (error) throw new Error(`Failed to acknowledge alert: ${error.message}`);
  }

  /**
   * Get unacknowledged alerts.
   */
  async getOpenAlerts(): Promise<SIEMAlert[]> {
    const { data, error } = await this.client
      .from('siem_alerts')
      .select('*')
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get open alerts: ${error.message}`);
    return (data ?? []).map((a) => SIEMAlertSchema.parse(a));
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let _siem: SIEMEngine | null = null;

export function getSIEMEngine(): SIEMEngine {
  if (!_siem) {
    _siem = new SIEMEngine();
  }
  return _siem;
}
