/**
 * ============================================================================
 * ChatPanel - Message History & Text Input
 * ============================================================================
 * Displays conversation history with Tetsuo and allows text input.
 * Features cyberpunk chat bubbles with role-based styling.
 * ============================================================================
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import type { ChatMessage, VoiceState } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  voiceState: VoiceState;
  onSendMessage: (message: string) => void;
}

export default function ChatPanel({
  messages,
  voiceState,
  onSendMessage,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <motion.div
      className="flex flex-col h-full rounded-lg border border-white/10 relative overflow-hidden"
      style={{
        background: 'rgba(10, 10, 10, 0.80)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="px-4 py-2 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-white"
              animate={{
                opacity: [1, 0.4, 1],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <h3 className="font-display text-xs uppercase tracking-widest text-white/70">
              OPERATOR FEED
            </h3>
          </div>

          {/* Processing Indicator */}
          <AnimatePresence>
            {voiceState === 'processing' && (
              <motion.div
                className="flex items-center gap-1 text-xs text-white/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                >
                  PROCESSING
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ChatBubble message={message} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator when processing */}
        <AnimatePresence>
          {voiceState === 'processing' && (
            <motion.div
              className="flex items-center gap-2 text-white/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-white/50"
                    animate={{
                      y: [0, -4, 0],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
              <span className="text-xs">Tetsuo is thinking...</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-white/10">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 text-sm px-3 py-2 font-mono bg-white/5 border border-white/15 rounded text-white outline-none focus:border-white/40 transition-colors placeholder:text-white/25"
            disabled={voiceState === 'processing'}
          />
          <button
            type="submit"
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-white/20 rounded text-white/70 hover:text-white hover:border-white/40 hover:bg-white/5 transition-all disabled:opacity-30"
            disabled={!input.trim() || voiceState === 'processing'}
          >
            SEND
          </button>
        </div>
      </form>
    </motion.div>
  );
}

// ============================================================================
// Chat Bubble Component
// ============================================================================

interface ChatBubbleProps {
  message: ChatMessage;
}

function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // Role-based styling — monochrome palette
  const bubbleStyles = {
    user: {
      container: 'justify-end',
      bubble: 'bg-white/8 border-white/20 text-white/90',
      label: 'text-white/50',
    },
    tetsuo: {
      container: 'justify-start',
      bubble: 'bg-white/5 border-white/15 text-white/85',
      label: 'text-white/40',
    },
    system: {
      container: 'justify-center',
      bubble: 'bg-white/3 border-white/10 text-white/50 text-center',
      label: 'text-white/30',
    },
  };

  const style = bubbleStyles[message.role];

  return (
    <div className={`flex ${style.container}`}>
      <div className={`max-w-[85%] ${isSystem ? 'max-w-full' : ''}`}>
        {/* Role Label */}
        {!isSystem && (
          <div className={`text-[10px] uppercase tracking-wider mb-1 ${style.label}`}>
            {isUser ? 'You' : 'Tetsuo'}
          </div>
        )}

        {/* Bubble */}
        <div
          className={`
            px-3 py-2 rounded border text-sm font-mono
            ${style.bubble}
          `}
          style={{
            clipPath: isUser
              ? 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)'
              : 'polygon(0 0, 100% 0, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
          }}
        >
          <Markdown
            components={{
              p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
              em: ({ children }) => <em className="text-white/70 italic">{children}</em>,
              code: ({ children }) => (
                <code className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-xs text-white/80 font-mono">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="bg-white/5 border border-white/10 rounded p-2 my-1 overflow-x-auto text-xs">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/80 underline hover:text-white transition-colors"
                >
                  {children}
                </a>
              ),
              ul: ({ children }) => <ul className="list-disc list-inside ml-2 mb-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside ml-2 mb-1">{children}</ol>,
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
            }}
          >
            {message.content}
          </Markdown>

          {/* Execution Result Badge */}
          {message.result && (
            <div
              className={`
                mt-2 pt-2 border-t text-xs
                ${message.result.success ? 'border-white/20' : 'border-red-500/30'}
              `}
            >
              <span className={message.result.success ? 'text-white/70' : 'text-red-400'}>
                {message.result.success ? 'Success' : 'Failed'}
              </span>
              {message.result.signature && typeof message.result.signature === 'string' && (
                <div className="mt-1 text-white/30 truncate">
                  TX: {message.result.signature.slice(0, 16)}...
                </div>
              )}
              {/* Inline image display for generated images */}
              {(() => {
                const data = message.result?.data;
                if (!data || typeof data !== 'object') return null;
                const b64 = (data as Record<string, unknown>).b64_data;
                if (typeof b64 !== 'string') return null;
                return (
                  <div className="mt-2 pt-2 border-t border-holo-silver/20">
                    <img
                      src={`data:image/png;base64,${b64}`}
                      alt="Generated image"
                      className="max-w-full rounded border border-holo-silver/20"
                      style={{ maxHeight: '300px', objectFit: 'contain' }}
                    />
                    <div className="text-[10px] text-holo-silver/40 mt-1">
                      AI Generated Image
                    </div>
                  </div>
                );
              })()}
              {/* Inline video display for generated videos */}
              {(() => {
                const data = message.result?.data;
                if (!data || typeof data !== 'object') return null;
                const rec = data as Record<string, unknown>;
                const videoUrl = rec.url as string | undefined;
                const format = rec.format as string | undefined;
                const durationSec = rec.duration_sec as number | undefined;
                if (!videoUrl || (format !== 'mp4' && !durationSec)) return null;
                return (
                  <div className="mt-2 pt-2 border-t border-holo-silver/20">
                    <video
                      controls
                      autoPlay
                      muted
                      loop
                      className="max-w-full rounded border border-holo-silver/20"
                      style={{ maxHeight: '300px' }}
                    >
                      <source src={videoUrl} type="video/mp4" />
                    </video>
                    <div className="text-[10px] text-holo-silver/40 mt-1">
                      AI Generated Video{durationSec ? ` \u2022 ${durationSec}s` : ''}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className={`text-[10px] mt-1 ${style.label} opacity-50`}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
