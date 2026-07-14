/**
 * Shadow Brain — Phase 4: AI Business Partner
 * CRM Connector
 *
 * Unified interface for CRM webhooks and API calls.
 * Supports HubSpot and Salesforce (mock/adapter pattern).
 * Handles inbound webhooks (form submissions, deal updates, contact changes)
 * and outbound sync (push experiment results, pipeline updates).
 *
 * All operations are async, typed, and logged.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';

// ── Zod Schemas ────────────────────────────────────────────────────────────

export const CRMContactSchema = z.object({
  id: z.string().optional(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  lifecycleStage: z.enum(['subscriber', 'lead', 'marketing_qualified_lead', 'sales_qualified_lead', 'opportunity', 'customer', 'evangelist', 'churned']).optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  customProperties: z.record(z.string()).optional().default({}),
});
export type CRMContact = z.infer<typeof CRMContactSchema>;

export const CRMDealSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  amount: z.number().nonnegative().optional(),
  stage: z.string().min(1),
  pipeline: z.string().optional(),
  closeDate: z.string().optional(), // ISO date
  probability: z.number().min(0).max(1).optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  source: z.string().optional(),
  customProperties: z.record(z.string()).optional().default({}),
});
export type CRMDeal = z.infer<typeof CRMDealSchema>;

export const CRMWebhookPayloadSchema = z.discriminatedUnion('eventType', [
  z.object({ eventType: z.literal('contact.created'), contact: CRMContactSchema }),
  z.object({ eventType: z.literal('contact.updated'), contactId: z.string(), changes: z.record(z.unknown()) }),
  z.object({ eventType: z.literal('deal.created'), deal: CRMDealSchema }),
  z.object({ eventType: z.literal('deal.updated'), dealId: z.string(), changes: z.record(z.unknown()) }),
  z.object({ eventType: z.literal('deal.stage_changed'), dealId: z.string(), oldStage: z.string(), newStage: z.string() }),
  z.object({ eventType: z.literal('form.submission'), formId: z.string(), fields: z.record(z.string()) }),
  z.object({ eventType: z.literal('custom'), topic: z.string(), payload: z.record(z.unknown()) }),
]);
export type CRMWebhookPayload = z.infer<typeof CRMWebhookPayloadSchema>;

export const CRMSyncResultSchema = z.object({
  success: z.boolean(),
  crmType: z.enum(['hubspot', 'salesforce', 'mock']),
  recordId: z.string().optional(),
  errors: z.array(z.string()).optional().default([]),
  raw: z.unknown().optional(),
});
export type CRMSyncResult = z.infer<typeof CRMSyncResultSchema>;

export const CRMConfigSchema = z.object({
  type: z.enum(['hubspot', 'salesforce', 'mock']).default('mock'),
  hubspotApiKey: z.string().optional(),
  hubspotBaseUrl: z.string().url().default('https://api.hubapi.com'),
  salesforceDomain: z.string().optional(),
  salesforceClientId: z.string().optional(),
  salesforceClientSecret: z.string().optional(),
  salesforceRefreshToken: z.string().optional(),
  mockDelayMs: z.number().int().nonnegative().default(0),
});
export type CRMConfig = z.infer<typeof CRMConfigSchema>;

// ── CRM Factory ────────────────────────────────────────────────────────────

let _crmConfig: CRMConfig | null = null;

function getCRMConfig(): CRMConfig {
  if (_crmConfig) return _crmConfig;

  _crmConfig = CRMConfigSchema.parse({
    type: (process.env.CRM_TYPE as any) ?? 'mock',
    hubspotApiKey: process.env.HUBSPOT_API_KEY,
    hubspotBaseUrl: process.env.HUBSPOT_BASE_URL,
    salesforceDomain: process.env.SALESFORCE_DOMAIN,
    salesforceClientId: process.env.SALESFORCE_CLIENT_ID,
    salesforceClientSecret: process.env.SALESFORCE_CLIENT_SECRET,
    salesforceRefreshToken: process.env.SALESFORCE_REFRESH_TOKEN,
    mockDelayMs: Number(process.env.CRM_MOCK_DELAY_MS ?? 0),
  });

  return _crmConfig;
}

/** Reset config (for testing or hot-reload). */
export function resetCRMConfig(): void {
  _crmConfig = null;
}

// ── Webhook Handler ───────────────────────────────────────────────────────

/**
 * Validate and parse an incoming CRM webhook payload.
 * Returns the parsed payload or throws a Zod validation error.
 */
export function parseWebhookPayload(body: unknown): CRMWebhookPayload {
  return CRMWebhookPayloadSchema.parse(body);
}

/**
 * Process an incoming CRM webhook.
 * This is the main entry point for the /api/partner/webhook route.
 */
