import { GlassCard } from '@/components/ui/premium/glass-card';
import { FolderOpen } from 'lucide-react';

export default async function ProjectsPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <GlassCard className="flex flex-col items-center gap-4 p-12 text-center">
        <FolderOpen size={48} className="text-indigo-400" />
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="text-foreground-muted max-w-sm">
          Project management is coming soon. This placeholder ensures the navigation works.
        </p>
      </GlassCard>
    </div>
  );
}
