/**
 * src/app/billing/page.tsx
 * Billing Dashboard for Hazard Brain.
 *
 * Displays:
 * - Current subscription plan and status
 * - Usage meters with progress bars
 * - Invoice history
 * - Tier comparison and upgrade paths
 * - Stripe Customer Portal access
 *
 * Server component fetches data; client components handle checkout/portal actions.
 */

import { Suspense } from 'react';
import {
  CreditCard,
  Receipt,
  BarChart3,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  Users,
  HardDrive,
  MessageSquare,
  Crown,
  ArrowRight,
} from 'lucide-react';
import { fetchBillingDashboard } from './actions';
import { CheckoutButton, PortalButton, StatusBadge } from './components';
import type { SubscriptionTier, UsageAggregate, Invoice } from '@/types';

// ---------------------------------------------------------------------------
// Server data fetch
// ---------------------------------------------------------------------------

// In production, replace with actual auth user ID from session/cookie
const MOCK_USER_ID = '00000000-0000-0000-0000-000000000001';
const MOCK_USER_EMAIL = 'user@example.com';

async function getData() {
  return fetchBillingDashboard(MOCK_USER_ID);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BillingPage() {
  const data = await getData();

  if (!data) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Unable to load billing data</h2>
            <p className="text-gray-600 dark:text-gray-400">Please try again later or contact support.</p>
          </div>
        </div>
      </main>
    );
  }

  const { subscription, tiers, invoices, usage } = data;
  const currentTier = subscription?.tier ?? tiers.find((t) => t.id === 'free')!;

  // Usage lookups
  const aiMessagesUsed = getUsageValue(usage, 'ai_messages');
  const storageUsed = getUsageValue(usage, 'storage_mb');
  const integrationsUsed = getUsageValue(usage, 'integrations');
  const teamMembersUsed = getUsageValue(usage, 'team_members');

  const limits = currentTier.limits;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <CreditCard className="w-8 h-8 text-sky-500" />
            Billing & Subscriptions
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Manage your plan, monitor usage, and view billing history.
          </p>
        </div>

        {/* Current Plan Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Crown className="w-5 h-5 text-amber-500" />
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Current Plan
                </span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {currentTier.name}
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                {currentTier.description}
              </p>
              {subscription && (
                <div className="flex items-center gap-3 mt-3">
                  <StatusBadge status={subscription.status} />
                  {subscription.cancelAtPeriodEnd && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      Cancels at period end
                    </span>
                  )}
                  {subscription.currentPeriodEnd && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {subscription?.stripeCustomerId ? (
                <PortalButton stripeCustomerId={subscription.stripeCustomerId} />
              ) : currentTier.id !== 'enterprise' ? (
                <CheckoutButton
                  userId={MOCK_USER_ID}
                  email={MOCK_USER_EMAIL}
                  tierId={currentTier.id === 'free' ? 'pro' : 'enterprise'}
                  label={currentTier.id === 'free' ? 'Upgrade to Pro' : 'Upgrade to Enterprise'}
                  variant={currentTier.id === 'free' ? 'primary' : 'secondary'}
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* Usage Meters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <UsageMeter
            icon={<MessageSquare className="w-5 h-5 text-sky-500" />}
            label="AI Messages"
            used={aiMessagesUsed}
            limit={limits.aiMessagesPerMonth}
            unit="msgs"
          />
          <UsageMeter
            icon={<HardDrive className="w-5 h-5 text-emerald-500" />}
            label="Storage"
            used={storageUsed}
            limit={limits.storageMb}
            unit="MB"
          />
          <UsageMeter
            icon={<Zap className="w-5 h-5 text-amber-500" />}
            label="Integrations"
            used={integrationsUsed}
            limit={limits.maxIntegrations}
            unit=""
          />
          <UsageMeter
            icon={<Users className="w-5 h-5 text-violet-500" />}
            label="Team Members"
            used={teamMembersUsed}
            limit={limits.maxTeamMembers}
            unit=""
          />
        </div>

        {/* Two-column layout: Invoices + Tiers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* Invoice History */}
          <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-sky-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Invoice History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="px-6 py-3 font-medium">Number</th>
                    <th className="px-6 py-3 font-medium">Description</th>
                    <th className="px-6 py-3 font-medium">Amount</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Date</th>
                    <th className="px-6 py-3 font-medium">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No invoices yet. Invoices appear after your first payment.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">
                          {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                          {inv.description ?? 'Subscription'}
                        </td>
                        <td className="px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">
                          ${(inv.amountDueCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                        </td>
                        <td className="px-6 py-4">
                          <InvoiceStatusBadge status={inv.status} />
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                          {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-4">
                          {inv.invoicePdfUrl ? (
                            <a
                              href={inv.invoicePdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 font-medium inline-flex items-center gap-1"
                            >
                              Download <ArrowRight className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-violet-500" />
              Billing Summary
            </h3>
            <div className="space-y-4">
              <SummaryRow
                icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
                label="Total Spent"
                value={`$${(invoices.reduce((sum, i) => sum + i.amountPaidCents, 0) / 100).toFixed(2)}`}
              />
              <SummaryRow
                icon={<Receipt className="w-4 h-4 text-sky-500" />}
                label="Total Invoices"
                value={String(invoices.length)}
              />
              <SummaryRow
                icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                label="Paid Invoices"
                value={String(invoices.filter((i) => i.status === 'paid').length)}
              />
              <SummaryRow
                icon={<Clock className="w-4 h-4 text-amber-500" />}
                label="Open Invoices"
                value={String(invoices.filter((i) => i.status === 'open').length)}
              />
              <SummaryRow
                icon={<MessageSquare className="w-4 h-4 text-sky-500" />}
                label="Current Period Messages"
                value={`${aiMessagesUsed.toLocaleString()} ${limits.aiMessagesPerMonth > 0 ? `/ ${limits.aiMessagesPerMonth.toLocaleString()}` : ''}`}
              />
            </div>
          </div>
        </div>

        {/* Tier Comparison */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Compare Plans
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tiers.map((tier) => {
              const isCurrent = tier.id === currentTier.id;
              const price = tier.monthlyPriceCents > 0 ? `$${(tier.monthlyPriceCents / 100).toFixed(2)}/mo` : 'Free';

              return (
                <div
                  key={tier.id}
                  className={`rounded-xl border p-6 transition-shadow hover:shadow-md ${
                    isCurrent
                      ? 'border-sky-500 dark:border-sky-400 bg-sky-50/30 dark:bg-sky-900/10'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xl font-bold text-gray-900 dark:text-white">{tier.name}</h4>
                    {isCurrent && (
                      <span className="text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/30 px-2 py-1 rounded-full">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{price}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{tier.description}</p>

                  <ul className="space-y-2 mb-6">
                    <FeatureItem
                      label="AI Messages"
                      value={formatLimit(tier.limits.aiMessagesPerMonth)}
                    />
                    <FeatureItem
                      label="Storage"
                      value={formatLimit(tier.limits.storageMb, 'MB')}
                    />
                    <FeatureItem
                      label="Integrations"
                      value={formatLimit(tier.limits.maxIntegrations)}
                    />
                    <FeatureItem
                      label="Team Members"
                      value={formatLimit(tier.limits.maxTeamMembers)}
                    />
                    <FeatureItem
                      label="Support"
                      value={String(tier.features.support ?? 'Community')}
                    />
                    <FeatureItem
                      label="API Access"
                      value={tier.features.api_access ? 'Yes' : 'No'}
                    />
                    <FeatureItem
                      label="Analytics"
                      value={tier.features.analytics ? 'Yes' : 'No'}
                    />
                    {tier.id === 'enterprise' && (
                      <FeatureItem label="SSO / Audit" value="Yes" />
                    )}
                  </ul>

                  <div className="mt-auto">
                    {isCurrent ? (
                      <button
                        disabled
                        className="w-full py-2.5 rounded-lg font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                      >
                        Current Plan
                      </button>
                    ) : tier.id === 'enterprise' ? (
                      <a
                        href="mailto:sales@brain.mr-imperfect.online"
                        className="block w-full text-center py-2.5 rounded-lg font-medium bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 transition-colors"
                      >
                        Contact Sales
                      </a>
                    ) : (
                      <CheckoutButton
                        userId={MOCK_USER_ID}
                        email={MOCK_USER_EMAIL}
                        tierId={tier.id as 'pro' | 'enterprise'}
                        label={currentTier.id === 'free' ? 'Upgrade' : 'Switch'}
                        variant={tier.id === 'pro' ? 'primary' : 'secondary'}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents (Server-safe)
// ---------------------------------------------------------------------------

function UsageMeter({
  icon,
  label,
  used,
  limit,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  limit: number;
  unit: string;
}) {
  const unlimited = limit < 0;
  const percentage = unlimited ? 0 : Math.min((used / limit) * 100, 100);
  const nearLimit = !unlimited && percentage >= 80;
  const overLimit = !unlimited && used > limit;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        </div>
        {overLimit && <AlertCircle className="w-4 h-4 text-red-500" />}
        {nearLimit && !overLimit && <AlertCircle className="w-4 h-4 text-amber-500" />}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {used.toLocaleString()}
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
          {unlimited ? 'unlimited' : `/ ${limit.toLocaleString()} ${unit}`}
        </span>
      </div>
      {!unlimited && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              overLimit ? 'bg-red-500' : nearLimit ? 'bg-amber-500' : 'bg-sky-500'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      {unlimited && (
        <div className="w-full bg-emerald-100 dark:bg-emerald-900/30 rounded-full h-2">
          <div className="h-2 rounded-full bg-emerald-500 w-full" />
        </div>
      )}
    </div>
  );
}

function InvoiceStatusBadge({ status }: { status: Invoice['status'] }) {
  const styles: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    open: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    uncollectible: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    void: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        {icon}
        {label}
      </div>
      <span className="text-sm font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function FeatureItem({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between text-sm py-1">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUsageValue(usage: UsageAggregate[], metricName: string): number {
  const agg = usage.find((u) => u.metricName === metricName);
  return agg ? Number(agg.totalValue) : 0;
}

function formatLimit(value: number, unit = ''): string {
  if (value < 0) return 'Unlimited';
  return `${value.toLocaleString()}${unit ? ` ${unit}` : ''}`;
}