export async function handleWebhook(payload: CRMWebhookPayload): Promise<{ processed: boolean; actions: string[] }> {
  const actions: string[] = [];
  logger.info('[crm] handleWebhook', { eventType: payload.eventType });

  switch (payload.eventType) {
    case 'contact.created': {
      const result = await upsertContact(payload.contact);
      actions.push(`upsertContact:${result.recordId ?? 'mock'}`);
      break;
    }
    case 'contact.updated': {
      // Fetch contact, apply changes, push back
      actions.push(`updateContact:${payload.contactId}`);
      break;
    }
    case 'deal.created': {
      const result = await createDeal(payload.deal);
      actions.push(`createDeal:${result.recordId ?? 'mock'}`);
      break;
    }
    case 'deal.updated': {
      actions.push(`updateDeal:${payload.dealId}`);
      break;
    }
    case 'deal.stage_changed': {
      // Trigger business logic: e.g., notify reasoning engine, update experiment
      actions.push(`stageChanged:${payload.dealId} ${payload.oldStage} -> ${payload.newStage}`);
      break;
    }
    case 'form.submission': {
      actions.push(`formSubmission:${payload.formId}`);
      break;
    }
    case 'custom': {
      actions.push(`custom:${payload.topic}`);
      break;
    }
  }

  return { processed: true, actions };
}

// ── HubSpot Adapter ────────────────────────────────────────────────────────

async function hubspotRequest<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  const config = getCRMConfig();
  if (config.type !== 'hubspot' || !config.hubspotApiKey) {
    throw new Error('HubSpot not configured');
  }

  const url = `${config.hubspotBaseUrl}${path}${path.includes('?') ? '&' : '?'}hapikey=${config.hubspotApiKey}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Salesforce Adapter ───────────────────────────────────────────────────

let _salesforceToken: string | null = null;
let _salesforceTokenExpires: number = 0;

async function getSalesforceToken(): Promise<string> {
  const config = getCRMConfig();
  if (config.type !== 'salesforce') throw new Error('Salesforce not configured');

  if (_salesforceToken && Date.now() < _salesforceTokenExpires - 60000) {
    return _salesforceToken;
  }

  const res = await fetch(`https://${config.salesforceDomain}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.salesforceClientId!,
      client_secret: config.salesforceClientSecret!,
      refresh_token: config.salesforceRefreshToken!,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce auth error ${res.status}: ${text}`);
  }

  const data: any = await res.json();
  _salesforceToken = data.access_token;
  _salesforceTokenExpires = Date.now() + (data.expires_in * 1000);
  return _salesforceToken;
}

async function salesforceRequest<T>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  const config = getCRMConfig();
  const token = await getSalesforceToken();

  const url = `https://${config.salesforceDomain}${path}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── CRUD Operations (Unified) ────────────────────────────────────────────

/**
 * Upsert a contact into the configured CRM.
 */
export async function upsertContact(contact: CRMContact): Promise<CRMSyncResult> {
  const config = getCRMConfig();
  const validated = CRMContactSchema.parse(contact);

  if (config.mockDelayMs > 0) {
    await new Promise((r) => setTimeout(r, config.mockDelayMs));
  }

  try {
    if (config.type === 'hubspot') {
      const body = {
        properties: {
          email: validated.email,
          firstname: validated.firstName,
          lastname: validated.lastName,
          phone: validated.phone,
          company: validated.company,
          jobtitle: validated.jobTitle,
          lifecyclestage: validated.lifecycleStage,
          hs_lead_status: validated.source,
          ...validated.customProperties,
        },
      };

      const res: any = await hubspotRequest('/crm/v3/objects/contacts', { method: 'POST', body });
      return CRMSyncResultSchema.parse({ success: true, crmType: 'hubspot', recordId: res.id, raw: res });
    }

    if (config.type === 'salesforce') {
      const body = {
        Email: validated.email,
        FirstName: validated.firstName,
        LastName: validated.lastName,
        Phone: validated.phone,
        AccountId: validated.company, // simplified; real impl would lookup Account
        Title: validated.jobTitle,
        LeadSource: validated.source,
      };

      const res: any = await salesforceRequest('/services/data/v59.0/sobjects/Contact/', { method: 'POST', body });
      return CRMSyncResultSchema.parse({ success: true, crmType: 'salesforce', recordId: res.id, raw: res });
    }

    // Mock mode
    const mockId = `mock-contact-${Date.now()}`;
    logger.info('[crm] mock upsertContact', { email: validated.email, mockId });
    return CRMSyncResultSchema.parse({ success: true, crmType: 'mock', recordId: mockId });
  } catch (err) {
    logger.error('[crm] upsertContact failed', { error: (err as Error).message, email: validated.email });
    return CRMSyncResultSchema.parse({ success: false, crmType: config.type, errors: [(err as Error).message] });
  }
}

