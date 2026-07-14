import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const glassCardVariants = cva(
  'relative overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300',
  {
    variants: {
      variant: {
        default:
          'bg-white/5 border-white/10 shadow-lg shadow-black/20',
        hover:
          'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:shadow-xl hover:shadow-black/30',
        accent:
          'bg-indigo-500/10 border-indigo-500/30 shadow-lg shadow-indigo-500/10',
        strong:
          'bg-white/10 border-white/15 backdrop-blur-2xl',
      },
      size: {
        default: 'p-6',
        sm: 'p-4',
        lg: 'p-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  children: React.ReactNode;
}

export function GlassCard({
  className,
  variant,
  size,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(glassCardVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </div>
  );
}
