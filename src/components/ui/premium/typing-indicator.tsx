import { cn } from '@/lib/utils';

export function TypingIndicator({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 px-1 py-2', className)}>
      <span
        className="h-2 w-2 rounded-full bg-foreground-muted animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="h-2 w-2 rounded-full bg-foreground-muted animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="h-2 w-2 rounded-full bg-foreground-muted animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}
