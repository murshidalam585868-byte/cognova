'use client';

/**
 * src/app/(app)/chat/page.tsx
 * Hazard Brain Chat UI — Premium Experience
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Plus,
  Loader2,
  Trash2,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/premium/avatar';
import { TypingIndicator } from '@/components/ui/premium/typing-indicator';
import { GlassCard } from '@/components/ui/premium/glass-card';
import {
  ChatMessageSchema,
  SendMessagePayloadSchema,
  type ChatMessage,
} from '@/lib/schemas';
import { brand } from '@/lib/config';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const ConversationListSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    updatedAt: z.string(),
  })
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatPage(): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Welcome to ${brand.productName}. I'm your AI Business Partner. How can I help you today?`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<
    { id: string; title: string; updatedAt: string }[]
  >([]);
  const [drawerOpen, setDrawerOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);

  const userId = '00000000-0000-0000-0000-000000000001';

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const stored = localStorage.getItem('cognova-conversations');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const validated = ConversationListSchema.parse(parsed);
        setConversations(validated);
      } catch {
        // ignore invalid stored data
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('cognova-conversations', JSON.stringify(conversations));
  }, [conversations]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
    };

    ChatMessageSchema.parse(userMessage);

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    const assistantId = generateId();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);

    try {
      const currentMessages = messagesRef.current;
      const payloadMessages = conversationId
        ? [{ role: 'user' as const, content: userMessage.content }]
        : [...currentMessages, userMessage].map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          }));

      const payload = {
        messages: payloadMessages,
        userId,
        conversationId,
      };

      SendMessagePayloadSchema.parse(payload);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response stream available');

      let buffer = '';
      let fullContent = '';

      const read = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) return;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'token' && parsed.token) {
              fullContent += parsed.token;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: fullContent, isStreaming: true }
                    : m
                )
              );
            }

            if (parsed.type === 'error') {
              setError(parsed.message || 'Stream error');
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }

        return read();
      };

      await read();

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
      );

      if (!conversationId) {
        const newConvId = generateId();
        setConversationId(newConvId);
        const title =
          userMessage.content.slice(0, 40) +
          (userMessage.content.length > 40 ? '…' : '');
        setConversations((prev) => [
          { id: newConvId, title, updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, updatedAt: new Date().toISOString() }
              : c
          )
        );
      }
    } catch (err) {
      const msg = (err as Error).message || 'Failed to send message';
      setError(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `⚠️ ${msg}`, isStreaming: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, conversationId, userId]);

  const handleNewChat = () => {
    setConversationId(undefined);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: `Welcome to ${brand.productName}. I'm your AI Business Partner. How can I help you today?`,
      },
    ]);
    setError(null);
  };

  const handleSelectConversation = (id: string) => {
    setConversationId(id);
    setMessages([]); // In production: fetch messages from Supabase
    setError(null);
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) handleNewChat();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex h-full w-full">
      {/* Conversations Drawer */}
      <aside
        className={cn(
          'flex flex-col border-r border-white/10 bg-surface transition-all duration-300 overflow-hidden',
          drawerOpen ? 'w-72' : 'w-0'
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-white/10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
            Conversations
          </h2>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded-md hover:bg-white/10 text-foreground-muted transition-colors"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="p-3">
          <button
            onClick={handleNewChat}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-foreground text-background hover:bg-foreground/90 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => handleSelectConversation(conv.id)}
              className={cn(
                'group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors',
                conv.id === conversationId
                  ? 'bg-white/10 text-foreground font-medium'
                  : 'hover:bg-white/5 text-foreground-muted'
              )}
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <MessageSquare size={14} className="flex-shrink-0" />
                <span className="truncate">{conv.title}</span>
              </div>
              <button
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="text-xs text-foreground-muted px-3 py-4 text-center">
              No conversations yet. Start a new chat.
            </p>
          )}
        </div>
      </aside>

      {/* Main Chat */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* Header */}
        <header className="flex items-center justify-between h-16 px-4 border-b border-white/10 bg-surface/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            {!drawerOpen && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-foreground-muted"
              >
                <PanelLeft size={18} />
              </button>
            )}
            <span className="text-sm font-medium text-foreground">
              {conversationId
                ? conversations.find((c) => c.id === conversationId)?.title ||
                  'Conversation'
                : 'New Conversation'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isLoading && (
              <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                <Loader2 size={14} className="animate-spin" />
                Thinking...
              </span>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex gap-3 max-w-4xl mx-auto',
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              )}
            >
              <Avatar role={msg.role} />
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-5 py-3 text-[15px] leading-relaxed shadow-sm',
                  msg.role === 'user'
                    ? 'bg-indigo-500/15 text-indigo-100 border border-indigo-500/25 rounded-br-md'
                    : 'bg-surface-elevated text-foreground border border-white/10 rounded-bl-md'
                )}
              >
                {msg.content ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : msg.isStreaming ? (
                  <TypingIndicator />
                ) : null}
                {msg.isStreaming && msg.content && (
                  <span className="inline-block w-1.5 h-4 ml-1 bg-indigo-400 animate-pulse align-middle rounded-full" />
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-4 pb-2">
            <GlassCard
              variant="default"
              className="bg-red-500/10 border-red-500/20 text-red-300 px-4 py-2.5 text-sm"
            >
              {error}
            </GlassCard>
          </div>
        )}

        {/* Input */}
        <div className="p-4 bg-surface/50 backdrop-blur-md border-t border-white/10">
          <div className="relative flex items-end gap-2 max-w-3xl mx-auto">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask ${brand.productName} anything...`}
              rows={1}
              className="flex-1 resize-none max-h-32 rounded-xl border border-white/10 bg-background px-4 py-3 pr-12 text-[15px] placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-shadow text-foreground"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40 disabled:hover:bg-indigo-500 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-center text-[11px] text-foreground-muted mt-2">
            {brand.productName} can make mistakes. Verify critical information
            before acting.
          </p>
        </div>
      </main>
    </div>
  );
}
