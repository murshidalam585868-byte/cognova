import { cn } from '@/lib/utils';

export function AnimatedGradient({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className
      )}
    >
      <div className="absolute -top-[20%] -left-[10%] h-[60%] w-[60%] rounded-full bg-indigo-500/15 blur-[120px] animate-gradient-1" />
      <div className="absolute top-[30%] -right-[10%] h-[50%] w-[50%] rounded-full bg-violet-500/15 blur-[100px] animate-gradient-2" />
      <div className="absolute -bottom-[10%] left-[20%] h-[40%] w-[40%] rounded-full bg-fuchsia-500/10 blur-[90px] animate-gradient-3" />
    </div>
  );
}
