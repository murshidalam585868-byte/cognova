import { cn } from '@/lib/utils';

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-shimmer bg-linear-to-r from-transparent via-white/10 to-transparent bg-[length:200%_100%]',
        className
      )}
    />
  );
}
