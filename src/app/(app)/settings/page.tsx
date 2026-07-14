import { GlassCard } from '@/components/ui/premium/glass-card';
import { Settings } from 'lucide-react';

export default async function SettingsPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <GlassCard className="flex flex-col items-center gap-4 p-12 text-center">
        <Settings size={48} className="text-indigo-400" />
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-foreground-muted max-w-sm">
          Configure your AI CEO Office preferences here.
        </p>
      </GlassCard>
    </div>
  );
}
