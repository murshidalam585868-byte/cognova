import React from 'react';
import { z } from 'zod';
import type { Metadata } from 'next';
import { brand } from '@/lib/config';
import { FeatureSchema, PricingTierSchema } from '@/lib/schemas';
import { GlassCard } from '@/components/ui/premium/glass-card';
import { AnimatedGradient } from '@/components/ui/premium/animated-gradient';
import {
  ArrowRight,
  Sparkles,
  Shield,
  Zap,
  BarChart3,
  Users,
  Globe,
  Check,
} from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: `${brand.productName} — ${brand.tagline}`,
};

const features = FeatureSchema.array().parse([
  {
    title: 'Autonomous Research',
    description:
      'Deep-dive into markets, competitors, and opportunities around the clock.',
    icon: 'Zap',
  },
  {
    title: 'Strategic Planning',
    description:
      'Generate board-ready strategies with data-driven scenario modeling.',
    icon: 'BarChart3',
  },
  {
    title: 'Secure by Design',
    description:
      'Enterprise-grade encryption, audit trails, and zero-data-retention options.',
    icon: 'Shield',
  },
  {
    title: 'Team Collaboration',
    description:
      'Shared workspaces, annotations, and real-time sync across your CEO office.',
    icon: 'Users',
  },
  {
    title: 'Global Intelligence',
    description:
      'Multi-language support and regional regulatory awareness built-in.',
    icon: 'Globe',
  },
  {
    title: 'Continuous Learning',
    description:
      'Self-improving memory and feedback loops that adapt to your style.',
    icon: 'Sparkles',
  },
]);

const pricing = PricingTierSchema.array().parse([
  {
    name: 'Starter',
    price: '$0',
    description: 'For solo founders exploring AI-driven insights.',
    features: ['5 conversations/day', 'Basic research', 'Email summaries'],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Professional',
    price: '$49',
    description: 'For growing teams that need velocity and depth.',
    features: [
      'Unlimited conversations',
      'Advanced research',
      'Team workspace',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Dedicated AI CEO Office with bespoke integrations.',
    features: [
      'Custom agents',
      'SSO & SAML',
      'On-premise option',
      'Dedicated success manager',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
]);

export default async function LandingPage(): Promise<React.ReactElement> {
  return (
    <div className="relative min-h-screen bg-background overflow-hidden text-foreground">
      <AnimatedGradient />

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center justify-center px-6 pt-32 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-foreground-muted backdrop-blur-md mb-8">
          <Sparkles size={14} />
          Introducing {brand.productName} v2.0
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gradient max-w-4xl">
          Your AI CEO Office
        </h1>
        <p className="mt-6 text-lg md:text-xl text-foreground-muted max-w-2xl">
          {brand.productName} is the autonomous business partner that researches,
          plans, and executes alongside your executive team—24/7.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-xl bg-foreground text-background px-6 py-3 font-semibold hover:bg-foreground/90 transition-colors"
          >
            Launch App <ArrowRight size={18} />
          </Link>
          <Link
            href="#pricing"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 font-semibold hover:bg-white/10 transition-colors"
          >
            View Pricing
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 px-6 py-24 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Everything you need to lead
          </h2>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
            A complete suite of autonomous tools designed for modern executives.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <GlassCard
              key={f.title}
              variant="hover"
              className="flex flex-col gap-4"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                <FeatureIcon name={f.icon} />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="text-sm text-foreground-muted leading-relaxed">
                {f.description}
              </p>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 px-6 py-24 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
            Start free, scale as your executive needs grow.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pricing.map((tier) => (
            <GlassCard
              key={tier.name}
              variant={tier.highlighted ? 'accent' : 'default'}
              className="flex flex-col"
            >
              <div className="mb-4">
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <div className="mt-2 text-3xl font-bold">
                  {tier.price}
                  <span className="text-sm font-normal text-foreground-muted">
                    /mo
                  </span>
                </div>
                <p className="mt-2 text-sm text-foreground-muted">
                  {tier.description}
                </p>
              </div>
              <ul className="flex-1 space-y-3 mb-6">
                {tier.features.map((feat) => (
                  <li
                    key={feat}
                    className="flex items-start gap-2 text-sm text-foreground-muted"
                  >
                    <Check
                      size={14}
                      className="mt-0.5 text-indigo-400 flex-shrink-0"
                    />
                    {feat}
                  </li>
                ))}
              </ul>
              <button className="w-full rounded-xl bg-foreground text-background py-2.5 font-semibold text-sm hover:bg-foreground/90 transition-colors">
                {tier.cta}
              </button>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 py-24 text-center">
        <GlassCard className="max-w-3xl mx-auto p-10 md:p-14 flex flex-col items-center gap-6">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Ready to upgrade your executive mind?
          </h2>
          <p className="text-foreground-muted max-w-lg">
            Join hundreds of founders and executives who use {brand.productName}{' '}
            to make sharper decisions, faster.
          </p>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 text-white px-8 py-3.5 font-semibold hover:bg-indigo-400 transition-colors"
          >
            Get Started Now <ArrowRight size={18} />
          </Link>
        </GlassCard>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-8 text-center text-sm text-foreground-muted">
        © {new Date().getFullYear()} {brand.productName}. All rights reserved.
      </footer>
    </div>
  );
}

function FeatureIcon({ name }: { name: string }) {
  const props = { size: 20 };
  switch (name) {
    case 'Zap':
      return <Zap {...props} />;
    case 'BarChart3':
      return <BarChart3 {...props} />;
    case 'Shield':
      return <Shield {...props} />;
    case 'Users':
      return <Users {...props} />;
    case 'Globe':
      return <Globe {...props} />;
    case 'Sparkles':
      return <Sparkles {...props} />;
    default:
      return <Sparkles {...props} />;
  }
}