/**
 * Create a deal in the configured CRM.
 */
export async function createDeal(deal: CRMDeal): Promise<CRMSyncResult> {
  const config = getCRMConfig();
  const validated = CRMDealSchema.parse(deal);

  if (config.mockDelayMs > 0) {
    await new Promise((r) => setTimeout(r, config.mockDelayMs));
  }

  try {
    if (config.type === 'hubspot') {
      const body = {
        properties: {
          dealname: validated.name,
          amount: validated.amount,
          dealstage: validated.stage,
          pipeline: validated.pipeline,
          closedate: validated.closeDate,
          probability: validated.probability,
          ...validated.customProperties,
        },
        associations: validated.contactId
          ? { contacts: { results: [{ id: validated.contactId }] } }
          : undefined,
      };

      const res: any = await hubspotRequest('/crm/v3/objects/deals', { method: 'POST', body });
      return CRMSyncResultSchema.parse({ success: true, crmType: 'hubspot', recordId: res.id, raw: res });
    }

    if (config.type === 'salesforce') {
      const body = {
        Name: validated.name,
        Amount: validated.amount,
        StageName: validated.stage,
        CloseDate: validated.closeDate,
        Probability: validated.probability ? validated.probability * 100 : undefined,
        AccountId: validated.companyId,
        ContactId: validated.contactId,
      };

      const res: any = await salesforceRequest('/services/data/v59.0/sobjects/Opportunity/', { method: 'POST', body });
      return CRMSyncResultSchema.parse({ success: true, crmType: 'salesforce', recordId: res.id, raw: res });
    }

    const mockId = `mock-deal-${Date.now()}`;
    logger.info('[crm] mock createDeal', { name: validated.name, mockId });
    return CRMSyncResultSchema.parse({ success: true, crmType: 'mock', recordId: mockId });
  } catch (err) {
    logger.error('[crm] createDeal failed', { error: (err as Error).message, name: validated.name });
    return CRMSyncResultSchema.parse({ success: false, crmType: config.type, errors: [(err as Error).message] });
  }
}

/**
 * Update a deal stage — commonly triggered by pipeline automation.
 */
export async function updateDealStage(dealId: string, newStage: string): Promise<CRMSyncResult> {
  const config = getCRMConfig();

  try {
    if (config.type === 'hubspot') {
      const res: any = await hubspotRequest(`/crm/v3/objects/deals/${dealId}`, {
        method: 'PATCH',
        body: { properties: { dealstage: newStage } },
      });
      return CRMSyncResultSchema.parse({ success: true, crmType: 'hubspot', recordId: res.id, raw: res });
    }

    if (config.type === 'salesforce') {
      const res: any = await salesforceRequest(`/services/data/v59.0/sobjects/Opportunity/${dealId}`, {
        method: 'PATCH',
        body: { StageName: newStage },
      });
      return CRMSyncResultSchema.parse({ success: true, crmType: 'salesforce', recordId: dealId, raw: res });
    }

    logger.info('[crm] mock updateDealStage', { dealId, newStage });
    return CRMSyncResultSchema.parse({ success: true, crmType: 'mock', recordId: dealId });
  } catch (err) {
    logger.error('[crm] updateDealStage failed', { error: (err as Error).message, dealId });
    return CRMSyncResultSchema.parse({ success: false, crmType: config.type, errors: [(err as Error).message] });
  }
}

/**
 * Search contacts by email across the configured CRM.
 */
export async function searchContactsByEmail(email: string): Promise<CRMContact[]> {
  const config = getCRMConfig();

  if (config.type === 'hubspot') {
    const res: any = await hubspotRequest(`/crm/v3/objects/contacts/search?email=${encodeURIComponent(email)}`);
    return (res.results ?? []).map((r: any) =>
      CRMContactSchema.parse({
        id: r.id,
        email: r.properties?.email,
        firstName: r.properties?.firstname,
        lastName: r.properties?.lastname,
        phone: r.properties?.phone,
        company: r.properties?.company,
        jobTitle: r.properties?.jobtitle,
        lifecycleStage: r.properties?.lifecyclestage,
      })
    );
  }

  if (config.type === 'salesforce') {
    const query = `SELECT Id, Email, FirstName, LastName, Phone, Title, AccountId FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}'`;
    const res: any = await salesforceRequest(`/services/data/v59.0/query?q=${encodeURIComponent(query)}`);
    return (res.records ?? []).map((r: any) =>
      CRMContactSchema.parse({
        id: r.Id,
        email: r.Email,
        firstName: r.FirstName,
        lastName: r.LastName,
        phone: r.Phone,
        company: r.AccountId,
        jobTitle: r.Title,
      })
    );
  }

  // Mock
  logger.info('[crm] mock searchContactsByEmail', { email });
  return [];
}
