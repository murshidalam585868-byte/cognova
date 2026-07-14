import { GlassCard } from '@/components/ui/premium/glass-card';
import { BarChart3 } from 'lucide-react';

export default async function AnalyticsPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <GlassCard className="flex flex-col items-center gap-4 p-12 text-center">
        <BarChart3 size={48} className="text-indigo-400" />
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-foreground-muted max-w-sm">
          Executive analytics dashboard is coming soon.
        </p>
      </GlassCard>
    </div>
  );
}
