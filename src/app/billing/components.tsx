/**
 * src/app/billing/components.tsx
 * Client components for the billing dashboard.
 */

'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  ArrowRight,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { startCheckout, openPortal } from './actions';

// ---------------------------------------------------------------------------
// Checkout Button
// ---------------------------------------------------------------------------

export function CheckoutButton({
  userId,
  email,
  tierId,
  label = 'Upgrade',
  variant = 'primary',
}: {
  userId: string;
  email: string;
  tierId: 'pro' | 'enterprise';
  label?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const result = await startCheckout({ userId, email, tierId });
      if ('url' in result) {
        router.push(result.url);
      } else {
        alert(`Checkout error: ${result.error}`);
      }
    });
  };

  const base =
    variant === 'primary'
      ? 'bg-sky-600 hover:bg-sky-700 text-white'
      : variant === 'secondary'
      ? 'bg-violet-600 hover:bg-violet-700 text-white'
      : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800';

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${base}`}
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
      {label}
      {!isPending && <ArrowRight className="w-4 h-4" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Portal Button
// ---------------------------------------------------------------------------

export function PortalButton({
  stripeCustomerId,
  label = 'Manage Subscription',
}: {
  stripeCustomerId: string;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    startTransition(async () => {
      const result = await openPortal({ stripeCustomerId });
      if ('url' in result) {
        router.push(result.url);
      } else {
        alert(`Portal error: ${result.error}`);
      }
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900"
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    trialing: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
    past_due: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    canceled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    unpaid: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    incomplete: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    incomplete_expired: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    paused: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
        styles[status] ?? styles.incomplete
      }`}
    >
      {status === 'active' && <CheckCircle2 className="w-3.5 h-3.5" />}
      {status === 'canceled' && <XCircle className="w-3.5 h-3.5" />}
      {status === 'past_due' && <AlertCircle className="w-3.5 h-3.5" />}
      {status}
    </span>
  );
}
