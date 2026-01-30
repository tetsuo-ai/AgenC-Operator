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
      className="cyber-panel flex flex-col h-full"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      {/* Header */}
      <div className="px-4 py-2 border-b border-neon-magenta/30 bg-gradient-to-r from-neon-magenta/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full bg-neon-magenta"
              animate={{
                opacity: [1, 0.5, 1],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <h3 className="font-display text-xs uppercase tracking-widest text-neon-magenta">
              OPERATOR FEED
            </h3>
          </div>

          {/* Processing Indicator */}
          <AnimatePresence>
            {voiceState === 'processing' && (
              <motion.div
                className="flex items-center gap-1 text-xs text-neon-cyan"
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
              className="flex items-center gap-2 text-holo-silver/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-neon-cyan"
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
      <form onSubmit={handleSubmit} className="p-3 border-t border-neon-magenta/20">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            className="cyber-input flex-1 text-sm"
            disabled={voiceState === 'processing'}
          />
          <button
            type="submit"
            className="cyber-btn-magenta px-4 py-2 text-xs"
            disabled={!input.trim() || voiceState === 'processing'}
          >
            SEND
          </button>
        </div>
      </form>

      {/* Corner decorations */}
      <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-neon-magenta/30" />
      <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-neon-magenta/30" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-neon-magenta/30" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-neon-magenta/30" />
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

  // Role-based styling
  const bubbleStyles = {
    user: {
      container: 'justify-end',
      bubble: 'bg-neon-cyan/10 border-neon-cyan/30 text-holo-white',
      label: 'text-neon-cyan',
    },
    tetsuo: {
      container: 'justify-start',
      bubble: 'bg-neon-magenta/10 border-neon-magenta/30 text-holo-white',
      label: 'text-neon-magenta',
    },
    system: {
      container: 'justify-center',
      bubble: 'bg-cyber-medium/50 border-holo-silver/20 text-holo-silver/70 text-center',
      label: 'text-holo-silver/50',
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
              strong: ({ children }) => <strong className="text-neon-cyan font-bold">{children}</strong>,
              em: ({ children }) => <em className="text-neon-magenta/90 italic">{children}</em>,
              code: ({ children }) => (
                <code className="bg-cyber-dark/60 border border-holo-silver/20 rounded px-1 py-0.5 text-xs text-neon-green font-mono">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="bg-cyber-dark/80 border border-holo-silver/20 rounded p-2 my-1 overflow-x-auto text-xs">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neon-cyan underline hover:text-neon-cyan/80 transition-colors"
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
                ${message.result.success ? 'border-neon-green/30' : 'border-red-500/30'}
              `}
            >
              <span className={message.result.success ? 'text-neon-green' : 'text-red-400'}>
                {message.result.success ? '✓ Success' : '✗ Failed'}
              </span>
              {message.result.signature && typeof message.result.signature === 'string' && (
                <div className="mt-1 text-holo-silver/50 truncate">
                  TX: {message.result.signature.slice(0, 16)}...
                </div>
              )}
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
