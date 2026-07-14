import { cn } from '@/lib/utils';
import { User, Bot } from 'lucide-react';

export interface AvatarProps {
  name?: string;
  role?: 'user' | 'assistant' | 'system';
  src?: string;
  className?: string;
}

export function Avatar({ name, role = 'user', src, className }: AvatarProps) {
  const isUser = role === 'user';
  return (
    <div
      className={cn(
        'relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full overflow-hidden border-2',
        isUser
          ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
          : 'border-violet-500/50 bg-violet-500/20 text-violet-300',
        className
      )}
      title={name || role}
    >
      {src ? (
        <img
          src={src}
          alt={name || role}
          className="h-full w-full object-cover"
        />
      ) : isUser ? (
        <User size={16} />
      ) : (
        <Bot size={16} />
      )}
    </div>
  );
}
